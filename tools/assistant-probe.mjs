// Real Electron/DPAPI/IPC/SQLite probe, isolated from personal data. No provider request.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { withIsolatedProfile } from './isolated-profile.mjs';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const requireRenderer=createRequire(new URL('../apps/desktop/renderer/package.json',import.meta.url));
const {_electron}=requireRenderer('playwright-core');
const requireRoot=createRequire(new URL('../package.json',import.meta.url));
await withIsolatedProfile(async profile=>{
  const launch=()=>_electron.launch({executablePath:requireRoot('electron'),args:[join(root,'apps/desktop/main/main.mjs')],cwd:root,
    env:{...process.env,REMINDER_USER_DATA_DIR:profile}});
  const sentinel='test-only-DPAPI-'+randomUUID();
  let app;
  try {
    app=await launch();let page=await app.firstWindow();
    assert.equal(resolve(await app.evaluate(({app})=>app.getPath('userData'))),resolve(profile));
    assert.equal((await page.evaluate(()=>window.reminder.assistant.getConfig())).data.hasKey,false);
    const configured=await page.evaluate(key=>window.reminder.assistant.configure({apiKey:key}),sentinel);
    assert.equal(configured.ok,true);assert.equal(configured.data.hasKey,true);assert.ok(!JSON.stringify(configured).includes(sentinel));
    const raw=await readFile(join(profile,'assistant-config.json'),'utf8');assert.ok(!raw.includes(sentinel));
    // Verify actual OS crypto without returning plaintext to the driver.
    const roundTrip=await app.evaluate(async({safeStorage},{encrypted,expected})=>{
      const result=await safeStorage.decryptStringAsync(Buffer.from(encrypted,'base64'));
      return result.result===expected;
    },{encrypted:JSON.parse(raw).encryptedKey,expected:sentinel});
    assert.equal(roundTrip,true);
    // Inject only the HTTP response in the test driver, not a production provider switch.
    // The real main coordinator, IPC, vault and SQLite perform all operations.
    await app.evaluate(()=>{
      globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{
        type:'function',function:{name:'record_task_intent',arguments:JSON.stringify({outcome:'apply',language:'en-US',operations:[
          {kind:'create',input:{title:'Assistant fixture essay',deadline:{kind:'date',date:'2027-04-15'},estimatedMinutes:180}}
        ]})}
      }]}}]}));
    });
    const request={requestId:randomUUID(),text:'Create an essay due on April 15, 2027, estimated at three hours.'};
    const applied=await page.evaluate(input=>window.reminder.assistant.submit(input),request);
    assert.equal(applied.ok,true,applied.error?.code);assert.equal(applied.data.outcome,'applied');
    assert.equal((await page.evaluate(()=>window.reminder.tasks.list())).data[0].estimatedMinutes,180);
    await app.close();app=null;
    app=await launch();page=await app.firstWindow();
    assert.equal((await page.evaluate(()=>window.reminder.assistant.getConfig())).data.hasKey,true);
    const credentialRestored=await app.evaluate(async({app,safeStorage},{moduleUrl,expected})=>{
      const {createAssistantVault}=await import(moduleUrl);
      const {join}=await import('node:path');
      return (await createAssistantVault(join(app.getPath('userData'),'assistant-config.json'),safeStorage).getCredential()).apiKey===expected;
    },{moduleUrl:new URL('../apps/desktop/main/assistant-config.mjs',import.meta.url).href,expected:sentinel});
    assert.equal(credentialRestored,true);
    // Replay must read the durable receipt without contacting the real provider after restart.
    const replay=await page.evaluate(input=>window.reminder.assistant.submit(input),request);
    assert.equal(replay.data.replayed,true);assert.equal(replay.data.changes[0].taskId,applied.data.changes[0].taskId);
    assert.equal((await page.evaluate(()=>window.reminder.tasks.list())).data.length,1);
    assert.equal((await page.evaluate(requestId=>window.reminder.assistant.undo({requestId}),request.requestId)).data.outcome,'undone');
    assert.equal((await page.evaluate(()=>window.reminder.assistant.configure({clearKey:true}))).data.hasKey,false);
    const missing=await page.evaluate(requestId=>window.reminder.assistant.submit({requestId,text:'Add an essay'}),randomUUID());
    assert.equal(missing.error.code,'AI_NOT_CONFIGURED');
    assert.deepEqual((await page.evaluate(()=>window.reminder.tasks.list())).data,[]);
    assert.equal((await page.evaluate(()=>window.reminder.tasks.create({title:'Manual still works'}))).ok,true);
    console.log('[assistant] Actual DPAPI, IPC, SQLite batch/restart/replay/undo, key removal and offline manual path passed; model response was a fixture, no live provider call.');
  } finally {await app?.close();}
});
