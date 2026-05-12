// 26-password-reset — Better Auth password reset wired to the 25-email transport.
//
// What this step ships:
//   1. src/routes/(auth)/forgot-password.tsx — form that POSTs an email to
//      Better Auth's /request-password-reset endpoint. Shows a generic
//      success banner regardless of whether the email exists (matches
//      Better Auth's server-side enumeration-mitigation behavior).
//   2. src/routes/(auth)/reset-password.tsx — form that reads `?token=...`
//      from the URL and POSTs `{ token, newPassword }` to
//      Better Auth's /reset-password endpoint.
//   3. A surgical patch to 20-auth's src/lib/auth.ts adding the
//      `sendResetPassword` callback into the `emailAndPassword` block, plus
//      the imports it needs.
//
// Why patch instead of bake into 20-auth:
//   - 20-auth runs BEFORE 25-email (numeric ordering: 20 < 25). If
//     auth.ts.tmpl imported from './email' / './email-templates' directly,
//     either the template would render a broken import during 20-auth (no
//     email module yet on disk), or 20-auth would have to require 25-email,
//     which inverts the layering (auth is more fundamental than email).
//   - The cleanest solution: 20-auth is email-agnostic at render time, and
//     26-password-reset (which lists 25-email AND 20-auth as requires)
//     stitches them together at install time via a tiny, idempotent patch.
//   - The patch is regex-anchored on stable substrings in auth.ts.tmpl (the
//     `emailAndPassword: {` line and the file's import block). Idempotent —
//     re-running is a no-op once the markers are present. Sanity-checked at
//     the end via a TypeScript-shape grep so a broken patch fails loud.
//
// Better Auth's API used:
//   - Server: `emailAndPassword.sendResetPassword({ user, url, token }, request)`
//     The `url` we receive is `${baseURL}/reset-password/{token}?callbackURL=...`
//     — that's an /api/auth route which validates the token and 302-redirects
//     to the `callbackURL` (our public /reset-password page) with `?token=...`.
//   - Client: `authClient.requestPasswordReset({ email, redirectTo })` and
//     `authClient.resetPassword({ token, newPassword })`. Path-based proxy
//     in better-auth/react, no extra config needed.
//
// What this step does NOT do:
//   - Add npm deps. zod is not pulled in (the reset-password page hand-rolls
//     its search-param parser).
//   - Modify 25-email's transport selection. If AHASEND_SECRET_KEY isn't set,
//     `sendEmail` falls back to the no-op transport — useful for local dev.
//     A reset attempt against a no-op transport still completes server-side
//     (the verification token is created); the user just never sees the link.
//     For local dev with no Ahasend, grep the worker stdout for `email.noop`
//     to find what would have been sent.
//   - Add an automated harness layer. The brief recommends gating this flow
//     via the manual real-Ahasend round-trip instead; see HANDOFF for the
//     manual checklist. Log-scraping the reset URL from worker stdout is
//     fragile and the round-trip already exists in L3.5 (signup).

import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { renderTree } from '../render.mjs';
import { readReceipt, writeReceipt, fileExists } from './_step-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const TEMPLATE_DIR = path.join(repoRoot, 'customizations', '26-password-reset');

export const id = '26-password-reset';
export const requires = ['00-scaffold', '15-foundation', '20-auth', '25-email'];
export const provides = ['password-reset'];

export async function detect(ctx) {
  const receipt = await readReceipt(ctx.targetPath, id);
  if (receipt) return { skip: true, reason: 'receipt found' };
  return { skip: false };
}

export async function apply(ctx) {
  console.log('  Rendering customizations/26-password-reset/ -> project...');
  await renderTree(TEMPLATE_DIR, ctx.targetPath, {
    PROJECT_NAME: ctx.projectName,
  });

  console.log('  Patching src/lib/auth.ts to add sendResetPassword hook...');
  await patchAuthTs(ctx.targetPath);

  await writeReceipt(ctx.targetPath, id, {
    version: '0.1',
    summary:
      'Password reset flow: /forgot-password + /reset-password pages, ' +
      'Better Auth sendResetPassword wired to the 25-email transport',
    notes: [
      'auth.ts is patched at install time to add sendResetPassword + the',
      'imports from ../email + ../email-templates. The patch is idempotent;',
      'rerunning is a no-op once the markers are present.',
    ].join(' '),
  });
}

// ─── auth.ts patcher ──────────────────────────────────────────────────────
//
// Two insertions, both idempotent:
//   1. Import block at the top of the file gets `sendEmail`, `renderEmail`,
//      `htmlToText` from the sibling email modules.
//   2. The `emailAndPassword: { ... }` block gets a `sendResetPassword`
//      callback before its closing `}`.
//
// We don't try to parse TypeScript — pattern-matching on the stable
// substrings 20-auth's template emits is sufficient and won't accidentally
// rewrite something that looks similar. If either anchor is missing we throw
// with a clear message so the operator knows the patcher needs to be
// re-pointed at the new shape of auth.ts.
//
// Idempotency markers:
//   - `// 26-password-reset: imports` precedes the import insertion
//   - `// 26-password-reset: sendResetPassword` precedes the callback
async function patchAuthTs(targetPath) {
  const file = path.join(targetPath, 'src', 'lib', 'auth.ts');
  if (!(await fileExists(file))) {
    throw new Error(
      `26-password-reset: ${file} not found. Did 20-auth run? Receipts ` +
        `live in .supertools-state/.`
    );
  }
  const original = await fs.readFile(file, 'utf-8');

  let patched = original;

  // ── 1. imports ─────────────────────────────────────────────────────────
  const importMarker = '// 26-password-reset: imports';
  if (!patched.includes(importMarker)) {
    // Anchor on the last import line in the file's initial import block —
    // specifically the `import * as schema from '../db/schema';` line that
    // 20-auth's template ends its imports with. If that anchor disappears
    // we want to fail loudly rather than guess.
    const anchor = "import * as schema from '../db/schema';";
    if (!patched.includes(anchor)) {
      throw new Error(
        `26-password-reset: could not find import anchor in auth.ts ` +
          `("${anchor}"). 20-auth's template may have changed shape.`
      );
    }
    const injection =
      anchor +
      '\n' +
      importMarker +
      '\n' +
      "import { sendEmail } from './email';\n" +
      "import { renderEmail, htmlToText } from './email-templates';";
    patched = patched.replace(anchor, injection);
  }

  // ── 2. sendResetPassword callback ──────────────────────────────────────
  const hookMarker = '// 26-password-reset: sendResetPassword';
  if (!patched.includes(hookMarker)) {
    // Anchor on the inner-comment line of 20-auth's emailAndPassword block.
    // The full anchor is multi-line so we don't accidentally collide with
    // anything else.
    const anchor =
      '    emailAndPassword: {\n' +
      '      enabled: true,\n' +
      "      // Better Auth's default minimum password length is 8. The sign-up form\n" +
      '      // mirrors that via `minLength={8}`.\n' +
      '    },';
    if (!patched.includes(anchor)) {
      throw new Error(
        `26-password-reset: could not find emailAndPassword anchor in ` +
          `auth.ts. 20-auth's template may have changed shape; look for the ` +
          `\`emailAndPassword: { enabled: true, ... }\` block.`
      );
    }
    const replacement =
      '    emailAndPassword: {\n' +
      '      enabled: true,\n' +
      "      // Better Auth's default minimum password length is 8. The sign-up form\n" +
      '      // mirrors that via `minLength={8}`.\n' +
      '      ' + hookMarker + '\n' +
      '      // Send a password-reset email when a user submits the\n' +
      '      // /forgot-password form. Better Auth invokes this with a fully-\n' +
      '      // built `url` pointing at our /api/auth/reset-password/:token\n' +
      '      // endpoint; that endpoint validates the token then redirects to\n' +
      '      // the `redirectTo` we passed on the client side, with the token\n' +
      '      // as a `?token=...` query param the public /reset-password page\n' +
      '      // reads.\n' +
      '      //\n' +
      "      // Per Better Auth's docs we don't `await` the send — failing to\n" +
      '      // do this can leak timing information about whether the email\n' +
      '      // existed. `runInBackgroundOrAwait` on the framework side handles\n' +
      '      // the scheduling; we just need to fire-and-forget here.\n' +
      '      sendResetPassword: async ({ user, url }: { user: { email: string }; url: string; token: string }) => {\n' +
      '        const html = renderEmail({\n' +
      "          heading: 'Reset your password',\n" +
      '          body:\n' +
      "            '<p>We received a request to reset the password for your ' +\n" +
      "            'account. Click the button below to choose a new one. The ' +\n" +
      "            'link expires in 1 hour.</p>',\n" +
      "          cta: { label: 'Reset password', url },\n" +
      "          footer: \"If you didn't request this, you can safely ignore this email.\",\n" +
      '        });\n' +
      '        await sendEmail({\n' +
      '          to: user.email,\n' +
      "          subject: 'Reset your password',\n" +
      '          html,\n' +
      '          text: htmlToText(html),\n' +
      '        });\n' +
      '      },\n' +
      '    },';
    patched = patched.replace(anchor, replacement);
  }

  if (patched === original) {
    // Both markers already present — nothing to do.
    return;
  }

  // Sanity check: both markers must be in the final file, and the import
  // line must precede the hook line. This catches a class of bugs where one
  // replacement succeeded but the other silently no-op'd because the anchor
  // had drifted.
  if (!patched.includes(importMarker) || !patched.includes(hookMarker)) {
    throw new Error(
      `26-password-reset: post-patch sanity check failed — one of the ` +
        `idempotency markers is missing from the final auth.ts.`
    );
  }
  if (patched.indexOf(importMarker) > patched.indexOf(hookMarker)) {
    throw new Error(
      `26-password-reset: post-patch sanity check failed — imports landed ` +
        `after the sendResetPassword hook, which means anchors are scrambled.`
    );
  }

  await fs.writeFile(file, patched);
}
