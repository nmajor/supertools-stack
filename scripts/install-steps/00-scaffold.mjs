// 00-scaffold — runs `npm create cloudflare@latest --framework=tanstack-start`
// against the target directory.
//
// IMPORTANT (C3 v2.68.1, May 2026): do NOT pass --accept-defaults or
// --lang=ts. --accept-defaults silently overrides --framework, leading C3 to
// scaffold a generic Hello World Worker instead of TanStack Start. The
// framework dispatcher fills in lang/defaults itself via @tanstack/create-start.
//
// See customizations/SCAFFOLD-NOTES.md.

import fs from 'node:fs/promises';
import { runCmd } from '../_lib.mjs';
import { readReceipt, writeReceipt, listDir } from './_step-lib.mjs';

export const id = '00-scaffold';
export const requires = [];
export const provides = ['tanstack-start-app', 'wrangler-jsonc'];

export async function detect(ctx) {
  // Skip cleanly if our receipt is present.
  const receipt = await readReceipt(ctx.targetPath, id);
  if (receipt) return { skip: true, reason: 'receipt found' };

  // If the target directory exists with non-trivial content but no receipt,
  // refuse to overwrite — the user likely created it by hand or a previous
  // run was interrupted in a non-recoverable state.
  const entries = await listDir(ctx.targetPath);
  const meaningful = entries.filter((e) => !e.startsWith('.'));
  if (meaningful.length > 0) {
    throw new Error(
      `Target ${ctx.targetPath} already exists with content but has no ` +
      `${id} receipt. Either clear it, use a different target, or restore ` +
      `the .supertools-state/${id}.json from a previous successful run.`
    );
  }

  return { skip: false };
}

export async function apply(ctx) {
  console.log('  Running `npm create cloudflare@latest --framework=tanstack-start`...');
  await fs.mkdir(ctx.parent, { recursive: true });
  await runCmd(
    'npm',
    [
      'create', 'cloudflare@latest',
      '--', ctx.projectName,
      '--category=web-framework',
      '--framework=tanstack-start',
      '--no-deploy',
      '--no-git',
    ],
    { cwd: ctx.parent }
  );
  await writeReceipt(ctx.targetPath, id, {
    version: '0.1',
    summary: 'TanStack Start app scaffolded via @tanstack/create-start',
  });
}
