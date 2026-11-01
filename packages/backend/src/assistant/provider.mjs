import { AppError } from '../errors.mjs';
import { intentTool, validateIntent } from './schema.mjs';

export function createDeepSeekProvider({fetchImpl=(...args)=>globalThis.fetch(...args),timeoutMs=30000}={}) {
  return {async propose({apiKey,model,messages}) {
    const controller=new AbortController();
    let timer,reader;
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new AppError('AI_TIMEOUT'));},timeoutMs);});
    try {
      return await Promise.race([timeout,(async()=>{
        const response=await fetchImpl('https://api.deepseek.com/chat/completions',{
          method:'POST',redirect:'error',signal:controller.signal,
          headers:{'Content-Type':'application/json',Authorization:`Bearer ${apiKey}`},
          body:JSON.stringify({model,messages,stream:false,thinking:{type:'disabled'},tools:[intentTool],tool_choice:{type:'function',function:{name:intentTool.function.name}}})
        });
        if(!response.ok) {
          response.body?.cancel().catch(()=>{});
          throw new AppError([401,403].includes(response.status)?'AI_AUTH_ERROR':response.status===429?'AI_RATE_LIMITED':'AI_UNAVAILABLE');
        }
        if(!response.body) throw new AppError('AI_INVALID_RESPONSE');
        reader=response.body.getReader();
        const chunks=[];let size=0;
        while(true) {
          const {done,value}=await reader.read();if(done) break;
          size+=value.byteLength;
          if(size>262144) throw new AppError('AI_INVALID_RESPONSE');
          chunks.push(value);
        }
        let data;
        try { data=JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new AppError('AI_INVALID_RESPONSE'); }
        const choices=data?.choices, calls=choices?.[0]?.message?.tool_calls;
        if(!Array.isArray(choices)||choices.length!==1||choices[0].finish_reason!=='tool_calls'||!Array.isArray(calls)||calls.length!==1||calls[0].type!=='function'||calls[0].function?.name!==intentTool.function.name)
          throw new AppError('AI_INVALID_RESPONSE');
        let intent;
        try { intent=JSON.parse(calls[0].function.arguments); } catch { throw new AppError('AI_INVALID_RESPONSE'); }
        return validateIntent(intent);
      })()]);
    } catch(error) {
      if(controller.signal.aborted) throw new AppError('AI_TIMEOUT');
      if(error instanceof AppError) throw error;
      throw new AppError('AI_UNAVAILABLE');
    } finally {
      clearTimeout(timer);controller.abort();
      reader?.cancel().catch(()=>{});
    }
  }};
}
