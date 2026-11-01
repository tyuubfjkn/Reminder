// REM-002-FE assistant UI tests. All assistant behavior here comes from the scripted TEST FIXTURE in
// src/test/fakeAssistant.ts; these are mock tests, not evidence of the real service or DeepSeek.
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import type { Settings, Task } from './api/contract';
import { createFakeApi, makeTask } from './test/fakeApi';
import { createFakeAssistant, reply, withAssistant, type FakeAssistant } from './test/fakeAssistant';
import { useAssistant } from './useAssistant';

let ids = 0;
beforeEach(() => {
  ids = 0;
  vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => `00000000-0000-4000-a000-${String(++ids).padStart(12, '0')}` as `${string}-${string}-${string}-${string}-${string}`);
});
afterEach(() => vi.restoreAllMocks());
const id = (n: number) => `00000000-0000-4000-a000-${String(n).padStart(12, '0')}`;

function setup(opts: { config?: Parameters<typeof createFakeAssistant>[0]; settings?: Partial<Settings>; tasks?: Task[]; assistant?: boolean } = {}) {
  const fake = createFakeApi({ settings: opts.settings, tasks: opts.tasks });
  const ai = createFakeAssistant({ hasKey: true, ...opts.config });
  if (opts.assistant !== false) withAssistant(fake, ai);
  const user = userEvent.setup();
  render(<App api={fake.api} />);
  return { fake, ai, user };
}

async function openAssistant(user: ReturnType<typeof userEvent.setup>, name = 'Assistant') {
  await user.click(await screen.findByRole('button', { name }));
}

async function send(user: ReturnType<typeof userEvent.setup>, text: string, labels = { message: 'Message', send: 'Send' }) {
  const box = screen.getByRole('textbox', { name: labels.message });
  await user.clear(box);
  await user.type(box, text);
  await user.click(screen.getByRole('button', { name: labels.send }));
}

const conversation = () => screen.getByRole('list', { name: /Conversation|对话/ });

describe('feature detection', () => {
  it('keeps the manual app unchanged when the bridge has no assistant', async () => {
    setup({ assistant: false });
    await screen.findByRole('heading', { name: 'No tasks yet' });
    expect(screen.queryByRole('button', { name: 'Assistant' })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByText('The assistant isn’t available in this version of Reminder.')).toBeInTheDocument();
  });

  it('shows the Assistant view when the capability is present', async () => {
    const { user } = setup();
    await openAssistant(user);
    expect(screen.getByRole('heading', { name: 'Assistant' })).toBeInTheDocument();
    expect(screen.getByText(/sent to DeepSeek/)).toHaveTextContent('not notes');
  });

  it('asks for a key before use and links to Settings', async () => {
    const { user } = setup({ config: { hasKey: false } });
    await openAssistant(user);
    expect(screen.getByText('Add your DeepSeek API key in Settings to use the assistant.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Message' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open Settings' }));
    expect(screen.getByRole('heading', { name: 'AI assistant (DeepSeek)' })).toBeInTheDocument();
  });
});

describe('AI settings', () => {
  async function openAiSettings(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: 'Settings' }));
    return screen.getByRole('region', { name: 'AI assistant (DeepSeek)' });
  }

  it('saves a key write-only and clears the field after success', async () => {
    const { ai, user } = setup({ config: { hasKey: false } });
    const section = await openAiSettings(user);
    expect(section).toHaveTextContent('API key: not set');
    expect(section).toHaveTextContent('Model: deepseek-flash');
    const key = within(section).getByLabelText('DeepSeek API key');
    expect(key).toHaveAttribute('type', 'password');
    expect(key).toHaveAttribute('autocomplete', 'off');
    await user.type(key, 'sk-test-not-a-real-key');
    await user.click(within(section).getByRole('button', { name: 'Save key' }));
    await waitFor(() => expect(section).toHaveTextContent('API key: saved'));
    expect(ai.assistant.configure).toHaveBeenCalledWith({ apiKey: 'sk-test-not-a-real-key' });
    expect(within(section).getByLabelText('Replace API key')).toHaveValue('');
    expect(document.body.innerHTML).not.toContain('sk-test-not-a-real-key');
    expect(JSON.stringify(window.localStorage)).not.toContain('sk-test');
  });

  it('keeps the typed key and explains when secure storage is unavailable', async () => {
    const { ai, user } = setup({ config: { hasKey: false } });
    ai.failConfigure({ ok: false, error: { code: 'AI_SECURE_STORAGE_UNAVAILABLE' } });
    const section = await openAiSettings(user);
    await user.type(within(section).getByLabelText('DeepSeek API key'), 'sk-x');
    await user.click(within(section).getByRole('button', { name: 'Save key' }));
    expect(await within(section).findByRole('alert')).toHaveTextContent('Windows secure storage isn’t available');
    expect(within(section).getByLabelText('DeepSeek API key')).toHaveValue('sk-x');
    expect(section).toHaveTextContent('API key: not set');
  });

  it('replaces and removes a key, and saves the model', async () => {
    const { ai, user } = setup();
    const section = await openAiSettings(user);
    expect(section).toHaveTextContent('API key: saved');
    await user.type(within(section).getByLabelText('Replace API key'), 'sk-new');
    await user.click(within(section).getByRole('button', { name: 'Save key' }));
    await waitFor(() => expect(ai.assistant.configure).toHaveBeenLastCalledWith({ apiKey: 'sk-new' }));
    await user.clear(within(section).getByRole('textbox', { name: 'Model' }));
    await user.type(within(section).getByRole('textbox', { name: 'Model' }), 'deepseek-chat');
    await user.click(within(section).getByRole('button', { name: 'Save model' }));
    await waitFor(() => expect(section).toHaveTextContent('Model: deepseek-chat'));
    await user.click(within(section).getByRole('button', { name: 'Remove key' }));
    await waitFor(() => expect(section).toHaveTextContent('API key: not set'));
    expect(ai.assistant.configure).toHaveBeenLastCalledWith({ clearKey: true });
  });

  it('reports an unreadable config without affecting tasks and still allows removing the key', async () => {
    const fake = createFakeApi({ tasks: [makeTask({ title: 'Still here' })] });
    const ai = createFakeAssistant({ hasKey: true });
    ai.failGetConfig({ ok: false, error: { code: 'AI_CONFIG_ERROR' } });
    withAssistant(fake, ai);
    const user = userEvent.setup();
    render(<App api={fake.api} />);
    expect(await screen.findByText('Still here', { selector: '.task-title' })).toBeInTheDocument();
    const section = await openAiSettings(user);
    expect(within(section).getByRole('alert')).toHaveTextContent('saved assistant settings can’t be read');
    await user.click(within(section).getByRole('button', { name: 'Remove key' }));
    await waitFor(() => expect(section).toHaveTextContent('API key: not set'));
  });

  it('localizes AI settings in zh-CN', async () => {
    const { user } = setup({ settings: { locale: 'zh-CN' }, config: { hasKey: false } });
    await user.click(await screen.findByRole('button', { name: '设置' }));
    const section = screen.getByRole('region', { name: 'AI 助手（DeepSeek）' });
    expect(section).toHaveTextContent('API 密钥：未设置');
    expect(within(section).getByLabelText('DeepSeek API 密钥')).toBeInTheDocument();
  });
});

describe('sending messages', () => {
  it('applies changes, shows a receipt from the reply and reloads the task list', async () => {
    const { fake, ai, user } = setup();
    ai.onSubmit(input => {
      const task = fake.externalCreate('Finish my essay');
      return { ok: true, data: reply(input, {
        message: 'Created 1 task.', changes: [{ kind: 'created', taskId: task.id, title: task.title }], undoAvailable: true
      }) };
    });
    await openAssistant(user);
    await send(user, 'Finish my essay by Friday. It should take about three hours.');
    expect(ai.assistant.submit).toHaveBeenCalledWith({ requestId: id(1), text: 'Finish my essay by Friday. It should take about three hours.' });
    const receipt = await within(conversation()).findByText('Created 1 task.');
    expect(receipt.closest('li')).toHaveTextContent('Created: Finish my essay');
    expect(receipt.closest('li')).toHaveTextContent('Changes saved');
    expect(fake.api.tasks.list).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Tasks' }));
    expect(screen.getByText('Finish my essay', { selector: '.task-title' })).toBeInTheDocument();
  });

  it('sends follow-ups with the returned conversationId and a new requestId', async () => {
    const { ai, user } = setup();
    ai.onSubmit(input => ({ ok: true, data: reply(input, { conversationId: 'conv-9', outcome: 'unsupported', message: 'I can’t set reminders yet.' }) }));
    ai.onSubmit(input => ({ ok: true, data: reply(input, { conversationId: 'conv-9', outcome: 'unsupported', message: 'Still no.' }) }));
    await openAssistant(user);
    await send(user, 'Remind me at 5');
    await within(conversation()).findByText('I can’t set reminders yet.');
    await send(user, 'Please?');
    await within(conversation()).findByText('Still no.');
    expect(ai.assistant.submit).toHaveBeenLastCalledWith({ requestId: id(2), text: 'Please?', conversationId: 'conv-9' });
  });

  it('labels unsupported and clarification replies as making no changes and does not reload tasks', async () => {
    const { fake, ai, user } = setup();
    ai.onSubmit(input => ({ ok: true, data: reply(input, { outcome: 'unsupported', message: 'Reminders aren’t available yet.' }) }));
    await openAssistant(user);
    await send(user, 'Remind me tomorrow');
    const entry = (await within(conversation()).findByText('Reminders aren’t available yet.')).closest('li')!;
    expect(entry).toHaveTextContent('No changes made');
    expect(fake.api.tasks.list).toHaveBeenCalledTimes(1);
  });

  it('prevents duplicate sends while a request is in flight', async () => {
    const { ai, user } = setup();
    let release!: () => void;
    ai.onSubmit(input => new Promise(r => { release = () => r({ ok: true, data: reply(input, { outcome: 'unsupported', message: 'Done.' }) }); }));
    await openAssistant(user);
    await send(user, 'Hello');
    const sending = screen.getByRole('button', { name: 'Sending…' });
    expect(sending).toBeDisabled();
    await user.click(sending);
    await user.keyboard('{Control>}{Enter}{/Control}');
    release();
    await within(conversation()).findByText('Done.');
    expect(ai.assistant.submit).toHaveBeenCalledTimes(1);
  });

  it('keeps the text after a failure and retries with the identical requestId and input', async () => {
    const { ai, user } = setup();
    ai.onSubmit(() => 'reject');
    ai.onSubmit(() => ({ ok: false, error: { code: 'AI_TIMEOUT' } }));
    ai.onSubmit(input => ({ ok: true, data: reply(input, { outcome: 'unsupported', message: 'OK.' }) }));
    await openAssistant(user);
    await send(user, 'Plan my week');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Reminder couldn’t confirm the result. Try again; it won’t be applied twice.');
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Plan my week');
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('DeepSeek didn’t respond in time. No changes were made.');
    // Pressing Send with the unchanged text is the same request, not a new one.
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await within(conversation()).findByText('OK.');
    const calls = vi.mocked(ai.assistant.submit).mock.calls.map(c => c[0]);
    expect(calls).toEqual([
      { requestId: id(1), text: 'Plan my week' },
      { requestId: id(1), text: 'Plan my week' },
      { requestId: id(1), text: 'Plan my week' }
    ]);
    expect(within(conversation()).getAllByText('Plan my week')).toHaveLength(1);
  });

  it('uses a new requestId when the text is edited after a failure', async () => {
    const { ai, user } = setup();
    ai.onSubmit(() => ({ ok: false, error: { code: 'AI_RATE_LIMITED' } }));
    ai.onSubmit(input => ({ ok: true, data: reply(input, { outcome: 'unsupported', message: 'OK.' }) }));
    await openAssistant(user);
    await send(user, 'Plan my week');
    expect(await screen.findByRole('alert')).toHaveTextContent('DeepSeek is limiting requests right now.');
    await send(user, 'Plan my weekend');
    await within(conversation()).findByText('OK.');
    expect(ai.assistant.submit).toHaveBeenLastCalledWith({ requestId: id(2), text: 'Plan my weekend' });
  });

  it('rejects an over-long message locally', async () => {
    const { ai, user } = setup();
    await openAssistant(user);
    const box = screen.getByRole('textbox', { name: 'Message' });
    await user.click(box);
    await user.paste('x'.repeat(4001));
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByText('Messages can be up to 4,000 characters.')).toBeInTheDocument();
    expect(ai.assistant.submit).not.toHaveBeenCalled();
  });

  it('requires an explicit new conversation after expiry and keeps the text', async () => {
    const { ai, user } = setup();
    ai.onSubmit(input => ({ ok: true, data: reply(input, { conversationId: 'conv-old', outcome: 'unsupported', message: 'First.' }) }));
    ai.onSubmit(() => ({ ok: false, error: { code: 'AI_CONVERSATION_EXPIRED' } }));
    ai.onSubmit(input => ({ ok: true, data: reply(input, { conversationId: 'conv-new', outcome: 'unsupported', message: 'Fresh.' }) }));
    await openAssistant(user);
    await send(user, 'One');
    await within(conversation()).findByText('First.');
    await send(user, 'Two');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('This conversation expired.');
    expect(within(alert).queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Two');
    await user.click(within(alert).getByRole('button', { name: 'New conversation' }));
    expect(within(conversation()).queryByText('First.')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Two');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await within(conversation()).findByText('Fresh.');
    expect(ai.assistant.submit).toHaveBeenLastCalledWith({ requestId: id(3), text: 'Two' });
  });

  it('says so when changes were saved but the task list reload fails', async () => {
    const { fake, ai, user } = setup();
    ai.onSubmit(input => {
      const task = fake.externalCreate('Lab report');
      return { ok: true, data: reply(input, { message: 'Created 1 task.', changes: [{ kind: 'created', taskId: task.id, title: task.title }], undoAvailable: true }) };
    });
    await openAssistant(user);
    fake.inject('tasks.list', { ok: false, error: { code: 'STORAGE_ERROR' } });
    await send(user, 'Lab report due Monday');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The changes were saved, but the task list couldn’t be refreshed.');
    await user.click(within(alert).getByRole('button', { name: 'Reload tasks' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Tasks' }));
    expect(screen.getByText('Lab report', { selector: '.task-title' })).toBeInTheDocument();
  });

  it('notes a replayed receipt and still reloads instead of using receipt data', async () => {
    const { fake, ai, user } = setup({ tasks: [makeTask({ title: 'Renamed later' })] });
    ai.onSubmit(input => ({ ok: true, data: reply(input, {
      message: 'Updated 1 task.', replayed: true, changes: [{ kind: 'updated', taskId: makeTask().id, title: 'Old title' }]
    }) }));
    await openAssistant(user);
    await send(user, 'Rename it');
    const entry = (await within(conversation()).findByText('Updated 1 task.')).closest('li')!;
    expect(entry).toHaveTextContent('Already processed earlier; this is the saved result.');
    await waitFor(() => expect(fake.api.tasks.list).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole('button', { name: 'Tasks' }));
    expect(screen.getByText('Renamed later', { selector: '.task-title' })).toBeInTheDocument();
    expect(screen.queryByText('Old title', { selector: '.task-title' })).not.toBeInTheDocument();
  });
});

describe('clarifications', () => {
  const twins = [
    makeTask({ id: '00000000-0000-4000-8000-0000000000a1', title: 'Essay', deadline: { kind: 'date', date: '2026-11-06', timeZone: 'Europe/London' } }),
    makeTask({ id: '00000000-0000-4000-8000-0000000000a2', title: 'Essay', status: 'completed', completedAt: '2026-10-30T12:00:00.000Z' })
  ];

  it('sends the chosen task with a short text answer and a new requestId', async () => {
    const { ai, user } = setup({ tasks: twins });
    ai.onSubmit(input => ({ ok: true, data: reply(input, {
      outcome: 'clarification', message: 'Which “Essay” do you mean?',
      choices: { kind: 'task', tasks: twins.map(t => ({ id: t.id, title: t.title, status: t.status, deadline: t.deadline })) }
    }) }));
    ai.onSubmit(input => ({ ok: true, data: reply(input, { message: 'Completed 1 task.', changes: [{ kind: 'updated', taskId: twins[0].id, title: 'Essay' }], undoAvailable: true }) }));
    await openAssistant(user);
    await send(user, 'I finished my essay');
    const entry = (await within(conversation()).findByText('Which “Essay” do you mean?')).closest('li')!;
    expect(entry).toHaveTextContent('No changes made');
    const first = within(entry).getByRole('button', { name: /Essay.*Not completed.*Due Fri, Nov 6, 2026/ });
    expect(within(entry).getByRole('button', { name: /Essay.*Completed/ })).toBeInTheDocument();
    await user.click(first);
    await within(conversation()).findByText('Completed 1 task.');
    expect(ai.assistant.submit).toHaveBeenLastCalledWith({
      requestId: id(2), text: 'Essay', conversationId: 'conv-1', choice: { taskId: twins[0].id }
    });
    // Choices from an answered clarification can't be sent again.
    expect(within(entry).getByRole('button', { name: /Essay.*Not completed/ })).toBeDisabled();
  });

  it('shows DST occurrence choices with UTC offsets and zone and sends the selected occurrence', async () => {
    const { ai, user } = setup({ settings: { timeZone: 'America/New_York' } });
    ai.onSubmit(input => ({ ok: true, data: reply(input, {
      outcome: 'clarification', message: '1:30 AM happens twice that night. Which one?',
      choices: { kind: 'occurrence', earlier: '2027-11-07T05:30:00.000Z', later: '2027-11-07T06:30:00.000Z', timeZone: 'America/New_York' }
    }) }));
    ai.onSubmit(input => ({ ok: true, data: reply(input, { outcome: 'unsupported', message: 'Thanks.' }) }));
    await openAssistant(user);
    await send(user, 'Exam on Nov 7 2027 at 1:30am');
    const entry = (await within(conversation()).findByText(/happens twice/)).closest('li')!;
    expect(within(entry).getByRole('button', { name: /First.*1:30\sAM.*GMT-4.*America\/New_York/ })).toBeInTheDocument();
    await user.click(within(entry).getByRole('button', { name: /Second.*1:30\sAM.*GMT-5.*America\/New_York/ }));
    await within(conversation()).findByText('Thanks.');
    expect(ai.assistant.submit).toHaveBeenLastCalledWith({
      requestId: id(2), text: 'Second (GMT-5)', conversationId: 'conv-1', choice: { occurrence: 'later' }
    });
  });

  it('disables older clarification choices once a newer reply arrives', async () => {
    const { ai, user } = setup({ tasks: twins });
    ai.onSubmit(input => ({ ok: true, data: reply(input, {
      outcome: 'clarification', message: 'Which one?',
      choices: { kind: 'task', tasks: twins.map(t => ({ id: t.id, title: t.title, status: t.status, deadline: t.deadline })) }
    }) }));
    ai.onSubmit(input => ({ ok: true, data: reply(input, { outcome: 'unsupported', message: 'Never mind then.' }) }));
    await openAssistant(user);
    await send(user, 'Finish essay');
    const entry = (await within(conversation()).findByText('Which one?')).closest('li')!;
    await send(user, 'Actually forget it');
    await within(conversation()).findByText('Never mind then.');
    for (const button of within(entry).getAllByRole('button')) expect(button).toBeDisabled();
  });
});

describe('batch Undo', () => {
  function appliedOnce(fake: ReturnType<typeof createFakeApi>, ai: FakeAssistant) {
    let created: Task;
    ai.onSubmit(input => {
      created = fake.externalCreate('Vocabulary');
      return { ok: true, data: reply(input, { message: 'Created 1 task.', changes: [{ kind: 'created', taskId: created.id, title: 'Vocabulary' }], undoAvailable: true }) };
    });
    return () => created;
  }

  it('undoes the whole batch by the original requestId and reloads tasks', async () => {
    const { fake, ai, user } = setup();
    const created = appliedOnce(fake, ai);
    ai.onUndo(input => {
      fake.externalRemove(created().id);
      return { ok: true, data: reply(input, { outcome: 'undone', message: 'Undid 1 change.', changes: [{ kind: 'removed', taskId: created().id, title: 'Vocabulary' }] }) };
    });
    await openAssistant(user);
    await send(user, 'Study vocabulary for 30 minutes');
    const entry = (await within(conversation()).findByText('Created 1 task.')).closest('li')!;
    await user.click(within(entry).getByRole('button', { name: 'Undo these changes' }));
    expect(ai.assistant.undo).toHaveBeenCalledWith({ requestId: id(1) });
    const undone = (await within(conversation()).findByText('Undid 1 change.')).closest('li')!;
    expect(undone).toHaveTextContent('Removed: Vocabulary');
    expect(within(entry).queryByRole('button', { name: 'Undo these changes' })).not.toBeInTheDocument();
    expect(entry).toHaveTextContent('Undone');
    await user.click(screen.getByRole('button', { name: 'Tasks' }));
    expect(screen.getByRole('heading', { name: 'No tasks yet' })).toBeInTheDocument();
  });

  it('on Undo CONFLICT reloads tasks and overwrites nothing', async () => {
    const { fake, ai, user } = setup();
    const created = appliedOnce(fake, ai);
    ai.onUndo(() => ({ ok: false, error: { code: 'CONFLICT' } }));
    await openAssistant(user);
    await send(user, 'Study vocabulary');
    const entry = (await within(conversation()).findByText('Created 1 task.')).closest('li')!;
    fake.externalEdit(created().id, { title: 'Vocabulary (edited)' });
    await user.click(within(entry).getByRole('button', { name: 'Undo these changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A task changed after the assistant’s update, so Undo wasn’t applied. Nothing was overwritten.');
    expect(within(entry).queryByRole('button', { name: 'Undo these changes' })).not.toBeInTheDocument();
    expect(fake.tasks).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Tasks' }));
    expect(screen.getByText('Vocabulary (edited)', { selector: '.task-title' })).toBeInTheDocument();
  });

  it('keeps Undo available after a transient Undo failure', async () => {
    const { fake, ai, user } = setup();
    appliedOnce(fake, ai);
    ai.onUndo(() => 'reject');
    ai.onUndo(input => ({ ok: true, data: reply(input, { outcome: 'undone', message: 'Undid 1 change.' }) }));
    await openAssistant(user);
    await send(user, 'Study vocabulary');
    const entry = (await within(conversation()).findByText('Created 1 task.')).closest('li')!;
    await user.click(within(entry).getByRole('button', { name: 'Undo these changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Reminder couldn’t confirm the result.');
    await user.click(within(entry).getByRole('button', { name: 'Undo these changes' }));
    await within(conversation()).findByText('Undid 1 change.');
    expect(vi.mocked(ai.assistant.undo).mock.calls).toEqual([[{ requestId: id(1) }], [{ requestId: id(1) }]]);
  });
});

describe('languages', () => {
  it('uses zh-CN UI copy while keeping the reply language and task text as returned', async () => {
    const { fake, ai, user } = setup({ settings: { locale: 'zh-CN' } });
    ai.onSubmit(input => {
      const task = fake.externalCreate('Finish my essay');
      return { ok: true, data: reply(input, { language: 'en-US', message: 'Created 1 task.', changes: [{ kind: 'created', taskId: task.id, title: task.title }], undoAvailable: true }) };
    });
    await openAssistant(user, '助手');
    await send(user, 'Finish my essay by Friday', { message: '消息', send: '发送' });
    const message = await within(conversation()).findByText('Created 1 task.');
    expect(message).toHaveAttribute('lang', 'en-US');
    const entry = message.closest('li')!;
    expect(entry).toHaveTextContent('已保存更改');
    expect(entry).toHaveTextContent('已创建：Finish my essay');
    expect(within(entry).getByRole('button', { name: '撤销这些更改' })).toBeInTheDocument();
  });

  it('localizes assistant errors in zh-CN', async () => {
    const { ai, user } = setup({ settings: { locale: 'zh-CN' } });
    ai.onSubmit(() => ({ ok: false, error: { code: 'AI_AUTH_ERROR' } }));
    await openAssistant(user, '助手');
    await send(user, '数学作业周五交', { message: '消息', send: '发送' });
    expect(await screen.findByRole('alert')).toHaveTextContent('DeepSeek 拒绝了此 API 密钥');
    expect(screen.getByRole('textbox', { name: '消息' })).toHaveValue('数学作业周五交');
  });
});

describe('PR #7 review fixes', () => {
  // P1: a structured answer whose response was lost must not let a stale choice answer an unseen later question.
  it('keeps stale choices disabled after a lost answer response and only replays the identical answer', async () => {
    const { fake, ai, user } = setup({ settings: { timeZone: 'America/New_York' } });
    const q1 = { kind: 'occurrence' as const, earlier: '2027-11-07T05:30:00.000Z', later: '2027-11-07T06:30:00.000Z', timeZone: 'America/New_York' };
    const q2 = { kind: 'occurrence' as const, earlier: '2028-11-05T05:15:00.000Z', later: '2028-11-05T06:15:00.000Z', timeZone: 'America/New_York' };
    // Fixture models the service: answering question one advances to question two, but that response is lost.
    ai.onSubmit(input => ({ ok: true, data: reply(input, { outcome: 'clarification', message: 'Question one: which 1:30?', choices: q1 }) }));
    ai.onSubmit(() => 'reject');
    ai.onSubmit(input => ({ ok: true, data: reply(input, { outcome: 'clarification', message: 'Question two: which 1:15?', choices: q2, replayed: true }) }));
    ai.onSubmit(input => {
      fake.externalCreate('Exam');
      fake.externalCreate('Lab');
      return { ok: true, data: reply(input, { message: 'Created 2 tasks.', undoAvailable: true }) };
    });
    await openAssistant(user);
    await send(user, 'Exam 2027-11-07 1:30am and lab 2028-11-05 1:15am');
    const one = (await within(conversation()).findByText('Question one: which 1:30?')).closest('li')!;
    await user.click(within(one).getByRole('button', { name: /Second.*GMT-5/ }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Reminder couldn’t confirm the result.');
    for (const button of within(one).getAllByRole('button')) expect(button).toBeDisabled();
    await user.click(within(one).getByRole('button', { name: /First.*GMT-4/ }));
    expect(ai.assistant.submit).toHaveBeenCalledTimes(2);

    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    const two = (await within(conversation()).findByText('Question two: which 1:15?')).closest('li')!;
    for (const button of within(one).getAllByRole('button')) expect(button).toBeDisabled();
    expect(fake.tasks).toHaveLength(0);
    await user.click(within(two).getByRole('button', { name: /First.*GMT-4/ }));
    await within(conversation()).findByText('Created 2 tasks.');

    const calls = vi.mocked(ai.assistant.submit).mock.calls.map(c => c[0]);
    expect(calls).toEqual([
      { requestId: id(1), text: 'Exam 2027-11-07 1:30am and lab 2028-11-05 1:15am' },
      { requestId: id(2), text: 'Second (GMT-5)', conversationId: 'conv-1', choice: { occurrence: 'later' } },
      { requestId: id(2), text: 'Second (GMT-5)', conversationId: 'conv-1', choice: { occurrence: 'later' } },
      { requestId: id(3), text: 'First (GMT-4)', conversationId: 'conv-1', choice: { occurrence: 'earlier' } }
    ]);
    expect(fake.tasks).toHaveLength(2);
  });

  it('disables the other stale choice in the UI after a failed answer', async () => {
    const { ai, user } = setup();
    ai.onSubmit(input => ({ ok: true, data: reply(input, { outcome: 'clarification', message: 'Which one?',
      choices: { kind: 'task', tasks: [{ id: 'a', title: 'A', status: 'pending', deadline: null }, { id: 'b', title: 'B', status: 'pending', deadline: null }] } }) }));
    ai.onSubmit(() => ({ ok: false, error: { code: 'AI_TIMEOUT' } }));
    await openAssistant(user);
    await send(user, 'Finish it');
    const entry = (await within(conversation()).findByText('Which one?')).closest('li')!;
    await user.click(within(entry).getByRole('button', { name: /^A ·/ }));
    await screen.findByRole('alert');
    expect(within(entry).getByRole('button', { name: /^B ·/ })).toBeDisabled();
    expect(ai.assistant.submit).toHaveBeenCalledTimes(2);
  });

  it('refuses a new structured answer in the hook itself while a failed answer is unresolved', async () => {
    const ai = createFakeAssistant({ hasKey: true });
    ai.onSubmit(input => ({ ok: true, data: reply(input, { outcome: 'clarification', message: 'Which one?',
      choices: { kind: 'task', tasks: [{ id: 'a', title: 'A', status: 'pending', deadline: null }, { id: 'b', title: 'B', status: 'pending', deadline: null }] } }) }));
    ai.onSubmit(() => 'reject');
    ai.onSubmit(input => ({ ok: true, data: reply(input, { outcome: 'clarification', message: 'Next question.' }) }));
    const { result } = renderHook(() => useAssistant(ai.assistant, async () => true));
    await act(() => result.current.send('Finish it'));
    await act(() => result.current.answer('A', { taskId: 'a' }));
    expect(result.current.pending?.phase).toBe('failed');
    // A different (stale) choice must not go out under a new requestId.
    await act(() => result.current.answer('B', { taskId: 'b' }));
    expect(ai.assistant.submit).toHaveBeenCalledTimes(2);
    // The identical retry is the only way forward.
    await act(() => result.current.retry());
    expect(vi.mocked(ai.assistant.submit).mock.calls.map(c => c[0])).toEqual([
      { requestId: id(1), text: 'Finish it' },
      { requestId: id(2), text: 'A', conversationId: 'conv-1', choice: { taskId: 'a' } },
      { requestId: id(2), text: 'A', conversationId: 'conv-1', choice: { taskId: 'a' } }
    ]);
    expect(result.current.pending).toBeNull();
  });

  // P2: whitespace around a successful message must not leave it in the composer for a duplicate send.
  it('clears whitespace-padded input after a successful send so it cannot be sent twice', async () => {
    const { fake, ai, user } = setup();
    ai.onSubmit(input => {
      const task = fake.externalCreate('Math');
      return { ok: true, data: reply(input, { message: 'Created 1 task.', changes: [{ kind: 'created', taskId: task.id, title: 'Math' }], undoAvailable: true }) };
    });
    await openAssistant(user);
    const box = screen.getByRole('textbox', { name: 'Message' });
    await user.click(box);
    await user.paste('  Add Math  ');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await within(conversation()).findByText('Created 1 task.');
    expect(ai.assistant.submit).toHaveBeenCalledWith({ requestId: id(1), text: 'Add Math' });
    expect(box).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(ai.assistant.submit).toHaveBeenCalledTimes(1);
    expect(fake.tasks).toHaveLength(1);
  });

  it('treats whitespace-only differences after a failure as the same request', async () => {
    const { ai, user } = setup();
    ai.onSubmit(() => 'reject');
    ai.onSubmit(input => ({ ok: true, data: reply(input, { outcome: 'unsupported', message: 'OK.' }) }));
    await openAssistant(user);
    const box = screen.getByRole('textbox', { name: 'Message' });
    await user.click(box);
    await user.paste('  Add Math');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByRole('alert');
    await user.type(box, '  ');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await within(conversation()).findByText('OK.');
    expect(vi.mocked(ai.assistant.submit).mock.calls.map(c => c[0].requestId)).toEqual([id(1), id(1)]);
    expect(box).toHaveValue('');
  });

  // Minor: removing the key gates new submissions only; history and local Undo stay usable.
  it('keeps conversation history and Undo after the key is removed', async () => {
    const { fake, ai, user } = setup();
    ai.onSubmit(input => {
      const task = fake.externalCreate('Vocabulary');
      return { ok: true, data: reply(input, { message: 'Created 1 task.', changes: [{ kind: 'created', taskId: task.id, title: 'Vocabulary' }], undoAvailable: true }) };
    });
    ai.onUndo(input => ({ ok: true, data: reply(input, { outcome: 'undone', message: 'Undid 1 change.' }) }));
    await openAssistant(user);
    await send(user, 'Study vocabulary');
    await within(conversation()).findByText('Created 1 task.');
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('button', { name: 'Remove key' }));
    await waitFor(() => expect(ai.config.hasKey).toBe(false));
    await user.click(screen.getByRole('button', { name: 'Assistant' }));
    expect(screen.getByText('Add your DeepSeek API key in Settings to use the assistant.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Message' })).not.toBeInTheDocument();
    const entry = within(conversation()).getByText('Created 1 task.').closest('li')!;
    await user.click(within(entry).getByRole('button', { name: 'Undo these changes' }));
    await within(conversation()).findByText('Undid 1 change.');
  });
});
