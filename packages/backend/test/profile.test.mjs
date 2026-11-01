import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configureUserData } from '../../../apps/desktop/main/profile.mjs';

// The break caught here is falling back to personal storage, or configuring only
// SQLite's directory while Chromium continues writing to the default profile.
async function configure(app, override) {
  return configureUserData(app, override);
}
function fixture(t, packaged = false) {
  const root = mkdtempSync(join(tmpdir(), 'reminder-profile-test-'));
  const paths = {};
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, paths, app: { isPackaged: packaged, setPath: (name, value) => { paths[name] = value; } } };
}
test('ordinary launches keep the default profile without changing any paths', async t => {
  const f=fixture(t);
  assert.equal(await configure(f.app, undefined), undefined);
  assert.deepEqual(f.paths, {});
});
test('explicit development profile creates its own directory and isolates Chromium with SQLite', async t => {
  const f=fixture(t), directory=join(f.root, 'profile with spaces');
  assert.equal(await configure(f.app,directory),directory);
  assert.deepEqual(f.paths,{userData:directory,sessionData:directory});
  assert.ok(existsSync(directory));
});
test('invalid or packaged overrides fail before changing any profile paths', async t => {
  const f=fixture(t);
  for(const value of ['', 'relative-profile', '.', null]) {
    await assert.rejects(configure(f.app,value));
    assert.deepEqual(f.paths,{});
  }
  const p=fixture(t,true), directory=join(p.root,'packaged');
  await assert.rejects(configure(p.app,directory));
  assert.equal(existsSync(directory),false);
  assert.deepEqual(p.paths,{});
});
test('an unusable explicit directory fails without silently selecting default storage', async t => {
  const f=fixture(t), file=join(f.root,'file');
  writeFileSync(file,'sentinel');
  await assert.rejects(configure(f.app,file));
  assert.deepEqual(f.paths,{});
});
