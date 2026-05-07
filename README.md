# supertools-stack

The canonical app stack used by [supertools-design](https://github.com/nmajor/supertools-design) project bootstraps. Maintained as a *tested artifact* — a weekly cron and an on-install refresh propose package updates, both gated by a real functional test suite. When tests pass, the refreshed template is what users get.

## Status

**v0.1 — skeleton.** `install.sh` runs `npm create cloudflare@latest --framework=tanstack-start` and stops there. The customizations layer (D1, Drizzle, Better Auth, marketing pages, dashboard, settings + delete-account flow, legal docs) lands in v0.2+.

## Use

```sh
git clone https://github.com/nmajor/supertools-stack.git
cd supertools-stack
./install.sh ~/projects/my-app
```

Flags:
- `--no-refresh` — skip the once-weekly dependency refresh.
- `--refresh` — force a refresh now even if it ran less than 7 days ago.

For codex-supervised installs (v0.2+):

```sh
./codex-install.sh ~/projects/my-app
```

Codex watches the install output, diagnoses failures, and can propose template fixes. Falls back to `install.sh` if codex isn't installed.

## How it stays current

- **Weekly cron** in `.github/workflows/refresh.yml` proposes package updates, runs the test suite, pushes if green.
- **Local install** auto-refreshes at most once every 7 days (gated by `.last-refresh`).
- Both paths use the same `scripts/test.mjs` as the gate. Refresh only commits if tests pass.

## Layout

| Path | Purpose |
|---|---|
| `install.sh` | Main entry. Runs the cloudflare scaffolder, then layers customizations. |
| `codex-install.sh` | Codex-supervised variant. Falls back to `install.sh` if codex absent. |
| `scripts/orchestrate-install.mjs` | Heavy lifting for `install.sh`. |
| `scripts/test.mjs` | Render an install into tmpdir, verify it boots. |
| `scripts/refresh.mjs` | LLM-driven dep updater (v0.2+ — currently a stub). |
| `scripts/render.mjs` | Placeholder substitution helper for customizations. |
| `customizations/` | Files layered on top of the cloudflare scaffold output. |
| `tests/` | Functional + e2e suite. Tests mock external services (Cloudflare API, Ahasend, etc.). |

## Why a separate repo

`supertools-stack` is what a working app looks like; `supertools-design` is the orchestration around getting there. Independent CI, independent versioning, independent reusability — you can clone `supertools-stack` directly and skip `supertools-design` if you only want the bootstrap.

## License

MIT — see [LICENSE](LICENSE).
