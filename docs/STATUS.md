# somm status

_Updated 2026-11-08. Plan: `docs/superpowers/plans/2026-11-06-somm-mvp.md`; spec: `docs/superpowers/specs/2026-11-06-somm-mvp-design.md`._

Implementation T1–T15 is merged and code-complete. Remaining work needs the user: the manual Tauri check, the real-subscription GUI smoke, and the release decisions below.

## Merged

- Wave 0: T1 isolation experiments (`docs/experiments/2026-11-06-isolation.md`).
- Wave 1: T2 scaffold (#1), T3 platforms (#2).
- Wave 2: T4 agents and T5 scanner (#3).
- Wave 3: T6 sources (#6), T7 Lite sandbox and hardening (#4, #5).
- Wave 4: T8 run engine (#7), T9 CLI reads (#8).
- Wave 5: T10 CLI runs (#9, #11, #12), T11 design system (#10). CLI smoke: `docs/experiments/2026-11-07-cli-smoke.md`.
- Wave 6: T12 store/detail (#14), T13 installs (#15).
- Wave 7: T14 runner/results (#16).
- Wave 8: T15 integration and release preparation (#17).
- After Wave 8: Tauri fs dotfile access and deny list (#19); terms recheck brief, not legal advice (#20, `docs/experiments/2026-11-07-terms-recheck.md`); polish backlog (#21: results number format, sandbox test split, install list noise); README brand images (#22).

## Run and verify

```sh
pnpm install --frozen-lockfile
pnpm --filter desktop tauri dev      # run in your own terminal; it does not exit by itself
pnpm --filter desktop dev            # web preview with dev-only fake data
pnpm -r test
pnpm -r check
pnpm -r build
node apps/cli/dist/cli.js --help
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Run tests with no `SOMM_DATA_DIR` set. The real data directory `~/Library/Application Support/io.github.seongjooon.somm` exists (created 2026-11-07 10:31 as an empty DB). Its modification time changes when the app runs, so check that the tests leave it unchanged instead of checking that it is absent.

## Next, in order

1. **Manual Tauri check (user):** follow `docs/experiments/2026-11-08-tauri-manual-check.md` and record results there.
2. **Real-subscription GUI smoke (needs user approval):** the demo plus a sample skill, Quick, once for Claude and once for Codex, using cheap models (`claude-haiku-5-5`, `gpt-6-luna`). It uses subscription quota. Record results in `docs/experiments/`.
3. **Release decisions (spec §13, user):**
   - Apple Developer account, DMG, signing and notarization. `hdiutil` failed in the agent sandbox; retry in a normal terminal.
   - npm name `somm`: returned 404 on 2026-11-07. Re-check right before any `npm publish`. Publishing is public and not reversible; decide first.
   - Subscription automated use is a grey area for both vendors (`docs/experiments/2026-11-07-terms-recheck.md`). Consider legal advice before public release.
   - Public release timing.
4. **Post-MVP outlines:** T16 Docker Secure sandbox, T17 share card, T18 crawler/public release (plan T16–T18).

## Known limits and risks

- Lite runs the project's test command with host permissions; a modified test script can launch subprocesses (spec §10; README).
- Secret masking is best-effort; use a budget-limited throwaway key for Isolated (spec §10; README). Node-side masking is per event.
- Desktop read scope for a non-default `CODEX_HOME` is missing (README).
- Symlink-installed skills cannot be restored from backup (README; `packages/core/src/agents/restore.ts`).
- Restore does not check symlinks above the skills directory for global/disabled targets (spec §10).
- Fs plugin deny globs are case-sensitive; mixed-case names rely on the custom-command checks (spec §10).
- Codex CLI appends trusted project entries to `~/.codex/config.toml` (`docs/experiments/2026-11-07-cli-smoke.md`, finding 2).
- `readTree` has no file size cap (`packages/core/src/sources/fetch.ts`).
- Real smoke has not covered deny-list/outside-directory enforcement, Thorough or Isolated, a real canary hit, or SIGINT.

## Unmerged work in worktrees (do not delete without the user's decision)

- `fix-native-demo-preparation`: 14 uncommitted files, author and purpose not recorded here.
- `fix-source-size-limits`: 7 uncommitted files, likely for the `readTree` size cap; not recorded here.
- `fix-tauri-cache-hidden`: 13 uncommitted files, a rejected native cache IPC approach (superseded by #19).
- Clean, already merged: `chore-polish-backlog`, `docs-terms-recheck`. Safe to remove later.

## Working agreements

Claude leads and reviews; Codex implements and reviews (AGENTS.md Tooling). One task = one worktree/branch/PR. Use a Codex advisor review before merge; the lead re-verifies on `origin/main` before merging.
