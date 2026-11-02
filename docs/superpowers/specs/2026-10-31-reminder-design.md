# Reminder shared product design
Version: 1.2.0. Owner: Codex. Contract: packages/contracts/api-v1.d.ts (manual API v1 + additive assistant API v1).
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
### REM-002: bilingual natural-language operations
Authorized sequence: REM-002 DeepSeek operations, then REM-003 reminders, REM-004 scheduling, REM-005 recurrence. Complete and integrate each slice before starting its dependent UI. Codex owns shared design/contracts/backend/main; CC owns renderer. This remains the sole common product design.

The user selected user-owned DeepSeek credentials over a shared remote proxy. First version remains local: no account, server deployment or bundled provider secret. Use Electron 45 asynchronous safeStorage with Windows DPAPI; persist encrypted key and model in userData/assistant-config.json via atomic replacement. Never return the key in configuration responses or log it. Key entry is write-only from the renderer; CC clears the input after saving. Missing/unavailable secure storage or a corrupt config disables AI only; manual tasks remain usable. A key can be removed without decrypting it. Model defaults to deepseek-flash, is configurable, and endpoint is fixed to https://api.deepseek.com/chat/completions. No arbitrary endpoint accepts the key.

Approaches: a remote proxy would centralize billing but requires identity/quotas/deployment, so it is deferred. Model-written SQL or renderer-executed tools would bypass validation and are rejected. Chosen approach: one bounded non-thinking tool-call request proposes create/update operations; the local service validates the complete proposal and writes it atomically. No automatic network retry. Official docs checked 2026-11-01: deepseek-flash, thinking.type=disabled, named tool_choice supported in non-thinking mode; standard tool calls do not require the beta strict endpoint. Electron's synchronous safeStorage is deprecated in 45, so use asynchronous APIs and verify them in the pinned runtime.

Scope: create tasks; update title/notes/priority/estimate/deadline; complete/reopen existing tasks. Up to 20 changes per input, with at most one change per existing task. No model access to SQL, files, shell, credentials, settings changes, arbitrary tools, notifications, schedules or recurrence. Requests for unavailable capabilities produce an explicit unsupported result with zero task writes. Ordinary valid operations apply automatically and expose a single batch Undo.

Task context contains IDs, titles, status, deadline, estimate and priority, not notes or secrets. The current input and up to eight prior conversational messages may be sent to DeepSeek; CC explains this next to key setup/chat. Limit input to 4,000 UTF-16 units, context to 200 tasks, response body to 256 KiB, provider deadline to 30 seconds. Context overflow fails explicitly; do not silently truncate task candidates. Conversational context is memory-only, at most 50 sessions, expires after 30 minutes, and does not survive restart. Saved task changes and idempotency receipts do survive restart. Language is chosen from the current conversation (en-US/zh-CN), independently of UI locale; task text remains original.

Every model result is untrusted. Require exactly one known function call and a complete valid schema. Model free-form success prose is never used as an operation receipt. A valid apply result is formatted locally from committed changes; malformed, empty, truncated, unknown-tool or extra-field outputs cause no task writes. Provider/key/timeout/rate-limit errors are stable sanitized codes. Task content is explicitly untrusted data in the prompt, not an instruction channel; the executor still enforces the operation allowlist and revision checks.

The service supplies an authoritative UTC clock, saved IANA timezone and OS regional locale (not UI language) with each request. Date-only intent stays date-only. Exact deadlines are proposed as local date/time, then resolved by the application. Reject nonexistent DST wall times; repeated wall times require an explicit first/second choice with offsets. Never let a model invent a UTC conversion or choose a fold occurrence silently. Multiple tasks with the same normalized title require an explicit candidate choice before update. Clarifications make zero task changes; each follow-up has a new requestId and the returned conversationId. Structured choices are accepted only against the conversation's most recent matching clarification.

The renderer generates a UUID requestId once per send and reuses it for transport retry. Application admission serializes AI turns; manual operations remain responsive during provider waits. Snapshot task revisions and settings revision before the provider request. If any target or timezone setting changes before commit, return CONFLICT and write nothing. A durable receipt keyed by requestId and request fingerprint makes replay exactly-once for local effects, including across restart. Same ID with different input is rejected. All batch writes and their receipt commit in one SQLite transaction.

SQLite schema v2 adds assistant_runs for receipts and inverse snapshots. Migrate v1 transactionally without changing task/settings records; refuse future schema versions. Undo uses the original requestId, verifies every affected task still has the post-operation revision, restores prior task values with a new revision, and removes newly created tasks only if unchanged. Undo is atomic and idempotent. A later intervening manual/AI edit makes the whole undo conflict without changes. Replaying an undone request reports undone rather than reapplying it. Preserve the original completion timestamp on undo. Receipts contain no API key or raw user prompt; only its fingerprint and validated result/inverse task data.

Compatibility: keep the existing manual bridge and apiVersion=1.0.0 intact. Add optional window.reminder.assistant with its own apiVersion=1.0.0, getConfig/configure/submit/undo methods in the same canonical declaration file. Old renderer fixtures and manual UI continue to work without the optional feature. Document assistant-specific Result codes separately. CC refreshes tasks.list after an applied/undone receipt; historical receipt snapshots must never replace newer list data.

Acceptance distinguishes four layers: real SQLite atomicity/replay/undo/migration; provider-protocol tests with deterministic transport doubles; real Electron IPC and DPAPI round-trip without a real secret; live DeepSeek smoke only when the user has configured a key. Never claim live model semantics or frontend integration based on mocks. A live smoke script uses an explicitly supplied environment key and a disposable database, never personal tasks; no key is requested in chat. Backend delivery can proceed without that credential, but REM-002 whole-feature acceptance remains pending live provider and CC UI verification.

Rollback: schema v2 is not readable by the previous v1 store. Back up the closed application's userData before adopting the migration; rollback needs the matching backup or a newer compatible build. Never erase or silently downgrade a v2 database.

Official references: https://api-docs.deepseek.com/guides/tool_calls/ ; https://api-docs.deepseek.com/api/create-chat-completion/ ; https://api-docs.deepseek.com/quick_start/agent_integrations/ ; https://www.electronjs.org/docs/latest/api/safe-storage

REM-002: DeepSeek text intent -> proposed typed operations -> application validation -> same service -> user feedback/undo. Model configurable and capability checks based on official docs at that time. UI locale and conversation language may differ.
No bundled developer/provider service secret in the client. REM-002 uses the user-owned credential choice above. No credential is needed for REM-001.
REM-003: reminders with separate reminder instants, snooze, cancel pending reminders on completion; explicitly test foreground/background/closed/sleep cases before promises.
REM-004: scheduling respects fixed/locked slots, working/rest hours and real deadlines. Report insufficient time without changing deadlines.
REM-005: recurrence separates occurrence completion from future series.
REM-006: accounts and Windows-device sync with explicit conflict handling.
REM-007: voice, screenshot interpretation and Windows sharing, using capabilities actually supported.
Ambiguous natural-language dates are clarified only when consequential; English UI never implies a US location.

## Acceptance and delivery
### REM-001 hardening (authorized cleanup, November 1)
Keep the existing architecture and API. Codex owns the cleanup implementation and integration; CC owns settings conflict feedback (REM-001-FE-01). No AI, installer or notification scope is added.

Developer/test launches may explicitly set REMINDER_USER_DATA_DIR to an absolute dedicated directory. Configure userData and sessionData before Electron readiness and the single-instance lock. Missing override preserves normal storage. Invalid overrides fail closed without falling back to personal data; packaged apps do not accept this development override. The root E2E runner creates a fresh temporary profile, verifies the real Electron path before test writes, reuses it for the restart test, and removes only its own generated directory after all child processes exit. Failure evidence must survive outside that directory.

Approaches considered: changing APPDATA globally was rejected because it affects unrelated child tooling; a test-only alternate Electron entry point was rejected because it would bypass production startup. A narrowly validated environment override in the real main entry point is the Codex implementation choice. All ordinary task tests continue to use the real service and IPC.

Commit a root npm lockfile generated by npm for the pinned Electron version; verify npm ci before adoption. Test storage failure using a disposable Windows VHD and temporary file ACLs, never a physical user volume or personal database. Demonstrate actual OS/SQLite failure, no partial task/settings revision changes, and successful recovery after capacity/access is restored. Existing error sanitization remains the contract; if a bug is found, reproduce it before fixing it. A passing backend fault test is not a claim that every UI failure state was tested in Electron.

Settings conflicts: if the refresh fails, localized feedback must say the latest settings could not be loaded, retain the last known settings, and require explicit user retry. Successful refresh retains the existing behavior. CC supplies regression evidence for both languages and rejected promises as well as Result errors. Native picker locale is outside this cleanup.

Backend: real SQLite CRUD, process restart persistence, input rejection, stale update protection, date-only preservation, locale/timezone persistence and safe errors.
Desktop: CC must demonstrate the whole manual loop against IPC, restart the real application and confirm persisted task and preferences. Mock-only success is separately labeled.
No installer or notification claim until tested. Releases bind to a verified commit/artifact and include notes and rollback. Schema v1 is additive; do not open a newer schema with an older app. Back up userData with the app closed before rollback; never erase a user's database.
Current constraints: Git and npm network access fail in sandbox. GitHub connector works. No Electron binary, Rust or .NET SDK detected. Backend validation is locally executable; desktop packaging remains dependent on runtime installation.

## Official implementation references
https://www.electronjs.org/docs/latest/tutorial/context-isolation
https://www.electronjs.org/docs/latest/tutorial/security
https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html

## REM-002 conversational revision (v1.2.0, authorized November 1)
This section supersedes REM-002 automatic application and manually selected desktop time zone above. User approved direct implementation and requested richer UI, free conversation, confirmation before every AI task change, and automatic system time zone.

Chosen approach: one validated structured response envelope can contain ordinary chat, a necessary clarification, unsupported capability explanation, or proposed operations. Keep the pinned provider transport and local execution boundary. A separate chat model/router would duplicate context, latency and failure paths; model-issued confirmations cannot establish user consent. The application's pending proposal, not model prose, is the only authorization target.

Ordinary conversation can cover topics beyond tasks. Do not present every chat reply as an error or a no-changes receipt. Discussing a possible activity may propose it, but never saves it. Explicit task commands ALSO require confirmation. Example: "I want cake today at 4pm" -> exact dated preview -> "change it to 5" -> replacement preview -> "yes" -> saved receipt. No save occurs before the final confirmation. Generic conversation alone must not invent tasks. Current information/web browsing is not provided by this integration.

A proposal has a fresh UUID, 10-minute absolute expiry, validated normalized operations, original task/settings snapshots, and a local UI preview. submit carries the proposalId visible to the user, plus optional decision=confirm/cancel. Typed standalone yes/no (English/Chinese) is recognized locally only when bound to that exact pending ID; other follow-up text goes to the provider and revokes the old proposal before the provider call, including on error. Old IDs, repeated fresh-ID confirmations, expired proposals, and unknown decisions cannot write. Changed tasks or time zone produce CONFLICT with no partial effect. A same-ID transport retry returns its original result, not a different conversation turn. Successful confirmations have durable receipts, so restart retry/Undo remain exactly-once. Non-mutating conversation/preview replies are bounded memory only, and expire with the session. Sessions retain the prior 50-session/30-minute idle bounds and eight-message context limit.

Create/update/complete/reopen all follow this confirmation path. Undo remains an explicit local API action tied to a committed receipt; CC must present a detailed confirmation dialog before invoking it, and never treat model prose as Undo. A provider response cannot directly select confirm/cancel. Previews show exact dates, local time, UTC offset/zone and affected fields; ambiguous targets/times are resolved before final confirmation. Deadline and plannedAt DST selections bind independently by operation and field.

Task.plannedAt is nullable {at: canonical UTC ISO instant, timeZone: IANA zone}; CreateTask/TaskPatch accept it independently of deadline. The model proposes local date/time; the application resolves it. Schema3 adds a nullable column, preserving existing rows and old Undo receipts (missing plannedAt means null). Planned time is not a reminder or automatic scheduling. Instants remain unchanged when display zone changes; date-only deadlines retain their literal calendar date. Closed-app backups are required for rollback to older schemas; no data reset.

Desktop settings follow the OS zone. Refresh on startup, before IPC actions, on power resume and every60 seconds; increment settings revision only if zone changed, notify the renderer, and reject manual desktop timezone edits. Invalid/unavailable OS lookups keep the last valid zone. Existing instants are never rewritten. Language remains independent. CC displays current zone/offset with "Follows system", no editable timezone box, and reloads authoritative settings on notification/focus. Outstanding confirmation is invalid after a zone revision change.

UI direction (Codex choice within delegated design): a useful desktop workspace, not an empty centered form. Persistent compact navigation, Today overview derived from real planned times/deadlines, upcoming/unscheduled task groups, and a comfortable conversation area with task context. At wide widths use the available space; narrow widths collapse secondary context. Avoid fake counts, stock productivity charts, excessive cards or decorative filler. Clear typography, restrained accent, surface hierarchy, light/dark themes, keyboard/focus/accessibility and English-first/Chinese-second copy remain required. Conversation text, pending proposals, committed receipts and errors must look distinct. Confirmation cards offer Confirm / Edit / Don't add with the full operation summary; only the active card is interactive. Undo shows task names, before/after details when available, batch scope, cancellation and confirmed result, with conflict feedback that does not overwrite newer edits. Manual action feedback is compact/dismissible without shifting the entire layout. Empty states have concrete quick actions rather than large blank space.

CC owns implementation and screenshots under apps/desktop/renderer/**. Codex owns contracts/backend/main/test tooling and reviews the exact CC head. This revision is not accepted until fixture/unit tests, combined real Electron/DPAPI/SQLite UI checks, visual checks at1100x760/760x540 in both languages/themes, and separately labeled live DeepSeek evidence are complete.

### Conversational revision clarification binding
Every structured target/DST question has a clarificationId, copied into the corresponding input.choice request and its retry fingerprint. Old question tokens cannot resolve new questions. Settings revision changes invalidate pending proposals before new input is interpreted, permitting fresh unbound text while rejecting old confirmation IDs.
