import { mkdirSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

export function configureUserData(app, override) {
  if (override === undefined) return undefined;
  if (app.isPackaged || typeof override !== 'string' || !override.trim() || !isAbsolute(override)) {
    throw new Error('Invalid development profile override');
  }
  const directory = resolve(override);
  mkdirSync(directory, { recursive: true });
  app.setPath('userData', directory);
  app.setPath('sessionData', directory);
  return directory;
}
