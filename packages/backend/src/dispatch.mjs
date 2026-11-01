import { AppError } from './errors.mjs';
import { object } from './validation.mjs';

export function createDispatcher(store) {
  const methods = new Map([
    ['tasks.list', params => { object(params ?? {}, []); return store.listTasks(); }],
    ['tasks.create', params => store.createTask(params)],
    ['tasks.update', params => store.updateTask(params)],
    ['settings.get', params => { object(params ?? {}, []); return store.getSettings(); }],
    ['settings.update', params => store.updateSettings(params)]
  ]);
  return (method, params) => {
    try {
      const operation=methods.get(method);
      if (!operation) return {ok:false,error:{code:'UNKNOWN_METHOD'}};
      return {ok:true,data:operation(params)};
    } catch (error) {
      if (error instanceof AppError) return {ok:false,error:{
        code:error.code, ...(error.field ? {field:error.field} : {})
      }};
      return {ok:false,error:{code:'STORAGE_ERROR'}};
    }
  };
}
