# CC task package: REM-002-FE

Repository: https://github.com/tyuubfjkn/Reminder. Target branch: main. Use a separate checkout and short branch `cc/rem-002-assistant`.
Runtime baseline before this slice: 9db390c6cd37276845375c9768c8f17c49af3fc5. Use the exact published planning commit supplied by Codex, then integrate the published backend commit when available. Do not change Codex's checkout or shared files.
Allowed paths: apps/desktop/renderer/** only. Owner: Claude Code.
Shared design: docs/superpowers/specs/2026-10-31-reminder-design.md v1.1.0 (REM-002).
Contract: packages/contracts/api-v1.d.ts and docs/api-v1.md, manual v1 + optional assistant v1. Plan: docs/superpowers/plans/2026-11-01-rem-002.md.

User outcome: English/Chinese task intent becomes real create/update/complete/reopen operations, with clear receipts, explicit ambiguity resolution and whole-batch Undo. Preserve manual task usability without AI. Notifications, automatic scheduling and recurrence are later slices; never imply they were performed.

Add an assistant conversation surface and AI settings. Key entry is write-only, clears after successful configure, and is never put in localStorage/logs. Show configured status/model, replace/remove key, and describe that messages, bounded conversation context and task titles/metadata (not existing notes) are sent to DeepSeek. UI defaults en-US with zh-CN translation; task text is preserved. Conversation reply language is supplied independently by the backend.

Feature-detect optional `api.assistant`. Use getConfig/configure/submit/undo directly; do not implement model calls or execute proposals in the renderer. Keep the current manual getApi/version behavior. Display processing and sanitized localized errors, keep text on failure, and offer explicit retry. Reuse the original requestId and identical input for transport retry; new send/clarification answer gets a new UUID. Store returned conversationId for follow-ups; expiry requires an explicit new conversation.

Show clarification messages with a clear no-changes indicator. Render task choices and DST First/Second choices with UTC offset/timezone; send the selected structured choice and a short text answer. Successful applied/undone receipts trigger tasks.list reload. Handle reload failure accurately. Preserve whole-batch Undo by original requestId; a CONFLICT must not overwrite newer task data. Historical replayed receipts are not current task snapshots.

At planning publication, manual backend is available; assistant declarations are frozen for implementation but its backend is still being built. Use contract-faithful fixtures only until Codex publishes the backend dependency, and label mock evidence. No production mock data/provider code. Propose contract changes through Codex rather than editing shared files.

Validation: root npm ci; renderer npm ci/test/typecheck/build; root npm test; root npm run test:desktop after build (isolated profile). Add focused UI regression tests for success, errors, duplicate-submit prevention/retry IDs, both languages, clarification choices, expiry, key replacement/removal, Undo conflict and failed task reload. Real DeepSeek evidence requires a user-configured key; never request a secret in chat or commit one. Separate fixture tests, real IPC/SQLite integration and credential-backed provider results in your PR.

Deliver PR to main with exact head, only allowed paths, startup instructions, tests and limitations. Codex reviews/integrates/merges. No automatic dispatch is implied by this file.
