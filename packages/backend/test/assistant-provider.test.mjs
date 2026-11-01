import {test} from 'node:test';
import assert from 'node:assert/strict';
const module=await import('../src/assistant/provider.mjs').catch(()=>({}));
const valid={outcome:'apply',language:'en-US',operations:[{kind:'create',input:{title:'Essay'}}]};
const response=(intent=valid,extra={})=>new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{type:'function',function:{name:'record_task_intent',arguments:JSON.stringify(intent)}}]}}],...extra}));
function provider(fetchImpl,timeoutMs=1000){assert.equal(typeof module.createDeepSeekProvider,'function');return module.createDeepSeekProvider({fetchImpl,timeoutMs});}
const input={apiKey:'sentinel-private',model:'deepseek-flash',messages:[{role:'user',content:'Write an essay'}]};
test('fixed official endpoint, one non-thinking tool, key header only; validated intent returned',async()=>{
  let calls=0;
  const p=provider(async(url,init)=>{calls++;assert.equal(url,'https://api.deepseek.com/chat/completions');assert.equal(init.headers.Authorization,'Bearer sentinel-private');
    const body=JSON.parse(init.body);assert.equal(body.model,input.model);assert.deepEqual(body.thinking,{type:'disabled'});assert.equal(body.tool_choice.function.name,'record_task_intent');assert.equal(body.stream,false);assert.ok(!init.body.includes(input.apiKey));assert.equal(init.redirect,'error');return response();});
  assert.deepEqual(await p.propose(input),valid);assert.equal(calls,1);
});
test('provider HTTP and network errors are sanitized without automatic retry',async()=>{
  for(const [status,code] of [[401,'AI_AUTH_ERROR'],[403,'AI_AUTH_ERROR'],[429,'AI_RATE_LIMITED'],[503,'AI_UNAVAILABLE']]){
    let count=0;const p=provider(async()=>{count++;return new Response('sentinel-private',{status});});
    await assert.rejects(p.propose(input),e=>e.code===code&&!e.message.includes('sentinel'));assert.equal(count,1);
  }
  await assert.rejects(provider(async()=>{throw Error('sentinel-private');}).propose(input),e=>e.code==='AI_UNAVAILABLE');
});
test('reject malformed, truncated, multiple, unknown and extra-field tool responses',async()=>{
  const choice={finish_reason:'tool_calls',message:{tool_calls:[{type:'function',function:{name:'record_task_intent',arguments:JSON.stringify(valid)}}]}};
  const bad=[{}, {choices:[]},{choices:[{...choice,finish_reason:'length'}]}, {choices:[choice,choice]},
    {choices:[{...choice,message:{tool_calls:[...choice.message.tool_calls,...choice.message.tool_calls]}}]},
    {choices:[{...choice,message:{tool_calls:[{type:'function',function:{name:'delete_database',arguments:'{}'}}]}}]}];
  for(const value of bad) await assert.rejects(provider(async()=>new Response(JSON.stringify(value))).propose(input),e=>e.code==='AI_INVALID_RESPONSE');
  for(const intent of [{...valid,sql:'DROP TABLE tasks'}, {...valid,operations:[]},{...valid,operations:[{kind:'remove',id:'x'}]}, {...valid,operations:[{kind:'create',input:{title:'ok',deadline:{kind:'instant',at:'2027-01-01T00:00:00Z'}}}]}])
    await assert.rejects(provider(async()=>response(intent)).propose(input),e=>e.code==='AI_INVALID_RESPONSE');
});
test('bounded streamed body and abort deadline reject without hanging',async()=>{
  await assert.rejects(provider(async()=>new Response('x'.repeat(262145))).propose(input),e=>e.code==='AI_INVALID_RESPONSE');
  const slow=provider((_url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason))),15);
  await assert.rejects(slow.propose(input),e=>e.code==='AI_TIMEOUT');
  const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));}});
  await assert.rejects(provider(async()=>new Response(stream),15).propose(input),e=>e.code==='AI_TIMEOUT');
});
