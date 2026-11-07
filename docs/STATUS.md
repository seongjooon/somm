# somm status

_Updated 2026-11-07. Plan: `docs/superpowers/plans/2026-11-06-somm-mvp.md`; spec: `docs/superpowers/specs/2026-11-06-somm-mvp-design.md`._

MVP implementation T1–T15 is merged and code-complete; the user's manual Tauri check and real-subscription GUI smoke remain.

- Wave 0: T1 isolation experiments (`docs/experiments/2026-11-06-isolation.md`).
- Wave 1: T2 scaffold (#1), T3 platforms (#2).
- Wave 2: T4 agents and T5 scanner (#3).
- Wave 3: T6 sources (#6), T7 Lite sandbox and hardening (#4, #5).
- Wave 4: T8 run engine (#7), T9 CLI reads (#8).
- Wave 5: T10 CLI runs (#9, #11, #12), T11 design system (#10); CLI smoke: `docs/experiments/2026-11-07-cli-smoke.md`.
- Wave 6: T12 store/detail (#14), T13 installs (#15); #13 records smoke results.
- Wave 7: T14 runner/results (#16).
- Wave 8: T15 integration and release preparation (#17); GUI smoke remains.

## Run and verify

```sh
pnpm install
pnpm --filter desktop tauri dev
pnpm --filter desktop dev
pnpm -r test
pnpm -r check
pnpm -r build
node apps/cli/dist/cli.js --help
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Run tests with no `SOMM_DATA_DIR` set. The real data directory `~/Library/Application Support/io.github.seongjooon.somm` already exists: an empty DB was created on 2026-11-07 at 10:31; the directory was last modified at 10:51:42. Check its modification time, not its absence, when verifying isolation.

## Next, in order

1. User opens the app with `pnpm --filter desktop tauri dev` and runs a Quick test on the bundled demo. Real-subscription use needs user approval; record results in `docs/experiments/`. The T15 plan calls for Claude and Codex runs, shared CLI/GUI history, screenshots and config checks.
2. Complete spec §13 release checklist: audit and security review, DMG, macOS signing and notarization (Apple Developer account required; `hdiutil` failed in the agent sandbox), recheck OpenAI and Anthropic terms, README principle, public repository/crawler and real index, MIT license, and secure npm name `somm` before `npm publish`.
3. Post-MVP outlines: T16 Docker Secure sandbox, T17 share card, T18 crawler/public release (plan T16–T18).

## Known limits and risks

- Lite runs the project's test command with host permissions; a modified test script can launch subprocesses (spec §10; README).
- Secret masking is best-effort; use a budget-limited throwaway key for Isolated (spec §10; README).
- Node-side masking is per event and cannot join secrets split across events (spec §10; README).
- Desktop read scope for non-default `CODEX_HOME` is missing (README; plan T3).
- Symlink-installed skills cannot be restored from backup (README; `packages/core/src/agents/restore.ts`).
- Restore does not check symlinks above the skills directory for global/disabled targets (spec §10).
- `listInstalled` can list non-skill folders as unreadable entries (`packages/core/src/agents/install.ts`).
- Codex CLI appends trusted project entries to `~/.codex/config.toml` (CLI smoke finding 2).
- `readTree` has no file size cap (`packages/core/src/sources/fetch.ts`).
- `packages/core/src/sandbox/lite.test.ts` exceeds 300 lines (AGENTS.md file-size guideline).
- Results table formats token counts with decimals (`apps/desktop/src/features/results/Page.svelte`).
- Real smoke has not covered deny-list/outside-directory enforcement, Thorough or Isolated, a real canary hit, or SIGINT (CLI smoke).

## Working agreements

Claude leads and reviews; Codex implements and reviews (AGENTS.md Tooling). One task = one worktree/branch/PR. Use a Codex advisor review before merge; the lead re-verifies on `origin/main` before merging.
