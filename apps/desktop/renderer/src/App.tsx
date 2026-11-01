import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReminderApi, Task } from './api/contract';
import { I18nProvider, makeI18n, useI18n } from './i18n/context';
import { draftToCreate, draftToPatch, type Draft } from './taskDraft';
import { useReminder, type Notice, type UndoEntry } from './useReminder';
import { TaskForm, type EditorStash, type EditorState } from './components/TaskForm';
import { TaskItem } from './components/TaskItem';
import { SettingsView } from './components/SettingsView';

type View = 'tasks' | 'settings';

export function App({ api }: { api: ReminderApi | null }) {
  const state = useReminder(api);
  const { phase, settings } = state;
  const i18n = useMemo(() => makeI18n(settings?.locale ?? 'en-US', settings?.timeZone ?? 'UTC'), [settings?.locale, settings?.timeZone]);

  useEffect(() => { document.documentElement.lang = i18n.locale; }, [i18n.locale]);

  return (
    <I18nProvider value={i18n}>
      {phase.kind === 'loading' && <p className="center-state" role="status">{i18n.t('app.loading')}</p>}
      {phase.kind === 'unavailable' && (
        <section className="center-state">
          <h1>{i18n.t('unavailable.title')}</h1>
          <p>{i18n.t(phase.reason === 'bridge' ? 'unavailable.bridge' : 'unavailable.body')}</p>
          {phase.reason === 'error' && <button type="button" className="primary" onClick={() => void state.load()}>{i18n.t('action.retry')}</button>}
        </section>
      )}
      {phase.kind === 'ready' && settings && <Ready state={state} />}
    </I18nProvider>
  );
}

function Ready({ state }: { state: ReturnType<typeof useReminder> }) {
  const { t, timeZone } = useI18n();
  const [view, setView] = useState<View>('tasks');
  const [editingId, setEditing] = useState<string | null>(null);
  // Lives above both lists: a refresh that moves the task to the other list must not drop the draft.
  const editor = useRef<EditorState | undefined>(undefined);
  const stash = useMemo<EditorStash>(() => ({ get: () => editor.current, set: s => { editor.current = s; } }), [editingId]);
  const setEditingId = (id: string | null) => { editor.current = undefined; setEditing(id); };
  const [focusRequest, setFocusRequest] = useState(0);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        setView('tasks');
        setFocusRequest(n => n + 1);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => { if (focusRequest) titleRef.current?.focus(); }, [focusRequest, view]);

  const pending = state.tasks.filter(task => task.status === 'pending');
  const completed = state.tasks.filter(task => task.status === 'completed');

  const create = (draft: Draft) => state.createTask(draftToCreate(draft, timeZone));

  const save = (task: Task) => async (draft: Draft, base: Draft) => {
    const patch = draftToPatch(draft, base, timeZone);
    if (!Object.keys(patch).length) {
      setEditingId(null);
      return 'unchanged' as const;
    }
    const result = await state.updateTask(task, patch);
    if (result.ok || result.error.code === 'NOT_FOUND') setEditingId(null);
    return result;
  };

  const toggle = (task: Task) =>
    void state.updateTask(task, { status: task.status === 'completed' ? 'pending' : 'completed' });

  const renderList = (tasks: Task[]) => (
    <ul className="task-list">
      {tasks.map(task => editingId === task.id ? (
        <li key={task.id} className="task editing-row">
          <TaskForm task={task} stash={stash} onSubmit={save(task)} onCancel={() => setEditingId(null)} />
        </li>
      ) : (
        <TaskItem key={task.id} task={task} busy={state.busyIds.has(task.id)} onToggle={toggle} onEdit={t => setEditingId(t.id)} />
      ))}
    </ul>
  );

  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">{t('app.name')}</span>
        <nav aria-label={t('nav.label')}>
          {(['tasks', 'settings'] as View[]).map(v => (
            <button key={v} type="button" className="nav-item" aria-current={view === v ? 'page' : undefined} onClick={() => setView(v)}>
              {t(`nav.${v}`)}
            </button>
          ))}
        </nav>
      </header>

      <NoticeBar notice={state.notice} onUndo={state.undo} onDismiss={state.dismissNotice} busyIds={state.busyIds} />

      <main className="content">
        {view === 'settings' ? (
          <SettingsView settings={state.settings!} busy={state.settingsBusy} onChange={patch => void state.updateSettings(patch)} />
        ) : (
          <>
            <h1 className="visually-hidden">{t('nav.tasks')}</h1>
            <TaskForm titleRef={titleRef} onSubmit={create} />
            {state.tasks.length === 0 ? (
              <div className="empty">
                <h2>{t('list.empty.title')}</h2>
                <p>{t('list.empty.body')}</p>
              </div>
            ) : (
              <>
                <ListSection title={t('list.pending')} count={pending.length}>
                  {pending.length ? renderList(pending) : <p className="muted">{t('list.pendingEmpty')}</p>}
                </ListSection>
                {completed.length > 0 && <ListSection title={t('list.completed')} count={completed.length}>{renderList(completed)}</ListSection>}
              </>
            )}
            <p className="shortcut-hint">{t('shortcut.hint')}</p>
          </>
        )}
      </main>
    </div>
  );
}

function ListSection({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  const id = useId();
  return (
    <section className="list-section" aria-labelledby={id}>
      <h2 id={id}>{title} <span className="count" aria-hidden="true">{count}</span></h2>
      {children}
    </section>
  );
}

function NoticeBar({ notice, onUndo, onDismiss, busyIds }: {
  notice: Notice | null; onUndo: (entry: UndoEntry) => void; onDismiss: () => void; busyIds: ReadonlySet<string>;
}) {
  const { t } = useI18n();
  const success = notice?.tone === 'success' ? notice : null;
  const error = notice?.tone === 'error' ? notice : null;
  return (
    <div className="notices">
      <div role="status" className={success ? 'notice success' : 'notice-empty'}>
        {success && (
          <>
            <span>{t(success.key, success.vars)}</span>
            {success.undo && (
              <button type="button" onClick={() => onUndo(success.undo!)} disabled={busyIds.has(success.undo.taskId)}>
                {t('action.undo')}
              </button>
            )}
          </>
        )}
      </div>
      {error && (
        <div role="alert" className="notice error">
          <span>{t(error.key, error.vars)}</span>
          {error.undo && (
            <button type="button" onClick={() => onUndo(error.undo!)} disabled={busyIds.has(error.undo.taskId)}>
              {t('action.undo')}
            </button>
          )}
          <button type="button" className="ghost" onClick={onDismiss}>{t('action.dismiss')}</button>
        </div>
      )}
    </div>
  );
}
