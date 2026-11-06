# somm STATUS

_Last updated: 2026-11-06 (lead session 1)_

## Done
- PRD updated: Auth (Subscription/Isolated) and Runs (Quick/Thorough) options, three verdict lines.
- Spec confirmed: `docs/superpowers/specs/2026-11-06-somm-mvp-design.md`
- Plan approved: `docs/superpowers/plans/2026-11-06-somm-mvp.md` (T1–T15 in Waves 0–8, T16–T18 outlined)
- `AGENTS.md`: monorepo stack, Multi-agent and Tooling rules.
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
1. **Wave 1:** T2, then T3. Each goes through Paseo handoff to Codex, in its own worktree from `origin/main`. Check each with `/paseo-advisor`, then the lead merges without waiting for the user. If tests fail before merge, stop and report.
2. Wave 2: T4 ∥ T5.

## Open items
- Not verified in T1: both Isolated combos (no API key), whether Codex `--ignore-user-config` drops `config.toml` MCP servers, and side effects of the temp `HOME` on agent shell commands.
- Before release: spec §13 checklist (Apple Developer account at $99/yr, recheck the OpenAI terms, secure the npm name `somm`).
- Installing ui-ux-pro-max (T11) and the real-subscription smoke tests (T10, T15) need user approval first.
