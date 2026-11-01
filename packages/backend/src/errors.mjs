export class AppError extends Error {
  constructor(code, field) {
    super(code);
    this.name = 'AppError';
    this.code = code;
    if (field) this.field = field;
  }
}
export function invalid(field = 'request') { throw new AppError('VALIDATION_ERROR', field); }
