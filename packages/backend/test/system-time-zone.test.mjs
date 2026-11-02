import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {openStore} from '../src/store.mjs';
import {createAssistantService} from '../src/assistant/service.mjs';
const module=await import('../../../apps/desktop/main/system-time-zone.mjs').catch(()=>({}));
function setup(t) {
  assert.equal(typeof module.createSystemTimeZoneSync,'function');
  const store=openStore(':memory:',{timeZone:'UTC'});t.after(()=>store.close());
  let zone='Europe/London',notices=0;
  const sync=module.createSystemTimeZoneSync({store,readTimeZone:()=>zone,onChange:()=>notices++});
  return {store,sync,setZone:value=>zone=value,notices:()=>notices};
}
test('system zone is adopted at startup and changed once without rewriting task instants',t=>{
  const f=setup(t),task=f.store.createTask({title:'Cake',plannedAt:{at:'2027-04-15T15:00:00Z',timeZone:'Europe/London'},deadline:{kind:'date',date:'2027-04-20',timeZone:'Europe/London'}});
  assert.equal(f.sync.refresh().timeZone,'Europe/London');assert.equal(f.store.getSettings().revision,2);assert.equal(f.notices(),1);
  f.sync.refresh();assert.equal(f.store.getSettings().revision,2);
  f.setZone('Asia/Shanghai');f.sync.refresh();assert.equal(f.store.getSettings().revision,3);assert.equal(f.notices(),2);assert.deepEqual(f.store.listTasks(),[task]);
  f.setZone('Invalid/Zone');assert.equal(f.sync.refresh().timeZone,'Asia/Shanghai');assert.equal(f.store.getSettings().revision,3);
});
test('desktop settings identify system ownership, reject manual zone edits and preserve language updates',t=>{
  const f=setup(t),dispatch=module.createSystemDispatcher(f.store,f.sync);
  const first=dispatch('settings.get').data;assert.equal(first.timeZoneSource,'system');assert.equal(first.timeZone,'Europe/London');
  assert.equal(dispatch('settings.update',{expectedRevision:first.revision,patch:{timeZone:'UTC'}}).error.field,'timeZone');
  const changed=dispatch('settings.update',{expectedRevision:first.revision,patch:{locale:'zh-CN'}});assert.equal(changed.data.locale,'zh-CN');assert.equal(changed.data.timeZoneSource,'system');
  f.setZone('America/New_York');assert.equal(dispatch('settings.update',{expectedRevision:changed.data.revision,patch:{locale:'en-US'}}).error.code,'CONFLICT');
  assert.equal(dispatch('tasks.create',{title:'Manual still works'}).ok,true);
});
test('resume and polling refresh the zone and teardown removes both callbacks',t=>{
  const f=setup(t),events=new EventEmitter();let tick,cleared=false;
  const stop=module.watchSystemTimeZone(f.sync,events,{setInterval:(fn,ms)=>{assert.equal(ms,60000);tick=fn;return 123;},clearInterval:id=>{assert.equal(id,123);cleared=true;}});
  f.setZone('Asia/Shanghai');events.emit('resume');assert.equal(f.store.getSettings().timeZone,'Asia/Shanghai');
  f.setZone('America/New_York');tick();assert.equal(f.store.getSettings().timeZone,'America/New_York');
  stop();assert.equal(cleared,true);assert.equal(events.listenerCount('resume'),0);
});
test('system zone change before confirmation rejects old proposal and keeps all tasks unchanged',async t=>{
  const f=setup(t);const service=createAssistantService({store:f.store,refreshSettings:()=>f.sync.refresh(),vault:{getCredential:async()=>({apiKey:'fixture'})},provider:{propose:async()=>({outcome:'apply',language:'en-US',operations:[{kind:'create',input:{title:'Cake',plannedAt:{kind:'local',date:'2027-04-15',time:'16:00'}}}]})}});
  const r=await service.submit({requestId:randomUUID(),text:'Cake at four'});assert.equal(r.data.outcome,'proposal');assert.equal(r.data.proposal.changes[0].fields.plannedAt.timeZone,'Europe/London');
  f.setZone('Asia/Shanghai');const yes=await service.submit({requestId:randomUUID(),text:'yes',conversationId:r.data.conversationId,proposalId:r.data.proposal.id});
  assert.equal(yes.error.code,'CONFLICT');assert.equal(f.store.listTasks().length,0);
});
test('zone change permits a fresh message after the renderer invalidates its old preview',async t=>{
  const f=setup(t);const service=createAssistantService({store:f.store,refreshSettings:()=>f.sync.refresh(),vault:{getCredential:async()=>({apiKey:'fixture'})},provider:{propose:async()=>({outcome:'apply',language:'en-US',operations:[{kind:'create',input:{title:'Cake'}}]})}});
  const r=await service.submit({requestId:randomUUID(),text:'Cake'});assert.equal(r.data.outcome,'proposal');
  f.setZone('Asia/Shanghai');const fresh=await service.submit({requestId:randomUUID(),text:'New cake proposal',conversationId:r.data.conversationId});
  assert.equal(fresh.ok,true);assert.equal(fresh.data.outcome,'proposal');assert.notEqual(fresh.data.proposal.id,r.data.proposal.id);assert.equal(f.store.listTasks().length,0);
});
