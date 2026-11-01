import { call, getApi } from './client';

describe('call', () => {
  it('passes a Result through unchanged', async () => {
    const result = await call(() => Promise.resolve({ ok: false as const, error: { code: 'CONFLICT' as const } }));
    expect(result).toEqual({ ok: false, error: { code: 'CONFLICT' } });
  });

  it('turns a rejected IPC promise into an IPC_FAILURE outcome', async () => {
    const result = await call(() => Promise.reject(new Error('channel closed')));
    expect(result).toEqual({ ok: false, error: { code: 'IPC_FAILURE' } });
  });

  it('treats a synchronous throw like a rejection', async () => {
    const result = await call(() => { throw new Error('boom'); });
    expect(result).toEqual({ ok: false, error: { code: 'IPC_FAILURE' } });
  });
});

describe('getApi', () => {
  it('returns null when the native bridge is absent', () => {
    expect(getApi()).toBeNull();
  });
});
