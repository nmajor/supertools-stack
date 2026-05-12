// 30-marketing — public marketing surface (nav, footer, page shells).
//
// What this step does:
//   1. Render customizations/30-marketing/ into the project:
//      - src/components/{MarketingNav,Footer,SeoHead}.tsx
//      - src/routes/_marketing/route.tsx (pathless layout: nav + outlet +
//        footer for marketing pages only; auth pages under (auth)/ keep
//        their own presentation)
//      - src/routes/_marketing/{index,pricing,terms,privacy}.tsx
//      - src/routes/_marketing/resources/{index,example-resource}.tsx
//   2. Remove the scaffold's now-unused files:
//      - src/routes/index.tsx (replaced by _marketing/index.tsx)
//      - src/routes/about.tsx (generic placeholder, conflicts with the
//        marketing surface)
//      - src/components/Header.tsx, Footer.tsx, ThemeToggle.tsx (the scaffold
//        rendered these from __root; with the new __root they're orphans)
//
// Note: __root.tsx is owned by 15-foundation (which runs first by numeric
// order). That layout file used to live here; it was lifted out so the
// foundation step could wire stack-wide error boundaries and 404 pages without
// duplicating layout logic across steps.
//
// What this step deliberately does NOT ship:
//   - Default content of any kind. Pages are 1-line placeholders ("Home goes
//     here.", "Pricing goes here.", etc.). The user (or downstream agent)
//     fills in real copy. Default content is noise that has to be identified
//     and removed; empty placeholders are unambiguous.
//   - A logo, brand name, or product name. The nav says "Home". The footer
//     says "© <current year>". No image assets.
//   - A pricing tier scaffold (Free/Pro/Enterprise). Even as a "starting
//     point" this leaks shape decisions — see HANDOFF "content philosophy".
//   - Terms / Privacy bodies. Those land in the future 50-legal step; the
//     route shells exist now so footer links resolve to 200.
//
// What this step does NOT do (deferred):
//   - Playwright e2e — the harness's L3.6 layer covers SEO smoke via plain
//     HTTP. L4 (real browser e2e) lands when there's actual UI to interact
//     with.
//
// Idempotency:
//   - renderTree overwrites .tmpl outputs each run, so re-applying after a
//     template edit propagates cleanly.
//   - fs.rm(..., { force: true }) is no-op on missing paths.
//   - The receipt-skip in detect() handles the orchestrator-level case.

import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { renderTree } from '../render.mjs';
import { readReceipt, writeReceipt } from './_step-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const TEMPLATE_DIR = path.join(repoRoot, 'customizations', '30-marketing');

export const id = '30-marketing';
export const requires = ['00-scaffold', '15-foundation', '10-db', '20-auth'];
export const provides = ['marketing-pages', 'seo-head'];

export async function detect(ctx) {
  const receipt = await readReceipt(ctx.targetPath, id);
  if (receipt) return { skip: true, reason: 'receipt found' };
  return { skip: false };
}

export async function apply(ctx) {
  console.log('  Rendering customizations/30-marketing/ -> project...');
  await renderTree(TEMPLATE_DIR, ctx.targetPath, {});

  console.log('  Removing scaffold files now superseded by 30-marketing...');
  // The scaffold's `src/routes/index.tsx` and `about.tsx` would conflict /
  // pollute (we now serve `/` via _marketing/index.tsx; about isn't a
  // marketing route we want).
  const supersededRoutes = [
    path.join(ctx.targetPath, 'src', 'routes', 'index.tsx'),
    path.join(ctx.targetPath, 'src', 'routes', 'about.tsx'),
  ];
  // Header.tsx and ThemeToggle.tsx are scaffold-only; the new __root no
  // longer imports them. Footer.tsx is NOT in this list — our renderTree
  // step above replaced its contents with the marketing footer.
  const supersededComponents = [
    path.join(ctx.targetPath, 'src', 'components', 'Header.tsx'),
    path.join(ctx.targetPath, 'src', 'components', 'ThemeToggle.tsx'),
  ];
  for (const f of [...supersededRoutes, ...supersededComponents]) {
    await fs.rm(f, { force: true });
  }

  await writeReceipt(ctx.targetPath, id, {
    version: '0.1',
    summary: 'marketing nav/footer/page shells with empty placeholders',
    notes: [
      'Page bodies are placeholder lines by design — see HANDOFF content',
      'philosophy. 50-legal will replace terms/privacy bodies wholesale.',
    ].join(' '),
  });
}
