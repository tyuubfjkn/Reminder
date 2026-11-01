// TEST FIXTURE ONLY. An in-memory ReminderApi that follows docs/api-v1.md, including failures.
// It is never bundled into the app and is not evidence of real persistence.
import { vi } from 'vitest';
import type {
  CreateTask, ReminderApi, Result, Settings, Task, TaskPatch, UpdateSettings, UpdateTask
} from '../api/contract';

type Method = 'tasks.list' | 'tasks.create' | 'tasks.update' | 'settings.get' | 'settings.update';
type Injected = { kind: 'result'; result: Result<never> } | { kind: 'reject' } | { kind: 'hold'; release: Promise<void> };

const invalid = (field: string): Result<never> => ({ ok: false, error: { code: 'VALIDATION_ERROR', field } });

export function createFakeApi(initial: { settings?: Partial<Settings>; tasks?: Task[] } = {}) {
  let settings: Settings = { locale: 'en-US', timeZone: 'Europe/London', revision: 1, ...initial.settings };
  let tasks: Task[] = structuredClone(initial.tasks ?? []);
  let seq = 0, clock = Date.parse('2026-10-31T20:00:00.000Z');
  const injected = new Map<Method, Injected[]>();
  const now = () => new Date(clock += 1000).toISOString();

  function checkFields(input: TaskPatch, patch: boolean): Result<never> | null {
    if (!patch || 'title' in input) {
      if (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 500) return invalid('title');
    }
    if ('notes' in input && (typeof input.notes !== 'string' || input.notes.length > 10000)) return invalid('notes');
    if ('estimatedMinutes' in input) {
      const n = input.estimatedMinutes;
      if (n !== null && (!Number.isInteger(n) || n! < 1 || n! > 10080)) return invalid('estimatedMinutes');
    }
    if (patch && !Object.keys(input).length) return invalid('patch');
    return null;
  }

  async function run<T>(method: Method, body: () => Result<T>): Promise<Result<T>> {
    const next = injected.get(method)?.shift();
    if (next?.kind === 'reject') throw new Error('IPC channel closed');
    if (next?.kind === 'result') return next.result;
    if (next?.kind === 'hold') await next.release;
    return structuredClone(body());
  }

  const api: ReminderApi = {
    apiVersion: '1.0.0',
    tasks: {
      list: vi.fn(() => run('tasks.list', () => ({ ok: true, data: tasks }))),
      create: vi.fn((input: CreateTask) => run('tasks.create', () => {
        const bad = checkFields(input, false);
        if (bad) return bad;
        const at = now();
        const task: Task = {
          id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
          title: input.title.trim(), notes: input.notes ?? '', status: 'pending', completedAt: null,
          priority: input.priority ?? 'normal', estimatedMinutes: input.estimatedMinutes ?? null,
          deadline: input.deadline ?? null, createdAt: at, updatedAt: at, revision: 1
        };
        tasks = [...tasks, task];
        return { ok: true, data: task };
      })),
      update: vi.fn((input: UpdateTask) => run('tasks.update', () => {
        const current = tasks.find(t => t.id === input.id);
        if (!current) return { ok: false, error: { code: 'NOT_FOUND' } };
        const bad = checkFields(input.patch, true);
        if (bad) return bad;
        if (current.revision !== input.expectedRevision) return { ok: false, error: { code: 'CONFLICT' } };
        return { ok: true, data: apply(current, input.patch) };
      }))
    },
    settings: {
      get: vi.fn(() => run('settings.get', () => ({ ok: true, data: settings }))),
      update: vi.fn((input: UpdateSettings) => run('settings.update', () => {
        if (input.expectedRevision !== settings.revision) return { ok: false, error: { code: 'CONFLICT' } };
        settings = { ...settings, ...input.patch, revision: settings.revision + 1 };
        return { ok: true, data: settings };
      }))
    }
  };

  function apply(current: Task, patch: TaskPatch): Task {
    const next: Task = { ...current, ...patch, updatedAt: now(), revision: current.revision + 1 } as Task;
    if (patch.title !== undefined) next.title = patch.title.trim();
    if (patch.status === 'completed' && current.status !== 'completed') next.completedAt = next.updatedAt;
    if (patch.status === 'pending') next.completedAt = null;
    tasks = tasks.map(t => (t.id === current.id ? next : t));
    return next;
  }

  return {
    api,
    /** Queue a failure or result for the next call to `method`. */
    inject(method: Method, value: Result<never> | 'reject') {
      const list = injected.get(method) ?? [];
      list.push(value === 'reject' ? { kind: 'reject' } : { kind: 'result', result: value });
      injected.set(method, list);
    },
    /** Make the next call to `method` wait until the returned function is called. */
    hold(method: Method): () => void {
      let release!: () => void;
      const list = injected.get(method) ?? [];
      list.push({ kind: 'hold', release: new Promise<void>(r => { release = r; }) });
      injected.set(method, list);
      return () => release();
    },
    /** Simulate a write from elsewhere (another window/device) that bumps the revision. */
    externalEdit(id: string, patch: TaskPatch) {
      const current = tasks.find(t => t.id === id)!;
      return apply(current, patch);
    },
    externalSettings(patch: Partial<Omit<Settings, 'revision'>>) {
      settings = { ...settings, ...patch, revision: settings.revision + 1 };
    },
    get tasks() { return tasks; },
    get settings() { return settings; }
  };
}

export type FakeApi = ReturnType<typeof createFakeApi>;

export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: '00000000-0000-4000-8000-0000000000aa', title: 'Existing task', notes: '', status: 'pending',
    completedAt: null, priority: 'normal', estimatedMinutes: null, deadline: null,
    createdAt: '2026-10-30T10:00:00.000Z', updatedAt: '2026-10-30T10:00:00.000Z', revision: 1, ...overrides
  };
}
