// 20-auth — Better Auth runtime on top of the 10-db schema.
//
// What this step does:
//   1. Render customizations/20-auth/ into the project:
//      - src/lib/auth.ts          (Better Auth server config, password-only)
//      - src/lib/auth-client.ts   (Better Auth React client)
//      - src/routes/api/auth/$.ts (TanStack Start catch-all server route)
//      - src/routes/(auth)/sign-{in,up}.tsx (minimal auth pages)
//      - tests/20-auth/signup-flow.test.ts + vitest.auth.config.ts (smoke test)
//   2. Generate a `BETTER_AUTH_SECRET` via crypto.randomBytes if `.dev.vars`
//      doesn't already define one. We use `.dev.vars` (not .env.local) because
//      the @cloudflare/vite-plugin loads .dev.vars and surfaces values via the
//      `cloudflare:workers` `env` proxy — which is how src/lib/auth.ts reads
//      its secret. .env.local would not reach the worker runtime.
//   3. Make sure `.dev.vars` is gitignored (it usually is post-scaffold; this
//      is defensive).
//   4. Patch package.json to add a `test:auth` script so the developer can run
//      the signup-flow vitest independently of the harness.
//
// What this step does NOT do (deferred):
//   - email verification, OAuth, magic links, 2FA — out of scope for v0.1
//   - real-deploy secret provisioning — supertools-design's deploy concern
//   - npm install — better-auth was added by 10-db, no new deps here
//
// See HANDOFF.md "Stack scope (locked in)" + "Decisions already made about the
// next slices" for why the scope was drawn here.

import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { renderTree } from '../render.mjs';
import { readReceipt, writeReceipt, fileExists } from './_step-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const TEMPLATE_DIR = path.join(repoRoot, 'customizations', '20-auth');

export const id = '20-auth';
export const requires = ['00-scaffold', '10-db'];
export const provides = ['better-auth-server', 'auth-routes'];

export async function detect(ctx) {
  const receipt = await readReceipt(ctx.targetPath, id);
  if (receipt) return { skip: true, reason: 'receipt found' };
  return { skip: false };
}

export async function apply(ctx) {
  console.log('  Rendering customizations/20-auth/ -> project...');
  await renderTree(TEMPLATE_DIR, ctx.targetPath, {
    PROJECT_NAME: ctx.projectName,
  });

  console.log('  Ensuring BETTER_AUTH_SECRET in .dev.vars...');
  await ensureSecretInDevVars(ctx.targetPath);

  console.log('  Ensuring .dev.vars is gitignored...');
  await ensureGitignoreEntry(ctx.targetPath, '.dev.vars');

  console.log('  Patching package.json (test:auth script)...');
  await patchPackageJson(ctx.targetPath);

  await writeReceipt(ctx.targetPath, id, {
    version: '0.1',
    summary: 'Better Auth password-only runtime + auth pages + signup flow test',
    notes: [
      'Secret lives in .dev.vars (gitignored); regenerate via wrangler secret',
      'put BETTER_AUTH_SECRET for production deploys.',
    ].join(' '),
  });
}

// ─── .dev.vars handling ────────────────────────────────────────────────────
// Idempotent: if BETTER_AUTH_SECRET= is already present we leave the file as
// is. Otherwise we append a freshly-generated 32-byte hex secret plus a
// BETTER_AUTH_URL default for local dev (vite's hardcoded port 3000).
async function ensureSecretInDevVars(targetPath) {
  const file = path.join(targetPath, '.dev.vars');
  let existing = '';
  if (await fileExists(file)) {
    existing = await fs.readFile(file, 'utf-8');
    if (/^BETTER_AUTH_SECRET\s*=/m.test(existing)) {
      // Already configured — preserve.
      if (!/^BETTER_AUTH_URL\s*=/m.test(existing)) {
        const sep = existing.endsWith('\n') ? '' : '\n';
        await fs.writeFile(
          file,
          `${existing}${sep}BETTER_AUTH_URL=http://localhost:3000\n`,
        );
      }
      return;
    }
  }

  const secret = crypto.randomBytes(32).toString('hex');
  const lines = [
    '# Local-dev secrets for wrangler / @cloudflare/vite-plugin.',
    '# This file is gitignored — never commit real secrets.',
    `BETTER_AUTH_SECRET=${secret}`,
    'BETTER_AUTH_URL=http://localhost:3000',
    '',
  ];
  const sep = existing && !existing.endsWith('\n') ? '\n' : '';
  await fs.writeFile(file, `${existing}${sep}${lines.join('\n')}`);
}

// ─── .gitignore handling ───────────────────────────────────────────────────
// Append `entry` to the project's .gitignore if it isn't already covered by an
// exact line match. We don't try to interpret glob patterns — if the user (or
// the C3 scaffold) already wrote something fancier, leave it alone.
async function ensureGitignoreEntry(targetPath, entry) {
  const file = path.join(targetPath, '.gitignore');
  let text = '';
  try {
    text = await fs.readFile(file, 'utf-8');
  } catch {
    text = '';
  }
  const present = text
    .split('\n')
    .map((l) => l.trim())
    .some((l) => l === entry || l === `/${entry}`);
  if (present) return;
  const sep = text && !text.endsWith('\n') ? '\n' : '';
  await fs.writeFile(file, `${text}${sep}${entry}\n`);
}

// ─── package.json ──────────────────────────────────────────────────────────
// Adds a single script. We don't mutate dependencies — better-auth is already
// installed by 10-db. If the script is already present we no-op.
async function patchPackageJson(targetPath) {
  const file = path.join(targetPath, 'package.json');
  const text = await fs.readFile(file, 'utf-8');
  const pkg = JSON.parse(text);
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['test:auth'] =
    'vitest run --config vitest.auth.config.ts';
  await fs.writeFile(file, JSON.stringify(pkg, null, 2) + '\n');
}
