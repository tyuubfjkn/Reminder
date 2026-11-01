# Reminder API 1.0.0
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
