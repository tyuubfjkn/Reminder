import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { withIsolatedProfile } from './isolated-profile.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
process.exitCode = await withIsolatedProfile(async profile => {
  const env = { ...process.env, REMINDER_USER_DATA_DIR: profile };
  // Verify real main configuration before the UI test performs any writes.
  for (const script of ['tools/profile-probe.mjs', 'tools/assistant-probe.mjs', 'apps/desktop/renderer/e2e/desktop.mjs']) {
    const child = spawnSync(process.execPath, [join(root, script)], {
      cwd: root, env, stdio: 'inherit', windowsHide: true, timeout: 180_000
    });
    if (child.error) throw child.error;
    if (child.status !== 0) return child.status ?? 1;
  }
  return 0;
});
