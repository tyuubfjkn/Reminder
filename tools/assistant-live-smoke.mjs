// Opt-in only: consumes a small number of real provider requests, in a disposable database.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { withIsolatedProfile } from './isolated-profile.mjs';
import { openStore } from '../packages/backend/src/store.mjs';
import { createAssistantService } from '../packages/backend/src/assistant/service.mjs';
import { createDeepSeekProvider } from '../packages/backend/src/assistant/provider.mjs';

if(!process.env.DEEPSEEK_API_KEY) {
  console.error('Configure DEEPSEEK_API_KEY locally before this opt-in check. No request was sent.');process.exitCode=2;
} else await withIsolatedProfile(async directory=>{
  let store=openStore(join(directory,'smoke.sqlite'),{timeZone:'America/New_York'});
  try {
    const service=createAssistantService({store,provider:createDeepSeekProvider(),regionalLocale:'en-GB',
      vault:{getCredential:async()=>({apiKey:process.env.DEEPSEEK_API_KEY,model:process.env.DEEPSEEK_MODEL||'deepseek-flash'})}});
    for(const [text,language] of [
      ['Create a task named English smoke essay, due on 2027-04-15 (date only), estimated at 180 minutes.','en-US'],
      ['创建任务“中文测试作业”，截止日期为2027年4月16日（只记录日期），预计用时30分钟。','zh-CN']]) {
      const requestId=randomUUID(),reply=await service.submit({requestId,text});
      assert.equal(reply.ok,true,reply.error?.code);assert.equal(reply.data.outcome,'applied');assert.equal(reply.data.language,language);
      const task=store.listTasks().find(t=>t.id===reply.data.changes[0].taskId);assert.equal(task.deadline.kind,'date');
      const count=store.listTasks().length;assert.equal((await service.submit({requestId,text})).data.replayed,true);assert.equal(store.listTasks().length,count);
      assert.equal((await service.undo({requestId})).data.outcome,'undone');
    }
    assert.equal(store.listTasks().length,0);store.close();store=openStore(join(directory,'smoke.sqlite'));
    assert.equal(store.listTasks().length,0);console.log('[live] Bilingual DeepSeek create, local date-only storage, replay, undo and reopen passed.');
  } finally {store.close();}
});
