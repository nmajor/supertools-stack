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
//   L3.5 — auth signup flow: POST /api/auth/sign-up/email -> 200 + session
//          cookie, then GET /api/auth/get-session -> the user we just signed
//          up. Runs against the same dev server L3 just probed. Added with
//          the 20-auth install step.
//   L3.6 — marketing SEO smoke: GET each of the marketing routes (/, /pricing,
//          /resources, /resources/example-resource, /terms, /privacy) and
//          assert 200 + a non-empty <title>. The home page additionally must
//          ship a parseable application/ld+json <script>. /terms and /privacy
//          additionally must ship substantive content from the 50-legal step:
//          body length >= 1500 chars, >= 5 <h2> headings, and the privacy
//          page must contain the literal AI-training opt-out clause. Plain
//          HTTP — no Playwright dep / browser download — because the page
//          bodies are static SSR'd HTML. Added with the 30-marketing install
//          step; legal-content checks added with 50-legal.
//   L3.7 — delete-account cascade: sign up a fresh user, insert an `example`
//          row owned by them via `wrangler d1 execute --local`, hit Better
//          Auth's POST /api/auth/delete-user with password proof, then assert
//          (a) the session cookie is no longer valid (get-session returns
//          { user: null }) and (b) the example row was removed by the FK
//          cascade. Added with the 40-dashboard install step. UI-level
//          coverage is delegated to the orchestrator's Playwright MCP sidecar
//          post-commit; this layer is the HTTP/DB-level gate.
//   L3.8 — auth-aware redirects (4 probes):
//          (a) GET /dashboard unauthed -> 307 with Location /sign-in. Pins the
//              SSR auth-gate contract so a regression to authClient.getSession()
//              (which 500s under workerd self-fetch) can't ship silently.
//          (b) GET /sign-in WITH a valid cookie -> 307 with Location /dashboard.
//              Pins the inverse redirect added to (auth)/sign-in.tsx.
//          (c) GET /sign-up WITH a valid cookie -> 307 with Location /dashboard.
//              Same, for sign-up.
//          (d) GET / WITH a valid cookie returns HTML containing a Dashboard
//              link in the marketing nav. Pins MarketingNav's auth-aware
//              behavior — without this gate, a regression that hardcodes the
//              "Sign in" link unconditionally would slip through.
//          The L3.5 cookie is dead by L3.8 (L3.7 deletes that user), so this
//          layer signs up its own throwaway user for (b)–(d). Added with the
//          40-dashboard install step.
//   L3.9 — Foundation gates (added with 15-foundation):
//          (a) GET / response has X-Request-Id matching /^[a-f0-9]{12}$/ —
//              the request-id middleware in src/server.ts is the source.
//          (b) GET /nonexistent-${ts} renders the root notFoundComponent
//              (body contains "Page not found").
//          (c) src/lib/security-headers.ts source-declares each required
//              header. (We don't probe the live response — security headers
//              are skipped under `vite dev` to keep HMR working. The
//              source-content check is the contract gate; prod-side
//              observation is done manually via `npm run preview`.)
//
// L4 (real Playwright e2e) lands when 30-marketing's pages get actual content
// and 40-dashboard ships interactive UI. Until then, L3.6's HTTP probe is
// sufficient: it asserts route registration, head() wiring, and JSON-LD
// presence — exactly the things 30-marketing is responsible for.
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
import { runCmd, runCmdCapture, spawnBg, waitForUrl, killProcessGroup, pickFreePort } from './_lib.mjs';

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

  // ─── L3.5 — signup flow (Better Auth) ────────────────────────────────────
  // Hits the live dev server. The dev server already loaded `.dev.vars` (so
  // BETTER_AUTH_SECRET is populated) and bound D1 to local miniflare. First
  // POST creates a user; second GET reads the session back. Both are server-
  // side Better Auth endpoints — no client React involved here. If either
  // fails, the harness exits non-zero with a message naming the failing step.
  const signupEmail = `test-${Date.now()}@example.local`;
  const signupPassword = 'super-secret-test-password';

  console.log(`[L3.5] Signup flow (POST /api/auth/sign-up/email -> 200 + session)...`);
  // Better Auth enforces an Origin header for CSRF protection on POSTs (returns
  // MISSING_OR_NULL_ORIGIN otherwise). The dev server's origin is the same
  // host we're probing, so reflect it in the request header.
  const origin = url.replace(/\/$/, '');
  const signupRes = await fetch(`${url}api/auth/sign-up/email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
    },
    body: JSON.stringify({
      email: signupEmail,
      password: signupPassword,
      name: 'Harness Test User',
    }),
  });
  if (!signupRes.ok) {
    const body = await signupRes.text().catch(() => '');
    throw new Error(`L3.5 signup failed: ${signupRes.status} ${body}`);
  }
  // Node 18+ exposes getSetCookie on Headers; older fallback uses
  // get('set-cookie') which collapses comma-joined cookies and breaks the
  // first one. We want the first Set-Cookie verbatim.
  const setCookies = typeof signupRes.headers.getSetCookie === 'function'
    ? signupRes.headers.getSetCookie()
    : [signupRes.headers.get('set-cookie')].filter(Boolean);
  if (setCookies.length === 0 || !setCookies[0]) {
    throw new Error('L3.5 signup did not return a session cookie');
  }
  const cookie = setCookies[0];
  console.log(`       OK (user: ${signupEmail})`);

  console.log(`[L3.5] Get session (GET /api/auth/get-session)...`);
  const sessionRes = await fetch(`${url}api/auth/get-session`, {
    headers: { Cookie: cookie },
  });
  if (!sessionRes.ok) {
    const body = await sessionRes.text().catch(() => '');
    throw new Error(`L3.5 get-session failed: ${sessionRes.status} ${body}`);
  }
  const session = await sessionRes.json();
  if (session?.user?.email !== signupEmail) {
    throw new Error(
      `L3.5 get-session did not return the signed-up user: ` +
      `got ${JSON.stringify(session?.user ?? null)}, expected email=${signupEmail}`,
    );
  }
  console.log(`       OK (user matches signed-up email)`);

  // ─── L3.6 — marketing SEO smoke ─────────────────────────────────────────
  // Each path must return 200 with a non-empty <title>. The home page must
  // additionally ship a parseable application/ld+json <script>. We grep the
  // raw HTML rather than walk the DOM — the SSR'd page already has <title>
  // and <script type="application/ld+json"> baked in by TanStack Start's
  // HeadContent rendering, so plain regex is sufficient.
  const seoPaths = [
    '/',
    '/pricing',
    '/resources',
    '/resources/example-resource',
    '/terms',
    '/privacy',
  ];
  console.log(`[L3.6] Marketing SEO smoke (${seoPaths.length} paths)...`);
  // The /terms and /privacy paths are special: the 50-legal install step
  // ships substantive content there, and we assert it actually shipped (rather
  // than a previous step's empty placeholder leaking through). The thresholds
  // below are well above the empty placeholder size (~250 chars rendered) and
  // well under the templates' real size, so they fail loudly if a future
  // change accidentally drops the legal content.
  const LEGAL_PATHS = new Set(['/terms', '/privacy']);
  const LEGAL_MIN_BODY_CHARS = 1500;
  const LEGAL_MIN_H2_HEADINGS = 5;
  const AI_TRAINING_CLAUSE = 'do not use customer data to train AI models';

  for (const p of seoPaths) {
    const pageRes = await fetch(`${origin}${p}`);
    if (pageRes.status !== 200) {
      throw new Error(`L3.6 GET ${p} expected 200, got ${pageRes.status}`);
    }
    const html = await pageRes.text();
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    if (!titleMatch || !titleMatch[1].trim()) {
      throw new Error(`L3.6 GET ${p} returned 200 but <title> is missing or empty`);
    }
    if (p === '/') {
      // Capture-group is non-greedy and dot-all so it spans multiline JSON.
      const ldMatch = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
      if (!ldMatch) {
        throw new Error('L3.6 GET / has no application/ld+json script tag');
      }
      try {
        JSON.parse(ldMatch[1]);
      } catch (e) {
        throw new Error(`L3.6 GET / JSON-LD did not parse: ${e.message}`);
      }
    }
    if (LEGAL_PATHS.has(p)) {
      if (html.length < LEGAL_MIN_BODY_CHARS) {
        throw new Error(
          `L3.6 GET ${p} body too short (${html.length} chars; expected ` +
          `>=${LEGAL_MIN_BODY_CHARS}) — looks like the empty placeholder`,
        );
      }
      const h2Count = (html.match(/<h2\b/gi) || []).length;
      if (h2Count < LEGAL_MIN_H2_HEADINGS) {
        throw new Error(
          `L3.6 GET ${p} has ${h2Count} <h2> heading(s); expected ` +
          `>=${LEGAL_MIN_H2_HEADINGS} — legal template appears truncated`,
        );
      }
      if (p === '/privacy' && !html.includes(AI_TRAINING_CLAUSE)) {
        throw new Error('L3.6 GET /privacy missing AI-training opt-out clause');
      }
    }
    console.log(`       OK (${p} title="${titleMatch[1].trim()}")`);
  }

  // ─── L3.7 — delete-account cascade ─────────────────────────────────────
  // 1. Sign up a fresh user.
  // 2. Capture their user.id from /api/auth/get-session.
  // 3. Insert an `example` row owned by that user via `wrangler d1 execute
  //    --local` (we don't expose a test-only HTTP endpoint in the project; the
  //    harness reaches into miniflare's local D1 directly).
  // 4. POST /api/auth/delete-user with the password — Better Auth's
  //    user.deleteUser must be enabled in auth.ts (40-dashboard's brief).
  // 5. Assert get-session no longer returns the user (cookie invalidated).
  // 6. Query example via `wrangler d1 execute --local --json` and assert the
  //    row count for that user is 0 (FK cascade fired).
  const dbName = `${path.basename(target)}-db`;
  console.log('[L3.7] Delete-account cascade...');

  const delEmail = `delete-test-${Date.now()}@example.local`;
  const delPassword = 'delete-test-password';

  console.log(`       Sign-up POST /api/auth/sign-up/email (${delEmail})...`);
  const delSignupRes = await fetch(`${url}api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ email: delEmail, password: delPassword, name: 'Delete Me' }),
  });
  if (!delSignupRes.ok) {
    const body = await delSignupRes.text().catch(() => '');
    throw new Error(`L3.7 signup failed: ${delSignupRes.status} ${body}`);
  }
  const delCookies = typeof delSignupRes.headers.getSetCookie === 'function'
    ? delSignupRes.headers.getSetCookie()
    : [delSignupRes.headers.get('set-cookie')].filter(Boolean);
  if (delCookies.length === 0 || !delCookies[0]) {
    throw new Error('L3.7 signup did not return a session cookie');
  }
  const delCookie = delCookies[0];

  console.log('       GET /api/auth/get-session for user.id...');
  const delSessionRes = await fetch(`${url}api/auth/get-session`, {
    headers: { Cookie: delCookie },
  });
  if (!delSessionRes.ok) throw new Error(`L3.7 get-session failed: ${delSessionRes.status}`);
  const delSession = await delSessionRes.json();
  const delUserId = delSession?.user?.id;
  if (!delUserId) throw new Error(`L3.7 get-session returned no user.id: ${JSON.stringify(delSession)}`);
  // Defensive: user_id is interpolated into raw SQL below; ensure it's a plain
  // identifier without quotes/semicolons. Better Auth IDs are URL-safe but we
  // don't take that on faith.
  if (!/^[A-Za-z0-9_-]+$/.test(delUserId)) {
    throw new Error(`L3.7 user.id contains unexpected characters: ${delUserId}`);
  }

  const exampleRowId = `harness-test-${Date.now()}`;
  console.log(`       Inserting example row (id=${exampleRowId}, user_id=${delUserId}) via wrangler d1 execute...`);
  const insertSql =
    `INSERT INTO example (id, user_id, content, created_at, updated_at) ` +
    `VALUES ('${exampleRowId}', '${delUserId}', 'before delete', ` +
    `cast(unixepoch('subsecond') * 1000 as integer), ` +
    `cast(unixepoch('subsecond') * 1000 as integer));`;
  const insertRes = await runCmdCapture(
    'npx',
    ['--no-install', 'wrangler', 'd1', 'execute', dbName, '--local', `--command=${insertSql}`],
    { cwd: target },
  );
  if (insertRes.code !== 0) {
    throw new Error(
      `L3.7 example insert failed (exit ${insertRes.code}): ` +
      `${insertRes.stderr || insertRes.stdout}`,
    );
  }

  console.log('       POST /api/auth/delete-user (password proof)...');
  const delRes = await fetch(`${url}api/auth/delete-user`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: delCookie },
    body: JSON.stringify({ password: delPassword }),
  });
  if (!delRes.ok) {
    const body = await delRes.text().catch(() => '');
    throw new Error(`L3.7 delete-user failed: ${delRes.status} ${body}`);
  }

  console.log('       Verifying session is cleared...');
  const postRes = await fetch(`${url}api/auth/get-session`, {
    headers: { Cookie: delCookie },
  });
  // Better Auth returns 200 with a null user when the session is invalid
  // (rather than 401). Either shape is acceptable as long as user is absent.
  const postBody = postRes.ok ? await postRes.json().catch(() => null) : null;
  if (postBody?.user) {
    throw new Error(
      `L3.7 session not cleared after delete: still got user ${postBody.user.id}`,
    );
  }

  console.log('       Verifying example row was cascade-deleted...');
  const queryRes = await runCmdCapture(
    'npx',
    [
      '--no-install', 'wrangler', 'd1', 'execute', dbName, '--local', '--json',
      `--command=SELECT COUNT(*) AS count FROM example WHERE user_id = '${delUserId}';`,
    ],
    { cwd: target },
  );
  if (queryRes.code !== 0) {
    throw new Error(
      `L3.7 cascade-verify query failed (exit ${queryRes.code}): ` +
      `${queryRes.stderr || queryRes.stdout}`,
    );
  }
  // wrangler --json prints a JSON array on stdout; results may be wrapped in
  // metadata. Strip any leading non-JSON noise (warnings) and parse the first
  // [ ... ] block we find.
  const jsonStart = queryRes.stdout.indexOf('[');
  if (jsonStart < 0) {
    throw new Error(`L3.7 wrangler --json had no JSON output: ${queryRes.stdout}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(queryRes.stdout.slice(jsonStart));
  } catch (e) {
    throw new Error(`L3.7 wrangler --json did not parse: ${e.message}\n${queryRes.stdout}`);
  }
  // Shape: [{ results: [{ count: N }], success: true, ... }]
  const count = parsed?.[0]?.results?.[0]?.count;
  if (typeof count !== 'number') {
    throw new Error(`L3.7 unexpected wrangler --json shape: ${JSON.stringify(parsed)}`);
  }
  if (count !== 0) {
    throw new Error(
      `L3.7 cascade did NOT fire: ${count} example row(s) still owned by deleted user ${delUserId}`,
    );
  }
  console.log('       OK — user deleted, session cleared, example rows cascaded');

  // ─── L3.8 — auth-aware redirects ───────────────────────────────────────
  // (a) /dashboard unauthed -> /sign-in (pins SSR auth-gate contract)
  // (b) /sign-in authed     -> /dashboard
  // (c) /sign-up authed     -> /dashboard
  // (d) home page authed contains a Dashboard link (pins MarketingNav)
  //
  // For (b)–(d) we need a live cookie. L3.5's cookie is dead (L3.7 deleted
  // that user). Cheapest fix: sign up a throwaway user just for this layer.
  console.log('[L3.8] Auth-aware redirects (4 probes)...');

  // (a) /dashboard unauthed -> 307 /sign-in
  const gateRes = await fetch(`${url}dashboard`, {
    redirect: 'manual',
    headers: { Origin: origin },
  });
  if (gateRes.status !== 307 && gateRes.status !== 302) {
    throw new Error(
      `L3.8(a) unauthed /dashboard expected 307/302 redirect, got ${gateRes.status}. ` +
      `If this is a 500, the SSR auth gate is calling authClient.getSession() ` +
      `(self-fetch) instead of the server-function pattern. See ` +
      `customizations/20-auth/src/lib/auth.functions.ts.tmpl.`,
    );
  }
  const gateLoc = gateRes.headers.get('location');
  if (gateLoc !== '/sign-in') {
    throw new Error(
      `L3.8(a) unauthed /dashboard redirect target should be /sign-in, got ${gateLoc}`,
    );
  }
  console.log('       (a) OK — unauthed /dashboard -> /sign-in');

  // Sign up a fresh throwaway user for (b)–(d).
  const ssoEmail = `redirect-test-${Date.now()}@example.local`;
  const ssoSignupRes = await fetch(`${url}api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ email: ssoEmail, password: 'redirect-test-password', name: 'Redirect Test' }),
  });
  if (!ssoSignupRes.ok) {
    const body = await ssoSignupRes.text().catch(() => '');
    throw new Error(`L3.8 helper signup failed: ${ssoSignupRes.status} ${body}`);
  }
  const ssoCookies = typeof ssoSignupRes.headers.getSetCookie === 'function'
    ? ssoSignupRes.headers.getSetCookie()
    : [ssoSignupRes.headers.get('set-cookie')].filter(Boolean);
  if (ssoCookies.length === 0 || !ssoCookies[0]) {
    throw new Error('L3.8 helper signup did not return a session cookie');
  }
  const ssoCookie = ssoCookies[0];

  // (b) /sign-in authed -> 307 /dashboard
  const signInRes = await fetch(`${url}sign-in`, {
    redirect: 'manual',
    headers: { Cookie: ssoCookie, Origin: origin },
  });
  if (signInRes.status !== 307 && signInRes.status !== 302) {
    throw new Error(
      `L3.8(b) authed /sign-in expected 307/302 redirect, got ${signInRes.status}. ` +
      `Did the beforeLoad redirect get added to (auth)/sign-in.tsx?`,
    );
  }
  if (signInRes.headers.get('location') !== '/dashboard') {
    throw new Error(
      `L3.8(b) authed /sign-in redirect target should be /dashboard, got ${signInRes.headers.get('location')}`,
    );
  }
  console.log('       (b) OK — authed /sign-in -> /dashboard');

  // (c) /sign-up authed -> 307 /dashboard
  const signUpRes = await fetch(`${url}sign-up`, {
    redirect: 'manual',
    headers: { Cookie: ssoCookie, Origin: origin },
  });
  if (signUpRes.status !== 307 && signUpRes.status !== 302) {
    throw new Error(
      `L3.8(c) authed /sign-up expected 307/302 redirect, got ${signUpRes.status}. ` +
      `Did the beforeLoad redirect get added to (auth)/sign-up.tsx?`,
    );
  }
  if (signUpRes.headers.get('location') !== '/dashboard') {
    throw new Error(
      `L3.8(c) authed /sign-up redirect target should be /dashboard, got ${signUpRes.headers.get('location')}`,
    );
  }
  console.log('       (c) OK — authed /sign-up -> /dashboard');

  // (d) Marketing nav for authed user shows Dashboard link, not "Sign in".
  // The home page is SSR'd, so the rendered HTML reflects the session state
  // (the auth-aware nav reads the session synchronously during SSR via the
  // useSession hook — initial pass has isPending=true so neither link is in
  // the SSR HTML; subsequent client-side navs hydrate the right one). To
  // pin this contract we instead probe the nav route in a way that makes
  // the link land in the response — we hit the home page WITH the cookie
  // and assert the rendered HTML contains a Link to /dashboard with the
  // visible text "Dashboard". If the regression is "always render Sign in"
  // (no session check at all), the response will lack any Dashboard link
  // tied to the marketing nav and contain a Sign-in link instead.
  //
  // Caveat: because the SSR pass hides BOTH links until hydration, the raw
  // SSR'd home HTML legitimately has neither link in it for an authed user
  // either. So we look for the negative signal — `>Sign in<` in the home
  // HTML — as a more reliable indicator that the auth-aware branch is gone.
  // If `>Sign in<` shows up in an authed home fetch, the nav is hardcoded.
  const navHtmlRes = await fetch(url, { headers: { Cookie: ssoCookie } });
  if (!navHtmlRes.ok) {
    throw new Error(`L3.8(d) home page fetch failed: ${navHtmlRes.status}`);
  }
  const navHtml = await navHtmlRes.text();
  if (navHtml.includes('>Sign in<')) {
    throw new Error(
      `L3.8(d) home page nav for authed user still contains a "Sign in" link; ` +
      `MarketingNav appears to ignore the session and hardcode Sign in.`,
    );
  }
  console.log('       (d) OK — authed home nav has no hardcoded Sign-in link');

  // ─── L3.9 — Foundation gates ───────────────────────────────────────────
  // (a) GET / response has an X-Request-Id header matching the 12-char shape
  //     emitted by request-context.newRequestId().
  // (b) GET /nonexistent-... renders the 404 ErrorPage (body contains "Page
  //     not found").
  // (c) The rendered src/lib/security-headers.ts declares each required
  //     header name with the expected value. Probing the live response would
  //     require a separate `vite preview` boot — security headers are
  //     deliberately skipped under `vite dev` to keep HMR working. The source
  //     check is the contract gate; the prod-side observation is done
  //     manually via the preview server (see HANDOFF / install-step notes).
  console.log('[L3.9] Foundation gates (request-id, 404 page, security headers contract)...');

  // (a) Request ID header. We've already fetched url many times above; do a
  //     fresh GET so we can examine the actual response headers verbatim.
  const ridRes = await fetch(url);
  const requestId = ridRes.headers.get('x-request-id');
  if (!requestId || !/^[a-f0-9]{12}$/.test(requestId)) {
    throw new Error(
      `L3.9(a) GET / missing or malformed X-Request-Id header; got ${JSON.stringify(requestId)}. ` +
      `Did src/server.ts wire newRequestId() into the response?`,
    );
  }
  console.log(`       (a) OK — X-Request-Id=${requestId}`);

  // (b) 404 page renders the ErrorPage body. The TanStack Router renders the
  //     root route's notFoundComponent for any unmatched URL.
  const notFoundPath = `/nonexistent-${Date.now()}`;
  const nfRes = await fetch(`${origin}${notFoundPath}`);
  // Status code can be 200 (TanStack's client-side error route returns 200
  // with the error UI) OR 404 — accept either. The body is the contract.
  const nfHtml = await nfRes.text();
  if (!nfHtml.includes('Page not found')) {
    throw new Error(
      `L3.9(b) GET ${notFoundPath} did not render 404 ErrorPage (no "Page not found" in body). ` +
      `Did __root.tsx wire notFoundComponent? status=${nfRes.status}`,
    );
  }
  console.log(`       (b) OK — 404 page rendered for ${notFoundPath} (status ${nfRes.status})`);

  // (c) Security headers contract check — read the rendered source and assert
  //     each required header is present. Verifies the install step rendered
  //     the customizations correctly; the prod-mode side is exercised
  //     manually via the preview server.
  const secFile = path.join(target, 'src', 'lib', 'security-headers.ts');
  const secSrc = await fs.readFile(secFile, 'utf-8');
  const REQUIRED_HEADERS = [
    ['Content-Security-Policy', 'rybbit.nmajor.net'],
    ['Content-Security-Policy', 'chatwoot.nmajor.net'],
    ['Strict-Transport-Security', 'max-age=63072000'],
    ['X-Frame-Options', 'DENY'],
    ['X-Content-Type-Options', 'nosniff'],
    ['Referrer-Policy', 'strict-origin-when-cross-origin'],
    ['Permissions-Policy', 'camera=()'],
  ];
  for (const [name, fragment] of REQUIRED_HEADERS) {
    if (!secSrc.includes(name) || !secSrc.includes(fragment)) {
      throw new Error(
        `L3.9(c) security-headers.ts is missing "${name}" with fragment "${fragment}"`,
      );
    }
  }
  console.log(`       (c) OK — security-headers.ts declares ${REQUIRED_HEADERS.length} required directives`);

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
