/** Reminder API v1.0.0. Owner: Codex. IPC data is plain JSON. */
export type Locale = 'en-US' | 'zh-CN';
export type Priority = 'low' | 'normal' | 'high';
export type TaskStatus = 'pending' | 'completed';
export type Deadline =
  | { kind: 'date'; date: string; timeZone: string }
  | { kind: 'instant'; at: string; timeZone: string };
export interface Task {
  id: string;
  title: string;
  notes: string;
  status: TaskStatus;
  completedAt: string | null;
  priority: Priority;
  estimatedMinutes: number | null;
  deadline: Deadline | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
}
export interface CreateTask {
  title: string;
  notes?: string;
  priority?: Priority;
  estimatedMinutes?: number | null;
  deadline?: Deadline | null;
}
export interface TaskPatch extends Partial<CreateTask> { status?: TaskStatus }
export interface UpdateTask { id: string; expectedRevision: number; patch: TaskPatch }
export interface Settings { locale: Locale; timeZone: string; revision: number }
export interface UpdateSettings {
  expectedRevision: number;
  patch: { locale?: Locale; timeZone?: string };
}
export type ErrorCode = 'VALIDATION_ERROR' | 'NOT_FOUND' | 'CONFLICT' |
  'UNKNOWN_METHOD' | 'STORAGE_ERROR' | 'FORBIDDEN';
export type Result<T> = { ok: true; data: T } |
  { ok: false; error: { code: ErrorCode; field?: string } };
export interface ReminderApi {
  readonly apiVersion: '1.0.0';
  tasks: {
    list(): Promise<Result<Task[]>>;
    create(input: CreateTask): Promise<Result<Task>>;
    update(input: UpdateTask): Promise<Result<Task>>;
  };
  settings: {
    get(): Promise<Result<Settings>>;
    update(input: UpdateSettings): Promise<Result<Settings>>;
  };
}
declare global { interface Window { reminder: ReminderApi } }
