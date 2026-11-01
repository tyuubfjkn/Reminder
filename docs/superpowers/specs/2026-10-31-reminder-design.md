# Reminder shared product design
Version: 1.0.0. Owner: Codex. Contract: packages/contracts/api-v1.d.ts.
Initial repository baseline: 4b7592e7dd0e9fe49c8e0b0a014830a31682272d.
User supplied the product scope and delegated stack selection and implementation to Codex. Implementation choices below are Codex decisions, not separately user-approved decisions.

## Intent
A Windows desktop personal task and time-management assistant, initially useful to students. English (en-US) is the first-run UI language, Simplified Chinese (zh-CN) the second. Natural-language intent will eventually become validated persistent operations. The manual task loop must work without AI, accounts or network access.

## Approaches and chosen architecture
- Electron + React/TypeScript + local SQLite: chosen for one JavaScript ecosystem and a small, testable IPC surface shared with CC. Tradeoff: desktop runtime size and memory.
- Tauri + React + Rust: smaller shell, but adds Rust and native tooling absent in this environment.
- .NET desktop: strong Windows integration, but a different UI/toolchain from the planned React collaboration.
Backend runs inside the Electron main process in REM-001, not on a server and not on a public/local HTTP port. A narrow context-isolated preload bridge exposes Promise methods. Synchronous SQLite is acceptable for this small first slice; larger scheduling/AI workloads move off the main thread.
Backend implementation uses Node ESM JavaScript and a shared TypeScript declaration contract. This keeps the backend executable on installed Node 24 without a compiler download. CC uses React/TypeScript.
Storage adapter uses node:sqlite DatabaseSync, verified on local Node 24.16.0. Electron must pass the same runtime probe before desktop integration; do not assume its bundled Node matches system Node.

## Ownership and layout
- Codex: packages/backend/, packages/contracts/, apps/desktop/main/, root tooling, docs/, CI.
- CC: apps/desktop/renderer/ only, including its own package.json and lockfile.
- Shared design: this file only. Shared API: packages/contracts/api-v1.d.ts; behavioral reference: docs/api-v1.md. Plan: docs/superpowers/plans/2026-10-31-rem-001.md.
- Separate local checkouts and short feature branches. Shared foundation must be committed and remotely available before CC starts. PR target main.

## REM-001 first slice
Create a task; save immediately; show actual saved tasks; edit title, notes, priority, estimate or deadline; explicitly complete/reopen; close and reopen the database/application without losing state. No automatic completion.
A task has a UUID, original-language title/notes, pending/completed status, nullable completion instant, priority, optional estimate, optional deadline, timestamps and a positive revision.
Title: trim outer whitespace, nonempty, at most 500 UTF-16 code units. Notes: preserve text, at most 10000 code units. Priority: low/normal/high (normal default). Estimate: null or integer 1..10080 minutes. No delete endpoint in this slice.
Title and notes must be well-formed Unicode; reject lone surrogates before writing instead of silently replacing text. Valid emoji and combining sequences are preserved.
Deadline: null, a date-only object with an IANA time zone, or a UTC instant with an IANA time zone. A date-only deadline remains date-only; no invented end-of-day timestamp. Exact timestamp input requires Z or a numeric offset and is normalized to UTC.
Execution slots and reminders are separate future concepts; REM-001 exposes neither, rather than overloading deadline.
All writes are atomic. Updates require expectedRevision; stale writes fail without data changes. The UI keeps prior values for an explicit undo via another revision-checked update. Undo must not silently overwrite intervening changes.
List returns all tasks in stable creation order. This bounded first slice targets personal datasets; pagination is a future contract extension.
Preferences: en-US first run even on a Chinese OS; persist en-US/zh-CN selection. Task content never translates on locale switch. Persist IANA time zone initialized from the OS, falling back to UTC; it is independent of locale. Settings also use revision checks.
Errors are stable codes with optional field; CC owns localized messages. No SQL, local file paths, credentials or raw exception text exposed to renderer.

## Desktop boundary
Expose only window.reminder.tasks.list/create/update and settings.get/update, plus apiVersion.
Enable contextIsolation and sandbox; disable nodeIntegration. Reject IPC from other frames/windows/origins, disallow navigation and popup windows, and load only the local packaged renderer. Do not expose ipcRenderer, arbitrary channels, SQL or filesystem methods.
Store database under Electron app.getPath('userData'), not the repository. Acquire a single-instance lock. Fail startup visibly if storage cannot open; do not silently reset data or fall back to in-memory storage.
A developer JSON-lines CLI exercises exactly the same dispatcher and real file database; it is not the production desktop transport.
REM-001 UI: task list, add/edit form, complete/reopen, undo feedback, settings language and timezone, empty/loading/error states, keyboard access. Renderer design and interaction details belong to CC.

## Future slices and invariants
REM-002: DeepSeek text intent -> proposed typed operations -> application validation -> same service -> user feedback/undo. Model configurable and capability checks based on official docs at that time. UI locale and conversation language may differ.
No bundled developer/provider service secret in the client. Decide between a remote authenticated proxy and a user-owned credential stored through Windows protection before AI implementation. No credential is needed for REM-001.
REM-003: reminders with separate reminder instants, snooze, cancel pending reminders on completion; explicitly test foreground/background/closed/sleep cases before promises.
REM-004: scheduling respects fixed/locked slots, working/rest hours and real deadlines. Report insufficient time without changing deadlines.
REM-005: recurrence separates occurrence completion from future series.
REM-006: accounts and Windows-device sync with explicit conflict handling.
REM-007: voice, screenshot interpretation and Windows sharing, using capabilities actually supported.
Ambiguous natural-language dates are clarified only when consequential; English UI never implies a US location.

## Acceptance and delivery
Backend: real SQLite CRUD, process restart persistence, input rejection, stale update protection, date-only preservation, locale/timezone persistence and safe errors.
Desktop: CC must demonstrate the whole manual loop against IPC, restart the real application and confirm persisted task and preferences. Mock-only success is separately labeled.
No installer or notification claim until tested. Releases bind to a verified commit/artifact and include notes and rollback. Schema v1 is additive; do not open a newer schema with an older app. Back up userData with the app closed before rollback; never erase a user's database.
Current constraints: Git and npm network access fail in sandbox. GitHub connector works. No Electron binary, Rust or .NET SDK detected. Backend validation is locally executable; desktop packaging remains dependent on runtime installation.

## Official implementation references
https://www.electronjs.org/docs/latest/tutorial/context-isolation
https://www.electronjs.org/docs/latest/tutorial/security
https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html
