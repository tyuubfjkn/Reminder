# Reminder
AI-assisted personal tasks and time management for Windows. Manual tasks work locally without an AI connection. UI: en-US first, zh-CN optional. License: GPL-3.0; see LICENSE.

## Current slice
REM-001 backend provides SQLite persistence, create/list/edit/complete/reopen, date-only and exact deadlines, revision checks and saved language/timezone preferences. DeepSeek, scheduling, reminders, recurrence and sync are not implemented.
The Electron adapter is present. The React renderer is assigned to Claude Code; no complete desktop application or installer is claimed yet.

## Backend development
Use Node 24.16.0 or later in major 24.
```powershell
npm test
node packages/backend/src/cli.mjs --db "$env:TEMP/reminder-demo.sqlite"
```
Enter JSON lines such as:
```json
{"method":"tasks.create","params":{"title":"Finish my essay","estimatedMinutes":180}}
{"method":"tasks.list"}
{"method":"settings.get"}
```
CLI tests require no npm install and no network. Use a disposable database for experiments. Database files are ignored by Git.

## Desktop integration (after CC delivers the renderer)
Install root dependencies with npm install (Electron is pinned). From apps/desktop/renderer run npm install and npm run build, which must produce dist/index.html with relative assets (Vite base './').
Then from the repository root run npm run desktop. Renderer source stays in its own package; use built files for real IPC testing, not a browser page. Electron database: app.getPath('userData')/reminder.sqlite.
Current environment cannot download npm dependencies; desktop runtime and installer verification are pending. A root lockfile must be generated and reviewed when dependency installation is available. Backend CI runs without it.

## Sources of truth
- Design: docs/superpowers/specs/2026-10-31-reminder-design.md
- API: packages/contracts/api-v1.d.ts and docs/api-v1.md
- Implementation plan: docs/superpowers/plans/2026-10-31-rem-001.md
- Task register: docs/tasks.md
- Test evidence and limits: docs/verification/rem-001.md
- CC handoff: docs/handoffs/REM-001-FE.md (published with the frozen baseline)

## Collaboration and release
Use an independent checkout and feature branch. Target main with a PR. Codex owns shared contracts and main/preload; CC owns renderer. No secrets in source or the desktop bundle.
Backend foundation can merge with backend evidence. REM-001 remains open until the combined desktop restart/localization loop is verified.
No release yet. Before publishing an installer, record verified source SHA, Windows/Electron versions, hashes, installation/restart results and release notes. Keep the previous artifact; back up userData with the app closed before rollback. Do not downgrade a newer database schema or remove user data.
