// Real Electron renderer/preload smoke test for CI. No Docker/VPN or camera needed.
// Run only as an Electron entry point: npx electron smoke.cjs
const {app, BrowserWindow, ipcMain, powerSaveBlocker} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'usc-electron-smoke-'));
app.setPath('userData', tmp);
app.disableHardwareAcceleration();
// The real preload invokes server:status during renderer startup. In a smoke
// process, answer only this IPC with synthetic NON-SECRET state: Docker/VPN
// must never be started just to verify the desktop UI.
const {PowerGuard}=require('./power-guard.cjs');
const powerGuard=new PowerGuard({blocker:powerSaveBlocker,file:path.join(tmp,'power-preferences.json')});
ipcMain.handle('power:configure',(_,enabled)=>powerGuard.setEnabled(enabled));
ipcMain.handle('server:status', async () => ({power:powerGuard.status(),running:false,mode:'lan',ips:['192.0.2.20'],
  vpn:{configured:false,peerCount:0},lanIp:null,operatorUrl:null,mediaUrl:null}));
ipcMain.handle('archive:list',()=>[]);
ipcMain.handle('events:list',()=>[]);
let finished = false;
const failures = [];
function end(code, message){
  if(finished)return;
  finished=true;
  console.log(`USC_ELECTRON_SMOKE_${code===0?'PASS':'FAIL'}: ${message}`);
  // Windows cleanup may be asynchronous; Electron is already out of the test app.
  app.exit(code);
}
const timeout = setTimeout(()=>end(1, `Renderer was not ready within 20s; ${failures.join('; ')}`),20000);
app.whenReady().then(async()=>{
  if(!fs.existsSync(path.join(__dirname,'dist','index.html')))
    return end(1,'Missing dist/index.html. Run npm run build:ui first.');
  const win = new BrowserWindow({show:false,width:1200,height:800,
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),sandbox:true,
      contextIsolation:true,nodeIntegration:false}});
  win.webContents.on('did-fail-load',(_event,code,description)=>end(1,`${code}: ${description}`));
  win.webContents.on('render-process-gone',(_event,details)=>end(1,`Renderer process gone: ${details.reason}`));
  win.webContents.on('console-message',(_event,details)=>{
    if(details.level==='error') failures.push(details.message.slice(0,220));
  });
  await win.loadFile(path.join(__dirname,'dist','index.html'));
  for(let attempt=0;attempt<70 && !finished;attempt++){
    const result = await win.webContents.executeJavaScript(`({
      api: Boolean(window.streamControl && typeof window.streamControl.startServer === 'function'
        && typeof window.streamControl.rooms === 'function'),
      screen: Boolean(document.querySelector('#startForm') && document.querySelector('#networkMode')
        && document.querySelector('#startButton')),
      error: document.querySelector('#error')?.textContent || ''
    })`).catch(error=>({error:String(error)}));
    if(result.api && result.screen && !result.error){
      await win.webContents.executeJavaScript("document.querySelector('#keepAwake').click()");
      for(let i=0;i<30&&powerGuard.status().enabled;i++)await new Promise(resolve=>setTimeout(resolve,50));
      if(powerGuard.status().enabled||powerGuard.status().active)return end(1,'Power preference did not update while stopped');
      await win.webContents.executeJavaScript("document.querySelector('#openArchive').click()");
      for(let i=0;i<30;i++){
        if(await win.webContents.executeJavaScript("Boolean(document.querySelector('#recordingArchive .archive-list .empty'))")){
          await win.webContents.executeJavaScript("document.querySelector('.archive-close').click()");
          await win.webContents.executeJavaScript("document.querySelector('#openEvents').click()");
          for(let j=0;j<30;j++){if(await win.webContents.executeJavaScript("Boolean(document.querySelector('#eventLog .empty'))")){clearTimeout(timeout);return end(0,'Renderer, preload, startup, offline archive and event log loaded');}await new Promise(resolve=>setTimeout(resolve,100));}
          return end(1,'Offline event log not ready');
        }
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      return end(1,'Offline recording archive not ready');
    }
    if(result.error) failures.push(result.error.slice(0,220));
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  end(1,`Startup screen not ready; ${failures.slice(-3).join('; ')}`);
}).catch(error=>end(1,String(error)));
