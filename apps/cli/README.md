# somm CLI

somm browses and scans skills, compares them in a copied project, and installs them for Claude Code or Codex. See the [project README](../../README.md) for development and sandbox limits.

somm never reads, stores, or relays your login credentials or tokens.

Use Subscription with an already logged-in local CLI, or Isolated with `ANTHROPIC_API_KEY` or `CODEX_API_KEY` in the environment. Quick runs each arm once; Thorough runs each three times. Review the usage notice and subscription quota warning before confirming. A verdict and optional task proposal add agent calls. Secret masking is best-effort; use a budget-limited throwaway key for Isolated. Codex does not enforce the budget option.

Lite is not an OS sandbox: project test scripts can launch arbitrary host subprocesses, and monitoring can miss unlogged accesses. Scripts, hooks and MCP in skills are limited to static checks. Submodules and LFS may be missing. Non-default `CODEX_HOME` access in desktop is unsupported; symlink installs cannot be restored from backup.

```sh
somm search <query> [--agent claude|codex] [--json]
somm scan <skill-id|path> [--json]
somm list [--agent claude|codex] [--project <dir>] [--json]
somm test <skill-id|path> --project <dir> --agent claude|codex [--runs quick|thorough] [--auth subscription|isolated] [--task <text>] [--budget <usd>] [--model <name>] [--yes] [--refresh] [--json]
somm install <skill-id|path> --agent claude|codex --scope global|project [--project <dir>] [--json]
somm remove <name> --agent claude|codex --scope global|project [--project <dir>] [--json]
```

`--task` is required with `--json`; `--yes` skips the confirmation. Exit codes: 0 success, 1 error or incomplete run, 2 blocked or corked. `--json` emits one JSON object with a `somm` field.

Build from the repository root with `pnpm install && pnpm -r build`. Run locally with `node apps/cli/bin/somm.mjs --help`; package with `npm pack --dry-run` from `apps/cli`.
