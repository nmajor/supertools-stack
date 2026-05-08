# customizations/

Files layered on top of the `npm create cloudflare@latest --framework=tanstack-start` scaffold output. Organized **per install-step** so each step's templates, code, and tests stay collocated.

## Convention

```
customizations/
├── SCAFFOLD-NOTES.md      # what the cloudflare scaffolder produces, verbatim
├── 10-db/                 # templates for install-step 10-db
│   ├── drizzle.config.ts.tmpl
│   ├── src/db/schema.ts.tmpl
│   └── src/db/index.ts.tmpl
├── 20-auth/
│   ├── src/lib/auth.ts.tmpl
│   └── src/routes/api/auth/$.tsx.tmpl
└── 30-marketing/
    ├── src/components/MarketingNav.tsx.tmpl
    ├── src/components/Footer.tsx.tmpl
    └── src/routes/{index,pricing,terms,privacy,resources/index,resources/example}.tsx.tmpl
```

- Files ending in `.tmpl` are rendered with `{{PLACEHOLDER}}` substitution by `scripts/render.mjs`. Strip the `.tmpl` suffix on output.
- All other files are copied verbatim.
- Every `{{PLACEHOLDER}}` must resolve at install time — `render.mjs` throws on any leftover.

## Status

**v0.1.** Only `00-scaffold` exists as an install step (no customizations needed — the cloudflare scaffolder is the customization). Subsequent layers add their own subdir:

- `10-db` — D1 binding in `wrangler.jsonc`, `drizzle.config.ts`, `src/db/schema.ts` (with Better Auth tables + cascade FKs), `src/db/index.ts`. Vitest cascade-contract test.
- `20-auth` — Better Auth wiring, default unstyled auth pages.
- `30-marketing` — Marketing pages (home, pricing, terms, privacy, resources), nav, footer, SEO wrapper.

Each step's `apply()` function imports the renderer from `scripts/render.mjs` and renders its `customizations/<step-id>/` subtree into the project. See `scripts/install-steps/_step-lib.mjs` for the contract.

## Adding a new install step

1. Create `scripts/install-steps/<NN>-<name>.mjs` exporting `id`, `requires`, `provides`, `detect`, `apply`.
2. Create `customizations/<NN>-<name>/` with the templates the step renders.
3. Add tests under `tests/<NN>-<name>/` (Vitest, Playwright, or both).
4. Run `node scripts/test.mjs` — the orchestrator picks up the new step automatically; the test harness exercises it as part of the full pipeline.

## Why per-step folders

The flat-customizations approach (everything mixed under `customizations/`) makes it ambiguous which step owns which file when two steps want to modify adjacent things. Per-step folders make ownership explicit, make removal of a step a clean deletion, and let one step's changes review independently of others.
