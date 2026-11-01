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
`npm test` → 4 files, **44 passed**. Tests run with host `TZ=Pacific/Kiritimati` (UTC+14) to catch date shifts. They cover:
loading/empty/unavailable/bridge-missing states, a rejected list call not shown as empty, create with estimate and a date-only
or exact deadline, the localized blank-title error (en-US and zh-CN) with no write, a rejected create that keeps input and shows no success,
a server field error, duplicate-submit lock, HTML-like text shown as text, edit + undo with the returned revision, an unchanged
edit making no write, Escape cancel, complete → undo → complete → reopen, a failed completion not shown, a stale edit conflict
that keeps both the newer save and the draft, an undo conflict that doesn't overwrite, a transient undo failure that keeps Undo available, an overdue task staying pending,
no spurious deadline patch after a time zone change, a zh-CN switch keeping task text, a failed or conflicting settings save, time zone display, and Ctrl+N.
I checked that the tests can fail by breaking behavior on purpose (sending Undo with a stale revision; formatting date-only deadlines in the display zone):
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
8. Switched to zh-CN, **quit Electron, relaunched**: zh-CN UI, time zone kept, `tasks.list()` deep-equal to the pre-quit list,
   the date-only deadline shows "2026年11月6日周五", and completion states were kept.
9. Window at the shell minimum of 760×540: no horizontal overflow. Ctrl+N focuses the new-task title from Settings.

Screenshots from that run are in `docs/evidence/` (`01`–`10`). They show real desktop data entered by the script, not fixtures.

Not exercised against the real backend: rejected IPC or `STORAGE_ERROR` (only covered by the fake API), a real second window, and
an actual Chinese-language Windows install (simulated with Chromium `--lang`). No installer or notification claims.

## Known limitations
- Native `<input type="date|time">` pickers display in Chromium's OS or `--lang` format (for example `06/11/2026`), not the
  app's language. The saved value is always ISO `YYYY-MM-DD`. A custom localized date picker could be a later UI task.
- The time zone selector is a plain list from `Intl.supportedValuesOf('timeZone')`, with no search.
- The undo history holds only the most recent action. A created task can't be undone (v1 has no delete).
- Dark theme follows the OS `prefers-color-scheme`. There's no in-app appearance setting yet (out of REM-001 scope).
