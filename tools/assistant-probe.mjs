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
    await app.close();app=null;
    app=await launch();page=await app.firstWindow();
    assert.equal((await page.evaluate(()=>window.reminder.assistant.getConfig())).data.hasKey,true);
    assert.equal((await page.evaluate(()=>window.reminder.assistant.configure({clearKey:true}))).data.hasKey,false);
    const missing=await page.evaluate(requestId=>window.reminder.assistant.submit({requestId,text:'Add an essay'}),randomUUID());
    assert.equal(missing.error.code,'AI_NOT_CONFIGURED');
    assert.deepEqual((await page.evaluate(()=>window.reminder.tasks.list())).data,[]);
    assert.equal((await page.evaluate(()=>window.reminder.tasks.create({title:'Manual still works'}))).ok,true);
    console.log('[assistant] Actual DPAPI encryption, restart, IPC, key removal and offline manual path passed; no live provider call.');
  } finally {await app?.close();}
});
