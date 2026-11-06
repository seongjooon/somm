# AGENTS.md

## Project
somm: a desktop "app store + fitting room" for agent skills.
Browse skills from many sources, A/B test them in a sandbox on the user's own project, check security, then one-click install into Claude Code or Codex.
Mascot: **Sir Somm**, a monocled sommelier. Verdict lines: `// somm: pairs well` (recommend), `// somm: needs to breathe` (conditional), `// somm: corked` (not recommended or blocked).
Source of truth: `docs/PRD.md`. Read it before planning. Do not build anything listed under "MVP excluded".

## Stack
- pnpm workspace monorepo: `packages/core` (pure TS engine), `apps/desktop` (Tauri 2 + Vite + Svelte 5 + Tailwind CSS), `apps/cli` (Node CLI `somm`).
- All store, scan, sandbox, A/B and install logic lives in `packages/core`. Apps only display.
- SQLite shared by both apps: tauri-plugin-sql (desktop), `node:sqlite` (CLI).
- Logic lives in TypeScript. Keep Rust to plugin registration and commands that truly need it.
- Prefer official Tauri plugins (shell, fs, sql, http) over custom Rust.

## Token-saving rules
- Max ~300 lines per file. Split by feature: `packages/core/src/<area>/`, `apps/desktop/src/features/<name>/`, `apps/cli/src/commands/<name>.ts`.
- File, process and DB access go through the `packages/core/src/platform/` interfaces. External integrations (agents, sources, sandbox) live in their own core folder behind one interface each.
- Minimal dependencies. No large UI component libraries.
- No speculative abstractions, config options, or comments that restate code.
- Read only the files you need. Do not dump whole directories.

## Behavior (Karpathy guidelines)
1. **Think before coding.** State assumptions. If unclear, stop and ask. Present tradeoffs instead of picking silently.
2. **Simplicity first.** Minimum code that solves the task. If 200 lines could be 50, rewrite.
3. **Surgical changes.** Touch only what the task needs. Match existing style. Mention unrelated issues, don't fix them.
4. **Goal-driven.** Turn tasks into verifiable checks (tests first where it matters). Loop until verified.

## Workflow
- Claude plans: specs in `docs/superpowers/specs/`, plans in `docs/superpowers/plans/`.
- Codex implements one plan task at a time, in its own worktree/branch.
- Every task ends with: tests/build passing, a short summary, and what was not verified.
- Commit messages: Conventional Commits (`feat:`, `fix:`, `docs:`...).

## Multi-agent
- One implementation task = one workspace = one worktree = one branch (base: `origin/main`).
- Each task lists the files/folders it may modify. Do not modify files outside that scope; ask the lead via `paseo send` instead.
- Reviewers and advisors never modify files.
- Only the lead merges. Before merging: rebase onto `origin/main`, then tests must pass.

## Tooling
- superpowers: use only brainstorming, writing-plans, systematic-debugging, test-driven-development, and the code review skills. Do not use subagent-driven-development or the subagent execution in executing-plans.
- Implementers are started only through Paseo handoff.
- Roles: Claude is the brain (lead, planning, review, hard implementation). Codex runs light, well-specified implementation on Claude's instructions.
- Models (main and sub agents): Claude `claude-sonnet-5-5` with thinking `low`; Codex `gpt-6.1-terra` with thinking `low`.
- Use Codex actively for every agent role it can do, main or sub: implementation, review/advisor, verification runs and lead chores. Use Claude only for what Codex cannot do or when Codex is at its limit (user decision 2026-11-07).
- Fallback: if Codex hits its usage limit first, hand the remaining work to Claude (same models rule), and switch back when Codex is available.
- Review defaults to one read-only `/paseo-advisor` run by Codex (`gpt-6.1-terra`). Use `/paseo-committee` only for hard bugs.
- One task = one session. Archive the session when the task is done.

## Language
- Talk to the user in Korean.
- Code, identifiers, comments, commit messages in English. UI strings in English first, with i18n keys.

## Commands
- Install: `pnpm install`
- Desktop dev: `pnpm --filter desktop tauri dev`
- Web-only dev: `pnpm --filter desktop dev`
- Tests: `pnpm -r test`
- Type/Svelte checks: `pnpm -r check` (no separate lint command yet)
- Build: `pnpm -r build`
- CLI help: `node apps/cli/dist/cli.js --help`
- Rust check: `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`
- Rust tests: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`
