# customizations/

Files layered on top of the `npm create cloudflare@latest --framework=tanstack-start` scaffold output. Organized **per install-step** so each step's templates, code, and tests stay collocated.

## Convention

```
customizations/
├── SCAFFOLD-NOTES.md      # what the cloudflare scaffolder produces, verbatim
└── <step-id>/             # one subdir per install-step, named exactly for it
    ├── <paths mirroring where the files land in the target project>
    └── tests/<step-id>/   # test templates, rendered into the target project
```

- One subdir per entry in `scripts/install-steps/`, named identically (`10-db/` ↔ `10-db.mjs`). To see which exist, `ls` this directory — there is deliberately no list of them in this file.
- Paths inside a step subdir mirror their destination in the generated project.
- Files ending in `.tmpl` are rendered with `{{PLACEHOLDER}}` substitution by `scripts/render.mjs`. Strip the `.tmpl` suffix on output.
- All other files are copied verbatim.
- Every `{{PLACEHOLDER}}` must resolve at install time — `render.mjs` throws on any leftover.

Each step's `apply()` imports `renderTree` from `scripts/render.mjs`, renders its own `customizations/<step-id>/` subtree into the project, and finishes by writing a receipt. See `scripts/install-steps/_step-lib.mjs` for the contract and `scripts/install-steps/25-email.mjs` for a small worked example.

A step subdir is not required — `00-scaffold` has none, because the cloudflare scaffolder *is* its output.

## Adding a new install step

1. Create `scripts/install-steps/<NN>-<name>.mjs` exporting `id`, `requires`, `provides`, `detect`, `apply`. Choose `NN` so the step sorts after everything in its `requires`.
2. Create `customizations/<NN>-<name>/` with the templates the step renders.
3. Add test templates under `customizations/<NN>-<name>/tests/<NN>-<name>/` — they render into the generated project alongside everything else. There is no top-level `tests/` directory in this repo; the repo's own end-to-end gate is `scripts/test.mjs`, and live-server probes are added there as a new `L3.x` layer.
4. Run `node scripts/test.mjs` — the orchestrator picks up the new step automatically; the test harness exercises it as part of the full pipeline.

## Why per-step folders

The flat-customizations approach (everything mixed under `customizations/`) makes it ambiguous which step owns which file when two steps want to modify adjacent things. Per-step folders make ownership explicit, make removal of a step a clean deletion, and let one step's changes review independently of others.
