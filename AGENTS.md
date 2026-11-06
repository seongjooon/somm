# AGENTS.md

## Project
somm: a desktop "app store + fitting room" for agent skills.
Browse skills from many sources, A/B test them in a sandbox on the user's own project, check security, then one-click install into Claude Code or Codex.
Mascot: **Sir Somm**, a monocled sommelier. Result lines use `// somm: pairs well` (pass) and `// somm: corked` (blocked).
Source of truth: `docs/PRD.md`. Read it before planning. Do not build anything listed under "MVP excluded".

## Stack
- Tauri 2 + Svelte 5 + TypeScript + Tailwind CSS, SQLite via tauri-plugin-sql
- Logic lives in TypeScript. Keep Rust to plugin registration and commands that truly need it.
- Prefer official Tauri plugins (shell, fs, sql, http) over custom Rust.

## Token-saving rules
- Max ~300 lines per file. Split by feature: `src/features/<name>/`.
- All external integrations (agents, sources, docker, scanners) go behind one interface in `src/adapters/`.
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

## Language
- Talk to the user in Korean.
- Code, identifiers, comments, commit messages in English. UI strings in English first, with i18n keys.

## Commands
<!-- Fill in after scaffolding: dev, build, test, lint -->
