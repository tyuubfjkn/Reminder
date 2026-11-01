import type { Deadline, Locale } from './api/contract';

function zoneParts(ms: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour'), mi: get('minute'), s: get('second') };
}

function utcMs(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number {
  const at = new Date(0);
  at.setUTCFullYear(y, mo - 1, d);
  at.setUTCHours(h, mi, s, 0);
  return at.getTime();
}

function offsetMs(ms: number, timeZone: string): number {
  const p = zoneParts(ms, timeZone);
  return utcMs(p.y, p.mo, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

/** Wall-clock date (YYYY-MM-DD) and time (HH:mm) in `timeZone` to a UTC ISO instant. */
export function zonedToUtcIso(date: string, time: string, timeZone: string): string {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const wall = utcMs(y, mo, d, h, mi);
  let utc = wall - offsetMs(wall, timeZone);
  const corrected = wall - offsetMs(utc, timeZone);
  if (corrected !== utc) utc = corrected;
  return new Date(utc).toISOString();
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function utcToZoned(at: string, timeZone: string): { date: string; time: string } {
  const p = zoneParts(Date.parse(at), timeZone);
  return { date: `${pad(p.y, 4)}-${pad(p.mo)}-${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.mi)}` };
}

/** Today's calendar date in `timeZone`, as YYYY-MM-DD. */
export function todayIn(timeZone: string, now = new Date()): string {
  return utcToZoned(now.toISOString(), timeZone).date;
}

const dateOptions: Intl.DateTimeFormatOptions = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' };

export function formatDeadline(deadline: Deadline, locale: Locale, displayTimeZone: string): string {
  if (deadline.kind === 'date') {
    // A date-only deadline is a calendar date: format it in UTC, where it cannot shift.
    const [y, mo, d] = deadline.date.split('-').map(Number);
    return new Intl.DateTimeFormat(locale, { ...dateOptions, timeZone: 'UTC' }).format(utcMs(y, mo, d));
  }
  return formatInstant(deadline.at, locale, displayTimeZone);
}

export function formatInstant(at: string, locale: Locale, displayTimeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    ...dateOptions, hour: 'numeric', minute: '2-digit', timeZone: displayTimeZone, timeZoneName: 'short'
  }).format(new Date(at));
}

export function formatMinutes(minutes: number, locale: Locale): string {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  const unit = (value: number, unit: 'hour' | 'minute') =>
    new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'short' }).format(value);
  if (!h) return unit(m, 'minute');
  return m ? `${unit(h, 'hour')} ${unit(m, 'minute')}` : unit(h, 'hour');
}

export function isOverdue(deadline: Deadline | null, now: Date, displayTimeZone: string): boolean {
  if (!deadline) return false;
  if (deadline.kind === 'instant') return Date.parse(deadline.at) < now.getTime();
  return deadline.date < todayIn(displayTimeZone, now);
}
