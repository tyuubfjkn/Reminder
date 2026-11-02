import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openStore} from '../src/store.mjs';
const module=await import('../src/assistant/service.mjs').catch(()=>({}));
const create=(title='Essay',extra={})=>({outcome:'apply',language:'en-US',operations:[{kind:'create',input:{title,...extra}}]});
const input=(text='Add essay',extra={})=>({requestId:randomUUID(),text,...extra});
const confirmInput=r=>input('yes',{conversationId:r.data.conversationId,proposalId:r.data.proposal.id,decision:'confirm'});
const confirm=(service,r)=>{assert.equal(r.data.outcome,'proposal');return service.submit(confirmInput(r));};
function fixture(t,propose,options={}) {
  assert.equal(typeof module.createAssistantService,'function');
  const store=openStore(':memory:',{timeZone:'America/New_York'});t.after(()=>store.close());
  const vault={getCredential:async()=>({apiKey:'private-sentinel',model:'deepseek-flash'}),getConfig:async()=>({provider:'deepseek',model:'deepseek-flash',hasKey:true}),configure:async()=>({})};
  return {store,service:module.createAssistantService({store,vault,provider:{propose},clock:()=>new Date('2026-11-01T12:00:00Z'),regionalLocale:'en-GB',...options})};
}
test('bilingual creation preserves task text/date-only and returns local receipts; replay and undo do not call provider',async t=>{
  let calls=0;const {store,service}=fixture(t,async()=>{calls++;return {...create('数学作业',{deadline:{kind:'date',date:'2027-03-14'}}),language:'zh-CN'};});
  const req=input('添加数学作业'),p=await service.submit(req);assert.equal(p.data.outcome,'proposal');assert.equal(store.listTasks().length,0);const approved=confirmInput(p),r=await service.submit(approved);
  assert.equal(r.ok,true);assert.equal(r.data.language,'zh-CN');assert.match(r.data.message,/已保存/);
  assert.equal(store.listTasks()[0].title,'数学作业');assert.deepEqual(store.listTasks()[0].deadline,{kind:'date',date:'2027-03-14',timeZone:'America/New_York'});
  assert.equal((await service.submit(req)).data.replayed,true);assert.equal(calls,1);
  assert.equal((await service.submit({...req,text:'different'})).error.code,'CONFLICT');
  assert.equal((await service.undo({requestId:approved.requestId})).data.outcome,'undone');assert.equal(store.listTasks().length,0);
  assert.equal((await service.submit(approved)).data.outcome,'undone');assert.equal(calls,1);
});
test('gap creates nothing; fold requires a bound explicit occurrence choice',async t=>{
  let deadline={kind:'local',date:'2027-03-14',time:'02:30'};
  const {store,service}=fixture(t,async()=>create('Deadline',{deadline}));
  const gap=await service.submit(input());assert.equal(gap.data.outcome,'clarification');assert.equal(store.listTasks().length,0);
  deadline={kind:'local',date:'2027-11-07',time:'01:30'};
  const fold=await service.submit(input());assert.equal(fold.data.choices.kind,'occurrence');assert.equal(fold.data.choices.later,'2027-11-07T06:30:00.000Z');
  const chosen=await service.submit(input('Second',{conversationId:fold.data.conversationId,clarificationId:fold.data.clarificationId,choice:{occurrence:'later'}}));
  assert.equal(chosen.ok,true);assert.equal((await confirm(service,chosen)).data.outcome,'applied');assert.equal(store.listTasks()[0].deadline.at,'2027-11-07T06:30:00.000Z');
  assert.equal((await service.submit(input('Second',{conversationId:fold.data.conversationId,clarificationId:fold.data.clarificationId,choice:{occurrence:'later'}}))).error.code,'VALIDATION_ERROR');
});
test('Berlin gap/fold and a unique wall time use the saved zone',async t=>{
  let deadline={kind:'local',date:'2027-03-28',time:'02:30'};
  const {store,service}=fixture(t,async()=>create('Berlin',{deadline}));store.updateSettings({expectedRevision:1,patch:{timeZone:'Europe/Berlin'}});
  assert.equal((await service.submit(input())).data.outcome,'clarification');
  deadline={kind:'local',date:'2027-10-31',time:'02:30'};const fold=await service.submit(input());
  assert.equal(fold.data.choices.earlier,'2027-10-31T00:30:00.000Z');assert.equal(fold.data.choices.later,'2027-10-31T01:30:00.000Z');
  deadline={kind:'local',date:'2027-04-01',time:'12:00'};assert.equal((await confirm(service,await service.submit(input()))).data.outcome,'applied');
  assert.equal(store.listTasks()[0].deadline.at,'2027-04-01T10:00:00.000Z');
});
test('duplicate titles require explicit candidate; a choice targets the selected task only',async t=>{
  let id;const {store,service}=fixture(t,async()=>({outcome:'apply',language:'en-US',operations:[{kind:'update',id,patch:{status:'completed'}}]}));
  const a=store.createTask({title:'Math'}),b=store.createTask({title:' math '});id=a.id;
  const first=await service.submit(input('Finish math'));assert.equal(first.data.choices.tasks.length,2);assert.equal(store.listTasks().every(x=>x.status==='pending'),true);
  const selected=await service.submit(input('This one',{conversationId:first.data.conversationId,clarificationId:first.data.clarificationId,choice:{taskId:b.id}}));
  assert.equal((await confirm(service,selected)).data.outcome,'applied');assert.equal(store.listTasks().find(x=>x.id===a.id).status,'pending');assert.equal(store.listTasks().find(x=>x.id===b.id).status,'completed');
});
test('manual task or settings edit during provider wait aborts the whole batch',async t=>{
  let mutate,id;const {store,service}=fixture(t,async()=>{mutate();return {outcome:'apply',language:'en-US',operations:[{kind:'create',input:{title:'Must not appear'}},{kind:'update',id,patch:{status:'completed'}}]};});
  id=store.createTask({title:'Original'}).id;
  mutate=()=>store.updateTask({id,expectedRevision:1,patch:{notes:'manual'}});
  assert.equal((await service.submit(input())).error.code,'CONFLICT');assert.equal(store.listTasks().length,1);assert.equal(store.listTasks()[0].status,'pending');
  mutate=()=>store.updateSettings({expectedRevision:1,patch:{timeZone:'UTC'}});
  assert.equal((await service.submit(input())).error.code,'CONFLICT');assert.equal(store.listTasks().length,1);
});
test('untrusted IDs/fields and unsupported proposals cause no task writes; notes/keys absent from messages',async t=>{
  let intent=create();const {store,service}=fixture(t,async request=>{const prompt=JSON.stringify(request.messages);assert.ok(!prompt.includes('private-sentinel'));assert.ok(!prompt.includes('private-note'));assert.match(prompt,/en-GB/);assert.match(prompt,/2026-11-01/);return intent;});
  store.createTask({title:'Keep',notes:'private-note'});
  for(const bad of [{outcome:'apply',language:'en-US',operations:[{kind:'update',id:randomUUID(),patch:{status:'completed'}}]}, {...create(),sql:'anything'}]) {
    intent=bad;assert.equal((await service.submit(input())).ok,false);assert.equal(store.listTasks().length,1);
  }
  intent={outcome:'unsupported',language:'en-US',question:'Reminders are not available yet.'};assert.equal((await service.submit(input())).data.outcome,'unsupported');assert.equal(store.listTasks().length,1);
});
test('in-flight retries coalesce, manual operations stay responsive, bounded admission rejects overflow',async t=>{
  let release,calls=0;const ready=new Promise(resolve=>release=resolve);
  const {store,service}=fixture(t,async()=>{calls++;await ready;return create();});
  const req=input(),a=service.submit(req),b=service.submit(req);
  store.createTask({title:'Manual during wait'});assert.equal(store.listTasks().length,1);
  release();const results=await Promise.all([a,b]);assert.equal(results.every(r=>r.ok),true);assert.equal(calls,1);assert.equal(store.listTasks().length,1);await confirm(service,results[0]);assert.equal(store.listTasks().length,2);
});
test('general clarification supports follow-up; expired or unknown conversation is explicit',async t=>{
  let now=new Date('2026-11-01T12:00:00Z'),calls=0;
  const {service}=fixture(t,async request=>{calls++;if(calls===1)return {outcome:'clarification',language:'en-US',question:'Which date?'};assert.ok(request.messages.some(m=>m.content==='Which date?'));return create();},{clock:()=>now});
  const first=await service.submit(input('Add essay by 03/04'));
  assert.equal((await confirm(service,await service.submit(input('April 3',{conversationId:first.data.conversationId})))).data.outcome,'applied');
  now=new Date('2026-11-01T13:00:00Z');assert.equal((await service.submit(input('More',{conversationId:first.data.conversationId}))).error.code,'AI_CONVERSATION_EXPIRED');
});
test('missing key and context overflow leave manual task operations available',async t=>{
  const {store,service}=fixture(t,async()=>create(),{vault:{getCredential:async()=>null}});
  assert.equal((await service.submit(input())).error.code,'AI_NOT_CONFIGURED');assert.equal(store.createTask({title:'Still works'}).title,'Still works');
  const f=fixture(t,async()=>{assert.fail('must not send oversized context');});
  for(let i=0;i<201;i++) f.store.createTask({title:'Task '+i});
  assert.equal((await f.service.submit(input())).error.code,'AI_CONTEXT_LIMIT');
});

test('interleaved fold and duplicate-target choices never inherit an unrelated occurrence',async t=>{
  let id;const deadline={kind:'local',date:'2027-11-07',time:'01:30'};
  const {store,service}=fixture(t,async()=>({outcome:'apply',language:'en-US',operations:[
    {kind:'create',input:{title:'Essay',deadline}},
    {kind:'update',id,patch:{deadline}}
  ]}));
  id=store.createTask({title:'Math'}).id;const other=store.createTask({title:'Math'});
  const first=(await service.submit(input())).data;
  const second=(await service.submit(input('Second',{conversationId:first.conversationId,clarificationId:first.clarificationId,choice:{occurrence:'later'}}))).data;
  assert.equal(second.choices.kind,'task');
  const third=(await service.submit(input('This Math',{conversationId:first.conversationId,clarificationId:second.clarificationId,choice:{taskId:other.id}}))).data;
  assert.equal(third.outcome,'clarification');assert.equal(third.choices.kind,'occurrence');assert.equal(store.listTasks().length,2);
  const final=await service.submit(input('First',{conversationId:first.conversationId,clarificationId:third.clarificationId,choice:{occurrence:'earlier'}}));
  assert.equal((await confirm(service,final)).data.outcome,'applied');
  assert.equal(store.listTasks().find(t=>t.id===other.id).deadline.at,'2027-11-07T05:30:00.000Z');
  assert.equal(store.listTasks().find(t=>t.title==='Essay').deadline.at,'2027-11-07T06:30:00.000Z');
});

test('task-set changes during model wait or clarification reject stale target resolution',async t=>{
  let id;const f=fixture(t,async()=>{
    f.store.createTask({title:'Math'});
    return {outcome:'apply',language:'en-US',operations:[{kind:'update',id,patch:{status:'completed'}}]};
  });
  id=f.store.createTask({title:'Math'}).id;
  assert.equal((await f.service.submit(input('Finish math'))).error?.code,'CONFLICT');
  assert.ok(f.store.listTasks().every(t=>t.status==='pending'));
});

test('admission caps pending provider calls and resumes after capacity frees',async t=>{
  let release;const wait=new Promise(resolve=>release=resolve);
  const {service}=fixture(t,async()=>{await wait;return create();});
  const requests=Array.from({length:20},()=>service.submit(input()));
  assert.equal((await service.submit(input())).error.code,'AI_BUSY');
  release();assert.ok((await Promise.all(requests)).every(r=>r.ok));
  assert.equal((await service.submit(input())).ok,true);
});

test('manual rename after a choice request invalidates its original task snapshot',async t=>{
  let id;const {store,service}=fixture(t,async()=>({outcome:'apply',language:'en-US',operations:[{kind:'update',id,patch:{status:'completed'}}]}));
  id=store.createTask({title:'Math'}).id;const other=store.createTask({title:'Math'});
  const first=(await service.submit(input())).data;
  store.updateTask({id:other.id,expectedRevision:1,patch:{title:'Physics'}});
  const selected=await service.submit(input('Original',{conversationId:first.conversationId,choice:{taskId:id}}));
  assert.equal(selected.error.code,'CONFLICT');assert.equal(store.listTasks().find(t=>t.id===id).status,'pending');
});
