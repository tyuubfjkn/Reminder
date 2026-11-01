// Real renderer -> preload -> main -> DPAPI/SQLite. Only provider HTTP is a fixture.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { withIsolatedProfile } from './isolated-profile.mjs';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const {_electron}=createRequire(new URL('../apps/desktop/renderer/package.json',import.meta.url))('playwright-core');
const electron=createRequire(new URL('../package.json',import.meta.url))('electron');
const sentinel='ui-probe-placeholder-not-a-real-key';
await withIsolatedProfile(async profile=>{
  let app;
  try {
    app=await _electron.launch({executablePath:electron,args:[join(root,'apps/desktop/main/main.mjs')],cwd:root,env:{...process.env,REMINDER_USER_DATA_DIR:profile}});
    const page=await app.firstWindow();page.setDefaultTimeout(15000);
    const settings=await page.evaluate(()=>window.reminder.settings.get());
    assert.equal((await page.evaluate(revision=>window.reminder.settings.update({expectedRevision:revision,patch:{timeZone:'America/New_York'}}),settings.data.revision)).ok,true);
    await page.reload();
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await page.getByLabel('DeepSeek API key',{exact:true}).fill(sentinel);
    await page.getByRole('button',{name:'Save key',exact:true}).click();
    await page.getByText('API key: saved',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Assistant',exact:true}).click();
    const box=page.getByRole('textbox',{name:'Message',exact:true});
    const entries=page.locator('li.bubble.reply');
    const tasks=()=>page.evaluate(async()=>{const r=await window.reminder.tasks.list();if(!r.ok)throw Error(r.error.code);return r.data;});
    const fixture=async(operations,failFirst=false)=>app.evaluate((_electron,{operations,sentinel,failFirst})=>{
      let calls=0;
      globalThis.fetch=async(url,init)=>{
        if(url!=='https://api.deepseek.com/chat/completions'||init.headers.Authorization!=='Bearer '+sentinel)throw Error('Unexpected fixture transport');
        if(failFirst&&calls++===0)return new Response('{}',{status:503});
        return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{type:'function',function:{name:'record_task_intent',arguments:JSON.stringify({outcome:'apply',language:'en-US',operations})}}]}}]}));
      };
    },{operations,sentinel,failFirst});
    const waitReply=async count=>page.waitForFunction(n=>document.querySelectorAll('li.bubble.reply').length===n,count);
    const send=async text=>{const n=await entries.count();await box.fill(text);await page.getByRole('button',{name:'Send',exact:true}).click();await waitReply(n+1);};
    const undoLatest=async()=>{const n=await entries.count();await entries.last().getByRole('button',{name:'Undo these changes',exact:true}).click();await waitReply(n+1);};

    await fixture([{kind:'create',input:{title:'UI essay',estimatedMinutes:180}}]);
    await send('  Add an essay taking three hours  ');
    assert.equal(await box.inputValue(),'');assert.equal((await tasks()).length,1);
    const essay=(await tasks())[0];assert.equal(essay.estimatedMinutes,180);
    console.log('[assistant-ui] Padded send cleared; real SQLite task created via UI.');

    await fixture([{kind:'update',id:essay.id,patch:{status:'completed'}}]);
    await send('Complete the essay');assert.equal((await tasks())[0].status,'completed');
    await undoLatest();assert.equal((await tasks())[0].status,'pending');
    console.log('[assistant-ui] Completion and Undo passed through UI and real service.');

    await fixture([
      {kind:'create',input:{title:'First fold',deadline:{kind:'local',date:'2027-11-07',time:'01:30'}}},
      {kind:'create',input:{title:'Second fold',deadline:{kind:'local',date:'2028-11-05',time:'01:15'}}}
    ]);
    await send('Add two tasks with ambiguous November deadlines');assert.equal((await tasks()).length,1);
    let n=await entries.count();await entries.last().getByRole('button',{name:/^Second:/}).click();await waitReply(n+1);
    assert.equal((await tasks()).length,1);
    n=await entries.count();await entries.last().getByRole('button',{name:/^First:/}).click();await waitReply(n+1);
    const saved=await tasks();assert.equal(saved.length,3);
    assert.equal(saved.find(t=>t.title==='First fold').deadline.at,'2027-11-07T06:30:00.000Z');
    assert.equal(saved.find(t=>t.title==='Second fold').deadline.at,'2028-11-05T05:15:00.000Z');
    console.log('[assistant-ui] Two separate DST choices displayed/answered; atomic commit passed.');

    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await page.getByRole('button',{name:'Remove key',exact:true}).click();await page.getByText('API key: not set',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Assistant',exact:true}).click();assert.equal(await box.count(),0);
    await undoLatest();assert.equal((await tasks()).length,1);
    console.log('[assistant-ui] Removing key preserves conversation and real local Undo.');

    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await page.getByLabel('DeepSeek API key',{exact:true}).fill(sentinel);await page.getByRole('button',{name:'Save key',exact:true}).click();
    await page.getByText('API key: saved',{exact:true}).waitFor();await page.getByRole('button',{name:'Assistant',exact:true}).click();
    await fixture([{kind:'create',input:{title:'Retry task'}}],true);
    await box.fill('  Add retry task  ');await page.getByRole('button',{name:'Send',exact:true}).click();
    await page.getByRole('button',{name:'Try again',exact:true}).waitFor();assert.equal((await tasks()).length,1);
    n=await entries.count();await page.getByRole('button',{name:'Try again',exact:true}).click();await waitReply(n+1);
    assert.equal((await tasks()).length,2);
    assert.equal(await box.inputValue(),'','Successful Try again must clear the submitted draft; otherwise Send duplicates it');
    assert.equal(await page.getByRole('button',{name:'Send',exact:true}).isDisabled(),true);
    console.log('[assistant-ui] Try again cleared submitted draft. All UI/service checks passed; HTTP was a fixture, not live DeepSeek.');
  } finally {await app?.close();}
});
