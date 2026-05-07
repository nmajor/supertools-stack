#!/usr/bin/env node
//
// orchestrate-install.mjs — heavy-lifting half of install.sh.
//
// 1. Run `npm create cloudflare@latest --framework=tanstack-start` against the
//    target directory.
// 2. Layer customizations (v0.1: nothing — empty customizations dir).
// 3. Run `pnpm install` in the result.

import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runCmd } from './_lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const customizationsDir = path.join(repoRoot, 'customizations');

const target = process.argv[2];
if (!target) {
  console.error('Usage: orchestrate-install.mjs <target-path>');
  process.exit(1);
}

const targetAbs = path.resolve(target);
const projectName = path.basename(targetAbs);
const parent = path.dirname(targetAbs);

console.log(`▶ Bootstrapping at ${targetAbs}`);

// Step 1: cloudflare scaffolder
console.log('[1/3] Running `npm create cloudflare@latest --framework=tanstack-start`...');
await fs.mkdir(parent, { recursive: true });
await runCmd(
  'npm',
  [
    'create', 'cloudflare@latest',
    '--', projectName,
    '--framework=tanstack-start',
    '--lang=ts',
    '--no-deploy',
    '--no-git',
    '--accept-defaults',
  ],
  { cwd: parent }
);

// Step 2: layer customizations (empty in v0.1)
console.log('[2/3] Layering customizations...');
const entries = await fs.readdir(customizationsDir).catch(() => []);
const meaningful = entries.filter((e) => !e.startsWith('.') && e !== 'README.md');
if (meaningful.length === 0) {
  console.log('  (no customizations in v0.1 — passthrough)');
} else {
  // v0.2+: copy + render templates with placeholder substitution
  // (use scripts/render.mjs)
  console.log(`  (TODO v0.2+: layer ${meaningful.length} customization(s) with placeholder substitution)`);
}

// Step 3: ensure deps installed (cloudflare scaffolder typically runs `pnpm install`
// already — this is a safety net if --accept-defaults skipped it)
console.log('[3/3] Verifying deps installed...');
const hasNodeModules = await fs.stat(path.join(targetAbs, 'node_modules')).then(() => true).catch(() => false);
if (!hasNodeModules) {
  await runCmd('pnpm', ['install'], { cwd: targetAbs });
} else {
  console.log('  (node_modules already present — skipping)');
}

console.log('');
console.log(`✓ Done. Next:`);
console.log(`  cd ${targetAbs}`);
console.log(`  pnpm dev`);
