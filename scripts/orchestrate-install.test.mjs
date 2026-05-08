// orchestrate-install.test.mjs — tests for the install-step orchestrator and
// its receipt contract. Covers:
//   - assertValidStep validation rules (unit)
//   - readReceipt / writeReceipt round-trips (unit)
//   - end-to-end orchestrator runs against fixture step dirs (subprocess
//     integration, via the STEPS_DIR test-only env-var override)
//
// Uses Node's built-in test runner (`node --test`) so the template stays
// dep-free. Each test makes its own temp dir(s) and cleans up.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  assertValidStep,
  readReceipt,
  writeReceipt,
  STATE_DIR,
} from './install-steps/_step-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(here);
const orchestratorPath = path.join(repoRoot, 'scripts/orchestrate-install.mjs');
const stepLibPath = path.join(repoRoot, 'scripts/install-steps/_step-lib.mjs');
const stepLibUrl = pathToFileURL(stepLibPath).href;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function makeTempDir(label) {
  return await fs.mkdtemp(path.join(os.tmpdir(), `orchestrate-test-${label}-`));
}

async function cleanup(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}

async function withTempDirs(label, fn) {
  const stepsDir = await makeTempDir(`${label}-steps`);
  const targetDir = await makeTempDir(`${label}-target`);
  try {
    await fn({ stepsDir, targetDir });
  } finally {
    await cleanup(stepsDir);
    await cleanup(targetDir);
  }
}

function runOrchestrator({ stepsDir, target }) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [orchestratorPath, target],
      {
        env: { ...process.env, STEPS_DIR: stepsDir },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => { stdout += b.toString(); });
    child.stderr.on('data', (b) => { stderr += b.toString(); });
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
    child.on('error', reject);
  });
}

// Build a fixture step file. The fixture imports the real _step-lib via its
// absolute file URL so receipts and validation match production behaviour.
//
// `body` is JS that runs inside the apply() function and has access to:
//   ctx, fs, path, readReceipt, writeReceipt, id
//
// `requires` defaults to []. `extraTopLevel` lets a test add raw module-level
// code (e.g. to omit `apply` for malformed tests).
function fixtureStep({
  id,
  requires = [],
  applyBody = '',
  detectBody = null,
  omitApply = false,
}) {
  const requiresJson = JSON.stringify(requires);
  // Default detect: skip if receipt exists.
  const detectFn = detectBody === null
    ? `export async function detect(ctx) {
  const r = await readReceipt(ctx.targetPath, id);
  return { skip: !!r };
}`
    : `export async function detect(ctx) {\n${detectBody}\n}`;

  const applyFn = omitApply
    ? ''
    : `export async function apply(ctx) {
${applyBody}
}`;

  return `import fs from 'node:fs/promises';
import path from 'node:path';
import { readReceipt, writeReceipt } from ${JSON.stringify(stepLibUrl)};

export const id = ${JSON.stringify(id)};
export const requires = ${requiresJson};
export const provides = [];

${detectFn}

${applyFn}
`;
}

async function writeFixture(stepsDir, fileName, contents) {
  await fs.writeFile(path.join(stepsDir, fileName), contents);
}

// ---------------------------------------------------------------------------
// Unit — assertValidStep
// ---------------------------------------------------------------------------

test('assertValidStep throws with file name in message when id is missing', () => {
  assert.throws(
    () => assertValidStep({ apply: () => {} }, '00-x.mjs'),
    (err) => {
      assert.match(err.message, /00-x\.mjs/);
      assert.match(err.message, /id/);
      return true;
    }
  );
});

test('assertValidStep throws when id is non-string', () => {
  assert.throws(
    () => assertValidStep({ id: 42, apply: () => {} }, '00-x.mjs'),
    /id/
  );
});

test('assertValidStep throws when id is empty string', () => {
  assert.throws(
    () => assertValidStep({ id: '', apply: () => {} }, '00-x.mjs'),
    /id/
  );
});

test('assertValidStep throws when apply is missing', () => {
  assert.throws(
    () => assertValidStep({ id: 'x' }, '00-x.mjs'),
    /apply/
  );
});

test('assertValidStep throws when apply is not a function', () => {
  assert.throws(
    () => assertValidStep({ id: 'x', apply: 'nope' }, '00-x.mjs'),
    /apply/
  );
});

test('assertValidStep throws when requires is non-array', () => {
  assert.throws(
    () => assertValidStep({ id: 'x', apply: () => {}, requires: 'a,b' }, '00-x.mjs'),
    /requires/
  );
});

test('assertValidStep throws when provides is non-array', () => {
  assert.throws(
    () => assertValidStep({ id: 'x', apply: () => {}, provides: 'cap' }, '00-x.mjs'),
    /provides/
  );
});

test('assertValidStep throws when detect is not a function', () => {
  assert.throws(
    () => assertValidStep({ id: 'x', apply: () => {}, detect: {} }, '00-x.mjs'),
    /detect/
  );
});

test('assertValidStep returns silently for a minimally valid step', () => {
  assert.doesNotThrow(
    () => assertValidStep({ id: 'x', apply: () => {} }, '00-x.mjs')
  );
});

test('assertValidStep returns silently for a fully-populated valid step', () => {
  assert.doesNotThrow(
    () => assertValidStep({
      id: '00-x',
      requires: ['prev'],
      provides: ['cap'],
      detect: async () => ({ skip: false }),
      apply: async () => {},
    }, '00-x.mjs')
  );
});

// ---------------------------------------------------------------------------
// Unit — readReceipt / writeReceipt
// ---------------------------------------------------------------------------

test('readReceipt returns null when receipt file does not exist', async () => {
  const dir = await makeTempDir('readreceipt-missing');
  try {
    const r = await readReceipt(dir, '00-nope');
    assert.equal(r, null);
  } finally {
    await cleanup(dir);
  }
});

test('writeReceipt creates .supertools-state/ dir if missing', async () => {
  const dir = await makeTempDir('writereceipt-mkdir');
  try {
    // Sanity: the state dir should not exist beforehand
    await assert.rejects(() => fs.stat(path.join(dir, STATE_DIR)));
    await writeReceipt(dir, '00-foo', { ok: true });
    const stat = await fs.stat(path.join(dir, STATE_DIR));
    assert.ok(stat.isDirectory());
  } finally {
    await cleanup(dir);
  }
});

test('writeReceipt writes JSON with stepId, timestamp (ISO), and merged payload', async () => {
  const dir = await makeTempDir('writereceipt-shape');
  try {
    const before = Date.now();
    await writeReceipt(dir, '00-foo', { version: '0.1', summary: 'ok' });
    const after = Date.now();
    const text = await fs.readFile(
      path.join(dir, STATE_DIR, '00-foo.json'),
      'utf-8'
    );
    const parsed = JSON.parse(text);
    assert.equal(parsed.stepId, '00-foo');
    assert.equal(parsed.version, '0.1');
    assert.equal(parsed.summary, 'ok');
    assert.equal(typeof parsed.timestamp, 'string');
    // ISO 8601 format
    assert.match(parsed.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    const t = Date.parse(parsed.timestamp);
    assert.ok(!Number.isNaN(t), 'timestamp must parse');
    assert.ok(t >= before - 1 && t <= after + 1, 'timestamp within window');
  } finally {
    await cleanup(dir);
  }
});

test('readReceipt returns the parsed object after writeReceipt', async () => {
  const dir = await makeTempDir('roundtrip');
  try {
    await writeReceipt(dir, '00-foo', { foo: 'bar', n: 42 });
    const r = await readReceipt(dir, '00-foo');
    assert.equal(r.stepId, '00-foo');
    assert.equal(r.foo, 'bar');
    assert.equal(r.n, 42);
    assert.equal(typeof r.timestamp, 'string');
  } finally {
    await cleanup(dir);
  }
});

test('writeReceipt overwrites an existing receipt cleanly (stepId is unique key)', async () => {
  const dir = await makeTempDir('overwrite');
  try {
    await writeReceipt(dir, '00-foo', { gen: 1, leftover: 'old' });
    const first = await readReceipt(dir, '00-foo');
    assert.equal(first.gen, 1);
    assert.equal(first.leftover, 'old');
    await writeReceipt(dir, '00-foo', { gen: 2 });
    const second = await readReceipt(dir, '00-foo');
    assert.equal(second.gen, 2);
    // Old extra keys must not bleed through
    assert.equal(second.leftover, undefined);
    assert.equal(second.stepId, '00-foo');
  } finally {
    await cleanup(dir);
  }
});

// ---------------------------------------------------------------------------
// Integration — orchestrator end-to-end via subprocess + STEPS_DIR
// ---------------------------------------------------------------------------

test('orchestrator runs steps in numeric-prefix order', async () => {
  await withTempDirs('order', async ({ stepsDir, targetDir }) => {
    await writeFixture(stepsDir, '00-a.mjs', fixtureStep({
      id: '00-a',
      applyBody: `
  await fs.appendFile(path.join(ctx.targetPath, 'log.txt'), id + '\\n');
  await writeReceipt(ctx.targetPath, id, { ok: true });`,
    }));
    await writeFixture(stepsDir, '10-b.mjs', fixtureStep({
      id: '10-b',
      applyBody: `
  await fs.appendFile(path.join(ctx.targetPath, 'log.txt'), id + '\\n');
  await writeReceipt(ctx.targetPath, id, { ok: true });`,
    }));

    const { code, stderr } = await runOrchestrator({ stepsDir, target: targetDir });
    assert.equal(code, 0, `orchestrator failed: ${stderr}`);
    const log = await fs.readFile(path.join(targetDir, 'log.txt'), 'utf-8');
    assert.equal(log, '00-a\n10-b\n');
  });
});

test('orchestrator skips steps with existing receipts on re-run', async () => {
  await withTempDirs('skip', async ({ stepsDir, targetDir }) => {
    // Counter file; each apply increments it.
    await writeFixture(stepsDir, '00-a.mjs', fixtureStep({
      id: '00-a',
      applyBody: `
  let n = 0;
  try { n = parseInt(await fs.readFile(path.join(ctx.targetPath, 'counter-a.txt'), 'utf-8'), 10) || 0; } catch {}
  await fs.writeFile(path.join(ctx.targetPath, 'counter-a.txt'), String(n + 1));
  await writeReceipt(ctx.targetPath, id, { ok: true });`,
    }));
    await writeFixture(stepsDir, '10-b.mjs', fixtureStep({
      id: '10-b',
      applyBody: `
  let n = 0;
  try { n = parseInt(await fs.readFile(path.join(ctx.targetPath, 'counter-b.txt'), 'utf-8'), 10) || 0; } catch {}
  await fs.writeFile(path.join(ctx.targetPath, 'counter-b.txt'), String(n + 1));
  await writeReceipt(ctx.targetPath, id, { ok: true });`,
    }));

    const r1 = await runOrchestrator({ stepsDir, target: targetDir });
    assert.equal(r1.code, 0, `first run failed: ${r1.stderr}`);
    const r2 = await runOrchestrator({ stepsDir, target: targetDir });
    assert.equal(r2.code, 0, `second run failed: ${r2.stderr}`);

    const a = await fs.readFile(path.join(targetDir, 'counter-a.txt'), 'utf-8');
    const b = await fs.readFile(path.join(targetDir, 'counter-b.txt'), 'utf-8');
    assert.equal(a, '1', '00-a should run only once across two invocations');
    assert.equal(b, '1', '10-b should run only once across two invocations');
  });
});

test('orchestrator halts on failure: failed step has no receipt, later steps do not run', async () => {
  await withTempDirs('halt', async ({ stepsDir, targetDir }) => {
    await writeFixture(stepsDir, '00-ok.mjs', fixtureStep({
      id: '00-ok',
      applyBody: `
  await fs.writeFile(path.join(ctx.targetPath, 'ok-marker.txt'), 'ok');
  await writeReceipt(ctx.targetPath, id, { ok: true });`,
    }));
    await writeFixture(stepsDir, '10-bad.mjs', fixtureStep({
      id: '10-bad',
      applyBody: `  throw new Error('intentional failure');`,
    }));
    await writeFixture(stepsDir, '20-late.mjs', fixtureStep({
      id: '20-late',
      applyBody: `
  await fs.writeFile(path.join(ctx.targetPath, 'late-marker.txt'), 'late');
  await writeReceipt(ctx.targetPath, id, { ok: true });`,
    }));

    const { code, stderr } = await runOrchestrator({ stepsDir, target: targetDir });
    assert.notEqual(code, 0, 'orchestrator should exit non-zero on failure');
    assert.match(stderr, /10-bad/);

    // 00-ok ran and has receipt
    assert.equal(
      await fs.readFile(path.join(targetDir, 'ok-marker.txt'), 'utf-8'),
      'ok'
    );
    const okReceipt = await readReceipt(targetDir, '00-ok');
    assert.ok(okReceipt, '00-ok receipt should exist');

    // 10-bad has no receipt
    const badReceipt = await readReceipt(targetDir, '10-bad');
    assert.equal(badReceipt, null, '10-bad receipt must NOT exist');

    // 20-late did not run — no marker, no receipt
    await assert.rejects(
      () => fs.access(path.join(targetDir, 'late-marker.txt')),
      'late step must not have run'
    );
    const lateReceipt = await readReceipt(targetDir, '20-late');
    assert.equal(lateReceipt, null, '20-late receipt must NOT exist');
  });
});

test('orchestrator retries cleanly after fixing a failed step', async () => {
  await withTempDirs('retry', async ({ stepsDir, targetDir }) => {
    // 00-ok increments counter so we can confirm it does NOT run twice
    await writeFixture(stepsDir, '00-ok.mjs', fixtureStep({
      id: '00-ok',
      applyBody: `
  let n = 0;
  try { n = parseInt(await fs.readFile(path.join(ctx.targetPath, 'counter-ok.txt'), 'utf-8'), 10) || 0; } catch {}
  await fs.writeFile(path.join(ctx.targetPath, 'counter-ok.txt'), String(n + 1));
  await writeReceipt(ctx.targetPath, id, { ok: true });`,
    }));
    // 10-bad initially fails
    await writeFixture(stepsDir, '10-bad.mjs', fixtureStep({
      id: '10-bad',
      applyBody: `  throw new Error('boom');`,
    }));
    await writeFixture(stepsDir, '20-late.mjs', fixtureStep({
      id: '20-late',
      applyBody: `
  await fs.writeFile(path.join(ctx.targetPath, 'late-marker.txt'), 'late');
  await writeReceipt(ctx.targetPath, id, { ok: true });`,
    }));

    const r1 = await runOrchestrator({ stepsDir, target: targetDir });
    assert.notEqual(r1.code, 0);
    // 00-ok ran once
    assert.equal(
      await fs.readFile(path.join(targetDir, 'counter-ok.txt'), 'utf-8'),
      '1'
    );

    // Fix 10-bad
    await writeFixture(stepsDir, '10-bad.mjs', fixtureStep({
      id: '10-bad',
      applyBody: `
  await fs.writeFile(path.join(ctx.targetPath, 'bad-fixed.txt'), 'now-ok');
  await writeReceipt(ctx.targetPath, id, { ok: true });`,
    }));

    const r2 = await runOrchestrator({ stepsDir, target: targetDir });
    assert.equal(r2.code, 0, `retry failed: ${r2.stderr}`);

    // 00-ok counter still 1 (skipped via receipt)
    assert.equal(
      await fs.readFile(path.join(targetDir, 'counter-ok.txt'), 'utf-8'),
      '1',
      '00-ok should be skipped on retry'
    );
    // 10-bad now has receipt and side effect
    assert.equal(
      await fs.readFile(path.join(targetDir, 'bad-fixed.txt'), 'utf-8'),
      'now-ok'
    );
    assert.ok(await readReceipt(targetDir, '10-bad'), '10-bad receipt exists after retry');
    // 20-late finally ran
    assert.equal(
      await fs.readFile(path.join(targetDir, 'late-marker.txt'), 'utf-8'),
      'late'
    );
    assert.ok(await readReceipt(targetDir, '20-late'), '20-late receipt exists');
  });
});

test('orchestrator rejects forward-reference in `requires`', async () => {
  await withTempDirs('forward-req', async ({ stepsDir, targetDir }) => {
    // 00-a requires 10-b which comes later
    await writeFixture(stepsDir, '00-a.mjs', fixtureStep({
      id: '00-a',
      requires: ['10-b'],
      applyBody: `  await writeReceipt(ctx.targetPath, id, { ok: true });`,
    }));
    await writeFixture(stepsDir, '10-b.mjs', fixtureStep({
      id: '10-b',
      applyBody: `  await writeReceipt(ctx.targetPath, id, { ok: true });`,
    }));

    const { code, stderr } = await runOrchestrator({ stepsDir, target: targetDir });
    assert.notEqual(code, 0, 'should exit non-zero on forward reference');
    assert.match(stderr, /10-b/);
    assert.match(stderr, /requires|out of order|hasn't run/i);
  });
});

test('orchestrator rejects malformed step (missing apply); error mentions file name', async () => {
  await withTempDirs('malformed', async ({ stepsDir, targetDir }) => {
    // Build a step that imports nothing extra and omits apply
    const malformed = `export const id = '00-broken';
export const requires = [];
export const provides = [];
`;
    await writeFixture(stepsDir, '00-broken.mjs', malformed);

    const { code, stderr } = await runOrchestrator({ stepsDir, target: targetDir });
    assert.notEqual(code, 0, 'should exit non-zero on malformed step');
    assert.match(stderr, /00-broken\.mjs/);
    assert.match(stderr, /apply/);
  });
});

test('orchestrator errors out when no install steps are found', async () => {
  await withTempDirs('empty', async ({ stepsDir, targetDir }) => {
    // Empty stepsDir
    const { code, stderr } = await runOrchestrator({ stepsDir, target: targetDir });
    assert.notEqual(code, 0);
    assert.match(stderr, /No install steps found/);
  });
});
