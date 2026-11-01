import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const module=await import('../../../apps/desktop/main/assistant-config.mjs').catch(()=>({}));
async function fixture(t,crypto={}) {
  assert.equal(typeof module.createAssistantVault,'function');
  const directory=await mkdtemp(join(tmpdir(),'reminder-vault-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const path=join(directory,'assistant-config.json');
  const safeStorage={isAsyncEncryptionAvailable:async()=>true,encryptStringAsync:async text=>Buffer.from(text).map(b=>b^0x5a),decryptStringAsync:async bytes=>({result:Buffer.from(bytes).map(b=>b^0x5a).toString(),shouldReEncrypt:false}),...crypto};
  return {path,vault:module.createAssistantVault(path,safeStorage),reopen:()=>module.createAssistantVault(path,safeStorage)};
}
test('encrypted config persists, public responses never include key, removal survives reopen',async t=>{
  const f=await fixture(t),key='not-a-real-private-key';
  assert.deepEqual(await f.vault.getConfig(),{provider:'deepseek',model:'deepseek-flash',hasKey:false});
  const config=await f.vault.configure({apiKey:key,model:'custom-model'});assert.equal(config.hasKey,true);assert.ok(!JSON.stringify(config).includes(key));
  assert.ok(!(await readFile(f.path,'utf8')).includes(key));assert.equal((await f.reopen().getCredential()).apiKey,key);
  assert.equal((await f.vault.configure({clearKey:true})).hasKey,false);assert.equal(await f.reopen().getCredential(),null);
});
test('corrupt config and unavailable crypto are isolated; clear recovers without decryption',async t=>{
  const f=await fixture(t,{isAsyncEncryptionAvailable:async()=>false});
  await assert.rejects(f.vault.configure({apiKey:'private'}),e=>e.code==='AI_SECURE_STORAGE_UNAVAILABLE');
  await writeFile(f.path,'corrupt');await assert.rejects(f.vault.getConfig(),e=>e.code==='AI_CONFIG_ERROR');
  assert.equal((await f.vault.configure({clearKey:true})).hasKey,false);
  assert.equal(await f.vault.getCredential(),null);
});
test('concurrent configure requests serialize encryption and removal; invalid input cannot alter file',async t=>{
  let release;const wait=new Promise(resolve=>release=resolve);
  const f=await fixture(t,{encryptStringAsync:async()=>{await wait;return Buffer.from('encrypted');}});
  const put=f.vault.configure({apiKey:'private'}),remove=f.vault.configure({clearKey:true});release();await Promise.all([put,remove]);assert.equal((await f.reopen().getConfig()).hasKey,false);
  const before=await readFile(f.path,'utf8');
  for(const bad of [{apiKey:'private',clearKey:true},{apiKey:''},{model:'https://evil.test/'},{endpoint:'evil'},{}]) await assert.rejects(f.vault.configure(bad),e=>e.code==='VALIDATION_ERROR');
  assert.equal(await readFile(f.path,'utf8'),before);
});
test('decrypt failure is sanitized and does not delete stored ciphertext',async t=>{
  const f=await fixture(t,{decryptStringAsync:async()=>{throw Error('secret path private');}});
  await f.vault.configure({apiKey:'private'});const before=await readFile(f.path,'utf8');
  await assert.rejects(f.vault.getCredential(),e=>e.code==='AI_CONFIG_ERROR'&&!e.message.includes('private'));
  assert.equal(await readFile(f.path,'utf8'),before);
});

test('key rotation re-encrypts and cannot race a queued removal',async t=>{
  let rotating=false,release;const wait=new Promise(resolve=>release=resolve);
  const f=await fixture(t,{
    decryptStringAsync:async()=>({result:'private',shouldReEncrypt:true}),
    encryptStringAsync:async()=>{if(rotating) await wait;return Buffer.from(rotating?'rotated':'original');}
  });
  await f.vault.configure({apiKey:'private'});rotating=true;
  const credential=f.vault.getCredential(),remove=f.vault.configure({clearKey:true});release();
  assert.equal((await credential).apiKey,'private');await remove;
  assert.equal(await f.reopen().getCredential(),null);
});
