# somm private beta guide (0.1.0)

Send this guide with the DMG and its checksum. English first, Korean below.

## English

**What somm is.** A desktop app for agent skills: browse them, check their security, test a skill on a copy of your project (with vs without the skill), then install it into Claude Code or Codex. Sir Somm gives a one-line verdict: `pairs well`, `needs to breathe`, or `corked`.

**Before you start**
- A Mac with Apple Silicon (M1 or later). Intel Macs are not supported in this build.
- Claude Code or Codex installed and logged in.
- Tests use your own subscription quota. A Quick test is 2 A/B runs and 3 agent calls, plus 1 if you ask somm to suggest tasks.
- The store shows sample data for now, not the live catalog.

**Install**
1. Check the file: `shasum -a 256 somm_0.1.0_aarch64.dmg` should print `2f7107e91f3d9d33ef4fba6269b9d8b7633ca8358aa3301ff65042c77e1949af`.
2. Open the DMG and drag somm to Applications. It is signed and notarized by Apple, so it should open without a warning.

**Try this (about 5 minutes)**
1. Store: pick a skill, open it, press Test.
2. Test: press "Use demo", choose your agent, keep Quick, press "Suggest three tasks", pick one, press Start.
3. Results: read the verdict, the comparison table and the security report.

**Good to know**
- Tests run on a copy, never on your original project. The copy is not an OS sandbox: the project's own test script runs with your permissions.
- somm never reads, stores, or relays your login credentials or tokens.
- Data lives in `~/Library/Application Support/io.github.seongjooon.somm`. To remove somm, delete the app and that folder.

**Feedback** (reply with answers; screenshots welcome)
1. Did the app open without a warning?
2. Which agent did you use, and did the test finish? If not, what did the screen say?
3. Did the verdict make sense for that skill?
4. Where did you get stuck or confused?
5. Would you use this before installing a skill? Why or why not?

## 한국어

**somm이란.** 에이전트 스킬을 둘러보고, 보안을 검사하고, 내 프로젝트 사본에서 스킬을 썼을 때와 안 썼을 때를 비교한 뒤, Claude Code나 Codex에 설치하는 데스크톱 앱입니다. Sir Somm이 `pairs well`(추천), `needs to breathe`(조건부), `corked`(비추천) 중 한 줄로 판정합니다.

**시작 전에**
- Apple Silicon(M1 이상) Mac이 필요합니다. 이번 빌드는 인텔 Mac을 지원하지 않습니다.
- Claude Code나 Codex가 설치되어 있고 로그인되어 있어야 합니다.
- 테스트는 본인 구독 사용량을 씁니다. Quick 한 번은 A/B 실행 2번, 에이전트 호출 3번입니다. 과제 제안을 쓰면 1번이 더해집니다.
- 스토어 목록은 아직 실제 목록이 아니라 샘플 데이터입니다.

**설치**
1. 파일 확인: `shasum -a 256 somm_0.1.0_aarch64.dmg` 결과가 `2f7107e91f3d9d33ef4fba6269b9d8b7633ca8358aa3301ff65042c77e1949af`이면 정상입니다.
2. DMG를 열고 somm을 응용 프로그램 폴더로 끌어다 놓습니다. Apple 서명과 공증을 받았으므로 경고 없이 열려야 합니다.

**해 볼 것 (약 5분)**
1. Store: 스킬 하나를 골라 열고 Test를 누릅니다.
2. Test: "Use demo"를 누르고, 에이전트를 고르고, Quick을 그대로 둡니다. "Suggest three tasks"로 과제를 받아 하나 고른 뒤 Start를 누릅니다.
3. Results: 판정, 비교 표, 보안 리포트를 확인합니다.

**알아 둘 것**
- 테스트는 원본이 아니라 사본에서 실행됩니다. 다만 사본은 OS 수준 격리가 아니라서, 프로젝트의 테스트 스크립트는 본인 권한으로 실행됩니다.
- somm은 로그인 정보나 토큰을 읽거나 저장하거나 전달하지 않습니다.
- 데이터는 `~/Library/Application Support/io.github.seongjooon.somm`에 있습니다. 삭제하려면 앱과 이 폴더를 지우면 됩니다.

**피드백** (답장으로 보내 주세요. 스크린샷 환영)
1. 앱이 경고 없이 열렸나요?
2. 어떤 에이전트로 테스트했고, 끝까지 됐나요? 안 됐다면 화면에 뭐라고 나왔나요?
3. 판정이 그 스킬에 대해 납득할 만했나요?
4. 막히거나 헷갈린 곳이 있었나요?
5. 스킬을 설치하기 전에 이걸 쓸 것 같나요? 이유는요?
