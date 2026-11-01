# Reminder renderer (REM-001-FE)

React + TypeScript renderer for the Reminder Windows desktop app. It talks to the local backend only through
`window.reminder` (API v1.0.0, `packages/contracts/api-v1.d.ts`, imported by `src/api/contract.ts`). It has no Node
integration, makes no network calls, and doesn't store tasks or settings in `localStorage`.

## Scripts (run in `apps/desktop/renderer`)
| Command | What it does |
| --- | --- |
| `npm ci` | Install the pinned dependencies from `package-lock.json` |
| `npm test` | Vitest + Testing Library, run once (non-watch) against a **test-only fake API** |
| `npm run typecheck` | `tsc --noEmit` covering the shared contract import |
| `npm run build` | Vite production build into `dist/index.html` with relative `./assets/*` |
| `npm run e2e` | **Real desktop check.** Launches the repository's Electron shell, using the real SQLite backend, through `playwright-core` (needs root `npm install` and `npm run build` first) |

`npm run e2e` uses Electron's real `userData` folder (`%APPDATA%\Reminder`) and expects a **fresh profile**: it asserts the
first-run empty state. It never deletes data. Close Reminder and move any existing `%APPDATA%\Reminder` folder aside before running it.

## Structure
- `src/api/client.ts`: `call()` turns both `Result` errors and rejected IPC promises into one `Outcome`. A rejection
  becomes the renderer-only code `IPC_FAILURE`, which is shown as a localized connectivity error.
- `src/useReminder.ts`: loads settings, then tasks, before showing the normal UI. It renders only server-confirmed mutations,
  keeps the inverse patch plus the returned revision for Undo, and reloads after `CONFLICT`/`NOT_FOUND`.
- `src/taskDraft.ts`: form draft ⇄ API conversion. Edits send only the changed fields. After a conflict, the form takes the newer saved values for fields the user hasn't touched and keeps the user's edits.
- `src/time.ts`: date-only deadlines are formatted as calendar dates (never shifted). Exact deadlines are entered and
  shown in the **settings** time zone, which is independent of UI language.
- `src/i18n/messages.ts`: all en-US / zh-CN UI copy, including a message for every error code.
- `src/test/fakeApi.ts`: **test fixture only**. It's an in-memory API that follows `docs/api-v1.md`, with failure injection. It's never bundled.

## Verification evidence
Environment: Windows 11 Pro 10.0.26200.9711, Node 24.16.0, npm 11.13.0, Electron 45.2.1 (bundled Node 24.22.1,
Chromium 156.0.8078.75). Source baseline `ab8d214892344be0639d2c801203c01587fa9b6d`.

### A. Mock-only (renderer tests; not evidence of persistence)
`npm test` → 4 files, **58 passed**. Tests run with host `TZ=Pacific/Kiritimati` (UTC+14) to catch date shifts. They cover:
loading/empty/unavailable/bridge-missing states, a rejected list call not shown as empty, create with estimate and a date-only
or exact deadline, the localized blank-title error (en-US and zh-CN) with no write, a rejected create that keeps input and shows no success,
a server field error, duplicate-submit lock, HTML-like text shown as text, edit + undo with the returned revision, an unchanged
edit making no write, Escape cancel, complete → undo → complete → reopen, a failed completion not shown, a stale edit conflict
that keeps both the newer save and the draft, an undo conflict that doesn't overwrite, a transient undo failure that keeps Undo available, an overdue task staying pending,
no spurious deadline patch after a time zone change, a zh-CN switch keeping task text, a failed or conflicting settings save, time zone display, and Ctrl+N.
Review-fix regressions (Codex review of `4874258`), each seen failing before the fix:
DST gap rejected with a localized field error and zero writes (New York 2027-03-14 02:30, Berlin 2027-03-28 02:30); DST fold
requires an explicit First/Second occurrence (New York 2027-11-07 01:30, Berlin 2027-10-31 02:30), and editing keeps the saved
occurrence; a stale edit keeps its draft when another writer moves the task pending → completed and completed → pending;
a failed conflict refresh no longer claims the latest version loaded (edit and undo); UTC is selectable again; zh-CN
settings survive a task-list load failure on the unavailable page.
I checked that the tests can fail by breaking behavior on purpose (also: removing the editor stash, removing the gap check) (sending Undo with a stale revision; formatting date-only deadlines in the display zone):
the related tests failed, then passed again after I restored the code.

`npm run typecheck` → exit 0. `npm run build` → `dist/index.html` plus `./assets/index-*.js|css`. Root `npm test` → 15 passed, 0 failed.

### B. Real Electron + real IPC + real SQLite (`npm run e2e`, fresh `%APPDATA%\Reminder`)
Exit 0. Every step is checked with assertions on the UI **and** on data read back through `window.reminder`:
1. Launched with `--lang=zh-CN` (Chromium reports `navigator.language === 'zh-CN'`): English UI, `lang="en-US"`, empty state.
2. Set time zone to Asia/Shanghai. Created "Finish my essay" (180 min, date-only 2026-11-06): the saved deadline is `{kind:'date',date:'2026-11-06'}`, shown as "Due Fri, Nov 6, 2026".
3. Created "数学作业" and "Exam" (exact, 17:00 Shanghai, saved as `2026-11-06T09:00:00.000Z`).
4. A blank title showed "Enter a title." and the task count was unchanged.
5. Edit notes → complete → Undo → complete → Reopen: ended pending, `completedAt: null`, revision 6.
6. Stale edit (another write landed while the form was open): localized conflict, and the newer `priority: high` was kept. Undo conflict: the newer notes were kept and the task stayed completed.
7. Switched time zone to America/Los_Angeles: Exam shows "1:00 AM PST" and the essay still shows Nov 6.
   In America/New_York, 2027-03-14 02:30 was rejected with no write. 2027-11-07 01:30 required a choice; with "Second (GMT-5)" it was saved as `2027-11-07T06:30:00.000Z`.
   A stale edit of Exam while another write completed it: the draft title was kept in the form under Completed, and an explicit re-save applied it.
8. Switched to zh-CN, **quit Electron, relaunched**: zh-CN UI, time zone kept, `tasks.list()` deep-equal to the pre-quit list,
   the date-only deadline shows "2026年11月6日周五", and completion states were kept.
9. Window at the shell minimum of 760×540: no horizontal overflow. Ctrl+N focuses the new-task title from Settings.

Screenshots from that run are in `docs/evidence/` (`01`–`13`). They show real desktop data entered by the script, not fixtures.

Not exercised against the real backend: rejected IPC or `STORAGE_ERROR` (only covered by the fake API), a real second window, and
an actual Chinese-language Windows install (simulated with Chromium `--lang`). No installer or notification claims.

### REM-001-FE-01: settings conflict with a failed reload
If `settings.update` returns `CONFLICT` and the follow-up `settings.get` also fails (a `STORAGE_ERROR` result or a rejected IPC
promise), the app no longer says the latest settings are shown. It keeps the last known settings on screen and shows a
localized error with a **Try again** button that reloads the latest saved settings. Choosing the setting again also stays
revision-checked. A successful reload behaves as before.
Mock-only evidence (fixture failure injection): 6 regression tests, en-US and zh-CN × {`STORAGE_ERROR` result, rejected
promise, retry by choosing again}, seen failing before the fix (the old copy claimed "The latest saved settings are shown") and
passing after it. The real backend can't be made to fail `settings.get` on demand, so this path has no real-Electron evidence.

### REM-002-FE: assistant UI (optional capability)
The renderer feature-detects `window.reminder.assistant` (assistant v1.0.0, `getAssistant()` in `src/api/client.ts`). Without
it, there is no Assistant tab, Settings says the assistant isn't available, and the manual app is unchanged. With it:
- **Assistant tab** (`src/components/AssistantView.tsx`, state in `src/useAssistant.ts`): a conversation with the service's
  replies. Applied/undone replies show "Changes saved"/"Changes undone" with the change list. Clarification and unsupported
  replies are labeled "No changes made". Task choices show title, status and deadline. DST occurrence choices show local time,
  UTC offset and zone. Reply text gets `lang` from `reply.language`. The renderer never interprets or executes operations.
- **Request IDs:** each new message or clarification answer gets `crypto.randomUUID()`. After a failure the text is kept, and
  **Try again** (or Send with unchanged text) resends the identical input with the same ID. Editing the text makes a new request.
  Nothing is resent automatically. The conversation ID comes from the last reply. `AI_CONVERSATION_EXPIRED` requires an
  explicit **New conversation** and keeps the text.
- **After applied/undone** the real `tasks.list()` is reloaded. Receipt data never replaces tasks. A failed reload says so and
  offers **Reload tasks**. **Undo these changes** sends `undo({requestId})` for the whole batch. On `CONFLICT` the list is
  reloaded and nothing is overwritten. On a transient failure Undo stays available.
- **AI settings** (`src/components/AssistantSettings.tsx`): key status and model, a write-only password field cleared after a
  successful save (kept on failure), replace/remove key, model change, and a disclosure of what is sent to DeepSeek. Config
  errors (`AI_CONFIG_ERROR`, `AI_SECURE_STORAGE_UNAVAILABLE`) are shown without affecting tasks; a broken config can be removed.
- All copy is in en-US and zh-CN, including every assistant error code.

Evidence boundaries: the assistant backend wasn't published at the planning commit, so assistant behavior is covered only by
the scripted test fixture `src/test/fakeAssistant.ts` (**mock tests**, 26 in `src/assistant.test.tsx`). Real Electron runs only
show the manual app is unchanged when the bridge has no assistant. There is no real IPC, DPAPI or DeepSeek evidence yet.

## Known limitations
- Native `<input type="date|time">` pickers display in Chromium's OS or `--lang` format (for example `06/11/2026`), not the
  app's language. The saved value is always ISO `YYYY-MM-DD`. A custom localized date picker could be a later UI task.
- The time zone selector is a plain list from `Intl.supportedValuesOf('timeZone')`, with no search.
- The undo history holds only the most recent action. A created task can't be undone (v1 has no delete).
- Dark theme follows the OS `prefers-color-scheme`. There's no in-app appearance setting yet (out of REM-001 scope).
