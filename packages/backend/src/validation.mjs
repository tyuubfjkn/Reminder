import { invalid } from './errors.mjs';

export function object(value, allowed, field = 'request') {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Object.keys(value).some(key => !allowed.includes(key))) invalid(field);
  return value;
}
export function revision(value) {
  if (!Number.isSafeInteger(value) || value < 1) invalid('expectedRevision');
  return value;
}
export function timeZone(value, field = 'timeZone') {
  if (typeof value !== 'string' || !value || value.length > 100 || /^[+-]/.test(value)) invalid(field);
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(); }
  catch { invalid(field); }
  return value;
}
function calendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const d = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === value;
}
function deadline(value) {
  if (value === null) return null;
  if (!value || typeof value !== 'object') invalid('deadline');
  if (value.kind === 'date') {
    object(value, ['kind','date','timeZone'], 'deadline');
    if (!calendarDate(value.date)) invalid('deadline');
    return {kind:'date',date:value.date,timeZone:timeZone(value.timeZone,'deadline')};
  }
  if (value.kind === 'instant') {
    object(value, ['kind','at','timeZone'], 'deadline');
    const match = typeof value.at === 'string' && value.at.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/);
    if (!match || !calendarDate(match[1]) || +match[2]>23 || +match[3]>59 || +match[4]>59) invalid('deadline');
    const zone = match[6];
    if (zone !== 'Z') {
      const hours=+zone.slice(1,3), minutes=+zone.slice(4,6);
      if (hours>14 || minutes>59 || (hours===14 && minutes!==0)) invalid('deadline');
    }
    const d=new Date(value.at);
    if (!Number.isFinite(d.getTime()) || d.getUTCFullYear()<1 || d.getUTCFullYear()>9999) invalid('deadline');
    return {kind:'instant',at:d.toISOString(),timeZone:timeZone(value.timeZone,'deadline')};
  }
  invalid('deadline');
}
const taskFields=['title','notes','priority','estimatedMinutes','deadline'];
export function taskFieldsInput(input, patch = false) {
  object(input, patch ? [...taskFields,'status'] : taskFields);
  if (patch && !Object.keys(input).length) invalid('patch');
  const result={};
  if (!patch || Object.hasOwn(input,'title')) {
    if (typeof input.title !== 'string' || !input.title.isWellFormed() || !input.title.trim() || input.title.trim().length>500) invalid('title');
    result.title=input.title.trim();
  }
  if (Object.hasOwn(input,'notes')) {
    if (typeof input.notes!=='string' || !input.notes.isWellFormed() || input.notes.length>10000) invalid('notes');
    result.notes=input.notes;
  }
  if (Object.hasOwn(input,'priority')) {
    if (!['low','normal','high'].includes(input.priority)) invalid('priority');
    result.priority=input.priority;
  }
  if (Object.hasOwn(input,'estimatedMinutes')) {
    const n=input.estimatedMinutes;
    if (n!==null && (!Number.isInteger(n) || n<1 || n>10080)) invalid('estimatedMinutes');
    result.estimatedMinutes=n;
  }
  if (Object.hasOwn(input,'deadline')) result.deadline=deadline(input.deadline);
  if (Object.hasOwn(input,'status')) {
    if (!['pending','completed'].includes(input.status)) invalid('status');
    result.status=input.status;
  }
  return result;
}
export function taskUpdate(input) {
  object(input,['id','expectedRevision','patch']);
  if (typeof input.id!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.id)) invalid('id');
  return {id:input.id,expectedRevision:revision(input.expectedRevision),patch:taskFieldsInput(input.patch,true)};
}
export function settingsUpdate(input) {
  object(input,['expectedRevision','patch']);
  revision(input.expectedRevision);
  object(input.patch,['locale','timeZone']);
  if (!Object.keys(input.patch).length) invalid('patch');
  const patch={};
  if (Object.hasOwn(input.patch,'locale')) {
    if (!['en-US','zh-CN'].includes(input.patch.locale)) invalid('locale');
    patch.locale=input.patch.locale;
  }
  if (Object.hasOwn(input.patch,'timeZone')) patch.timeZone=timeZone(input.patch.timeZone);
  return {expectedRevision:input.expectedRevision,patch};
}
