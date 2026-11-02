import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {openStore} from '../src/store.mjs';

test('planned time persists independently from a date-only deadline and can be cleared',t=>{
  const dir=mkdtempSync(join(tmpdir(),'planned-'));
  const path=join(dir,'tasks.sqlite');let s=openStore(path);t.after(()=>{s.close();rmSync(dir,{recursive:true,force:true});});
  const task=s.createTask({title:'Cake',plannedAt:{at:'2027-04-15T16:00:00+01:00',timeZone:'Europe/London'},deadline:{kind:'date',date:'2027-04-20',timeZone:'Europe/London'}});
  assert.deepEqual(task.plannedAt,{at:'2027-04-15T15:00:00.000Z',timeZone:'Europe/London'});
  s.close();s=openStore(path);assert.deepEqual(s.listTasks()[0],task);
  const cleared=s.updateTask({id:task.id,expectedRevision:1,patch:{plannedAt:null}});
  assert.equal(cleared.plannedAt,null);assert.deepEqual(cleared.deadline,task.deadline);
});

test('invalid planned instants never mutate task or its revision',t=>{
  const s=openStore(':memory:');t.after(()=>s.close());const task=s.createTask({title:'Keep'});
  assert.equal(task.plannedAt,null);
  for(const plannedAt of [{at:'2027-02-30T12:00:00Z',timeZone:'UTC'},{at:'2027-04-15T12:00:00',timeZone:'UTC'},{at:'2027-04-15T12:00:00Z',timeZone:'No/Zone'},{kind:'date',date:'2027-04-15',timeZone:'UTC'}]) {
    assert.throws(()=>s.updateTask({id:task.id,expectedRevision:1,patch:{plannedAt}}),e=>e.code==='VALIDATION_ERROR'&&e.field==='plannedAt');
    assert.deepEqual(s.listTasks(),[task]);
  }
});

test('schema2 migration preserves rows and old receipt Undo supplies null planned time',t=>{
  const dir=mkdtempSync(join(tmpdir(),'planned-migrate-'));
  const path=join(dir,'tasks.sqlite'),db=new DatabaseSync(path),id=randomUUID(),requestId=randomUUID();
  db.exec(`CREATE TABLE tasks(id TEXT PRIMARY KEY,title TEXT NOT NULL,notes TEXT NOT NULL,status TEXT NOT NULL,completedAt TEXT,priority TEXT NOT NULL,estimatedMinutes INTEGER,deadlineJson TEXT,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,revision INTEGER NOT NULL) STRICT;
    CREATE TABLE settings(id INTEGER PRIMARY KEY,locale TEXT NOT NULL,timeZone TEXT NOT NULL,revision INTEGER NOT NULL) STRICT;
    CREATE TABLE assistant_runs(requestId TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,replyJson TEXT NOT NULL,inverseJson TEXT NOT NULL) STRICT;
    INSERT INTO settings VALUES(1,'en-US','UTC',1);PRAGMA user_version=2;`);
  const before={id,title:'Original',notes:'',status:'pending',completedAt:null,priority:'normal',estimatedMinutes:null,deadline:null,createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z',revision:1};
  db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,'Edited','', 'pending',null,'normal',null,null,before.createdAt,before.updatedAt,2);
  db.prepare('INSERT INTO assistant_runs VALUES(?,?,?,?)').run(requestId,'a'.repeat(64),JSON.stringify({requestId,language:'en-US',outcome:'applied',undoAvailable:true,changes:[{kind:'updated',taskId:id,title:'Edited'}]}),JSON.stringify([{before,after:{id,revision:2}}]));db.close();
  const s=openStore(path);t.after(()=>{s.close();rmSync(dir,{recursive:true,force:true});});assert.equal(s.listTasks()[0].plannedAt,null);assert.equal(s.listTasks()[0].title,'Edited');
  s.undoAssistantRun(requestId);assert.equal(s.listTasks()[0].title,'Original');assert.equal(s.listTasks()[0].plannedAt,null);assert.equal(s.listTasks()[0].revision,3);
});
