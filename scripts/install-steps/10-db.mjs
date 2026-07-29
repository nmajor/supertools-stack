// 10-db — D1 binding + Drizzle ORM + Better Auth schema + cascade contract.
//
// What this step does:
//   1. Render customizations/10-db/ into the project (drizzle.config.ts,
//      src/db/{schema,index}.ts, tests/10-db/cascade-contract.test.ts).
//   2. Patch wrangler.jsonc to add a d1_databases binding for `<project>-db`.
//      The placeholder database_id is fine for local — wrangler's miniflare D1
//      doesn't validate it. The deploy step (later) replaces with a real ID.
//   3. Patch package.json: add drizzle-orm + better-auth deps, drizzle-kit
//      devDep, and db:generate / db:migrate:local / test:contract scripts.
//   4. npm install (pulls drizzle/better-auth into node_modules).
//   5. cf-typegen so D1Database becomes available on Env.DB.
//   6. db:generate to produce the initial migration SQL.
//
// What this step does NOT do (deferred to a future deploy concern):
//   - create a real D1 database in CF
//   - apply migrations to remote D1
//   - run wrangler deploy
//   - configure CF API tokens
//
// See HANDOFF.md "Stack scope (locked in)" and "Decisions already made about
// the next slices" for why these scope lines were drawn here.

import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runCmd } from '../_lib.mjs';
import { renderTree } from '../render.mjs';
import { readReceipt, writeReceipt, fileExists } from './_step-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const TEMPLATE_DIR = path.join(repoRoot, 'customizations', '10-db');

// Pinned versions. Bumping these is a refresh.mjs concern; the cascade
// contract test gates accidental breakage on update.
const DRIZZLE_ORM = '^0.45.2';
const DRIZZLE_KIT = '^0.31.10';
const VITEST      = '^4.1.5';
const BETTER_AUTH = '^1.6.9';

export const id = '10-db';
export const requires = ['00-scaffold'];
export const provides = ['d1-binding', 'drizzle-orm', 'better-auth-schema'];

export async function detect(ctx) {
  const receipt = await readReceipt(ctx.targetPath, id);
  if (receipt) return { skip: true, reason: 'receipt found' };
  return { skip: false };
}

export async function apply(ctx) {
  console.log('  Rendering customizations/10-db/ -> project...');
  await renderTree(TEMPLATE_DIR, ctx.targetPath, {
    PROJECT_NAME: ctx.projectName,
  });

  console.log('  Patching wrangler.jsonc (add d1_databases binding)...');
  await patchWranglerJsonc(ctx.targetPath, ctx.projectName);

  console.log('  Patching package.json (deps + scripts)...');
  await patchPackageJson(ctx.targetPath, ctx.projectName);

  console.log('  npm install (drizzle-orm, drizzle-kit, better-auth)...');
  await runCmd('npm', ['install'], { cwd: ctx.targetPath });

  console.log('  Regenerating worker-configuration.d.ts (cf-typegen)...');
  // Now that wrangler.jsonc has the d1_databases binding, regenerate the
  // ambient types so D1Database appears on Env.DB. Failures here are non-fatal
  // for local dev (wrangler types is cosmetic on top of bundled runtime types)
  // but we surface them so the user knows.
  try {
    await runCmd('npm', ['run', 'cf-typegen'], { cwd: ctx.targetPath });
  } catch (e) {
    console.warn(`  warning: cf-typegen failed (${e.message}); continuing.`);
  }

  console.log('  npm run db:generate (initial migration SQL)...');
  await runCmd('npm', ['run', 'db:generate'], { cwd: ctx.targetPath });

  await writeReceipt(ctx.targetPath, id, {
    version: '0.1',
    summary: 'D1 binding + Drizzle + Better Auth schema + cascade contract',
    pinned: {
      'drizzle-orm': DRIZZLE_ORM,
      'drizzle-kit': DRIZZLE_KIT,
      vitest: VITEST,
      'better-auth': BETTER_AUTH,
    },
    dbName: `${ctx.projectName}-db`,
  });
}

// ─── wrangler.jsonc patcher ────────────────────────────────────────────────
// Hand-rolled (no jsonc-parser dep). The C3 v2.68.1 wrangler.jsonc has the
// shape documented in customizations/SCAFFOLD-NOTES.md: tab-indented, last
// real property is `"upload_source_maps": true`, followed by several block
// comments before the closing `}`. We:
//   1. Read the file as text (preserve comments verbatim).
//   2. Locate the closing `}` on its own line (the top-level object's close).
//   3. Walk backwards to the last content line that is not a comment, blank,
//      or already-trailing-comma line. That's the last real property.
//   4. Append `,` to that line if missing.
//   5. Insert the d1_databases block right before the closing `}`.
//   6. Sanity-parse the result by stripping comments + parsing JSON. Throw a
//      clear error if invalid (this catches both bad source files and bugs in
//      the patcher itself).
async function patchWranglerJsonc(targetPath, projectName) {
  const file = path.join(targetPath, 'wrangler.jsonc');
  if (!(await fileExists(file))) {
    throw new Error(`wrangler.jsonc not found at ${file}`);
  }

  const original = await fs.readFile(file, 'utf-8');

  // Idempotency: if the file already has a d1_databases binding for our DB,
  // bail out cleanly (someone re-ran a partial step).
  if (/"d1_databases"\s*:/.test(original)) {
    // Verify it's our binding; otherwise we'd silently leave a foreign one.
    if (!original.includes(`"${projectName}-db"`)) {
      throw new Error(
        `wrangler.jsonc already has a d1_databases binding that doesn't ` +
        `reference ${projectName}-db; refusing to overwrite. Inspect manually.`,
      );
    }
    return;
  }

  const lines = original.split('\n');

  // Find the closing `}` line of the top-level object: the last line whose
  // trim() === '}' (the file may or may not end with a trailing newline).
  let closeIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() === '}') { closeIdx = i; break; }
  }
  if (closeIdx === -1) {
    throw new Error('wrangler.jsonc: could not find top-level closing `}`');
  }

  // Walk backwards from closeIdx-1 to find the last real property line.
  // "Real" = not blank, not a `// ...` line, not part of a `/* ... */` block.
  let propIdx = -1;
  let inBlockComment = false;
  for (let i = closeIdx - 1; i >= 0; i--) {
    const raw = lines[i];
    const trim = raw.trim();
    if (trim === '') continue;
    // We're scanning bottom-up. A block comment that ends below us starts
    // above us — track open/close in reverse: `*/` opens, `/*` closes (in
    // reverse-iteration semantics).
    if (/\*\/\s*$/.test(trim) && !/^\s*\/\*/.test(trim)) {
      inBlockComment = true;
      continue;
    }
    if (inBlockComment) {
      if (/^\s*\/\*/.test(trim)) inBlockComment = false;
      continue;
    }
    // single-line `/* ... */` on one line
    if (/^\s*\/\*.*\*\/\s*$/.test(trim)) continue;
    // single-line `// ...`
    if (trim.startsWith('//')) continue;
    propIdx = i;
    break;
  }
  if (propIdx === -1) {
    throw new Error('wrangler.jsonc: could not find a property line to anchor d1_databases insertion');
  }

  // Add a trailing comma to the last property if missing. JSONC tolerates
  // trailing commas, but the file is hand-edited so we keep it strict-JSON
  // friendly.
  if (!/,\s*$/.test(lines[propIdx])) {
    lines[propIdx] = lines[propIdx] + ',';
  }

  // Detect indent style of the close line's neighbors. The C3 scaffold uses
  // tab-indent (one tab per level). Match the prevailing indent of the line
  // we're anchoring against, falling back to a single tab.
  const indentMatch = lines[propIdx].match(/^([\t ]+)/);
  const indent = indentMatch ? indentMatch[1] : '\t';

  const block = [
    `${indent}"d1_databases": [`,
    `${indent}${indent}{`,
    `${indent}${indent}${indent}"binding": "DB",`,
    `${indent}${indent}${indent}"database_name": "${projectName}-db",`,
    `${indent}${indent}${indent}"database_id": "00000000-0000-0000-0000-000000000000",`,
    `${indent}${indent}${indent}"migrations_dir": "drizzle"`,
    `${indent}${indent}}`,
    `${indent}]`,
  ].join('\n');

  // Insert immediately before the closing `}` line.
  const patched = [
    ...lines.slice(0, closeIdx),
    block,
    ...lines.slice(closeIdx),
  ].join('\n');

  // Sanity-parse: strip comments + trailing commas, attempt JSON.parse.
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

// Strip JSONC comments and trailing commas to the smallest valid JSON. Naive
// (no string-aware tokenization) but the wrangler.jsonc shape is well-known
// — no string contains `//` or `/*` in this scaffold.
function stripJsoncToJson(text) {
  // remove block comments
  let out = text.replace(/\/\*[\s\S]*?\*\//g, '');
  // remove line comments
  out = out.replace(/^\s*\/\/.*$/gm, '');
  // remove trailing commas before `}` or `]`
  out = out.replace(/,(\s*[}\]])/g, '$1');
  return out;
}

// ─── package.json patcher ──────────────────────────────────────────────────
// Plain JSON — safe to read/parse/write.
async function patchPackageJson(targetPath, projectName) {
  const file = path.join(targetPath, 'package.json');
  const text = await fs.readFile(file, 'utf-8');
  const pkg = JSON.parse(text);

  pkg.dependencies = pkg.dependencies || {};
  pkg.devDependencies = pkg.devDependencies || {};
  pkg.scripts = pkg.scripts || {};

  pkg.dependencies['drizzle-orm'] = DRIZZLE_ORM;
  pkg.dependencies['better-auth'] = BETTER_AUTH;
  pkg.devDependencies['drizzle-kit'] = DRIZZLE_KIT;
  // This step ships vitest.contract.config.ts and a contract test, and 20-auth
  // ships vitest.auth.config.ts and a signup test — so the scaffold owns vitest
  // and must declare it. Without this every test target fails 'vitest: not
  // found', and `tsc --noEmit` fails TS2307 on the vitest module in both test
  // files, so a fresh scaffold cannot pass its own verifier.
  pkg.devDependencies['vitest'] = VITEST;

  pkg.scripts['db:generate'] = 'drizzle-kit generate';
  pkg.scripts['db:migrate:local'] =
    `wrangler d1 migrations apply --local ${projectName}-db`;
  pkg.scripts['test:contract'] =
    'vitest run --config vitest.contract.config.ts';
  // Point bare `npm test` at the contract suite. A plain `vitest run` breaks on
  // the Cloudflare vite plugin's resolve.external validation.
  pkg.scripts['test'] = 'npm run test:contract';

  await fs.writeFile(file, JSON.stringify(pkg, null, 2) + '\n');
}
