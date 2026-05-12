// 25-email — Ahasend transactional email transport + reusable HTML template.
//
// What this step ships:
//   1. src/lib/email.ts                  — EmailService interface (sendEmail,
//                                          getEmailTransport, EmailMessage,
//                                          EmailTransport, NoopTransport) +
//                                          transport selection. PROJECT_NAME
//                                          is baked in as the default from-name
//                                          fallback at render time; the
//                                          EMAIL_FROM_NAME env var overrides at
//                                          runtime.
//   2. src/lib/email-transport-ahasend.ts — AhasendTransport class, native fetch,
//                                          POST /v2/accounts/{id}/messages.
//   3. src/lib/email-templates.tsx       — renderEmail() inline-styled HTML
//                                          layout + htmlToText() fallback +
//                                          escapeHtml(). DO NOT use Tailwind
//                                          in here (Outlook/Gmail strip class-
//                                          based CSS — see the file's banner
//                                          comment).
//
// Transport selection:
//   - AHASEND_SECRET_KEY set            -> AhasendTransport (real send)
//   - AHASEND_SECRET_KEY unset / empty  -> NoopTransport (logs to stdout)
//
// This step does NOT:
//   - Register a domain with Ahasend (deploy concern; lives in
//     supertools-design's 80-email concern).
//   - Write Ahasend creds into .dev.vars (Nick controls per-project; the
//     deploy concern manages this).
//   - Add any npm deps (native fetch, no SDK).
//   - Wire send-on-signup / password-reset emails. Those are feature work and
//     live in 20-auth or its successors.
//
// Cross-step coupling:
//   - email.ts imports './log' from 15-foundation. If 15-foundation hasn't
//     run, the rendered file will reference a missing module — that's why
//     `requires` lists 15-foundation.
//   - The harness's L3.10 layer (scripts/test.mjs) gates the no-op path by
//     forcing AHASEND_SECRET_KEY="" at the worker env level and asserting the
//     returned id starts with "noop-". Real-Ahasend sends are exercised
//     manually (not on every harness run — we don't want a test to spam an
//     inbox).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderTree } from '../render.mjs';
import { readReceipt, writeReceipt } from './_step-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const TEMPLATE_DIR = path.join(repoRoot, 'customizations', '25-email');

export const id = '25-email';
export const requires = ['00-scaffold', '15-foundation'];
export const provides = ['email-transport'];

export async function detect(ctx) {
  const receipt = await readReceipt(ctx.targetPath, id);
  if (receipt) return { skip: true, reason: 'receipt found' };
  return { skip: false };
}

export async function apply(ctx) {
  console.log('  Rendering customizations/25-email/ -> project...');
  await renderTree(TEMPLATE_DIR, ctx.targetPath, {
    PROJECT_NAME: ctx.projectName,
  });

  await writeReceipt(ctx.targetPath, id, {
    version: '0.1',
    summary:
      'Ahasend transactional email transport + reusable HTML template + ' +
      'no-op transport for local dev',
    notes: [
      'Transport selection reads AHASEND_SECRET_KEY/AHASEND_ACCOUNT_ID/',
      'EMAIL_FROM_DOMAIN from the cloudflare:workers env proxy at call time.',
      'Without those vars the no-op transport logs to stdout. Real-Ahasend',
      'sends are exercised manually; the harness L3.10 gates only the no-op',
      'path.',
    ].join(' '),
  });
}
