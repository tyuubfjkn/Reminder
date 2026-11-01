import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { withIsolatedProfile } from '../../../tools/isolated-profile.mjs';

test('isolated runner propagates a real child exit and removes only its temporary profile', async () => {
  let profile;
  const result = await withIsolatedProfile(async directory => {
    profile = directory;
    const child=spawnSync(process.execPath,['--input-type=module','-e',
      "import {writeFileSync} from 'node:fs'; import {join} from 'node:path'; writeFileSync(join(process.env.REMINDER_USER_DATA_DIR,'sentinel'),'test'); process.exit(23);"],
      {env:{...process.env,REMINDER_USER_DATA_DIR:directory}});
    assert.equal(child.error,undefined);
    return child.status;
  });
  assert.equal(result,23);
  assert.equal(existsSync(profile),false);
});
test('isolated runner cleans up and preserves failure if the child cannot be started', async () => {
  let profile;
  const failure=new Error('launch failed');
  await assert.rejects(withIsolatedProfile(async directory => { profile=directory; throw failure; }),e=>e===failure);
  assert.equal(existsSync(profile),false);
});
