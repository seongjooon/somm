# T1 격리 실험 결과 (2026-11-06)

- 환경: macOS (Darwin 27.2.0), Claude Code 2.1.318, codex-cli 0.166.0, Node v26.13.0.
- 로그인: Claude는 claude.ai 구독(키체인), Codex는 ChatGPT 로그인(`~/.codex/auth.json`). `ANTHROPIC_API_KEY`, `CODEX_API_KEY`, `OPENAI_API_KEY`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`은 비어 있었다.
- 스크립트: `scripts/experiments/isolation.sh`. 원본 출력은 저장소 밖(`$SOMM_EXP_OUT`, 기본 `$TMPDIR/somm-isolation`)에 둔다.
- 방식: 실험마다 `mktemp -d` 안에 `git init`한 프로젝트를 만들고 `.claude/skills/somm-probe/`, `.agents/skills/somm-probe/`를 넣는다. 위치 확인용 프로브를 추가로 둔다(`somm-probe-home` = 임시 `HOME` 아래, `somm-probe-config` = 임시 `CLAUDE_CONFIG_DIR` 아래).
- 프롬프트: `Reply with the word ok`. Codex는 이벤트에 스킬 목록이 없어서 `List the names of every skill available to you...`를, 메모리 파일 확인에는 `Quote the first markdown heading of every CLAUDE.md or AGENTS.md...`를 썼다. Claude는 `--model haiku`를 썼다.
- 실제 사용량: Claude 성공 3회(C0 $0.0051, C3 $0.0014, C3M), Codex 성공 3회(X0, X1, X1M). 나머지는 인증 실패로 과금되지 않았다(`total_cost_usd: 0`).
- 실제 설정 폴더 쓰기: 실험 전에 marker 파일을 만들고 실험 후 `find ~/.claude ~/.agents ~/.codex ~/.claude.json -newer <marker>`로 확인했다. 리드 세션이 동시에 돌고 있어서 일부 기록은 잡음이다(아래 표에 따로 표시).

## 결과 요약

| 실험 | 명령 (요지) | 판정 | 근거 |
|---|---|---|---|
| CV | `claude -p --output-format stream-json` (`--verbose` 없이) | 확인 | `Error: When using --print, --output-format=stream-json requires --verbose`, exit 1 |
| C0 | 기본 실행 (비교 기준) | 기준 | init `skills` 65개(사용자 `~/.claude/skills` 30개, `codex:*`, `anthropic-skills:*`, `somm-probe` 포함), `mcp_servers` 2개(`vercel`/user, `claude.ai Claude Docs`/claudeai), `plugins`에 사용자 플러그인 `codex`가 있고, 사용자 SessionStart 훅(`system/hook_started`)이 실행됐다 |
| C1 | `HOME=<tmp>` | **FAIL** | `"error":"authentication_failed"`, `result: "Not logged in · Please run /login"`. 키체인 로그인이 유지되지 않는다. 스킬은 `<tmp>/.claude/skills`(`somm-probe-home`)를 읽는다 |
| C2 | `CLAUDE_CONFIG_DIR=<tmp>` | **FAIL** (로그인) | 로그인 실패는 C1과 같다. `<tmp>/skills`(`somm-probe-config`)는 로드되고 `~/.claude/skills`는 빠진다. 즉 개인 스킬 경로는 `CLAUDE_CONFIG_DIR`을 따른다 |
| C23 | C2 + C3 플래그 | FAIL | 로그인 실패 |
| C3 | 기본 `HOME`, `--setting-sources project,local --strict-mcp-config --no-session-persistence` | **PASS** | 로그인 유지(`result: "ok"`, `apiKeySource: "none"`). `skills` 18개 = 내장 17개 + `somm-probe`. 사용자 스킬 0개, 사용자 플러그인(`codex`) 없음, `mcp_servers: []`, 사용자 에이전트 없음, 훅 이벤트 없음 |
| C3M | C3 + 메모리 질문 | PASS | 답 `none`. 사용자 `~/.claude/CLAUDE.md`는 로드되지 않았다 |
| C4 | stream-json init 이벤트 | **PASS** | `type:"system", subtype:"init"`에 `skills: string[]`, `plugins: {name,path,source,version?}[]`, `mcp_servers: {name,status,source}[]`, `agents: string[]`, `slash_commands`, `tools`, `apiKeySource`, `memory_paths`가 있다 |
| CA | `claude --bare` (API 키 없음) | 확인 | 키체인을 읽지 않는다: `authentication_failed`, `apiKeySource: "none"`. 주의: `--bare`에서는 **프로젝트 스킬 `somm-probe`도 `skills`에 없다**. `plugins`에는 사용자 플러그인 `codex`가 남아 있다(`codex:*` 스킬은 없음) |
| X0 | `codex exec --json --ephemeral -s read-only` (기본) | 기준 | 모델이 답한 목록에 `~/.agents/skills`(paseo, figma 등), 플러그인 스킬(`notion:*`, `superpowers:*` 등), `~/.codex/skills`, `somm-probe`가 모두 있었다 |
| X1 | `HOME=<tmp> CODEX_HOME=~/.codex codex exec --json --ephemeral --ignore-user-config` | **PASS** (잔여 있음) | 로그인 유지. `~/.agents/skills`와 플러그인 스킬이 빠졌고, `somm-probe`와 `somm-probe-home`이 로드됐다. **잔여:** `$CODEX_HOME/skills`의 사용자 스킬 9개와 `.system` 4개가 남는다 |
| X1M | X1 + 메모리 질문 | 잔여 | 답 `# Global Codex Working Agreements`. 즉 `$CODEX_HOME/AGENTS.md`가 로드된다 |
| X2 | Codex JSON 이벤트에 스킬 목록이 있는가 | **FAIL** | 이벤트는 `thread.started`, `turn.started`, `item.completed`(`agent_message`), `turn.completed`(`usage`)뿐이다. 스킬, 플러그인, MCP 목록은 없다 |
| XA | `HOME=<tmp> CODEX_HOME=<tmp>/.codex` | 확인 | `CODEX_HOME` 폴더가 없으면 즉시 `Error finding codex home`. 폴더가 있으면 401 재연결을 10회 반복(WebSocket 5회 + HTTPS 5회)한 뒤 `turn.failed`, exit 1. 빠른 실패가 없다 |

### Codex 잔여 스킬과 `allow_implicit_invocation`
`~/.codex/skills`에는 폴더가 14개, `.system`에는 5개가 있다. 이 가운데 모델 목록에 없던 5개(`claude-brainstorming`, `init-deep`, `systematic-debugging`, `ulw-loop`, `.system/review-agent`)는 모두 `agents/openai.yaml`에 `policy.allow_implicit_invocation: false`가 있다. 따라서 열거는 "SKILL.md가 있고 `allow_implicit_invocation`이 false가 아닌 폴더"로 해야 모델이 보는 목록과 일치한다(이번 측정에서 13개 일치).

### 실제 설정 폴더 쓰기 (`find -newer`)
| 실험 | 기록 | 해석 |
|---|---|---|
| C3, C3M | `~/.claude.json`, `~/.claude/plugins/store/cc-plugin-agents-md_builtin-*.json` | Claude가 시작할 때마다 직접 쓴다. `~/.claude.json`에 임시 프로젝트 항목은 생기지 않았다(직접 확인). `--no-session-persistence` 덕분에 `~/.claude/projects/`에 세션 파일도 없다 |
| C0 | 위 항목 + `backups/.claude.json.backup.*`, `session-env/<id>/sessionstart-hook-1.sh`, `plugins/synced/...` | 사용자 훅과 플러그인 동기화가 원인이다. `projects/-Users-...-somm/*.jsonl`은 리드 세션 잡음이다 |
| C1, C2, C23 | 없음 | |
| X0, X1, X1M | `~/.codex/logs_2.sqlite`, `state_5.sqlite-shm`, `models_cache.json`, `cache/codex_apps_*`, `plugins/cache/.../.codex-remote-plugin-install.json` | `CODEX_HOME`이 실제 폴더라서 생기며 피할 수 없다. 세션(`sessions/`) 기록은 `--ephemeral`로 생기지 않았다 |
| XA, CA | `~/.claude/plugins/known_marketplaces.json` 등 | 다른 프로세스의 잡음이거나 Claude 시작 시 쓰는 캐시다 |

결론: somm이 쓰는 파일은 없다. 다만 에이전트 CLI가 자기 상태 파일(카운터, 캐시, 로그)을 실제 설정 폴더에 쓰는 것은 막을 수 없다. 이것은 알려진 한계로 기록한다.

## Step 4: 조회 명령 (T4 `detect`용, 비과금)

| 명령 | 출력 | 비고 |
|---|---|---|
| `claude auth status --json` | `{loggedIn, authMethod("claude.ai"\|"none"), apiProvider, subscriptionType, email, orgId, orgName, configDirectory, ...}`. 로그인 exit 0, 미로그인 exit 1 | `email`/`orgId`/`orgName`이 들어 있다. somm은 `loggedIn`, `authMethod`, `subscriptionType`만 읽고 나머지는 버린다 |
| `codex login status` | stdout 텍스트 `Logged in using ChatGPT`(exit 0) 또는 `Not logged in`(exit 1) | JSON 옵션 없음. exit code로 판정 |
| `claude plugin list --json` | 배열 `{id, version, scope, enabled, installPath, installedAt, lastUpdated, projectEnabled}` | `--available`은 `--json`이 필요 |
| `codex plugin list --json` | 객체 `{installed: [], available: []}`, 항목 `{name, pluginId, marketplaceName, marketplaceSource, source, version, installed, enabled, installPolicy, authPolicy}` | 텍스트 출력은 마켓플레이스별 표 |

## Step 3: fixture (`packages/core/fixtures/agent-events/`)
비식별화 규칙: `session_id`, `uuid`, `thread_id`, `id` → `REDACTED`. 임시 경로 → `/tmp/somm-run`. `/Users/<name>` → `/Users/REDACTED`. 이메일, `req_*`, `cf-ray` → `REDACTED`.

| 파일 | 출처 | T4 기대값 |
|---|---|---|
| `claude-stream.jsonl` | C3 | `result.usage`: input 2, output 4, cache_creation 6721, cache_read 9012 (합계 15739), `total_cost_usd` 0.00143652, `num_turns` 1, `is_error` false, `result` `"ok"`. inventory: skills 18개(`somm-probe` 포함), plugins 4개(전부 `@builtin`), mcp 0개. `rate_limit_event`(`five_hour`, `seven_day` utilization) 포함 |
| `codex-exec.jsonl` | X1 | `turn.completed.usage`: input 18071, cached 0, output 63, reasoning 0 (합계 18134). 마지막 `agent_message`에 스킬 이름 목록. inventory는 이벤트에 없음 → 열거 방식 |
| `claude-auth-error.jsonl` | C1 | assistant `error: "authentication_failed"`, result `is_error: true`, `result: "Not logged in · Please run /login"`, usage 전부 0, process exit 1 |
| `codex-auth-error.jsonl` | XA | `type:"error"` 401 재연결 10회 → `turn.failed.error.message`에 `401 Unauthorized`, process exit 1 |

## Step 5: N1 `npx skills` (vercel-labs/skills, 실행하지 않음)
- 소스: https://github.com/vercel-labs/skills (MIT, main `d3701c11b110`), `docs/agents.md`, `src/add.ts`, `src/installer.ts`.
- 지원: Claude Code(`.claude/skills/`, `~/.claude/skills/`), Codex(`.agents/skills/`, `~/.agents/skills/`) 외 다수. 비대화식 플래그: `-y/--yes`, `-a/--agent`, `-s/--skill`, `-g/--global`, `--all`, `--copy` (`src/add.ts` 3377–3428행). 기본 설치 방식은 symlink(`src/installer.ts` 296행)이다. 익명 텔레메트리와 보안 감사 요청은 기본으로 켜져 있고, `DISABLE_TELEMETRY=1` 또는 `DO_NOT_TRACK=1`로 끈다.
- **판정: 보류.** 설치 엔진으로 쓰지 않는다. somm은 백업, 덮어쓰기 확인, 등급 게이트를 직접 해야 한다. 또 기본 symlink와 공유 `.agents/skills`는 에이전트 사이 오염을 만들고, 텔레메트리는 기본으로 켜져 있다. 경로표(`docs/agents.md`)만 참고한다.

## Step 6: 확정 사항 (스펙에 반영)
1. **Claude Subscription:** `HOME`과 `CLAUDE_CONFIG_DIR`은 바꾸지 않는다(둘 다 로그인을 잃는다). `claude -p --output-format stream-json --verbose --setting-sources project,local --strict-mcp-config --no-session-persistence`를 쓴다. env에서 `ANTHROPIC_API_KEY`를 제거한다.
2. **Codex Subscription:** `HOME=<run tmp>`, `CODEX_HOME=<원래 값 또는 ~/.codex>`, `codex exec --json --ephemeral --ignore-user-config -s workspace-write -C <arm>`를 쓰고 stdin은 닫는다. 잔여 공통 오염으로 `$CODEX_HOME/skills`와 `$CODEX_HOME/AGENTS.md`가 남는다. 이것은 A와 B 양쪽에 같으므로 "Clean, 공통 n개"로 표시한다.
3. **inventory:** Claude는 init 이벤트의 `skills`, `plugins[].name`, `mcp_servers[].name`(+`agents`)를 쓴다. Codex는 실행 직전에 열거한다: `<arm>`부터 저장소 루트까지의 `.agents/skills/*`, `$HOME/.agents/skills/*`, `$CODEX_HOME/skills/*`, `$CODEX_HOME/skills/.system/*`. 이 가운데 SKILL.md가 있고 `agents/openai.yaml`의 `policy.allow_implicit_invocation`이 false가 아닌 폴더만 센다. 표시에는 "enumerated"라고 단다.
4. **허니팟:** Claude는 `HOME`을 바꿀 수 없으므로 **2안**을 Claude와 Codex 공통으로 쓴다. Codex는 이미 임시 `HOME`을 쓰므로 거기에 1안 가짜 파일(`.ssh/id_rsa`, `.aws/credentials`)을 추가로 둔다. 비용은 파일 몇 개뿐이다.
5. **로그인 확인:** 실행 전에 `claude auth status --json`(`loggedIn`)과 `codex login status`(exit code)를 먼저 확인한다. Codex는 인증 실패 시 재시도 10회 뒤에야 끝나므로 이 사전 확인이 무한 대기 방지의 핵심이다.

## 검증하지 못한 것
- **Isolated Claude:** API 키가 없어 테스트하지 못했다. `--bare`는 프로젝트 스킬을 로드하지 않았다(CA). 그래서 B arm에 대상 스킬이 들어가지 않을 수 있다. 대안은 "C3 플래그 + `ANTHROPIC_API_KEY`"이고, 이때 `apiKeySource`가 키를 가리키는지 확인해야 한다. 사용자 키로 T10에서 확인한다.
- **Isolated Codex**(`CODEX_API_KEY` + 임시 `CODEX_HOME`): 키가 없어 확인하지 못했다.
- Codex에서 `--ignore-user-config`가 `config.toml`의 MCP 서버(`node_repl`, `computer-use`)를 빼는지: 이벤트에 목록이 없어 직접 확인하지 못했다. 플러그인 스킬이 빠진 것만 확인했다.
- Codex 스킬 목록은 모델의 자기 보고다. 열거 결과와는 13개가 일치했다.
- Codex에서 `HOME`을 바꾸면 에이전트가 실행하는 셸 명령(git 사용자 설정, 도구 캐시 등)도 임시 `HOME`을 쓴다. 이로 인한 테스트 실패 여부는 T7/T8에서 확인한다.
- `--bare`에서 `plugins`에 사용자 플러그인이 남는 이유는 확인하지 못했다.
