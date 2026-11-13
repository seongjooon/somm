# somm status

_Updated 2026-11-13. Plan: `docs/superpowers/plans/2026-11-06-somm-mvp.md`; spec: `docs/superpowers/specs/2026-11-06-somm-mvp-design.md`._

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
- 2026-11-09: de-duplicated plugin ids (#28); Installed shows the resolved agent CLI path and generic, path-only CLI errors (#29).

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

1. **Manual Tauri check:** passed, including item 8 (closed by the GUI smoke on 2026-11-13).
2. **Real-subscription GUI smoke:** passed 2026-11-13 for Claude and Codex after two fixes (#34 task proposal path, #35 Codex `.git` probe scope). Results: `docs/experiments/2026-11-12-gui-smoke.md`. Its two UI follow-ups (diff run label, Install emphasis on `corked`) are in #37.
3. **Release (decided 2026-11-12):**
   - Apple Developer account: available. Steps: `docs/experiments/2026-11-12-macos-signing.md`. Not run yet.
   - Legal review: planned. Questions: `docs/experiments/2026-11-12-legal-questions.md`.
   - npm name `somm`: still 404 on 2026-11-12. Re-check right before any `npm publish`; publishing is public and not reversible.
   - Public release timing (decided 2026-11-13): private beta (DMG to a few people) once signing and notarization work; public release after the legal review.
4. **Post-MVP outlines:** T16 Docker Secure sandbox, T17 share card, T18 crawler/public release (plan T16–T18).
5. **Follow-up (deferred, decided 2026-11-09):** Node canary creation uses path checks (`lstat` per component, root containment, `O_CREAT|O_EXCL|O_NOFOLLOW`) and accepts a small check-then-use race; the desktop Rust command is handle-based (`openat` + `O_NOFOLLOW`). Later: give Node the same handle-based protection (needs a native module or new dependency, so decide first). Code: `packages/core/src/node/canaries.ts` (#26).
6. **Backlog from the 2026-11-09 manual check:** done (#28, #29). PATH resolution itself is unchanged: keep agent CLIs on the login-shell PATH (`~/.zprofile`).
7. **Track 2 (after MVP release):** Pocket Somm. Decided 2026-11-12: no server, benchmarks in GitHub Actions (spec §11); server-based parts need redesign. Decided 2026-11-13: mobile stack after P0 validation; PRD amended only after the MVP release. Draft: `docs/superpowers/specs/2026-11-09-track2-pocket-somm-design.md`.

## Known limits and risks

- Desktop Codex enumeration can probe `.git` above the data dir but cannot read `.agents/skills` there; only matters if a folder above it (for example a git-managed home) is a git repo (#35).
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

## Worktrees

None besides `main`. `fix-native-demo-preparation` and `fix-tauri-cache-hidden` were deleted on 2026-11-12 by the user's decision (no unmerged commits; diagnostics backup kept at `~/somm-backup-native-demo-202611090958/`).

## Working agreements

Claude leads and reviews; Codex implements and reviews (AGENTS.md Tooling). One task = one worktree/branch/PR. Use a Codex advisor review before merge; the lead re-verifies on `origin/main` before merging.
