import { app, BrowserWindow, ipcMain, dialog, session, safeStorage } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { createDispatcher } from '../../../packages/backend/src/dispatch.mjs';
import { registerIpc } from './ipc.mjs';
import { configureUserData } from './profile.mjs';
import { createAssistantVault } from './assistant-config.mjs';
import { createAssistantService } from '../../../packages/backend/src/assistant/service.mjs';
import { createDeepSeekProvider } from '../../../packages/backend/src/assistant/provider.mjs';

app.setName('Reminder');
let window, store, dispose;
let profileError = false;
try { configureUserData(app, process.env.REMINDER_USER_DATA_DIR); }
catch { profileError = true; }
if (profileError) {
  dialog.showErrorBox('Reminder', 'The development data directory is invalid or unavailable. Default data has not been opened.');
  app.exit(1);
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    dispose?.();
    store?.close();
  });
  app.whenReady().then(async () => {
    try {
      const here=dirname(fileURLToPath(import.meta.url));
      const renderer=join(here,'../renderer/dist/index.html');
      if (!existsSync(renderer)) {
        dialog.showErrorBox('Reminder', 'The app interface has not been built. Build apps/desktop/renderer before starting Reminder.');
        app.exit(1);
        return;
      }
      // Import after ready so an unsupported bundled Node runtime fails visibly.
      const {openStore}=await import('../../../packages/backend/src/store.mjs');
      const userData=app.getPath('userData');
      mkdirSync(userData,{recursive:true});
      store=openStore(join(userData,'reminder.sqlite'));
      session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
      session.defaultSession.setPermissionCheckHandler(()=>false);
      window=new BrowserWindow({
        width:1100,height:760,minWidth:760,minHeight:540,
        webPreferences:{
          preload:join(here,'preload.cjs'),
          contextIsolation:true,sandbox:true,nodeIntegration:false,webSecurity:true
        }
      });
      window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
      window.webContents.on('will-navigate',event=>event.preventDefault());
      window.webContents.on('will-attach-webview',event=>event.preventDefault());
      const assistant=createAssistantService({store,
        vault:createAssistantVault(join(userData,'assistant-config.json'),safeStorage),
        provider:createDeepSeekProvider(),regionalLocale:app.getSystemLocale()});
      dispose=registerIpc(ipcMain,createDispatcher(store),()=>window?.isDestroyed()?null:window?.webContents,pathToFileURL(renderer).href,assistant);
      await window.loadFile(renderer);
    } catch {
      dialog.showErrorBox('Reminder', 'Reminder could not open its local data or interface. Your data has not been reset. Close other instances and check storage access.');
      dispose?.();
      try { store?.close(); } catch {}
      app.exit(1);
    }
  });
}
