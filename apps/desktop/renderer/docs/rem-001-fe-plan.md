# REM-001-FE Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Manual task loop in the Electron renderer: create, list, edit, complete/reopen, undo, language + timezone settings, all persisted through `window.reminder` (API v1.0.0).

**Architecture:** React + TypeScript renderer built by Vite (`base: './'`) to `dist/index.html`. A thin client wraps every bridge call so both `Result` errors and rejected Promises become one `Outcome` type. A single `useReminder` hook owns server state; components render only server-confirmed data. Strings live in `src/i18n/messages.ts`.

**Tech Stack:** React 19, TypeScript 5, Vite, Vitest + Testing Library + jsdom; Playwright `_electron` for the real-desktop check (not part of `npm test`).

**Spec:** `docs/handoffs/REM-001-FE.md` (task package, from main), `docs/superpowers/specs/2026-10-31-reminder-design.md` v1.0.0, `packages/contracts/api-v1.d.ts` v1.0.0, `docs/api-v1.md`. Plan location is inside the renderer because only `apps/desktop/renderer/**` may change.

## Global Constraints
- Allowed paths: `apps/desktop/renderer/**` only. Baseline `ab8d214892344be0639d2c801203c01587fa9b6d`, branch `cc/rem-001-task-ui`, PR to `main`.
- Contract types imported (not copied) from `packages/contracts/api-v1.d.ts` via `src/api/contract.ts`, which tsconfig includes.
- CSP verbatim: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'`. No inline scripts/styles, no remote fonts.
- Scripts: `npm run build`, `npm test` (non-watch), `npm run typecheck`. Pinned versions, committed lockfile.
- No localStorage as source of truth. No delete/reminder/AI endpoints.
- en-US default regardless of OS; locale never chooses timezone; date-only deadlines never shift.
- Limits: title trimmed 1..500, notes ≤10000, estimate null or integer 1..10080.

## Review Focus
- Timezone of the host differs from the settings timezone (tests run under `TZ=Pacific/Kiritimati`): date-only must show the stored calendar date; instants show in the settings zone.
- Rejected IPC Promise mid-mutation: busy state clears, input kept, no success shown.
- Undo after another edit landed: CONFLICT → reload, explain, nothing overwritten.
- Editing without touching the deadline after the timezone setting changed: no spurious deadline patch.
- HTML-like task text (`<b>x</b>`) renders literally.

## File map
- `index.html`, `vite.config.ts`, `tsconfig.json`, `package.json`
- `src/api/contract.ts` – type re-exports from the shared contract
- `src/api/client.ts` – `getApi(): ReminderApi | null`, `call<T>(fn): Promise<Outcome<T>>`, `Outcome<T> = Result<T> | {ok:false,error:{code:'IPC_FAILURE'}}`
- `src/i18n/messages.ts` – `messages[locale][key]`, `translate(locale, key, vars?)`, `errorMessage(locale, error)`
- `src/time.ts` – `zonedToUtcIso(date, time, tz)`, `utcToZoned(at, tz)`, `formatDeadline(d, locale, tz)`, `formatMinutes`, `isOverdue(d, now, tz)`
- `src/useReminder.ts` – load/create/update/undo/updateSettings, conflict + error state
- `src/components/*` – `App`, `TaskForm`, `TaskItem`, `TaskList`, `SettingsView`, `Notice`
- `src/test/fakeApi.ts` – contract-faithful in-memory ReminderApi with failure injection (tests only)
- `e2e/desktop.mjs` – real Electron loop + relaunch (manual `npm run e2e`)

## Tasks
### Task 1: Scaffold + contract wiring
- [ ] package.json, tsconfig (include `src`, `vite.config.ts`), vite config (`base:'./'`, vitest jsdom, `TZ` set in test script), index.html with CSP and `lang="en-US"`.
- [ ] Test: `client.test.ts` – `call` returns `{ok:false,error:{code:'IPC_FAILURE'}}` when fn rejects; passes through Result otherwise; `getApi()` null without bridge.

### Task 2: Time + i18n
- [ ] Tests: `zonedToUtcIso('2026-11-06','17:00','Asia/Shanghai') === '2026-11-06T09:00:00.000Z'`; `formatDeadline({kind:'date',date:'2026-11-06',...},'en-US',any)` contains `Nov 6, 2026` under host TZ Kiritimati; zh-CN contains `2026年11月6日`; instant formatted in given tz; every en-US key exists in zh-CN.

### Task 3: State hook + UI
- [ ] Tests (`App.test.tsx`, fakeApi): loading → English empty state; storage error → unavailable + Retry; create essay (180 min, date deadline) shows returned task; blank title localized, `create` not called; rejected create keeps input, no task; edit/complete/undo/reopen; stale edit conflict keeps newer server edit + draft; undo conflict; zh-CN switch keeps `数学作业`; instant shown in selected timezone; duplicate submit disabled; HTML text literal; overdue stays pending.

### Task 4: Real Electron verification
- [ ] Root `npm install` (not committed), renderer build, `npm run e2e`: fresh launch English empty → create/edit/complete/undo/reopen → zh-CN → quit → relaunch → verify persistence; screenshots to `docs/evidence/`.
