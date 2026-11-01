const methods = ['tasks.list','tasks.create','tasks.update','settings.get','settings.update'];

export function registerIpc(ipcMain, dispatch, getWebContents, allowedUrl, assistant) {
  const exposed=assistant?[...methods,...['getConfig','configure','submit','undo'].map(name=>'assistant.'+name)]:methods;
  const channels=exposed.map(method => ['reminder:'+method.replace('.',':'),method]);
  for (const [channel,method] of channels) {
    ipcMain.handle(channel,(event,params) => {
      const contents=getWebContents();
      if (!contents || event.sender!==contents || !event.senderFrame ||
          event.senderFrame!==contents.mainFrame || event.senderFrame.url!==allowedUrl) {
        return {ok:false,error:{code:'FORBIDDEN'}};
      }
      return method.startsWith('assistant.') ? assistant[method.slice(10)](params) : dispatch(method,params);
    });
  }
  return () => { for (const [channel] of channels) ipcMain.removeHandler(channel); };
}
