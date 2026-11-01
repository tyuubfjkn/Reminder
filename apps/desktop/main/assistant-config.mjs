import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { AppError, invalid } from '../../../packages/backend/src/errors.mjs';
import { object } from '../../../packages/backend/src/validation.mjs';

const defaultConfig = () => ({ version: 1, model: 'deepseek-flash', encryptedKey: null });
const validModel = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(value);
const publicConfig = value => ({ provider: 'deepseek', model: value.model, hasKey: value.encryptedKey !== null });

// Serialize reads with writes: a delayed encryption must not resurrect a removed key.
export function createAssistantVault(path, safeStorage) {
  let tail = Promise.resolve();
  const serial = operation => {
    const result = tail.then(operation);
    tail = result.catch(() => {});
    return result;
  };
  async function read() {
    try {
      const data = await readFile(path);
      if (data.length > 65536) throw Error();
      const value = JSON.parse(data.toString('utf8'));
      object(value, ['version', 'model', 'encryptedKey']);
      if (value.version !== 1 || !validModel(value.model) ||
          !(value.encryptedKey === null || typeof value.encryptedKey === 'string' && value.encryptedKey.length > 0 &&
          value.encryptedKey.length <= 32768 && Buffer.from(value.encryptedKey, 'base64').toString('base64') === value.encryptedKey)) throw Error();
      return value;
    } catch (error) {
      if (error.code === 'ENOENT') return defaultConfig();
      throw new AppError('AI_CONFIG_ERROR');
    }
  }
  async function write(value) {
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify(value), { flag: 'wx', mode: 0o600, flush: true });
      await rename(temp, path);
    } catch { throw new AppError('AI_CONFIG_ERROR'); }
    finally { await rm(temp, { force: true }).catch(() => {}); }
  }
  async function requireEncryption() {
    try {
      if (!await safeStorage.isAsyncEncryptionAvailable()) throw Error();
    } catch { throw new AppError('AI_SECURE_STORAGE_UNAVAILABLE'); }
  }
  return {
    getConfig: () => serial(async () => publicConfig(await read())),
    configure(input) {
      // Snapshot before queuing; never retain the renderer's mutable object.
      let patch;
      try {
        object(input, ['model', 'apiKey', 'clearKey']);
        if (!Object.keys(input).length) invalid();
        if (Object.hasOwn(input, 'model') && !validModel(input.model)) invalid('model');
        if (Object.hasOwn(input, 'clearKey') && input.clearKey !== true) invalid('clearKey');
        if (Object.hasOwn(input, 'apiKey') && (input.clearKey || typeof input.apiKey !== 'string' ||
            !/^[\x21-\x7e]{1,4096}$/.test(input.apiKey))) invalid('apiKey');
        patch = { ...input };
      } catch (error) { return Promise.reject(error); }
      return serial(async () => {
        let value;
        try { value = await read(); }
        catch (error) { if (!patch.clearKey) throw error; value = defaultConfig(); }
        if (patch.model !== undefined) value.model = patch.model;
        if (patch.clearKey) value.encryptedKey = null;
        if (patch.apiKey !== undefined) {
          await requireEncryption();
          try { value.encryptedKey = (await safeStorage.encryptStringAsync(patch.apiKey)).toString('base64'); }
          catch { throw new AppError('AI_SECURE_STORAGE_UNAVAILABLE'); }
        }
        await write(value);
        return publicConfig(value);
      });
    },
    getCredential: () => serial(async () => {
      const value = await read();
      if (value.encryptedKey === null) return null;
      await requireEncryption();
      try {
        const decrypted = await safeStorage.decryptStringAsync(Buffer.from(value.encryptedKey, 'base64'));
        if (typeof decrypted.result !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(decrypted.result)) throw Error();
        if (decrypted.shouldReEncrypt) {
          value.encryptedKey = (await safeStorage.encryptStringAsync(decrypted.result)).toString('base64');
          await write(value);
        }
        return { apiKey: decrypted.result, model: value.model };
      } catch { throw new AppError('AI_CONFIG_ERROR'); }
    })
  };
}
