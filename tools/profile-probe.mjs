import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { withIsolatedProfile } from './isolated-profile.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const requireRenderer = createRequire(new URL('../apps/desktop/renderer/package.json', import.meta.url));
const { _electron } = requireRenderer('playwright-core');
const requireRoot = createRequire(new URL('../package.json', import.meta.url));
const profile = process.env.REMINDER_USER_DATA_DIR;
assert.ok(profile, 'This probe requires an isolated profile');
const launch = directory => _electron.launch({
  executablePath: requireRoot('electron'),
  args: [join(root, 'apps/desktop/main/main.mjs')], cwd: root,
  env: { ...process.env, REMINDER_USER_DATA_DIR: directory }
});
await withIsolatedProfile(async other => {
  let one, two;
  try {
    one = await launch(profile);
    two = await launch(other);
    for (const [app, expected] of [[one, profile], [two, other]]) {
      await app.firstWindow();
      const paths = await app.evaluate(({ app }) => ({ userData: app.getPath('userData'), sessionData: app.getPath('sessionData') }));
      assert.equal(resolve(paths.userData), resolve(expected));
      assert.equal(resolve(paths.sessionData), resolve(expected));
    }
    console.log('[profile] Two independent real Electron profiles and locks verified');
  } finally {
    await Promise.all([one?.close(), two?.close()]);
  }
});
