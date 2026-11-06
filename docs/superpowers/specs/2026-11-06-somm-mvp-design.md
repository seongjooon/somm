# somm MVP 설계 (확정)

- 날짜: 2026-11-06 · 기준 문서: `docs/PRD.md` (v0.1, 이 스펙과 충돌하면 이 스펙이 우선)
- 표기: **[결정]** 사용자가 정함 · **[리드 판단]** 리드가 정함(검토 대상) · **[실험]** Task 1 결과로 확정

---

## 1. 의도

Claude Code·Codex 사용자가 흩어진 스킬을 한곳에서 찾고, **설치 전에 자기 프로젝트 복사본에서 A/B로 돌려 효과와 보안을 확인한 뒤** 한 번에 설치하게 한다. 핵심 가치는 "깔기 전에 안다"이다.

## 2. 목표 / 비목표 / 반목표

**목표 (MVP):** 스토어, 상세(정적 보안 검사), Lite 샌드박스 A/B 테스트와 결과 리포트, Claude Code·Codex 설치 관리. Docker 샌드박스와 공유 카드는 MVP 후반에 붙인다.

**비목표:** PRD 5의 제외 항목(AI 비서, 클라우드 샌드박스, 팀, 결제, 계정, 다른 에이전트), skills.sh 연동과 Vercel 경유 크롤러, LLM README 요약, 무료 모델(OmniRoute 등) 판정, 텔레메트리, Windows·Linux 검증.

**반목표 (기술적으로 돌아가도 실패):**
- somm이 사용자의 로그인 정보나 토큰을 읽거나 저장하거나 중계한다.
- 사용자의 실제 설정 폴더(`~/.claude`, `~/.agents`, `~/.codex`)나 사용자 저장소의 `.git`에 테스트 흔적을 남긴다.
- A/B가 오염됐는데(스킬이 섞였는데) 결과 화면이 그 사실을 숨긴다.
- 사용자가 모르는 사이 구독 사용량을 쓴다.

## 3. 설계 원칙

1. **README에 넣을 문장 [결정]:**
   > somm never reads, stores, or relays your login credentials or tokens.
   > (somm은 로그인 정보와 토큰을 읽지도, 저장하지도, 중계하지도 않는다.)
2. **완벽한 격리보다 투명한 표시 [결정].** 격리할 수 없는 부분은 결과 화면에 "A/B 오염 여부"로 보여 준다.
3. **비용은 시작 전에 보여 준다 [결정].**
4. 사용자 환경에는 읽기만 한다. 쓰기는 설치·삭제처럼 사용자가 누른 동작에서만, 백업 후에 한다.

## 4. 실행 옵션 [결정]

두 옵션은 서로 독립적으로 고른다.

| 옵션 | 값 | 동작 |
|---|---|---|
| **Auth** | **Subscription** (기본) | 이미 설치·로그인된 `claude`, `codex`를 그대로 실행한다 |
| | **Isolated** | API 키를 쓴다. Claude는 `claude --bare` + `--max-budget-usd`, Codex는 `CODEX_API_KEY` |
| **Runs** | **Quick** (기본) | A와 B를 각 1회 실행한다 |
| | **Thorough** | A와 B를 각 3회 실행하고 평균과 편차를 표시한다 |

- **Secure(Docker) 샌드박스는 Isolated에서만 허용한다.** Docker 안에서는 키체인 로그인을 쓸 수 없기 때문이다.
- **Subscription + Thorough를 고르면** 시작 전에 한 번 더 경고한다: "구독 사용량 6회분이 차감됩니다. 구독 한도는 개인 사용을 전제로 합니다."
- **Isolated의 API 키 [리드 판단]:** 앱 세션 동안 메모리에만 둔다. 디스크, DB, 로그에 쓰지 않고 해당 CLI 자식 프로세스의 환경 변수로만 넘긴다. 앱을 재시작하면 다시 입력한다. 이렇게 해야 3번 원칙과 충돌하지 않는다.
- **사용량 안내 [결정 + 리드 판단]:** 시작 전에 다음을 보여 준다.
  - 차감될 실행 수: 작업 후보 제안 1 + A/B 실행 2(Quick) 또는 6(Thorough) + 판정 1
  - 같은 에이전트로 돌린 과거 실행의 평균 토큰 (기록이 있을 때)
  - Isolated는 `--max-budget-usd` × 실행 수로 계산한 상한 금액

## 5. 샌드박스

### 5.1 Lite (기본)
1. **복사본 만들기 [결정]:** 사용자 저장소에 `git worktree add`를 쓰지 않는다. `git archive HEAD`를 `appDataDir/runs/<runId>/base`에 풀고 `git init`과 기준 커밋을 만든다 [리드 판단: `clone --local`보다 원본 경로·리모트와의 연결이 남지 않는다].
   - 커밋 안 된 변경은 경고만 하고 포함하지 않는다 [결정].
   - git 저장소가 아니면 폴더를 그대로 복사한 뒤 `git init`한다.
   - 알려진 한계: `git archive`는 서브모듈과 LFS 본문을 담지 않는다. 이 경우 경고를 표시한다.
2. 의존성 설치는 `base`에서 한 번만 한다 (lockfile 감지: `pnpm`/`npm`/`yarn`/`uv`/`pip`). 그다음 `base` 안에서 `git worktree add`로 A와 B를 나눈다. 이 worktree는 우리 복사본 안의 것이라 사용자 저장소와 무관하다.
3. B에만 대상 스킬을 프로젝트 스코프로 넣는다: Claude는 `.claude/skills/<name>/`, Codex는 `.agents/skills/<name>/`.
4. 실행이 끝나면 diff, 지표, 이벤트 로그를 DB에 저장하고 `runs/<runId>`는 지운다. 보관 옵션은 두지 않는다.

### 5.2 사용자 전역 설정과의 격리 [실험]
Task 1 결과에 따라 아래 중 가능한 조합을 쓴다.
- **Claude Subscription 후보:** `HOME` 교체, `CLAUDE_CONFIG_DIR` 교체, 또는 둘 다 바꾸지 않고 `--setting-sources project,local --strict-mcp-config --no-session-persistence` 조합을 쓴다.
- **Codex Subscription 후보:** `HOME`만 임시 폴더로 바꾸고 `CODEX_HOME`은 원래 값을 유지한다. 여기에 `--ephemeral`과 `--ignore-user-config`를 붙인다.
- **Isolated:** Claude는 `--bare`(문서상 키체인을 읽지 않고 훅·CLAUDE.md·플러그인도 건너뜀)를 쓴다. Codex는 임시 `HOME`, 임시 `CODEX_HOME`, `CODEX_API_KEY`를 쓴다.

### 5.3 A/B 오염 표시 [결정]
- 각 실행에서 실제로 로드된 스킬·플러그인·MCP 목록을 읽는다. Claude는 stream-json의 초기화 이벤트를 읽는다. Codex는 JSON 이벤트에 목록이 없으면 실행 직전에 해당 실행 환경에서 보이는 스킬 폴더를 열거해 대신한다. 정확한 필드는 Task 1에서 확정한다.
- 판정 규칙:
  - **Clean:** A에 대상 스킬이 없고, A와 B의 차이가 대상 스킬뿐이다.
  - **Contaminated:** 위 조건이 깨졌다. 무엇이 섞였는지 목록을 함께 보여 준다.
- 사용자 전역 스킬이 A와 B 양쪽에 똑같이 들어간 경우는 "Clean, 공통 스킬 n개 로드됨"으로 표시한다.

### 5.4 허니팟 [실험 후 확정]
- **1안 (`HOME` 교체가 되는 경우):** 임시 `HOME`에 가짜 `.ssh/id_rsa`, `.aws/credentials`, 토큰 파일을 둔다.
- **2안 (Subscription에서 `HOME`을 바꿀 수 없는 경우) [리드 제안]:**
  - (a) 복사본 프로젝트 안에 가짜 `.env`와 `config/secrets.local.json`을 둔다. 내용은 실행마다 새로 만든 고유 canary 문자열이다.
  - (b) 실제 홈의 민감 경로 감시 목록(`~/.ssh`, `~/.aws`, `~/.config/gh`, `~/.netrc`, 키체인 명령 `security`)에 대한 접근을 이벤트 로그에서 탐지한다. 가짜 파일을 실제 홈에 만들지는 않는다.
- 공통: 탐지는 에이전트 이벤트 로그(도구 호출 인자, 명령 문자열, 출력)에서 경로나 canary 문자열을 찾는 방식이다. Lite는 OS 수준 관찰이 아니므로 결과에 "event-log based"라고 표시한다.
- canary 접근은 즉시 토스트로 알리고, 등급을 F로 매긴다.

### 5.5 Secure (선택, MVP 후반)
Docker가 감지되고 Auth가 Isolated일 때만 켤 수 있다. LLM API 도메인만 허용하고, 그 밖의 네트워크·파일·프로세스 활동은 기록한다. Docker가 없을 때 스크립트·훅·MCP가 들어 있는 스킬은 "정적 검사만 가능"으로 표시하고 A/B 버튼을 끈다 [결정].

## 6. 에이전트 연동 (확인된 사실)

| | Claude Code (2.1.318에서 확인) | Codex (0.166.0에서 확인) |
|---|---|---|
| 전역 스킬 | `~/.claude/skills/<name>/SKILL.md` | `$HOME/.agents/skills/<name>/SKILL.md` (`CODEX_HOME` 아래가 아님) |
| 프로젝트 스킬 | `.claude/skills/<name>/` | 현재 폴더부터 저장소 루트까지의 모든 `.agents/skills/` |
| 헤드리스 실행 | `claude -p --output-format stream-json` | `codex exec --json -C <dir>` |
| 격리 관련 | `--bare`, `--setting-sources`, `--strict-mcp-config`, `--no-session-persistence`, `--max-budget-usd`, `CLAUDE_CONFIG_DIR` | `--ephemeral`, `--ignore-user-config`, `-s workspace-write`, `CODEX_HOME`(인증 위치), `CODEX_API_KEY` |
| 플러그인 | `claude plugin install/enable/disable` | `codex plugin add/list/remove/marketplace` |

출처:
- 로컬 `--help` 출력
- https://code.claude.com/docs/en/env-vars
- https://code.claude.com/docs/en/skills
- https://learn.chatgpt.com/docs/build-skills
- https://developers.openai.com/codex/noninteractive.md

**프로세스 실행 [리드 판단]:** macOS GUI 앱은 로그인 셸의 `PATH`를 받지 않는다. 그래서 감지 단계에서 `/bin/zsh -lc 'command -v claude codex git docker'`로 절대 경로를 한 번 얻고, 이후 실행은 그 절대 경로로 한다. plugin-shell 스코프로는 사용자마다 다른 절대 경로를 허용하기 어렵다. 이 경우 Rust에 `spawn_agent` 명령 하나를 둔다. 허용 바이너리 이름은 화이트리스트로 제한하고, 인자는 배열로만 받는다.

**확인하지 못한 것:** 개인 스킬 경로가 `CLAUDE_CONFIG_DIR`를 따라 바뀌는지, 그리고 Codex JSON 이벤트에 로드된 스킬 목록이 있는지. 둘 다 Task 1에서 확인한다.

## 7. 확정 결정 목록

| # | 항목 | 확정값 |
|---|---|---|
| 1 | 계획 범위 | PRD 구현 순서 1~5단계는 자세히, 6단계(Docker)와 7단계(공유 카드)는 개요만 쓴다 |
| 2 | OS | MVP 검증은 macOS만 한다 |
| 3 | 도구 | pnpm, Vitest를 쓰고, `cargo test`는 최소한으로만 쓴다 |
| 4 | 데이터 위치 | Tauri `appDataDir`에 DB, `backups/`, `disabled/`, `runs/`를 둔다 |
| 5 | A/B 기준 코드 | 5.1을 따른다 |
| 6 | 테스트 명령 감지 | `package.json`의 `scripts.test`, `pytest`, `cargo test`, `go test` 순서로 찾고, 없으면 N/A |
| 7 | 허니팟 | 5.4를 따른다 |
| 8 | 작업 후보 3개, 판정 | 둘 다 사용자가 고른 에이전트의 작은 모델로 돌리고, 사용량 안내에 포함한다 |
| 9 | 요약 | SKILL.md의 `description`과 README 첫 문단을 쓰고, LLM은 쓰지 않는다 |
| 10 | 보안 등급 | 규칙은 `rules/security/*.yaml`, 가중치 합산으로 A~F를 매긴다. F는 설치를 차단하고, B 이상만 [바로 설치]가 켜진다. 엔진은 TS 하나로 만든다 |
| 11 | 설치 | 기본은 복사, 고급 옵션은 심볼릭 링크다. 설치 전 `backups/<ts>`에 백업한다. 플러그인은 CLI를 호출한다 |
| 12 | 끄기 | 스킬 폴더를 `disabled/<agent>/<scope>/<name>`으로 옮긴다 |
| 13 | `npx skills` | Task 1에서 설치 엔진으로 쓸 수 있는지 검토한다. 그전까지는 자체 복사 설치를 쓴다 |
| 14 | Hot 순위 | 스냅샷이 쌓인 기간 단위만 켜고, 그전에는 All-time만 보여 준다 |
| 15 | Codex 카탈로그 | 크롤러 단계에서 출처를 확인한다 |
| 16 | 재배포 | `index.json`에는 메타데이터만 담고, 스킬 본문은 앱이 원본에서 직접 받는다 |
| 17 | 텔레메트리 | 넣지 않는다 |
| 18 | i18n | 직접 만든 `t()`를 쓴다. 공통 키는 `src/i18n/{en,ko}.json`, 기능별 키는 `src/features/<name>/i18n.{en,ko}.json` (병렬 충돌 방지) |
| 19 | 데모 저장소 | `demos/ts-mini`, `demos/py-mini`를 각각 테스트를 포함한 소형으로 만든다 |
| 20 | 충돌 경고 | 같은 이름, 같은 커맨드, 방법론 키워드가 겹치면 경고한다. 규칙은 `rules/conflicts.yaml` |
| 21 | 디자인 시스템 | 첫 UI 태스크 전에 ui-ux-pro-max로 `docs/design-system.md`를 만든다. Raycast 톤, 다크 모드 기본, `#8B1E3F` |
| 22 | 출시 전 체크리스트 | 13절을 따른다 |
| 23 | 무료 모델 판정 | 나중 단계 |
| 24 | `index.json` | 개발 중에는 `fixtures/index.sample.json`을 쓴다. 오픈소스 공개 때 저장소를 public으로 바꾸고 `crawler/`와 gh-pages 배포를 켠다 [결정] |

## 8. 구조

```
src/
  lib/types.ts          공용 타입 (Skill, AgentId, Scope, RunOptions, RunResult, Grade…)
  lib/db.ts             SQLite 접근 (tauri-plugin-sql)
  lib/proc.ts           자식 프로세스 실행/스트림 (plugin-shell 래퍼)
  i18n/                 en.json, ko.json, t.ts
  adapters/agents/      types.ts(AgentAdapter), claude.ts, codex.ts
  adapters/sources/     types.ts(SourceAdapter), sample.ts  (github.ts, official.ts는 공개 시점)
  adapters/sandbox/     types.ts(Sandbox), lite.ts  (docker.ts는 후반)
  scan/                 정적 검사 엔진 (앱과 크롤러가 공유)
  features/store|detail|runner|results|installs/
rules/security/*.yaml, rules/conflicts.yaml
fixtures/index.sample.json
demos/ts-mini, demos/py-mini
src-tauri/              플러그인 등록과 capability(shell 허용 프로그램, fs 스코프)
```

- **AgentAdapter:** `detect()`, `listInstalled()`, `install()`, `uninstall()`, `run(task, env) → AsyncIterable<AgentEvent>`, `loadedInventory(events)`
- **SourceAdapter:** `fetchIndex() → Skill[]`
- **Sandbox:** `prepare(project) → base`, `split(base) → {a, b}`, `cleanup()`

## 9. 화면별 동작 요약

PRD 6을 따르고, 차이만 적는다.
- **스토어:** 샘플 `index.json`으로 동작한다. Hot 탭은 스냅샷 기간이 부족하면 숨긴다.
- **상세:** 요약은 7절의 9번(LLM 없음)을 따른다. 정적 검사 결과를 즉시 표시한다. [바로 설치]는 B 이상일 때만 켜진다.
- **테스트 실행:** Auth와 Runs를 고른 뒤 사용량 안내를 보고 시작한다. Subscription + Thorough는 추가 경고를 띄운다. 오른쪽 패널은 이벤트 로그이고, canary 접근은 토스트로 알린다.
- **결과:** 지표 비교(Thorough는 평균 ± 편차), **A/B 오염 여부**, 한 줄 판정, diff, 보안 리포트를 보여 준다. 판정 문구 끝에 `// somm: pairs well` 또는 `// somm: corked`를 붙인다.
- **설치 관리:** 감지된 에이전트별 목록(외부에서 설치한 것 포함), 끄기·켜기, 삭제, hash 비교, 충돌 경고.

## 10. 리스크

- **Anthropic 약관.** 출처: https://code.claude.com/docs/en/legal-and-compliance
  - 금지: 서드파티가 사용자 대신 Free·Pro·Max·Ultra 구독 자격으로 요청을 중계하는 것, Claude.ai 자격증명이나 세션 토큰을 수집·저장·중계하는 것.
  - 허용: 최종 사용자가 수정하지 않은 Claude Code 바이너리에 자기 구독으로 로그인해 쓰는 것.
  - somm은 토큰을 만지지 않고 사용자 PC에서 바이너리만 실행하므로 허용 쪽에 가깝다고 본다. 다만 "구독 사용 한도는 일반적인 개인 사용을 전제로 한다"는 문구가 있어, 자동 반복 실행은 회색 지대다. 이 판단은 법률 자문이 아니다.
  - 대응: 3번 원칙, 시작 전 사용량 안내, Thorough 추가 경고, Isolated 옵션.
- **OpenAI 약관.** 출처: https://developers.openai.com/codex/noninteractive.md
  - 공식 문서가 `codex exec`이 저장된 CLI 로그인(ChatGPT 계정 포함)을 기본으로 다시 쓴다고 안내한다.
  - 이용약관 원문과 도움말 페이지는 403 오류로 읽지 못했다. 명시적인 금지 조항은 찾지 못했다. **출시 전에 원문을 다시 확인한다.**
- **LLM 결과의 변동성:** Quick 결과에 "1회 실행, 신뢰도 낮음"을 표시하고 Thorough를 권한다.
- **격리 한계:** Subscription 모드에서는 사용자 전역 설정이 섞일 수 있다. 5.3의 오염 표시로 대응한다.
- **복사본 한계:** 서브모듈·LFS는 빠지고, 의존성 설치에 시간과 네트워크가 든다.
- **이벤트 로그 기반 탐지의 한계:** 에이전트가 기록하지 않는 우회 접근(스크립트 내부의 파일 읽기 등)은 Lite에서 놓칠 수 있다. 그래서 스크립트가 들어 있는 스킬은 Docker가 없으면 A/B를 막는다.

## 11. Task 1 실험 정의 (구현 전에 결과를 이 스펙에 반영)

| 실험 | 확인할 것 |
|---|---|
| C1 | `HOME=<tmp> claude -p "hi"`: 키체인 로그인이 유지되는가 |
| C2 | `CLAUDE_CONFIG_DIR=<tmp> claude -p`: 로그인이 유지되는가, `<tmp>/skills`가 로드되는가, `~/.claude/skills`가 빠지는가 |
| C3 | 기본 `HOME`에 `--setting-sources project,local --strict-mcp-config --no-session-persistence`를 붙였을 때 `~/.claude/skills`와 사용자 플러그인이 로드되는가 |
| C4 | stream-json 초기화 이벤트에서 스킬·플러그인·MCP 목록을 얻을 수 있는가 (필드 이름 기록) |
| X1 | `HOME=<tmp> CODEX_HOME=<원래> codex exec --json --ephemeral`: 로그인이 유지되는가, `~/.agents/skills`가 빠지는가 |
| X2 | Codex JSON 이벤트에 로드된 스킬 목록이 있는가 |
| N1 | `npx skills`(Vercel)의 지원 에이전트·설치 경로·비대화식 사용 가능 여부를 실행 없이 문서와 소스로 검토 |

모든 실험은 "hi" 수준의 최소 프롬프트로만 돌린다. 사용자의 실제 설정 폴더에는 쓰지 않는다.

## 12. 빌더에게 맡긴 것

- 보안 규칙의 구체 패턴과 가중치 수치
- 화면 레이아웃 세부 (디자인 시스템 문서를 따른다)
- SQLite 스키마 세부
- 작은 모델의 구체 이름 (각 CLI의 별칭)

## 13. 출시 전 체크리스트

- [ ] `/ponytail-audit`
- [ ] strix 보안 점검
- [ ] macOS 코드 서명·공증. **Apple Developer Program 계정(연 99달러)이 필요하다.**
- [ ] OpenAI 이용약관 원문 재확인, Anthropic 약관 문서 재확인
- [ ] README에 3번 원칙 문장 넣기
- [ ] 저장소 public 전환, `crawler/`와 gh-pages 배포 켜기, 앱 기본 출처를 실제 `index.json`으로 바꾸기
- [ ] MIT 라이선스 파일 추가
