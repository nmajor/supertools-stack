#!/usr/bin/env node
//
// test.mjs — supertools-stack functional test harness.
//
// Renders an install into a tmp dir, typechecks, builds, boots vite dev, and
// probes http://127.0.0.1:3001/. Exit 0 = pass, non-zero = fail.
//
// Layers exercised in v0.1:
//   L1 — install.sh completes (cloudflare scaffolder + customizations apply)
//   L2 — npm run build succeeds (production build; generates routeTree.gen.ts)
//   L2.5 — npx tsc --noEmit passes (must run AFTER build because the TanStack
//          router plugin generates routeTree.gen.ts during vite build)
//   L3 — vite dev boots and responds at /
//
// L4 (Playwright e2e) and the cascade-delete contract test land in v0.2+ as
// the customizations layer fills in db / auth / pages.
//
// Note: TanStack Start's dev server is `vite dev` on port 3000, not
// `wrangler dev` on 8787. See customizations/SCAFFOLD-NOTES.md.

import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runCmd, spawnBg, waitForUrl } from './_lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sts-test-'));
const target = path.join(tmpRoot, 'sample-app');

let dev = null;
async function cleanup() {
  if (dev && dev.pid) {
    try { dev.kill('SIGTERM'); } catch {}
  }
  await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
}

let ok = false;
try {
  console.log(`[L1] Running install.sh against ${target}...`);
  await runCmd('bash', [path.join(repoRoot, 'install.sh'), target, '--no-refresh']);

  console.log('[L2] Production build (npm run build)...');
  await runCmd('npm', ['run', 'build'], { cwd: target });

  console.log('[L2.5] Typecheck (npx tsc --noEmit)...');
  await runCmd('npx', ['--no-install', 'tsc', '--noEmit'], { cwd: target });

  console.log('[L3] Booting `vite dev` (port 3001)...');
  dev = spawnBg('npm', ['run', 'dev', '--', '--port=3001', '--host=127.0.0.1'], { cwd: target });

  // Pipe dev-server output (handy for debugging failures)
  dev.stdout.on('data', (b) => process.stdout.write(`[dev] ${b}`));
  dev.stderr.on('data', (b) => process.stderr.write(`[dev] ${b}`));

  await waitForUrl('http://127.0.0.1:3001/', 90_000);

  console.log('[L3] HTTP probe http://127.0.0.1:3001/ ...');
  const res = await fetch('http://127.0.0.1:3001/');
  if (res.status !== 200) {
    throw new Error(`Expected 200, got ${res.status}`);
  }
  console.log(`     OK (status ${res.status})`);
  ok = true;
} catch (e) {
  console.error('FAIL:', e.message);
} finally {
  await cleanup();
}

if (ok) {
  console.log('\nPASS');
  process.exit(0);
} else {
  process.exit(1);
}
