// Shared utilities for install steps.
//
// The state directory `<project>/.supertools-state/` holds one JSON receipt
// per step. Receipts are the source of truth for "what's already been done";
// the orchestrator skips any step with a successful receipt on re-runs.

import fs from 'node:fs/promises';
import path from 'node:path';

export const STATE_DIR = '.supertools-state';

export async function readReceipt(targetPath, stepId) {
  try {
    const text = await fs.readFile(
      path.join(targetPath, STATE_DIR, `${stepId}.json`),
      'utf-8'
    );
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function writeReceipt(targetPath, stepId, payload) {
  const dir = path.join(targetPath, STATE_DIR);
  await fs.mkdir(dir, { recursive: true });
  const receipt = {
    stepId,
    timestamp: new Date().toISOString(),
    ...payload,
  };
  await fs.writeFile(
    path.join(dir, `${stepId}.json`),
    JSON.stringify(receipt, null, 2) + '\n'
  );
  return receipt;
}

export async function fileExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

export async function listDir(p) {
  try { return await fs.readdir(p); } catch { return []; }
}

/**
 * Validate that an install step module has the required exports.
 * @throws if `mod` is malformed.
 */
export function assertValidStep(mod, fileName) {
  const errs = [];
  if (typeof mod.id !== 'string' || !mod.id) errs.push('missing string `id`');
  if (typeof mod.apply !== 'function') errs.push('missing `apply` function');
  if (mod.requires !== undefined && !Array.isArray(mod.requires)) errs.push('`requires` must be array');
  if (mod.provides !== undefined && !Array.isArray(mod.provides)) errs.push('`provides` must be array');
  if (mod.detect !== undefined && typeof mod.detect !== 'function') errs.push('`detect` must be function');
  if (errs.length) {
    throw new Error(`Step ${fileName} is malformed: ${errs.join('; ')}`);
  }
}
