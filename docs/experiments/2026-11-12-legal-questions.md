# Questions for legal review

The user plans a legal review before public release (2026-11-12). Background and sources: `2026-11-07-terms-recheck.md`. Not legal advice.

## What somm does
- A local desktop app and CLI. It launches the user's own, unmodified `claude` and `codex` CLIs on the user's machine with the user's own subscription login.
- The README states that somm never reads, stores, or relays login credentials or tokens (not yet audited for every path). A separate Isolated mode uses an API key the user enters.
- One comparison runs the same task with and without a skill: Quick is 2 A/B runs (3-4 agent calls), Thorough is 6 A/B runs, plus verdict and task-proposal calls. The user starts every run and sees the run count first.

## Questions
1. **Anthropic:** Does launching `claude -p` locally for repeated comparisons count as permitted use of the user's own subscription, or as "automated or non-human means" under the Consumer Terms? Does it fall under the Claude Code legal page's statement that an end user may sign in to the unmodified binary?
2. **OpenAI:** How does the Terms of Use clause against automatically or programmatically extracting Output apply to `codex exec` output that somm reads to compare results?
3. **Product name and wording:** Is "somm" clear to use, and is the sentence "works with Claude Code and Codex" acceptable without vendor logos?
4. **Skill index:** The store lists public skills from many repositories. What must we check per repository (license, attribution, caching, removal requests) before showing descriptions or copying files?
5. **npm:** Any risk in publishing the CLI as `somm` (still unregistered on 2026-11-12)?
6. **Release terms:** What should the app's own terms and README say about quota use and the subscription grey area?

## Bring to the meeting
- `2026-11-07-terms-recheck.md` (quoted vendor terms with links)
- README and `docs/PRD.md`
