#!/usr/bin/env node
//
// test.mjs — supertools-stack functional test harness.
//
// Renders an install into a tmp dir, typechecks, builds, boots vite dev, and
// probes http://127.0.0.1:3001/. Exit 0 = pass, non-zero = fail.
//
// Layers exercised:
//   L1   — install.sh completes (cloudflare scaffolder + customizations apply)
//   L2   — npm run build succeeds (production build; generates routeTree.gen.ts)
//   L2.5 — npx tsc --noEmit passes (must run AFTER build because the TanStack
//          router plugin generates routeTree.gen.ts during vite build)
//   L2.6 — db setup: drizzle-kit generate (initial migration runs in 10-db's
//          apply step, so this re-runs idempotently as a sanity check), then
//          `wrangler d1 migrations apply --local <db-name>` against miniflare's
//          local D1 (no API/network needed), then the cascade-contract vitest.
//          Added with the 10-db install step.
//   L3   — vite dev boots and responds at /
//
// L4 (Playwright e2e) lands in v0.2+ as the customizations layer fills in
// auth / pages.
//
// Note: TanStack Start's dev server is `vite dev` on port 3000, not
// `wrangler dev` on 8787. See customizations/SCAFFOLD-NOTES.md.
//
// ─── Scaffold cache (--reuse-scaffold) ─────────────────────────────────────
// The L1 scaffold step (`npm create cloudflare@latest --framework=tanstack-start`)
// dominates run time at ~3 minutes. For local iteration on later install
// steps, `--reuse-scaffold` caches the post-scaffold project tree under
// ${os.tmpdir()}/sts-scaffold-cache/<hash>/ and restores it on subsequent
// runs. The hash key is sha256 of `scripts/install-steps/00-scaffold.mjs`,
// so any change to the scaffold step invalidates automatically. CI/cron
// stays cold (default off) — this flag is opt-in, for the dev inner loop.

import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runCmd, spawnBg, waitForUrl, killProcessGroup, pickFreePort } from './_lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

// ─── Arg parsing ───────────────────────────────────────────────────────────

const HELP = `Usage: node scripts/test.mjs [flags]

Functional test harness for supertools-stack. Renders an install into a tmp
dir, builds, typechecks, boots vite dev, and probes http://127.0.0.1:<port>/.

Flags:
  --reuse-scaffold            Cache the C3 scaffold output under
                              \${TMPDIR}/sts-scaffold-cache/<hash>/ and reuse
                              it on subsequent runs. Cuts iteration time from
                              ~3 min to ~10s. Default off (cold scaffold).
                              Hash key is sha256 of 00-scaffold.mjs; cache
                              entries older than 7 days are treated as stale.
  --invalidate-scaffold-cache Delete the entire scaffold cache directory and
                              exit. Use after upgrading C3 manually or when
                              you suspect cache corruption.
  --cache-stats               Print cache directory size and per-hash ages,
                              then exit.
  -h, --help                  Show this help.
`;

const args = process.argv.slice(2);
const flags = {
  reuseScaffold: false,
  invalidate: false,
  cacheStats: false,
  help: false,
};
for (const a of args) {
  switch (a) {
    case '-h':
    case '--help': flags.help = true; break;
    case '--reuse-scaffold': flags.reuseScaffold = true; break;
    case '--invalidate-scaffold-cache': flags.invalidate = true; break;
    case '--cache-stats': flags.cacheStats = true; break;
    default:
      console.error(`Unknown flag: ${a}`);
      console.error(HELP);
      process.exit(2);
  }
}

if (flags.help) {
  process.stdout.write(HELP);
  process.exit(0);
}

// ─── Cache helpers ─────────────────────────────────────────────────────────

const CACHE_ROOT = path.join(os.tmpdir(), 'sts-scaffold-cache');
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days; bounds drift from upstream C3 releases.
const HARNESS_VERSION = '1';            // bump if cache layout / restore semantics change.

async function computeScaffoldHash() {
  const scaffoldFile = path.join(here, 'install-steps', '00-scaffold.mjs');
  const buf = await fs.readFile(scaffoldFile);
  const h = crypto.createHash('sha256');
  h.update(buf);
  h.update(`\nharness:${HARNESS_VERSION}`);
  return h.digest('hex').slice(0, 16);
}

function cachePathsFor(hash) {
  return {
    dir: path.join(CACHE_ROOT, hash),
    meta: path.join(CACHE_ROOT, `${hash}.meta.json`),
  };
}

async function readMeta(metaPath) {
  try {
    return JSON.parse(await fs.readFile(metaPath, 'utf-8'));
  } catch {
    return null;
  }
}

function relativeAge(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

async function purgeCacheAll() {
  await fs.rm(CACHE_ROOT, { recursive: true, force: true });
}

async function purgeCacheEntry(hash) {
  const { dir, meta } = cachePathsFor(hash);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.rm(meta, { force: true });
}

// npm creates absolute symlinks under node_modules/.bin/ pointing at the
// original install location. After we cache the project tree and restore it
// into a new tmp dir, those absolutes point at the (deleted) source dir — vite
// and friends become "command not found." Rewrite each absolute .bin symlink
// to its target-relative form before caching. Survives any future cp.
async function relativizeBinSymlinks(targetDir) {
  const binDir = path.join(targetDir, 'node_modules', '.bin');
  let entries;
  try { entries = await fs.readdir(binDir); } catch { return 0; }
  let rewritten = 0;
  for (const name of entries) {
    const linkPath = path.join(binDir, name);
    const st = await fs.lstat(linkPath);
    if (!st.isSymbolicLink()) continue;
    const oldTarget = await fs.readlink(linkPath);
    if (!path.isAbsolute(oldTarget)) continue;
    const newTarget = path.relative(binDir, oldTarget);
    await fs.unlink(linkPath);
    await fs.symlink(newTarget, linkPath);
    rewritten++;
  }
  return rewritten;
}

// ─── --invalidate-scaffold-cache ───────────────────────────────────────────
// Nuke everything (simpler to reason about than a per-hash purge — the cache
// is small enough that a full reseed costs at most one extra ~3 min run).

if (flags.invalidate) {
  await purgeCacheAll();
  console.log(`[cache] purged ${CACHE_ROOT}`);
  process.exit(0);
}

// ─── --cache-stats ─────────────────────────────────────────────────────────

if (flags.cacheStats) {
  let entries = [];
  try { entries = await fs.readdir(CACHE_ROOT); } catch {}
  if (entries.length === 0) {
    console.log(`[cache] empty (${CACHE_ROOT})`);
    process.exit(0);
  }
  console.log(`[cache] root: ${CACHE_ROOT}`);
  for (const name of entries) {
    if (!name.endsWith('.meta.json')) continue;
    const hash = name.replace(/\.meta\.json$/, '');
    const meta = await readMeta(path.join(CACHE_ROOT, name));
    if (!meta) continue;
    console.log(`  ${hash}  created ${relativeAge(meta.createdAt)}  (harness v${meta.harnessVersion})`);
  }
  process.exit(0);
}

// ─── Main run ──────────────────────────────────────────────────────────────

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
  // ─── L1 scaffold (with optional cache restore) ───────────────────────────
  let cacheHit = false;
  let cacheHash = null;
  let cacheDir = null;

  if (flags.reuseScaffold) {
    cacheHash = await computeScaffoldHash();
    const paths = cachePathsFor(cacheHash);
    cacheDir = paths.dir;
    const meta = await readMeta(paths.meta);
    const fresh = meta && (Date.now() - new Date(meta.createdAt).getTime() < TTL_MS);

    if (meta && !fresh) {
      console.log(`[cache STALE] entry ${cacheHash} is older than 7 days; purging and reseeding`);
      await purgeCacheEntry(cacheHash);
    } else if (meta && fresh) {
      // Verify the cache dir is actually present (meta could be orphaned).
      try { await fs.access(paths.dir); } catch {
        console.log(`[cache MISS] meta present but dir missing for ${cacheHash}; reseeding`);
        await purgeCacheEntry(cacheHash);
      }
    }

    const stillFresh = (await readMeta(paths.meta)) !== null;
    if (stillFresh) {
      console.log(`[cache HIT] hash=${cacheHash} restoring scaffold from ${paths.dir} (created ${relativeAge(meta.createdAt)})`);
      await fs.mkdir(target, { recursive: true });
      // verbatimSymlinks: copy symlinks byte-for-byte. Without it, fs.cp
      // resolves relative symlinks against the source path and writes them
      // back as absolutes — which would point into the cache dir instead of
      // the new target's node_modules.
      await fs.cp(paths.dir, target, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });
      // The cache was seeded after a full install run, so it carries receipts
      // for every install step that existed at seed time. Wipe all receipts
      // except 00-scaffold's so the orchestrator re-applies later steps with
      // whatever's in customizations/ and scripts/install-steps/ today.
      // Without this, edits to e.g. 10-db.mjs's templates wouldn't propagate
      // to warm runs (subsequent steps would silently skip on the stale
      // receipt). 00-scaffold's receipt is preserved because it's the only
      // step the cache actually represents.
      const stateDir = path.join(target, '.supertools-state');
      let cleared = 0;
      for (const f of (await fs.readdir(stateDir).catch(() => []))) {
        if (f === '00-scaffold.json') continue;
        await fs.rm(path.join(stateDir, f), { force: true });
        cleared++;
      }
      if (cleared) console.log(`[cache HIT] cleared ${cleared} downstream receipt(s); orchestrator will re-apply those steps`);
      cacheHit = true;
    } else {
      console.log(`[cache MISS] hash=${cacheHash} no fresh entry; will scaffold cold and seed cache at ${paths.dir}`);
    }
  }

  console.log(`[L1] Running install.sh against ${target}...`);
  // On cache HIT: install.sh is still invoked, but 00-scaffold's detect()
  // returns skip=true because the receipt was restored from cache. Future
  // steps run normally. On cache MISS: full cold scaffold as before.
  await runCmd('bash', [path.join(repoRoot, 'install.sh'), target, '--no-refresh']);

  if (flags.reuseScaffold && !cacheHit) {
    // Seed the cache. Write to a tmp dir then atomically rename so that two
    // concurrent test runs racing on the same hash can't half-write each
    // other's cache. If the rename fails (someone beat us to it), discard.
    const rewritten = await relativizeBinSymlinks(target);
    if (rewritten) console.log(`[cache] relativized ${rewritten} absolute .bin symlinks before seed`);
    const tmpCacheDir = `${cacheDir}.tmp.${process.pid}`;
    const { meta: metaPath } = cachePathsFor(cacheHash);
    await fs.mkdir(CACHE_ROOT, { recursive: true });
    await fs.cp(target, tmpCacheDir, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });
    try {
      await fs.rename(tmpCacheDir, cacheDir);
      const metaPayload = {
        hash: cacheHash,
        createdAt: new Date().toISOString(),
        harnessVersion: HARNESS_VERSION,
      };
      await fs.writeFile(metaPath, JSON.stringify(metaPayload, null, 2) + '\n');
      console.log(`[cache MISS] scaffold cached at ${cacheDir} for next run`);
    } catch (e) {
      // Another run beat us, or the dir already exists — drop our temp.
      await fs.rm(tmpCacheDir, { recursive: true, force: true }).catch(() => {});
      console.log(`[cache MISS] another run seeded the cache first; discarded temp (${e.code || e.message})`);
    }
  }

  console.log('[L2] Production build (npm run build)...');
  await runCmd('npm', ['run', 'build'], { cwd: target });

  console.log('[L2.5] Typecheck (npx tsc --noEmit)...');
  await runCmd('npx', ['--no-install', 'tsc', '--noEmit'], { cwd: target });

  // L2.6 — db setup. 10-db.mjs's apply() already ran db:generate; this re-runs
  // it (idempotent — drizzle-kit no-ops when the schema hasn't changed) and
  // then applies migrations to miniflare's local D1. The cascade-contract
  // vitest is the gate that protects the data-deletion safety net.
  console.log('[L2.6] db:generate (re-run; idempotent)...');
  await runCmd('npm', ['run', 'db:generate'], { cwd: target });

  console.log('[L2.6] Apply migrations to local D1 (miniflare)...');
  await runCmd('npm', ['run', 'db:migrate:local'], { cwd: target });

  console.log('[L2.6] Cascade-contract test (vitest)...');
  await runCmd('npm', ['run', 'test:contract'], { cwd: target });

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
