# QA-ASD-STE100 — Plan

An all-in-one **test generator** for testers. The tester works in one screen: a **chat**, a
**live browser** that shows every action as it happens, and **action buttons**. They build automated
tests by recording, by writing in the chat, or both. When the tester decides a test is strong, the
app **translates it into the team's automation framework, following that framework's standards**.

The app knows two things the tester gives it: the **automation framework** (read-only clone, to learn
its standards) and a **knowledge base** (documentation files and links about the platform under test).

**First audience:** manual testers (non-technical) who create automated tests.
**Later:** technical users (mode chosen at first start; the technical mode is designed later).
**POC:** tested on `automation-playwright-ts` and its platform, but nothing in the app may depend on
that repository or that platform.

## Principles

| Principle | Meaning |
|---|---|
| **Platform-agnostic** | No platform-specific login, URLs, cookie names or page knowledge in the app. The tester logs in to their application by hand in the live browser; the app keeps that session. |
| **Universal (any framework)** | Built to support any language. **For now: TypeScript (and JavaScript) and Python frameworks**, with any test tool (Playwright, Cypress, WebdriverIO, pytest, Selenium…); other languages get a plain "not supported yet". The app detects the language and tools; Node setup steps run only for TypeScript frameworks (test browser only with Playwright, code check only with TypeScript). No assumptions about folders, env variable names or suites: the framework's own rules (`CLAUDE.md`, guidelines, skills, existing tests) tell the assistant the standard; without them it learns from the existing tests. Drafts never depend on the framework. |
| **Two stages** | 1. **Draft tests** in the app: simple, readable, run by the app in the live browser. 2. **Translation** of strong drafts into the framework standard. The framework is never needed to create a draft. |
| **One place to watch** | The user, Claude and test runs all use the **same visible browser**. Nothing important happens in a hidden window. |
| **Plain language** | For non-technical users: no code, files or jargon unless they ask. Technical details under "Show details". |
| **Repository** | The tester chooses a folder on the computer or clones a repository (SSH with their own key, or HTTPS with a read-only token), in a visible **Repository** section. The app works in its own copy. With an SSH key linked to their Azure DevOps or GitHub account, the tester may also **commit, push and open a pull request** for translated tests (S6); without it, results leave the app as an export. |

## The Studio (main screen)

```
┌──────────────────────┬─────────────────────────────────────────────┬──────────────────┐
│ CHAT                 │ LIVE BROWSER                                │ ACTIONS          │
│                      │ [←][→][⟳] https://my-tenant.example.com     │ ● Record         │
│ Claude: What should  │ ┌─────────────────────────────────────────┐ │ Check text       │
│ the test check at    │ │                                         │ │ Check visible    │
│ the end?             │ │   the application, live: what the user  │ │ Undo             │
│ [Text is shown] [..] │ │   clicks, what Claude does, what a test │ │ ───────────────  │
│                      │ │   run does                              │ │ Steps            │
│ You: also check the  │ │                                         │ │ 1 Opened Home    │
│ success message      │ └─────────────────────────────────────────┘ │ 2 Clicked "New"  │
│ [ Write…      ][Send]│ Running: "Answer is kept after reload" ✓    │ ✓ "Saved" shown  │
└──────────────────────┴─────────────────────────────────────────────┴──────────────────┘
```

- **Record:** the tester uses the application in the live browser; each action appears as a step, with a screenshot. Check buttons turn the next click into a check.
- **Chat:** the tester writes what they want ("open the QnA page and add an item called Test"). **Claude acts in the same browser**, and the tester watches it happen. Claude asks questions with answer buttons, and shows the plan for approval.
- **Both at once:** recorded steps are visible to Claude, and Claude's actions become steps too.
- **Run:** the draft test runs in the live browser; the result shows in the chat (passed/failed, which step).

## Tests: draft → strong → framework

| Stage | What it is | Who uses it |
|---|---|---|
| **Draft** | The app's own test: steps and checks, kept as a simple, standard Playwright script plus a plain-language description. Runs in the live browser with the tester's session. | The tester, in the Studio |
| **Strong** | The tester marks a draft as ready after it passes. Optional: run it again 2–3 times to show it is stable. | The tester |
| **Framework** | Claude translates the strong draft into the framework's standard (structure, page objects or helpers, naming, data setup and cleanup, team rules), in the app's read-only working copy. Verified by a run where the framework allows it. | Exported for the QA team |

**Export for QA:** a zip with the translated test files, the plain description and scenarios, and the draft. It never contains credentials.

## Each tester's own environment
- **Your environment** (settings): the application link, username and password of **their own tenant and account**. They are stored on this computer and used by Claude to log in when the session has expired.
- **Login:** the first time, the tester logs in by hand in the live browser. The browser profile is kept per tester, so the tester stays logged in. Nothing here is platform-specific.
- Drafts belong to the tester and run against their own tenant.

## Knowledge base
- Per framework connection: **files** (PDF, Word, Markdown, text, images) and **links** about the platform under test.
- Files are copied into the app's data folder. Claude may read them, and may open only the links in the knowledge base (plus the links added to a test).
- Pages that need a login can't be read through a link: the app says so and suggests uploading the page as a file.
- Shown as a simple list: add a file, add a link, remove, with a short note of what each one is.

## First start
1. **Who are you?** *Manual tester (no coding)* or *Technical user*. (The technical mode is designed later; for now both get the non-technical Studio.)
2. **Connect to Claude:** Claude Code on this computer, or an API key (already built).
3. **Preparing:** automatic. Clone the framework (read-only), make the app's working copy, install the browser. Admins set the repository link and token, or a local folder (already built).
4. **Your environment:** application link, username, password, then log in once in the live browser.
5. **Knowledge base:** optional; add documentation now or later.

## How it works

| Part | How |
|---|---|
| **Live browser** | The app starts a real Chromium (Playwright) with a **persistent profile per tester** and a debugging port. The Studio shows it live (DevTools screencast) and forwards the tester's mouse and keyboard. One browser serves the tester, Claude and test runs. Fallback if the live view is not smooth enough: the same Chromium as a separate window docked next to the app. |
| **Recorder** | A script injected into every page of the live browser (Playwright `addInitScript` + binding). Same element descriptions as now: role, name, label, test id, text, CSS path. |
| **Claude in the browser** | Playwright MCP connected to the live browser over CDP (`--cdp-endpoint`), so Claude's actions are visible. Claude's actions are reported as steps. |
| **Draft tests** | A small app-owned Playwright project (in the app's data folder) with a fixture that connects to the live browser (`connectOverCDP`). Claude writes the draft there in a simple, standard style. The app runs it and shows the result in the chat. |
| **Translation** | Claude, in the framework's working copy, with its `CLAUDE.md`, rules and skills, existing tests as examples, and the draft and its recording as input. Credentials are mapped by Claude into what the framework expects (only in the local working copy, never exported). |
| **Claude** | Claude Code on this computer, or the Agent SDK with an API key (built). Plain-language instructions for non-technical users (built). |
| **Repository** | Read-only clone with a token, or a local folder; the app works in its own git worktree (built). |

## Milestones

| # | Scope | Status |
|---|---|---|
| M0–M1, R1 | Claude connection, Admin (repo link + read-only token or local folder), automatic preparing, setup checks | Built (R1's platform-specific login and `.env` mapping are removed in S1) |
| R2 | Recorder in an in-app panel, review, hand-off to the chat | Built; replaced by S1–S3 (its recorder script and step list are reused) |
| **S1** | **Studio layout** (chat, live browser, actions); live browser with persistent profile, screencast and input; "Your environment" (link, username, password; login by hand); first-start question technical / non-technical; app name QA-ASD-STE100, 1920×1080 window | Built (Claude already uses the live browser over CDP; the action buttons become active in S2) |
| **S2** | Recorder in the live browser; action buttons (record, check text, check visible, undo, clear); steps panel; new steps go to Claude with the next message; "Make a test from these steps" | Built |
| **R** | Repository section: local folder or clone (SSH key created in the app or imported, or HTTPS read-only token); SSH key shown for adding to Azure DevOps / GitHub | Built |
| **S3** | Chat drives the live browser (Playwright MCP over CDP); recorded steps and chat combined; plan approval; tester input paused while Claude works, Stop on the browser; Claude's clicks highlighted | Built |
| **S4** | Draft tests: the assistant writes them in the tester's drafts folder (simple Playwright, fixture connected to the live browser), runs them live, keeps them ("Your tests" with Run / Remove, last result); the framework is only read | Built |
| **S5** | Knowledge base: files and links (with notes) per framework connection; the assistant reads them and may open only those links | Built |
| **S6** | **Translate to framework** on a passing test (assistant, in the framework copy, branch `feature/qa-<name>-<date>` from the base branch, TypeScript or Python in the team's style); verified by a run with the framework's own runner and the QA team's settings (Python: if installed); committed locally; **Send for review**: push with the tester's SSH key and open the prefilled pull-request page (Azure DevOps or GitHub; unverified ones need a confirmation); **Export for QA** (zip) | Built |
| **S7** | Windows installer (electron-builder, per-user, unsigned for now); update check on start from GitHub Releases (public `beniaminzotescu/qa-automation-tool-releases`; source repo private) with Restart now / on close; Git and Node.js install buttons (winget) on Getting ready | Built |
| **UX1** | Past chats (every conversation kept; reopen, continue, delete); first-time onboarding: You → Claude → Framework (clone with SSH key, or a local folder) → Getting ready → Your environment → Documentation → Studio | Built |
| **API1** | Studio switch UI tests / API tests; API workbench (method, path relative to the API link, params, body with JSON check, headers; "use my login from the browser"); answer as status, time, size, folding JSON tree, headers; call history | Built |
| **API2** | Capture API calls the website makes in the live browser (only its UI/API hosts; login headers never stored); click a call to open it in the workbench | Built |
| **API3** | One-click checks on answers (value, status, time) as steps | |
| **API4** | Assistant in API mode, draft API tests, Run, Your tests; translation into the framework's API style | |
| **API5** | Swagger/OpenAPI endpoint list (optional) | |
| **S8** | Technical-user mode, code signing, polish | |

## Risks and mitigations
- **Live browser smoothness** (screencast + forwarded input): measure early in S1; the fallback is a docked Chromium window.
- **Claude and the user acting at the same time:** while Claude acts, the browser is marked "Claude is working" and user input is paused; the user can press **Stop**.
- **Draft tests too tied to the recording** (CSS paths): Claude must prefer roles, labels and test ids; checks must test the business result.
- **Translation quality differs per framework:** Claude follows the framework's own rules and existing tests; the QA team reviews exports.
- **Logins expire:** the persistent profile keeps the session; Claude can log in with the saved username and password when asked.
- **Knowledge base pages behind a login:** offer upload as a file.

## Later
- Technical-user mode (show code, edit drafts, direct framework work)
- More frameworks and languages (Python/pytest, Selenium)
- Scheduled runs and reports
