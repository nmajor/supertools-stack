#!/usr/bin/env node
//
// orchestrate-install.mjs — walks install-steps in numeric-prefix order.
//
// Each step in `scripts/install-steps/` exports:
//   - id (string, e.g. "00-scaffold")
//   - requires (array of step ids that must run first)
//   - provides (array of capability names — purely informational for now)
//   - detect(ctx) -> { skip: boolean, reason?: string }   (optional)
//   - apply(ctx)  -> void
//
// The orchestrator:
//   1. Loads every `<NN>-<name>.mjs` file under install-steps/, sorted by prefix.
//   2. Validates each step's exports and verifies `requires` lists only refer
//      to earlier steps that exist.
//   3. For each step in order:
//        - reads its receipt at <project>/.supertools-state/<id>.json (if any)
//        - calls detect(ctx); if it returns { skip: true } we move on
//        - calls apply(ctx); the step itself writes the receipt on success
//        - any throw halts the whole pipeline (no later steps run)
//
// Re-running picks up where it left off because each completed step has a
// receipt and detect() returns skip=true on receipt presence.

import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertValidStep } from './install-steps/_step-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// Test-only override. Defaults to scripts/install-steps relative to this file.
const stepsDir = process.env.STEPS_DIR || path.join(here, 'install-steps');

const target = process.argv[2];
if (!target) {
  console.error('Usage: orchestrate-install.mjs <target-path>');
  process.exit(1);
}

const targetAbs = path.resolve(target);
const ctx = {
  targetPath: targetAbs,
  projectName: path.basename(targetAbs),
  parent: path.dirname(targetAbs),
};

console.log(`▶ Bootstrapping at ${targetAbs}`);

// Discover steps
const stepFiles = (await fs.readdir(stepsDir))
  .filter((f) => /^\d{2}-[a-z][a-z0-9-]*\.mjs$/.test(f))
  .sort();

if (stepFiles.length === 0) {
  console.error(`No install steps found in ${stepsDir}`);
  process.exit(1);
}

const steps = [];
for (const f of stepFiles) {
  const mod = await import(pathToFileURL(path.join(stepsDir, f)).href);
  assertValidStep(mod, f);
  steps.push({ ...mod, _file: f });
}

// Validate requires
const seenIds = new Set();
for (const step of steps) {
  for (const req of step.requires ?? []) {
    if (!seenIds.has(req)) {
      console.error(
        `Step ${step.id} (${step._file}) requires "${req}" which hasn't run yet ` +
        `(missing or out of order).`
      );
      process.exit(1);
    }
  }
  seenIds.add(step.id);
}

// Run them in order
for (const step of steps) {
  console.log(`[${step.id}]`);
  const det = step.detect ? await step.detect(ctx) : { skip: false };
  if (det.skip) {
    console.log(`  skipped: ${det.reason || 'detect returned skip'}`);
    continue;
  }
  try {
    await step.apply(ctx);
  } catch (e) {
    console.error(`  ✗ ${step.id} failed: ${e.message}`);
    console.error(`  Re-run \`install.sh ${target}\` after fixing — completed steps will be skipped via their receipts.`);
    process.exit(1);
  }
}

console.log('');
console.log(`✓ Done. Next:`);
console.log(`  cd ${targetAbs}`);
console.log(`  npm run dev`);
