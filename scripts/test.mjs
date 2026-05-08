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
import { runCmd, spawnBg, waitForUrl, killProcessGroup, pickFreePort } from './_lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sts-test-'));
const target = path.join(tmpRoot, 'sample-app');

let dev = null;
async function cleanup() {
  // Kill the entire process group — vite spawns grandchildren (workerd) that
  // survive child.kill() and end up squatting ports across test runs.
  await killProcessGroup(dev);
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

  // Pick a random free port to avoid collisions with anything else running on
  // the host. Skip `npm run dev` indirection so we don't have two `--port`
  // flags fighting (the package.json script already hardcodes `--port 3000`).
  const devPort = await pickFreePort();
  console.log(`[L3] Booting vite dev on port ${devPort}...`);
  dev = spawnBg(
    path.join(target, 'node_modules', '.bin', 'vite'),
    ['dev', `--port=${devPort}`, '--strictPort', '--host=127.0.0.1'],
    { cwd: target }
  );

  // Pipe dev-server output (handy for debugging failures)
  dev.stdout.on('data', (b) => process.stdout.write(`[dev] ${b}`));
  dev.stderr.on('data', (b) => process.stderr.write(`[dev] ${b}`));

  const url = `http://127.0.0.1:${devPort}/`;
  console.log(`[L3] HTTP probe ${url} (waiting for 200)...`);
  const res = await waitForUrl(url, { timeoutMs: 90_000 });
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
