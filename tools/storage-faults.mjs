import assert from 'node:assert/strict';
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, statfsSync, unlinkSync, writeSync } from 'node:fs';
import { join, parse, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openStore } from '../packages/backend/src/store.mjs';
import { createDispatcher } from '../packages/backend/src/dispatch.mjs';

const [volume, token, sid] = process.argv.slice(2);
assert.equal(process.platform,'win32');
assert.equal(process.env.GITHUB_ACTIONS,'true');
assert.match(token ?? '', /^[0-9a-f-]{36}$/);
assert.match(sid ?? '', /^S-1-[0-9-]+$/);
assert.equal(resolve(volume),parse(resolve(volume)).root);
assert.equal(readFileSync(join(volume,'.reminder-fault-marker'),'utf8'),token);
const disk=statfsSync(volume);
assert.ok(disk.blocks*disk.bsize<=64*1024*1024 && disk.blocks*disk.bsize>=20*1024*1024);
const expectedFailure={ok:false,error:{code:'STORAGE_ERROR'}};

function seed(path) {
  const store=openStore(path,{timeZone:'UTC'});
  const task=store.createTask({title:'Preserve this task',notes:'Original notes'});
  const settings=store.updateSettings({expectedRevision:1,patch:{locale:'zh-CN'}});
  store.close();
  return {task,settings};
}
function fill(path) {
  const fd=openSync(path,'wx');
  let failed=false, total=0;
  try {
    for(const size of [1024*1024,4096]) {
      const bytes=Buffer.alloc(size,0x61);
      while(total<=64*1024*1024) {
        try { total+=writeSync(fd,bytes); }
        catch(error) { assert.equal(error.code,'ENOSPC'); failed=true; break; }
      }
    }
    fsyncSync(fd);
  } finally { closeSync(fd); }
  assert.ok(failed,'The test must induce a real OS ENOSPC, not simulate an error');
  console.log('[storage] Actual ENOSPC after filling dedicated VHD:',total);
}

for(const scenario of ['create','update','settings']) {
  const path=join(volume,`${scenario}.sqlite`), filler=join(volume,`${scenario}.filler`);
  const original=seed(path);
  let store=openStore(path), dispatch=createDispatcher(store);
  try {
    fill(filler);
    const result=scenario==='create' ? dispatch('tasks.create',{title:'Must not persist',notes:'x'.repeat(10000)})
      : scenario==='update' ? dispatch('tasks.update',{id:original.task.id,expectedRevision:1,patch:{notes:'x'.repeat(10000),priority:'high'}})
      : dispatch('settings.update',{expectedRevision:2,patch:{locale:'en-US'}});
    assert.deepEqual(result,expectedFailure,`${scenario}: sanitize actual storage failure`);
    assert.deepEqual(store.listTasks(),[original.task],`${scenario}: preserve all task fields and revision`);
    assert.deepEqual(store.getSettings(),original.settings,`${scenario}: preserve settings and revision`);
  } finally {
    // Free only this fixture's filler; do not touch the database or other data.
    if(existsSync(filler)) unlinkSync(filler);
    store.close();
  }
  store=openStore(path);
  try {
    assert.deepEqual(store.listTasks(),[original.task]);
    assert.deepEqual(store.getSettings(),original.settings);
    assert.equal(store.updateTask({id:original.task.id,expectedRevision:1,patch:{title:'Recovered'}}).revision,2);
  } finally { store.close(); }
  console.log(`[storage] ${scenario}: failure atomicity, restart and recovery passed`);
}

const path=join(volume,'denied.sqlite'), original=seed(path), before=readFileSync(path);
let restricted;
try {
  execFileSync('icacls.exe',[path,'/deny',`*${sid}:(W)`],{stdio:'inherit',windowsHide:true});
  let rawDenied=false;
  try { const fd=openSync(path,'r+'); closeSync(fd); }
  catch(error) { assert.ok(['EACCES','EPERM'].includes(error.code)); rawDenied=true; }
  assert.ok(rawDenied,'The ACL must actually reject a writable OS file handle');
  try {
    restricted=openStore(path);
  } catch(error) { assert.equal(error.code,'STORAGE_ERROR'); }
  if(restricted) {
    assert.deepEqual(createDispatcher(restricted)('tasks.update',{
      id:original.task.id,expectedRevision:1,patch:{title:'Must not persist'}
    }),expectedFailure);
  }
} finally {
  restricted?.close();
  execFileSync('icacls.exe',[path,'/remove:d',`*${sid}`],{stdio:'inherit',windowsHide:true});
}
assert.deepEqual(readFileSync(path),before,'Denied access must not reset or change the database');
const recovered=openStore(path);
try {
  assert.deepEqual(recovered.listTasks(),[original.task]);
  assert.deepEqual(recovered.getSettings(),original.settings);
  assert.equal(recovered.updateTask({id:original.task.id,expectedRevision:1,patch:{title:'Access restored'}}).revision,2);
} finally { recovered.close(); }
console.log('[storage] Actual Windows ACL denial, unchanged database, and recovery passed');
