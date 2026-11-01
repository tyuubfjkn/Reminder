import { formatDeadline, formatMinutes, isOverdue, resolveZoned, utcToZoned } from './time';

describe('resolveZoned', () => {
  it('converts wall time in a zone to a UTC instant', () => {
    expect(resolveZoned('2026-11-06', '17:00', 'Asia/Shanghai')).toEqual({ kind: 'ok', at: '2026-11-06T09:00:00.000Z' });
  });
  it('respects daylight saving in the target zone', () => {
    expect(resolveZoned('2026-07-01', '09:30', 'America/New_York')).toEqual({ kind: 'ok', at: '2026-07-01T13:30:00.000Z' });
    expect(resolveZoned('2026-12-01', '09:30', 'America/New_York')).toEqual({ kind: 'ok', at: '2026-12-01T14:30:00.000Z' });
  });
  it('reports wall times skipped by a spring-forward gap instead of inventing another time', () => {
    expect(resolveZoned('2027-03-14', '02:30', 'America/New_York')).toEqual({ kind: 'gap' });
    expect(resolveZoned('2027-03-28', '02:30', 'Europe/Berlin')).toEqual({ kind: 'gap' });
  });
  it('reports both occurrences of a repeated fall-back wall time', () => {
    expect(resolveZoned('2027-11-07', '01:30', 'America/New_York'))
      .toEqual({ kind: 'fold', earlier: '2027-11-07T05:30:00.000Z', later: '2027-11-07T06:30:00.000Z' });
    expect(resolveZoned('2027-10-31', '02:30', 'Europe/Berlin'))
      .toEqual({ kind: 'fold', earlier: '2027-10-31T00:30:00.000Z', later: '2027-10-31T01:30:00.000Z' });
  });
  it('treats the boundary minutes around a transition as ordinary', () => {
    expect(resolveZoned('2027-03-14', '03:00', 'America/New_York')).toEqual({ kind: 'ok', at: '2027-03-14T07:00:00.000Z' });
    expect(resolveZoned('2027-11-07', '02:00', 'America/New_York')).toEqual({ kind: 'ok', at: '2027-11-07T07:00:00.000Z' });
  });
  it('round-trips through utcToZoned', () => {
    expect(utcToZoned('2026-11-06T09:00:00.000Z', 'Asia/Shanghai')).toEqual({ date: '2026-11-06', time: '17:00' });
  });
});

describe('formatDeadline', () => {
  const dateOnly = { kind: 'date' as const, date: '2026-11-06', timeZone: 'Europe/London' };
  it('never shifts a date-only deadline, whatever the host or display zone', () => {
    // Host TZ is Pacific/Kiritimati (UTC+14) in tests.
    expect(formatDeadline(dateOnly, 'en-US', 'Pacific/Pago_Pago')).toBe('Fri, Nov 6, 2026');
    expect(formatDeadline(dateOnly, 'zh-CN', 'Pacific/Pago_Pago')).toBe('2026年11月6日周五');
  });
  it('shows exact deadlines in the selected time zone', () => {
    const at = { kind: 'instant' as const, at: '2026-11-06T09:00:00.000Z', timeZone: 'Europe/London' };
    expect(formatDeadline(at, 'en-US', 'Asia/Shanghai')).toMatch(/Nov 6, 2026.*5:00\sPM/);
    expect(formatDeadline(at, 'en-US', 'America/Los_Angeles')).toMatch(/Nov 6, 2026.*1:00\sAM/);
  });
});

describe('formatMinutes', () => {
  it('formats hours and minutes per locale', () => {
    expect(formatMinutes(180, 'en-US')).toBe('3 hr');
    expect(formatMinutes(95, 'en-US')).toBe('1 hr 35 min');
    expect(formatMinutes(45, 'zh-CN')).toBe('45分钟');
  });
});

describe('isOverdue', () => {
  const now = new Date('2026-11-07T12:00:00.000Z');
  it('treats a date-only deadline as overdue only after that date in the display zone', () => {
    expect(isOverdue({ kind: 'date', date: '2026-11-06', timeZone: 'UTC' }, now, 'UTC')).toBe(true);
    expect(isOverdue({ kind: 'date', date: '2026-11-07', timeZone: 'UTC' }, now, 'UTC')).toBe(false);
  });
  it('compares instants directly', () => {
    expect(isOverdue({ kind: 'instant', at: '2026-11-07T11:59:00.000Z', timeZone: 'UTC' }, now, 'UTC')).toBe(true);
    expect(isOverdue(null, now, 'UTC')).toBe(false);
  });
});
