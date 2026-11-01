import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../src/store.mjs';

function fixture(t) {
  const dir=mkdtempSync(join(tmpdir(),'reminder-ai-store-')),path=join(dir,'tasks.sqlite'),stores=[];
  t.after(()=>{for(const s of stores)s.close();rmSync(dir,{recursive:true,force:true});});
  return {path,open(){const s=openStore(path,{timeZone:'UTC'});stores.push(s);return s;}};
}
const fingerprint='a'.repeat(64);
function run(operations,extra={}) { const requestId=randomUUID();return {requestId,fingerprint,settingsRevision:1,
  reply:{requestId,conversationId:randomUUID(),language:'en-US',outcome:operations.length?'applied':'clarification',message:'',changes:[],undoAvailable:false},operations,...extra}; }
const fails=(fn,code)=>assert.throws(fn,e=>e.code===code);

test('AI batch commits validated changes and receipt once across reopen',t=>{
  const f=fixture(t);let s=f.open();const old=s.createTask({title:'Math'});
  const input=run([{kind:'create',input:{title:'Essay',estimatedMinutes:180}},{kind:'update',id:old.id,expectedRevision:1,patch:{status:'completed'}}]);
  assert.equal(typeof s.applyAssistantRun,'function','Atomic assistant operations are available');
  const receipt=s.applyAssistantRun(input);
  assert.equal(receipt.changes.length,2);assert.equal(receipt.undoAvailable,true);assert.equal(s.listTasks().length,2);
  assert.equal(s.listTasks().find(t=>t.id===old.id).status,'completed');
  s.close();s=f.open();
  assert.deepEqual(s.getAssistantRun(input.requestId,fingerprint),receipt);
  assert.deepEqual(s.applyAssistantRun(input),receipt);assert.equal(s.listTasks().length,2);
  fails(()=>s.getAssistantRun(input.requestId,'b'.repeat(64)),'CONFLICT');
});
test('invalid or stale operation and settings revision roll back the entire batch',t=>{
  const s=fixture(t).open(),old=s.createTask({title:'Keep me'});
  assert.equal(typeof s.applyAssistantRun,'function');
  for(const second of [
    {kind:'update',id:old.id,expectedRevision:2,patch:{title:'Stale'}},
    {kind:'update',id:old.id,expectedRevision:1,patch:{priority:'invalid'}}
  ]) {
    const input=run([{kind:'create',input:{title:'Must roll back'}},second]);
    assert.throws(()=>s.applyAssistantRun(input));
    assert.deepEqual(s.listTasks(),[old]);assert.equal(s.getAssistantRun(input.requestId,fingerprint),null);
  }
  const input=run([{kind:'create',input:{title:'Wrong zone snapshot'}}]);
  s.updateSettings({expectedRevision:1,patch:{timeZone:'Asia/Shanghai'}});
  fails(()=>s.applyAssistantRun(input),'CONFLICT');assert.deepEqual(s.listTasks(),[old]);
});
test('batch undo restores exact old values with increasing revision, removes only unchanged creates, and is idempotent',t=>{
  const f=fixture(t);let s=f.open();const first=s.createTask({title:'Done'});
  const old=s.updateTask({id:first.id,expectedRevision:1,patch:{status:'completed'}});
  assert.equal(typeof s.applyAssistantRun,'function');
  const input=run([{kind:'create',input:{title:'New task'}},{kind:'update',id:old.id,expectedRevision:2,patch:{status:'pending',notes:'Changed'}}]);
  s.applyAssistantRun(input);s.close();s=f.open();
  const undone=s.undoAssistantRun(input.requestId);
  assert.equal(undone.outcome,'undone');assert.equal(undone.undoAvailable,false);
  assert.deepEqual(s.listTasks().map(x=>({...x,revision:old.revision,updatedAt:old.updatedAt})),[old]);
  assert.equal(s.listTasks()[0].revision,4);
  assert.deepEqual(s.undoAssistantRun(input.requestId),undone);
  assert.deepEqual(s.getAssistantRun(input.requestId,fingerprint),undone);
  assert.deepEqual(s.applyAssistantRun(input),undone);assert.equal(s.listTasks().length,1);
});
test('intervening edits block every undo change without deleting created tasks',t=>{
  const s=fixture(t).open(),old=s.createTask({title:'Original'});
  assert.equal(typeof s.applyAssistantRun,'function');
  const input=run([{kind:'create',input:{title:'New'}},{kind:'update',id:old.id,expectedRevision:1,patch:{title:'AI edited'}}]);
  s.applyAssistantRun(input);
  const created=s.listTasks().find(x=>x.id!==old.id);
  s.updateTask({id:created.id,expectedRevision:1,patch:{notes:'Later manual edit'}});
  const before=s.listTasks();fails(()=>s.undoAssistantRun(input.requestId),'CONFLICT');assert.deepEqual(s.listTasks(),before);
});
test('schema1 migration keeps existing task/settings rows and rejects future schemas',t=>{
  const f=fixture(t),db=new DatabaseSync(f.path);
  db.exec(`CREATE TABLE tasks(id TEXT PRIMARY KEY,title TEXT NOT NULL,notes TEXT NOT NULL,status TEXT NOT NULL,completedAt TEXT,priority TEXT NOT NULL,estimatedMinutes INTEGER,deadlineJson TEXT,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,revision INTEGER NOT NULL) STRICT;
    CREATE TABLE settings(id INTEGER PRIMARY KEY,locale TEXT NOT NULL,timeZone TEXT NOT NULL,revision INTEGER NOT NULL) STRICT;
    INSERT INTO settings VALUES(1,'zh-CN','Asia/Shanghai',7);PRAGMA user_version=1;`);
  const id=randomUUID();db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,'原任务','notes','completed','2026-01-01T00:00:00.000Z','high',30,null,'2025-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',9);db.close();
  const s=f.open();assert.equal(typeof s.applyAssistantRun,'function');
  assert.equal(s.listTasks()[0].id,id);assert.equal(s.listTasks()[0].revision,9);assert.equal(s.listTasks()[0].completedAt,'2026-01-01T00:00:00.000Z');
  assert.deepEqual(s.getSettings(),{locale:'zh-CN',timeZone:'Asia/Shanghai',revision:7});
  s.close();const check=new DatabaseSync(f.path);assert.equal(check.prepare('PRAGMA user_version').get().user_version,2);check.close();
});
