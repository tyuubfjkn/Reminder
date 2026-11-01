import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssistantApi, AssistantConfig, AssistantInput, AssistantReply, ConfigureAssistant } from './api/contract';
import { call, type Failure, type Outcome } from './api/client';
import type { MessageKey } from './i18n/messages';

export const MAX_INPUT = 4000;

export type UndoState = 'available' | 'pending' | 'done' | 'unavailable';
export type Entry =
  | { kind: 'user'; key: string; text: string }
  | { kind: 'reply'; key: string; reply: AssistantReply; undo: UndoState };

/**
 * A request that is in flight or failed; a retry resends exactly this input (same requestId). `submittedDraft` is
 * the raw composer text a typed message came from (absent for structured answers), kept so any retry can clear it.
 */
export interface PendingRequest { input: AssistantInput; phase: 'sending' | 'failed'; submittedDraft?: string }

export interface AssistantNotice {
  key: MessageKey;
  action?: 'retry' | 'newConversation' | 'reloadTasks';
}

export type ConfigState =
  | { status: 'loading' }
  | { status: 'ready'; config: AssistantConfig }
  | { status: 'error'; error: Failure };

export function assistantErrorKey(error: Failure): MessageKey {
  const known = [
    'AI_NOT_CONFIGURED', 'AI_CONFIG_ERROR', 'AI_SECURE_STORAGE_UNAVAILABLE', 'AI_AUTH_ERROR', 'AI_RATE_LIMITED',
    'AI_UNAVAILABLE', 'AI_TIMEOUT', 'AI_INVALID_RESPONSE', 'AI_CONTEXT_LIMIT', 'AI_CONVERSATION_EXPIRED', 'AI_BUSY',
    'CONFLICT', 'VALIDATION_ERROR'
  ];
  return (known.includes(error.code) ? `aiError.${error.code}` : 'aiError.IPC_FAILURE') as MessageKey;
}

/**
 * Assistant conversation state. The renderer never interprets or executes operations: it submits text
 * (or a structured clarification choice), shows the service's reply, and reloads the real task list.
 */
export function useAssistant(assistant: AssistantApi | null, reloadTasks: () => Promise<boolean>) {
  const [configState, setConfigState] = useState<ConfigState>({ status: 'loading' });
  const [entries, setEntries] = useState<Entry[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const [notice, setNotice] = useState<AssistantNotice | null>(null);
  /** Composer text lives here so it survives switching views and failed sends. */
  const [draft, setDraft] = useState('');
  const inFlight = useRef(false);

  useEffect(() => {
    if (!assistant) return;
    void call(() => assistant.getConfig()).then(result =>
      setConfigState(result.ok ? { status: 'ready', config: result.data } : { status: 'error', error: result.error }));
  }, [assistant]);

  const configure = useCallback(async (input: ConfigureAssistant): Promise<Outcome<AssistantConfig>> => {
    const result = await call(() => assistant!.configure(input));
    if (result.ok) setConfigState({ status: 'ready', config: result.data });
    return result;
  }, [assistant]);

  const afterCommit = useCallback(async () => {
    // Receipts are history, never task snapshots: always show the real saved list.
    if (!(await reloadTasks())) setNotice({ key: 'assistant.reloadFailed', action: 'reloadTasks' });
  }, [reloadTasks]);

  /**
   * `submittedDraft` is the raw composer text this request came from. On success the composer is cleared only if
   * it still holds the same request (whitespace aside), so newer text typed meanwhile is kept.
   */
  const run = useCallback(async (input: AssistantInput, userText: string, submittedDraft?: string): Promise<boolean> => {
    if (!assistant || inFlight.current) return false;
    inFlight.current = true;
    setPending({ input, phase: 'sending', submittedDraft });
    setNotice(null);
    const result = await call(() => assistant.submit(input));
    inFlight.current = false;
    if (!result.ok) {
      setPending({ input, phase: 'failed', submittedDraft });
      setNotice(result.error.code === 'AI_CONVERSATION_EXPIRED'
        ? { key: assistantErrorKey(result.error), action: 'newConversation' }
        : { key: assistantErrorKey(result.error), action: 'retry' });
      return false;
    }
    const data = result.data;
    setPending(null);
    setConversationId(data.conversationId);
    setEntries(list => [
      ...list,
      { kind: 'user', key: `${input.requestId}:user`, text: userText },
      { kind: 'reply', key: `${input.requestId}:reply`, reply: data,
        undo: data.outcome === 'applied' && data.undoAvailable ? 'available' : 'unavailable' }
    ]);
    if (submittedDraft !== undefined) setDraft(d => (d.trim() === submittedDraft.trim() ? '' : d));
    if (data.outcome === 'applied' || data.outcome === 'undone') await afterCommit();
    return true;
  }, [assistant, afterCommit]);

  /**
   * Send composer text. Text is trimmed here, once. Text that is unchanged (after trimming) since a failure is
   * the same request, so it reuses that requestId; a committed but unacknowledged request can't apply twice.
   */
  const send = useCallback((draftText: string) => {
    const text = draftText.trim();
    if (!text) return Promise.resolve(false);
    if (pending?.phase === 'failed' && !pending.input.choice && pending.input.text === text) {
      return run(pending.input, text, draftText);
    }
    return run({
      requestId: crypto.randomUUID(), text,
      ...(conversationId ? { conversationId } : {})
    }, text, draftText);
  }, [pending, conversationId, run]);

  /**
   * Answer the latest clarification with a structured choice plus a short text answer. Refused while any request
   * is in flight or failed: a lost response may have moved the service on to a question the user hasn't seen,
   * so only an identical retry (same requestId) may continue.
   */
  const answer = useCallback((text: string, choice: NonNullable<AssistantInput['choice']>) => {
    if (pending) return Promise.resolve(false);
    return run({ requestId: crypto.randomUUID(), text, ...(conversationId ? { conversationId } : {}), choice }, text);
  }, [pending, conversationId, run]);

  const retry = useCallback(() => (pending ? run(pending.input, pending.input.text, pending.submittedDraft) : Promise.resolve(false)), [pending, run]);

  const newConversation = useCallback(() => {
    setEntries([]);
    setConversationId(undefined);
    setPending(null);
    setNotice(null);
  }, []);

  const setUndo = (key: string, undo: UndoState) =>
    setEntries(list => list.map(e => (e.key === key && e.kind === 'reply' ? { ...e, undo } : e)));

  const undo = useCallback(async (entry: Extract<Entry, { kind: 'reply' }>) => {
    if (!assistant || entry.undo !== 'available') return;
    setUndo(entry.key, 'pending');
    setNotice(null);
    const result = await call(() => assistant.undo({ requestId: entry.reply.requestId }));
    if (result.ok) {
      setUndo(entry.key, 'done');
      const data = result.data;
      setEntries(list => [...list, { kind: 'reply', key: `${data.requestId}:undo`, reply: data, undo: 'unavailable' }]);
      await afterCommit();
    } else if (result.error.code === 'CONFLICT' || result.error.code === 'NOT_FOUND') {
      // A later edit blocks the whole undo; nothing was changed. Show what is actually saved now.
      setUndo(entry.key, 'unavailable');
      const reloaded = await reloadTasks();
      setNotice({ key: reloaded ? 'assistant.undoConflict' : 'assistant.undoConflictReloadFailed', action: reloaded ? undefined : 'reloadTasks' });
    } else {
      setUndo(entry.key, 'available');
      setNotice({ key: assistantErrorKey(result.error) });
    }
  }, [assistant, afterCommit, reloadTasks]);

  const retryReload = useCallback(async () => {
    if (await reloadTasks()) setNotice(null);
  }, [reloadTasks]);

  return {
    available: Boolean(assistant), configState, configure,
    draft, setDraft, entries, pending, notice, send, answer, retry, newConversation, undo, retryReload,
    dismissNotice: () => setNotice(null)
  };
}

export type AssistantState = ReturnType<typeof useAssistant>;
