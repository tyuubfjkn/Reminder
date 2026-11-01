# Reminder API 1.0.0
Manual protocol v1 remains unchanged. REM-002 adds the optional `window.reminder.assistant` capability, with its own `apiVersion: '1.0.0'`; all declarations remain in the single canonical file below.

## Assistant v1 (REM-002)
All four methods return `Promise<AssistantResult<T>>`. No provider secret is returned. Main-process IPC validates the same sender/frame/origin as manual methods.

| Method | Input | Data |
| --- | --- | --- |
| assistant.getConfig() | omitted | `{provider:'deepseek',model:'deepseek-flash',hasKey:false}` |
| assistant.configure(input) | `{model?,apiKey?,clearKey?}`; nonempty patch; key and clearKey are mutually exclusive | masked AssistantConfig |
| assistant.submit(input) | `{requestId,text,conversationId?,choice?}` | AssistantReply |
| assistant.undo(input) | `{requestId}` of the original applied batch | AssistantReply with outcome undone |

The UI creates a UUID per send and retains exactly the same input/requestId on transport retry. A new message or clarification answer uses a new requestId. Same ID/different input returns CONFLICT. `conversationId` comes from the previous reply; conversation history is memory-only with 30-minute expiry. A structured `choice` is accepted only for the last matching clarification; submit a short textual answer too. An expired conversation returns AI_CONVERSATION_EXPIRED: retain the user's text and offer a new conversation explicitly.

AssistantReply always contains requestId,conversationId,language,outcome,message,changes,undoAvailable. Outcomes: applied,clarification,unsupported,undone. Optional choices are task candidates or first/second occurrence UTC instants with timezone; CC formats offsets for the user. A clarification/unsupported reply changes no tasks. Successful receipt wording comes from committed local changes, not arbitrary model prose. On applied/undone, reload tasks.list; if reload fails, do not claim the latest list is displayed. Never use a historical receipt to replace newer task data. Undo may conflict if any affected task changed later. Repeated Undo and request replay are idempotent; replay after Undo returns undone.

Example (illustrative contract data, not a captured live model result):
```json
{"requestId":"e6cd593e-6390-4c29-bf7c-8fcc5926396e","text":"Finish my essay by Friday. It should take about three hours."}
```
The service supplies the actual clock, saved timezone and OS region to DeepSeek. Do not hardcode Friday or infer a US timezone from English. A date-only deadline stays date-only; local exact times are resolved by the application, and DST gaps/folds can require clarification.

Error codes in addition to manual v1: AI_NOT_CONFIGURED (enter key), AI_CONFIG_ERROR (stored config invalid/unreadable), AI_SECURE_STORAGE_UNAVAILABLE (no encrypted save possible), AI_AUTH_ERROR, AI_RATE_LIMITED, AI_UNAVAILABLE, AI_TIMEOUT, AI_INVALID_RESPONSE, AI_CONTEXT_LIMIT, AI_CONVERSATION_EXPIRED, AI_BUSY. All are sanitized; no raw provider body, key, SQL or local path reaches the renderer. Failed/unsupported interpretation applies no task changes. CONFLICT includes stale task/settings snapshots and request-ID misuse. Do not automatically resend a paid provider request; provide explicit retry.

Limits: 4000 input units,20 operations,200 contextual tasks,256KiB provider response,30s timeout. Local schema v2 is required for receipts/atomic undo. Key storage is encrypted under Windows through Electron asynchronous safeStorage. Only the current message, bounded history and task context (excluding notes) are sent; explain this to users. No live provider claim until a real credential-backed smoke passes.

Authority: packages/contracts/api-v1.d.ts. Shared design: docs/superpowers/specs/2026-10-31-reminder-design.md.

## Transport and operations
Production: window.reminder in Electron; every method returns a Promise<Result<T>>.
Core/CLI: dispatch(method, params) returns Result synchronously.
| Bridge | Dispatcher | Params | Successful data |
| --- | --- | --- | --- |
| tasks.list() | tasks.list | omitted or {} | Task[] |
| tasks.create(input) | tasks.create | CreateTask | Task |
| tasks.update(input) | tasks.update | UpdateTask | Task |
| settings.get() | settings.get | omitted or {} | Settings |
| settings.update(input) | settings.update | UpdateSettings | Settings |

Strict plain objects only; reject unknown fields and empty patches. Missing and null differ. Null clears deadline/estimate; null is invalid for title, notes, priority, status, locale and timezone. Omitted fields on update stay unchanged.
Title and notes must be well-formed Unicode; reject unpaired UTF-16 surrogates rather than saving replacement characters. Valid emoji and combining sequences remain unchanged.
No automatic completion or deletion. A status update to completed sets completedAt on transition; reopening clears it. Repeating the same status leaves completedAt intact, but a successful update increments revision.
List sorted by createdAt then id, ascending. Timestamps are UTC ISO strings. Date-only deadlines use exact YYYY-MM-DD (years 0001..9999), never parsed as a local timestamp.
Instant deadlines require full YYYY-MM-DDTHH:mm:ss[.SSS](Z|+HH:mm|-HH:mm), valid calendar/time components, numeric offset at most 14:00, and a resulting UTC year 0001..9999. timeZone must be accepted by Intl.DateTimeFormat. Explicit offset determines the instant; timeZone is display context, not a second instant parser.
Limits and defaults are in the design. ID and revision are server-assigned. Task creation always starts pending, revision 1. Settings revision starts at 1.
Writes use optimistic concurrency. On CONFLICT, reload and let the user retry; never blindly replay a stale edit. Undo is a normal update using the saved previous field values and the last returned revision.
After success render server-returned data or refetch. Never display a mock mutation as persisted.

## Examples
Create:
```js
await window.reminder.tasks.create({
  title: 'Finish my essay',
  estimatedMinutes: 180,
  deadline: { kind: 'date', date: '2026-11-06', timeZone: 'Europe/London' }
});
```
Success data includes:
```json
{"ok":true,"data":{"id":"550e8400-e29b-41d4-a716-446655440000","title":"Finish my essay","notes":"","status":"pending","completedAt":null,"priority":"normal","estimatedMinutes":180,"deadline":{"kind":"date","date":"2026-11-06","timeZone":"Europe/London"},"createdAt":"2026-10-31T20:00:00.000Z","updatedAt":"2026-10-31T20:00:00.000Z","revision":1}}
```
The UUID/timestamps above are illustrative; actual requests and returns are recorded in docs/verification/rem-001.md.
Complete: tasks.update({id, expectedRevision: 1, patch: {status: 'completed'}}).
Change locale: settings.update({expectedRevision: 1, patch: {locale: 'zh-CN'}}).
Errors:
```json
{"ok":false,"error":{"code":"VALIDATION_ERROR","field":"title"}}
{"ok":false,"error":{"code":"CONFLICT"}}
```
VALIDATION_ERROR: invalid shape/value; NOT_FOUND: task missing; CONFLICT: stale revision; UNKNOWN_METHOD: dispatcher name unavailable; STORAGE_ERROR: persistence unavailable; FORBIDDEN: untrusted IPC sender. Frontend maps each code to en-US and zh-CN copy; do not display code identifiers as normal product messages. IPC transport rejection is also caught and shown as a localized connectivity error.

## Developer CLI
Node 24.16.0 or later within major 24. Run: node packages/backend/src/cli.mjs --db <absolute-path-to-test.sqlite>.
Send one JSON object per line: {"method":"tasks.create","params":{"title":"数学作业"}}.
Each line returns one Result JSON. settings.get/tasks.list may omit params. Invalid JSON gives VALIDATION_ERROR at request. EOF closes storage; next invocation with the same path reloads data. Use a disposable path for trials.
