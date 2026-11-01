# REM-001-FE — Claude Code task package
Status: prepared for forwarding by the user. Codex has not called Claude Code or received a frontend delivery.
Language: American English for implementation notes and default UI; Simplified Chinese is the second UI language.

## Role and product
You are the frontend and interaction owner for Reminder, a Windows desktop personal task and time-management assistant. Codex owns product design, contracts, local backend, main/preload, integration and releases.
Build the first manual task loop only. AI, reminders, calendar scheduling, recurrence, accounts, sync, voice and screenshots are later work.

## Repository and fixed baseline
Repository: https://github.com/tyuubfjkn/Reminder
Source baseline: ab8d214892344be0639d2c801203c01587fa9b6d
Foundation PR: https://github.com/tyuubfjkn/Reminder/pull/1
Branch: cc/rem-001-task-ui
PR target: main
Use your own checkout (for example Reminder-cc), never Codex's codex-rem001 directory.
```powershell
git clone https://github.com/tyuubfjkn/Reminder.git Reminder-cc
cd Reminder-cc
git fetch origin
git switch -c cc/rem-001-task-ui ab8d214892344be0639d2c801203c01587fa9b6d
```
The frozen baseline includes shared design, contract and backend. Read the handoff from main if this document was committed after that baseline. If main advances, coordinate/rebase in your own checkout; do not silently redesign interfaces.

## Shared sources of truth
Design v1.0.0: docs/superpowers/specs/2026-10-31-reminder-design.md
API v1.0.0: packages/contracts/api-v1.d.ts
Behavior/examples/errors: docs/api-v1.md
Implementation plan: docs/superpowers/plans/2026-10-31-rem-001.md (Task 3)
Task register: docs/tasks.md
Actual backend evidence: docs/verification/rem-001.md
Read installed Superpowers instructions and use applicable design, TDD, debugging and verification steps. Reuse these decisions; do not generate a competing product spec or API.

## Task card
ID: REM-001-FE
User outcome: I can create, see, edit, complete and reopen a task, undo a recent edit/completion, change UI language, and reopen the application with my saved data and preferences intact.
Owner: Claude Code.
Dependencies: REM-001-BE and REM-001-IPC at the exact source baseline above.
Allowed modifications: apps/desktop/renderer/** only, including your renderer package.json, package-lock.json, React/TypeScript source, Vite config, HTML/CSS/assets, tests and a renderer README with evidence.
Read-only dependencies: packages/contracts/**, packages/backend/**, apps/desktop/main/**, root package/config/CI, docs/**.
If you need a shared API, root tooling or native-shell change, describe the exact proposal in your PR. Codex coordinates it. Continue unrelated UI work.

## Implementation and startup
Use React + TypeScript with your own renderer package. Choose compatible pinned dependency versions and commit the renderer lockfile. Use Vite with base './'; npm run build must produce apps/desktop/renderer/dist/index.html and relative assets.
Expose scripts: npm run build, npm test (non-watch), npm run typecheck. No renderer Node integration.
Use window.reminder with ReminderApi from packages/contracts/api-v1.d.ts. Put the contract import in a file included by the renderer's TypeScript config; do not copy the declarations.
Build only local assets. Include a restrictive Content-Security-Policy in index.html: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'. Avoid inline scripts/styles and remote fonts. Use a document locale and accessible labels.

From repository root:
1. npm test (backend needs no dependency installation).
2. npm install (root Electron 45.2.1; Codex must own/commit any resulting root lockfile).
3. In apps/desktop/renderer: npm install, npm test, npm run typecheck, npm run build.
4. Back at root: npm run desktop.
The integration shell loads your built dist/index.html. A normal browser dev server has no native bridge and is not evidence of real persistence.
Database is in Electron userData/reminder.sqlite. Do not use localStorage as the task or settings source of truth.

## Real backend available
- window.reminder.tasks.list()
- window.reminder.tasks.create(input)
- window.reminder.tasks.update({id,expectedRevision,patch})
- window.reminder.settings.get()
- window.reminder.settings.update({expectedRevision,patch})
All return Promise<Result<T>>. The backend handles validation, SQLite, timestamps, IDs, completion transitions and revision conflicts.
No HTTP server, credentials or DeepSeek API key is needed.
There is no delete operation, reminder endpoint, execution-slot endpoint or AI endpoint. Do not invent them.

## Mock boundaries
Mocks are allowed only in renderer tests or explicitly selected developer previews. Match API v1 exactly, including failure cases. Never substitute mock success when real IPC fails. Report mock-only checks separately.
Codex verified 15 backend/adapter tests after the independent review fix; see the evidence record for details and two deferred minor findings. Actual Electron window, frontend integration and installer have not been verified in the originating environment because npm DNS access failed. If your environment has the same restriction, implement and test what is possible, and list the missing validation honestly.

## UX requirements
- Simple task list, add/edit form, complete/reopen action and clear pending/completed states.
- Fields: title, notes, priority, nullable estimated minutes and optional deadline (date-only or exact instant with timezone). Do not force a time for a date-only deadline; preserve task text.
- Default en-US independently of OS locale; Settings supports en-US/zh-CN with saved choice and a separate IANA timezone setting.
- Load actual preferences before showing the normal task UI; support loading, empty, validation, unavailable-storage and conflict states.
- Use localized labels, errors and date/time formatting. UI locale must not choose a US timezone. Date-only display must not shift the calendar date.
- Render only confirmed server mutations. Disable duplicate submissions while awaiting a result. Handle both Result errors and rejected IPC Promises.
- Retain previous changed values for an Undo action after edit/complete/reopen. Send undo as an update using the revision returned by the successful mutation. On conflict reload and explain; never overwrite a newer edit. Creation has no delete/undo endpoint in v1.
- Elapsed deadlines never automatically complete tasks.
- Keyboard access, visible focus, labeled controls, accessible completion state; task text must render as text, never HTML.
- Keep implementation details out of normal user flows.

## Acceptance and PR evidence
1. Fresh app: English UI even on a non-English OS; empty state.
2. Create 'Finish my essay' with 180 minutes and a date-only deadline. List shows the saved returned task.
3. Create '数学作业' and verify its text stays unchanged while switching UI language.
4. Edit a task; complete it; undo completion; complete and reopen it explicitly.
5. Invalid blank title is localized and no task is written. A rejected backend call does not show success.
6. Simulate a stale revision; show a localized conflict and refresh without discarding a newer saved edit. Verify undo conflict behavior too.
7. Change to zh-CN, quit the real Electron application, reopen: language, tasks, deadline precision and completion state persist.
8. Verify exact deadlines show in the selected timezone and date-only deadlines do not shift dates.
9. Run renderer tests, typecheck and production build, then root npm test. Record Windows version, Electron version, commit SHA and commands/results.
10. Provide screenshots or a short recording of the real desktop loop; separately label test fixtures/preview data. No installer or notification claims.

Open a PR to main. Describe user-visible behavior, exact changed paths, tests, real IPC/restart evidence, remaining gaps and proposed contract changes (if any). Do not merge it yourself; Codex will review specific commits, combine with current main, validate and merge.
