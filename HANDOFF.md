# supertools-stack handoff

This document is the complete briefing for an agent picking up this work cold. Read top-to-bottom before doing anything. After reading this, also read:

- [README.md](README.md) — user-facing intro
- [customizations/SCAFFOLD-NOTES.md](customizations/SCAFFOLD-NOTES.md) — what `npm create cloudflare@latest --framework=tanstack-start` actually produces, including the real bugs in C3 v2.68.1
- [customizations/README.md](customizations/README.md) — per-step customizations layout
- [scripts/install-steps/_step-lib.mjs](scripts/install-steps/_step-lib.mjs) and [00-scaffold.mjs](scripts/install-steps/00-scaffold.mjs) — the install-step contract by example

## TL;DR

1. Two repos: `supertools-design` (orchestration plugin for Claude Code) and `supertools-stack` (this repo — canonical TanStack Start + CF Workers + D1 + Drizzle + Better Auth template).
2. v0.1 + v0.2-prep are live and verified. The install pipeline is **modular** — install-steps live in `scripts/install-steps/<NN>-<name>.mjs` and write per-step receipts to `<project>/.supertools-state/`. Re-running the install picks up where it left off.
3. Only one step exists today: `00-scaffold` (calls C3 → `@tanstack/create-start`).
4. The **next work is `10-db`** — D1 binding into `wrangler.jsonc`, `drizzle.config.ts`, `src/db/schema.ts` with Better Auth tables + cascade FKs, plus a Vitest cascade-contract test.
5. Pattern: each new install-step lands as one commit that leaves `node scripts/test.mjs` green.

## The two repos

### supertools-design (sister repo)

- Live at `https://github.com/nmajor/supertools-design`.
- Claude Code plugin: ships slash commands like `/supertools-design:start`, `/supertools-design:bootstrap`, etc.
- Delivers two patterns: **workflows** (decision documents in `product/supertools/<workflow>/`) and **concerns** (numbered modules under `concerns/<NN>-<name>/` for actually wiring things up).
- Hard prerequisite enforced in every command: Design OS must have produced `product-plan/` with `README.md` and `product-overview.md`, otherwise the command refuses.
- Already implemented: `start`, `status`, `bootstrap`, `80-email` (full Ahasend domain registration + CF DNS write + test email + write to `.env`), `70-analytics` (smoke-test only). Other concerns are stubs.

### supertools-stack (this repo)

- Live at `https://github.com/nmajor/supertools-stack`.
- Bootstraps a project at `<target>` from the canonical stack. Doesn't deploy — deployment is a later supertools-design step.
- Maintained as a **tested artifact**: weekly cron + on-install refresh propose package updates, gated by `scripts/test.mjs`. The point is: when libraries drift, the LLM-driven refresh has a real test as the gate, so updates are safe.
- Used by `supertools-design`'s `10-project-init` concern (eventually — that concern is still a stub).

## Stack decisions (locked in by the user)

| Concern | Choice | Why |
|---|---|---|
| Framework | **TanStack Start** | User said "tanstack start or something"; SSR + SEO-friendly + CF Workers deploy target |
| Hosting | **Cloudflare Workers** | User chose explicitly |
| Database | **D1** | User chose explicitly |
| ORM | **Drizzle** (`dialect: 'sqlite'`, `driver: 'd1-http'`) | User chose explicitly; D1 is sqlite under the hood |
| Auth | **Better Auth**, password-only, default unstyled pages | User chose explicitly |
| Payments | **Polar.sh** as Merchant of Record | User chose explicitly; MoR handles VAT/cooling-off |
| Analytics | **Rybbit** (self-hosted) | User chose explicitly |
| Email | **Ahasend** | User chose explicitly |
| Support chat | **Chatwoot** | User switched from Crisp mid-conversation |
| Package manager | **npm** | Not pnpm — pnpm isn't available in many envs and the v0.1 scaffolder uses npm |
| Domain pattern | `www.<domain>` with naked → www redirect | Handled in supertools-design later, NOT here |

## Stack scope (locked in)

**This repo bootstraps a working LOCAL project.** It does NOT:
- Create a real D1 database (deploy concern)
- Run `wrangler deploy` (deploy concern)
- Set up DNS (deploy concern)
- Configure CF API tokens (deploy concern)

The deploy step lives in supertools-design as a future concern. Stack template just lays down code; it always works locally with `npm run dev`.

For the test harness, **mock CF and other external services**. The user is OK with mocking because LLM supervision in `codex-install.sh` (v0.3+) catches real-install failures.

## Current state — supertools-stack

```
.
├── HANDOFF.md                           # this file
├── README.md
├── LICENSE                              # MIT
├── .gitignore
├── package.json                         # type: module, scripts: test, refresh
├── install.sh                           # main entry; weekly-gated refresh
├── codex-install.sh                     # stub — falls back to install.sh
├── customizations/
│   ├── README.md                        # per-step layout convention
│   └── SCAFFOLD-NOTES.md                # ★ critical — what C3 actually produces
├── scripts/
│   ├── _lib.mjs                         # runCmd, spawnBg(detached), waitForUrl(strict 200), killProcessGroup, pickFreePort
│   ├── orchestrate-install.mjs          # walker that runs install-steps in order
│   ├── render.mjs                       # {{PLACEHOLDER}} substitution + renderTree
│   ├── refresh.mjs                      # stub — v0.3+ LLM-driven dep updater
│   ├── test.mjs                         # the gate: install → build → typecheck → vite-dev probe
│   └── install-steps/
│       ├── _step-lib.mjs                # readReceipt, writeReceipt, fileExists, listDir, assertValidStep
│       └── 00-scaffold.mjs              # only step today
├── tests/                               # placeholders; vitest/playwright tests land per-step in v0.3+
│   ├── unit/
│   ├── integration/
│   └── e2e/
└── .github/workflows/refresh.yml        # weekly Mon 12:00 UTC + workflow_dispatch
```

### Commit history (most recent first)

```
b8956ac  v0.2 prep: modular install-steps model + harness hardening
e3acdd3  v0.1.1: scaffolder produces real TanStack Start app (was Hello World)
5779887  v0.1 follow-up: switch to npm/npx (no global pnpm/wrangler dependency)
0ab4958  v0.1 skeleton: install.sh wraps `npm create cloudflare@latest`
```

### What's verified

```
[L1 → 00-scaffold] real TanStack Start app                    ✓ ~3 min, deprecation warning expected
[L2] npm run build                                             ✓ ~450ms
[L2.5] npx tsc --noEmit                                        ✓
[L3] vite dev :<random-free-port> → GET / → 200 OK             ✓
PASS, no orphans, no port leaks
```

Confirm by running `node scripts/test.mjs` from repo root. (Requires Node ≥22 and outbound network for npm.)

### What's NOT verified

- The `install.sh` weekly-refresh path (`.last-refresh` gating, commit/push/rollback logic). Stub `refresh.mjs` is a no-op so the commit branch never had anything to commit. When refresh.mjs becomes real, that branch may have bugs.
- `codex-install.sh` is a stub.
- `render.mjs` placeholder substitution. No customizations exist yet to exercise it.
- The CI workflow (`.github/workflows/refresh.yml`) — never triggered in CI.

## Real bugs encountered (and how they were fixed)

These are battle scars — the next agent should know they exist so they're not surprised:

1. **C3 v2.68.1 silently ignores `--framework` when `--accept-defaults` is set.** Solution: don't pass `--accept-defaults`. The framework dispatcher fills in defaults itself. Documented in [customizations/SCAFFOLD-NOTES.md](customizations/SCAFFOLD-NOTES.md).

2. **`@tanstack/create-start` is deprecated** (TanStack moved to `tanstack create` / `npx @tanstack/cli create`). C3 still uses the old one. Tracked in [cloudflare/workers-sdk#12847](https://github.com/cloudflare/workers-sdk/issues/12847). Currently still works; refresh.mjs (when real) should detect the migration.

3. **TanStack Start's router plugin generates `routeTree.gen.ts` during `vite build`.** Running `tsc --noEmit` BEFORE the build fails with "Cannot find module './routeTree.gen'". Fix: build first, typecheck second. (See `scripts/test.mjs`.)

4. **`npm run dev -- --port=N` results in `vite dev --port 3000 --port=N`** because the package.json `dev` script hardcodes `--port 3000`. Vite's behavior with two `--port` flags is unpredictable. Fix: invoke vite directly via `<target>/node_modules/.bin/vite` instead of `npm run dev`.

5. **`child.kill()` doesn't kill grandchildren** (vite spawns workerd via miniflare). Orphans squat ports across runs. Fix: `spawnBg` now uses `detached: true` to put the child in its own process group, and `killProcessGroup` sends SIGTERM to the whole group. (See `scripts/_lib.mjs`.)

6. **`waitForUrl` was too permissive** (returned on any 2xx-5xx response; vite dev returns 404 while routes lazy-compile). Fixed to require strict 2xx by default.

## Test harness contract

`scripts/test.mjs` is the gate everything else depends on. Currently exercises four layers:

| Layer | What | Runs |
|---|---|---|
| L1 | install.sh end-to-end | scaffolder runs, scaffold is correctly shaped |
| L2 | `npm run build` (vite build) | production build succeeds; routeTree.gen.ts generated |
| L2.5 | `npx tsc --noEmit` | TypeScript types are sound |
| L3 | `vite dev --port=<random>` then `GET /` | dev server boots and serves the home route |

Each install-step added in v0.3+ MUST keep all four layers green. Test extensions per step go in `tests/<step-id>/`.

Planned later: **L4 Playwright** (real browser e2e — sign up, navigate, check JSON-LD on resource pages) and **L5 real deploy** (deferred — out of scope for stack repo).

## The plan ahead

Sequence the user agreed to. **Each row is one commit.** Each commit must leave `node scripts/test.mjs` green.

| # | Commit | New install-step | New customizations subtree | Test additions |
|---|---|---|---|---|
| 1 | `10-db: D1 binding + Drizzle + schema` | `scripts/install-steps/10-db.mjs` | `customizations/10-db/` with `wrangler.jsonc.patcher.mjs` (or similar), `drizzle.config.ts`, `src/db/schema.ts.tmpl`, `src/db/index.ts.tmpl` | `tests/10-db/cascade-contract.test.ts` (runtime introspection via Drizzle's `getTableConfig`); harness extension to run `npm run db:generate` and apply migrations to local D1 |
| 2 | `20-auth: Better Auth + auth pages` | `20-auth.mjs` | `customizations/20-auth/` with `src/lib/auth.ts.tmpl`, `src/lib/auth-client.ts.tmpl`, `src/routes/api/auth/$.tsx.tmpl`, `src/routes/(auth)/sign-{in,up}.tsx.tmpl` | `tests/20-auth/signup-flow.test.ts` — POST `/api/auth/sign-up` → 200 + session, GET session works |
| 3 | `30-marketing: pages + nav + SEO` | `30-marketing.mjs` | `customizations/30-marketing/` with `src/components/{MarketingNav,Footer,SeoHead}.tsx.tmpl`, `src/routes/_marketing.tsx.tmpl`, `src/routes/{index,pricing,terms,privacy,resources/index,resources/example-resource}.tsx.tmpl` | `tests/30-marketing/seo-meta.spec.ts` (Playwright) — visit each, check title + JSON-LD |
| 4 | `40-dashboard: dashboard + settings + delete-account` (later) | `40-dashboard.mjs` | dashboard layout, dashboard nav, settings page with `Danger zone → Delete account` typed-confirm modal | `tests/40-dashboard/delete-account.spec.ts` (Playwright) |
| 5 | `50-legal: terms + privacy templates with placeholders` (later) | (could fold into 30-marketing if user prefers) | `customizations/50-legal/{terms.md.tmpl, privacy.md.tmpl}` with `{{COMPANY_LEGAL_NAME}}`, `{{PRODUCT_NAME}}`, `{{DOMAIN}}`, `{{PRIVACY_EMAIL}}`, `{{EU_REPRESENTATIVE}}`, `{{MOR_NAME}}` etc. | render-time placeholder validation |

Beyond steps:
- Real `refresh.mjs` (codex/claude wrapper that bumps deps + runs `test.mjs` + bisects on failure)
- `codex-install.sh` body (codex-supervised install wrapper)
- L4 Playwright in test.mjs

## Decisions already made about the next slices

User answered these in conversation; they're locked in:

- **D1 db name**: `<project-name>-db` (e.g. `helloworld-db`).
- **Example user-owned table**: call it `example` so it's clearly demo data and safely removable.
- **Drizzle dialect**: `'sqlite'`, driver: `'d1-http'`.
- **Drizzle migrations dir**: `drizzle/` at repo root (drizzle-kit default).
- **AI training opt-out**: ON by default. Privacy policy says "we do not use customer data to train AI models." User overrides if needed.
- **Children clause**: ON for everything (under-13 / under-16 in EU).
- **Data retention**: 30-day default, hard cascade-delete. **Drizzle schemas MUST declare `references(() => user.id, { onDelete: 'cascade' })` on every user-owned FK.** This is non-negotiable; the cascade-contract test enforces it.
- **Delete-account UI**: built into the dashboard's settings page as `Danger zone → Delete account` with typed-confirm modal. Server action calls `auth.deleteUser()` + cascade flows automatically via the FK constraint.
- **Legal docs final compliance pass**: deferred to a later supertools-design concern (catalogues subprocessors, decides on cookies, fills placeholders).
- **Postal address in legal docs**: skip for now (registers as TODO comment in template). User doesn't want home or registered-agent address public. Privacy policy uses `privacy@<domain>` (Crisp/Chatwoot ingestion) + `/contact` webform as the two CCPA "designated methods."
- **EU rep**: appointed externally; template renders with `{{EU_REPRESENTATIVE}}` placeholder + a `<!-- TODO: appoint EU rep before launch -->` comment if blank.
- **Public repo cleanliness**: NEVER hardcode the user's name, company, or product names. Everything is `{{PLACEHOLDER}}`. The user fills in at install time.
- **Lawyer review**: legal docs ship with `<!-- IMPORTANT: have counsel review before launch -->` at the top.

## User profile (Nick)

- **Operating entity**: NMajor Studios LLC, a Wyoming LLC. Nick is the sole operator. He doesn't publish his name or the LLC name in code repos — placeholders only.
- **Email**: `nick@nmajor.com`.
- **Domain pool** (in his Cloudflare account, ID `f76f5b7e220e2c049a9f5b560982793e`): `calculatorcampus.com`, `crepulse.com`, `crepunch.com`, `criticalridge.com`, `kingpinseo.com`, `lisboncoastmarket.com`, `mediterraneanlistings.com`, `nichebreakout.com`, `nmajor.{dev,net,xyz}`, `onsitestory.com`, `phasetab.com`, `provenhooks.com`, `saasbait.com`, `skywardleads.com`, `skywardpeaks.com`, `suppliersignal.com`, `topthreelocal.com`, `waffleiron.app`. (For testing, `provenhooks.com` is the active test environment — see "Test environment" below.)
- **Communication style**: terse, blunt, intolerant of waffling. Don't pad responses.
- **Working preferences** (learned the hard way during this project — these are real corrections from the user):
  - **Don't make assumptions.** When unsure, ask. Specifically: don't pick libraries, frameworks, defaults, or design decisions the user hasn't approved. He pushed back hard on this multiple times.
  - **Verify end-to-end before claiming success.** A passing harness on the wrong scaffold is worthless. (We accidentally tested a Hello World instead of TanStack Start for v0.1; he was unimpressed.)
  - **Show the plan before the code.** When asked for "the next 3 things," he wants a plan to review, not a fait accompli.
  - **Concrete > abstract.** Specific files, specific commands, specific commit messages.
  - **Don't pad responses with emojis or filler.** No "Great question!" no "I'd be happy to help."
  - **Don't lock in framework names in error messages.** When the supertools-design gate references Design OS, it references *the artifact* (`product-plan/`), not Design OS's specific commands — those can change.

## User-supplied API keys (DO NOT commit anywhere)

The user pasted these keys earlier in the conversation for testing the supertools-design `80-email` and `70-analytics` concerns. They are **not in this repo**, must **not** be added to this repo (which is public), and the next agent should **not echo them back** in tool calls or written outputs unless directly testing those concerns.

If you need them for testing the email/analytics paths in the supertools-design repo:
- Ahasend secret key, Ahasend account ID
- Cloudflare account ID, Cloudflare API token (note: token is scoped to specific zones — does NOT have access to `provenhooks.com` as of last test, see issue below)
- Rybbit API key, Rybbit host (`https://rybbit.nmajor.net/`)

Ask the user to re-paste them rather than searching for them. Treat them as ephemeral session secrets.

**Known issue with the CF token**: it was created when only some zones existed in the user's CF account; newer zones (including `provenhooks.com`) aren't in scope. The user needs to update the token's zone-resources to "All zones" before the email-setup E2E will pass for new domains. `setup.mjs` in supertools-design's `80-email` concern surfaces a clear error pointing at the token-edit URL when this happens.

## Test environment (provenhooks)

`/home/coder/projects/provenhooks/` is the active test environment — a copy of `~/app-design/` (an existing project that has gone through Design OS end-to-end). It has `product-plan/` already built so supertools-design's hard-prereq gate passes there.

Its `.git` history is from the source clone, not relevant to supertools work. If you need a fresh test, copy `~/app-design/` again to a new sibling.

## How to pick up the next slice

The next item is `10-db`. Concrete plan:

1. **Read** [customizations/SCAFFOLD-NOTES.md](customizations/SCAFFOLD-NOTES.md) thoroughly. It tells you exactly what `wrangler.jsonc` looks like fresh from the scaffolder, where to add the `d1_databases` block, etc.

2. **Verify the harness still runs**. Before any changes:
   ```sh
   cd /home/coder/projects/supertools-stack
   node scripts/test.mjs
   ```
   Confirm green PASS.

3. **Design the wrangler.jsonc patcher**. The scaffolder produces `wrangler.jsonc` (JSON with comments). Adding a D1 binding means upserting:
   ```jsonc
   "d1_databases": [
     {
       "binding": "DB",
       "database_name": "{{PROJECT_NAME}}-db",
       "database_id": "<placeholder>",
       "migrations_dir": "drizzle"
     }
   ]
   ```
   Without clobbering existing comments. Two options: (a) regex-based JSONC editor that locates the comment block and inserts after, (b) parse via `jsonc-parser` (no deps; or use Cloudflare's wrangler config schema). Don't add a heavy dep; (a) is enough for v0.1 of the patcher.

4. **Cascade-contract test approach**. Use Drizzle's runtime introspection (`getTableConfig()` from `drizzle-orm/sqlite-core`) — NOT AST parsing. The test imports the schema, walks every table, asserts every FK to `user` has `onDelete: 'cascade'`. Failure message names the offending table + column. This is robust to formatting changes in schema.ts and gives clean attribution when bumping Drizzle versions breaks something.

5. **Better Auth tables** in `schema.ts`: at least `user`, `session`, `account`, `verification`. Get the exact shape from Better Auth's docs at the version you pin. Plus one `example` table demoing the cascade pattern (FK to `user.id` with `onDelete: 'cascade'`).

6. **Test harness extension** (in `scripts/test.mjs` or a new helper):
   - After install: `npm run db:generate` (creates migration SQL from schema)
   - Apply migrations to local D1 via `npx wrangler d1 migrations apply --local <db-name>`
   - Run cascade-contract test: `npx vitest run tests/contract/cascade.test.ts`

7. **Commit message format** (matches existing commits):
   ```
   v0.3: 10-db install-step (D1 binding, Drizzle, schema, cascade contract)

   Adds <step file> and customizations/10-db/. Schema declares user/session/
   account/verification (Better Auth) + example table demonstrating
   onDelete: 'cascade'. Cascade-contract test introspects schema at runtime
   via Drizzle's getTableConfig and asserts every user FK cascades.

   Test harness extended: db:generate runs after install, migrations apply
   to local D1, cascade-contract test runs as L2.7. All four prior layers
   still green.

   Co-Authored-By: ...
   ```

8. **Stop and check in with user** before starting `20-auth`. Don't auto-proceed.

## How to recover if test.mjs breaks

If `node scripts/test.mjs` fails after a change you made:

- Read the full log at the path it printed. The grep filter in the harness loses important detail — read the raw `/tmp/sts-test*.log` file to see what actually happened.
- If C3 broke (e.g. flag changes in a new C3 release), fix the orchestrator's invocation in `scripts/install-steps/00-scaffold.mjs`.
- If the dev-server probe times out, suspect orphan vite processes from a previous run squatting ports. Run `pkill -9 -f "/tmp/sts-test"` and re-run the test.
- If you changed `_lib.mjs` and broke the harness, every step's runtime breaks. Roll back that one change before continuing.

## Things deliberately NOT decided yet

- **Pricing tier names** for the pricing page. Going with `Free / Pro / Enterprise` placeholders unless the user redirects.
- **Auth-page styling level**. Going with Tailwind-for-layout-only (visible but uniformly unstyled). Confirm with user before committing.
- **Whether to fold the `50-legal` step into `30-marketing` or keep separate.** Currently planned separate; flag the question to the user when reaching that step.
- **Codex CLI invocation specifics**. The `codex-install.sh` body and `refresh.mjs` body both depend on the codex CLI's actual flag shape, which we haven't pinned. The user mentioned "codex" specifically — verify which CLI they mean (Anthropic-codex or OpenAI's "Codex"-named tool) before implementing.

## Open task list (carry-over)

| # | Task | Status |
|---|---|---|
| 16 | Modular install-steps model | done (in v0.2-prep commit) |
| (next) | Implement 10-db install-step | not started |
| (next) | Real `refresh.mjs` (codex wrapper) | not started, deferred |
| (next) | Real `codex-install.sh` body | not started, deferred |
| (next) | L4 Playwright extension | not started; lands with 30-marketing or 40-dashboard |

## Outside-this-repo context to know

- The user is also running supertools-design work in parallel. That repo (`/home/coder/projects/supertools-design/`, also live on GitHub) has a memory dir at `/home/coder/.claude/projects/-home-coder-projects-huepetal-design/memory/` — none of which transfers to a fresh agent in a different working directory.
- The user has a "huepetal-design" working dir that's a Design OS clone — that's where this conversation has been happening. The agent picking up may be in `/home/coder/projects/supertools-stack/` or `/home/coder/projects/provenhooks/` instead.
- If the user asks about historical decisions ("why did we…"), the answers are in this file. If something isn't here and isn't in git history, ask rather than guess.

## License

MIT (this repo and supertools-design). The user owns the templates produced by the install — those land in projects under the user's chosen license.
