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
  /** Additive REM-002 capability. Older manual-only builds may omit it. */
  assistant?: AssistantApi;
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

export type AssistantErrorCode = ErrorCode | 'AI_NOT_CONFIGURED' | 'AI_CONFIG_ERROR' |
  'AI_SECURE_STORAGE_UNAVAILABLE' | 'AI_AUTH_ERROR' | 'AI_RATE_LIMITED' |
  'AI_UNAVAILABLE' | 'AI_TIMEOUT' | 'AI_INVALID_RESPONSE' | 'AI_CONTEXT_LIMIT' |
  'AI_CONVERSATION_EXPIRED' | 'AI_BUSY';
export type AssistantResult<T> = { ok: true; data: T } |
  { ok: false; error: { code: AssistantErrorCode; field?: string } };
export interface AssistantConfig { provider: 'deepseek'; model: string; hasKey: boolean }
export interface ConfigureAssistant { model?: string; apiKey?: string; clearKey?: boolean }
export interface AssistantInput {
  requestId: string;
  text: string;
  conversationId?: string;
  choice?: { taskId?: string; occurrence?: 'earlier' | 'later' };
}
export interface AssistantChange { kind: 'created' | 'updated' | 'removed' | 'restored'; taskId: string; title: string }
export type AssistantChoices =
  | { kind: 'task'; tasks: Array<{ id: string; title: string; status: TaskStatus; deadline: Deadline | null }> }
  | { kind: 'occurrence'; earlier: string; later: string; timeZone: string };
export interface AssistantReply {
  requestId: string;
  conversationId: string;
  language: Locale;
  outcome: 'applied' | 'clarification' | 'unsupported' | 'undone';
  message: string;
  changes: AssistantChange[];
  undoAvailable: boolean;
  choices?: AssistantChoices;
  replayed?: boolean;
}
export interface AssistantApi {
  readonly apiVersion: '1.0.0';
  getConfig(): Promise<AssistantResult<AssistantConfig>>;
  configure(input: ConfigureAssistant): Promise<AssistantResult<AssistantConfig>>;
  submit(input: AssistantInput): Promise<AssistantResult<AssistantReply>>;
  undo(input: { requestId: string }): Promise<AssistantResult<AssistantReply>>;
}
declare global { interface Window { reminder: ReminderApi } }
