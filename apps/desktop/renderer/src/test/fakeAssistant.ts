// TEST FIXTURE ONLY. A scripted AssistantApi that follows docs/api-v1.md "Assistant v1" shapes.
// It never calls a model; each test queues the reply the real service would produce. Not bundled.
import { vi } from 'vitest';
import type {
  AssistantApi, AssistantConfig, AssistantInput, AssistantReply, AssistantResult, ConfigureAssistant
} from '../api/contract';
import type { FakeApi } from './fakeApi';

type SubmitHandler = (input: AssistantInput) => AssistantResult<AssistantReply> | 'reject' | Promise<AssistantResult<AssistantReply> | 'reject'>;
type UndoHandler = (input: { requestId: string }) => AssistantResult<AssistantReply> | 'reject' | Promise<AssistantResult<AssistantReply> | 'reject'>;
type ConfigOutcome = AssistantResult<AssistantConfig> | 'reject';

export function reply(input: Pick<AssistantInput, 'requestId'>, overrides: Partial<AssistantReply> = {}): AssistantReply {
  return {
    requestId: input.requestId, conversationId: 'conv-1', language: 'en-US', outcome: 'applied',
    message: '', changes: [], undoAvailable: false, ...overrides
  };
}

export function createFakeAssistant(initial: Partial<AssistantConfig> = {}) {
  let config: AssistantConfig = { provider: 'deepseek', model: 'deepseek-flash', hasKey: false, ...initial };
  const submits: SubmitHandler[] = [];
  const undos: UndoHandler[] = [];
  const configFailures: ConfigOutcome[] = [];
  const getConfigFailures: ConfigOutcome[] = [];
  /** Keys received by configure; tests assert they never leak elsewhere. */
  const receivedKeys: string[] = [];

  const unwrap = async <T>(value: T | 'reject' | Promise<T | 'reject'>): Promise<T> => {
    const resolved = await value;
    if (resolved === 'reject') throw new Error('IPC channel closed');
    return structuredClone(resolved);
  };

  const assistant: AssistantApi = {
    apiVersion: '1.0.0',
    getConfig: vi.fn(async () => unwrap(getConfigFailures.shift() ?? { ok: true as const, data: config })),
    configure: vi.fn(async (input: ConfigureAssistant) => {
      const injected = configFailures.shift();
      if (injected) return unwrap(injected);
      if (input.apiKey !== undefined) receivedKeys.push(input.apiKey);
      config = {
        ...config,
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.apiKey !== undefined ? { hasKey: true } : {}),
        ...(input.clearKey ? { hasKey: false } : {})
      };
      return { ok: true as const, data: structuredClone(config) };
    }),
    submit: vi.fn(async (input: AssistantInput) => {
      const handler = submits.shift();
      if (!handler) throw new Error('fakeAssistant: no submit handler queued');
      return unwrap(handler(input));
    }),
    undo: vi.fn(async (input: { requestId: string }) => {
      const handler = undos.shift();
      if (!handler) throw new Error('fakeAssistant: no undo handler queued');
      return unwrap(handler(input));
    })
  };

  return {
    assistant,
    onSubmit(handler: SubmitHandler) { submits.push(handler); },
    onUndo(handler: UndoHandler) { undos.push(handler); },
    failConfigure(outcome: ConfigOutcome) { configFailures.push(outcome); },
    failGetConfig(outcome: ConfigOutcome) { getConfigFailures.push(outcome); },
    get config() { return config; },
    receivedKeys
  };
}

export type FakeAssistant = ReturnType<typeof createFakeAssistant>;

/** Attach an assistant to a manual fake API, as a REM-002 bridge would. */
export function withAssistant(fake: FakeApi, assistant: FakeAssistant) {
  (fake.api as { assistant?: AssistantApi }).assistant = assistant.assistant;
  return fake;
}

