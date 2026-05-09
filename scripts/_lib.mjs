// Shared utilities for supertools-stack scripts.

import { spawn } from 'node:child_process';

export function runCmd(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', ...opts });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

/**
 * Like runCmd but captures stdout/stderr instead of inheriting. Resolves with
 * { stdout, stderr, code }. Rejects only on spawn error — a non-zero exit code
 * is returned to the caller so it can decide how to react (the harness uses
 * this to parse `wrangler d1 execute --json` output even when wrangler emits
 * warnings on stderr that wouldn't trip a non-zero exit).
 */
export function runCmdCapture(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => { stdout += b.toString(); });
    child.stderr.on('data', (b) => { stderr += b.toString(); });
    child.on('error', reject);
    child.on('exit', (code) => resolve({ stdout, stderr, code }));
  });
}

/**
 * Spawn a background process in its own process group so we can cleanly tear
 * down the whole tree on exit. Without `detached: true`, vite/wrangler's
 * grandchildren survive a kill aimed at the immediate child and end up
 * squatting ports across test runs.
 *
 * Use `killProcessGroup()` (not child.kill()) to terminate.
 */
export function spawnBg(cmd, args, opts = {}) {
  return spawn(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    ...opts,
  });
}

/**
 * Kill a process and every descendant by signalling the process group.
 * Sends SIGTERM, then SIGKILL after `graceMs` if anything's still alive.
 */
export async function killProcessGroup(child, graceMs = 2000) {
  if (!child || !child.pid || child.exitCode !== null) return;
  try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  await new Promise((r) => setTimeout(r, graceMs));
  try { process.kill(-child.pid, 'SIGKILL'); } catch {}
}

/**
 * Pick a free TCP port by binding to :0 and releasing.
 */
export async function pickFreePort() {
  const { createServer } = await import('node:net');
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Poll a URL until it returns a status in `expectStatuses` (default 2xx) or
 * the timeout elapses. Returns the matching response.
 *
 * The vite dev server in TanStack Start lazily compiles routes — the first
 * request can return 404 while the route tree warms up. waitForUrl ignores
 * those transient responses by default and only resolves on a real 2xx.
 */
export async function waitForUrl(url, opts = {}) {
  const {
    timeoutMs = 60_000,
    intervalMs = 500,
    expectStatuses = (s) => s >= 200 && s < 300,
  } = opts;
  const start = Date.now();
  let lastStatus = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
      lastStatus = r.status;
      if (expectStatuses(r.status)) return r;
    } catch {
      // ignore — keep polling
    }
    await new Promise((res) => setTimeout(res, intervalMs));
  }
  throw new Error(`Timed out waiting for ${url} (last status: ${lastStatus})`);
}
