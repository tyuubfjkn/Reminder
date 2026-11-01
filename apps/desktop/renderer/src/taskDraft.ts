import type { CreateTask, Deadline, Priority, Task, TaskPatch } from './api/contract';
import type { MessageKey } from './i18n/messages';
import { utcToZoned, zonedToUtcIso } from './time';

export type DeadlineKind = 'none' | 'date' | 'instant';
export interface Draft {
  title: string;
  notes: string;
  priority: Priority;
  estimate: string;
  deadlineKind: DeadlineKind;
  deadlineDate: string;
  deadlineTime: string;
}
export type DraftField = 'title' | 'notes' | 'estimatedMinutes' | 'deadline' | 'priority';
export type DraftError = { field: DraftField; key: MessageKey };

export const emptyDraft: Draft = {
  title: '', notes: '', priority: 'normal', estimate: '', deadlineKind: 'none', deadlineDate: '', deadlineTime: ''
};

export function draftFromTask(task: Task, timeZone: string): Draft {
  const d = task.deadline;
  const wall = d?.kind === 'instant' ? utcToZoned(d.at, timeZone) : null;
  return {
    title: task.title,
    notes: task.notes,
    priority: task.priority,
    estimate: task.estimatedMinutes === null ? '' : String(task.estimatedMinutes),
    deadlineKind: d ? d.kind : 'none',
    deadlineDate: d?.kind === 'date' ? d.date : wall?.date ?? '',
    deadlineTime: wall?.time ?? ''
  };
}

export function validateDraft(draft: Draft): DraftError | null {
  const title = draft.title.trim();
  if (!title || !title.isWellFormed()) return { field: 'title', key: 'error.title' };
  if (title.length > 500) return { field: 'title', key: 'error.titleLong' };
  if (draft.notes.length > 10000 || !draft.notes.isWellFormed()) return { field: 'notes', key: 'error.notes' };
  if (draft.estimate.trim()) {
    const n = Number(draft.estimate);
    if (!/^\d+$/.test(draft.estimate.trim()) || n < 1 || n > 10080) return { field: 'estimatedMinutes', key: 'error.estimate' };
  }
  if (draft.deadlineKind !== 'none') {
    if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(draft.deadlineDate)) return { field: 'deadline', key: 'error.deadline' };
    if (draft.deadlineKind === 'instant' && !/^\d{2}:\d{2}$/.test(draft.deadlineTime)) return { field: 'deadline', key: 'error.deadline' };
  }
  return null;
}

function deadlineOf(draft: Draft, timeZone: string): Deadline | null {
  if (draft.deadlineKind === 'date') return { kind: 'date', date: draft.deadlineDate, timeZone };
  if (draft.deadlineKind === 'instant') {
    return { kind: 'instant', at: zonedToUtcIso(draft.deadlineDate, draft.deadlineTime, timeZone), timeZone };
  }
  return null;
}

const estimateOf = (draft: Draft) => (draft.estimate.trim() ? Number(draft.estimate) : null);

export function draftToCreate(draft: Draft, timeZone: string): CreateTask {
  return {
    title: draft.title.trim(), notes: draft.notes, priority: draft.priority,
    estimatedMinutes: estimateOf(draft), deadline: deadlineOf(draft, timeZone)
  };
}

const deadlineChanged = (a: Draft, b: Draft) =>
  a.deadlineKind !== b.deadlineKind ||
  (a.deadlineKind !== 'none' && a.deadlineDate !== b.deadlineDate) ||
  (a.deadlineKind === 'instant' && a.deadlineTime !== b.deadlineTime);

/** Only fields the user changed relative to `base`, so untouched values are never rewritten. */
export function draftToPatch(draft: Draft, base: Draft, timeZone: string): TaskPatch {
  const patch: TaskPatch = {};
  if (draft.title.trim() !== base.title.trim()) patch.title = draft.title.trim();
  if (draft.notes !== base.notes) patch.notes = draft.notes;
  if (draft.priority !== base.priority) patch.priority = draft.priority;
  if (estimateOf(draft) !== estimateOf(base)) patch.estimatedMinutes = estimateOf(draft);
  if (deadlineChanged(draft, base)) patch.deadline = deadlineOf(draft, timeZone);
  return patch;
}

/** After a refresh, adopt newer saved values for fields the user has not edited. */
export function rebaseDraft(draft: Draft, oldBase: Draft, newBase: Draft): Draft {
  const next: Draft = { ...draft };
  for (const key of ['title', 'notes', 'priority', 'estimate'] as const) {
    if (draft[key] === oldBase[key]) next[key] = newBase[key] as never;
  }
  if (!deadlineChanged(draft, oldBase)) {
    next.deadlineKind = newBase.deadlineKind;
    next.deadlineDate = newBase.deadlineDate;
    next.deadlineTime = newBase.deadlineTime;
  }
  return next;
}

/** The previous values of the fields in `patch`, used for an explicit Undo. */
export function inversePatch(task: Task, patch: TaskPatch): TaskPatch {
  const inverse: Record<string, unknown> = {};
  for (const key of Object.keys(patch) as (keyof TaskPatch)[]) inverse[key] = task[key];
  return inverse as TaskPatch;
}
