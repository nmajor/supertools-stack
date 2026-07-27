# Scaffold survey — what `npm create cloudflare@latest --framework=tanstack-start` actually produces

Captured against `create-cloudflare` **v2.68.1** (May 2026). Re-run `node scripts/test.mjs` after each C3 release to detect drift.

## The working invocation

```sh
npm create cloudflare@latest <project-name> -- \
  --category=web-framework \
  --framework=tanstack-start \
  --no-deploy \
  --no-git
```

Both `--accept-defaults` and `--lang=ts` are deliberately **omitted**:

- **`--accept-defaults`** silently overrides `--framework=tanstack-start` and produces a generic Hello World Worker instead. Confirmed bug in v2.68.1 — passes the `category` default before the framework flag is consulted.
- **`--lang=ts`** is unnecessary because `@tanstack/create-start` is TypeScript by default and the lang flag isn't passed through the framework dispatcher.

C3 dispatches to `@tanstack/create-start@0.59.28` under the hood. That CLI prints a deprecation warning ("Use `tanstack create` or `npx @tanstack/cli create` instead") — tracked in [cloudflare/workers-sdk#12847](https://github.com/cloudflare/workers-sdk/issues/12847). Drop-in works for now; we'll switch when CF updates the dispatcher.

## File tree (no `node_modules`)

```
<project>/
├── AGENTS.md                       # AI-coding-agent guidance from C3
├── README.md                       # TanStack Start's default README
├── .gitignore
├── .vscode/settings.json
├── .cta.json                       # @tanstack/create-start metadata
├── package.json
├── package-lock.json
├── tsconfig.json
├── vite.config.ts                  # Vite is the build tool
├── wrangler.jsonc                  # NOT wrangler.toml
├── worker-configuration.d.ts       # generated, run `cf-typegen` to regenerate
├── public/
│   ├── favicon.ico
│   ├── logo192.png
│   ├── logo512.png
│   ├── manifest.json
│   └── robots.txt
└── src/
    ├── styles.css                  # global styles (Tailwind-style? plain? — verify per release)
    ├── router.tsx                  # createRouter() — TanStack Start setup
    ├── routes/
    │   ├── __root.tsx              # root layout (route conventions: __root.tsx)
    │   ├── index.tsx               # /
    │   └── about.tsx               # /about (placeholder route)
    └── components/
        ├── Header.tsx              # we replace with MarketingNav
        ├── Footer.tsx              # we replace with our own
        └── ThemeToggle.tsx         # we may keep or remove
```

## `package.json` scripts (as scaffolded)

```json
{
  "dev": "vite dev --port 3000",
  "build": "vite build",
  "preview": "npm run build && vite preview",
  "test": "vitest run",
  "deploy": "npm run build && wrangler deploy",
  "cf-typegen": "wrangler types"
}
```

Notes for our customizations:

- **`dev` runs `vite dev`, not `wrangler dev`.** The Vite plugin handles SSR and hot reload; wrangler is only used for `deploy` and `cf-typegen`. Our test harness needs to handle this — `vite dev` listens on port 3000 by default, not the 8787 we previously assumed.
- We need to add: `db:generate`, `db:migrate:local`, `db:test:contract` (Layer 1). Plus extend `test` to run the full vitest suite including auth + cascade contract.

## `wrangler.jsonc` shape (key bits)

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "<project-name>",
  "main": "src/index.ts",
  "compatibility_date": "2026-05-08",
  "compatibility_flags": [
    "nodejs_compat",
    "global_fetch_strictly_public"
  ],
  "assets": {
    "directory": "./public"
  },
  "observability": { "enabled": true },
  "upload_source_maps": true
  // commented-out blocks for vars, services, d1_databases, etc.
}
```

Adding a `d1_databases` array therefore needs a JSONC patcher that preserves comments and handles trailing commas. `scripts/install-steps/10-db.mjs` implements one by hand (no `jsonc-parser` dep), is idempotent on re-run, and validates the result parses. Any later step that needs to add a binding should reuse that approach rather than inventing a second patcher.

## TanStack Start route conventions

- File-based routing: `src/routes/<path>.tsx` → corresponding URL path.
- `__root.tsx` (double underscore) is the root layout that wraps all routes.
- Route groups via parentheses: `(auth)/sign-in.tsx` → `/sign-in` but with shared layout in `(auth)/_layout.tsx`.
- API routes live at `src/routes/api/<path>.tsx` — Better Auth catch-all goes at `src/routes/api/auth/$.tsx` (the `$` is TanStack's catch-all token).
- Each route can `export head()` for per-route meta tags. Our `SeoHead` helper wraps that.

## Test-harness implications (for next slice)

Current `scripts/test.mjs` hits `http://127.0.0.1:8787/` (wrangler dev). After this change, the dev server is `vite dev` on port 3000. We need to update the harness:

```diff
-await runCmd('npx', ['--no-install', 'wrangler', 'dev', '--port=8787', '--ip=127.0.0.1'], …)
+await runCmd('npm', ['run', 'dev', '--', '--port=3001', '--host=127.0.0.1'], …)
```

Plus:

- Add a typecheck step before `dev`: `npx tsc --noEmit`.
- Add a build step to verify production build works: `npm run build`.

## Deprecation watch

Re-run the full test (`node scripts/test.mjs`) after any of these:

- New `create-cloudflare` release (currently v2.68.1).
- TanStack ships `tanstack create` as the official replacement for `@tanstack/create-start`.
- C3 switches its dispatcher away from `@tanstack/create-start` (per issue #12847).

If the test fails after a release, refresh.mjs (LLM-driven) is the path: bisect, propose fix, re-test.
