# supertools-stack handoff

This document is the complete briefing for an agent picking up this work cold. Read top-to-bottom before doing anything. After reading this, also read:

- [README.md](README.md) — user-facing intro
- [customizations/SCAFFOLD-NOTES.md](customizations/SCAFFOLD-NOTES.md) — what `npm create cloudflare@latest --framework=tanstack-start` actually produces, including the real bugs in C3 v2.68.1
- [customizations/README.md](customizations/README.md) — per-step customizations layout
- [scripts/install-steps/_step-lib.mjs](scripts/install-steps/_step-lib.mjs) and [00-scaffold.mjs](scripts/install-steps/00-scaffold.mjs) — the install-step contract by example

> **How to read this file.** It holds *decisions and history* — why things are the way they are, what the user has ruled in or out, what bit us before. That's the part worth trusting.
>
> It is **not** a status board. An earlier revision claimed only `00-scaffold` existed long after nine more steps had shipped, and an agent reading it cold repeated that to the user as fact. So: for anything about current scope — which steps exist, what the harness checks, what's done — go to the tree (`scripts/install-steps/`, `scripts/test.mjs`, `git log`). Where this file has to describe current state, it points at the authoritative location instead of listing. Keep it that way when you edit it.

## TL;DR

1. Two repos: `supertools-design` (orchestration plugin for Claude Code) and `supertools-stack` (this repo — canonical TanStack Start + CF Workers + D1 + Drizzle + Better Auth template).
2. The install pipeline is **modular** — install-steps live in `scripts/install-steps/<NN>-<name>.mjs` and write per-step receipts to `<project>/.supertools-state/`. Re-running the install picks up where it left off.
3. **`install.sh` produces a working app, not a scaffold.** Scaffold, D1 + Drizzle, foundation (logging / request IDs / security headers / error pages), Better Auth, email transport, password reset, auth hardening, marketing pages, dashboard + delete-account, and legal content have all shipped.
4. **Never enumerate the steps from memory or from this file.** `scripts/install-steps/` is the source of truth; the orchestrator discovers whatever is there and runs it in numeric-prefix order. Run `ls scripts/install-steps/*.mjs` before saying anything about pipeline scope.
5. Pattern: each new install-step lands as one commit that leaves `node scripts/test.mjs` green.

## The two repos

### supertools-design (sister repo)

- Live at `https://github.com/nmajor/supertools-design`.
- **Hard prerequisite enforced in every command: Design OS must have produced `product-plan/` with `README.md` and `product-overview.md`, otherwise the command refuses.** This is the load-bearing assumption of the whole two-repo system and has not changed.
- Claude Code plugin (`.claude-plugin/plugin.json`): ships slash commands in `commands/` — `/supertools-design:start`, `:status`, `:bootstrap`, `:logo`, `:tech-stack`, and others. `start` writes a status tracker to `product/supertools/status.md`.
- The wiring layer is **numbered skills under `.skills/<NN>-<name>/`**, each with `SKILL.md`, `requires.json`, `setup.mjs`, and `verify.mjs`. Shared helpers live in `.skills/_shared/`.
- Three tracks: a bootstrap track (`00-prereqs` … `17-launch-verify`, run in dependency order), a post-launch `seo-*` track, and meta-skills (`_collab-review`, `icp-focus-group`).
- `01-project-init` is the skill that consumes this repo: it wraps `supertools-stack/install.sh`, resolving the stack from `$SUPERTOOLS_STACK_DIR`, then `../supertools-stack`, then a fresh GitHub clone.

> There is no `concerns/` directory, and no `80-email` / `70-analytics`. An earlier revision of this file described that architecture; it was superseded by the `.skills/` layout. Read `.skills/` in that repo — or its `README.md`, which keeps the current pipeline table — rather than trusting any list written here.

### supertools-stack (this repo)

- Live at `https://github.com/nmajor/supertools-stack`.
- Bootstraps a project at `<target>` from the canonical stack. Doesn't deploy — deployment is a later supertools-design step.
- Maintained as a **tested artifact**: weekly cron + on-install refresh propose package updates, gated by `scripts/test.mjs`. The point is: when libraries drift, the LLM-driven refresh has a real test as the gate, so updates are safe.
- Consumed by `supertools-design`'s `01-project-init` skill, which is implemented and calls `install.sh` in-place over an existing project root (preserving `research/`, `design/`, `docs/`, `CLAUDE.md`, `.env`, `.skills/`).

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

For the test harness, **mock CF and other external services**. The user is OK with mocking because LLM supervision in `codex-install.sh` is meant to catch real-install failures — note that wrapper is still a stub, so nothing catches them today.

## Current state — supertools-stack

This tree is deliberately shallow. **Directories, not file lists — the contents change and any enumeration here rots.** Run `ls` on the two starred directories before reasoning about scope.

```
.
├── HANDOFF.md                           # this file
├── README.md
├── LICENSE                              # MIT
├── .gitignore
├── package.json                         # type: module, scripts: test, test:unit, refresh
├── install.sh                           # main entry; weekly-gated refresh, then orchestrator
├── codex-install.sh                     # stub — delegates to install.sh
├── customizations/
│   ├── README.md                        # per-step layout convention
│   ├── SCAFFOLD-NOTES.md                # ★ critical — what C3 actually produces
│   └── <step-id>/                       # ★ one subtree per install-step, mirrors the step list
├── scripts/
│   ├── _lib.mjs                         # runCmd, spawnBg(detached), waitForUrl(strict 200), killProcessGroup, pickFreePort
│   ├── orchestrate-install.mjs          # walker that runs install-steps in order
│   ├── render.mjs                       # {{PLACEHOLDER}} substitution + renderTree
│   ├── refresh.mjs                      # stub — LLM-driven dep updater
│   ├── setup-turnstile.mjs              # provisions CF Turnstile keys (used by 27-auth-hardening + the harness)
│   ├── test.mjs                         # the gate; its header comment documents every layer
│   ├── *.test.mjs                       # node --test unit tests (npm run test:unit)
│   └── install-steps/                   # ★ THE PIPELINE — source of truth
│       ├── _step-lib.mjs                # readReceipt, writeReceipt, fileExists, listDir, assertValidStep
│       └── <NN>-<name>.mjs              # discovered and run in numeric-prefix order
├── ralph-harness/                       # de-dockerized 3-agent council build engine
│   ├── council/                         # plan/build/review prompt docs
│   └── ralph-local/                     # runner scripts + lib
└── .github/workflows/refresh.yml        # weekly Mon 12:00 UTC + workflow_dispatch
```

There is **no top-level `tests/` directory.** Test templates live inside the step that owns them (e.g. `customizations/10-db/tests/10-db/cascade-contract.test.ts.tmpl`) and are rendered into the generated project. The repo's own end-to-end gate is `scripts/test.mjs`; its unit tests are `scripts/*.test.mjs`.

### Commit history

Read it from git, not from here:

```sh
git log --oneline
```

### What's verified

`scripts/test.mjs` is the verification. Its header comment enumerates every layer it exercises and which install-step added each one — that comment lives next to the code and is maintained with it, so **treat it as the spec** rather than duplicating the list here.

Confirm current state by running it from the repo root:

```sh
node scripts/test.mjs                    # full cold run (~3 min dominated by the C3 scaffold)
node scripts/test.mjs --reuse-scaffold   # dev inner loop; caches the post-scaffold tree
```

Requires Node ≥22 and outbound network for npm.

### What's NOT verified

- The `install.sh` weekly-refresh path (`.last-refresh` gating, commit/push/rollback logic). `refresh.mjs` is still a no-op stub, so the commit branch never had anything to commit. When refresh.mjs becomes real, that branch may have bugs.
- `codex-install.sh` is still a stub.
- The CI workflow (`.github/workflows/refresh.yml`) — never triggered in CI.
- **L4 (real Playwright e2e).** Still not implemented; L3.6's HTTP probe covers route registration, `head()` wiring, and JSON-LD presence instead. Interactive UI in the dashboard has no browser-level coverage in this repo.
- Real Ahasend sends. The harness deliberately drops to `NoopTransport` so it doesn't spam an inbox; real sends are a manual verify step.
- Security headers and the auth rate limiter under live prod conditions. Both are gated structurally (source-content / binding declaration) because `vite dev` skips headers and miniflare doesn't enforce the ratelimit binding locally.

## Real bugs encountered (and how they were fixed)

These are battle scars — the next agent should know they exist so they're not surprised:

1. **C3 v2.68.1 silently ignores `--framework` when `--accept-defaults` is set.** Solution: don't pass `--accept-defaults`. The framework dispatcher fills in defaults itself. Documented in [customizations/SCAFFOLD-NOTES.md](customizations/SCAFFOLD-NOTES.md).

2. **`@tanstack/create-start` is deprecated** (TanStack moved to `tanstack create` / `npx @tanstack/cli create`). C3 still uses the old one. Tracked in [cloudflare/workers-sdk#12847](https://github.com/cloudflare/workers-sdk/issues/12847). Currently still works; refresh.mjs (when real) should detect the migration.

3. **TanStack Start's router plugin generates `routeTree.gen.ts` during `vite build`.** Running `tsc --noEmit` BEFORE the build fails with "Cannot find module './routeTree.gen'". Fix: build first, typecheck second. (See `scripts/test.mjs`.)

4. **`npm run dev -- --port=N` results in `vite dev --port 3000 --port=N`** because the package.json `dev` script hardcodes `--port 3000`. Vite's behavior with two `--port` flags is unpredictable. Fix: invoke vite directly via `<target>/node_modules/.bin/vite` instead of `npm run dev`.

5. **`child.kill()` doesn't kill grandchildren** (vite spawns workerd via miniflare). Orphans squat ports across runs. Fix: `spawnBg` now uses `detached: true` to put the child in its own process group, and `killProcessGroup` sends SIGTERM to the whole group. (See `scripts/_lib.mjs`.)

6. **`waitForUrl` was too permissive** (returned on any 2xx-5xx response; vite dev returns 404 while routes lazy-compile). Fixed to require strict 2xx by default.

## Test harness contract

`scripts/test.mjs` is the gate everything else depends on. It renders a full install into a tmpdir, then builds, typechecks, sets up the local D1, boots `vite dev` on a random free port, and runs a series of HTTP/DB probes against it.

**The layer list is not reproduced here.** It grew with every install-step and would go stale the moment the next one lands. The authoritative list — every layer, what it asserts, and which step introduced it — is the header comment of [`scripts/test.mjs`](scripts/test.mjs). Read that file.

The stable contract, which is what actually matters to a new step:

- Every install-step you add MUST leave `node scripts/test.mjs` green — *all* layers, not just yours.
- A step's own test templates go in `customizations/<step-id>/tests/<step-id>/`, rendered into the generated project. They do **not** go in a top-level `tests/` directory (there isn't one).
- Runtime probes that need the live dev server are added to `scripts/test.mjs` as a new `L3.x` layer, numbered after the last one.
- Prefer plain HTTP probes over adding a browser dep. Most of what the steps produce is SSR'd static HTML.
- Where a contract can't be observed locally (security headers under `vite dev`, ratelimit bindings under miniflare, real email sends), gate it **structurally** — assert the source or binding declares it — and note that prod-side observation is manual. Several layers already do this; follow the precedent.

Still open: **L4 Playwright** (real browser e2e for interactive dashboard UI) and **L5 real deploy** (deferred — out of scope for the stack repo).

## The plan ahead

The originally agreed step sequence (`10-db` → `20-auth` → `30-marketing` → `40-dashboard` → `50-legal`) is **complete**, plus `15-foundation`, `25-email`, `26-password-reset`, and `27-auth-hardening` which were added along the way.

Known remaining work:

- Real `refresh.mjs` (codex/claude wrapper that bumps deps + runs `test.mjs` + bisects on failure)
- `codex-install.sh` body (codex-supervised install wrapper)
- L4 Playwright in `test.mjs`

Anything beyond that is not decided — ask the user rather than inferring a roadmap from this file.

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

## How to pick up the next slice / add an install step

**First, find out what state the repo is actually in.** Do not assume from this document — it has been wrong before:

```sh
ls scripts/install-steps/*.mjs        # what the pipeline does today
ls customizations/                    # matching template subtrees
git log --oneline -15                 # what landed recently
```

Then the generic recipe for adding a step. Copy the shape from a recent step — [`25-email.mjs`](scripts/install-steps/25-email.mjs) is a clean, small example.

1. **Read** [customizations/SCAFFOLD-NOTES.md](customizations/SCAFFOLD-NOTES.md). It records what C3 actually produces — the real shape of `wrangler.jsonc`, the dev-server port, and the C3 bugs worked around. Almost every step needs something from it.

2. **Verify the harness is green before you change anything.** From the repo root:
   ```sh
   node scripts/test.mjs
   ```
   If it's already red, find out why before adding to it. `--reuse-scaffold` speeds up subsequent runs.

3. **Create `scripts/install-steps/<NN>-<name>.mjs`.** Pick `NN` so the step sorts after everything it depends on — the orchestrator runs numeric-prefix order and rejects a `requires` naming a step that hasn't run yet. Export `id`, `requires`, `provides`, `detect`, `apply`. `detect` returns `{ skip: true }` when `readReceipt` finds a receipt; `apply` does the work and ends with `writeReceipt`, which is what makes re-running the install resumable.

4. **Create `customizations/<NN>-<name>/`** mirroring the paths the files land at in the target project. `.tmpl` files get `{{PLACEHOLDER}}` substitution via `renderTree` from `scripts/render.mjs`; everything else is copied verbatim. Every placeholder must resolve — the renderer throws on leftovers.

5. **Add the step's tests** as templates under `customizations/<NN>-<name>/tests/<NN>-<name>/`, and add any live-server probe to `scripts/test.mjs` as a new `L3.x` layer. See the Test harness contract section above for what to gate structurally vs. at runtime.

6. **One step per commit**, and the commit must leave `node scripts/test.mjs` green — every layer, not just the new one.

7. **Stop and check in with the user** before starting the next step. Don't auto-proceed through a sequence.

## How to recover if test.mjs breaks

If `node scripts/test.mjs` fails after a change you made:

- Read the full log at the path it printed. The grep filter in the harness loses important detail — read the raw `/tmp/sts-test*.log` file to see what actually happened.
- If C3 broke (e.g. flag changes in a new C3 release), fix the orchestrator's invocation in `scripts/install-steps/00-scaffold.mjs`.
- If the dev-server probe times out, suspect orphan vite processes from a previous run squatting ports. Run `pkill -9 -f "/tmp/sts-test"` and re-run the test.
- If you changed `_lib.mjs` and broke the harness, every step's runtime breaks. Roll back that one change before continuing.

## Things deliberately NOT decided yet

- **Codex CLI invocation specifics.** The `codex-install.sh` body and `refresh.mjs` body both depend on the codex CLI's actual flag shape, which we haven't pinned. The user mentioned "codex" specifically — verify which CLI they mean (Anthropic-codex or OpenAI's "Codex"-named tool) before implementing.

Three questions previously listed here were settled by what shipped, not by an explicit decision — revisit them with the user if they matter:

- Pricing tier names shipped as `Free / Pro / Enterprise` placeholders.
- Auth pages shipped with Tailwind layout classes, not fully unstyled.
- `50-legal` stayed a separate step; it overwrites the `terms.tsx` / `privacy.tsx` stubs that `30-marketing` lays down.

## Open task list (carry-over)

| Task | Status |
|---|---|
| Real `refresh.mjs` (codex wrapper) | not started, deferred |
| Real `codex-install.sh` body | not started, deferred |
| L4 Playwright extension | not started; needed for interactive dashboard UI |

Everything else that was on this list has shipped. **Confirm against `git log` and `scripts/install-steps/` rather than trusting this table** — a hand-maintained status list in a doc is exactly what went stale last time.

## Outside-this-repo context to know

- The user is also running supertools-design work in parallel. That repo (`/home/coder/projects/supertools-design/`, also live on GitHub) has a memory dir at `/home/coder/.claude/projects/-home-coder-projects-huepetal-design/memory/` — none of which transfers to a fresh agent in a different working directory.
- The user has a "huepetal-design" working dir that's a Design OS clone — that's where this conversation has been happening. The agent picking up may be in `/home/coder/projects/supertools-stack/` or `/home/coder/projects/provenhooks/` instead.
- If the user asks about historical decisions ("why did we…"), the answers are in this file. If something isn't here and isn't in git history, ask rather than guess.

## License

MIT (this repo and supertools-design). The user owns the templates produced by the install — those land in projects under the user's chosen license.
