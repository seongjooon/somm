# T18 실제 스킬 목록 구현 계획

> **실행 방식:** AGENTS.md를 따른다. 태스크 하나 = Paseo handoff로 시작한 Codex 세션 하나 = worktree 하나 = 브랜치 하나 = PR 하나(base `origin/main`). subagent-driven-development는 쓰지 않는다. 리드(Claude)가 PR마다 재검증하고 Codex advisor 리뷰 뒤 사용자 승인으로 머지한다. 체크박스(`- [ ]`)로 진행을 표시한다.

**목표:** 샘플 목록을 GitHub Actions 크롤러가 매일 만드는 공개 `index.json`으로 바꾸고, 앱과 CLI가 그것을 받아 쓰게 한다.

**구조:** 크롤러는 이 비공개 저장소 `crawler/`에서 `@somm/core`를 재사용해 출처를 모으고 정적 검사로 등급을 계산한다. 결과 JSON만 공개 저장소 `seongjooon/somm-index`의 Pages로 배포한다. 앱은 `loadCatalog`로 목록을 받아 `skills_cache`에 저장하고, 실패하면 캐시, 그다음 샘플을 쓴다.

**기술:** TypeScript, pnpm workspace, vitest, esbuild(크롤러 번들), GitHub Actions, Tauri 2 공식 `tauri-plugin-http`.

**스펙:** `docs/superpowers/specs/2026-11-24-t18-skill-catalog-design.md` (2026-11-24 승인)

## 전역 제약
- 공개 목록에는 메타데이터만: 스킬 본문, 파일 목록, findings, `SkillTraits.commands`를 넣지 않는다(결정 16).
- 커뮤니티 포함 기준: 스타 ≥ 50, archived 아님, 포크 아님, `pushed_at`이 12개월 이내. 라이선스 없음도 포함(`license` 생략).
- 공식 id는 샘플 규칙 유지: `anthropics/<폴더명>`, `openai/<폴더명>`. 커뮤니티 id: `<owner>/<repo>/<path>`.
- `ref`는 크롤링 시점 커밋 SHA(40자 hex).
- 부분 실패: 오늘 크롤링에서 빠진 스킬(받기·검사 실패, 저장소 실패로 건너뜀, 검색 누락 모두)은 전날 항목을 이어 쓰고, 7일 연속 빠지면 제외. 공식 출처 실패 또는 총수가 전날 대비 20% 초과 감소면 배포 중단(종료 코드 1). 커뮤니티 저장소 하나의 실패는 출처 실패가 아니다(태스크 2에서 건너뛰고 경고만 남긴다).
- 스냅샷 보존 400일. 커뮤니티 값은 스타 수.
- 기본 목록 주소: `https://seongjooon.github.io/somm-index/index.json` (`DEFAULT_INDEX_URL`). 받은 본문 상한 20 MiB.
- 데스크톱은 목록 주소 한 곳만 허용한다. 다른 외부 주소를 열지 않는다.
- 설치·테스트 게이트는 목록 등급이 아니라 받은 파일의 재검사 결과로 정한다(기존 동작 유지).
- 파일당 300줄 이하, 새 의존성 최소(크롤러는 기존 `esbuild`만, 데스크톱은 `tauri-plugin-http`만 추가).
- 커밋: Conventional Commits, 메시지 끝 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. PR 본문 끝 `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

## 리뷰 집중 항목
1. 첫 실행부터 목록 주소가 죽어 있음(somm-index 저장소가 아직 없는 지금 상태) → 스토어는 샘플을 오류 없이 보여 준다. (태스크 1 `loadCatalog falls back to sample`, 태스크 5 수동 확인)
2. 적대적이거나 깨진 목록: `http://` 저장소, `..` 경로, 잘못된 ref, 20 MiB 초과, JSON 아님 → 나쁜 항목만 빠지거나(항목 단위) 목록 전체를 거부하고 캐시를 쓴다(크기·형식). (태스크 1)
3. 형식 버전: 샘플형 `{ _note, skills }`와 `{ version: 1, ... }`는 읽고, `version: 2` 이상은 거부한다. (태스크 1)
4. GitHub 한도 초과나 일부 저장소 실패 → 전날 항목 이어 쓰기, 20% 감소 가드. (태스크 3)
5. 공식 저장소가 커뮤니티 검색에도 잡힘, 한 저장소 안 사본(`.openclaw/skills/`) → 카드 중복 없음. 반대로 점 폴더(`.curated`, `.claude/skills`)의 스킬이 빠지면 안 됨. (태스크 2, 3)

---

## Wave 1 (BE): 코어 목록 출처

### 태스크 1: 인덱스 파싱과 `loadCatalog`
**PR:** `feat/core-index-source`

**Files:**
- Modify: `packages/core/src/types.ts` (SkillMeta 선택 필드)
- Create: `packages/core/src/sources/index-source.ts`, `packages/core/src/sources/catalog.ts`
- Modify: `packages/core/src/sources/index.ts` (export)
- Modify: `packages/core/src/sources/fetch.ts` (`validate`를 export만 한다. 동작 변경 없음)
- Test: `packages/core/src/sources/index-source.test.ts`, `packages/core/src/sources/catalog.test.ts`

**Interfaces:**
- Produces:
  - `SkillMeta`에 `grade?: Exclude<Grade, 'F'>; traits?: PublicTraits; pushedAt?: string` 추가. `export type PublicTraits = { hasScripts: boolean; hasHooks: boolean; hasMcp: boolean }`.
  - `export const DEFAULT_INDEX_URL = 'https://seongjooon.github.io/somm-index/index.json'`
  - `export const INDEX_BYTE_LIMIT = 20 * 1024 * 1024`
  - `export function parseIndex(text: string): SkillMeta[]` — 형식·버전·크기 검사 실패 시 throw, 항목 단위 검증 실패는 조용히 제외.
  - `export function validSkillMeta(meta: SkillMeta): boolean` — `fetch.ts`의 `validate` 규칙(https URL, 안전한 path, ref 형식)을 재사용. `validate`를 export해서 감싼다.
  - `export interface CatalogOptions { url?: string; fetchText?: (url: string) => Promise<string> }`
  - `export async function loadCatalog(p: Platform, options?: CatalogOptions): Promise<{ skills: SkillMeta[]; origin: 'remote' | 'cache' | 'sample' }>` — 원격 성공 시 `skills_cache`를 통째로 교체(`DELETE` 후 `INSERT`, `fetched_at` ISO), 실패 시 캐시, 캐시 없으면 `createSampleSource()`. `fetchText` 기본값은 전역 `fetch`.

- [ ] **Step 1: 실패하는 테스트 작성** (`index-source.test.ts`)
  - `parses version 1 and legacy sample shape`: `{version:1,generatedAt:'2026-11-24T00:00:00Z',skills:[ok]}`와 `{_note:'x',skills:[ok]}` 둘 다 길이 1.
  - `rejects unknown version`: `{version:2,skills:[]}` → throw.
  - `rejects oversized or non-JSON input`: `'x'.repeat(INDEX_BYTE_LIMIT + 1)` → throw, `'not json'` → throw.
  - `drops unsafe entries only`: `repoUrl:'http://…'`, `path:'a/../b'`, `ref:'-x'` 항목은 빠지고 정상 항목은 남는다.
  - `keeps grade and public traits, strips unknown trait keys`: `traits:{hasScripts:true,hasHooks:false,hasMcp:false,commands:['rm']}` → 결과 traits에 `commands` 없음.
- [ ] **Step 2:** `pnpm --filter @somm/core test -- src/sources/index-source.test.ts` → FAIL(모듈 없음).
- [ ] **Step 3:** `parseIndex`, `validSkillMeta` 구현. 크기는 `new TextEncoder().encode(text).length`로 잰다.
- [ ] **Step 4: 실패하는 테스트 작성** (`catalog.test.ts`, `testkit.test.ts`처럼 `:memory:` DB + `migrate`)
  - `remote success replaces cache`: fetchText가 2개 반환 → `origin:'remote'`, `skills_cache` 행 2개. 두 번째 호출에서 1개 반환 → 행 1개.
  - `falls back to cache when remote fails`: 첫 호출 성공 후 fetchText가 throw → `origin:'cache'`, 같은 목록.
  - `falls back to sample when no cache`: 빈 DB + throw → `origin:'sample'`, 샘플 20개.
  - `invalid remote keeps previous cache`: 성공 후 `{version:2}` 반환 → `origin:'cache'`, 캐시 그대로.
- [ ] **Step 5:** `loadCatalog` 구현, 테스트 통과 확인: `pnpm --filter @somm/core test` 전체 PASS, `pnpm -r check` 오류 0.
- [ ] **Step 6:** 커밋 `feat: load the skill catalog from a remote index with cache and sample fallback`

## Wave 2 (BE): 크롤러

### 태스크 2: 크롤러 패키지와 출처 어댑터
**PR:** `feat/crawler-sources`

**Files:**
- Modify: `pnpm-workspace.yaml` (`- crawler` 추가)
- Create: `crawler/package.json`(`name: @somm/crawler`, private, scripts `test`, `check`, `build`: esbuild → `dist/crawl.js`, 의존성 `@somm/core: workspace:*`), `crawler/tsconfig.json`
- Create: `crawler/src/github.ts`, `crawler/src/sources/official.ts`, `crawler/src/sources/community.ts`, `crawler/src/types.ts`
- Test: `crawler/src/sources/*.test.ts`, `crawler/fixtures/*.json`

**Interfaces:**
- Consumes: 태스크 1의 `SkillMeta`, `PublicTraits`.
- Produces:
  - `export interface GitHubClient { getJson<T>(path: string): Promise<T> }` / `export function createGitHubClient(token: string | undefined, options?: { minIntervalMs?: number; fetchImpl?: typeof fetch }): GitHubClient` — `https://api.github.com` + path, `Authorization: Bearer`, 요청 사이 `minIntervalMs`(기본 2500, 검색 한도 분당 30 대비), 403/429면 `retry-after` 또는 `x-ratelimit-reset`까지 한 번 기다렸다 재시도.
  - `export interface Candidate { source: 'claude-official' | 'codex-official' | 'github'; owner: string; repo: string; commit: string; path: string; stars: number; license?: string; pushedAt: string; description?: string }`
  - `export async function officialCandidates(gh: GitHubClient): Promise<Candidate[]>` — `anthropics/skills` → `claude-official`, `openai/skills` → `codex-official`. 기본 브랜치 커밋 SHA를 받고 트리(`?recursive=1`)에서 모든 `SKILL.md`를 찾는다. 점으로 시작하는 폴더도 포함한다(`openai/skills`는 39개가 `skills/.curated/`, 5개가 `skills/.system/` 아래에 있다).
  - `export const COMMUNITY_TOPICS = ['agent-skills', 'claude-skills', 'codex-skills', 'claude-code-skills']`
  - `export async function communityCandidates(gh: GitHubClient, today: string): Promise<Candidate[]>` — 토픽 검색(`/search/repositories?q=topic:<t>+stars:>=50+fork:false+archived:false+pushed:>=<today-365일>`)과 코드 검색(`/search/code?q=filename:SKILL.md`, 저장소만 추출 후 같은 기준으로 저장소 정보 확인)을 합친 뒤, 저장소별 트리에서 `SKILL.md` 경로를 뽑는다. `anthropics/skills`, `openai/skills`는 제외. 점으로 시작하는 폴더도 포함한다(`.claude/skills/`에 스킬을 두는 저장소가 흔하다). 같은 내용의 사본은 태스크 3에서 합친다. 저장소 루트의 `SKILL.md`는 `path: '.'`.

- [ ] **Step 1: 실패하는 테스트 작성** — fixture 응답을 돌려주는 가짜 `GitHubClient`로:
  - `official finds SKILL.md dirs and pins commit`: 트리에 `skills/.curated/yeet/SKILL.md`, `skills/.system/skill-installer/SKILL.md`, `README.md` → 후보 2개, `commit`이 fixture SHA, 경로가 그대로.
  - `community applies thresholds`: 스타 49, archived, fork, 13개월 전 push 저장소는 빠지고 기준 통과 저장소만 남는다.
  - `community skips official repos`: `anthropics/skills`가 토픽 검색에 있어도 제외. ponytail형 트리(`skills/a/SKILL.md`, `.openclaw/skills/a/SKILL.md`)는 후보 2개(합치기는 태스크 3).
  - `root SKILL.md uses dot path`.
  - `client waits between requests and retries once on 429` (`fetchImpl` 가짜, 가짜 타이머).
- [ ] **Step 2:** `pnpm --filter @somm/crawler test` → FAIL.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** `pnpm --filter @somm/crawler test`, `pnpm -r check` PASS.
- [ ] **Step 5:** 커밋 `feat: add crawler source adapters for official and community skills`

### 태스크 3: 크롤링 조립, 이어 쓰기, 배포 가드
**PR:** `feat/crawler-build`

**Files:**
- Create: `crawler/src/enrich.ts`, `crawler/src/merge.ts`, `crawler/src/main.ts`
- Test: `crawler/src/enrich.test.ts`, `crawler/src/merge.test.ts`

**Interfaces:**
- Consumes: 태스크 2의 `Candidate`, `GitHubClient`; 태스크 1의 `parseIndex`, `SkillMeta`; core의 `fetchSkillFiles`, `scanSkill`, `skillTraits`, `hashFiles`, `createNodePlatform`(`@somm/core/node`).
- Produces:
  - `export function skillId(c: Candidate): string` — 공식: `anthropics/<path 마지막 폴더>`, `openai/<path 마지막 폴더>`; 커뮤니티: `<owner>/<repo>/<path>`. 공식 id가 겹치면(같은 폴더명) 크롤러가 실패로 끝내고 로그에 남긴다.
  - `export function collapseCopies(items: SkillMeta[]): SkillMeta[]` — 같은 저장소 안에서 `contentHash`가 같은 항목은 하나만 남긴다. 점으로 시작하는 폴더가 없는 경로를 우선, 그다음 짧은 경로.
  - `export async function enrich(p: Platform, c: Candidate): Promise<SkillMeta>` — `repoUrl: https://github.com/<owner>/<repo>.git`, `ref: c.commit`, 파일을 받아 `scanSkill`(name은 SKILL.md frontmatter `name`, 없으면 폴더명), `grade`, `traits`(commands 제외), `contentHash`, `agents`(공식은 출처대로, 커뮤니티는 `agents/openai.yaml`이 있으면 `['claude','codex']`, 없으면 `['claude']`), `description`(frontmatter `description`, 없으면 저장소 설명), `stars`, `license`, `pushedAt`, `snapshots: []`.
  - `export interface MergeInput { today: string; previous: SkillMeta[]; fresh: SkillMeta[]; failureDays: Record<string, number>; sourcesFailed: string[] }`
  - `export function merge(input: MergeInput): { skills: SkillMeta[]; failureDays: Record<string, number>; publish: boolean; reason?: string }` — 규칙은 전역 제약 그대로: `previous`에 있고 `fresh`에 없는 항목은 이유와 상관없이 전날 것을 이어 쓰고 `failureDays[id] += 1`, 7 이상이면 제외; `fresh`에 있는 항목은 0으로 리셋. `enrich`가 실패한 스킬은 `fresh`에 넣지 않는다. 스냅샷은 전날 `snapshots`에 `{date: today, value: stars}`를 붙이고(같은 날짜면 교체) 400일보다 오래된 것은 버린다. `sourcesFailed`가 비어 있지 않거나 `skills.length < previous.length * 0.8`이면 `publish:false`.
  - `crawler/src/main.ts`: 전날 `index.json`(`DEFAULT_INDEX_URL`, 없으면 빈 목록)과 `failures.json`(같은 Pages 경로)을 받아 → 후보 수집 → `enrich`(동시 4개) → `merge` → `out/index.json`(`{version:1, generatedAt, skills}`), `out/failures.json`, `out/snapshots/<today>.json` 작성. `publish:false`면 이유를 출력하고 종료 코드 1. `enrich` 뒤 `collapseCopies`를 거친다. 결과는 `parseIndex`로 다시 검증한 뒤 쓴다.
- [ ] **Step 1: 실패하는 테스트 작성**
  - `skillId keeps sample ids for official skills`: `{source:'claude-official', path:'skills/xlsx'}` → `anthropics/xlsx`; 커뮤니티 `dietrichgebert/ponytail/skills/ponytail`.
  - `enrich pins ref and omits commands` (로컬 git 저장소 fixture를 `allowLocal`로; `fetch.test.ts`의 방식 참고): `ref`가 SHA, `traits`에 `commands` 키 없음, `grade` 존재.
  - `collapseCopies keeps one of same-content copies`: `skills/a`와 `.openclaw/skills/a`가 같은 hash → `skills/a`만 남음. 다른 저장소의 같은 hash는 둘 다 남음(앱의 `dedupe`가 처리).
  - `merge carries forward missing skills and drops after 7 days` (enrich 실패, 저장소 건너뜀, 검색 누락을 같은 규칙으로).
  - `merge appends snapshot and trims to 400 days`.
  - `merge blocks publish on source failure or >20% drop`: 이전 100개, 신규 79개 → `publish:false`; 80개 → `true`.
- [ ] **Step 2:** `pnpm --filter @somm/crawler test` → FAIL.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** 테스트 PASS, `pnpm --filter @somm/crawler build` 성공, `pnpm -r check` 오류 0.
- [ ] **Step 5:** 로컬 수동 실행(토큰 없이 공식 출처만이라도): `GITHUB_TOKEN=$(gh auth token) node crawler/dist/crawl.js --out /tmp/somm-index` → `index.json`의 공식 스킬 수(64 안팎)와 커뮤니티 수를 PR에 적는다.
- [ ] **Step 6:** 커밋 `feat: build, merge and guard the crawled skill index`

### 태스크 4: 예약 실행 워크플로
**PR:** `ci/crawl-workflow`

**Files:**
- Create: `.github/workflows/crawl.yml`, `crawler/publish/README.md`(공개 저장소용: 무엇인지, 메타데이터만 있음, 원본 저장소 링크, 갱신 주기)

**Interfaces:**
- Consumes: 태스크 3의 `crawler/dist/crawl.js`와 `out/` 구조.
- Produces: 매일 `cron: '17 3 * * *'`(UTC) + `workflow_dispatch`. 단계: checkout → pnpm 설치 → `pnpm --filter @somm/crawler build` → `node crawler/dist/crawl.js --out out` (env `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`) → `out/`과 `crawler/publish/README.md`를 `seongjooon/somm-index`의 `gh-pages` 브랜치에 커밋·푸시(토큰 `secrets.SOMM_INDEX_TOKEN`, 이 저장소 하나에만 contents write 권한인 fine-grained PAT). `permissions: contents: read`.

- [ ] **Step 1:** 워크플로 작성. `actionlint`가 있으면 통과 확인, 없으면 YAML 문법만 확인(`python3 -c "import yaml,sys;yaml.safe_load(open('.github/workflows/crawl.yml'))"`).
- [ ] **Step 2:** 커밋 `ci: add daily skill index crawl workflow`. 실제 실행은 사용자 계정 작업(스펙 §6) 뒤 수동 실행으로 확인한다. PR에 그 점을 "검증 안 됨"으로 적는다.

## Wave 3 (FE / CLI): 앱 연결

### 태스크 5 (FE): 데스크톱이 목록을 받아 쓰기
**PR:** `feat/desktop-remote-catalog`

**Files:**
- Modify: `apps/desktop/src-tauri/Cargo.toml`, `apps/desktop/src-tauri/src/lib.rs`(플러그인 등록), `apps/desktop/src-tauri/capabilities/default.json`(`http:default`에 `DEFAULT_INDEX_URL` 한 곳만 allow), `apps/desktop/package.json`(`@tauri-apps/plugin-http`)
- Modify: `apps/desktop/src/features/store/Page.svelte`, `detail/Page.svelte`, `runner/service.ts`, `installs/service.ts` (fake 파일은 샘플 유지)
- Create: `apps/desktop/src/platform/catalog.ts` — `export function fetchIndexText(url: string): Promise<string>` (plugin-http `fetch`, 상태 200 아니면 throw). plugin-http 요청은 IPC로 가므로 CSP `connect-src`는 넓히지 않는다. 필요하다고 확인되면 그 주소 하나만 추가한다.
- Test: `apps/desktop/src/features/store/*.test.ts`(기존 패턴), `apps/desktop/src-tauri/src/platform.rs` 테스트에 http allow 검사 추가

**Interfaces:**
- Consumes: 태스크 1의 `loadCatalog(p, { fetchText: fetchIndexText })`, `SkillMeta.grade`.
- Produces: 스토어 등급 = `scan_cache` 결과가 있으면 그것, 없으면 `meta.grade`. 스토어는 `origin === 'sample'`일 때 "샘플 데이터" 안내 한 줄(i18n 키 `store.sampleNotice`, en "Showing sample data. The live catalog could not be loaded.", ko "샘플 데이터를 보여 주고 있습니다. 실제 목록을 불러오지 못했습니다.").
- [ ] **Step 1: 실패하는 테스트**: 등급 우선순위 함수(예: `effectiveGrade(meta, cached)`) — 캐시 있으면 캐시, 없으면 `meta.grade`, 둘 다 없으면 `undefined`. Rust: capability의 `http:default` allow가 정확히 `DEFAULT_INDEX_URL` 하나.
- [ ] **Step 2:** 실패 확인 → 구현 → `pnpm -r test`, `pnpm -r check`, `pnpm -r build`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` PASS.
- [ ] **Step 3: 수동 확인(리드가 사용자에게 요청):** `tauri dev`에서 목록 주소가 아직 없으면 샘플 20개와 안내 한 줄이 보인다. 상세·테스트·설치가 기존처럼 동작한다.
- [ ] **Step 4:** 커밋 `feat: load the store from the remote skill index in the desktop app`

### 태스크 6 (CLI): CLI가 목록을 받아 쓰기
**PR:** `feat/cli-remote-catalog`

**Files:**
- Modify: `apps/cli/src/commands/{search,scan,install,test}.ts`, `apps/cli/README.md`
- Test: `apps/cli/src/commands/*.test.ts`(기존 패턴)

**Interfaces:**
- Consumes: 태스크 1의 `loadCatalog(p, { url: env.SOMM_INDEX_URL || DEFAULT_INDEX_URL })`(기본 `fetch`).
- Produces: 네 명령이 `loadCatalog`의 목록에서 id를 찾는다. `--json` 출력에 `catalogOrigin` 필드 추가. 사람용 출력은 `origin === 'sample'`일 때 첫 줄에 `Using sample data (live catalog unavailable).`
- [ ] **Step 1: 실패하는 테스트**: `SOMM_INDEX_URL`을 존재하지 않는 로컬 주소로 둔 `search` → 샘플 결과 + `catalogOrigin:'sample'`; 가짜 서버(또는 `file` 대신 주입한 fetch)로 1개 목록 → 그 1개만 검색됨.
- [ ] **Step 2:** 실패 확인 → 구현 → `pnpm -r test`, `pnpm -r check`, `pnpm -r build` PASS, `node apps/cli/dist/cli.js search --json | head` 확인.
- [ ] **Step 3:** 커밋 `feat: load the skill catalog from the remote index in the CLI`

## 마무리 (리드)
- Wave 3까지 머지되면 사용자에게 스펙 §6(공개 저장소, 토큰) 진행을 안내하고, `workflow_dispatch`로 첫 실행 → 공개 주소 확인 → `tauri dev`에서 실제 목록 표시 확인 → `docs/STATUS.md` 갱신.
