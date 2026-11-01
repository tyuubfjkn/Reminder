# REM-002-FE Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Assistant conversation surface + AI settings in the renderer, consuming the optional `window.reminder.assistant` (assistant v1.0.0) without executing anything locally.
**Architecture:** `getAssistant(api)` feature-detects the capability. `useAssistant` owns config, conversation entries, the in-flight/failed request (for same-ID retry) and batch Undo; after `applied`/`undone` it calls the existing task-list reload and reports failure accurately. Components render replies, receipts, clarifications and choices. Manual mode is unchanged when the capability is absent.
**Tech Stack:** existing React 19 / TypeScript / Vitest renderer; `crypto.randomUUID()` for request IDs.
**Spec:** docs/handoffs/REM-002-FE.md; design v1.1.0 REM-002; `packages/contracts/api-v1.d.ts` (manual v1 + assistant v1); docs/api-v1.md "Assistant v1"; plan docs/superpowers/plans/2026-11-01-rem-002.md Task 5.
Baseline `d2ec9a85e3250ce197ff9230aa44675f74a1d870`, branch `cc/rem-002-assistant`, PR to main. Allowed paths: `apps/desktop/renderer/**`.

## Global Constraints
- Key entry write-only (`type=password`), cleared after successful configure, never put in storage/logs/state beyond the input.
- New send / clarification answer → new UUID; transport retry → identical `AssistantInput` (same requestId). Never auto-resend.
- `conversationId` from the last reply; `AI_CONVERSATION_EXPIRED` keeps the text and requires an explicit "New conversation".
- Receipts never replace task data: after `applied`/`undone` reload `tasks.list`; if that fails, say so.
- Clarification/unsupported replies are labeled "No changes made". DST choices show local time with UTC offset and zone.
- Reply text rendered with `lang={reply.language}`; UI copy en-US/zh-CN; task text untouched.
- No reminders/scheduling/recurrence implied; no provider code or mock data in production.

## Review Focus
- Failed send then pressing Send again with unchanged text must reuse the request ID (otherwise a committed-but-unacknowledged batch could apply twice).
- Undo CONFLICT reloads tasks and overwrites nothing; Undo transient failure keeps Undo available.
- Choices from an older clarification can't be sent after a newer reply.
- Missing `assistant` capability: no Assistant nav, settings explain unavailability, manual loop unchanged.
- Config read errors (`AI_SECURE_STORAGE_UNAVAILABLE`, `AI_CONFIG_ERROR`) don't affect tasks; a broken config can still be removed.

## Files
- Modify `src/api/client.ts` (`getAssistant`, widened `Failure` code), `src/useReminder.ts` (expose `reloadTasks(): Promise<boolean>`), `src/App.tsx` (nav + views), `src/components/SettingsView.tsx` (AI section), `src/i18n/messages.ts`, `src/styles.css`.
- Create `src/useAssistant.ts`, `src/components/AssistantView.tsx`, `src/components/AssistantSettings.tsx`, `src/test/fakeAssistant.ts` (fixture only), `src/assistant.test.tsx`.
- `e2e/desktop.mjs`: assert manual-only compatibility when the bridge has no assistant.

## Tasks
1. Fixture + RED tests (`assistant.test.tsx`): feature detection; config status/model; key save clears input, failure keeps it; key replace/remove; config errors; applied receipt + list reload; reload failure; clarification task choice; occurrence choice with offsets; unsupported; expiry → new conversation; send disabled while pending; retry reuses ID+input, edited text gets a new ID; Undo success/conflict/transient; replayed note; zh-CN UI with English reply `lang`.
2. Implement client/hook/components until GREEN; typecheck; build.
3. Root `npm ci`, `npm test`, `npm run test:desktop` (isolated profile).
