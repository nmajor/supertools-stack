#!/usr/bin/env node
//
// render.mjs — placeholder substitution helper for customizations.
//
// Replaces {{KEY}} occurrences with the supplied values, then asserts every
// {{KEY}} got a value (fail-fast on typos).

import fs from 'node:fs/promises';
import path from 'node:path';

const PLACEHOLDER_RE = /\{\{([A-Z_][A-Z0-9_]*)\}\}/g;

export async function renderTemplate(srcPath, destPath, vars) {
  let text = await fs.readFile(srcPath, 'utf-8');
  for (const [k, v] of Object.entries(vars)) {
    text = text.replaceAll(`{{${k}}}`, v);
  }
  const leftovers = [...text.matchAll(PLACEHOLDER_RE)].map((m) => m[1]);
  if (leftovers.length) {
    throw new Error(
      `Unsubstituted placeholders in ${srcPath}: ${[...new Set(leftovers)].join(', ')}`
    );
  }
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.writeFile(destPath, text);
}

export async function renderTree(srcDir, destDir, vars) {
  for (const entry of await fs.readdir(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    if (entry.isDirectory()) {
      await renderTree(src, path.join(destDir, entry.name), vars);
      continue;
    }
    if (entry.name.endsWith('.tmpl')) {
      const dest = path.join(destDir, entry.name.slice(0, -'.tmpl'.length));
      await renderTemplate(src, dest, vars);
    } else {
      // copy verbatim
      await fs.mkdir(destDir, { recursive: true });
      await fs.copyFile(src, path.join(destDir, entry.name));
    }
  }
}

// Allow CLI invocation: `render.mjs <src> <dest> [KEY=val ...]`
if (import.meta.url === `file://${process.argv[1]}`) {
  const [src, dest, ...rest] = process.argv.slice(2);
  if (!src || !dest) {
    console.error('Usage: render.mjs <src> <dest> [KEY=val ...]');
    process.exit(1);
  }
  const vars = Object.fromEntries(rest.map((p) => p.split('=', 2)));
  const stat = await fs.stat(src);
  if (stat.isDirectory()) {
    await renderTree(src, dest, vars);
  } else {
    await renderTemplate(src, dest, vars);
  }
}
