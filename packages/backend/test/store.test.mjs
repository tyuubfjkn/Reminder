import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../src/store.mjs';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'reminder-test-'));
  const path = join(dir, 'tasks.sqlite');
  const stores = [];
  t.after(() => { for (const s of stores) s.close(); rmSync(dir, {recursive:true, force:true}); });
  return { path, open: () => { const s = openStore(path, {timeZone:'Europe/London'}); stores.push(s); return s; } };
}
const rejects = (fn, code, field) => assert.throws(fn, e => e.code === code && (!field || e.field === field));

test('create and edit bilingual tasks persist across database reopen', t => {
  const f = fixture(t); let s = f.open();
  const a = s.createTask({title:'  数学 homework  ', notes:'原文\nKeep this', estimatedMinutes:30});
  assert.equal(a.title, '数学 homework'); assert.equal(a.notes, '原文\nKeep this');
  assert.equal(a.status,'pending'); assert.equal(a.completedAt,null); assert.equal(a.priority,'normal');
  assert.equal(a.revision,1); assert.equal(a.deadline,null);
  const b = s.updateTask({id:a.id, expectedRevision:1, patch:{title:'Revised 作业', priority:'high'}});
  assert.equal(b.revision,2); assert.equal(b.estimatedMinutes,30);
  s.close(); s = f.open();
  assert.deepEqual(s.listTasks(),[b]);
});

test('explicit completion and reopening persist; passage of deadline does not complete', t => {
  const f=fixture(t); let s=f.open();
  const a=s.createTask({title:'Essay',deadline:{kind:'date',date:'2000-01-01',timeZone:'Asia/Shanghai'}});
  assert.equal(s.listTasks()[0].status,'pending');
  const b=s.updateTask({id:a.id,expectedRevision:1,patch:{status:'completed'}});
  assert.ok(b.completedAt); assert.equal(b.status,'completed');
  const c=s.updateTask({id:a.id,expectedRevision:2,patch:{status:'completed'}});
  assert.equal(c.completedAt,b.completedAt);
  s.close(); s=f.open(); assert.deepEqual(s.listTasks()[0],c);
  const d=s.updateTask({id:a.id,expectedRevision:3,patch:{status:'pending'}});
  assert.equal(d.completedAt,null); assert.equal(d.status,'pending');
});

test('date-only stays date-only while explicit offset instants normalize to UTC', t => {
  const s=fixture(t).open();
  const date={kind:'date',date:'2028-02-29',timeZone:'Pacific/Auckland'};
  const a=s.createTask({title:'Date only',deadline:date});
  assert.deepEqual(a.deadline,date);
  const b=s.updateTask({id:a.id,expectedRevision:1,patch:{deadline:{kind:'instant',at:'2026-11-01T01:30:00-07:00',timeZone:'America/Los_Angeles'}}});
  assert.equal(b.deadline.at,'2026-11-01T08:30:00.000Z');
  const c=s.updateTask({id:a.id,expectedRevision:2,patch:{deadline:null,estimatedMinutes:null}});
  assert.equal(c.deadline,null); assert.equal(c.estimatedMinutes,null);
});

test('reject malformed input before persistence', t => {
  const s=fixture(t).open();
  const bad = [
    [null,'request'], [[], 'request'], [{},'title'], [{title:'   '},'title'],
    [{title:'x'.repeat(501)},'title'], [{title:'ok',notes:null},'notes'],
    [{title:'ok',notes:'x'.repeat(10001)},'notes'], [{title:'ok',priority:'urgent'},'priority'],
    [{title:'ok',estimatedMinutes:0},'estimatedMinutes'],
    [{title:'ok',estimatedMinutes:1.5},'estimatedMinutes'],
    [{title:'ok',estimatedMinutes:10081},'estimatedMinutes'],
    [{title:'ok',status:'completed'},'request'],
    [{title:'ok',deadline:{kind:'date',date:'2026-02-29',timeZone:'UTC'}},'deadline'],
    [{title:'ok',deadline:{kind:'date',date:'0000-01-01',timeZone:'UTC'}},'deadline'],
    [{title:'ok',deadline:{kind:'date',date:'2026-01-01',timeZone:'Mars/Base'}},'deadline'],
    [{title:'ok',deadline:{kind:'instant',at:'2026-01-01T01:00:00',timeZone:'UTC'}},'deadline'],
    [{title:'ok',deadline:{kind:'instant',at:'2026-02-30T01:00:00Z',timeZone:'UTC'}},'deadline'],
    [{title:'ok',deadline:{kind:'instant',at:'2026-01-01T24:00:00Z',timeZone:'UTC'}},'deadline'],
    [{title:'ok',deadline:{kind:'instant',at:'2026-01-01T01:00:00+14:01',timeZone:'UTC'}},'deadline'],
    [{title:'ok',deadline:{kind:'date',date:'2026-01-01',timeZone:'UTC',at:'extra'}},'deadline']
  ];
  for (const [input,field] of bad) rejects(()=>s.createTask(input),'VALIDATION_ERROR',field);
  assert.deepEqual(s.listTasks(),[]);
});

test('CAS prevents stale edits from a second connection and failed patch is atomic', t => {
  const f=fixture(t), one=f.open(), two=f.open();
  const a=one.createTask({title:'first'});
  const b=two.updateTask({id:a.id,expectedRevision:1,patch:{title:'new'}});
  rejects(()=>one.updateTask({id:a.id,expectedRevision:1,patch:{title:'lost edit'}}),'CONFLICT');
  rejects(()=>one.updateTask({id:a.id,expectedRevision:2,patch:{title:'partial',priority:'bad'}}),'VALIDATION_ERROR');
  assert.deepEqual(one.listTasks(),[b]);
  for(const input of [
    {id:a.id,expectedRevision:2,patch:{}},
    {id:a.id,expectedRevision:2,patch:{revision:100}},
    {id:a.id,expectedRevision:0,patch:{status:'pending'}},
    {id:a.id,expectedRevision:2,patch:{status:'done'}}
  ]) rejects(()=>one.updateTask(input),'VALIDATION_ERROR');
  rejects(()=>one.updateTask({id:'550e8400-e29b-41d4-a716-446655440000',expectedRevision:1,patch:{title:'none'}}),'NOT_FOUND');
});

test('locale defaults to en-US independently of timezone; settings persist and reject stale updates', t => {
  const f=fixture(t); let s=f.open();
  const task=s.createTask({title:'不要翻译'});
  assert.deepEqual(s.getSettings(),{locale:'en-US',timeZone:'Europe/London',revision:1});
  const p=s.updateSettings({expectedRevision:1,patch:{locale:'zh-CN'}});
  assert.deepEqual(p,{locale:'zh-CN',timeZone:'Europe/London',revision:2});
  rejects(()=>s.updateSettings({expectedRevision:1,patch:{locale:'en-US'}}),'CONFLICT');
  for (const patch of [{locale:'en-GB'},{timeZone:'invalid'}, {}, {locale:null}, {revision:55}])
    rejects(()=>s.updateSettings({expectedRevision:2,patch}),'VALIDATION_ERROR');
  s.close(); s=f.open();
  assert.deepEqual(s.getSettings(),p); assert.deepEqual(s.listTasks(),[task]);
  assert.equal(s.updateSettings({expectedRevision:2,patch:{timeZone:'Asia/Shanghai'}}).locale,'zh-CN');
});

test('SQL-like content is stored literally and does not affect other tasks', t => {
  const s=fixture(t).open();
  const title="'); DROP TABLE tasks; --";
  s.createTask({title}); s.createTask({title:'still here'});
  assert.equal(s.listTasks().length,2);
  assert.ok(s.listTasks().some(a=>a.title===title));
});

test('future schema and corrupt databases fail closed without reset', t => {
  const f=fixture(t);
  const d=new DatabaseSync(f.path); d.exec('PRAGMA user_version=99'); d.close();
  rejects(()=>f.open(),'STORAGE_ERROR');
  const verify=new DatabaseSync(f.path); assert.equal(verify.prepare('PRAGMA user_version').get().user_version,99); verify.close();
  const other=join(f.path,'missing-parent.sqlite');
  rejects(()=>openStore(other),'STORAGE_ERROR');
  writeFileSync(f.path,'not a sqlite database');
  rejects(()=>f.open(),'STORAGE_ERROR');
});
