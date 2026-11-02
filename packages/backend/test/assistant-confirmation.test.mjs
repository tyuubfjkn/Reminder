import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openStore} from '../src/store.mjs';
import {createAssistantService} from '../src/assistant/service.mjs';
import {AppError} from '../src/errors.mjs';
const req=(text,extra={})=>({requestId:randomUUID(),text,...extra});
const intent=(fields={title:'Cake'})=>({outcome:'apply',language:'en-US',operations:[{kind:'create',input:fields}]});
function setup(t,propose) {
  const store=openStore(':memory:',{timeZone:'Europe/London'});t.after(()=>store.close());
  let now=new Date('2027-04-15T10:00:00Z');
  const service=createAssistantService({store,provider:{propose},vault:{getCredential:async()=>({apiKey:'sentinel',model:'fixture'}),getConfig:async()=>({provider:'deepseek',model:'fixture',hasKey:true})},clock:()=>now});
  return {store,service,advance:ms=>now=new Date(+now+ms)};
}
const answer=(r,text='yes',extra={})=>req(text,{conversationId:r.data.conversationId,proposalId:r.data.proposal.id,...extra});

test('general conversation returns chat with zero task writes',async t=>{
  const {store,service}=setup(t,async()=>({outcome:'chat',language:'en-US',question:'Opportunity cost is the next best alternative forgone.'}));
  const r=await service.submit(req('Explain opportunity cost'));assert.equal(r.ok,true);assert.equal(r.data.outcome,'chat');assert.match(r.data.message,/alternative/);assert.equal(r.data.proposal,undefined);assert.deepEqual(store.listTasks(),[]);
});
test('explicit task request creates only a preview; bound confirmation commits exact planned instant once',async t=>{
  let calls=0;const {store,service}=setup(t,async()=>{calls++;return intent({title:'Cake',plannedAt:{kind:'local',date:'2027-04-15',time:'16:00'}});});
  const input=req('Add cake today at four'),p=await service.submit(input);assert.equal(p.ok,true);assert.equal(p.data.outcome,'proposal');assert.equal(store.listTasks().length,0);
  assert.deepEqual(p.data.proposal.changes[0].fields.plannedAt,{at:'2027-04-15T15:00:00.000Z',timeZone:'Europe/London'});assert.match(p.data.message,/16:00/);
  const again=await service.submit(input);assert.equal(again.data.proposal.id,p.data.proposal.id);assert.equal(again.data.replayed,true);
  const yes=answer(p),saved=await service.submit(yes);assert.equal(saved.data.outcome,'applied');assert.equal(store.listTasks().length,1);assert.equal(store.listTasks()[0].deadline,null);assert.equal(calls,1);
  assert.equal((await service.submit(yes)).data.replayed,true);assert.equal(store.listTasks().length,1);
  assert.equal((await service.submit(answer(p))).error.code,'CONFLICT');
  await service.undo({requestId:yes.requestId});assert.equal(store.listTasks().length,0);assert.equal((await service.submit(yes)).data.outcome,'undone');
});
test('yes without a matching visible proposal ID cannot authorize a task',async t=>{
  const {store,service}=setup(t,async()=>intent());const p=await service.submit(req('Cake'));
  assert.equal(p.data.outcome,'proposal');
  for(const input of [req('yes',{conversationId:p.data.conversationId}),answer(p,'yes',{proposalId:randomUUID()}),req('yes',{decision:'confirm'})])assert.equal((await service.submit(input)).ok,false);
  assert.deepEqual(store.listTasks(),[]);assert.equal((await service.submit(answer(p,'确认'))).data.outcome,'applied');
});
test('editing replaces proposal and cancelled or old IDs never commit',async t=>{
  let calls=0;const {store,service}=setup(t,async request=>{calls++;if(calls===2)assert.match(JSON.stringify(request.messages),/pendingProposal/);return intent({title:'Cake',plannedAt:{kind:'local',date:'2027-04-15',time:calls===1?'16:00':'17:00'}});});
  const first=await service.submit(req('Cake at four'));assert.equal(first.data.outcome,'proposal');
  const edit=answer(first,'Make that five'),next=await service.submit(edit);assert.equal(next.data.outcome,'proposal');assert.notEqual(next.data.proposal.id,first.data.proposal.id);
  assert.equal((await service.submit(answer(first))).error.code,'CONFLICT');assert.equal((await service.submit(edit)).data.proposal.id,next.data.proposal.id);
  assert.equal((await service.submit(answer(next,'不用了'))).data.outcome,'cancelled');assert.equal((await service.submit(answer(next))).ok,false);assert.deepEqual(store.listTasks(),[]);
});
test('failed edits revoke the old confirmation target instead of leaving unsafe buttons live',async t=>{
  let calls=0;const {store,service}=setup(t,async()=>{if(++calls===1)return intent();throw Error('provider failed');});
  const p=await service.submit(req('Cake'));assert.equal(p.data.outcome,'proposal');assert.equal((await service.submit(answer(p,'Make that five'))).ok,false);
  assert.equal((await service.submit(answer(p))).error.code,'CONFLICT');assert.deepEqual(store.listTasks(),[]);
});
test('task changes, zone changes and absolute expiry block a whole confirmation',async t=>{
  const {store,service,advance}=setup(t,async()=>intent());
  let p=await service.submit(req('Cake'));assert.equal(p.data.outcome,'proposal');store.createTask({title:'Manual'});assert.equal((await service.submit(answer(p))).error.code,'CONFLICT');
  p=await service.submit(req('Cake'));store.updateSettings({expectedRevision:1,patch:{timeZone:'Asia/Shanghai'}});assert.equal((await service.submit(answer(p))).error.code,'CONFLICT');
  p=await service.submit(req('Cake'));advance(600001);assert.equal((await service.submit(answer(p))).error.code,'CONFLICT');assert.equal(store.listTasks().length,1);
});
test('deadline and planned time require independent fold choices before one final confirmation',async t=>{
  const {store,service}=setup(t,async()=>intent({title:'Two clocks',deadline:{kind:'local',date:'2027-11-07',time:'01:15'},plannedAt:{kind:'local',date:'2028-11-05',time:'01:30'}}));
  store.updateSettings({expectedRevision:1,patch:{timeZone:'America/New_York'}});
  const first=await service.submit(req('Two clocks'));assert.equal(first.data.choices.kind,'occurrence');
  const second=await service.submit(req('Second',{conversationId:first.data.conversationId,clarificationId:first.data.clarificationId,choice:{occurrence:'later'}}));assert.equal(second.data.outcome,'clarification');assert.equal(second.data.choices.later,'2028-11-05T06:30:00.000Z');
  const p=await service.submit(req('First',{conversationId:first.data.conversationId,clarificationId:second.data.clarificationId,choice:{occurrence:'earlier'}}));assert.equal(p.data.outcome,'proposal');assert.equal(store.listTasks().length,0);
  await service.submit(answer(p));const task=store.listTasks()[0];assert.equal(task.deadline.at,'2027-11-07T06:15:00.000Z');assert.equal(task.plannedAt.at,'2028-11-05T05:30:00.000Z');
});
test('chat follow-up revokes pending proposal and no existing notes leak into provider context',async t=>{
  let calls=0;const {store,service}=setup(t,async request=>{assert.ok(!JSON.stringify(request.messages).includes('private note'));return ++calls===1?intent():{outcome:'chat',language:'en-US',question:'Here is an explanation.'};});
  store.createTask({title:'Existing',notes:'private note'});const p=await service.submit(req('Cake'));assert.equal(p.data.outcome,'proposal');
  assert.equal((await service.submit(answer(p,'Instead explain economics'))).data.outcome,'chat');assert.equal((await service.submit(answer(p))).ok,false);assert.equal(store.listTasks().length,1);
});

test('a failed edit retries the identical context while old confirmation stays revoked',async t=>{
  let calls=0;const {store,service}=setup(t,async request=>{calls++;if(calls===2)throw Error('offline');if(calls===3)assert.match(JSON.stringify(request.messages),/pendingProposal/);return intent({title:calls===1?'Original':'Revised'});});
  const p=await service.submit(req('Original')),edit=answer(p,'Change the title');assert.equal((await service.submit(edit)).ok,false);
  const r=await service.submit(edit);assert.equal(r.data.outcome,'proposal');assert.equal(r.data.proposal.changes[0].title,'Revised');assert.equal((await service.submit(answer(p))).ok,false);assert.equal(store.listTasks().length,0);
});
test('transient storage failure during confirmation can retry only the exact confirmation request',async t=>{
  const {store,service}=setup(t,async()=>intent());const p=await service.submit(req('Cake')),yes=answer(p);
  const apply=store.applyAssistantRun;let fail=true;store.applyAssistantRun=input=>{if(fail){fail=false;throw new AppError('STORAGE_ERROR');}return apply(input);};
  assert.equal((await service.submit(yes)).error.code,'STORAGE_ERROR');assert.equal(store.listTasks().length,0);
  const r=await service.submit(yes);assert.equal(r.ok,true);assert.equal(r.data.outcome,'applied');assert.equal(store.listTasks().length,1);
});
test('a confirmed receipt replays after session restart without provider and remains undone',async t=>{
  const {store,service}=setup(t,async()=>intent());const p=await service.submit(req('Cake')),yes=answer(p);await service.submit(yes);
  const restarted=createAssistantService({store,vault:{},provider:{propose:()=>assert.fail('No provider on committed replay')}});
  assert.equal((await restarted.submit(yes)).data.replayed,true);assert.equal(store.listTasks().length,1);
  assert.equal((await restarted.submit({...yes,text:'different'})).error.code,'CONFLICT');
  await restarted.undo({requestId:yes.requestId});assert.equal((await restarted.submit(yes)).data.outcome,'undone');assert.equal(store.listTasks().length,0);
});
test('an expired proposal does not trap subsequent ordinary conversation',async t=>{
  let calls=0;const {store,service,advance}=setup(t,async()=>++calls===1?intent():{outcome:'chat',language:'en-US',question:'Hello again.'});
  const p=await service.submit(req('Cake'));advance(600001);
  const chat=await service.submit(req('Tell me about economics',{conversationId:p.data.conversationId}));
  assert.equal(chat.ok,true);assert.equal(chat.data.outcome,'chat');assert.equal(store.listTasks().length,0);
});
test('old DST clarification tokens cannot choose the next field; same-ID retry replays its question',async t=>{
  const {store,service}=setup(t,async()=>intent({title:'Two clocks',deadline:{kind:'local',date:'2027-11-07',time:'01:15'},plannedAt:{kind:'local',date:'2028-11-05',time:'01:30'}}));
  store.updateSettings({expectedRevision:1,patch:{timeZone:'America/New_York'}});
  const first=await service.submit(req('Two clocks'));assert.equal(typeof first.data.clarificationId,'string');
  const pick=req('Second',{conversationId:first.data.conversationId,clarificationId:first.data.clarificationId,choice:{occurrence:'later'}});
  const next=await service.submit(pick);assert.equal(next.data.outcome,'clarification');assert.notEqual(next.data.clarificationId,first.data.clarificationId);
  assert.equal((await service.submit({...pick,requestId:randomUUID()})).error.code,'CONFLICT');
  assert.equal((await service.submit(pick)).data.clarificationId,next.data.clarificationId);
  const p=await service.submit(req('First',{conversationId:first.data.conversationId,clarificationId:next.data.clarificationId,choice:{occurrence:'earlier'}}));
  assert.equal(p.data.outcome,'proposal');await service.submit(answer(p));assert.equal(store.listTasks()[0].plannedAt.at,'2028-11-05T05:30:00.000Z');
});
