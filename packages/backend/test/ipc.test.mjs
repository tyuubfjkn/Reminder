import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {openStore} from '../src/store.mjs';
import {createDispatcher} from '../src/dispatch.mjs';
import {registerIpc} from '../../../apps/desktop/main/ipc.mjs';

test('preload permits exactly the v1 API and routes it to real storage', async () => {
  const store=openStore(':memory:',{timeZone:'Asia/Shanghai'});
  const channels=new Map(), url='file:///app/renderer/dist/index.html';
  const frame={url}, contents={mainFrame:frame};
  const dispose=registerIpc({handle:(name,fn)=>channels.set(name,fn),removeHandler:name=>channels.delete(name)},createDispatcher(store),()=>contents,url);
  let api;
  vm.runInNewContext(readFileSync(new URL('../../../apps/desktop/main/preload.cjs',import.meta.url),'utf8'),{
    require(name) {
      assert.equal(name,'electron');
      return {
        contextBridge:{exposeInMainWorld:(key,value)=>{assert.equal(key,'reminder');api=value;}},
        ipcRenderer:{invoke:(channel,params)=>Promise.resolve(channels.get(channel)({sender:contents,senderFrame:frame},params))}
      };
    }
  });
  try {
    assert.equal(api.apiVersion,'1.0.0');
    assert.deepEqual(Object.keys(api).sort(),['apiVersion','assistant','settings','tasks']);
    assert.deepEqual(Object.keys(api.tasks).sort(),['create','list','update']);
    assert.deepEqual(Object.keys(api.settings).sort(),['get','update']);
    assert.equal(channels.size,5);
    const created=await api.tasks.create({title:'桥接 task'});
    assert.equal(created.ok,true);
    assert.equal((await api.tasks.list()).data[0].id,created.data.id);
    assert.equal((await api.tasks.update({id:created.data.id,expectedRevision:1,patch:{status:'completed'}})).data.status,'completed');
    assert.equal((await api.settings.get()).data.locale,'en-US');
    assert.equal((await api.settings.update({expectedRevision:1,patch:{locale:'zh-CN'}})).data.locale,'zh-CN');
  } finally {dispose();store.close();}
  assert.equal(channels.size,0);
});

test('assistant IPC uses the same sender restrictions and structured clone boundary', async () => {
  const channels=new Map(), url='file:///app/index.html', frame={url}, contents={mainFrame:frame};
  const calls=[];
  const assistant={getConfig:async()=>({ok:true,data:{provider:'deepseek',model:'deepseek-flash',hasKey:false}}),
    configure:async input=>{calls.push(input);return {ok:true,data:{hasKey:true}};},
    submit:async()=>({ok:false,error:{code:'AI_NOT_CONFIGURED'}}),undo:async()=>({ok:false,error:{code:'NOT_FOUND'}})};
  const dispose=registerIpc({handle:(k,v)=>channels.set(k,v),removeHandler:k=>channels.delete(k)},()=>({ok:true}),()=>contents,url,assistant);
  let api;
  vm.runInNewContext(readFileSync(new URL('../../../apps/desktop/main/preload.cjs',import.meta.url),'utf8'),{
    require:()=>({contextBridge:{exposeInMainWorld:(_key,value)=>{api=value;}},ipcRenderer:{invoke:async(channel,params)=>structuredClone(await channels.get(channel)({sender:contents,senderFrame:frame},structuredClone(params)))}})
  });
  assert.equal(api.assistant.apiVersion,'1.0.0');
  assert.deepEqual(Object.keys(api.assistant).sort(),['apiVersion','configure','getConfig','submit','undo']);
  assert.equal((await api.assistant.getConfig()).data.hasKey,false);
  const input={apiKey:'test-only'};await api.assistant.configure(input);input.apiKey='changed';assert.equal(calls[0].apiKey,'test-only');
  assert.equal((await api.assistant.submit({text:'Hello'})).error.code,'AI_NOT_CONFIGURED');
  assert.equal((await api.assistant.undo({requestId:'missing'})).error.code,'NOT_FOUND');
  for(const channel of ['getConfig','configure','submit','undo']) {
    for(const event of [{},{sender:contents,senderFrame:{url}},{sender:{},senderFrame:frame}])
      assert.equal((await channels.get('reminder:assistant:'+channel)(event,{})).error.code,'FORBIDDEN');
  }
  dispose();assert.equal(channels.size,0);
});

test('foreign frame, foreign window, navigation and missing sender cannot access storage', () => {
  const store=openStore(':memory:'), channels=new Map(), url='file:///app/index.html';
  const frame={url}, contents={mainFrame:frame};
  registerIpc({handle:(k,v)=>channels.set(k,v),removeHandler:k=>channels.delete(k)},createDispatcher(store),()=>contents,url);
  const forbidden={ok:false,error:{code:'FORBIDDEN'}};
  try {
    for(const event of [
      {sender:{mainFrame:frame},senderFrame:frame},
      {sender:contents,senderFrame:{url}},
      {sender:contents,senderFrame:null},
      {}
    ]) assert.deepEqual(channels.get('reminder:tasks:create')(event,{title:'must not write'}),forbidden);
    frame.url='https://evil.example/';
    assert.deepEqual(channels.get('reminder:tasks:list')({sender:contents,senderFrame:frame}),forbidden);
    assert.deepEqual(store.listTasks(),[]);
  } finally {store.close();}
});
