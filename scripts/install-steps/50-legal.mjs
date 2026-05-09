// 50-legal — substantive Terms of Service and Privacy Policy templates.
//
// What this step does:
//   1. Render customizations/50-legal/ into the project. The tree contains
//      two verbatim .tsx files (no .tmpl extension), which copy through
//      render.mjs unchanged and overwrite 30-marketing's empty placeholder
//      versions at:
//        - src/routes/_marketing/terms.tsx
//        - src/routes/_marketing/privacy.tsx
//   2. Write a per-step receipt under .supertools-state/.
//
// Why ship as .tsx and not .tsx.tmpl:
//   The placeholder strings ({{COMPANY_LEGAL_NAME}}, {{PRODUCT_NAME}}, etc.)
//   are intentionally left in the rendered project. render.mjs's leftover-
//   placeholder check only fires for files with the .tmpl suffix, so a
//   verbatim .tsx ships its `{{KEY}}` text as literal output for the user
//   (or a downstream supertools-design step) to fill in. Wrapping the
//   placeholders in JSX template-literal expressions (e.g. {`{{KEY}}`})
//   keeps JSX from treating the curly braces as expression markers, so the
//   files compile and render the literal text in the page output.
//
// What this step deliberately does NOT do:
//   - Render-time placeholder substitution. The deployer (or a later
//     supertools-design concern) fills the placeholders in.
//   - Ship a "have counsel review" disclaimer. The user has explicitly
//     declined that. The templates are the operative version.
//   - Add postal address or hardcode the EU Article 27 representative.
//     Both are placeholder-driven; inline TODO comments mark the spots.
//
// Idempotency:
//   - renderTree's verbatim copy uses fs.copyFile, which overwrites
//     existing destinations. Re-applying after a template edit propagates
//     cleanly.
//   - The receipt-skip in detect() short-circuits the orchestrator on
//     successful re-runs.
//
// Requires 30-marketing because we are overwriting its terms.tsx and
// privacy.tsx outputs. If 30-marketing has not yet rendered its tree, the
// route shells will not exist and the legal pages would not be wired into
// the marketing layout/nav.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderTree } from '../render.mjs';
import { readReceipt, writeReceipt } from './_step-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const TEMPLATE_DIR = path.join(repoRoot, 'customizations', '50-legal');

export const id = '50-legal';
export const requires = ['00-scaffold', '10-db', '20-auth', '30-marketing'];
export const provides = ['legal-pages-content'];

export async function detect(ctx) {
  const receipt = await readReceipt(ctx.targetPath, id);
  if (receipt) return { skip: true, reason: 'receipt found' };
  return { skip: false };
}

export async function apply(ctx) {
  console.log('  Rendering customizations/50-legal/ -> project (overwrites 30-marketing terms/privacy)...');
  await renderTree(TEMPLATE_DIR, ctx.targetPath, {});

  await writeReceipt(ctx.targetPath, id, {
    version: '0.1',
    summary: 'operative Terms of Service and Privacy Policy templates with placeholders',
    notes: [
      'Placeholders ({{COMPANY_LEGAL_NAME}}, {{PRODUCT_NAME}}, {{DOMAIN}},',
      '{{EU_REPRESENTATIVE}}, {{MOR_NAME}}, {{JURISDICTION}}, {{EFFECTIVE_DATE}})',
      'ship verbatim and are filled in by the deployer at install time.',
    ].join(' '),
  });
}
