import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { createFakeApi, makeTask, type FakeApi } from './test/fakeApi';

function setup(fake: FakeApi = createFakeApi()) {
  const user = userEvent.setup();
  render(<App api={fake.api} />);
  return { fake, user };
}

async function addTask(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.type(screen.getByRole('textbox', { name: 'Title' }), title);
  await user.click(screen.getByRole('button', { name: 'Add task' }));
}

const item = (title: string) => screen.getByText(title, { selector: '.task-title' }).closest('li')!;

describe('startup', () => {
  it('shows loading, then an English empty state from saved settings', async () => {
    const fake = createFakeApi();
    const release = fake.hold('settings.get');
    setup(fake);
    expect(screen.getByRole('status')).toHaveTextContent('Loading your tasks…');
    release();
    expect(await screen.findByRole('heading', { name: 'No tasks yet' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('en-US');
  });

  it('loads saved zh-CN preference before rendering the task UI', async () => {
    setup(createFakeApi({ settings: { locale: 'zh-CN' } }));
    expect(await screen.findByRole('heading', { name: '还没有任务' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('zh-CN');
  });

  it('shows an unavailable-storage state with retry when settings fail', async () => {
    const fake = createFakeApi();
    fake.inject('settings.get', { ok: false, error: { code: 'STORAGE_ERROR' } });
    const { user } = setup(fake);
    expect(await screen.findByRole('heading', { name: 'Reminder can’t reach your saved data' })).toBeInTheDocument();
    expect(screen.queryByText('STORAGE_ERROR')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'No tasks yet' })).toBeInTheDocument();
  });

  it('treats a rejected list call as unavailable, not as an empty list', async () => {
    const fake = createFakeApi({ tasks: [makeTask()] });
    fake.inject('tasks.list', 'reject');
    setup(fake);
    expect(await screen.findByRole('heading', { name: 'Reminder can’t reach your saved data' })).toBeInTheDocument();
    expect(screen.queryByText('No tasks yet')).not.toBeInTheDocument();
  });

  it('explains when the native bridge is missing', async () => {
    render(<App api={null} />);
    expect(await screen.findByText(/isn’t connected to Reminder’s local storage/)).toBeInTheDocument();
  });
});

describe('creating tasks', () => {
  it('creates a task with an estimate and date-only deadline and shows the saved result', async () => {
    const { fake, user } = setup();
    await screen.findByRole('heading', { name: 'No tasks yet' });
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Finish my essay');
    await user.click(screen.getByRole('button', { name: 'More details' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Estimated time (minutes)' }), '180');
    await user.click(screen.getByRole('radio', { name: 'Date only' }));
    await user.type(screen.getByLabelText('Deadline date'), '2026-11-06');
    expect(screen.queryByLabelText('Deadline time')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add task' }));

    expect(fake.api.tasks.create).toHaveBeenCalledWith({
      title: 'Finish my essay', notes: '', priority: 'normal', estimatedMinutes: 180,
      deadline: { kind: 'date', date: '2026-11-06', timeZone: 'Europe/London' }
    });
    const row = await waitFor(() => item('Finish my essay'));
    expect(row).toHaveTextContent('Due Fri, Nov 6, 2026');
    expect(row).toHaveTextContent('About 3 hr');
    expect(screen.getByRole('status')).toHaveTextContent('Added “Finish my essay”.');
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('');
  });

  it('creates an exact deadline from wall time in the settings time zone', async () => {
    const { fake, user } = setup(createFakeApi({ settings: { timeZone: 'Asia/Shanghai' } }));
    await screen.findByRole('heading', { name: 'No tasks yet' });
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Exam');
    await user.click(screen.getByRole('button', { name: 'More details' }));
    await user.click(screen.getByRole('radio', { name: 'Date and time' }));
    await user.type(screen.getByLabelText('Deadline date'), '2026-11-06');
    await user.type(screen.getByLabelText('Deadline time'), '17:00');
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    expect(fake.api.tasks.create).toHaveBeenCalledWith(expect.objectContaining({
      deadline: { kind: 'instant', at: '2026-11-06T09:00:00.000Z', timeZone: 'Asia/Shanghai' }
    }));
    expect(await screen.findByText(/Nov 6, 2026.*5:00\sPM/)).toBeInTheDocument();
  });

  it('rejects a blank title locally with localized copy and writes nothing', async () => {
    const { fake, user } = setup();
    await screen.findByRole('heading', { name: 'No tasks yet' });
    await user.type(screen.getByRole('textbox', { name: 'Title' }), '   ');
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    expect(screen.getByText('Enter a title.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveAttribute('aria-invalid', 'true');
    expect(fake.api.tasks.create).not.toHaveBeenCalled();
  });

  it('localizes the blank-title error in zh-CN', async () => {
    const { fake, user } = setup(createFakeApi({ settings: { locale: 'zh-CN' } }));
    await screen.findByRole('heading', { name: '还没有任务' });
    await user.click(screen.getByRole('button', { name: '添加任务' }));
    expect(screen.getByText('请输入标题。')).toBeInTheDocument();
    expect(fake.api.tasks.create).not.toHaveBeenCalled();
  });

  it('keeps input and shows no success when the backend call is rejected', async () => {
    const fake = createFakeApi();
    fake.inject('tasks.create', 'reject');
    const { user } = setup(fake);
    await screen.findByRole('heading', { name: 'No tasks yet' });
    await addTask(user, 'Lab report');
    expect(await screen.findByRole('alert')).toHaveTextContent('Reminder couldn’t reach its local storage. Your input is kept; try again.');
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Lab report');
    expect(screen.queryByText('Lab report', { selector: '.task-title' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Added/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    expect(await waitFor(() => item('Lab report'))).toBeInTheDocument();
  });

  it('shows a server validation error against its field', async () => {
    const fake = createFakeApi();
    fake.inject('tasks.create', { ok: false, error: { code: 'VALIDATION_ERROR', field: 'notes' } });
    const { user } = setup(fake);
    await screen.findByRole('heading', { name: 'No tasks yet' });
    await addTask(user, 'Read');
    expect(await screen.findByText('Keep notes to 10,000 characters or fewer.')).toBeInTheDocument();
  });

  it('disables the add button while a create is in flight', async () => {
    const fake = createFakeApi();
    const release = fake.hold('tasks.create');
    const { user } = setup(fake);
    await screen.findByRole('heading', { name: 'No tasks yet' });
    await addTask(user, 'Once');
    const button = screen.getByRole('button', { name: 'Adding…' });
    expect(button).toBeDisabled();
    await user.click(button);
    release();
    await waitFor(() => item('Once'));
    expect(fake.api.tasks.create).toHaveBeenCalledTimes(1);
  });

  it('renders task text as text, never HTML', async () => {
    const { user } = setup();
    await screen.findByRole('heading', { name: 'No tasks yet' });
    await addTask(user, '<b>bold</b><img src=x>');
    expect(await screen.findByText('<b>bold</b><img src=x>', { selector: '.task-title' })).toBeInTheDocument();
    expect(document.querySelector('.task-list img')).toBeNull();
  });
});

describe('editing, completing and undo', () => {
  it('edits a task and can undo the edit with the returned revision', async () => {
    const { fake, user } = setup(createFakeApi({ tasks: [makeTask({ title: 'Math homework' })] }));
    await waitFor(() => item('Math homework'));
    await user.click(within(item('Math homework')).getByRole('button', { name: 'Edit' }));
    const form = screen.getByRole('form', { name: 'Edit task' });
    await user.clear(within(form).getByRole('textbox', { name: 'Title' }));
    await user.type(within(form).getByRole('textbox', { name: 'Title' }), 'Math homework ch. 4');
    await user.click(within(form).getByRole('button', { name: 'Save changes' }));
    expect(fake.api.tasks.update).toHaveBeenLastCalledWith({
      id: makeTask().id, expectedRevision: 1, patch: { title: 'Math homework ch. 4' }
    });
    await waitFor(() => item('Math homework ch. 4'));
    await user.click(within(screen.getByRole('status')).getByRole('button', { name: 'Undo' }));
    expect(fake.api.tasks.update).toHaveBeenLastCalledWith({
      id: makeTask().id, expectedRevision: 2, patch: { title: 'Math homework' }
    });
    await waitFor(() => item('Math homework'));
    expect(screen.getByRole('status')).toHaveTextContent('Undone.');
  });

  it('closes an unchanged edit without writing', async () => {
    const { fake, user } = setup(createFakeApi({ tasks: [makeTask()] }));
    await waitFor(() => item('Existing task'));
    await user.click(within(item('Existing task')).getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(fake.api.tasks.update).not.toHaveBeenCalled();
    expect(screen.queryByRole('form', { name: 'Edit task' })).not.toBeInTheDocument();
  });

  it('cancels editing with Escape', async () => {
    const { user } = setup(createFakeApi({ tasks: [makeTask()] }));
    await waitFor(() => item('Existing task'));
    await user.click(within(item('Existing task')).getByRole('button', { name: 'Edit' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('form', { name: 'Edit task' })).not.toBeInTheDocument();
  });

  it('completes, undoes completion, then completes and reopens explicitly', async () => {
    const { fake, user } = setup(createFakeApi({ tasks: [makeTask({ title: 'Essay' })] }));
    await waitFor(() => item('Essay'));
    await user.click(screen.getByRole('checkbox', { name: 'Essay' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Essay' })).toBeChecked());
    expect(within(screen.getByRole('region', { name: 'Completed' })).getByText('Essay')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Completed “Essay”.');

    await user.click(within(screen.getByRole('status')).getByRole('button', { name: 'Undo' }));
    expect(fake.api.tasks.update).toHaveBeenLastCalledWith({ id: makeTask().id, expectedRevision: 2, patch: { status: 'pending' } });
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Essay' })).not.toBeChecked());

    await user.click(screen.getByRole('checkbox', { name: 'Essay' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Essay' })).toBeChecked());
    await user.click(screen.getByRole('checkbox', { name: 'Essay' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Essay' })).not.toBeChecked());
    expect(fake.tasks[0]).toMatchObject({ status: 'pending', completedAt: null, revision: 5 });
    expect(screen.getByRole('status')).toHaveTextContent('Reopened “Essay”.');
  });

  it('does not show completion when the update fails', async () => {
    const fake = createFakeApi({ tasks: [makeTask({ title: 'Essay' })] });
    fake.inject('tasks.update', { ok: false, error: { code: 'STORAGE_ERROR' } });
    const { user } = setup(fake);
    await waitFor(() => item('Essay'));
    await user.click(screen.getByRole('checkbox', { name: 'Essay' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Reminder couldn’t save to local storage.');
    expect(screen.getByRole('checkbox', { name: 'Essay' })).not.toBeChecked();
  });

  it('on a stale edit shows a conflict, refreshes to the newer save and keeps the draft', async () => {
    const fake = createFakeApi({ tasks: [makeTask({ title: 'Draft essay' })] });
    const { user } = setup(fake);
    await waitFor(() => item('Draft essay'));
    await user.click(within(item('Draft essay')).getByRole('button', { name: 'Edit' }));
    fake.externalEdit(makeTask().id, { notes: 'Saved elsewhere' });
    const form = screen.getByRole('form', { name: 'Edit task' });
    await user.clear(within(form).getByRole('textbox', { name: 'Title' }));
    await user.type(within(form).getByRole('textbox', { name: 'Title' }), 'My edit');
    await user.click(within(form).getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This task was changed somewhere else, so your edit wasn’t saved.');
    expect(fake.tasks[0]).toMatchObject({ title: 'Draft essay', notes: 'Saved elsewhere', revision: 2 });
    expect(fake.api.tasks.list).toHaveBeenCalledTimes(2);
    expect(within(screen.getByRole('form', { name: 'Edit task' })).getByRole('textbox', { name: 'Title' })).toHaveValue('My edit');
    expect(within(screen.getByRole('form', { name: 'Edit task' })).getByRole('textbox', { name: 'Notes' })).toHaveValue('Saved elsewhere');

    await user.click(within(screen.getByRole('form', { name: 'Edit task' })).getByRole('button', { name: 'Save changes' }));
    expect(fake.api.tasks.update).toHaveBeenLastCalledWith({ id: makeTask().id, expectedRevision: 2, patch: { title: 'My edit' } });
    await waitFor(() => expect(fake.tasks[0]).toMatchObject({ title: 'My edit', notes: 'Saved elsewhere' }));
  });

  it('does not overwrite a newer edit when undo conflicts', async () => {
    const fake = createFakeApi({ tasks: [makeTask({ title: 'Essay' })] });
    const { user } = setup(fake);
    await waitFor(() => item('Essay'));
    await user.click(screen.getByRole('checkbox', { name: 'Essay' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Essay' })).toBeChecked());
    fake.externalEdit(makeTask().id, { title: 'Essay (final)' });
    await user.click(within(screen.getByRole('status')).getByRole('button', { name: 'Undo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Undo wasn’t applied');
    expect(fake.tasks[0]).toMatchObject({ title: 'Essay (final)', status: 'completed', revision: 3 });
    await waitFor(() => item('Essay (final)'));
    expect(within(screen.getByRole('status')).queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });

  it('keeps Undo available after a transient undo failure', async () => {
    const fake = createFakeApi({ tasks: [makeTask({ title: 'Essay' })] });
    const { user } = setup(fake);
    await waitFor(() => item('Essay'));
    await user.click(screen.getByRole('checkbox', { name: 'Essay' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Essay' })).toBeChecked());
    fake.inject('tasks.update', 'reject');
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Reminder couldn’t reach its local storage.');
    await user.click(within(alert).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Essay' })).not.toBeChecked());
    expect(fake.tasks[0]).toMatchObject({ status: 'pending', revision: 3 });
  });

  it('keeps an elapsed deadline pending and marks it overdue', async () => {
    setup(createFakeApi({ tasks: [makeTask({ deadline: { kind: 'date', date: '2020-01-01', timeZone: 'UTC' } })] }));
    const row = await waitFor(() => item('Existing task'));
    expect(row).toHaveTextContent('Overdue');
    expect(screen.getByRole('checkbox', { name: 'Existing task' })).not.toBeChecked();
  });

  it('does not send a deadline patch when only the timezone setting changed', async () => {
    const deadline = { kind: 'instant' as const, at: '2026-11-06T09:00:00.000Z', timeZone: 'Asia/Shanghai' };
    const { fake, user } = setup(createFakeApi({ settings: { timeZone: 'America/New_York' }, tasks: [makeTask({ deadline })] }));
    await waitFor(() => item('Existing task'));
    await user.click(within(item('Existing task')).getByRole('button', { name: 'Edit' }));
    const form = screen.getByRole('form', { name: 'Edit task' });
    await user.type(within(form).getByRole('textbox', { name: 'Notes' }), 'n');
    await user.click(within(form).getByRole('button', { name: 'Save changes' }));
    expect(fake.api.tasks.update).toHaveBeenLastCalledWith({ id: makeTask().id, expectedRevision: 1, patch: { notes: 'n' } });
  });
});

describe('settings', () => {
  it('switches to zh-CN after the save is confirmed and keeps task text unchanged', async () => {
    const { fake, user } = setup(createFakeApi({ tasks: [makeTask({ title: '数学作业' }), makeTask({ id: '00000000-0000-4000-8000-0000000000bb', title: 'Finish my essay' })] }));
    await waitFor(() => item('数学作业'));
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'zh-CN');
    expect(fake.api.settings.update).toHaveBeenCalledWith({ expectedRevision: 1, patch: { locale: 'zh-CN' } });
    expect(await screen.findByRole('combobox', { name: '语言' })).toHaveValue('zh-CN');
    expect(document.documentElement.lang).toBe('zh-CN');
    await user.click(screen.getByRole('button', { name: '任务' }));
    expect(item('数学作业')).toBeInTheDocument();
    expect(item('Finish my essay')).toBeInTheDocument();
  });

  it('keeps the previous language when saving settings fails', async () => {
    const fake = createFakeApi();
    fake.inject('settings.update', 'reject');
    const { user } = setup(fake);
    await screen.findByRole('heading', { name: 'No tasks yet' });
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'zh-CN');
    expect(await screen.findByRole('alert')).toHaveTextContent('Reminder couldn’t reach its local storage.');
    expect(screen.getByRole('combobox', { name: 'Language' })).toHaveValue('en-US');
  });

  it('reloads settings on a conflict', async () => {
    const fake = createFakeApi();
    const { user } = setup(fake);
    await screen.findByRole('heading', { name: 'No tasks yet' });
    fake.externalSettings({ timeZone: 'Asia/Tokyo' });
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'zh-CN');
    expect(await screen.findByRole('alert')).toHaveTextContent('Settings changed somewhere else.');
    expect(screen.getByRole('combobox', { name: 'Time zone' })).toHaveValue('Asia/Tokyo');
    expect(fake.settings.locale).toBe('en-US');
  });

  // REM-001-FE-01: a settings CONFLICT whose reload also fails.
  const refreshFailures = [
    ['a STORAGE_ERROR result', { ok: false, error: { code: 'STORAGE_ERROR' } }],
    ['a rejected IPC promise', 'reject']
  ] as const;
  const copy = {
    'en-US': {
      settings: 'Settings', tasksHeading: 'No tasks yet', language: 'Language', zone: 'Time zone', retry: 'Try again',
      failed: 'Settings changed somewhere else, and the latest settings couldn’t be loaded.',
      kept: 'Your previous settings are still shown',
      reloaded: 'Settings changed somewhere else. The latest saved settings are shown', saved: 'Settings saved.'
    },
    'zh-CN': {
      settings: '设置', tasksHeading: '还没有任务', language: '语言', zone: '时区', retry: '重试',
      failed: '设置已在其他地方被修改，且无法载入最新设置。',
      kept: '仍显示你之前的设置',
      reloaded: '设置已在其他地方被修改。已显示最新保存的设置', saved: '设置已保存。'
    }
  } as const;

  describe.each(['en-US', 'zh-CN'] as const)('settings conflict with a failed reload (%s)', locale => {
    const c = copy[locale];
    const other = locale === 'en-US' ? 'zh-CN' : 'en-US';

    it.each(refreshFailures)('explains the failure, keeps the last known settings and allows an explicit retry after %s', async (_label, failure) => {
      const fake = createFakeApi({ settings: { locale, timeZone: 'Europe/London' } });
      const { user } = setup(fake);
      await screen.findByRole('heading', { name: c.tasksHeading });
      await user.click(screen.getByRole('button', { name: c.settings }));
      fake.externalSettings({ timeZone: 'Asia/Tokyo' });
      fake.inject('settings.get', failure);

      await user.selectOptions(screen.getByRole('combobox', { name: c.language }), other);

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(c.failed);
      expect(alert).toHaveTextContent(c.kept);
      expect(alert).not.toHaveTextContent(c.reloaded);
      expect(screen.getByRole('status')).not.toHaveTextContent(c.saved);
      // Last known settings stay on screen; nothing was written over the newer saved settings.
      expect(screen.getByRole('combobox', { name: c.language })).toHaveValue(locale);
      expect(screen.getByRole('combobox', { name: c.zone })).toHaveValue('Europe/London');
      expect(document.documentElement.lang).toBe(locale);
      expect(fake.settings).toMatchObject({ locale, timeZone: 'Asia/Tokyo', revision: 2 });
      expect(screen.getByRole('combobox', { name: c.language })).toBeEnabled();

      // Explicit retry reloads the latest settings.
      await user.click(within(alert).getByRole('button', { name: c.retry }));
      expect(await screen.findByRole('alert')).toHaveTextContent(c.reloaded);
      expect(screen.getByRole('combobox', { name: c.zone })).toHaveValue('Asia/Tokyo');
      expect(fake.api.settings.get).toHaveBeenCalledTimes(3);

      // A later explicit change uses the reloaded revision and succeeds.
      await user.selectOptions(screen.getByRole('combobox', { name: c.zone }), 'UTC');
      await waitFor(() => expect(fake.settings).toMatchObject({ locale, timeZone: 'UTC', revision: 3 }));
      expect(fake.api.settings.update).toHaveBeenLastCalledWith({ expectedRevision: 2, patch: { timeZone: 'UTC' } });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent(c.saved);
    });

    it('lets the user retry the change itself after a failed reload', async () => {
      const fake = createFakeApi({ settings: { locale } });
      const { user } = setup(fake);
      await screen.findByRole('heading', { name: c.tasksHeading });
      await user.click(screen.getByRole('button', { name: c.settings }));
      fake.externalSettings({ timeZone: 'Asia/Tokyo' });
      fake.inject('settings.get', 'reject');
      await user.selectOptions(screen.getByRole('combobox', { name: c.language }), other);
      expect(await screen.findByRole('alert')).toHaveTextContent(c.failed);
      // Choosing again is still revision-checked: it conflicts, the reload now succeeds, and nothing is overwritten.
      await user.selectOptions(screen.getByRole('combobox', { name: c.language }), other);
      expect(await screen.findByText(new RegExp(c.reloaded))).toBeInTheDocument();
      expect(fake.settings).toMatchObject({ locale, timeZone: 'Asia/Tokyo', revision: 2 });
    });
  });

  it('shows exact deadlines in the selected time zone and date-only deadlines unshifted', async () => {
    const fake = createFakeApi({ settings: { timeZone: 'Asia/Shanghai' }, tasks: [
      makeTask({ title: 'Exact', deadline: { kind: 'instant', at: '2026-11-06T09:00:00.000Z', timeZone: 'Asia/Shanghai' } }),
      makeTask({ id: '00000000-0000-4000-8000-0000000000bb', title: 'Day', deadline: { kind: 'date', date: '2026-11-06', timeZone: 'Asia/Shanghai' } })
    ] });
    const { user } = setup(fake);
    await waitFor(() => item('Exact'));
    expect(item('Exact')).toHaveTextContent(/Nov 6, 2026.*5:00\sPM/);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Time zone' }), 'America/Los_Angeles');
    await waitFor(() => expect(fake.settings.timeZone).toBe('America/Los_Angeles'));
    await user.click(screen.getByRole('button', { name: 'Tasks' }));
    expect(item('Exact')).toHaveTextContent(/Nov 6, 2026.*1:00\sAM/);
    expect(item('Day')).toHaveTextContent('Due Fri, Nov 6, 2026');
  });
});

describe('daylight-saving transitions', () => {
  async function fillExact(user: ReturnType<typeof userEvent.setup>, title: string, date: string, time: string) {
    await user.type(screen.getByRole('textbox', { name: 'Title' }), title);
    await user.click(screen.getByRole('button', { name: 'More details' }));
    await user.click(screen.getByRole('radio', { name: 'Date and time' }));
    await user.type(screen.getByLabelText('Deadline date'), date);
    await user.type(screen.getByLabelText('Deadline time'), time);
  }

  it.each([
    ['America/New_York', '2027-03-14'],
    ['Europe/Berlin', '2027-03-28']
  ])('rejects a skipped wall time in %s with a localized field error and no write', async (timeZone, date) => {
    const { fake, user } = setup(createFakeApi({ settings: { timeZone } }));
    await screen.findByRole('heading', { name: 'No tasks yet' });
    await fillExact(user, 'Gap', date, '02:30');
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    expect(screen.getByText(/02:30 doesn’t exist on that date in/)).toBeInTheDocument();
    expect(screen.getByLabelText('Deadline time')).toHaveAttribute('aria-invalid', 'true');
    expect(fake.api.tasks.create).not.toHaveBeenCalled();
  });

  it('requires choosing which occurrence of a repeated wall time is meant (New York)', async () => {
    const { fake, user } = setup(createFakeApi({ settings: { timeZone: 'America/New_York' } }));
    await screen.findByRole('heading', { name: 'No tasks yet' });
    await fillExact(user, 'Fold', '2027-11-07', '01:30');
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    expect(screen.getByText(/01:30 happens twice on that date/)).toBeInTheDocument();
    expect(fake.api.tasks.create).not.toHaveBeenCalled();
    await user.click(screen.getByRole('radio', { name: /Second.*GMT-5/ }));
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    expect(fake.api.tasks.create).toHaveBeenCalledWith(expect.objectContaining({
      deadline: { kind: 'instant', at: '2027-11-07T06:30:00.000Z', timeZone: 'America/New_York' }
    }));
  });

  it('creates the earlier occurrence of a repeated wall time when chosen (Berlin)', async () => {
    const { fake, user } = setup(createFakeApi({ settings: { timeZone: 'Europe/Berlin' } }));
    await screen.findByRole('heading', { name: 'No tasks yet' });
    await fillExact(user, 'Fold', '2027-10-31', '02:30');
    await user.click(screen.getByRole('radio', { name: /First.*GMT\+2/ }));
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    expect(fake.api.tasks.create).toHaveBeenCalledWith(expect.objectContaining({
      deadline: { kind: 'instant', at: '2027-10-31T00:30:00.000Z', timeZone: 'Europe/Berlin' }
    }));
  });

  it('keeps the saved occurrence when editing a task whose deadline is the later repeated time', async () => {
    const deadline = { kind: 'instant' as const, at: '2027-11-07T06:30:00.000Z', timeZone: 'America/New_York' };
    const { fake, user } = setup(createFakeApi({ settings: { timeZone: 'America/New_York' }, tasks: [makeTask({ deadline })] }));
    await waitFor(() => item('Existing task'));
    await user.click(within(item('Existing task')).getByRole('button', { name: 'Edit' }));
    const form = screen.getByRole('form', { name: 'Edit task' });
    expect(within(form).getByRole('radio', { name: /Second.*GMT-5/ })).toBeChecked();
    await user.click(within(form).getByRole('radio', { name: /First.*GMT-4/ }));
    await user.click(within(form).getByRole('button', { name: 'Save changes' }));
    expect(fake.api.tasks.update).toHaveBeenLastCalledWith({
      id: makeTask().id, expectedRevision: 1,
      patch: { deadline: { kind: 'instant', at: '2027-11-07T05:30:00.000Z', timeZone: 'America/New_York' } }
    });
  });
});

describe('conflicts that move a task between lists', () => {
  it.each([
    ['pending', 'completed'],
    ['completed', 'pending']
  ] as const)('keeps the draft when another writer moves the task from %s to %s', async (from, to) => {
    const fake = createFakeApi({ tasks: [makeTask({ title: 'Essay', status: from, completedAt: from === 'completed' ? '2026-10-30T11:00:00.000Z' : null })] });
    const { user } = setup(fake);
    await waitFor(() => item('Essay'));
    await user.click(within(item('Essay')).getByRole('button', { name: 'Edit' }));
    let form = screen.getByRole('form', { name: 'Edit task' });
    await user.clear(within(form).getByRole('textbox', { name: 'Title' }));
    await user.type(within(form).getByRole('textbox', { name: 'Title' }), 'Essay, final draft');
    fake.externalEdit(makeTask().id, { status: to, notes: 'From elsewhere' });
    await user.click(within(form).getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('your edit wasn’t saved');
    const section = screen.getByRole('region', { name: to === 'completed' ? 'Completed' : 'To do' });
    form = within(section).getByRole('form', { name: 'Edit task' });
    expect(within(form).getByRole('textbox', { name: 'Title' })).toHaveValue('Essay, final draft');
    expect(within(form).getByRole('textbox', { name: 'Notes' })).toHaveValue('From elsewhere');
    expect(fake.tasks[0]).toMatchObject({ title: 'Essay', status: to, revision: 2 });

    await user.click(within(form).getByRole('button', { name: 'Save changes' }));
    expect(fake.api.tasks.update).toHaveBeenLastCalledWith({ id: makeTask().id, expectedRevision: 2, patch: { title: 'Essay, final draft' } });
    await waitFor(() => expect(fake.tasks[0]).toMatchObject({ title: 'Essay, final draft', status: to, notes: 'From elsewhere' }));
  });

  it('does not claim the latest version loaded when the conflict refresh fails', async () => {
    const fake = createFakeApi({ tasks: [makeTask({ title: 'Essay' })] });
    const { user } = setup(fake);
    await waitFor(() => item('Essay'));
    await user.click(within(item('Essay')).getByRole('button', { name: 'Edit' }));
    fake.externalEdit(makeTask().id, { notes: 'x' });
    fake.inject('tasks.list', 'reject');
    const form = screen.getByRole('form', { name: 'Edit task' });
    await user.type(within(form).getByRole('textbox', { name: 'Title' }), '!');
    await user.click(within(form).getByRole('button', { name: 'Save changes' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('the latest version couldn’t be loaded');
    expect(alert).not.toHaveTextContent('newer saved values');
    expect(within(screen.getByRole('form', { name: 'Edit task' })).getByRole('textbox', { name: 'Title' })).toHaveValue('Essay!');
  });

  it('does not claim the latest version loaded when an undo-conflict refresh fails', async () => {
    const fake = createFakeApi({ tasks: [makeTask({ title: 'Essay' })] });
    const { user } = setup(fake);
    await waitFor(() => item('Essay'));
    await user.click(screen.getByRole('checkbox', { name: 'Essay' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Essay' })).toBeChecked());
    fake.externalEdit(makeTask().id, { notes: 'x' });
    fake.inject('tasks.list', 'reject');
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('the latest version couldn’t be loaded');
    expect(alert).not.toHaveTextContent('latest saved version is shown');
  });
});

describe('settings follow-ups', () => {
  it('can select UTC again after switching away', async () => {
    const fake = createFakeApi({ settings: { timeZone: 'UTC' } });
    const { user } = setup(fake);
    await screen.findByRole('heading', { name: 'No tasks yet' });
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Time zone' }), 'Asia/Tokyo');
    await waitFor(() => expect(fake.settings.timeZone).toBe('Asia/Tokyo'));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Time zone' }), 'UTC');
    await waitFor(() => expect(fake.settings.timeZone).toBe('UTC'));
  });

  it('shows the unavailable state in the saved language when only the task list fails', async () => {
    const fake = createFakeApi({ settings: { locale: 'zh-CN' } });
    fake.inject('tasks.list', { ok: false, error: { code: 'STORAGE_ERROR' } });
    setup(fake);
    expect(await screen.findByRole('heading', { name: 'Reminder 无法读取已保存的数据' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('zh-CN');
  });
});

describe('keyboard', () => {
  it('focuses the new-task title with Ctrl+N', async () => {
    const { user } = setup();
    await screen.findByRole('heading', { name: 'No tasks yet' });
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.keyboard('{Control>}n{/Control}');
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveFocus();
  });
});
