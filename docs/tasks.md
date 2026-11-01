# Reminder task register
Design/API version: 1.0.0.
Initial baseline: 4b7592e7dd0e9fe49c8e0b0a014830a31682272d. Frozen CC baseline will be recorded in docs/handoffs/REM-001-FE.md.

| ID | User outcome / scope | Owner | Dependency | Allowed paths | Acceptance / state |
| --- | --- | --- | --- | --- | --- |
| REM-001-BE | Manual tasks and preferences survive restart | Codex | Shared design/API v1 | packages/backend/**, packages/contracts/**, docs/**, root tooling, .github/** | Real SQLite and process-restart tests; in progress |
| REM-001-IPC | Renderer can call safe local backend | Codex | REM-001-BE | apps/desktop/main/**, backend tests | Sender validation + bridge tests; real Electron pending |
| REM-001-FE | Add/list/edit/complete/reopen, undo, language settings | CC | Published BE/IPC baseline | apps/desktop/renderer/** | Real IPC manual loop and relaunch; not dispatched |
| REM-001-INT | Complete Windows application loop | Codex | CC PR + BE | integration tooling/docs, coordinated fixes | Combined target branch build + desktop smoke; pending |
| REM-002 | Bilingual natural-language tasks | Codex + CC | REM-001-INT | Future card | Not started |
| REM-003 | Explicit, reliable reminders | Codex + CC | REM-001-INT | Future card | Running/closed/sleep behavior verified; not started |
| REM-004 | Deadline-respecting scheduling | Codex + CC | Task/time model | Future card | Not started |
| REM-005 | Recurrence instances | Codex + CC | Task/reminder model | Future card | Not started |
| REM-006 | Accounts and sync | Codex + CC | Sync design | Future card | Not started |
| REM-007 | Voice, screenshots, Windows sharing | Codex + CC | Capability validation | Future card | Not started |

All first-slice cards refer to docs/superpowers/specs/2026-10-31-reminder-design.md, packages/contracts/api-v1.d.ts, docs/api-v1.md, and docs/superpowers/plans/2026-10-31-rem-001.md. No frontend implementation is claimed until its actual PR is reviewed.
