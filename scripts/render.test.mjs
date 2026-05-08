// render.test.mjs — unit tests for scripts/render.mjs
//
// Uses Node's built-in test runner (`node --test`) so the template stays
// dep-free. Each test creates and cleans up its own temp dir.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { renderTemplate, renderTree } from './render.mjs';

async function makeTempDir(label) {
  return await fs.mkdtemp(path.join(os.tmpdir(), `render-test-${label}-`));
}

async function cleanup(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}

async function withTempDir(label, fn) {
  const dir = await makeTempDir(label);
  try {
    await fn(dir);
  } finally {
    await cleanup(dir);
  }
}

// ---------------------------------------------------------------------------
// renderTemplate
// ---------------------------------------------------------------------------

test('renderTemplate substitutes a single {{KEY}} occurrence', async () => {
  await withTempDir('single-key', async (dir) => {
    const src = path.join(dir, 'in.tmpl');
    const dest = path.join(dir, 'out.txt');
    await fs.writeFile(src, 'hello {{NAME}}');
    await renderTemplate(src, dest, { NAME: 'world' });
    const out = await fs.readFile(dest, 'utf-8');
    assert.equal(out, 'hello world');
  });
});

test('renderTemplate substitutes multiple distinct keys in one file', async () => {
  await withTempDir('multi-key', async (dir) => {
    const src = path.join(dir, 'in.tmpl');
    const dest = path.join(dir, 'out.txt');
    await fs.writeFile(src, '{{GREETING}}, {{NAME}}!');
    await renderTemplate(src, dest, { GREETING: 'Hello', NAME: 'Ada' });
    const out = await fs.readFile(dest, 'utf-8');
    assert.equal(out, 'Hello, Ada!');
  });
});

test('renderTemplate substitutes repeated occurrences of the same key (replaceAll)', async () => {
  await withTempDir('repeated-key', async (dir) => {
    const src = path.join(dir, 'in.tmpl');
    const dest = path.join(dir, 'out.txt');
    await fs.writeFile(src, '{{X}} and {{X}} and {{X}}');
    await renderTemplate(src, dest, { X: 'foo' });
    const out = await fs.readFile(dest, 'utf-8');
    assert.equal(out, 'foo and foo and foo');
  });
});

test('renderTemplate throws when a placeholder has no value; error names the key(s)', async () => {
  await withTempDir('missing-key', async (dir) => {
    const src = path.join(dir, 'in.tmpl');
    const dest = path.join(dir, 'out.txt');
    await fs.writeFile(src, 'hi {{MISSING}} and {{ALSO_MISSING}} and {{MISSING}}');
    await assert.rejects(
      () => renderTemplate(src, dest, { OTHER: 'value' }),
      (err) => {
        assert.ok(err instanceof Error, 'should throw an Error');
        assert.match(err.message, /Unsubstituted placeholders/);
        assert.match(err.message, /MISSING/);
        assert.match(err.message, /ALSO_MISSING/);
        // dedup: MISSING should appear only once even though it occurs twice
        const matches = err.message.match(/MISSING/g) || [];
        // "MISSING" matches both MISSING and ALSO_MISSING substrings; check
        // the exact comma-separated list rather than a raw count.
        assert.match(err.message, /MISSING, ALSO_MISSING|ALSO_MISSING, MISSING/);
        return true;
      }
    );
    // dest must not exist on failure
    await assert.rejects(() => fs.access(dest));
  });
});

test('renderTemplate is a no-op (other than copy) when the file has no placeholders', async () => {
  await withTempDir('no-placeholders', async (dir) => {
    const src = path.join(dir, 'in.tmpl');
    const dest = path.join(dir, 'out.txt');
    const content = 'plain text\nwith newlines\nand no braces';
    await fs.writeFile(src, content);
    await renderTemplate(src, dest, { UNUSED: 'x' });
    const out = await fs.readFile(dest, 'utf-8');
    assert.equal(out, content);
  });
});

test('renderTemplate creates parent directories for the destination if missing', async () => {
  await withTempDir('mkdir-dest', async (dir) => {
    const src = path.join(dir, 'in.tmpl');
    const dest = path.join(dir, 'a', 'b', 'c', 'out.txt');
    await fs.writeFile(src, 'value={{V}}');
    await renderTemplate(src, dest, { V: '42' });
    const out = await fs.readFile(dest, 'utf-8');
    assert.equal(out, 'value=42');
  });
});

test('renderTemplate does NOT recursively substitute (single-pass)', async () => {
  // Current behavior: substitution loops through Object.entries once each,
  // so a value containing `{{B}}` is NOT re-expanded if B was already
  // processed. To prove single-pass, we order vars so B runs first; then
  // A=`{{B}}` injects a literal `{{B}}` that no later pass touches.
  //
  // CAVEAT: the leftover-placeholder check at the end of renderTemplate
  // then sees the freshly-injected `{{B}}` and throws "Unsubstituted
  // placeholders ... B". So in practice substituting a value that contains
  // `{{...}}` syntax is rejected by the validator rather than written
  // through. We pin that behavior here. See test report for details.
  await withTempDir('no-recursion', async (dir) => {
    const src = path.join(dir, 'in.tmpl');
    const dest = path.join(dir, 'out.txt');
    await fs.writeFile(src, '{{A}}');
    await assert.rejects(
      () => renderTemplate(src, dest, { B: 'x', A: '{{B}}' }),
      (err) => {
        assert.match(err.message, /Unsubstituted placeholders/);
        assert.match(err.message, /\bB\b/);
        return true;
      },
      'expected the leftover-placeholder check to reject the injected {{B}}'
    );
    // Dest must not have been written.
    await assert.rejects(() => fs.access(dest));
  });
});

// ---------------------------------------------------------------------------
// renderTree
// ---------------------------------------------------------------------------

test('renderTree copies non-.tmpl files verbatim (no substitution applied)', async () => {
  await withTempDir('tree-verbatim', async (dir) => {
    const srcDir = path.join(dir, 'src');
    const destDir = path.join(dir, 'dest');
    await fs.mkdir(srcDir, { recursive: true });
    // Includes {{X}} which would fail substitution if it were processed
    const verbatimContent = 'literal {{X}} {{NOT_REPLACED}}';
    await fs.writeFile(path.join(srcDir, 'plain.txt'), verbatimContent);
    await renderTree(srcDir, destDir, { X: 'should-not-apply' });
    const out = await fs.readFile(path.join(destDir, 'plain.txt'), 'utf-8');
    assert.equal(out, verbatimContent);
  });
});

test('renderTree renders .tmpl files and strips the .tmpl suffix on output', async () => {
  await withTempDir('tree-tmpl-suffix', async (dir) => {
    const srcDir = path.join(dir, 'src');
    const destDir = path.join(dir, 'dest');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, 'config.json.tmpl'), '{"name":"{{NAME}}"}');
    await renderTree(srcDir, destDir, { NAME: 'app' });
    // Suffix stripped
    const out = await fs.readFile(path.join(destDir, 'config.json'), 'utf-8');
    assert.equal(out, '{"name":"app"}');
    // .tmpl version should NOT exist at dest
    await assert.rejects(() => fs.access(path.join(destDir, 'config.json.tmpl')));
  });
});

test('renderTree recurses into nested subdirectories', async () => {
  await withTempDir('tree-recurse', async (dir) => {
    const srcDir = path.join(dir, 'src');
    const destDir = path.join(dir, 'dest');
    await fs.mkdir(path.join(srcDir, 'a', 'b', 'c'), { recursive: true });
    await fs.writeFile(path.join(srcDir, 'top.tmpl'), 'top={{V}}');
    await fs.writeFile(path.join(srcDir, 'a', 'mid.tmpl'), 'mid={{V}}');
    await fs.writeFile(path.join(srcDir, 'a', 'b', 'c', 'deep.tmpl'), 'deep={{V}}');
    await renderTree(srcDir, destDir, { V: 'ok' });
    assert.equal(await fs.readFile(path.join(destDir, 'top'), 'utf-8'), 'top=ok');
    assert.equal(await fs.readFile(path.join(destDir, 'a', 'mid'), 'utf-8'), 'mid=ok');
    assert.equal(
      await fs.readFile(path.join(destDir, 'a', 'b', 'c', 'deep'), 'utf-8'),
      'deep=ok'
    );
  });
});

test('renderTree preserves directory structure in the destination', async () => {
  await withTempDir('tree-structure', async (dir) => {
    const srcDir = path.join(dir, 'src');
    const destDir = path.join(dir, 'dest');
    await fs.mkdir(path.join(srcDir, 'pkg', 'sub'), { recursive: true });
    await fs.writeFile(path.join(srcDir, 'pkg', 'a.txt'), 'A');
    await fs.writeFile(path.join(srcDir, 'pkg', 'sub', 'b.txt'), 'B');
    await fs.writeFile(path.join(srcDir, 'pkg', 'sub', 'c.txt.tmpl'), 'C={{V}}');
    await renderTree(srcDir, destDir, { V: '1' });
    const aStat = await fs.stat(path.join(destDir, 'pkg', 'a.txt'));
    const bStat = await fs.stat(path.join(destDir, 'pkg', 'sub', 'b.txt'));
    const cStat = await fs.stat(path.join(destDir, 'pkg', 'sub', 'c.txt'));
    assert.ok(aStat.isFile());
    assert.ok(bStat.isFile());
    assert.ok(cStat.isFile());
    assert.equal(await fs.readFile(path.join(destDir, 'pkg', 'a.txt'), 'utf-8'), 'A');
    assert.equal(await fs.readFile(path.join(destDir, 'pkg', 'sub', 'b.txt'), 'utf-8'), 'B');
    assert.equal(await fs.readFile(path.join(destDir, 'pkg', 'sub', 'c.txt'), 'utf-8'), 'C=1');
  });
});

test('renderTree handles a directory containing only non-.tmpl files', async () => {
  await withTempDir('tree-only-plain', async (dir) => {
    const srcDir = path.join(dir, 'src');
    const destDir = path.join(dir, 'dest');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, 'one.txt'), 'one');
    await fs.writeFile(path.join(srcDir, 'two.md'), 'two');
    await renderTree(srcDir, destDir, {});
    assert.equal(await fs.readFile(path.join(destDir, 'one.txt'), 'utf-8'), 'one');
    assert.equal(await fs.readFile(path.join(destDir, 'two.md'), 'utf-8'), 'two');
  });
});

test('renderTree rejects when a .tmpl file has unsubstituted placeholders', async () => {
  await withTempDir('tree-unsubstituted', async (dir) => {
    const srcDir = path.join(dir, 'src');
    const destDir = path.join(dir, 'dest');
    await fs.mkdir(path.join(srcDir, 'nested'), { recursive: true });
    await fs.writeFile(path.join(srcDir, 'ok.tmpl'), 'hello {{NAME}}');
    await fs.writeFile(path.join(srcDir, 'nested', 'bad.tmpl'), 'oops {{MISSING_KEY}}');
    await assert.rejects(
      () => renderTree(srcDir, destDir, { NAME: 'world' }),
      (err) => {
        assert.match(err.message, /Unsubstituted placeholders/);
        assert.match(err.message, /MISSING_KEY/);
        return true;
      }
    );
  });
});

// Pins current behavior: empty source dir leaves destDir uncreated (mkdir lives in the verbatim-copy branch).
test('renderTree with an empty source directory does not create the destination directory', async () => {
  await withTempDir('tree-empty-src', async (dir) => {
    const srcDir = path.join(dir, 'src');
    const destDir = path.join(dir, 'dest');
    await fs.mkdir(srcDir, { recursive: true });
    await renderTree(srcDir, destDir, {});
    await assert.rejects(
      () => fs.stat(destDir),
      (err) => {
        assert.equal(err.code, 'ENOENT');
        return true;
      }
    );
  });
});

// Pins current behavior: insertion-order iteration means a value containing {{KEY}} is re-expanded if KEY runs later.
test('renderTemplate re-expands a value containing {{KEY}} when that key is processed after', async () => {
  await withTempDir('iteration-order', async (dir) => {
    const src = path.join(dir, 'in.tmpl');
    const dest = path.join(dir, 'out.txt');
    await fs.writeFile(src, '{{A}}');
    // A is inserted first, so A's value `{{B}}` gets re-expanded by the later B substitution.
    await renderTemplate(src, dest, { A: '{{B}}', B: 'x' });
    const out = await fs.readFile(dest, 'utf-8');
    assert.equal(out, 'x');
  });
});
