#!/usr/bin/env node
//
// setup-turnstile.mjs — one-time helper to provision a Cloudflare Turnstile
// widget for local-dev / harness use, then append the keys to this repo's
// top-level `.env` (gitignored).
//
// Per-project Turnstile widgets for production deploys are out of scope here;
// that work lives in supertools-design's deploy concern. This script exists
// so the supertools-stack test loop (and Nick's manual flow) can verify
// Turnstile-on-sign-up end-to-end against the real CF API without baking
// shared credentials into the repo.
//
// Idempotency: if TURNSTILE_SITE_KEY is already in .env we no-op. If you want
// to rotate the secret, run with --rotate (calls the CF rotate_secret API and
// rewrites the .env line in place).
//
// What this does NOT do:
//   - Set the keys on a target project's .dev.vars. That's the harness's job
//     (scripts/test.mjs reads from THIS repo's .env at start, writes to the
//     test project's .dev.vars before booting vite dev).
//   - Configure the widget for production domains. Use a separate widget per
//     environment; this one is locked to localhost / 127.0.0.1.
//
// Usage:
//   node scripts/setup-turnstile.mjs           # idempotent: create if missing
//   node scripts/setup-turnstile.mjs --rotate  # rotate the secret on the existing widget

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const envFile = path.join(repoRoot, '.env');

const WIDGET_NAME = 'supertools-stack-test';
const DOMAINS = ['localhost', '127.0.0.1'];

const args = new Set(process.argv.slice(2));
const rotate = args.has('--rotate');

const envText = await fs.readFile(envFile, 'utf-8');
const envMap = Object.fromEntries(
  envText
    .split('\n')
    .filter((l) => /^[A-Z][A-Z0-9_]*=/.test(l))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);

const accountId = envMap.CLOUDFLARE_ACCOUNT_ID;
const apiToken = envMap.CLOUDFLARE_API_TOKEN;
if (!accountId || !apiToken) {
  console.error('CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN must be set in .env');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${apiToken}`,
  'Content-Type': 'application/json',
};

async function cf(pathSegment, init = {}) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/challenges/widgets${pathSegment}`;
  const res = await fetch(url, { headers, ...init });
  const json = await res.json();
  if (!json.success) {
    console.error(`CF API call to ${pathSegment} failed:`, JSON.stringify(json.errors));
    process.exit(1);
  }
  return json.result;
}

async function findWidgetByName(name) {
  const list = await cf('');
  return (list || []).find((w) => w.name === name);
}

async function upsertEnvKey(key, value) {
  let text = await fs.readFile(envFile, 'utf-8');
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(text)) {
    text = text.replace(re, `${key}=${value}`);
  } else {
    if (!text.endsWith('\n')) text += '\n';
    text += `${key}=${value}\n`;
  }
  await fs.writeFile(envFile, text);
}

const existing = await findWidgetByName(WIDGET_NAME);

if (existing && !rotate) {
  if (envMap.TURNSTILE_SITE_KEY && envMap.TURNSTILE_SECRET) {
    console.log(
      `Widget "${WIDGET_NAME}" already exists (sitekey ${existing.sitekey.slice(0, 8)}…); ` +
      `.env already populated; nothing to do. Use --rotate to mint a new secret.`,
    );
    process.exit(0);
  }
  // Widget exists but our .env is missing the secret — rotate to capture it.
  console.log(
    `Widget "${WIDGET_NAME}" exists but .env is missing TURNSTILE_SECRET; rotating to capture.`,
  );
}

let sitekey, secret, mode, createdOn;

if (!existing) {
  console.log(`Creating Turnstile widget "${WIDGET_NAME}" for ${DOMAINS.join(', ')}...`);
  const r = await cf('', {
    method: 'POST',
    body: JSON.stringify({
      name: WIDGET_NAME,
      domains: DOMAINS,
      mode: 'managed',
      region: 'world',
    }),
  });
  sitekey = r.sitekey;
  secret = r.secret;
  mode = r.mode;
  createdOn = r.created_on;
} else {
  sitekey = existing.sitekey;
  // Rotate to get a fresh secret (or capture one if we don't have it).
  console.log(`Rotating secret for widget ${sitekey.slice(0, 8)}…`);
  const r = await cf(`/${sitekey}/rotate_secret`, {
    method: 'POST',
    body: JSON.stringify({ invalidate_immediately: true }),
  });
  secret = r.secret;
  mode = r.mode;
  createdOn = existing.created_on;
}

await upsertEnvKey('TURNSTILE_SITE_KEY', sitekey);
await upsertEnvKey('TURNSTILE_SECRET', secret);

console.log('OK');
console.log(`  sitekey:    ${sitekey}`);
console.log(`  secret:     ${secret.slice(0, 8)}… (full value written to .env)`);
console.log(`  mode:       ${mode}`);
console.log(`  created_on: ${createdOn}`);
console.log(`  domains:    ${DOMAINS.join(', ')}`);
