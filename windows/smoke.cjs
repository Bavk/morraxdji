// Real Electron renderer/preload smoke test for CI. No Docker/VPN or camera needed.
// Run only as an Electron entry point: npx electron smoke.cjs
const {app, BrowserWindow, ipcMain} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'usc-electron-smoke-'));
app.setPath('userData', tmp);
app.disableHardwareAcceleration();
// The real preload invokes server:status during renderer startup. In a smoke
// process, answer only this IPC with synthetic NON-SECRET state: Docker/VPN
// must never be started just to verify the desktop UI.
ipcMain.handle('server:status', async () => ({running:false,mode:'lan',ips:['192.0.2.20'],
  vpn:{configured:false,peerCount:0},lanIp:null,operatorUrl:null,mediaUrl:null}));
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
    if(result.api && result.screen && !result.error){clearTimeout(timeout);return end(0,'Renderer, preload API and startup screen loaded');}
    if(result.error) failures.push(result.error.slice(0,220));
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  end(1,`Startup screen not ready; ${failures.slice(-3).join('; ')}`);
}).catch(error=>end(1,String(error)));
