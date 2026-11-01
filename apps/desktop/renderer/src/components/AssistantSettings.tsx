import { useEffect, useId, useState, type FormEvent } from 'react';
import type { ConfigureAssistant } from '../api/contract';
import type { Failure } from '../api/client';
import { useI18n } from '../i18n/context';
import type { MessageKey } from '../i18n/messages';
import { assistantErrorKey, type AssistantState } from '../useAssistant';

/** AI settings. The key field is write-only: it is never filled from the service and is cleared after saving. */
export function AssistantSettings({ state }: { state: AssistantState | null }) {
  const { t } = useI18n();
  const id = useId();
  const [key, setKey] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Failure | null>(null);
  const [saved, setSaved] = useState<MessageKey | null>(null);
  const config = state?.configState.status === 'ready' ? state.configState.config : null;

  useEffect(() => { if (config) setModel(config.model); }, [config?.model]);
  useEffect(() => { if (state?.configState.status === 'error') setError(state.configState.error); }, [state?.configState]);

  async function save(input: ConfigureAssistant, done: MessageKey) {
    if (!state || busy) return;
    setBusy(true);
    setSaved(null);
    const result = await state.configure(input);
    setBusy(false);
    if (result.ok) {
      setError(null);
      setSaved(done);
      if (input.apiKey !== undefined) setKey('');
    } else {
      setError(result.error);
    }
  }

  function saveKey(event: FormEvent) {
    event.preventDefault();
    if (key.trim()) void save({ apiKey: key.trim() }, 'ai.keySaved');
  }

  function saveModel(event: FormEvent) {
    event.preventDefault();
    if (model.trim() && model.trim() !== config?.model) void save({ model: model.trim() }, 'ai.modelSaved');
  }

  return (
    <section className="ai-settings" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>{t('ai.title')}</h2>
      {!state ? <p className="hint">{t('ai.unavailable')}</p> : (
        <>
          <p className="hint">{t('assistant.privacy')}</p>
          {config && (
            <p className="ai-status">
              <span>{t(config.hasKey ? 'ai.keyStatus.saved' : 'ai.keyStatus.missing')}</span>
              <span>{t('ai.model', { model: config.model })}</span>
            </p>
          )}
          {error && <p role="alert" className="field-error">{t(assistantErrorKey(error))}</p>}
          {saved && !error && <p className="hint" aria-live="polite">{t(saved)}</p>}

          <form className="ai-row" onSubmit={saveKey}>
            <div className="field grow">
              <label htmlFor={`${id}-key`}>{t(config?.hasKey ? 'ai.keyReplaceLabel' : 'ai.keyLabel')}</label>
              <input id={`${id}-key`} type="password" autoComplete="off" spellCheck={false} value={key}
                onChange={e => setKey(e.target.value)} aria-describedby={`${id}-key-hint`} />
              <p className="hint" id={`${id}-key-hint`}>{t('ai.keyHint')}</p>
            </div>
            <button type="submit" className="primary" disabled={busy || !key.trim()}>{busy ? t('ai.saving') : t('ai.saveKey')}</button>
          </form>

          {(config?.hasKey || state.configState.status === 'error') && (
            <div>
              <button type="button" onClick={() => void save({ clearKey: true }, 'ai.keyRemoved')} disabled={busy}>{t('ai.removeKey')}</button>
            </div>
          )}

          {config && (
            <form className="ai-row" onSubmit={saveModel}>
              <div className="field grow">
                <label htmlFor={`${id}-model`}>{t('ai.modelLabel')}</label>
                <input id={`${id}-model`} type="text" autoComplete="off" spellCheck={false} value={model}
                  onChange={e => setModel(e.target.value)} />
              </div>
              <button type="submit" disabled={busy || !model.trim() || model.trim() === config.model}>{t('ai.saveModel')}</button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
