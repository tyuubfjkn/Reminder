import {AppError} from '../../../packages/backend/src/errors.mjs';
import {timeZone} from '../../../packages/backend/src/validation.mjs';
import {createDispatcher} from '../../../packages/backend/src/dispatch.mjs';

const withSource=settings=>({...settings,timeZoneSource:'system'});
export function createSystemTimeZoneSync({store,readTimeZone=()=>new Intl.DateTimeFormat().resolvedOptions().timeZone,onChange=()=>{}}) {
  return {refresh() {
    const current=store.getSettings();let zone;
    // A temporary OS/ICU lookup failure must not replace a known valid zone with a guess.
    try {zone=timeZone(readTimeZone());}catch{return withSource(current);}
    if(zone===current.timeZone)return withSource(current);
    const changed=store.updateSettings({expectedRevision:current.revision,patch:{timeZone:zone}});
    onChange();return withSource(changed);
  }};
}
export function createSystemDispatcher(store,sync) {
  const dispatch=createDispatcher(store);
  return (method,params)=>{
    try {
      sync.refresh();
      if(method==='settings.update'&&params?.patch&&Object.hasOwn(params.patch,'timeZone'))throw new AppError('VALIDATION_ERROR','timeZone');
      const result=dispatch(method,params);
      if(result.ok&&(method==='settings.get'||method==='settings.update'))result.data=withSource(result.data);
      return result;
    } catch(e) {return {ok:false,error:{code:e instanceof AppError?e.code:'STORAGE_ERROR',...e instanceof AppError&&e.field?{field:e.field}:{}}};}
  };
}
export function watchSystemTimeZone(sync,powerMonitor,timers={setInterval,clearInterval}) {
  // Timer/resume failures are surfaced by the next request's synchronous refresh, never as unhandled exceptions.
  const refresh=()=>{try{sync.refresh();}catch{}};
  const timer=timers.setInterval(refresh,60000);timer?.unref?.();powerMonitor.on('resume',refresh);
  return ()=>{timers.clearInterval(timer);powerMonitor.removeListener('resume',refresh);};
}
