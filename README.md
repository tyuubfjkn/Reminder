# Reminder
AI-assisted personal tasks and time management for Windows. Manual tasks work locally without an AI connection. UI: en-US first, zh-CN optional. License: GPL-3.0; see LICENSE.

## Current slice
REM-001 backend provides SQLite persistence, create/list/edit/complete/reopen, date-only and exact deadlines, revision checks and saved language/timezone preferences. DeepSeek, scheduling, reminders, recurrence and sync are not implemented.
The Electron/React manual-task loop has passed real Windows desktop and restart verification. No installer is published yet.

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

## Desktop development
Install root dependencies with npm ci (Electron and its dependency graph are locked). From apps/desktop/renderer run npm ci and npm run build, which must produce dist/index.html with relative assets (Vite base './').
Then from the repository root run npm run desktop. Renderer source stays in its own package; use built files for real IPC testing, not a browser page. Electron database: app.getPath('userData')/reminder.sqlite.

After building, run `npm run test:desktop` from the root for real E2E. It creates a temporary profile, verifies two concurrent isolated Electron profiles, then runs the renderer restart/persistence scenario and cleans up its own profile. Never point automated E2E at personal data or invoke the legacy renderer E2E script directly. CI preserves logs/screenshots outside the temporary profile.

For manual development, optionally set `REMINDER_USER_DATA_DIR` to an absolute dedicated directory before `npm run desktop`. The override configures both SQLite userData and Chromium sessionData before startup. Without it, ordinary storage is unchanged. Invalid/unavailable overrides fail closed; packaged apps reject this development override. Clear the environment variable to return to normal data. No profile is migrated, reset or deleted by the app.

Windows CI runs `tools/storage-faults.ps1` only on disposable hosted runners. It creates its own 64 MiB VHD, induces OS ENOSPC and temporary file ACL write denial, checks real storage atomicity/recovery, and detaches the VHD. Do not run this against personal storage. Backend unit/CLI tests still require no dependency installation.

## Sources of truth
- Design: docs/superpowers/specs/2026-10-31-reminder-design.md
- API: packages/contracts/api-v1.d.ts and docs/api-v1.md
- Implementation plan: docs/superpowers/plans/2026-10-31-rem-001.md
- Cleanup plan: docs/superpowers/plans/2026-11-01-rem-001-hardening.md
- Task register: docs/tasks.md
- Test evidence and limits: docs/verification/rem-001.md
- CC handoff: docs/handoffs/REM-001-FE.md (published with the frozen baseline)
- CC cleanup handoff: docs/handoffs/REM-001-FE-01.md

## Collaboration and release
Use an independent checkout and feature branch. Target main with a PR. Codex owns shared contracts and main/preload; CC owns renderer. No secrets in source or the desktop bundle.
The REM-001 source desktop loop is accepted. Cleanup and release readiness are tracked separately in docs/tasks.md; installer and notification claims require their own verification.
No release yet. Before publishing an installer, record verified source SHA, Windows/Electron versions, hashes, installation/restart results and release notes. Keep the previous artifact; back up userData with the app closed before rollback. Do not downgrade a newer database schema or remove user data.
