// 40-dashboard — auth-gated dashboard surface (layout + index + settings).
//
// What this step does:
//   1. Render customizations/40-dashboard/ into the project:
//      - src/components/UserMenu.tsx        (top-right dropdown: email, Settings, Sign out)
//      - src/routes/dashboard/route.tsx     (auth gate via beforeLoad + layout)
//      - src/routes/dashboard/index.tsx     (placeholder dashboard body at /dashboard)
//      - src/routes/dashboard/settings.tsx  (Danger zone + Delete account modal at /dashboard/settings)
//
//   The directory is `dashboard/` (real URL segment), not `_dashboard/` —
//   `_marketing/` is pathless because its index serves `/`, but the dashboard
//   needs to live at /dashboard so the path can't be flattened.
//
//   Note: the auth gate's `getServerSession` server function is shipped by
//   20-auth (src/lib/auth.functions.ts) — both the dashboard's route and the
//   sign-in/sign-up redirect-when-authed checks consume it, so it lives with
//   the rest of the auth runtime rather than here.
//
// What this step does NOT do (deferred):
//   - Playwright e2e — the orchestrator's Playwright MCP sidecar drives the UI
//     post-commit. The HTTP-level cascade test (L3.7 in scripts/test.mjs) is
//     the gate added with this step.
//   - Sample widgets, metric cards, welcome banner — see HANDOFF "Dashboard
//     pages are empty placeholders" content philosophy.
//   - Theme toggle, avatar, notifications — out of scope; same philosophy.
//   - Email-verified delete flow — Better Auth's `sendDeleteAccountVerification`
//     callback is left unset, which means the password-proof path is the
//     verification. Local dev has no email transport so an email-gated flow
//     would never complete.
//
// Cross-step coupling note:
//   This step depends on 20-auth's `auth.ts.tmpl` having `user.deleteUser`
//   enabled (POST /api/auth/delete-user is gated behind that opt-in). That
//   block was added directly to 20-auth's template rather than patching here:
//   it's the smaller, less-error-prone change, and 20-auth's L3.5 signup test
//   doesn't exercise the deletion endpoint so enabling it can't regress earlier
//   layers. If a future agent removes `user.deleteUser` from auth.ts.tmpl, the
//   L3.7 cascade test in scripts/test.mjs will fail with a 404.
//
// Idempotency:
//   - renderTree overwrites .tmpl outputs each run.
//   - Receipt-skip in detect() handles the orchestrator-level case.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderTree } from '../render.mjs';
import { readReceipt, writeReceipt } from './_step-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const TEMPLATE_DIR = path.join(repoRoot, 'customizations', '40-dashboard');

export const id = '40-dashboard';
export const requires = ['00-scaffold', '10-db', '20-auth', '30-marketing'];
export const provides = ['dashboard', 'settings-page', 'delete-account'];

export async function detect(ctx) {
  const receipt = await readReceipt(ctx.targetPath, id);
  if (receipt) return { skip: true, reason: 'receipt found' };
  return { skip: false };
}

export async function apply(ctx) {
  console.log('  Rendering customizations/40-dashboard/ -> project...');
  await renderTree(TEMPLATE_DIR, ctx.targetPath, {});

  await writeReceipt(ctx.targetPath, id, {
    version: '0.1',
    summary: 'auth-gated dashboard layout + settings/delete-account modal',
    notes: [
      'Auth gate via beforeLoad on _dashboard/route.tsx redirects unauthenticated',
      'requests to /sign-in. Settings page exposes Danger zone -> Delete account',
      'modal that hits Better Auth POST /api/auth/delete-user with password proof.',
      'Cascade fires through user_id FKs declared in 10-db schema.',
    ].join(' '),
  });
}
