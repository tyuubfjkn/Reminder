// Real desktop check: launches the repository's Electron shell (apps/desktop/main/main.mjs) with the
// built renderer and the real SQLite backend, drives the UI, quits, relaunches and verifies persistence.
// Uses the app's real userData directory; run it against a fresh profile (see README).
// Usage: npm run build && npm run e2e
import { _electron as electron } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');
const shots = join(here, '../docs/evidence');
mkdirSync(shots, { recursive: true });
const executablePath = join(root, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const log = (...a) => console.log('[e2e]', ...a);

async function launch() {
  // --lang=zh-CN makes Chromium report a Chinese OS/browser language; the UI must still start in en-US.
  const app = await electron.launch({ executablePath, args: [join(root, 'apps/desktop/main/main.mjs'), '--lang=zh-CN'], cwd: root });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}
const shot = (page, name) => page.screenshot({ path: join(shots, `${name}.png`) });
const row = (page, title) => page.locator('li.task', { has: page.locator('.task-title', { hasText: new RegExp(`^${title.replace(/[()]/g, '\\$&')}$`) }) });
const list = page => page.evaluate(() => window.reminder.tasks.list());

async function addTask(page, { title, minutes, date, time }) {
  const form = page.getByRole('form', { name: 'New task' });
  await form.getByRole('textbox', { name: 'Title' }).fill(title);
  if (minutes || date) {
    await form.getByRole('button', { name: 'More details' }).click();
    if (minutes) await form.getByRole('spinbutton', { name: 'Estimated time (minutes)' }).fill(String(minutes));
    if (date) {
      await form.getByRole('radio', { name: time ? 'Date and time' : 'Date only' }).click();
      await form.getByLabel('Deadline date').fill(date);
      if (time) await form.getByLabel('Deadline time').fill(time);
    }
  }
  await form.getByRole('button', { name: 'Add task' }).click();
  await row(page, title).waitFor();
}

// ---------- First launch ----------
let { app, page } = await launch();
const runtime = await app.evaluate(({ app }) => ({ electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome, userData: app.getPath('userData'), locale: app.getLocale() }));
log('runtime', runtime);
assert.equal(await page.evaluate(() => navigator.language), 'zh-CN', 'OS/browser language simulated as zh-CN');
await page.getByRole('heading', { name: 'No tasks yet' }).waitFor();
assert.equal(await page.evaluate(() => document.documentElement.lang), 'en-US');
assert.equal(await page.evaluate(() => window.reminder.apiVersion), '1.0.0');
await page.setViewportSize?.({ width: 1100, height: 760 });
await shot(page, '01-first-launch-empty-en');
log('1 fresh launch: English empty state on zh-CN Chromium locale');

// REM-002 compatibility: the assistant is optional. Without it in the bridge, the manual app is unchanged.
const hasAssistant = await page.evaluate(() => typeof window.reminder.assistant === 'object' && window.reminder.assistant !== null);
if (!hasAssistant) {
  assert.equal(await page.getByRole('button', { name: 'Assistant' }).count(), 0, 'no Assistant nav without the capability');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByText('The assistant isn’t available in this version of Reminder.').waitFor();
  await page.getByRole('button', { name: 'Tasks' }).click();
  log('REM-002 compat: bridge has no assistant -> Assistant hidden, manual UI unchanged');
} else {
  // Real assistant IPC + DPAPI through the UI. Never submits, so no DeepSeek request is made.
  await page.getByRole('button', { name: 'Assistant' }).click();
  await page.getByText('Add your DeepSeek API key in Settings to use the assistant.').waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'Message' }).count(), 0, 'no composer without a key');
  await page.getByRole('button', { name: 'Open Settings' }).click();
  const ai = page.getByRole('region', { name: 'AI assistant (DeepSeek)' });
  await ai.getByText('API key: not set').waitFor();
  await ai.getByText('Model: deepseek-flash').waitFor();
  // Placeholder, not a credential: it is only encrypted, stored and removed locally.
  const placeholder = 'sk-e2e-placeholder-not-a-real-key';
  await ai.getByLabel('DeepSeek API key').fill(placeholder);
  await ai.getByRole('button', { name: 'Save key' }).click();
  await ai.getByText('API key: saved').waitFor();
  assert.equal(await ai.getByLabel('Replace API key').inputValue(), '', 'key field cleared after save');
  assert.equal((await page.content()).includes(placeholder), false, 'key not rendered anywhere');
  const config = await page.evaluate(() => window.reminder.assistant.getConfig());
  assert.deepEqual(config, { ok: true, data: { provider: 'deepseek', model: 'deepseek-flash', hasKey: true } });
  await ai.getByRole('button', { name: 'Remove key' }).click();
  await ai.getByText('API key: not set').waitFor();
  await page.getByRole('button', { name: 'Tasks' }).click();
  log('REM-002: real assistant IPC + DPAPI via UI: no-key gate, placeholder key saved/cleared/removed, no submit');
}

// Fix a known timezone for deterministic evidence; it is independent of language.
await page.getByRole('button', { name: 'Settings' }).click();
await page.getByRole('combobox', { name: 'Time zone' }).selectOption('Asia/Shanghai');
await page.getByRole('status').filter({ hasText: 'Settings saved.' }).waitFor();
await page.getByRole('button', { name: 'Tasks' }).click();

await addTask(page, { title: 'Finish my essay', minutes: 180, date: '2026-11-06' });
assert.match(await row(page, 'Finish my essay').innerText(), /Due Fri, Nov 6, 2026/);
assert.match(await row(page, 'Finish my essay').innerText(), /About 3 hr/);
await addTask(page, { title: '数学作业' });
await addTask(page, { title: 'Exam', date: '2026-11-06', time: '17:00' });
assert.match(await row(page, 'Exam').innerText(), /Nov 6, 2026.*5:00\sPM\sGMT\+8/);
let saved = (await list(page)).data;
assert.deepEqual(saved.find(t => t.title === 'Finish my essay').deadline, { kind: 'date', date: '2026-11-06', timeZone: 'Asia/Shanghai' });
assert.deepEqual(saved.find(t => t.title === 'Exam').deadline, { kind: 'instant', at: '2026-11-06T09:00:00.000Z', timeZone: 'Asia/Shanghai' });
await shot(page, '02-created-tasks-en');
log('2-3 created essay (180 min, date-only), 数学作业, exact-deadline Exam');

// Blank title is rejected locally and writes nothing.
const before = (await list(page)).data.length;
await page.getByRole('form', { name: 'New task' }).getByRole('textbox', { name: 'Title' }).fill('   ');
await page.getByRole('button', { name: 'Add task' }).click();
await page.getByText('Enter a title.').waitFor();
assert.equal((await list(page)).data.length, before);
await shot(page, '03-blank-title-error');
await page.getByRole('form', { name: 'New task' }).getByRole('textbox', { name: 'Title' }).fill('');
log('5 blank title localized error, no write');

// Edit, complete, undo completion, complete, reopen.
await row(page, 'Finish my essay').getByRole('button', { name: 'Edit' }).click();
const edit = page.getByRole('form', { name: 'Edit task' });
await edit.getByRole('textbox', { name: 'Notes' }).fill('Outline first, then draft.');
await edit.getByRole('button', { name: 'Save changes' }).click();
await page.getByRole('status').filter({ hasText: 'Saved changes to “Finish my essay”.' }).waitFor();
const essayCheck = page.getByRole('checkbox', { name: 'Finish my essay' });
await essayCheck.click();
await page.getByRole('status').filter({ hasText: 'Completed “Finish my essay”.' }).waitFor();
await shot(page, '04-completed-with-undo');
await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
await page.getByRole('status').filter({ hasText: 'Undone.' }).waitFor();
assert.equal(await essayCheck.isChecked(), false);
await essayCheck.click();
await page.getByRole('status').filter({ hasText: 'Completed' }).waitFor();
await essayCheck.click();
await page.getByRole('status').filter({ hasText: 'Reopened “Finish my essay”.' }).waitFor();
let essay = (await list(page)).data.find(t => t.title === 'Finish my essay');
assert.equal(essay.status, 'pending');
assert.equal(essay.completedAt, null);
assert.equal(essay.revision, 6);
log('4 edit -> complete -> undo -> complete -> reopen; revision', essay.revision);

// Stale edit: another write lands while the edit form is open.
await row(page, 'Finish my essay').getByRole('button', { name: 'Edit' }).click();
await page.evaluate(async id => {
  const t = (await window.reminder.tasks.list()).data.find(x => x.id === id);
  return window.reminder.tasks.update({ id, expectedRevision: t.revision, patch: { priority: 'high' } });
}, essay.id);
await page.getByRole('form', { name: 'Edit task' }).getByRole('textbox', { name: 'Title' }).fill('Finish my essay (v2)');
await page.getByRole('form', { name: 'Edit task' }).getByRole('button', { name: 'Save changes' }).click();
await page.getByRole('alert').filter({ hasText: 'changed somewhere else' }).waitFor();
essay = (await list(page)).data.find(t => t.id === essay.id);
assert.equal(essay.title, 'Finish my essay');
assert.equal(essay.priority, 'high');
await shot(page, '05-edit-conflict');
await page.getByRole('form', { name: 'Edit task' }).getByRole('button', { name: 'Cancel' }).click();
log('6a stale edit -> localized conflict, newer save kept');

// Undo conflict: a newer edit lands before Undo.
await page.getByRole('checkbox', { name: '数学作业' }).click();
await page.getByRole('status').filter({ hasText: 'Completed “数学作业”.' }).waitFor();
const math = (await list(page)).data.find(t => t.title === '数学作业');
await page.evaluate(m => window.reminder.tasks.update({ id: m.id, expectedRevision: m.revision, patch: { notes: '第 4 章' } }), math);
await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
await page.getByRole('alert').filter({ hasText: 'Undo wasn’t applied' }).waitFor();
const mathAfter = (await list(page)).data.find(t => t.id === math.id);
assert.equal(mathAfter.status, 'completed');
assert.equal(mathAfter.notes, '第 4 章');
await shot(page, '06-undo-conflict');
log('6b undo conflict -> not applied, newer edit kept');

// Timezone display: exact deadline follows settings timezone; date-only does not shift.
await page.getByRole('button', { name: 'Settings' }).click();
await page.getByRole('combobox', { name: 'Time zone' }).selectOption('America/Los_Angeles');
await page.getByRole('status').filter({ hasText: 'Settings saved.' }).waitFor();
await page.getByRole('button', { name: 'Tasks' }).click();
assert.match(await row(page, 'Exam').innerText(), /Nov 6, 2026.*1:00\sAM\sPST/);
assert.match(await row(page, 'Finish my essay').innerText(), /Due Fri, Nov 6, 2026/);
await shot(page, '07-timezone-los-angeles');
log('8 exact deadline shown in selected zone, date-only unshifted');

// Review fix 1: DST gap is rejected with zero writes; a DST fold needs an explicit occurrence.
const setZone = async zone => {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('combobox', { name: 'Time zone' }).selectOption(zone);
  await page.getByRole('status').filter({ hasText: 'Settings saved.' }).waitFor();
  await page.getByRole('button', { name: 'Tasks' }).click();
};
await setZone('America/New_York');
const countBeforeDst = (await list(page)).data.length;
const newForm = page.getByRole('form', { name: 'New task' });
await newForm.getByRole('textbox', { name: 'Title' }).fill('DST check');
await newForm.getByRole('button', { name: 'More details' }).click();
await newForm.getByRole('radio', { name: 'Date and time' }).click();
await newForm.getByLabel('Deadline date').fill('2027-03-14');
await newForm.getByLabel('Deadline time').fill('02:30');
await newForm.getByRole('button', { name: 'Add task' }).click();
await page.getByText(/02:30 doesn’t exist on that date in America\/New_York/).waitFor();
assert.equal((await list(page)).data.length, countBeforeDst, 'gap time wrote nothing');
await shot(page, '11-dst-gap-rejected');
await newForm.getByLabel('Deadline date').fill('2027-11-07');
await newForm.getByLabel('Deadline time').fill('01:30');
await newForm.getByRole('button', { name: 'Add task' }).click();
await page.getByText(/01:30 happens twice on that date/).waitFor();
assert.equal((await list(page)).data.length, countBeforeDst, 'unchosen fold wrote nothing');
await newForm.getByRole('radio', { name: /Second 01:30 \(GMT-5\)/ }).click();
await shot(page, '12-dst-fold-choice');
await newForm.getByRole('button', { name: 'Add task' }).click();
await row(page, 'DST check').waitFor();
assert.deepEqual((await list(page)).data.find(t => t.title === 'DST check').deadline,
  { kind: 'instant', at: '2027-11-07T06:30:00.000Z', timeZone: 'America/New_York' });
await setZone('America/Los_Angeles');
log('review 1: NY gap rejected (no write); fold saved as chosen later occurrence 06:30Z');

// Review fix 2: a stale edit keeps its draft when another writer moves the task to Completed.
await row(page, 'Exam').getByRole('button', { name: 'Edit' }).click();
await page.getByRole('form', { name: 'Edit task' }).getByRole('textbox', { name: 'Title' }).fill('Exam (room 4)');
const exam = (await list(page)).data.find(t => t.title === 'Exam');
await page.evaluate(e => window.reminder.tasks.update({ id: e.id, expectedRevision: e.revision, patch: { status: 'completed' } }), exam);
await page.getByRole('form', { name: 'Edit task' }).getByRole('button', { name: 'Save changes' }).click();
await page.getByRole('alert').filter({ hasText: 'your edit wasn’t saved' }).waitFor();
const completedForm = page.getByRole('region', { name: 'Completed' }).getByRole('form', { name: 'Edit task' });
assert.equal(await completedForm.getByRole('textbox', { name: 'Title' }).inputValue(), 'Exam (room 4)');
await shot(page, '13-status-move-conflict-draft-kept');
await completedForm.getByRole('button', { name: 'Save changes' }).click();
await row(page, 'Exam (room 4)').waitFor();
const examAfter = (await list(page)).data.find(t => t.id === exam.id);
assert.equal(examAfter.title, 'Exam (room 4)');
assert.equal(examAfter.status, 'completed');
log('review 2: draft kept after pending->completed move; explicit re-save applied on new revision');

// Switch to zh-CN; task text stays as written.
await page.getByRole('button', { name: 'Settings' }).click();
await page.getByRole('combobox', { name: 'Language' }).selectOption('zh-CN');
await page.getByRole('combobox', { name: '语言' }).waitFor();
await page.getByRole('button', { name: '任务' }).click();
await row(page, 'Finish my essay').waitFor();
await row(page, '数学作业').waitFor();
await shot(page, '08-zh-CN');
log('3/7 zh-CN active; task text unchanged');
const beforeQuit = (await list(page)).data;
await app.close();

// ---------- Relaunch ----------
({ app, page } = await launch());
await page.getByRole('heading', { name: '待办' }).waitFor();
assert.equal(await page.evaluate(() => document.documentElement.lang), 'zh-CN');
const settings = (await page.evaluate(() => window.reminder.settings.get())).data;
assert.equal(settings.locale, 'zh-CN');
assert.equal(settings.timeZone, 'America/Los_Angeles');
const afterRelaunch = (await list(page)).data;
assert.deepEqual(afterRelaunch, beforeQuit);
assert.match(await row(page, 'Finish my essay').innerText(), /2026年11月6日周五/);
assert.equal(await page.getByRole('checkbox', { name: '数学作业' }).isChecked(), true);
assert.equal(await page.getByRole('checkbox', { name: 'Finish my essay' }).isChecked(), false);
await shot(page, '09-relaunch-zh-CN');
log('7 relaunch: zh-CN, timezone, tasks, deadline precision, completion persisted');

// Minimum window size from the shell (760x540): layout must stay usable.
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 540));
await page.waitForTimeout(300);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
assert.equal(overflow, false, 'no horizontal overflow at minimum size');
await shot(page, '10-min-size-zh-CN');

// Keyboard: Ctrl+N focuses the new-task title from Settings.
await page.getByRole('button', { name: '设置' }).click();
await page.keyboard.press('Control+N');
assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('placeholder')), '你需要做什么？');
log('resize + keyboard checks passed');

console.log(JSON.stringify({ runtime, settings, tasks: afterRelaunch }, null, 2));
await app.close();
log('ALL REAL DESKTOP CHECKS PASSED');
