const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('reminder', {
  apiVersion:'1.0.0',
  tasks:{
    list:()=>ipcRenderer.invoke('reminder:tasks:list'),
    create:input=>ipcRenderer.invoke('reminder:tasks:create',input),
    update:input=>ipcRenderer.invoke('reminder:tasks:update',input)
  },
  settings:{
    get:()=>ipcRenderer.invoke('reminder:settings:get'),
    update:input=>ipcRenderer.invoke('reminder:settings:update',input)
  }
});
