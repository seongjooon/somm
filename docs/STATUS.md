# somm STATUS

_Last updated: 2026-11-06 (lead session 1)_

## Done
- PRD updated: Auth (Subscription/Isolated) and Runs (Quick/Thorough) options, three verdict lines.
- Spec confirmed: `docs/superpowers/specs/2026-11-06-somm-mvp-design.md`
- Plan approved: `docs/superpowers/plans/2026-11-06-somm-mvp.md` (T1–T15 in Waves 0–8, T16–T18 outlined)
- `AGENTS.md`: monorepo stack, Multi-agent and Tooling rules.
- No code yet. No implementation agents started.

## Next
1. **T1 isolation experiments (Wave 0)**: the lead runs them directly in the main session, not through a handoff, because they need the user's real `claude`/`codex` subscription login.
   - Follow plan Task 1 and spec §11 (C1–C4, X1–X2, N1).
   - Record results in `docs/experiments/2026-11-06-isolation.md` and update spec §5.2–5.4 and §6.
   - Report the results to the user before Wave 1.
2. Wave 1: T2, then T3. Both run solo through Paseo handoff to Codex, one worktree each from `origin/main`.

## Open items
- Unknown until T1: whether the keychain login survives a `HOME` or `CLAUDE_CONFIG_DIR` change; which Codex events list the loaded skills; which honeypot option (1 or 2) to use.
- Before release: spec §13 checklist (Apple Developer account at $99/yr, recheck the OpenAI terms, secure the npm name `somm`).
- Installing ui-ux-pro-max (T11) and the real-subscription smoke tests (T10, T15) need user approval first.
