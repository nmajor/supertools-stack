// 27-auth-hardening — per-IP rate limiting + Cloudflare Turnstile on sign-up.
//
// What this step ships:
//   1. Renders customizations/27-auth-hardening/ into the project:
//      - src/lib/turnstile.ts             — server-side siteverify wrapper
//      - src/components/Turnstile.tsx     — React widget wrapper
//   2. Patches wrangler.jsonc to add the Cloudflare Workers rate-limit binding
//      named AUTH_RATE_LIMITER (10 req / 60s per key, simple algorithm).
//      Bound at the top-level `ratelimits` key per current wrangler shape.
//   3. Patches src/lib/auth.ts (rendered by 20-auth) to add a Better Auth
//      `hooks.before` middleware that runs on /sign-up/email, reads
//      X-Turnstile-Token from request headers, and calls verifyTurnstile().
//      Gracefully no-ops when TURNSTILE_SECRET is unset — the rendered
//      template stays inert until per-project deploy provisions the secret.
//   4. Patches src/lib/security-headers.ts (rendered by 15-foundation) to
//      allow https://challenges.cloudflare.com in script-src and frame-src
//      (Turnstile loads its widget JS + an iframe from that host).
//
// Why patchers (vs cross-step rewrites in 20-auth/15-foundation):
//   - 20-auth + 15-foundation are usable on their own. 27-auth-hardening is
//     opt-in. Baking the patcher into a later step keeps the earlier steps'
//     templates focused on their own scope. Same pattern as 26-password-
//     reset's auth.ts patcher.
//   - The catch-all route (`src/routes/api/auth/$.ts`) IS modified upstream
//     in 20-auth's template — but that change is dormant when the
//     AUTH_RATE_LIMITER binding is missing (the optional chain returns
//     undefined and the handler just delegates to auth.handler). So 20-auth
//     ships the rate-limit interposition unconditionally; 27-auth-hardening
//     just provides the binding that turns it on.
//
// What this step does NOT do:
//   - Provision a Turnstile widget. Done manually via
//     scripts/setup-turnstile.mjs (one-time, per-test-project). Production
//     widgets are supertools-design's deploy concern's job.
//   - Write TURNSTILE_SITE_KEY / TURNSTILE_SECRET into .dev.vars. The
//     harness reads them from the top-level repo's .env at start and writes
//     to the test project's .dev.vars before booting vite dev. Outside the
//     harness, the operator copies them in by hand (see .env.example).
//   - Bump any npm deps. Turnstile is just a script tag + native fetch.

import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { renderTree } from '../render.mjs';
import { readReceipt, writeReceipt, fileExists } from './_step-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const TEMPLATE_DIR = path.join(repoRoot, 'customizations', '27-auth-hardening');

export const id = '27-auth-hardening';
export const requires = ['00-scaffold', '10-db', '15-foundation', '20-auth'];
export const provides = ['auth-rate-limit', 'turnstile-signup'];

export async function detect(ctx) {
  const receipt = await readReceipt(ctx.targetPath, id);
  if (receipt) return { skip: true, reason: 'receipt found' };
  return { skip: false };
}

export async function apply(ctx) {
  console.log('  Rendering customizations/27-auth-hardening/ -> project...');
  await renderTree(TEMPLATE_DIR, ctx.targetPath, {
    PROJECT_NAME: ctx.projectName,
  });

  console.log('  Patching wrangler.jsonc (add AUTH_RATE_LIMITER binding)...');
  await patchWranglerJsonc(ctx.targetPath);

  console.log('  Patching src/lib/auth.ts (add Turnstile hooks.before)...');
  await patchAuthTs(ctx.targetPath);

  console.log('  Patching src/lib/security-headers.ts (allow Turnstile host)...');
  await patchSecurityHeaders(ctx.targetPath);

  await writeReceipt(ctx.targetPath, id, {
    version: '0.1',
    summary:
      'Per-IP rate limit (sign-up/sign-in/request-password-reset) + ' +
      'Turnstile gate on /sign-up/email',
    notes: [
      'AUTH_RATE_LIMITER binding: 10 req / 60s, simple algorithm.',
      'Turnstile site key + secret must be provisioned via',
      'scripts/setup-turnstile.mjs (one-time) and copied into the project\'s',
      '.dev.vars as TURNSTILE_SITE_KEY / TURNSTILE_SECRET. Production deploys',
      'are supertools-design\'s deploy concern.',
    ].join(' '),
  });
}

// ─── wrangler.jsonc patcher ────────────────────────────────────────────────
// Same shape as 10-db's d1_databases patcher: anchor on the closing `}` of
// the top-level object, walk back to the last real (non-comment, non-blank)
// property, ensure a trailing comma, then insert our `ratelimits` block.
// Idempotent: bail out if AUTH_RATE_LIMITER is already present.
async function patchWranglerJsonc(targetPath) {
  const file = path.join(targetPath, 'wrangler.jsonc');
  if (!(await fileExists(file))) {
    throw new Error(`wrangler.jsonc not found at ${file}`);
  }
  const original = await fs.readFile(file, 'utf-8');

  if (original.includes('"AUTH_RATE_LIMITER"')) {
    return; // already patched
  }
  if (/"ratelimits"\s*:/.test(original)) {
    // Someone added a different ratelimits block; refuse to silently merge.
    throw new Error(
      'wrangler.jsonc already has a `ratelimits` block that does not ' +
      'include AUTH_RATE_LIMITER; refusing to overwrite. Inspect manually.',
    );
  }

  const lines = original.split('\n');

  let closeIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() === '}') { closeIdx = i; break; }
  }
  if (closeIdx === -1) {
    throw new Error('wrangler.jsonc: could not find top-level closing `}`');
  }

  let propIdx = -1;
  let inBlockComment = false;
  for (let i = closeIdx - 1; i >= 0; i--) {
    const raw = lines[i];
    const trim = raw.trim();
    if (trim === '') continue;
    if (/\*\/\s*$/.test(trim) && !/^\s*\/\*/.test(trim)) {
      inBlockComment = true;
      continue;
    }
    if (inBlockComment) {
      if (/^\s*\/\*/.test(trim)) inBlockComment = false;
      continue;
    }
    if (/^\s*\/\*.*\*\/\s*$/.test(trim)) continue;
    if (trim.startsWith('//')) continue;
    propIdx = i;
    break;
  }
  if (propIdx === -1) {
    throw new Error('wrangler.jsonc: could not find a property line to anchor ratelimits insertion');
  }

  if (!/,\s*$/.test(lines[propIdx])) {
    lines[propIdx] = lines[propIdx] + ',';
  }

  const indentMatch = lines[propIdx].match(/^([\t ]+)/);
  const indent = indentMatch ? indentMatch[1] : '\t';

  const block = [
    `${indent}"ratelimits": [`,
    `${indent}${indent}{`,
    `${indent}${indent}${indent}"name": "AUTH_RATE_LIMITER",`,
    `${indent}${indent}${indent}"namespace_id": "1001",`,
    `${indent}${indent}${indent}"simple": {`,
    `${indent}${indent}${indent}${indent}"limit": 10,`,
    `${indent}${indent}${indent}${indent}"period": 60`,
    `${indent}${indent}${indent}}`,
    `${indent}${indent}}`,
    `${indent}]`,
  ].join('\n');

  const patched = [
    ...lines.slice(0, closeIdx),
    block,
    ...lines.slice(closeIdx),
  ].join('\n');

  try {
    JSON.parse(stripJsoncToJson(patched));
  } catch (e) {
    throw new Error(
      `Patched wrangler.jsonc is not valid JSONC: ${e.message}\n` +
      `--- patched content ---\n${patched}\n--- end ---`,
    );
  }

  await fs.writeFile(file, patched);
}

function stripJsoncToJson(text) {
  let out = text.replace(/\/\*[\s\S]*?\*\//g, '');
  out = out.replace(/^\s*\/\/.*$/gm, '');
  out = out.replace(/,(\s*[}\]])/g, '$1');
  return out;
}

// ─── auth.ts patcher (Turnstile hooks.before) ──────────────────────────────
//
// Inserts:
//   1. Imports: createAuthMiddleware + APIError from 'better-auth/api',
//      verifyTurnstile from '../lib/turnstile', env from 'cloudflare:workers'.
//   2. A `hooks: { before: ... }` key into the BetterAuthOptions object.
//
// Anchors: the same import-anchor 26-password-reset uses (`import * as schema
// from '../db/schema';`) is the last canonical import line. Hook anchor: the
// closing `};` of the BetterAuthOptions object — we insert `hooks: { before }`
// before that. We pick the FIRST closing brace at column 2 (consistent indent)
// after the trustedOrigins line; failing that we throw.
//
// Idempotency markers:
//   - `// 27-auth-hardening: imports`
//   - `// 27-auth-hardening: turnstile-hook`
async function patchAuthTs(targetPath) {
  const file = path.join(targetPath, 'src', 'lib', 'auth.ts');
  if (!(await fileExists(file))) {
    throw new Error(
      `27-auth-hardening: ${file} not found. Did 20-auth run?`
    );
  }
  const original = await fs.readFile(file, 'utf-8');
  let patched = original;

  // 1. imports
  const importMarker = '// 27-auth-hardening: imports';
  if (!patched.includes(importMarker)) {
    // Anchor on the last canonical import line emitted by 20-auth's template.
    // If 26-password-reset has already run, its imports follow this line —
    // that's fine, we anchor on the schema import and add after it (and
    // before 26's import marker, which is itself after `schema`).
    const anchor = "import * as schema from '../db/schema';";
    if (!patched.includes(anchor)) {
      throw new Error(
        `27-auth-hardening: could not find import anchor in auth.ts ` +
        `("${anchor}"). 20-auth's template may have changed shape.`,
      );
    }
    const injection =
      anchor +
      '\n' +
      importMarker +
      '\n' +
      "import { createAuthMiddleware, APIError } from 'better-auth/api';\n" +
      "import { verifyTurnstile } from './turnstile';";
    patched = patched.replace(anchor, injection);
  }

  // 2. hooks.before — insert the `hooks` key into the BetterAuthOptions
  // object literal. Anchor on the closing `};` of the options object. The
  // template ends the options with `trustedOrigins,\n  };` — we replace the
  // `  };` (single canonical occurrence) with `,\n    hooks: { before: ... },\n  };`.
  const hookMarker = '// 27-auth-hardening: turnstile-hook';
  if (!patched.includes(hookMarker)) {
    // The literal we anchor on is the closing of the options object: the
    // line `  };` that immediately follows `trustedOrigins,`. Match using a
    // multiline anchor including `trustedOrigins,` so we don't collide with
    // any other `};` in the file.
    const anchor = '    trustedOrigins,\n  };';
    if (!patched.includes(anchor)) {
      throw new Error(
        `27-auth-hardening: could not find BetterAuthOptions close anchor ` +
        `in auth.ts ("trustedOrigins,\\n  };"). 20-auth's template may have ` +
        `changed shape.`,
      );
    }
    const replacement =
      '    trustedOrigins,\n' +
      '    ' + hookMarker + '\n' +
      '    // Verify Cloudflare Turnstile on /sign-up/email when configured.\n' +
      '    // Token arrives as the `X-Turnstile-Token` header (set by the\n' +
      "    // sign-up form's signUp.email fetchOptions). The check is dormant\n" +
      '    // when TURNSTILE_SECRET is unset — useful for harness layers that\n' +
      "    // exercise sign-up without provisioning the secret. The 20-auth\n" +
      '    // catch-all route handles per-IP rate-limiting separately (no\n' +
      '    // Better Auth hook for that — see src/routes/api/auth/$.ts).\n' +
      '    hooks: {\n' +
      '      before: createAuthMiddleware(async (ctx) => {\n' +
      "        if (ctx.path !== '/sign-up/email') return;\n" +
      '        const secret = (e as unknown as { TURNSTILE_SECRET?: string }).TURNSTILE_SECRET;\n' +
      '        if (!secret) return; // captcha not provisioned for this env\n' +
      "        const token = ctx.headers?.get('x-turnstile-token') ?? '';\n" +
      '        if (!token) {\n' +
      "          throw new APIError('BAD_REQUEST', { message: 'Captcha required' });\n" +
      '        }\n' +
      "        const ip = ctx.headers?.get('cf-connecting-ip') ?? null;\n" +
      '        const valid = await verifyTurnstile(token, ip, secret);\n' +
      '        if (!valid) {\n' +
      "          throw new APIError('BAD_REQUEST', { message: 'Captcha verification failed' });\n" +
      '        }\n' +
      '      }),\n' +
      '    },\n' +
      '  };';
    patched = patched.replace(anchor, replacement);
  }

  if (patched === original) return;

  if (!patched.includes(importMarker) || !patched.includes(hookMarker)) {
    throw new Error(
      '27-auth-hardening: post-patch sanity check failed — one of the ' +
      'idempotency markers is missing from the final auth.ts.',
    );
  }
  if (patched.indexOf(importMarker) > patched.indexOf(hookMarker)) {
    throw new Error(
      '27-auth-hardening: post-patch sanity check failed — imports landed ' +
      'after the hook, anchors scrambled.',
    );
  }

  await fs.writeFile(file, patched);
}

// ─── security-headers.ts patcher ───────────────────────────────────────────
// Append https://challenges.cloudflare.com to script-src and frame-src in
// the CSP. The Turnstile widget loads JS from that host AND renders an
// iframe pointing at it. Idempotent.
async function patchSecurityHeaders(targetPath) {
  const file = path.join(targetPath, 'src', 'lib', 'security-headers.ts');
  if (!(await fileExists(file))) {
    throw new Error(
      `27-auth-hardening: ${file} not found. Did 15-foundation run?`,
    );
  }
  const original = await fs.readFile(file, 'utf-8');
  let patched = original;
  const TURNSTILE_HOST = 'https://challenges.cloudflare.com';

  // script-src: anchor on the existing 15-foundation line and append our host
  // before the closing quote IF it's not already there.
  const scriptAnchor =
    `"script-src 'self' 'unsafe-inline' https://rybbit.nmajor.net https://chatwoot.nmajor.net"`;
  const scriptReplacement =
    `"script-src 'self' 'unsafe-inline' https://rybbit.nmajor.net https://chatwoot.nmajor.net ${TURNSTILE_HOST}"`;
  if (patched.includes(scriptAnchor) && !patched.includes(scriptReplacement)) {
    patched = patched.replace(scriptAnchor, scriptReplacement);
  } else if (!patched.includes(scriptAnchor) && !patched.includes(scriptReplacement)) {
    throw new Error(
      '27-auth-hardening: could not find script-src anchor in ' +
      'security-headers.ts. 15-foundation may have changed shape.',
    );
  }

  // frame-src: similar shape.
  const frameAnchor = `"frame-src 'self' https://chatwoot.nmajor.net"`;
  const frameReplacement = `"frame-src 'self' https://chatwoot.nmajor.net ${TURNSTILE_HOST}"`;
  if (patched.includes(frameAnchor) && !patched.includes(frameReplacement)) {
    patched = patched.replace(frameAnchor, frameReplacement);
  } else if (!patched.includes(frameAnchor) && !patched.includes(frameReplacement)) {
    throw new Error(
      '27-auth-hardening: could not find frame-src anchor in ' +
      'security-headers.ts. 15-foundation may have changed shape.',
    );
  }

  if (patched === original) return; // both already applied

  // Final sanity: confirm both replacements ended up in the file.
  if (!patched.includes(scriptReplacement) || !patched.includes(frameReplacement)) {
    throw new Error(
      '27-auth-hardening: post-patch sanity check failed for security-' +
      'headers.ts; expected directives not present after patching.',
    );
  }

  await fs.writeFile(file, patched);
}
