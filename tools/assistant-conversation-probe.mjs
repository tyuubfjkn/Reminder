// Real production main/preload/IPC/DPAPI/SQLite; only model HTTP and OS-zone observation are driver fixtures.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {withIsolatedProfile} from './isolated-profile.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const {_electron}=createRequire(new URL('../apps/desktop/renderer/package.json',import.meta.url))('playwright-core');
const electron=createRequire(new URL('../package.json',import.meta.url))('electron');
await withIsolatedProfile(async profile=>{
  let app;const key='conversation-probe-placeholder';
  try {
    app=await _electron.launch({executablePath:electron,args:[join(root,'apps/desktop/main/main.mjs')],cwd:root,env:{...process.env,REMINDER_USER_DATA_DIR:profile}});
    const page=await app.firstWindow();
    const settings=await page.evaluate(()=>window.reminder.settings.get());assert.equal(settings.data.timeZoneSource,'system');
    assert.equal(settings.data.timeZone,await app.evaluate(()=>new Intl.DateTimeFormat().resolvedOptions().timeZone));
    await page.evaluate(()=>{window.zoneNotices=0;window.stopZoneNotice=window.reminder.settings.onChanged(()=>window.zoneNotices++);});
    await app.evaluate(()=>{const original=Intl.DateTimeFormat.prototype.resolvedOptions;globalThis.probeZone='Europe/London';Intl.DateTimeFormat.prototype.resolvedOptions=function(){return {...original.call(this),timeZone:globalThis.probeZone};};});
    assert.equal((await page.evaluate(()=>window.reminder.settings.get())).data.timeZone,'Europe/London');
    assert.equal((await page.evaluate(input=>window.reminder.assistant.configure(input),{apiKey:key})).ok,true);
    const submit=input=>page.evaluate(input=>window.reminder.assistant.submit(input),input);
    const tasks=()=>page.evaluate(async()=>{const r=await window.reminder.tasks.list();if(!r.ok)throw Error(r.error.code);return r.data;});
    const fixture=intent=>app.evaluate((_e,{intent,key})=>{globalThis.fetch=async(url,init)=>{
      if(url!=='https://api.deepseek.com/chat/completions'||init.headers.Authorization!=='Bearer '+key)throw Error('Unexpected fixture transport');
      return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{type:'function',function:{name:'record_task_intent',arguments:JSON.stringify(intent)}}]}}]}));
    };},{intent,key});
    const input=(text,extra={})=>({requestId:randomUUID(),text,...extra});
    const answer=(p,text,extra={})=>input(text,{conversationId:p.data.conversationId,proposalId:p.data.proposal.id,...extra});
    await fixture({outcome:'chat',language:'en-US',question:'Opportunity cost is the next best alternative forgone.'});
    assert.equal((await submit(input('Explain opportunity cost'))).data.outcome,'chat');assert.equal((await tasks()).length,0);
    const cake=time=>({outcome:'apply',language:'en-US',operations:[{kind:'create',input:{title:'Cake',plannedAt:{kind:'local',date:'2027-04-15',time}}}]});
    await fixture(cake('16:00'));const p=await submit(input('Cake at four'));assert.equal(p.data.outcome,'proposal');assert.equal((await tasks()).length,0);
    await fixture(cake('17:00'));const edited=await submit(answer(p,'Make it five'));assert.equal(edited.data.outcome,'proposal');
    assert.equal((await submit(answer(p,'yes'))).error.code,'CONFLICT');
    const approved=answer(edited,'yes');assert.equal((await submit(approved)).data.outcome,'applied');assert.equal((await submit(approved)).data.replayed,true);
    assert.equal((await tasks()).length,1);assert.deepEqual((await tasks())[0].plannedAt,{at:'2027-04-15T16:00:00.000Z',timeZone:'Europe/London'});
    console.log('[conversation] Real IPC chat, proposal/edit, stale-ID rejection, exact confirmation and replay passed.');
    const next=await submit(input('Another cake'));assert.equal(next.data.outcome,'proposal');
    await app.evaluate(()=>{globalThis.probeZone='Asia/Shanghai';});
    assert.equal((await submit(answer(next,'yes'))).error.code,'CONFLICT');await page.waitForFunction(()=>window.zoneNotices>0);
    assert.equal((await tasks())[0].plannedAt.at,'2027-04-15T16:00:00.000Z');
    const prefs=(await page.evaluate(()=>window.reminder.settings.get())).data;
    assert.equal(prefs.timeZone,'Asia/Shanghai');assert.equal((await page.evaluate(input=>window.reminder.settings.update(input),{expectedRevision:prefs.revision,patch:{timeZone:'UTC'}})).error.field,'timeZone');
    await page.evaluate(()=>window.stopZoneNotice());
    assert.equal((await page.evaluate(requestId=>window.reminder.assistant.undo({requestId}),approved.requestId)).data.outcome,'undone');assert.equal((await tasks()).length,0);
    console.log('[conversation] System-zone refresh/notification, stale proposal rejection, unchanged saved instant and Undo passed; HTTP/OS observation were fixtures.');
  } finally {await app?.close();}
});
