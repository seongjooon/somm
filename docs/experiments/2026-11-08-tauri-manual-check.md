# Tauri manual check (2026-11-08)

Run the app in your own terminal (it does not exit by itself):

```sh
pnpm install --frozen-lockfile
pnpm --filter desktop tauri dev
```

Mark each item `[x]` (pass) or `[!]` (fail) and paste any error text under it. Do NOT run Quick/Thorough tests or any real agent run here unless you decide to; those use subscription quota and belong to the separate GUI smoke.

## 1. Startup
- [ ] The window opens with no error dialog. Nav shows Store, Detail, Test, Results, Installed, plus Theme and Language selectors.
- [ ] Theme switch (Dark/Light) changes colors immediately.

## 2. Language switch keeps the page (regression check)
- [ ] Open Test, type something in the task box, switch Language to 한국어 then back to English.
- [ ] The page is not reset and the typed text remains. Labels change language.

## 3. Store (`features/store`)
- [ ] Skill cards load; ranking tabs ("All time", "This week") switch.
- [ ] Filters (Category, Agent, Source, License, Minimum grade) change the list. Minimum grade B hides grade D cards.
- [ ] ⌘K focuses the search box; searching by name narrows the cards.
- [ ] Cards show "—" for skills never scanned, and a letter grade for skills already scanned.

## 4. Detail (`features/detail`)
- [ ] Open a skill (e.g. xlsx). Description, file list, traits and static scan appear.
- [ ] For a skill with scripts (e.g. webapp-testing): the Test button is disabled and "Static check only" is shown.
- [ ] Install button state matches the grade ("Test first" for after-test, "Blocked" for blocked).
- [ ] Files and scan load from the cache: no "not allowed by scope" or permission error in the terminal output. This is the original Tauri problem the dotfile fix (#19) addressed; note the exact error you saw before, if any.

## 5. Test page (`features/runner`), no run started
- [ ] "Use demo" fills the demo project. Your demo folder inside the app bundle is not modified (it is copied to a temp folder).
- [ ] Choosing Subscription + Thorough shows: "This uses 6 runs of your subscription quota. Subscription limits assume individual use."
- [ ] Choosing Isolated shows a password field and the hint "Use a budget-limited throwaway API key; masking is best-effort."
- [ ] Entering a key shorter than 8 characters shows "API key must be at least 8 characters."
- [ ] Cancel and leaving the page clear a typed key (re-open Test: the key field is empty).

## 6. Results (`features/results`)
- [ ] "Run history" lists earlier runs if any exist. Open one: comparison table, verdict line, diffs and security report show.
- [ ] Quick results show whole numbers (no `1000.0`). Thorough means show one decimal.

## 7. Installed (`features/installs`)
- [ ] Per-agent sections show "Not logged in" for an agent you are not logged into.
- [ ] Global and Project lists load. "Choose project" opens a folder picker.
- [ ] A conflict shows "1 conflict" (singular), not "1 conflicts".
- [ ] Backups list shows entries; Restore opens a confirmation (do not restore unless you intend to).

## 8. Data folder and side effects
- [ ] `stat -f "%Sm" "$HOME/Library/Application Support/io.github.seongjooon.somm"` is the only change you expect after a session. No new files appear in `~/.claude/skills` or `~/.agents/skills` just from browsing these screens.

## 9. Result summary
- Date / macOS version / app build (`git rev-parse --short HEAD`):
- Items failed:
- Anything unexpected:
