# T18: 실제 스킬 목록 (크롤러와 공개 인덱스) 설계

> 상태: 승인 대기 · 2026-11-24 · 사용자와 브레인스토밍으로 합의한 내용, 빌더 검토 반영. [작성자 판단] 표시는 합의 뒤 작성자가 정한 부분
> 관련: `docs/PRD.md` §7.2, MVP 스펙 결정 16·24, 구현 계획 T18 개요

## 1. 의도
스토어는 지금 앱에 내장된 샘플 20개(`packages/core/fixtures/index.sample.json`)를 보여 준다. 이것을 GitHub와 공식 출처에서 매일 모은 실제 목록으로 바꾼다.
- 왜: 베타 사용자가 ponytail(`dietrichgebert/ponytail`) 같은 커뮤니티 스킬을 somm에서 찾아, 설치 전에 보안 검사와 A/B 테스트를 해 볼 수 있어야 한다. somm의 핵심 가치("낯선 스킬을 설치 전에 확인")는 커뮤니티 스킬에서 쓰인다. 공개 출시의 필수 조건이기도 하다.
- 언제: 베타 2차 빌드부터 실제 목록이 보인다(사용자 결정 2026-11-24, 선택지 1 "지금 공개 호스팅").

## 2. 목표 / 비목표 / 실패 조건
**목표**
- 공식 스킬과 커뮤니티 스킬을 하루 한 번 모아 공개 주소의 `index.json`으로 배포한다.
- 앱(데스크톱, CLI)이 그 목록을 받아 쓰고, 오프라인이거나 실패하면 마지막 목록이나 샘플로 동작한다.
- 카드마다 미리 계산한 보안 등급을 보여 준다.
- 일별 스냅샷으로 기간별 인기 순위(기존 `rank`, `availableViews`)가 동작한다.

**비목표 (이번 버전에서 하지 않음)**
- 플러그인 마켓(`anthropics/claude-plugins-official`, 317개). 설치 방식이 스킬 설치와 다르다.
- skills.sh(인증 필요), ClawHub, awesome 목록. 출처 어댑터로 나중에 추가한다.
- 저장소(코드) 공개 전환. 공개되는 것은 목록 메타데이터뿐이다. 코드 공개는 법률 검토 뒤(STATUS "Release").
- 샌드박스 실행이나 A/B를 크롤러에서 돌리는 것. 크롤러는 정적 검사만 한다.

**실패 조건 (동작해도 실패로 본다)**
- 공개 목록에 스킬 본문이나 코드가 들어간다(결정 16 위반).
- 목록 주소가 죽었을 때 스토어가 비거나 앱이 오류로 멈춘다.
- 목록에 적힌 등급만 믿고 설치한다. 설치·테스트 직전에는 지금처럼 받은 파일을 다시 검사해야 한다.
- 크롤러 코드나 보안 검사 코드가 공개 저장소에 올라간다.

## 3. 출처와 포함 기준
| 출처 | `source` 값 | 찾는 방법 |
|---|---|---|
| `anthropics/skills` | `claude-official` | 저장소 트리에서 `SKILL.md` |
| `openai/skills` | `codex-official` | 저장소 트리에서 `SKILL.md`(`skills/.curated/` 등) |
| GitHub 커뮤니티 | `github` | 토픽 검색(`agent-skills`, `claude-skills` 등) + `SKILL.md` 코드 검색, 찾은 저장소의 트리에서 `SKILL.md` |

커뮤니티 포함 기준(사용자 합의):
- 스타 50개 이상, 보관(archived) 아님, 포크 아님, 최근 12개월 안에 갱신.
- 라이선스가 없어도 넣는다. `license`를 비워 두고 스토어에 "알 수 없음"으로 보인다.

표시 단위: `SKILL.md` 하나 = 카드 하나. 한 저장소에 여러 스킬이 있으면 각각 카드가 된다(ponytail은 6장). 같은 저장소 안의 사본(예: `.openclaw/skills/`)은 기존 `dedupe`의 콘텐츠 hash로 합쳐진다.

## 4. 접근 방식
| 방식 | 내용 | 판단 |
|---|---|---|
| **A. 코드는 이 저장소, 결과만 공개 저장소 (선택)** | 크롤러를 이 비공개 저장소 `crawler/`에 두고 `packages/core`를 재사용. 이 저장소의 GitHub Actions가 매일 돌고 결과만 공개 저장소 `seongjooon/somm-index`의 Pages로 올린다 | 메타데이터만 공개, 등급 규칙이 앱과 같다 |
| B. 크롤러까지 공개 저장소에 | 크롤러 코드가 공개된다 | 보안 검사 코드를 공개하거나 복사해야 해서 법률 검토 전 원칙과 맞지 않음 |
| C. 앱이 직접 크롤링 | Actions 없이 앱이 실행 시 모은다 | 사용자별 GitHub 호출 한도, 느림. PRD가 피한 방식 |

사용자는 A를 골랐다(2026-11-24).

## 5. 설계
### 5.1 크롤러 (`crawler/`, 이 저장소)
- Node 스크립트. `packages/core`의 `fetchSkillFiles`(sparse clone), `scanSkill`, `staticGrade`, `skillTraits`, `hashFiles`를 그대로 쓴다.
- 출처마다 어댑터 하나(`crawler/sources/<name>.ts`), 공통 인터페이스는 기존 `SourceAdapter`와 같은 모양으로 `SkillMeta[]`를 돌려준다.
- 각 스킬을 크롤링 시점의 커밋 SHA로 고정한다(`ref` = 커밋 SHA). 미리 계산한 등급이 그 커밋 내용과 맞도록 하기 위해서다.
- 각 스킬마다 파일을 받아 정적 검사를 하고 `grade`, `contentHash`, 특성(scripts/hooks/MCP 여부)을 기록한다.
- 부분 실패 처리 [작성자 판단]: 스킬 하나의 받기나 검사가 실패하면 전날 목록의 그 항목(등급, 고정 커밋 포함)을 그대로 이어 쓰고, 7일 연속 실패하면 뺀다. 출처 하나가 통째로 실패하거나, 전체 스킬 수가 전날보다 20% 넘게 줄면 그날은 배포하지 않고 Actions를 실패로 끝낸다(전날 목록이 그대로 남는다). 스냅샷 이력이 끊기지 않게 하기 위해서다.
- 스냅샷: 전날 공개된 `index.json`을 받아 스킬별 `snapshots`에 오늘 값(설치 수가 없으므로 스타 수)을 이어 붙인다. 보존 기간은 최근 400일.
- GitHub API는 Actions 토큰으로 인증한다. 검색 API 한도(분당 요청 수)를 지키도록 요청 간격을 둔다.

### 5.2 배포 (GitHub Actions)
- 이 저장소의 `.github/workflows/crawl.yml`: 하루 한 번 예약 실행 + 수동 실행.
- 결과 `index.json`(과 날짜별 사본 `snapshots/YYYY-MM-DD.json`)을 공개 저장소 `seongjooon/somm-index`의 Pages 브랜치에 커밋한다.
- 공개 저장소에 쓰는 권한은 그 저장소 하나에만 쓰기가 허용된 토큰(fine-grained PAT)을 이 저장소의 Actions secret으로 등록해 쓴다.
- 공개 저장소에는 생성된 JSON과 README(무엇인지, 메타데이터만 있음, 원본 링크)만 둔다.

### 5.3 인덱스 형식
- 최상위: `{ version: 1, generatedAt, skills: SkillMeta[] }`. 기존 샘플은 `{ _note, skills }`이므로 앱은 두 형식을 모두 읽는다.
- `SkillMeta`에 선택 필드를 더한다: `grade?: Grade`(정적 등급), `traits?: { hasScripts: boolean; hasHooks: boolean; hasMcp: boolean }`, `pushedAt?: string`. [작성자 판단] 기존 `SkillTraits.commands`(스킬 안의 명령 문자열)는 본문 일부라서 넣지 않는다(결정 16). 기존 필드(`id, name, description, source, repoUrl, ref, path, stars, snapshots, agents, license, category, contentHash, isFork`)는 그대로.
- `id` 규칙 [작성자 판단]: 공식 출처는 샘플과 같은 규칙을 유지한다(`anthropics/<스킬 폴더명>`, `openai/<스킬 폴더명>`). 그래서 기존 실행 기록과 설치 표시가 그대로 이어진다. 커뮤니티는 `<owner>/<repo>/<path>`로 저장소와 경로가 유일하게 드러나게 한다. 두 규칙이 겹치지 않는지 크롤러가 검사한다.
- 본문, 파일 목록, 검사 상세(findings)는 넣지 않는다(결정 16).

### 5.4 앱 (`packages/core` + 데스크톱 + CLI)
- `packages/core/src/sources/`에 `createIndexSource(url)`를 추가한다. 받은 JSON의 형식과 크기(상한 예: 20 MB)를 검사하고, 항목마다 기존 `validate`와 같은 규칙(https URL, 안전한 path/ref)을 통과한 것만 쓴다.
- 받은 목록은 `skills_cache`에 저장한다(테이블은 이미 있음). 받기에 실패하면 `skills_cache`의 마지막 목록, 그것도 없으면 샘플을 쓴다.
- 지금 샘플을 직접 부르는 곳(데스크톱 store, detail, runner, installs, 그리고 fake 2곳, CLI search, scan, install, test)을 출처 하나(예: `loadCatalog(platform)`)로 바꾼다. fake 파일은 샘플을 계속 써도 된다.
- 스토어 카드 등급: 지금은 `scan_cache`에 있는 스킬만 등급이 보인다. 목록의 `grade`가 있으면 그것을 보여 주고, 사용자가 직접 검사한 결과가 있으면 그쪽을 우선한다.
- 설치와 테스트 직전에는 지금처럼 파일을 받아 다시 검사한다. 목록 등급만으로 설치 게이트를 정하지 않는다.
- 데스크톱 네트워크: 목록 주소 한 곳만 허용한다. HTTP 플러그인(`tauri-plugin-http`, 공식 플러그인) 또는 Rust 명령 하나로 받는다. CSP `connect-src`에 그 주소를 추가한다. 다른 외부 주소는 열지 않는다.
- CLI: Node `fetch`로 같은 주소를 받는다. 환경 변수(예: `SOMM_INDEX_URL`)로 주소를 바꿀 수 있게 해 테스트에 쓴다.

## 6. 사용자가 할 일 (구현 뒤, 계정 작업)
1. GitHub에 공개 저장소 `seongjooon/somm-index`를 만들고 Pages를 켠다.
2. 그 저장소에만 쓰기 권한이 있는 fine-grained 토큰을 만들어 이 저장소의 Actions secret으로 등록한다.
3. 첫 수동 실행 결과를 확인한 뒤 앱 기본 주소를 켠다.

## 7. 빌더에게 맡기는 것과 남은 질문
- 토픽 목록과 코드 검색 쿼리의 정확한 문구, 요청 간격.
- `crawler/` 실행 방식(esbuild 번들 또는 tsx). 새 의존성은 최소로.
- 크롤러 테스트: 출처 어댑터는 고정 응답(fixture)으로 단위 테스트, 실제 GitHub 호출은 수동 실행으로 확인.
