// 15-foundation — stack-wide plumbing that the auth/db/marketing/dashboard
// steps build on top of.
//
// What this step ships:
//   1. README.md (overwrites C3's default) + .env.example at the project root.
//   2. src/lib/log.ts            — structured JSON logger (no deps).
//   3. src/lib/request-context.ts — AsyncLocalStorage store for {requestId,userId}.
//   4. src/lib/security-headers.ts — CSP/HSTS/etc; skipped in dev.
//   5. src/components/ErrorPage.tsx — Tailwind 404 / 500 fallback.
//   6. src/routes/__root.tsx     — root layout, lifted from 30-marketing. Wires
//                                  errorComponent + notFoundComponent at the
//                                  root route so any uncaught error / missing
//                                  route renders the ErrorPage.
//   7. src/server.ts             — custom worker entry that wraps TanStack
//                                  Start's default handler with request-ID
//                                  middleware + security headers + X-Request-Id
//                                  response header.
//   8. wrangler.jsonc patched:    `"main": "src/server.ts"` (was the default
//                                  `@tanstack/react-start/server-entry`).
//
// Cross-step coupling notes:
//   - 30-marketing previously owned src/routes/__root.tsx. That ownership now
//     lives here (15-foundation runs first by numeric order). 30-marketing's
//     apply() no longer renders or removes that file.
//   - The TanStack devtools imports in __root.tsx are unchanged — devtools are
//     dev-only via tree-shaking.
//
// What this step does NOT do (deferred / out of scope):
//   - Per-route error boundaries. The root errorComponent is sufficient for
//     v0.1; per-route variants land per-feature.
//   - Sentry / external error reporting. Cloudflare's built-in stdout capture
//     is enough until there's a real audience.
//   - Rate limiting. Owned by a future supertools-design concern.
//
// Idempotency:
//   - renderTree overwrites .tmpl outputs each run.
//   - The wrangler.jsonc `main` patch is idempotent — checks for the target
//     value before mutating.
//   - The receipt-skip in detect() handles the orchestrator-level case.

import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { renderTree } from '../render.mjs';
import { readReceipt, writeReceipt, fileExists } from './_step-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const TEMPLATE_DIR = path.join(repoRoot, 'customizations', '15-foundation');

export const id = '15-foundation';
export const requires = ['00-scaffold'];
export const provides = [
  'structured-logging',
  'request-id',
  'security-headers',
  'error-pages',
  'root-layout',
  'env-example',
  'readme',
];

export async function detect(ctx) {
  const receipt = await readReceipt(ctx.targetPath, id);
  if (receipt) return { skip: true, reason: 'receipt found' };
  return { skip: false };
}

export async function apply(ctx) {
  console.log('  Rendering customizations/15-foundation/ -> project...');
  await renderTree(TEMPLATE_DIR, ctx.targetPath, {
    PROJECT_NAME: ctx.projectName,
  });

  console.log('  Repointing wrangler.jsonc "main" -> src/server.ts...');
  await patchWranglerMain(ctx.targetPath);

  await writeReceipt(ctx.targetPath, id, {
    version: '0.1',
    summary:
      'logging + request-id middleware + security headers + error pages + ' +
      'README + .env.example',
    notes: [
      'Owns src/routes/__root.tsx (lifted from 30-marketing).',
      'Worker entry src/server.ts wraps TanStack Start handler; wrangler.jsonc',
      '"main" repointed accordingly.',
    ].join(' '),
  });
}

// ─── wrangler.jsonc "main" patcher ─────────────────────────────────────────
// The C3 scaffold sets `"main": "@tanstack/react-start/server-entry"`. We
// repoint it at our local src/server.ts so every request flows through our
// middleware wrapper. Hand-rolled string edit (no jsonc-parser dep) — the
// scaffold's main line is well-known and stable across C3 releases.
async function patchWranglerMain(targetPath) {
  const file = path.join(targetPath, 'wrangler.jsonc');
  if (!(await fileExists(file))) {
    throw new Error(`wrangler.jsonc not found at ${file}`);
  }
  const original = await fs.readFile(file, 'utf-8');
  const TARGET = 'src/server.ts';

  // Idempotent: if already pointing at our entry, no-op.
  if (new RegExp(`"main"\\s*:\\s*"${TARGET}"`).test(original)) {
    return;
  }

  // Match the existing main value (any string) and rewrite it. We tolerate
  // both the C3 default and any value a user might have manually set; we
  // never silently overwrite a foreign value without surfacing it (the diff
  // will land in their git history).
  const mainLineRe = /("main"\s*:\s*)"[^"]*"/;
  if (!mainLineRe.test(original)) {
    throw new Error('wrangler.jsonc: no "main" property found to repoint');
  }
  const patched = original.replace(mainLineRe, `$1"${TARGET}"`);

  // Sanity-check the result is still valid JSONC by stripping comments and
  // trailing commas and parsing as JSON.
  try {
    JSON.parse(stripJsoncToJson(patched));
  } catch (e) {
    throw new Error(
      `Patched wrangler.jsonc is not valid JSONC: ${e.message}\n` +
      `--- patched ---\n${patched}\n--- end ---`,
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
