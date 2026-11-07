# Terms recheck

Research date: 2026-11-07. This is not legal advice. Verdicts are preliminary interpretations for the described local, unmodified CLI workflow, not vendor approval. All links below were accessed on 2026-11-07; live pages can change and their historical wording was not independently archived.

| Question | Verdict | Quoted evidence and source |
| --- | --- | --- |
| Anthropic: subscription and automation | grey area | Consumer Terms prohibit, absent an API key or explicit permission, “access the Services through automated or non-human means, whether through a bot, script, or otherwise.” [Consumer Terms](https://www.anthropic.com/legal/consumer-terms). Claude Code's legal page says: “Advertised usage limits for Pro, Max, and Ultra plans assume ordinary, individual usage of Claude Code and the Agent SDK.” It also says an end user may sign in to the unmodified binary with their own subscription, but prohibits developers routing requests through consumer plan credentials on users' behalf and collecting or intermediating credentials. [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance). Whether somm's local orchestration is explicitly permitted automation or prohibited routing is not settled by those statements. Six runs alone do not establish ordinary use or a breach. |
| Anthropic: Pro/Max and headless | grey area | “Pro and Max plan subscribers have access to use Claude Code directly in the terminal.” [Anthropic support](https://support.anthropic.com/en/articles/11145838-using-claude-code-with-your-max-plan). This establishes subscription access, not express permission for somm's specific automated subscription workflow. |
| OpenAI: noninteractive and authentication | grey area | “`codex exec` reuses saved CLI authentication by default.” [Non-interactive mode](https://developers.openai.com/codex/noninteractive/). The [Terms of Use](https://openai.com/policies/terms-of-use/) prohibit “Automatically or programmatically extract data or Output” and say “You may not share your account credentials or make your account available to anyone else”. They also prohibit circumventing rate limits. The relationship between that extraction restriction and this documented CLI workflow is not explicitly resolved here; do not claim blanket approval. |
| Anthropic branding | allowed | “You can accurately say, in plain text, that your product has Claude Code preinstalled or that it runs Claude Code.” [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance). Descriptive compatibility language is a reasonable inference, subject to the same page's restrictions on names, logos and implied endorsement; this is not a trademark clearance. |
| OpenAI branding | grey area | “We do not permit model names in app titles because there is concern that it confuses end users.” [Design Guidelines](https://openai.com/brand/). `somm` is a separate title; the guideline does not expressly approve the precise compatibility sentence. Avoid logos or an implication of endorsement and obtain clearance. |
| npm name | grey area | For unscoped names, npm says choose one that “Is not spelled in a similar way to another package name” and “Will not confuse others about authorship”. [Package name guidelines](https://docs.npmjs.com/package-name-guidelines/). A prior registry 404 is not a reservation, similarity search, trademark clearance, or guarantee of acceptance. From the package directory, check without publishing: `npm publish --dry-run`. |
| Public skills and metadata | grey area | “Licensee matches the contents of a project's `LICENSE` file” but “does not take into account the licenses of project dependencies”. [GitHub license API](https://docs.github.com/en/rest/licenses/licenses). A public repository or detected license alone does not establish rights in all files, descriptions, logos, or third-party material; check license notices, hosting/API terms and rate limits, attribution, and any restrictions on copying, caching or redistribution. |

## What this means for somm

- Keep the README claim that somm never reads, stores, or relays login credentials or tokens only if verified for every relevant path; distinguish the separate Isolated API-key flow.
- Keep the local, unmodified binary and user-owned login design; do not collect or relay Claude credentials or pay for users' subscription usage.
- Soften the spec's suggestion that subscription automation is permitted: ask Anthropic and counsel whether launching `claude -p` locally for repeated comparisons is covered by the explicit exception.
- Ask OpenAI and counsel how the extraction clause applies to `codex exec` output consumed by somm under a personal plan.
- Show total agent calls and quota implications before a test; avoid bypassing rate limits. Six A/B runs can be accompanied by verdict and proposal calls.
- Use plain descriptive compatibility wording, avoid vendor logos and implied affiliation, and ask counsel to review marks and the product name.
- Audit each indexed repository and metadata source, including missing or nested licenses, notices, hosting terms and removal requests; obtain permission where rights are unclear.
- Recheck npm availability, similar names and trademarks before release; a dry run does not reserve a name.

## Could not verify

- The exact legal classification of the described third-party, user-initiated headless subscription workflow, including six runs, for either provider; no vendor-specific authorization was obtained.
- Historical snapshots of all cited pages as of the stated research date, the applicable regional terms, and every indexed repository's rights. Some live legal pages display later revision dates; do not treat later language as proof of earlier terms.
- Independent npm similarity or trademark clearance, actual publication acceptance, or an end-to-end audit of the README credential claim. No CLI agent or publish command was run.
