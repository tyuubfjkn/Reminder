import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { openStore } from '../src/store.mjs';
import { createDispatcher } from '../src/dispatch.mjs';

test('dispatcher returns contract errors and never leaks storage details', () => {
  const s=openStore(':memory:');
  const dispatch=createDispatcher(s);
  try {
    assert.deepEqual(dispatch('tasks.create',{title:'  '}),{ok:false,error:{code:'VALIDATION_ERROR',field:'title'}});
    assert.deepEqual(dispatch('settings.get',{secret:'bad'}),{ok:false,error:{code:'VALIDATION_ERROR',field:'request'}});
    assert.deepEqual(dispatch('constructor',{}),{ok:false,error:{code:'UNKNOWN_METHOD'}});
    const task=dispatch('tasks.create',{title:'Real'}).data;
    assert.equal(dispatch('tasks.update',{id:task.id,expectedRevision:1,patch:{status:'completed'}}).data.status,'completed');
    assert.deepEqual(dispatch('tasks.update',{id:task.id,expectedRevision:1,patch:{status:'pending'}}),{ok:false,error:{code:'CONFLICT'}});
    assert.equal(dispatch('settings.update',{expectedRevision:1,patch:{locale:'zh-CN'}}).data.locale,'zh-CN');
  } finally {s.close();}
  assert.deepEqual(dispatch('tasks.list'),{ok:false,error:{code:'STORAGE_ERROR'}});
});

function run(path, input) {
  return spawnSync(process.execPath,['packages/backend/src/cli.mjs','--db',path],{input,encoding:'utf8'});
}
test('independent CLI processes preserve tasks, completion and locale on disk', t => {
  const dir=mkdtempSync(join(tmpdir(),'reminder-process-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'test.sqlite');
  const first=run(path,[
    JSON.stringify({method:'tasks.create',params:{title:'中文 task'}}),
    JSON.stringify({method:'settings.update',params:{expectedRevision:1,patch:{locale:'zh-CN'}}}),
    'not json',
    JSON.stringify({method:'tasks.list',extra:1}),
    JSON.stringify({method:'tasks.list'})
  ].join('\n')+'\n');
  assert.equal(first.status,0,first.stderr);
  const replies=first.stdout.trim().split('\n').map(JSON.parse);
  assert.equal(replies.length,5); assert.equal(replies[0].ok,true);
  assert.equal(replies[2].error.code,'VALIDATION_ERROR'); assert.equal(replies[3].error.code,'VALIDATION_ERROR');
  assert.equal(replies[4].data.length,1);
  const id=replies[0].data.id;
  const second=run(path,JSON.stringify({method:'tasks.update',params:{id,expectedRevision:1,patch:{status:'completed'}}})+'\n');
  assert.equal(second.status,0,second.stderr); assert.equal(JSON.parse(second.stdout).data.status,'completed');
  const third=run(path,'{"method":"tasks.list"}\n{"method":"settings.get"}\n');
  assert.equal(third.status,0,third.stderr);
  const [tasks,prefs]=third.stdout.trim().split('\n').map(JSON.parse);
  assert.equal(tasks.data[0].title,'中文 task'); assert.equal(tasks.data[0].status,'completed'); assert.equal(tasks.data[0].revision,2);
  assert.equal(prefs.data.locale,'zh-CN');
});
test('CLI rejects missing database argument without silently creating storage', () => {
  const result=spawnSync(process.execPath,['packages/backend/src/cli.mjs'],{encoding:'utf8'});
  assert.equal(result.status,2); assert.match(result.stderr,/--db/);
});
