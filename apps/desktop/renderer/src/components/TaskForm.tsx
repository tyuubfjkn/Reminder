import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type Ref } from 'react';
import type { Priority, Task } from '../api/contract';
import type { Outcome } from '../api/client';
import { errorKey } from '../i18n/messages';
import { useI18n } from '../i18n/context';
import {
  draftFold, draftFromTask, emptyDraft, rebaseDraft, validateDraft,
  type DeadlineKind, type Draft, type DraftError, type DraftField, type FoldChoice
} from '../taskDraft';
import { offsetLabel } from '../time';

/** Editor state kept outside the list, so moving a task between lists never drops the user's draft. */
export interface EditorState { draft: Draft; base: Draft; revision: number }
export interface EditorStash {
  get(): EditorState | undefined;
  set(state: EditorState): void;
}

interface Props {
  /** Task being edited; omitted for the new-task form. */
  task?: Task;
  stash?: EditorStash;
  titleRef?: Ref<HTMLInputElement>;
  onSubmit: (draft: Draft, base: Draft) => Promise<Outcome<Task> | 'unchanged'>;
  onCancel?: () => void;
}

const detailFields: DraftField[] = ['notes', 'priority', 'estimatedMinutes', 'deadline', 'deadlineTime'];

export function TaskForm({ task, stash, titleRef, onSubmit, onCancel }: Props) {
  const { t, locale, timeZone } = useI18n();
  const editing = Boolean(task);
  const id = useId();
  const [initial] = useState<EditorState>(() => {
    const saved = stash?.get();
    if (saved) return saved;
    const base = task ? draftFromTask(task, timeZone) : emptyDraft;
    return { draft: base, base, revision: task?.revision ?? 0 };
  });
  const [base, setBase] = useState<Draft>(initial.base);
  const [draft, setDraft] = useState<Draft>(initial.draft);
  const [error, setError] = useState<DraftError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [expanded, setExpanded] = useState(editing);
  const revision = useRef(initial.revision);

  // A refreshed task (for example after a conflict) keeps the user's edits and adopts newer saved values.
  useEffect(() => {
    if (!task || task.revision === revision.current) return;
    revision.current = task.revision;
    const next = draftFromTask(task, timeZone);
    setDraft(d => rebaseDraft(d, base, next));
    setBase(next);
  }, [task, timeZone, base]);

  useEffect(() => { stash?.set({ draft, base, revision: revision.current }); }, [stash, draft, base]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    // A different wall time may no longer be repeated, so a previous occurrence choice is dropped.
    const resetFold = key === 'deadlineDate' || key === 'deadlineTime';
    setDraft(d => ({ ...d, [key]: value, ...(resetFold ? { deadlineFold: '' as FoldChoice } : {}) }));
    if (error) setError(null);
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    const invalid = validateDraft(draft, timeZone);
    if (invalid) return show(invalid);
    setSubmitting(true);
    const result = await onSubmit(draft, base);
    setSubmitting(false);
    if (result === 'unchanged') return;
    if (result.ok) {
      if (!editing) {
        setDraft(emptyDraft);
        setExpanded(false);
      }
    } else if (result.error.code === 'VALIDATION_ERROR' && result.error.field) {
      const field = result.error.field as DraftField;
      show({ field: detailFields.includes(field) || field === 'title' ? field : 'title', key: errorKey(result.error) });
    }
  }

  function show(err: DraftError) {
    setError(err);
    if (detailFields.includes(err.field)) setExpanded(true);
    requestAnimationFrame(() => document.getElementById(`${id}-${err.field}`)?.focus());
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' && onCancel) {
      event.preventDefault();
      onCancel();
    }
  }

  const errorFor = (field: DraftField) => (error?.field === field ? (
    <p className="field-error" id={`${id}-${field}-error`}>{t(error.key, error.vars)}</p>
  ) : null);
  const invalidProps = (field: DraftField) => (error?.field === field
    ? { 'aria-invalid': true as const, 'aria-describedby': `${id}-${field}-error` } : {});
  const heading = editing ? t('form.editTask') : t('form.newTask');
  const fold = draftFold(draft, timeZone);

  return (
    <form className={editing ? 'task-form editing' : 'task-form'} aria-label={heading} onSubmit={submit} onKeyDown={onKeyDown} noValidate>
      <div className="title-row">
        <div className="field grow">
          <label htmlFor={`${id}-title`} className={editing ? undefined : 'visually-hidden'}>{t('form.title')}</label>
          <input
            id={`${id}-title`} ref={titleRef} type="text" value={draft.title} autoComplete="off"
            placeholder={editing ? undefined : t('form.titlePlaceholder')} maxLength={1000}
            onChange={e => set('title', e.target.value)} {...invalidProps('title')} autoFocus={editing}
          />
          {errorFor('title')}
        </div>
        {!editing && (
          <button type="submit" className="primary" disabled={submitting}>
            {submitting ? t('action.adding') : t('action.add')}
          </button>
        )}
      </div>

      {!editing && (
        <button type="button" className="link" aria-expanded={expanded} aria-controls={`${id}-details`} onClick={() => setExpanded(x => !x)}>
          {expanded ? t('action.fewerDetails') : t('action.moreDetails')}
        </button>
      )}

      {expanded && (
        <div className="details" id={`${id}-details`}>
          <div className="field full">
            <label htmlFor={`${id}-notes`}>{t('form.notes')}</label>
            <textarea id={`${id}-notes`} rows={3} value={draft.notes} onChange={e => set('notes', e.target.value)} {...invalidProps('notes')} />
            {errorFor('notes')}
          </div>
          <div className="field">
            <label htmlFor={`${id}-priority`}>{t('form.priority')}</label>
            <select id={`${id}-priority`} value={draft.priority} onChange={e => set('priority', e.target.value as Priority)}>
              {(['low', 'normal', 'high'] as const).map(p => <option key={p} value={p}>{t(`priority.${p}`)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${id}-estimatedMinutes`}>{t('form.estimate')}</label>
            <input
              id={`${id}-estimatedMinutes`} type="number" inputMode="numeric" min={1} max={10080} step={1}
              value={draft.estimate} onChange={e => set('estimate', e.target.value)}
              aria-describedby={error?.field === 'estimatedMinutes' ? `${id}-estimatedMinutes-error` : `${id}-estimate-hint`}
              aria-invalid={error?.field === 'estimatedMinutes' || undefined}
            />
            <p className="hint" id={`${id}-estimate-hint`}>{t('form.estimateHint')}</p>
            {errorFor('estimatedMinutes')}
          </div>
          <fieldset className="field full deadline">
            <legend>{t('form.deadline')}</legend>
            <div className="segmented">
              {(['none', 'date', 'instant'] as DeadlineKind[]).map(kind => (
                <label key={kind} className="segment">
                  <input type="radio" name={`${id}-deadline-kind`} value={kind} checked={draft.deadlineKind === kind}
                    onChange={() => set('deadlineKind', kind)} />
                  <span>{t(`form.deadline.${kind}`)}</span>
                </label>
              ))}
            </div>
            {draft.deadlineKind !== 'none' && (
              <div className="deadline-inputs">
                <div className="field">
                  <label htmlFor={`${id}-deadline`}>{t('form.deadlineDate')}</label>
                  <input id={`${id}-deadline`} type="date" min="0001-01-01" max="9999-12-31" value={draft.deadlineDate}
                    onChange={e => set('deadlineDate', e.target.value)} {...invalidProps('deadline')} />
                </div>
                {draft.deadlineKind === 'instant' && (
                  <div className="field">
                    <label htmlFor={`${id}-deadlineTime`}>{t('form.deadlineTime')}</label>
                    <input id={`${id}-deadlineTime`} type="time" value={draft.deadlineTime}
                      onChange={e => set('deadlineTime', e.target.value)} {...invalidProps('deadlineTime')} />
                  </div>
                )}
              </div>
            )}
            {fold && (
              <fieldset className="fold-choice">
                <legend>{t('form.fold.legend', { time: draft.deadlineTime })}</legend>
                <div className="segmented">
                  {(['earlier', 'later'] as const).map(which => (
                    <label key={which} className="segment">
                      <input type="radio" name={`${id}-fold`} value={which} checked={draft.deadlineFold === which}
                        onChange={() => set('deadlineFold', which)} />
                      <span>{t(`form.fold.${which}`, { time: draft.deadlineTime, offset: offsetLabel(fold[which], timeZone, locale) })}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {draft.deadlineKind === 'instant' && <p className="hint">{t('form.deadlineZone', { zone: timeZone })}</p>}
            {errorFor('deadline')}
            {errorFor('deadlineTime')}
          </fieldset>
        </div>
      )}

      {editing && (
        <div className="form-actions">
          <button type="submit" className="primary" disabled={submitting}>
            {submitting ? t('action.saving') : t('action.save')}
          </button>
          <button type="button" onClick={onCancel} disabled={submitting}>{t('action.cancel')}</button>
        </div>
      )}
    </form>
  );
}
