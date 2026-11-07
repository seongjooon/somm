# somm MVP 설계 (확정)

- 날짜: 2026-11-06 · 기준 문서: `docs/PRD.md` (v0.1, 이 스펙과 충돌하면 이 스펙이 우선)
- 표기: **[결정]** 사용자가 정함 · **[리드 판단]** 리드가 정함(검토 대상) · **[실험]** Task 1 결과로 확정

---

## 1. 의도

Claude Code·Codex 사용자가 흩어진 스킬을 한곳에서 찾고, **설치 전에 자기 프로젝트 복사본에서 A/B로 돌려 효과와 보안을 확인한 뒤** 한 번에 설치하게 한다. 핵심 가치는 "깔기 전에 안다"이다.

## 2. 목표 / 비목표 / 반목표

**목표 (MVP):** 스토어, 상세(정적 보안 검사), Lite 샌드박스 A/B 테스트와 결과 리포트, Claude Code·Codex 설치 관리. **같은 엔진을 데스크톱 GUI와 CLI(`somm`) 두 가지로 제공한다 [결정].** Docker 샌드박스와 공유 카드는 MVP 후반에 붙인다.

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
| | **Isolated** | API 키를 쓴다. Claude는 `ANTHROPIC_API_KEY` + `--max-budget-usd` (`--bare`는 T1에서 프로젝트 스킬을 로드하지 않아 보류, 5.2 참고), Codex는 `CODEX_API_KEY` |
| **Runs** | **Quick** (기본) | A와 B를 각 1회 실행한다 |
| | **Thorough** | A와 B를 각 3회 실행하고 평균과 편차를 표시한다 |

- **Secure(Docker) 샌드박스는 Isolated에서만 허용한다.** Docker 안에서는 키체인 로그인을 쓸 수 없기 때문이다.
- **판정 문구 3종 [결정]:** 추천 → `// somm: pairs well`, 조건부 → `// somm: needs to breathe`, 비추천 또는 F → `// somm: corked`.
- **Subscription + Thorough를 고르면** 시작 전에 한 번 더 경고한다: "구독 사용량 6회분이 차감됩니다. 구독 한도는 개인 사용을 전제로 합니다."
- **Isolated의 API 키 [리드 판단]:** 앱 세션 동안 메모리에만 둔다. 디스크, DB, 로그에 쓰지 않고 해당 CLI 자식 프로세스의 환경 변수로만 넘긴다. 앱을 재시작하면 다시 입력한다. 이렇게 해야 3번 원칙과 충돌하지 않는다.
- **사용량 안내 [결정 + 리드 판단]:** 시작 전에 다음을 보여 준다.
  - 차감될 실행 수: 작업 후보 제안 1 + A/B 실행 2(Quick) 또는 6(Thorough) + 판정 1
  - 같은 에이전트로 돌린 과거 실행의 평균 토큰 (기록이 있을 때)
  - Isolated는 `--max-budget-usd` × 실행 수로 계산한 상한 금액

## 5. 샌드박스

### 5.1 Lite (기본)
1. **복사본 만들기 [결정]:** 사용자 저장소에 `git worktree add`를 쓰지 않는다. `git archive HEAD`를 데이터 폴더의 `runs/<runId>/base`에 풀고 `git init`과 기준 커밋을 만든다 [리드 판단: `clone --local`보다 원본 경로·리모트와의 연결이 남지 않는다].
   - 커밋 안 된 변경은 경고만 하고 포함하지 않는다 [결정].
   - git 저장소가 아니면 폴더를 그대로 복사한 뒤 `git init`한다.
   - 알려진 한계: `git archive`는 서브모듈과 LFS 본문을 담지 않는다. 이 경우 경고를 표시한다.
2. **비밀 파일 제거:** 복사본에서 `.env`, `.env.*`(`.env.example` 제외), `*.pem`, `*.key`, `id_rsa*`, `.npmrc`, `.pypirc`를 지운다. git에 추적된 파일이어도 지우고 경고한다. 허니팟은 그 뒤에 심는다.
3. **의존성 [리드 제안: 원본에서 APFS 복제 우선, 안 되면 재설치]:**
   - **기본:** 원본의 의존성 폴더(`node_modules`(루트와 워크스페이스 하위 패키지), `.venv`, `venv`)를 `cp -c`(APFS clonefile)로 `base`에 가져온다. 이유: 디스크를 거의 쓰지 않고 빠르며, 네트워크·사설 레지스트리가 필요 없고, 사용자가 실제로 쓰는 환경과 같다.
   - **재설치로 전환하는 경우:** 의존성 폴더가 없을 때, 또는 작업 트리의 lockfile이 `HEAD`의 lockfile과 다를 때(복제본이 `HEAD` 코드와 맞지 않음)는 lockfile 기준으로 설치한다: `pnpm install --frozen-lockfile`, `npm ci`, `yarn install --frozen-lockfile`, `uv sync`.
   - Python은 복제한 `.venv`의 스크립트 shebang이 원본 경로를 가리키므로, 테스트는 항상 `<arm>/.venv/bin/python -m pytest`(또는 `-m unittest`) 형태로 실행한다.
   - 다른 APFS 볼륨이라 `cp -c`가 실패하면 `cp -R`로 복사하고 "느린 복사" 경고를 표시한다.
4. `base`를 `cp -cR`로 복제해 A와 B 폴더를 만든다(`git worktree`는 추적 파일만 담아 의존성 폴더가 빠지므로 쓰지 않는다). 각 폴더는 기준 커밋을 가진 독립 저장소다.
5. B에만 대상 스킬을 프로젝트 스코프로 넣는다: Claude는 `.claude/skills/<name>/`, Codex는 `.agents/skills/<name>/`.
6. 실행이 끝나면 diff, 지표, 이벤트 로그를 DB에 저장하고 `runs/<runId>`는 지운다. 보관 옵션은 두지 않는다.

### 5.2 사용자 전역 설정과의 격리 [T1 확정]
근거: `docs/experiments/2026-11-06-isolation.md`
- **Claude Subscription:** `HOME`과 `CLAUDE_CONFIG_DIR`은 바꾸지 않는다. 둘 중 하나라도 바꾸면 키체인 로그인을 잃는다(C1, C2). 대신 `--setting-sources project,local --strict-mcp-config --no-session-persistence`를 붙인다(C3). 이 조합은 로그인을 유지하면서 사용자 스킬, 플러그인, MCP, 에이전트, 훅, `~/.claude/CLAUDE.md`를 모두 뺀다. 남는 것은 내장 스킬과 `@builtin` 플러그인뿐이며, A와 B에 똑같이 들어간다.
- **Codex Subscription:** `HOME=<run tmp>`로 바꾸고 `CODEX_HOME`은 원래 값을 유지한다(인증 `auth.json` 위치). 여기에 `--ephemeral --ignore-user-config`를 붙인다. 이 조합은 로그인을 유지하면서 `~/.agents/skills`와 플러그인 스킬을 뺀다(X1). **잔여:** `$CODEX_HOME/skills`(`.system` 포함)와 `$CODEX_HOME/AGENTS.md`는 계속 로드된다. 로그인 파일을 복사하거나 링크하면 3번 원칙에 어긋나므로 이 잔여는 받아들인다. 양쪽 arm에 같으므로 5.3의 "공통"으로 표시한다. `CODEX_HOME` 폴더가 없으면 codex가 즉시 실패한다.
- **복사본의 git 사용자 설정 [결정]:** Codex는 `HOME`이 임시 폴더라 사용자 `~/.gitconfig`가 없다. 그래서 somm은 복사본 안의 모든 git 작업(기준 커밋, 에이전트 실행)에 `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL`/`GIT_COMMITTER_NAME`/`GIT_COMMITTER_EMAIL`을 테스트용 값(`somm`, `somm@localhost`)으로 주입한다. A와 B 양쪽에, Claude와 Codex 모두에 같은 값을 쓴다.
- **실행 전 로그인 확인 [결정]:** 에이전트 어댑터는 실행 전에 `claude auth status --json`과 `codex login status`로 로그인을 반드시 확인한다(6절). 미로그인이면 에이전트를 실행하지 않는다.
- **알려진 한계:** 두 CLI 모두 자기 상태 파일을 실제 설정 폴더에 쓴다. Claude는 `~/.claude.json`과 `plugins/store`에, Codex는 `~/.codex`의 로그 DB와 캐시에 쓴다. somm이 쓰는 것은 없다.
- **Isolated [미검증]:** Claude `--bare`는 키체인을 읽지 않지만 **프로젝트 스킬도 로드하지 않았다**(CA). 그래서 B arm에 대상 스킬이 들어가지 않는다. 대안은 Subscription과 같은 플래그에 `ANTHROPIC_API_KEY`를 주는 것이다. 이때 init 이벤트의 `apiKeySource`가 키를 가리키는지 T10에서 사용자 키로 확인한다. Codex는 임시 `HOME`, 임시 `CODEX_HOME`(폴더를 미리 만든다), `CODEX_API_KEY`를 쓴다(미검증).

### 5.3 A/B 오염 표시 [결정]
- 각 실행에서 실제로 로드된 스킬·플러그인·MCP 목록을 읽는다. Claude는 stream-json의 초기화 이벤트를 읽는다. Codex는 JSON 이벤트에 목록이 없으므로(X2) 실행 직전에 해당 실행 환경에서 보이는 스킬 폴더를 열거해 대신한다.
- **필드 [T1 확정]:**
  - Claude: `type:"system", subtype:"init"` 이벤트의 `skills: string[]`, `plugins[].name`, `mcp_servers[].name`, `agents: string[]`.
  - Codex(열거, 표시에 "enumerated"): `<arm>`부터 저장소 루트까지의 `.agents/skills/*`, `$HOME/.agents/skills/*`, `$CODEX_HOME/skills/*`, `$CODEX_HOME/skills/.system/*` 가운데 `SKILL.md`가 있는 폴더를 센다. 단 `agents/openai.yaml`의 `policy.allow_implicit_invocation: false`인 폴더는 모델 목록에 나오지 않으므로 뺀다.
- 판정 규칙:
  - **Clean:** A에 대상 스킬이 없고, A와 B의 차이가 대상 스킬뿐이다.
  - **Contaminated:** 위 조건이 깨졌다. 무엇이 섞였는지 목록을 함께 보여 준다.
- 사용자 전역 스킬이 A와 B 양쪽에 똑같이 들어간 경우는 "Clean, 공통 스킬 n개 로드됨"으로 표시한다.
- **공통 잔여 [결정]:** somm이 넣지 않았는데 양쪽 arm에 보이는 스킬을 "공통 잔여"라 한다. 대상 스킬을 B에 넣기 전에 복사본(`base`)에서 열거한다. Claude는 복사본의 `.claude/skills/*`(사용자 프로젝트 스킬)를, Codex는 복사본의 `.agents/skills/*`와 `$CODEX_HOME/skills/*`(`.system` 포함, 위 열거 규칙)를 센다.
  - 결과 화면과 CLI `--json`에는 공통 잔여 목록(개수와 이름)을 **항상** 보여 준다. 0개여도 "0"으로 표시한다.
  - 대상 스킬 이름이 공통 잔여에 있으면 A에도 대상 스킬이 보이므로 A/B가 무의미하다. 에이전트를 실행하기 전에 감지해서 멈추고(구독 사용량을 쓰지 않는다), 어느 위치에 있는지와 함께 "삭제하거나 이름을 바꾼 뒤 다시 시도" 경고를 보여 준다. 판정은 Contaminated다.

### 5.4 허니팟 [T1 확정: 2안 공통 + Codex만 1안 추가]
- **1안 (`HOME` 교체가 되는 경우):** 임시 `HOME`에 가짜 `.ssh/id_rsa`, `.aws/credentials`, 토큰 파일을 둔다.
- **2안 (Subscription에서 `HOME`을 바꿀 수 없는 경우) [리드 제안]:**
  - (a) 복사본 프로젝트 안에 가짜 `.env`와 `config/secrets.local.json`을 둔다. 내용은 실행마다 새로 만든 고유 canary 문자열이다.
  - (b) 실제 홈의 민감 경로 감시 목록(`~/.ssh`, `~/.aws`, `~/.config/gh`, `~/.netrc`, 키체인 명령 `security`)에 대한 접근을 이벤트 로그에서 탐지한다. 가짜 파일을 실제 홈에 만들지는 않는다.
- **채택:** Claude Subscription은 `HOME`을 바꿀 수 없으므로(C1) 2안을 두 에이전트 공통으로 쓴다. Codex는 이미 임시 `HOME`을 쓰므로 거기에 1안 가짜 파일도 둔다.
- 공통: 탐지는 에이전트 이벤트 로그(도구 호출 인자, 명령 문자열, 출력)에서 경로나 canary 문자열을 찾는 방식이다. Lite는 OS 수준 관찰이 아니므로 결과에 "event-log based"라고 표시한다.
- canary 접근은 즉시 토스트로 알리고, 등급을 F로 매긴다.

### 5.4.1 보안 등급 정의 [결정]
- **정적 검사가 줄 수 있는 등급은 A~D다.** 문제가 없는 스킬은 정적 검사만으로 A(또는 경미한 항목만 있으면 B)를 받고 [바로 설치]가 가능하다.
- **F는 정적 검사로는 주지 않는다.** F는 동적 관찰의 확정 증거(canary 접근, 허니팟 유출)가 있을 때만 매긴다. 정적 검사에서 아무리 위험한 패턴이 나와도 D까지이고, 이때 [바로 설치]는 꺼지고 "테스트 후 설치" 경로만 남는다.
- 설치 가능 범위: A·B → [바로 설치], C·D → 테스트를 거쳤거나 경고를 확인한 뒤 설치, F → 모든 설치 차단.

### 5.5 Secure (선택, MVP 후반)
Docker가 감지되고 Auth가 Isolated일 때만 켤 수 있다. LLM API 도메인만 허용하고, 그 밖의 네트워크·파일·프로세스 활동은 기록한다. Docker가 없을 때 스크립트·훅·MCP가 들어 있는 스킬은 "정적 검사만 가능"으로 표시하고 A/B 버튼을 끈다 [결정].

## 6. 에이전트 연동 (확인된 사실)

| | Claude Code (2.1.318에서 확인) | Codex (0.166.0에서 확인) |
|---|---|---|
| 전역 스킬 | `~/.claude/skills/<name>/SKILL.md` | `$HOME/.agents/skills/<name>/SKILL.md` (`CODEX_HOME` 아래가 아님) |
| 프로젝트 스킬 | `.claude/skills/<name>/` | 현재 폴더부터 저장소 루트까지의 모든 `.agents/skills/` |
| 헤드리스 실행 | `claude -p --output-format stream-json --verbose` (`--verbose`가 없으면 exit 1) | `codex exec --json -C <dir>` (stdin이 tty가 아니면 stdin을 읽으므로 닫는다) |
| 로그인 확인 (비과금) | `claude auth status --json` → `loggedIn`, exit 0/1. `email`·`orgName`도 오므로 `loggedIn`·`authMethod`·`subscriptionType`만 읽는다 | `codex login status` → exit 0/1 (텍스트만) |
| 인증 실패 이벤트 | assistant `error:"authentication_failed"`, result `is_error:true`, `result:"Not logged in · Please run /login"`, 즉시 종료 | 401 재연결 10회 뒤 `turn.failed`. 빠른 실패가 없으므로 실행 전 로그인 확인이 필수다 |
| 토큰 | `result.usage` (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`), `total_cost_usd` | `turn.completed.usage` (`input_tokens`, `cached_input_tokens`, `output_tokens`, `reasoning_output_tokens`) |
| 격리 관련 | `--bare`, `--setting-sources`, `--strict-mcp-config`, `--no-session-persistence`, `--max-budget-usd`, `CLAUDE_CONFIG_DIR` | `--ephemeral`, `--ignore-user-config`, `-s workspace-write`, `CODEX_HOME`(인증 위치), `CODEX_API_KEY` |
| 플러그인 | `claude plugin install/enable/disable`, `claude plugin list --json` → 배열 `{id, version, scope, enabled, installPath, ...}` | `codex plugin add/list/remove/marketplace`, `codex plugin list --json` → `{installed[], available[]}` |
| 기타 스킬 위치 | `CLAUDE_CONFIG_DIR`을 바꾸면 개인 스킬 경로도 `<dir>/skills`로 바뀐다(C2) | `$CODEX_HOME/skills/`(`.system` 포함)도 로드된다(X1) |

출처:
- 로컬 `--help` 출력
- https://code.claude.com/docs/en/env-vars
- https://code.claude.com/docs/en/skills
- https://learn.chatgpt.com/docs/build-skills
- https://developers.openai.com/codex/noninteractive.md

**프로세스 실행 [리드 판단]:** CLI는 셸 `PATH`를 그대로 쓴다. macOS GUI 앱은 로그인 셸의 `PATH`를 받지 않는다. 그래서 감지 단계에서 `/bin/zsh -lc 'command -v claude codex git docker'`로 절대 경로를 한 번 얻고, 이후 실행은 그 절대 경로로 한다. plugin-shell 스코프로는 사용자마다 다른 절대 경로를 허용하기 어렵다. 이 경우 Rust에 `spawn_agent` 명령 하나를 둔다. 허용 바이너리 이름은 화이트리스트로 제한하고, 인자는 배열로만 받는다.

**확인하지 못한 것:** Isolated 두 조합(API 키 없음), Codex `--ignore-user-config`가 `config.toml`의 MCP 서버를 빼는지. 자세한 내용은 `docs/experiments/2026-11-06-isolation.md`의 "검증하지 못한 것"에 있다.

## 7. 확정 결정 목록

| # | 항목 | 확정값 |
|---|---|---|
| 1 | 계획 범위 | PRD 구현 순서 1~5단계는 자세히, 6단계(Docker)와 7단계(공유 카드)는 개요만 쓴다 |
| 2 | OS | MVP 검증은 macOS만 한다 |
| 3 | 도구 | pnpm, Vitest를 쓰고, `cargo test`는 최소한으로만 쓴다 |
| 4 | 데이터 위치 | GUI와 CLI가 같은 폴더를 쓴다: `SOMM_DATA_DIR`가 있으면 그 값, 없으면 macOS `~/Library/Application Support/io.github.seongjooon.somm`(Tauri identifier와 같은 값). 그 아래 `somm.db`, `backups/`, `disabled/`, `runs/`, `cache/` [결정 + 리드 판단: identifier] |
| 5 | A/B 기준 코드 | 5.1을 따른다 |
| 6 | 테스트 명령 감지 | `package.json`의 `scripts.test`, `pytest`, `cargo test`, `go test` 순서로 찾고, 없으면 N/A |
| 7 | 허니팟 | 5.4를 따른다 |
| 8 | 작업 후보 3개, 판정 | 둘 다 사용자가 고른 에이전트의 작은 모델로 돌리고, 사용량 안내에 포함한다 |
| 9 | 요약 | SKILL.md의 `description`과 README 첫 문단을 쓰고, LLM은 쓰지 않는다 |
| 10 | 보안 등급 | 5.4.1을 따른다. 규칙은 `packages/core/rules/security/*.yaml`이고, 정적 가중치 합산으로 A~D를 매긴다 |
| 11 | 설치 | 기본은 복사, 고급 옵션은 심볼릭 링크다. 설치 전 `backups/<ts>`에 백업한다. 플러그인은 CLI를 호출한다 |
| 12 | 끄기 | 스킬 폴더를 `disabled/<agent>/<scope>/<name>`으로 옮긴다 |
| 13 | `npx skills` | Task 1에서 설치 엔진으로 쓸 수 있는지 검토한다. 그전까지는 자체 복사 설치를 쓴다 |
| 14 | Hot 순위 | 스냅샷이 쌓인 기간 단위만 켜고, 그전에는 All-time만 보여 준다 |
| 15 | Codex 카탈로그 | 크롤러 단계에서 출처를 확인한다 |
| 16 | 재배포 | `index.json`에는 메타데이터만 담고, 스킬 본문은 앱이 원본에서 직접 받는다 |
| 17 | 텔레메트리 | 넣지 않는다 |
| 18 | i18n | GUI는 직접 만든 `t()`를 쓴다. 공통 키는 `apps/desktop/src/i18n/{en,ko}.json`, 기능 키는 `apps/desktop/src/features/<name>/i18n.{en,ko}.json`(병렬 충돌 방지). CLI 출력은 MVP에서 영어만 |
| 19 | 데모 저장소 | `demos/ts-mini`, `demos/py-mini`를 각각 테스트를 포함한 소형으로 만든다 |
| 20 | 충돌 경고 | 같은 이름, 같은 커맨드, 방법론 키워드가 겹치면 경고한다. 규칙은 `packages/core/rules/conflicts.yaml` |
| 21 | 디자인 시스템 | 첫 UI 태스크 전에 ui-ux-pro-max로 `docs/design-system.md`를 만든다. Raycast 톤, 다크 모드 기본, `#8B1E3F` |
| 22 | 출시 전 체크리스트 | 13절을 따른다 |
| 23 | 무료 모델 판정 | 나중 단계 |
| 24 | `index.json` | 개발 중에는 `packages/core/fixtures/index.sample.json`을 쓴다. 오픈소스 공개 때 저장소를 public으로 바꾸고 `crawler/`와 gh-pages 배포를 켠다 [결정] |
| 25 | 저장소 구조 | pnpm 워크스페이스 모노레포: `packages/core`, `apps/desktop`, `apps/cli` [결정]. 8절 참조 |
| 26 | CLI | 8.1절 참조. npm 패키지 이름은 `somm`(2026-11-06 기준 미등록 확인, 이름 유사성 규칙은 첫 배포 때만 최종 확인됨) [결정 + 확인] |

## 8. 구조 [결정]

```
pnpm-workspace.yaml, package.json(루트 스크립트), tsconfig.base.json
packages/core/            순수 TS 엔진. UI·Tauri·Node 전용 API에 의존하지 않는다
  src/types.ts            공용 타입
  src/platform/           Fs, Proc, Db, Paths 인터페이스 + DB 스키마/마이그레이션
  src/node/               Node 구현(Fs/Proc/Db=node:sqlite). 하위 경로 `@somm/core/node`로 내보낸다. CLI와 core 테스트가 쓴다
  src/agents/             AgentAdapter: claude, codex (감지, 설치/삭제/끄기, 실행 명세, 이벤트 파싱)
  src/sources/            SourceAdapter(sample), 랭킹, 스킬 파일 가져오기
  src/scan/               정적 검사 엔진, 특성 추출, 충돌 검사
  src/sandbox/            Lite 샌드박스 (docker는 후반)
  src/runner/             A/B 실행 엔진, 지표, 오염 판정, 사용량 추정, 판정
  rules/, fixtures/
apps/desktop/             Tauri 2 + Vite + Svelte 5. 표시만 한다
  src/platform/           Tauri 구현(Fs=plugin-fs, Proc=Rust spawn_agent, Db=plugin-sql)
  src/features/<name>/, src/ui/, src/i18n/
  src-tauri/              플러그인 등록, capability, 화이트리스트 실행 명령
apps/cli/                 Node CLI `somm`. 표시만 한다
  src/commands/<name>.ts, src/output.ts
demos/ts-mini, demos/py-mini
```

- **의존 방향:** `apps/*` → `packages/core`. core는 apps를 모른다. core의 플랫폼 접근은 전부 `platform/` 인터페이스로 주입받는다.
- **[리드 판단]:** Node 구현을 `apps/cli`가 아니라 `packages/core/src/node`에 둔다. core 자체 테스트가 실제 git·파일 시스템으로 돌아야 하고, 테스트가 apps에 의존하면 방향이 뒤집히기 때문이다.
- **[리드 판단]:** 보안 규칙 YAML은 `pnpm --filter @somm/core gen:rules`로 `src/scan/rules.generated.ts`(문자열)로 변환해 커밋한다. Vite와 Node에서 똑같이 불러오기 위해서다. 생성물이 최신인지는 테스트로 확인한다.
- **DB 공유:** 같은 `somm.db`를 GUI(plugin-sql)와 CLI(`node:sqlite`)가 연다. WAL 모드를 쓰고, 마이그레이션은 core의 `migrate(db)`가 `PRAGMA user_version`으로 관리한다.

### 8.1 CLI [결정]
- 명령: `search <query>`, `scan <skill|path>`, `test <skill> --project <dir> --agent claude|codex --runs quick|thorough --auth subscription|isolated`, `install <skill> --agent --scope global|project`, `list`, `remove <name> --agent --scope`.
- 사람용 출력의 첫 줄은 항상 `// somm: ...`이다. 예: `// somm: 12 skills found`, `// somm: pairs well`, `// somm: corked`.
- 모든 명령에 `--json`이 있다. **[리드 판단]** `--json`일 때는 JSON 파싱이 깨지지 않도록 주석 줄을 찍지 않고, 같은 문구를 `"somm"` 필드에 넣은 JSON 하나만 출력한다.
- `test`는 시작 전에 GUI와 같은 사용량 안내를 출력하고 확인을 받는다(`--yes`로 생략). Subscription + Thorough 경고도 같다. Isolated의 API 키는 `ANTHROPIC_API_KEY`/`CODEX_API_KEY` 환경 변수에서만 받는다(CLI 인자로 받지 않음: 셸 기록에 남기 때문).
- 종료 코드: 0 성공, 1 실행 오류, 2 차단(F 또는 corked).
- 배포: esbuild로 core를 포함한 단일 `dist/cli.js`를 만들고, `bin: { somm }`으로 내보낸다.

## 9. 화면별 동작 요약

PRD 6을 따르고, 차이만 적는다.
- **스토어:** 샘플 `index.json`으로 동작한다. Hot 탭은 스냅샷 기간이 부족하면 숨긴다.
- **상세:** 요약은 7절의 9번(LLM 없음)을 따른다. 정적 검사 결과를 즉시 표시한다. [바로 설치]는 B 이상일 때만 켜진다.
- **테스트 실행:** Auth와 Runs를 고른 뒤 사용량 안내를 보고 시작한다. Subscription + Thorough는 추가 경고를 띄운다. 오른쪽 패널은 이벤트 로그이고, canary 접근은 토스트로 알린다.
- **결과:** 지표 비교(Thorough는 평균 ± 편차), **A/B 오염 여부**, 한 줄 판정, diff, 보안 리포트를 보여 준다. 판정 문구 끝에 4절의 판정 문구 3종 중 하나를 붙인다.
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
  Lite에는 OS 격리가 없으므로 에이전트가 프로젝트 테스트 스크립트를 수정한 뒤 허용된 테스트 명령으로 임의의 하위 프로세스를 실행할 수 있다.
- **복원 경로 한계:** Tauri 파일 접근 범위 밖인 전역 및 비활성 스킬 디렉터리의 상위 경로는 사용자의 자체 디렉터리로 신뢰하므로 복원 시 상위 심볼릭 링크를 검사하지 않는다.
- **복사본 한계:** 서브모듈·LFS는 빠지고, 의존성 설치에 시간과 네트워크가 든다.
- **이벤트 로그 기반 탐지의 한계:** 에이전트가 기록하지 않는 우회 접근(스크립트 내부의 파일 읽기 등)은 Lite에서 놓칠 수 있다. 그래서 스크립트가 들어 있는 스킬은 Docker가 없으면 A/B를 막는다.

## 11. Task 1 실험 정의 (결과: `docs/experiments/2026-11-06-isolation.md`)

| 실험 | 확인할 것 | 결과 |
|---|---|---|
| C1 | `HOME=<tmp> claude -p "hi"`: 키체인 로그인이 유지되는가 | **FAIL** |
| C2 | `CLAUDE_CONFIG_DIR=<tmp> claude -p`: 로그인이 유지되는가, `<tmp>/skills`가 로드되는가, `~/.claude/skills`가 빠지는가 | 로그인 **FAIL**, 스킬 경로는 따라 바뀜 |
| C3 | 기본 `HOME`에 `--setting-sources project,local --strict-mcp-config --no-session-persistence`를 붙였을 때 `~/.claude/skills`와 사용자 플러그인이 로드되는가 | **PASS** (둘 다 빠지고 로그인 유지) |
| C4 | stream-json 초기화 이벤트에서 스킬·플러그인·MCP 목록을 얻을 수 있는가 (필드 이름 기록) | **PASS** (`skills`, `plugins`, `mcp_servers`) |
| X1 | `HOME=<tmp> CODEX_HOME=<원래> codex exec --json --ephemeral`: 로그인이 유지되는가, `~/.agents/skills`가 빠지는가 | **PASS** (`$CODEX_HOME/skills`는 남음) |
| X2 | Codex JSON 이벤트에 로드된 스킬 목록이 있는가 | **FAIL** (열거로 대체) |
| N1 | `npx skills`(Vercel)의 지원 에이전트·설치 경로·비대화식 사용 가능 여부를 실행 없이 문서와 소스로 검토 | **보류** |

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
- [ ] npm `somm` 이름 확보(첫 배포 또는 사용자 승인 후 placeholder 배포)
