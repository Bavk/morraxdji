// Windows owns the API lifecycle and a local LiveKit SFU running in Docker Desktop.
// No cloud LiveKit credentials or external API server are required for LAN testing.
const {app, BrowserWindow, ipcMain, safeStorage, dialog} = require('electron');
const {manager:makeVpnManager} = require('./vpn-manager.cjs');
const {cleanupStalePeers,deleteRoomThenCleanup} = require('./room-lifecycle.cjs');
const {makeDiagnosticReport} = require('./diagnostic-report.cjs');
const {ADDRESS:VPN_IP} = require('./vpn.cjs');
const {checkMediaPorts,assertMediaPortsAvailable} = require('./preflight.cjs');
const {renderCompose,renderLivekitConfig} = require('./compose-config.cjs');
const {inspectManagedServer,recoverManagedServer} = require('./server-recovery.cjs');
const {findWireGuard,installTunnel} = require('./wireguard-service.cjs');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const {pathToFileURL} = require('node:url');
let apiServer = null;
let selectedIP = null;
let composeFile = null;
let stopping = null;
let starting = null;
let shuttingDown = false;
let quitting = false;
let apiPassword = '';
let activeMode = 'lan';
let peerCleanupInFlight = null;
function vpn(){return makeVpnManager({dataDir:path.join(app.getPath('userData'),'local-server'),safeStorage});}

function localIPs() {
  const addresses = new Set();
  for (const network of Object.values(os.networkInterfaces())) {
    for (const item of network || []) {
      if (item.family === 'IPv4' && !item.internal &&
          !item.address.startsWith('169.254.') && !item.address.startsWith('127.')) addresses.add(item.address);
    }
  }
  return [...addresses].sort((a,b) => Number(b.startsWith('192.168.')) - Number(a.startsWith('192.168.')));
}
function run(program, args, cwd, limit=90000) {
  return new Promise((resolve,reject) => {
    const child=spawn(program,args,{cwd,windowsHide:true,shell:false});
    let output='';
    let done=false;
    const finish = (err, result) => { if(done)return; done=true;clearTimeout(timeout); if(err)reject(err);else resolve(result); };
    const timeout=setTimeout(()=>{child.kill();finish(new Error(`Истекло время ожидания команды ${program}. ${output.slice(-1200)}`));},limit);
    child.on('error',e=>finish(new Error(`Не удаётся запустить ${program}: ${e.message}. Проверьте Docker Desktop.`)));
    child.stdout.on('data',b=>{output+=String(b);output=output.slice(-7000);});
    child.stderr.on('data',b=>{output+=String(b);output=output.slice(-7000);});
    child.on('close',code=>code===0?finish(null,output):finish(new Error(`${program} завершился с кодом ${code}: ${output.slice(-2400)}`)));
  });
}
function waitForTcp(host,port,limit=25000){
  return new Promise(async (resolve,reject)=>{
    const until=Date.now()+limit;
    while(Date.now()<until){
      const ready=await new Promise(r=>{
        const socket=net.createConnection({host,port});
        const timer=setTimeout(()=>{socket.destroy();r(false);},700);
        socket.once('connect',()=>{clearTimeout(timer);socket.end();r(true);});
        socket.once('error',()=>{clearTimeout(timer);r(false);});
      });
      if(ready)return resolve();
      await new Promise(r=>setTimeout(r,400));
    }
    reject(new Error('LiveKit не отвечает на 127.0.0.1:7880. Проверьте docker compose logs.'));
  });
}
function loadOrCreateSecrets(dataDir){
  const p=path.join(dataDir,'internal-secrets.json');
  if(fs.existsSync(p)) {
    const config=JSON.parse(fs.readFileSync(p,'utf8'));
    if(config.apiKey && config.apiSecret && config.password)return config;
    throw Error('Повреждён файл internal-secrets.json');
  }
  const values={
    apiKey:'usc'+crypto.randomBytes(9).toString('hex'),
    apiSecret:crypto.randomBytes(40).toString('base64url'),
    password:crypto.randomBytes(36).toString('base64url')
  };
  fs.writeFileSync(p,JSON.stringify(values,null,2),{mode:0o600,flag:'wx'});
  return values;
}
async function startServer(ip,mode="lan"){
  if(starting)return starting;
  starting=startServerInternal(ip,mode);
  try{return await starting;}finally{starting=null;}
}
async function startServerInternal(ip,mode="lan"){
  if(apiServer)return status();
  const ips=localIPs();
  if(!['vpn','lan'].includes(mode))throw Error('Некорректный режим подключения');
  if(mode==='vpn'&&!vpn().status().configured)throw Error('Сначала настройте VPN');
  if(mode==='vpn'&&!ips.includes(VPN_IP))throw Error('Сначала включите туннель usc-host в WireGuard Windows (адрес 10.77.0.1)');
  if(mode==='lan'&&!ips.includes(ip))throw Error('Выберите актуальный IPv4-адрес Windows-компьютера');
  await assertMediaPortsAvailable();
  const advertisedIP=mode==='vpn'?VPN_IP:ip;
  const dataDir=path.join(app.getPath('userData'),'local-server');
  fs.mkdirSync(dataDir,{recursive:true});
  const keys=loadOrCreateSecrets(dataDir);
  apiPassword=keys.password;
  // RTC candidates advertise the Windows LAN IP rather than the Docker bridge IP.
  const yaml=renderLivekitConfig(advertisedIP,keys.apiKey,keys.apiSecret);
  const compose=renderCompose(advertisedIP);
  fs.writeFileSync(path.join(dataDir,'livekit.yaml'),yaml,{mode:0o600});
  composeFile=path.join(dataDir,'compose.yaml');
  fs.writeFileSync(composeFile,compose,{mode:0o600});
  try{
    await run('docker',['compose','-f',composeFile,'up','-d','--remove-orphans'],dataDir,120000);
    await waitForTcp('127.0.0.1',7880);
    const loc=app.isPackaged ? path.join(process.resourcesPath,'server','server.mjs') : path.join(__dirname,'..','server','server.mjs');
    const {createApiServer}=await import(pathToFileURL(loc).href);
    apiServer=await createApiServer({
      host:'0.0.0.0',port:3100,operatorAccess:mode==='vpn'?'vpn-only':'any',
      operatorVpnAddressForId:mode==='vpn' ? keyId=>vpn().peerAddress(keyId) : undefined,
      dataPath:path.join(dataDir,'rooms.json'),
      adminPassword:apiPassword,apiKey:keys.apiKey,apiSecret:keys.apiSecret,
      wsUrl:`ws://${advertisedIP}:7880`,desktopWsUrl:'ws://127.0.0.1:7880',
      livekitHttpUrl:'http://127.0.0.1:7880'
    });
    selectedIP=advertisedIP;
    activeMode=mode;
    return status();
  }catch(e){
    await stopServer();
    throw e;
  }
}
function status(){return {
  running:!!apiServer,lanIp:selectedIP,mode:activeMode,vpn:vpn().status(),
  operatorUrl:selectedIP?`http://${selectedIP}:3100`:null,
  mediaUrl:selectedIP?`ws://${selectedIP}:7880`:null,
  ips:localIPs()
};}
async function stopServer(){
  if(stopping)return stopping;
  stopping=(async()=>{
    if(apiServer){const srv=apiServer;apiServer=null;await new Promise(resolve=>srv.close(resolve));}
    selectedIP=null;apiPassword='';activeMode='lan';
    if(composeFile){const f=composeFile;composeFile=null;try{await run('docker',['compose','-f',f,'down'],path.dirname(f),20000);}catch(e){console.warn('Docker stop:',e.message);}}
    return status();
  })();
  try{return await stopping;}finally{stopping=null;}
}
async function diagnostics(){
  let dockerReady=false;let dockerError='';
  try{await run('docker',['info','--format','{{.ServerVersion}}'],process.cwd(),7500);dockerReady=true;}
  catch(e){dockerError=String(e.message).slice(0,220);}
  const ips=localIPs();
  const ports=apiServer?[]:await checkMediaPorts();
  const relay=await vpn().probeRelay();
  let previousServer={configured:false,running:false};
  if(dockerReady){
    try{previousServer=await inspectManagedServer(path.join(app.getPath('userData'),'local-server'),run);}
    catch(e){previousServer={configured:false,running:false,error:String(e.message).slice(0,180)};}
  }
  return {relay,previousServer,dockerReady,dockerError,ports,wireGuardInstalled:!!findWireGuard(),vpnConfigured:vpn().status().configured,
    vpnInterfaceUp:ips.includes(VPN_IP),vpnAddress:VPN_IP,ips,
    apiPort:3100,livekitTcpPort:7880,mediaUdpPort:7882};
}
async function api(method,endpoint,payload){
  if(!apiServer || !apiPassword)throw Error('Сначала запустите сервер');
  const r=await fetch(`http://127.0.0.1:3100${endpoint}`,{
    method,headers:{Authorization:`Bearer ${apiPassword}`,'Content-Type':'application/json'},
    ...(payload===undefined?{}:{body:JSON.stringify(payload)})
  });
  const content=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(content.error || `HTTP ${r.status}`);
  return content;
}
// At most one clean-up pass at a time; periodic retries survive VPS outages
// because failed peer IDs remain in the local encrypted-settings directory.
async function reconcileVpnPeers(){
  if(peerCleanupInFlight)return peerCleanupInFlight;
  if(!apiServer)return {removed:0,failed:[],remaining:0};
  peerCleanupInFlight=cleanupStalePeers({api,vpn:vpn()});
  try{return await peerCleanupInFlight;}finally{peerCleanupInFlight=null;}
}
// Periodic retry, not a background promise to the user. Works only while the
// Windows desktop application is running and its API server is available.
const peerCleanupTimer=setInterval(()=>{
  if(apiServer && !stopping && !shuttingDown)
    void reconcileVpnPeers().catch(e=>console.warn('VPN peer reconciliation:',e.message));
},60000);
peerCleanupTimer.unref?.();
function mainWindow(){
  const win=new BrowserWindow({width:1370,height:870,minWidth:870,minHeight:580,
    backgroundColor:'#101722',webPreferences:{preload:path.join(__dirname,'preload.cjs'),
      nodeIntegration:false,contextIsolation:true,sandbox:true}});
  win.loadFile(path.join(__dirname,'dist','index.html'));
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
}
ipcMain.handle('server:start',(_,ip,mode)=>startServer(String(ip),String(mode||'lan')));
ipcMain.handle('vpn:configure',(_,data)=>vpn().configure(data));
ipcMain.handle('vpn:status',()=>vpn().status());
ipcMain.handle('vpn:activate',async()=>{
  if(localIPs().includes(VPN_IP))return diagnostics();
  if(apiServer)throw Error('Остановите сервер перед изменением VPN-туннеля');
  const state=vpn().status();
  if(!state.configured || !state.configPath)throw Error('Сначала настройте VPN-ретранслятор');
  await installTunnel(state.configPath);
  return diagnostics();
});
ipcMain.handle('server:stop',async()=>{if(starting)await starting.catch(()=>{});return stopServer();});
ipcMain.handle('server:recover',async()=>{
  if(apiServer || starting || stopping)throw Error('Нельзя восстанавливать контейнер во время работы приложения');
  return recoverManagedServer(path.join(app.getPath('userData'),'local-server'),run);
});
ipcMain.handle('server:status',()=>status());
ipcMain.handle('server:diagnostics',()=>diagnostics());
ipcMain.handle('diagnostics:save',async()=>{
  const diagnostic=await diagnostics();
  const report=makeDiagnosticReport({diag:diagnostic,status:status(),version:app.getVersion()});
  const {canceled,filePath}=await dialog.showSaveDialog({
    title:'Сохранить обезличенную диагностику',
    defaultPath:'USC_diagnostics.json',
    filters:[{name:'JSON',extensions:['json']}]
  });
  if(canceled||!filePath)return {saved:false};
  fs.writeFileSync(filePath,JSON.stringify(report,null,2)+'\n',{flag:'w',mode:0o600});
  return {saved:true};
});
ipcMain.handle('room:reconcile',()=>api('POST','/api/admin/reconcile-revoked',{}));
ipcMain.handle('room:list',()=>api('GET','/api/admin/rooms'));
ipcMain.handle('vpn:cleanup',()=>reconcileVpnPeers());
ipcMain.handle('room:create',(_,name)=>api('POST','/api/admin/rooms',{name}));
ipcMain.handle('room:delete',(_,id)=>deleteRoomThenCleanup({id,api,vpn:vpn(),
  cleanup:async()=>{if(peerCleanupInFlight)await peerCleanupInFlight.catch(()=>{});return reconcileVpnPeers();}}));
ipcMain.handle('key:create',(_,id,name)=>{
  const create=()=>api('POST',`/api/admin/rooms/${encodeURIComponent(id)}/keys`,{name});
  const revoke=keyId=>api('DELETE',`/api/admin/rooms/${encodeURIComponent(id)}/keys/${encodeURIComponent(keyId)}`);
  return activeMode==='vpn'?vpn().createOperator(create,revoke):create();
});
ipcMain.handle('key:revoke',(_,id,keyId)=>{
  const local=()=>api('DELETE',`/api/admin/rooms/${encodeURIComponent(id)}/keys/${encodeURIComponent(keyId)}`);
  return vpn().status().configured && vpn().hasPeer(String(keyId))?vpn().revokeOperator(String(keyId),local):local();
});
ipcMain.handle('room:view',(_,id)=>api('POST',`/api/admin/rooms/${encodeURIComponent(id)}/viewer`,{}));
ipcMain.handle('room:selftest',(_,id)=>api('POST',`/api/admin/rooms/${encodeURIComponent(id)}/selftest`,{}));
ipcMain.handle('room:presence',(_,id)=>api('GET',`/api/admin/rooms/${encodeURIComponent(id)}/presence`));
const primaryInstance = app.requestSingleInstanceLock();
if(!primaryInstance){app.quit();}
else {
  app.on('second-instance',()=>{const win=BrowserWindow.getAllWindows()[0];if(win){if(win.isMinimized())win.restore();win.focus();}});
  app.whenReady().then(mainWindow);
}
app.on('before-quit',e=>{
  if(shuttingDown || (!apiServer && !composeFile && !starting))return;
  e.preventDefault();
  if(quitting)return;
  quitting=true;
  // Do not leave an orphaned Docker project when the window closes mid-start.
  Promise.resolve(starting).catch(()=>{}).then(()=>stopServer()).finally(()=>{shuttingDown=true;app.quit();});
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)mainWindow();});
