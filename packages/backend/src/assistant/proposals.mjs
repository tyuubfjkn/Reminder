import {AppError,invalid} from '../errors.mjs';
import {taskFieldsInput} from '../validation.mjs';
import {resolveWallTime} from './time.mjs';

const titleKey=title=>title.normalize('NFKC').trim().toLowerCase();
export function assertSnapshot(store,snapshot,settings) {
  const current=store.listTasks();
  if(store.getSettings().revision!==settings.revision||current.length!==snapshot.length||current.some((t,i)=>t.id!==snapshot[i].id||t.revision!==snapshot[i].revision))throw new AppError('CONFLICT');
}
export function normalizeIntent(intent,snapshot,settings,selection) {
  if(intent.outcome!=='apply')return {operations:[],outcome:intent.outcome,message:intent.question};
  const operations=[],used=new Set(),zh=intent.language==='zh-CN';
  for(let index=0;index<intent.operations.length;index++) {
    const op=intent.operations[index],fields=structuredClone(op.kind==='create'?op.input:op.patch);let target;
    if(op.kind==='update') {
      target=snapshot.find(t=>t.id===op.id);if(!target)throw new AppError('AI_INVALID_RESPONSE');
      const candidates=snapshot.filter(t=>titleKey(t.title)===titleKey(target.title));
      if(candidates.length>1) {
        const selected=selection?.resolvedTasks?.[index];
        if(!selected)return {operations:[],outcome:'clarification',message:zh?'请选择要修改的任务。':'Which task should I change?',choices:{kind:'task',tasks:candidates.map(({id,title,status,deadline})=>({id,title,status,deadline}))},pending:{index,kind:'task'}};
        target=candidates.find(t=>t.id===selected);if(!target)invalid('choice');
      }
      if(used.has(target.id))throw new AppError('AI_INVALID_RESPONSE');used.add(target.id);
    }
    for(const field of ['deadline','plannedAt']) {
      const d=fields[field];if(d==null)continue;
      if(d.kind==='date') {fields[field]={...d,timeZone:settings.timeZone};continue;}
      const times=resolveWallTime(d.date,d.time,settings.timeZone);
      if(!times.length)return {operations:[],outcome:'clarification',message:zh?'这个本地时间不存在，请提供另一个时间。':'That local time does not exist. Please choose another time.'};
      const occurrence=selection?.resolvedTimes?.[`${index}:${field}`];
      if(times.length>1&&!occurrence)return {operations:[],outcome:'clarification',message:zh?`${field==='plannedAt'?'计划时间':'截止时间'}出现两次，请选择第一次或第二次。`:`This ${field==='plannedAt'?'planned time':'deadline'} occurs twice. Choose the first or second occurrence.`,choices:{kind:'occurrence',earlier:times[0].at,later:times.at(-1).at,timeZone:settings.timeZone},pending:{index,field,kind:'occurrence'}};
      const at=(occurrence==='later'?times.at(-1):times[0]).at;
      fields[field]=field==='deadline'?{kind:'instant',at,timeZone:settings.timeZone}:{at,timeZone:settings.timeZone};
    }
    const validated=taskFieldsInput(fields,op.kind==='update');
    operations.push(op.kind==='create'?{kind:'create',input:validated}:{kind:'update',id:target.id,expectedRevision:target.revision,patch:validated});
  }
  return {outcome:'proposal',operations,message:''};
}
export function previewChanges(operations,snapshot) {
  return operations.map(op=>{
    const old=op.kind==='update'?snapshot.find(t=>t.id===op.id):null,fields=op.kind==='create'?op.input:op.patch;
    return {kind:op.kind,title:fields.title??old.title,fields:structuredClone(fields),...old?{taskId:old.id,before:Object.fromEntries(Object.keys(fields).map(k=>[k,old[k]??null]))}:{}};
  });
}
export function proposalMessage(changes,language) {
  const zh=language==='zh-CN';
  const when=v=>v==null?(zh?'无':'none'):v.kind==='date'?`${v.date} [${v.timeZone}]`:`${new Intl.DateTimeFormat(zh?'zh-CN':'en-GB',{timeZone:v.timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZoneName:'shortOffset'}).format(new Date(v.at))} [${v.timeZone}]`;
  return (zh?'是否保存以下任务变更？':'Save the following task changes?')+'\n'+changes.map(c=>{
    const parts=[`${c.kind==='create'?(zh?'创建':'Create'):(zh?'修改':'Update')}: ${c.title}`];
    for(const [key,label] of [['plannedAt',zh?'计划时间':'Planned'],['deadline',zh?'截止时间':'Due']])if(Object.hasOwn(c.fields,key))parts.push(`${label}: ${when(c.fields[key])}`);
    if(c.fields.status)parts.push(`${zh?'状态':'Status'}: ${c.fields.status}`);
    if(Object.hasOwn(c.fields,'estimatedMinutes'))parts.push(`${zh?'预计分钟':'Estimated minutes'}: ${c.fields.estimatedMinutes??'—'}`);
    if(c.fields.priority)parts.push(`${zh?'优先级':'Priority'}: ${c.fields.priority}`);
    if(Object.hasOwn(c.fields,'notes'))parts.push(zh?'备注将更新':'Notes will change');
    return parts.join(' · ');
  }).join('\n');
}
export function textDecision(text) {
  const value=text.trim().toLowerCase().replace(/[.!?。！？，,]+$/u,'');
  if(['yes','yes please','confirm','ok','okay','是','是的','好','好的','确认','确认添加','同意'].includes(value))return 'confirm';
  if(['no','no thanks','cancel',"don't add",'do not add','不','否','不要','不用','不用了','取消','先不加了'].includes(value))return 'cancel';
  return undefined;
}
