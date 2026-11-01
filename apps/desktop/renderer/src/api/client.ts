import type { AssistantApi, AssistantErrorCode, AssistantResult, ReminderApi, Result } from './contract';

/** Renderer-side failure for a rejected or missing bridge call; not part of API v1. */
export type ClientErrorCode = AssistantErrorCode | 'IPC_FAILURE';
export type Failure = { code: ClientErrorCode; field?: string };
export type Outcome<T> = { ok: true; data: T } | { ok: false; error: Failure };

export function getApi(): ReminderApi | null {
  const api = (globalThis as { reminder?: ReminderApi }).reminder;
  return api && api.apiVersion === '1.0.0' ? api : null;
}

/** The optional REM-002 assistant capability, or null on manual-only bridges. */
export function getAssistant(api: ReminderApi | null): AssistantApi | null {
  const assistant = api?.assistant;
  if (!assistant || assistant.apiVersion !== '1.0.0') return null;
  const methods = ['getConfig', 'configure', 'submit', 'undo'] as const;
  return methods.every(m => typeof assistant[m] === 'function') ? assistant : null;
}

export async function call<T>(fn: () => Promise<Result<T> | AssistantResult<T>>): Promise<Outcome<T>> {
  try {
    const result = await fn();
    if (result && typeof result === 'object' && typeof result.ok === 'boolean') return result;
  } catch {
    // Fall through: transport failures surface as a localized connectivity error.
  }
  return { ok: false, error: { code: 'IPC_FAILURE' } };
}
