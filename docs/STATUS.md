# somm status

_Updated 2026-11-09. Plan: `docs/superpowers/plans/2026-11-06-somm-mvp.md`; spec: `docs/superpowers/specs/2026-11-06-somm-mvp-design.md`._

Implementation T1–T15 is merged and code-complete. The manual Tauri check passed on 2026-11-09 (#26 branch). Remaining work needs the user: the real-subscription GUI smoke and the release decisions below.

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
- 2026-11-09: source size cap in `readTree` plus an Installed notice for unreadable skills (#25); native sandbox canary commands, sandbox git config restore, explicit app command manifest (#26). Manual check: `docs/experiments/2026-11-08-tauri-manual-check.md`.

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

1. **Manual Tauri check:** passed 2026-11-09 except item 8 (data folder side effects), still to confirm.
2. **Real-subscription GUI smoke (needs user approval):** the demo plus a sample skill, Quick, once for Claude and once for Codex, using cheap models (`claude-haiku-5-5`, `gpt-6-luna`). It uses subscription quota. Record results in `docs/experiments/`.
3. **Release decisions (spec §13, user):**
   - Apple Developer account, DMG, signing and notarization. `hdiutil` failed in the agent sandbox; retry in a normal terminal.
   - npm name `somm`: returned 404 on 2026-11-07. Re-check right before any `npm publish`. Publishing is public and not reversible; decide first.
   - Subscription automated use is a grey area for both vendors (`docs/experiments/2026-11-07-terms-recheck.md`). Consider legal advice before public release.
   - Public release timing.
4. **Post-MVP outlines:** T16 Docker Secure sandbox, T17 share card, T18 crawler/public release (plan T16–T18).
5. **Follow-up (deferred, decided 2026-11-09):** Node canary creation uses path checks (`lstat` per component, root containment, `O_CREAT|O_EXCL|O_NOFOLLOW`) and accepts a small check-then-use race; the desktop Rust command is handle-based (`openat` + `O_NOFOLLOW`). Later: give Node the same handle-based protection (needs a native module or new dependency, so decide first). Code: `packages/core/src/node/canaries.ts` (#26).
6. **Backlog from the 2026-11-09 manual check:** (a) the app resolves agent CLIs from the login-shell PATH, so a stale `/usr/local/bin/codex` (revoked signature, blocked by macOS as malware) or `claude` was used while `~/.npm-global/bin` was only in `.zshrc`; show the resolved binary path and a clear error. (b) Installed → Claude plugins lists `superpowers@claude-plugins-official` 7 times; de-duplicate plugin ids.

## Known limits and risks

- Lite runs the project's test command with host permissions; a modified test script can launch subprocesses (spec §10; README).
- Secret masking is best-effort; use a budget-limited throwaway key for Isolated (spec §10; README). Node-side masking is per event.
- Desktop read scope for a non-default `CODEX_HOME` is missing (README).
- Symlink-installed skills cannot be restored from backup (README; `packages/core/src/agents/restore.ts`).
- Restore does not check symlinks above the skills directory for global/disabled targets (spec §10).
- Fs plugin deny globs are case-sensitive; mixed-case names rely on the custom-command checks (spec §10).
- Codex CLI appends trusted project entries to `~/.codex/config.toml` (`docs/experiments/2026-11-07-cli-smoke.md`, finding 2).
- `readTree` rejects a file that grows between stat and read only after reading it, so that one read is not memory-capped (#25).
- Canary removal (#26, accepted 2026-11-09): `sandbox_canaries_remove` trusts the (dev, ino, token) records the app passes in, so a compromised app frontend could delete a matching file under the canary paths; and Rust has a small window between `fstatat` and `unlinkat`. Both only affect same-named files inside the sandbox copy; cleanup runs after the agent finishes.
- Real smoke has not covered deny-list/outside-directory enforcement, Thorough or Isolated, a real canary hit, or SIGINT.

## Unmerged work in worktrees (do not delete without the user's decision)

- `fix-native-demo-preparation`: merged as #26; the worktree keeps uncommitted temporary run diagnostics (`run_diagnostic`, `diagnosticSetup`), intentionally not merged. Backup: `~/somm-backup-native-demo-202611090958/`.
- `fix-source-size-limits`: merged as #25; worktree clean.
- `fix-tauri-cache-hidden`: 13 uncommitted files, a rejected native cache IPC approach (superseded by #19). Kept on the user's decision (2026-11-09).
- `chore-polish-backlog`, `docs-terms-recheck`: worktrees removed 2026-11-09 (local branches kept).

## Working agreements

Claude leads and reviews; Codex implements and reviews (AGENTS.md Tooling). One task = one worktree/branch/PR. Use a Codex advisor review before merge; the lead re-verifies on `origin/main` before merging.
