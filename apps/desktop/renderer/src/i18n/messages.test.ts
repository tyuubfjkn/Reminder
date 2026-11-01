import { errorMessage, messages, translate } from './messages';

describe('messages', () => {
  it('has a zh-CN string for every en-US key', () => {
    expect(Object.keys(messages['zh-CN']).sort()).toEqual(Object.keys(messages['en-US']).sort());
  });
  it('interpolates variables', () => {
    expect(translate('en-US', 'undo.completed', { title: 'Essay' })).toBe('Completed “Essay”.');
  });
  it('maps every error code to product copy, never the code itself', () => {
    for (const code of ['VALIDATION_ERROR','NOT_FOUND','CONFLICT','UNKNOWN_METHOD','STORAGE_ERROR','FORBIDDEN','IPC_FAILURE'] as const) {
      for (const locale of ['en-US','zh-CN'] as const) {
        const text = errorMessage(locale, { code });
        expect(text).toBeTruthy();
        expect(text).not.toContain(code);
      }
    }
  });
  it('uses field-specific validation copy', () => {
    expect(errorMessage('en-US', { code: 'VALIDATION_ERROR', field: 'title' })).toBe('Enter a title.');
    expect(errorMessage('zh-CN', { code: 'VALIDATION_ERROR', field: 'title' })).toBe('请输入标题。');
  });
});
