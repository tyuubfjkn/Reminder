const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('reminder', {
  apiVersion:'1.0.0',
  assistant:{
    apiVersion:'1.0.0',
    getConfig:()=>ipcRenderer.invoke('reminder:assistant:getConfig'),
    configure:input=>ipcRenderer.invoke('reminder:assistant:configure',input),
    submit:input=>ipcRenderer.invoke('reminder:assistant:submit',input),
    undo:input=>ipcRenderer.invoke('reminder:assistant:undo',input)
  },
  tasks:{
    list:()=>ipcRenderer.invoke('reminder:tasks:list'),
    create:input=>ipcRenderer.invoke('reminder:tasks:create',input),
    update:input=>ipcRenderer.invoke('reminder:tasks:update',input)
  },
  settings:{
    get:()=>ipcRenderer.invoke('reminder:settings:get'),
    update:input=>ipcRenderer.invoke('reminder:settings:update',input),
    onChanged:callback=>{
      if(typeof callback!=='function')throw new TypeError('Expected callback');
      const listener=()=>callback();ipcRenderer.on('reminder:settings:changed',listener);
      return ()=>ipcRenderer.removeListener('reminder:settings:changed',listener);
    }
  }
});
