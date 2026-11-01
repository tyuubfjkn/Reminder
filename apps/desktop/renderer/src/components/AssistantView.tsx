import { useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { AssistantChoices } from '../api/contract';
import { useI18n } from '../i18n/context';
import { formatDeadline, formatWallTime, offsetLabel } from '../time';
import { MAX_INPUT, assistantErrorKey, type AssistantState, type Entry } from '../useAssistant';

interface Props {
  state: AssistantState;
  onOpenSettings: () => void;
}

export function AssistantView({ state, onOpenSettings }: Props) {
  const { t } = useI18n();
  const id = useId();
  const { configState } = state;

  return (
    <section className="assistant" aria-labelledby={`${id}-heading`}>
      <h1 id={`${id}-heading`}>{t('assistant.title')}</h1>
      <p className="hint">{t('assistant.privacy')}</p>
      <p className="hint">{t('assistant.scope')}</p>
      {configState.status === 'loading' && <p className="muted">{t('assistant.loading')}</p>}
      {configState.status === 'error' && (
        <div className="assistant-gate">
          <p>{t(assistantErrorKey(configState.error))}</p>
          <button type="button" className="primary" onClick={onOpenSettings}>{t('assistant.openSettings')}</button>
        </div>
      )}
      {configState.status === 'ready' && !configState.config.hasKey && state.entries.length === 0 && (
        <div className="assistant-gate">
          <p>{t('assistant.needsKey')}</p>
          <button type="button" className="primary" onClick={onOpenSettings}>{t('assistant.openSettings')}</button>
        </div>
      )}
      {/* Without a key only new submissions are gated; history and local Undo stay available. */}
      {configState.status === 'ready' && (configState.config.hasKey || state.entries.length > 0) && (
        <Conversation state={state} canSend={configState.config.hasKey} onOpenSettings={onOpenSettings} />
      )}
    </section>
  );
}

function Conversation({ state, canSend, onOpenSettings }: { state: AssistantState; canSend: boolean; onOpenSettings: () => void }) {
  const { t } = useI18n();
  const id = useId();
  const [tooLong, setTooLong] = useState(false);
  const sending = state.pending?.phase === 'sending';
  const lastReplyKey = [...state.entries].reverse().find(e => e.kind === 'reply')?.key;

  function submit(event?: FormEvent) {
    event?.preventDefault();
    const text = state.draft.trim();
    if (!text || sending) return;
    if (text.length > MAX_INPUT) { setTooLong(true); return; }
    // The hook trims and remembers the raw draft, so a successful send clears exactly what was sent.
    void state.send(state.draft);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) submit(event);
  }

  return (
    <>
      <ol className="conversation" aria-label={t('assistant.conversation')}>
        {state.entries.length === 0 && <li className="muted conversation-empty">{t('assistant.empty')}</li>}
        {state.entries.map(entry => entry.kind === 'user' ? (
          <li key={entry.key} className="bubble user">
            <span className="visually-hidden">{t('assistant.you')}: </span>
            <p className="bubble-text">{entry.text}</p>
          </li>
        ) : (
          <ReplyEntry key={entry.key} entry={entry} state={state}
            choicesEnabled={entry.key === lastReplyKey && !state.pending && canSend} />
        ))}
      </ol>

      {state.notice && (
        <div role="alert" className="notice error">
          <span>{t(state.notice.key)}</span>
          {state.notice.action === 'retry' && state.pending && (
            <button type="button" onClick={() => void state.retry()} disabled={sending}>{t('action.retry')}</button>
          )}
          {state.notice.action === 'newConversation' && (
            <button type="button" onClick={state.newConversation}>{t('assistant.newConversation')}</button>
          )}
          {state.notice.action === 'reloadTasks' && (
            <button type="button" onClick={() => void state.retryReload()}>{t('assistant.reloadTasks')}</button>
          )}
          <button type="button" className="ghost" onClick={state.dismissNotice}>{t('action.dismiss')}</button>
        </div>
      )}

      {!canSend ? (
        <div className="assistant-gate">
          <p>{t('assistant.needsKey')}</p>
          <button type="button" className="primary" onClick={onOpenSettings}>{t('assistant.openSettings')}</button>
        </div>
      ) : (
      <form className="composer" onSubmit={submit} aria-busy={sending || undefined}>
        <label htmlFor={`${id}-message`} className="visually-hidden">{t('assistant.message')}</label>
        <textarea
          id={`${id}-message`} rows={3} value={state.draft} readOnly={sending}
          aria-invalid={tooLong || undefined} aria-describedby={tooLong ? `${id}-error` : `${id}-hint`}
          placeholder={t('assistant.empty')}
          onChange={e => { state.setDraft(e.target.value); setTooLong(false); }}
          onKeyDown={onKeyDown}
        />
        <div className="composer-row">
          {tooLong
            ? <p className="field-error" id={`${id}-error`}>{t('assistant.tooLong')}</p>
            : <p className="hint" id={`${id}-hint`}>{t('assistant.sendHint')}</p>}
          <button type="submit" className="primary" disabled={sending || !state.draft.trim()}>
            {sending ? t('assistant.sending') : t('assistant.send')}
          </button>
        </div>
      </form>
      )}
    </>
  );
}

function ReplyEntry({ entry, state, choicesEnabled }: {
  entry: Extract<Entry, { kind: 'reply' }>; state: AssistantState; choicesEnabled: boolean;
}) {
  const { t } = useI18n();
  const { reply } = entry;
  const changed = reply.outcome === 'applied' || reply.outcome === 'undone';
  const title = reply.outcome === 'applied' ? t('assistant.applied')
    : reply.outcome === 'undone' ? t('assistant.undone') : t('assistant.noChanges');

  return (
    <li className={`bubble reply outcome-${reply.outcome}`}>
      <span className="visually-hidden">{t('assistant.reply')}: </span>
      <p className={changed ? 'receipt-title' : 'badge no-changes'}>{title}</p>
      <p className="bubble-text" lang={reply.language}>{reply.message}</p>
      {reply.changes.length > 0 && (
        <ul className="changes">
          {reply.changes.map(change => (
            <li key={`${change.kind}:${change.taskId}`}>{t(`assistant.change.${change.kind}`, { title: change.title })}</li>
          ))}
        </ul>
      )}
      {reply.replayed && <p className="hint">{t('assistant.replayed')}</p>}
      {reply.choices && <Choices choices={reply.choices} enabled={choicesEnabled} state={state} />}
      {entry.undo === 'available' && (
        <button type="button" onClick={() => void state.undo(entry)}>{t('assistant.undo')}</button>
      )}
      {entry.undo === 'pending' && <button type="button" disabled>{t('assistant.undoing')}</button>}
      {entry.undo === 'done' && <p className="hint">{t('assistant.undoneLabel')}</p>}
    </li>
  );
}

function Choices({ choices, enabled, state }: { choices: AssistantChoices; enabled: boolean; state: AssistantState }) {
  const { t, locale, timeZone } = useI18n();
  const id = useId();
  return (
    <div className="choices" role="group" aria-labelledby={`${id}-label`}>
      <p className="hint" id={`${id}-label`}>{t('assistant.choices')}</p>
      {choices.kind === 'task' ? choices.tasks.map(task => (
        <button key={task.id} type="button" disabled={!enabled}
          onClick={() => void state.answer(task.title, { taskId: task.id })}>
          {t('assistant.choice.task', {
            title: task.title,
            status: t(task.status === 'completed' ? 'task.statusCompleted' : 'task.statusPending'),
            due: task.deadline ? t('assistant.choice.due', { when: formatDeadline(task.deadline, locale, timeZone) }) : ''
          })}
        </button>
      )) : (['earlier', 'later'] as const).map(which => {
        const at = choices[which];
        const label = t(which === 'earlier' ? 'assistant.choice.first' : 'assistant.choice.second');
        const offset = offsetLabel(at, choices.timeZone, locale);
        return (
          <button key={which} type="button" disabled={!enabled}
            onClick={() => void state.answer(t('assistant.choice.answer', { which: label, offset }), { occurrence: which })}>
            {t('assistant.choice.occurrence', {
              which: label, when: formatWallTime(at, locale, choices.timeZone), offset, zone: choices.timeZone
            })}
          </button>
        );
      })}
    </div>
  );
}

