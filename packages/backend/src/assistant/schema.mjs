import { AppError } from '../errors.mjs';
import { object, taskFieldsInput } from '../validation.mjs';

const string={type:'string'};
const deadline={anyOf:[{type:'null'},{type:'object',additionalProperties:false,required:['kind','date'],properties:{kind:{enum:['date','local']},date:string,time:string}}]};
const plannedAt={anyOf:[{type:'null'},{type:'object',additionalProperties:false,required:['kind','date','time'],properties:{kind:{const:'local'},date:string,time:string}}]};
const fields={title:string,notes:string,priority:{enum:['low','normal','high']},estimatedMinutes:{anyOf:[{type:'integer',minimum:1,maximum:10080},{type:'null'}]},deadline,plannedAt};
export const intentTool={type:'function',function:{name:'record_task_intent',description:'Respond conversationally, propose task operations for user confirmation, ask a necessary clarification, or explain an unsupported action. Never execute or authorize changes.',parameters:{
  type:'object',additionalProperties:false,required:['outcome','language'],properties:{
    outcome:{enum:['apply','chat','clarification','unsupported']},language:{enum:['en-US','zh-CN']},question:string,
    operations:{type:'array',minItems:1,maxItems:20,items:{anyOf:[
      {type:'object',additionalProperties:false,required:['kind','input'],properties:{kind:{const:'create'},input:{type:'object',additionalProperties:false,required:['title'],properties:fields}}},
      {type:'object',additionalProperties:false,required:['kind','id','patch'],properties:{kind:{const:'update'},id:string,patch:{type:'object',additionalProperties:false,minProperties:1,properties:{...fields,status:{enum:['pending','completed']}}}}}
    ]}}
  }
}}};
export function validateIntent(value) {
  try {
    object(value,['outcome','language','question','operations']);
    if(!['en-US','zh-CN'].includes(value.language)) throw Error();
    if(value.outcome!=='apply') {
      if(!['chat','clarification','unsupported'].includes(value.outcome)||Object.hasOwn(value,'operations')||typeof value.question!=='string'||!value.question.trim()||value.question.length>(value.outcome==='chat'?8000:1000)||!value.question.isWellFormed()) throw Error();
      return value;
    }
    if(Object.hasOwn(value,'question')||!Array.isArray(value.operations)||!value.operations.length||value.operations.length>20) throw Error();
    for(const op of value.operations) {
      const create=op?.kind==='create';
      object(op,create?['kind','input']:['kind','id','patch']);
      if(!create&&(op.kind!=='update'||typeof op.id!=='string'||!/^[0-9a-f-]{36}$/i.test(op.id))) throw Error();
      const f=create?op.input:op.patch;
      object(f,['title','notes','priority','estimatedMinutes','deadline','plannedAt',...create?[]:['status']]);
      if(!Object.keys(f).length) throw Error();
      const copy={...f};
      if(copy.deadline!=null) {
        const d=copy.deadline;
        object(d,d.kind==='date'?['kind','date']:['kind','date','time']);
        if(!['date','local'].includes(d.kind)) throw Error();
        taskFieldsInput({deadline:{kind:'date',date:d.date,timeZone:'UTC'}},true);
        if(d.kind==='local'&&(typeof d.time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(d.time))) throw Error();
        delete copy.deadline;
      }
      if(copy.plannedAt!=null) {
        const p=copy.plannedAt;object(p,['kind','date','time']);
        if(p.kind!=='local'||typeof p.time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.time)) throw Error();
        taskFieldsInput({deadline:{kind:'date',date:p.date,timeZone:'UTC'}},true);
        delete copy.plannedAt;
      }
      if(Object.keys(copy).length||create) taskFieldsInput(copy,!create);
    }
    return value;
  } catch { throw new AppError('AI_INVALID_RESPONSE'); }
}
