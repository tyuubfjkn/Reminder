import { useCallback, useEffect, useRef, useState } from 'react';
import type { CreateTask, ReminderApi, Settings, Task, TaskPatch, UpdateSettings } from './api/contract';
import { call, type Outcome } from './api/client';
import { errorKey, type MessageKey } from './i18n/messages';
import { inversePatch } from './taskDraft';

export type Phase = { kind: 'loading' } | { kind: 'unavailable'; reason: 'bridge' | 'error' } | { kind: 'ready' };
export interface UndoEntry { taskId: string; revision: number; patch: TaskPatch }
export interface Notice {
  tone: 'success' | 'error';
  key: MessageKey;
  vars?: Record<string, string>;
  undo?: UndoEntry;
  /** Offers an explicit retry that reloads the latest saved settings. */
  retry?: 'settings';
}

export function useReminder(api: ReminderApi | null) {
  const [phase, setPhase] = useState<Phase>(api ? { kind: 'loading' } : { kind: 'unavailable', reason: 'bridge' });
  const [settings, setSettings] = useState<Settings | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [settingsBusy, setSettingsBusy] = useState(false);
  const busyRef = useRef(new Set<string>());

  const load = useCallback(async () => {
    if (!api) return;
    setPhase({ kind: 'loading' });
    const s = await call(() => api.settings.get());
    const list = s.ok ? await call(() => api.tasks.list()) : null;
    // Keep settings that did load, so the unavailable page still uses the saved language.
    if (s.ok) setSettings(s.data);
    if (!s.ok || !list?.ok) {
      setPhase({ kind: 'unavailable', reason: 'error' });
      return;
    }
    setTasks(list.data);
    setPhase({ kind: 'ready' });
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  /** Reloads the list; false when the latest saved state could not be loaded. */
  const refreshTasks = useCallback(async (): Promise<boolean> => {
    if (!api) return false;
    const list = await call(() => api.tasks.list());
    if (list.ok) setTasks(list.data);
    return list.ok;
  }, [api]);

  const replace = (task: Task) => setTasks(current => current.map(t => (t.id === task.id ? task : t)));

  const setBusy = (id: string, on: boolean) => {
    if (on) busyRef.current.add(id); else busyRef.current.delete(id);
    setBusyIds(new Set(busyRef.current));
  };

  const fail = (outcome: Extract<Outcome<unknown>, { ok: false }>, key?: MessageKey) =>
    setNotice({ tone: 'error', key: key ?? errorKey(outcome.error) });

  const createTask = useCallback(async (input: CreateTask): Promise<Outcome<Task>> => {
    const result = await call(() => api!.tasks.create(input));
    if (result.ok) {
      setTasks(current => [...current, result.data]);
      setNotice({ tone: 'success', key: 'status.created', vars: { title: result.data.title } });
    } else if (!(result.error.code === 'VALIDATION_ERROR' && result.error.field)) {
      fail(result);
    }
    return result;
  }, [api]);

  /** Revision-checked update of the task as the user saw it; records an inverse patch for Undo. */
  const updateTask = useCallback(async (task: Task, patch: TaskPatch): Promise<Outcome<Task>> => {
    if (busyRef.current.has(task.id)) return { ok: false, error: { code: 'CONFLICT' } };
    setBusy(task.id, true);
    const result = await call(() => api!.tasks.update({ id: task.id, expectedRevision: task.revision, patch }));
    setBusy(task.id, false);
    if (result.ok) {
      replace(result.data);
      const key: MessageKey = patch.status === 'completed' ? 'undo.completed'
        : patch.status === 'pending' ? 'undo.reopened' : 'undo.edited';
      setNotice({
        tone: 'success', key, vars: { title: result.data.title },
        undo: { taskId: task.id, revision: result.data.revision, patch: inversePatch(task, patch) }
      });
    } else if (result.error.code === 'CONFLICT' || result.error.code === 'NOT_FOUND') {
      const refreshed = await refreshTasks();
      const editConflict = result.error.code === 'CONFLICT' && !('status' in patch);
      fail(result, !refreshed ? (editConflict ? 'conflict.refreshFailed' : 'error.ipc')
        : editConflict ? 'conflict.edit' : undefined);
    } else if (!(result.error.code === 'VALIDATION_ERROR' && result.error.field)) {
      fail(result);
    }
    return result;
  }, [api, refreshTasks]);

  const undo = useCallback(async (entry: UndoEntry) => {
    if (busyRef.current.has(entry.taskId)) return;
    setBusy(entry.taskId, true);
    const result = await call(() => api!.tasks.update({ id: entry.taskId, expectedRevision: entry.revision, patch: entry.patch }));
    setBusy(entry.taskId, false);
    if (result.ok) {
      replace(result.data);
      setNotice({ tone: 'success', key: 'undo.done' });
    } else if (result.error.code === 'CONFLICT' || result.error.code === 'NOT_FOUND') {
      const refreshed = await refreshTasks();
      fail(result, !refreshed ? 'undo.conflictRefreshFailed' : result.error.code === 'CONFLICT' ? 'undo.conflict' : undefined);
    } else {
      // Keep the Undo available so the user can retry after a transient failure.
      setNotice({ tone: 'error', key: errorKey(result.error), undo: entry });
    }
  }, [api, refreshTasks]);

  /** After a settings CONFLICT: adopt the latest saved settings, or say plainly that they could not be loaded. */
  const reloadAfterConflict = useCallback(async () => {
    const latest = await call(() => api!.settings.get());
    if (latest.ok) {
      setSettings(latest.data);
      setNotice({ tone: 'error', key: 'conflict.settings' });
    } else {
      // Last known settings stay as they are; the user retries explicitly.
      setNotice({ tone: 'error', key: 'conflict.settingsRefreshFailed', retry: 'settings' });
    }
  }, [api]);

  const retrySettingsReload = useCallback(async () => {
    if (settingsBusy) return;
    setSettingsBusy(true);
    await reloadAfterConflict();
    setSettingsBusy(false);
  }, [reloadAfterConflict, settingsBusy]);

  const updateSettings = useCallback(async (patch: UpdateSettings['patch']) => {
    if (!settings || settingsBusy) return;
    setSettingsBusy(true);
    const result = await call(() => api!.settings.update({ expectedRevision: settings.revision, patch }));
    if (result.ok) {
      setSettings(result.data);
      setNotice({ tone: 'success', key: 'settings.saved' });
    } else if (result.error.code === 'CONFLICT') {
      await reloadAfterConflict();
    } else {
      fail(result);
    }
    setSettingsBusy(false);
  }, [api, settings, settingsBusy, reloadAfterConflict]);

  return {
    phase, settings, tasks, notice, busyIds, settingsBusy,
    load, createTask, updateTask, undo, updateSettings, retrySettingsReload, reloadTasks: refreshTasks,
    dismissNotice: () => setNotice(null)
  };
}
