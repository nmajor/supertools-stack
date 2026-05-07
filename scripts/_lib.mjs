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

export function spawnBg(cmd, args, opts = {}) {
  return spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

export async function waitForUrl(url, timeoutMs = 60_000, intervalMs = 500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (r.status >= 200 && r.status < 600) return r;
    } catch {
      // ignore — keep polling
    }
    await new Promise((res) => setTimeout(res, intervalMs));
  }
  throw new Error(`Timed out waiting for ${url}`);
}
