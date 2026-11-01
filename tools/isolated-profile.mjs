import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

export async function withIsolatedProfile(run) {
  const parent = resolve(tmpdir());
  const directory = mkdtempSync(join(parent, 'reminder-e2e-'));
  try { return await run(directory); }
  finally {
    // Only the directory generated above is eligible for recursive removal.
    if (dirname(directory) !== parent || !basename(directory).startsWith('reminder-e2e-')) {
      throw new Error('Refusing to remove an unexpected profile path');
    }
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
