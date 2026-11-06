# somm STATUS

_Last updated: 2026-11-07 (after T11)_

## Done
- PRD updated: Auth (Subscription/Isolated) and Runs (Quick/Thorough) options, three verdict lines.
- Spec confirmed: `docs/superpowers/specs/2026-11-06-somm-mvp-design.md`
- Plan approved: `docs/superpowers/plans/2026-11-06-somm-mvp.md` (T1–T15 in Waves 0–8, T16–T18 outlined)
- `AGENTS.md`: monorepo stack, Multi-agent and Tooling rules.
- **T10 CLI `test`/`install`/`remove` merged (PR #9, plus fixes)** and **T11 design system merged (PR #10)**; both done by the previous Codex lead session / this session. T10 Step 3 (real subscription smoke) is NOT done: a Codex Quick run was interrupted by a usage limit; no smoke doc exists yet.
- **Wave 4 done.** T8 A/B run engine (PR #7), T9 CLI `search`/`scan`/`list` and Node guard (PR #8). `@somm/core` now exports agents, scan, sources, sandbox and runner. 296 tests pass; each task had one Claude advisor review (all APPROVE WITH FIXES, fixes applied).
- **Wave 3 done.** T6 sources and ranking with binary skill file support (PR #6, changed the `hashFiles` format on purpose, pre-release), T7 Lite sandbox (PR #4), T7b sandbox hardening (PR #5: arms are diffed through the base git dir; link checks use real paths).
- **Wave 2 done.** T4 agent adapters and T5 static scan merged in PR #3, together with Wave 1 platform fixes. Codex reviews and integrated tests passed (137 TypeScript tests, 6 Rust tests, check and build).
- **Wave 1 done.** T2 monorepo scaffold and shared contracts (PR #1), T3 Node/Tauri platform implementations (PR #2). Each was reviewed once by `/paseo-advisor` (APPROVE WITH FIXES); fixes were applied before merge. Plan Task 3 now carries follow-up notes for later tasks.
- **T1 isolation experiments (Wave 0) done.** Results: `docs/experiments/2026-11-06-isolation.md`. Fixtures: `packages/core/fixtures/agent-events/`. Script: `scripts/experiments/isolation.sh`.

## Decisions from T1 (user-approved)
1. **Claude Subscription:** keep `HOME` and `CLAUDE_CONFIG_DIR` (changing either loses the keychain login). Use `--setting-sources project,local --strict-mcp-config --no-session-persistence`. **Isolated Claude:** no `--bare` (it drops project skills). Use the same flags plus `ANTHROPIC_API_KEY`. Verify in T10.
2. **Codex Subscription:** `HOME=<tmp>`, original `CODEX_HOME`, `--ephemeral --ignore-user-config`. Accept the shared residue (`$CODEX_HOME/skills`, `$CODEX_HOME/AGENTS.md`).
   - Supplement: always show the shared residue list (count and names) on the results screen and in `--json`.
   - If the target skill is already in the residue, stop before any agent call and warn (spec 5.3, plan T8/T10/T14).
3. **Honeypot:** use option 2 for both agents, and also plant option-1 fake files in Codex's temp `HOME`.
- Supplement: inject `GIT_AUTHOR_*`/`GIT_COMMITTER_*` = `somm`/`somm@localhost` for all git work in the copy (T7 `SANDBOX_GIT_ENV`, T8 arm env).
- Supplement: running `claude auth status --json` and `codex login status` in `detect()` is a mandatory pre-check (T4 Step 5). `runAB` calls it first (T8).
- `npx skills` (N1): on hold. Use only its path table as a reference.

## Next
1. **T10 Step 3:** real subscription smoke (`claude` and `codex` Quick, 1 run each, `demos/ts-mini` + a sample skill, check `~/.claude`/`~/.agents`/`~/.codex` unchanged) and write `docs/experiments/2026-11-xx-cli-smoke.md`. Needs the user's approval (uses subscription quota).
2. **Wave 6:** T12 store and detail screens ∥ T13 installs screen. Then T14 runner and results, T15 integration (GUI smoke needs approval).

## Open items
- Not verified in Wave 3/4: real `claude`/`codex` runs through the run engine (fake processes only), Tauri `Proc` signal/env handling, `AbortSignal.any` in the Tauri webview, real tool-input key names (`command`/`cmd`) behind the canary `security ` rule, Lite sandbox wired to the runner (fake sandbox only). Confirm in the T10 smoke.
- Accepted limits: an arm `.gitignore` can hide its own changes from the diff; test commands run in the arm with host permissions (inherent to Lite; Docker comes later).
- Core `readTree` has no file size cap (a huge file in a scanned skill can exhaust memory). `lite.test.ts` is over 300 lines.
- Agent roles: Claude plans/reviews/does hard work, Codex does light work; if Codex hits its limit, continue with Claude (see AGENTS.md Tooling).
- Not yet verified: real cross-volume T4 move (EXDEV is simulated); Tauri GUI and scoped filesystem runtime. Disabled broken links require the target to be restored before re-enabling.
- Not verified in Wave 1: Finder-launched app, real agent CLIs through `spawn_agent`, runtime read of `~/.codex/skills`, non-default `CODEX_HOME` read scope (handle before T14).
- Not verified in T1: both Isolated combos (no API key), whether Codex `--ignore-user-config` drops `config.toml` MCP servers, and side effects of the temp `HOME` on agent shell commands.
- Before release: spec §13 checklist (Apple Developer account at $99/yr, recheck the OpenAI terms, secure the npm name `somm`).
- Installing ui-ux-pro-max (T11) and the real-subscription smoke tests (T10, T15) need user approval first.
