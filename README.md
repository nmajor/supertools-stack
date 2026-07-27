# supertools-stack

The canonical app stack used by [supertools-design](https://github.com/nmajor/supertools-design) project bootstraps. Maintained as a *tested artifact* — a weekly cron and an on-install refresh propose package updates, both gated by a real functional test suite. When tests pass, the refreshed template is what users get.

## Status

`install.sh` produces a **working local app**, not a bare scaffold. It hands off to `scripts/orchestrate-install.mjs`, which discovers every `<NN>-<name>.mjs` file in [`scripts/install-steps/`](scripts/install-steps/) and applies them in numeric-prefix order. Each step renders its own subtree from `customizations/<step-id>/` and writes a receipt to `<project>/.supertools-state/<step-id>.json`, so **re-running the install resumes from where it stopped** — completed steps detect their receipt and skip.

`scripts/install-steps/` is the authoritative list of what ships. To see it, don't trust this file — ask the tree:

```sh
ls scripts/install-steps/*.mjs                              # the pipeline, in run order
grep -H '^export const provides' scripts/install-steps/*.mjs  # what each step contributes
```

<details>
<summary>Snapshot of the pipeline as of 2026-07-27 — verify against the directory above before relying on it</summary>

| Step | Provides |
|---|---|
| `00-scaffold` | TanStack Start app via C3 (`npm create cloudflare@latest`), `wrangler.jsonc` |
| `10-db` | D1 binding, Drizzle ORM, Better Auth schema with cascade FKs |
| `15-foundation` | structured logging, request IDs, security headers, error pages |
| `20-auth` | Better Auth server, auth routes, sign-in / sign-up pages |
| `25-email` | pluggable email transport (Ahasend + noop) |
| `26-password-reset` | forgot-password / reset-password flow |
| `27-auth-hardening` | auth rate limiting, Turnstile on signup |
| `30-marketing` | marketing pages, nav, footer, SEO head |
| `40-dashboard` | dashboard, settings page, delete-account flow |
| `50-legal` | terms + privacy page content |

</details>

Still stubs: `scripts/refresh.mjs` (no-op) and `codex-install.sh` (delegates straight to `install.sh`).

## Use

```sh
git clone https://github.com/nmajor/supertools-stack.git
cd supertools-stack
./install.sh ~/projects/my-app
```

Flags:
- `--no-refresh` — skip the once-weekly dependency refresh.
- `--refresh` — force a refresh now even if it ran less than 7 days ago.

A codex-supervised variant is stubbed out at `./codex-install.sh` — the intent is for codex to watch the install output, diagnose failures, and propose template fixes. It currently delegates to `install.sh` unconditionally.

## How it stays current

- **Weekly cron** in `.github/workflows/refresh.yml` proposes package updates, runs the test suite, pushes if green.
- **Local install** auto-refreshes at most once every 7 days (gated by `.last-refresh`).
- Both paths use the same `scripts/test.mjs` as the gate. Refresh only commits if tests pass.

## Layout

| Path | Purpose |
|---|---|
| `install.sh` | Main entry. Optional weekly dep refresh, then hands off to the orchestrator. |
| `codex-install.sh` | Codex-supervised variant. Currently a stub that delegates to `install.sh`. |
| `scripts/orchestrate-install.mjs` | Walks `scripts/install-steps/` in numeric order. Heavy lifting for `install.sh`. |
| `scripts/install-steps/` | **The pipeline — source of truth for what the install does.** One `<NN>-<name>.mjs` per step; `_step-lib.mjs` holds the receipt/validation contract. |
| `customizations/<step-id>/` | Files each step layers onto the scaffold output. `.tmpl` files get `{{PLACEHOLDER}}` substitution; everything else is copied verbatim. |
| `scripts/test.mjs` | The gate: renders a full install into a tmpdir, then builds, typechecks, and probes the running app over HTTP. Layers are documented in its header comment. |
| `scripts/*.test.mjs` | Node `--test` unit tests for the orchestrator and renderer (`npm run test:unit`). |
| `scripts/refresh.mjs` | LLM-driven dep updater — currently a no-op stub. |
| `scripts/render.mjs` | Placeholder substitution helper for customizations. |
| `ralph-harness/` | De-dockerized 3-agent council build engine (plan/build/review prompts + local runner scripts). |

There is no top-level `tests/` directory. Test *templates* ship inside the step that owns them (e.g. `customizations/10-db/tests/10-db/cascade-contract.test.ts.tmpl`) and are rendered into the generated project; the end-to-end gate lives in `scripts/test.mjs`.

## Why a separate repo

`supertools-stack` is what a working app looks like; `supertools-design` is the orchestration around getting there. Independent CI, independent versioning, independent reusability — you can clone `supertools-stack` directly and skip `supertools-design` if you only want the bootstrap.

## License

MIT — see [LICENSE](LICENSE).
