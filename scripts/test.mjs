#!/usr/bin/env node
//
// test.mjs — supertools-stack functional test harness.
//
// Renders an install into a tmp dir, verifies it boots and responds at
// http://127.0.0.1:8787/. Exit 0 = pass, non-zero = fail.
//
// Layers exercised in v0.1:
//   L1 — install.sh completes (cloudflare scaffolder + customizations apply)
//   L2 — pnpm typecheck passes
//   L3 — wrangler dev boots and responds
//
// L4 (Playwright) and the cascade-delete contract test land in v0.2+ as we
// add the customizations layer.

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

  console.log('[L2] Typecheck (pnpm tsc --noEmit)...');
  await runCmd('pnpm', ['tsc', '--noEmit'], { cwd: target });

  console.log('[L3] Booting wrangler dev (port 8787)...');
  dev = spawnBg('pnpm', ['wrangler', 'dev', '--port=8787', '--ip=127.0.0.1'], { cwd: target });

  // Pipe wrangler output (handy for debugging failures)
  dev.stdout.on('data', (b) => process.stdout.write(`[wrangler] ${b}`));
  dev.stderr.on('data', (b) => process.stderr.write(`[wrangler] ${b}`));

  await waitForUrl('http://127.0.0.1:8787/', 90_000);

  console.log('[L3] HTTP probe http://127.0.0.1:8787/ ...');
  const res = await fetch('http://127.0.0.1:8787/');
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
