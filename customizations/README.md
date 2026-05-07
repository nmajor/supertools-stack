# customizations/

Files layered on top of the `npm create cloudflare@latest --framework=tanstack-start` scaffold output by `scripts/orchestrate-install.mjs`.

## Conventions

- Files ending in `.tmpl` are rendered with placeholder substitution (`{{NAME}}`). Strip the `.tmpl` suffix on output.
- All other files are copied verbatim.
- Every `{{NAME}}` placeholder must resolve at install time — `scripts/render.mjs` throws on any leftover.

## Status

**Empty in v0.1.** The customizations land incrementally:

- v0.2 — D1 binding in `wrangler.toml`, `drizzle.config.ts`, `src/db/schema.ts` with Better Auth tables, cascade-delete FKs.
- v0.3 — Better Auth wiring, default unstyled auth pages.
- v0.4 — Marketing pages: home, pricing, terms, privacy, resources + example resource. Marketing nav. SEO wrapper.
- v0.5 — Dashboard layout, dashboard nav, settings page, delete-account flow with cascade.
- v0.6 — Legal docs (Terms, Privacy) with placeholders + AI-training opt-out + 30-day retention + children clause.

## Placeholder convention

All `{{NAME}}`-style placeholders that customizations use must be listed in `legal/PLACEHOLDERS.md` (when that lands in v0.6) so the install prompt can ask for them all upfront.
