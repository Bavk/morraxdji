// Windows owns the API lifecycle and the bundled native LiveKit SFU.
// No cloud LiveKit credentials or external API server are required for LAN testing.
const {app, BrowserWindow, ipcMain, safeStorage, dialog, protocol, shell, nativeImage, powerSaveBlocker, clipboard} = require('electron');
const {SecretClipboard}=require('./secret-clipboard.cjs');
const secretClipboard=new SecretClipboard({clipboard});
const {validateInvite,saveInvite}=require('./invite-file.cjs');
const {PowerGuard}=require('./power-guard.cjs');
let powerGuardInstance;
function powerGuard(){return powerGuardInstance??=new PowerGuard({blocker:powerSaveBlocker,file:path.join(app.getPath('userData'),'power-preferences.json')});}
const {manager:makeVpnManager} = require('./vpn-manager.cjs');
const {cleanupStalePeers,deleteRoomThenCleanup} = require('./room-lifecycle.cjs');
const {makeDiagnosticReport} = require('./diagnostic-report.cjs');
const {ADDRESS:VPN_IP} = require('./vpn.cjs');
const {checkMediaPorts,assertMediaPortsAvailable} = require('./preflight.cjs');
const {renderLivekitConfig} = require('./compose-config.cjs');
const {NativeLiveKit,binaryPath,managedProcess} = require('./native-livekit.cjs');
const {prepareRecordingSpace,formatSpace}=require('./recording-space.cjs');
const {RecordingStore,recordingName}=require('./recording-store.cjs');
const {RecordingArchive,registerArchiveScheme,handleArchiveProtocol}=require('./recording-archive.cjs');
const {EventLog}=require('./event-log.cjs');
let eventLogInstance;
function eventLog(){return eventLogInstance??=new EventLog(path.join(app.getPath('userData'),'event-log.json'));}
registerArchiveScheme(protocol);
let archiveInstance;
function recordingArchive(){return archiveInstance??=new RecordingArchive(path.join(app.getPath('userData'),'recordings-index.json'));}
const recordings=new RecordingStore({onSaved:result=>recordingArchive().add(result)});
const {SnapshotStore,validatePng,snapshotName}=require('./snapshot-store.cjs');
const snapshotOwners=new Set();
const snapshots=new SnapshotStore({decode:(buffer,size)=>{
 const image=nativeImage.createFromBuffer(buffer),actual=image.getSize();
 if(image.isEmpty()||actual.width!==size.width||actual.height!==size.height)throw Error('Повреждённый PNG-снимок');
}});
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
const livekitExecutable=binaryPath({packaged:app.isPackaged,resourcesPath:process.resourcesPath});
const livekit=new NativeLiveKit(livekitExecutable,{onExit:()=>{
  if(apiServer && !stopping)void stopServer().catch(e=>console.warn('LiveKit shutdown:',e.message));
}});
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
    reject(new Error('Встроенный LiveKit не отвечает на 127.0.0.1:7880. Проверьте диагностику и сетевые порты.'));
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
  // Advertise the selected LAN/VPN interface; bind signaling only to that interface and loopback.
  const yaml=renderLivekitConfig(advertisedIP,keys.apiKey,keys.apiSecret);
  fs.writeFileSync(path.join(dataDir,'livekit.yaml'),yaml,{mode:0o600});
  try{
    await livekit.start(path.join(dataDir,'livekit.yaml'));
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
    if(!livekit.child)throw Error('Встроенный LiveKit неожиданно завершился при запуске');
    selectedIP=advertisedIP;
    activeMode=mode;powerGuard().update(true);
    return status();
  }catch(e){
    await stopServer();
    throw e;
  }
}
function status(){return {
  power:powerGuard().status(),running:!!apiServer,lanIp:selectedIP,mode:activeMode,vpn:vpn().status(),
  operatorUrl:selectedIP?`http://${selectedIP}:3100`:null,
  mediaUrl:selectedIP?`ws://${selectedIP}:7880`:null,
  ips:localIPs()
};}
async function stopServer(){
  if(stopping)return stopping;
  stopping=(async()=>{
    powerGuard().update(false);
    if(apiServer){const srv=apiServer;apiServer=null;await new Promise(resolve=>srv.close(resolve));}
    selectedIP=null;apiPassword='';activeMode='lan';
    await livekit.stop();
    return status();
  })();
  try{return await stopping;}finally{stopping=null;}
}
async function diagnostics(){
  const nativeReady=livekit.available;
  const ips=localIPs();
  const ports=apiServer?[]:await checkMediaPorts();
  const relay=await vpn().probeRelay();
  let previousServer={configured:false,running:false};
  try{previousServer=await managedProcess(livekitExecutable,path.join(app.getPath('userData'),'local-server'));}
  catch{previousServer={configured:true,running:!!livekit.child};}
  return {relay,previousServer,nativeReady,ports,wireGuardInstalled:!!findWireGuard(),vpnConfigured:vpn().status().configured,
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
  const recordingOwner=win.webContents.id;
  win.webContents.once('destroyed',()=>{void recordings.closeOwner(recordingOwner);});
}
ipcMain.handle('recording:begin',async(event,label)=>{
  if(typeof label!=='string'||label.length>300)throw Error('Некорректное имя записи');
  const owner=event.sender.id;
  const {canceled,filePath}=await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender),{
    title:'Записать видео с пульта',defaultPath:path.join(app.getPath('videos'),recordingName(label)),
    filters:[{name:'Видео WebM (без звука)',extensions:['webm']}]
  });
  if(canceled||!filePath||event.sender.isDestroyed())return {canceled:true};
  const space=await prepareRecordingSpace(filePath,{confirmLow:async({freeBytes})=>{const answer=await dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender),{type:'warning',title:'Мало места для видеозаписи',message:'Свободно '+formatSpace(freeBytes),detail:'На выбранном диске осталось менее 1 ГиБ. Длительная запись может не поместиться. Свободное место расходуется всеми программами и записями. Продолжить?',buttons:['Отмена','Начать запись'],defaultId:0,cancelId:0,noLink:true});return answer.response===1;}});
  if(space.canceled||event.sender.isDestroyed())return {canceled:true};
  const result={...await recordings.begin(owner,filePath,{label}),freeBytesAtStart:space.freeBytes};
  if(event.sender.isDestroyed()){await recordings.finish(owner,result.id);return {canceled:true};}
  return result;
});
ipcMain.handle('recording:append',(event,id,bytes)=>recordings.append(event.sender.id,id,bytes));
ipcMain.handle('recording:finish',(event,id)=>recordings.finish(event.sender.id,id));
ipcMain.handle('snapshot:save',async(event,label,png)=>{
 const owner=event.sender.id;if(snapshotOwners.has(owner))throw Error('Дождитесь сохранения предыдущего снимка');
 if(typeof label!=='string'||label.length>300)throw Error('Некорректное имя снимка');
 snapshotOwners.add(owner);
 try{
  validatePng(png);
  const result=await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender),{title:'Сохранить PNG-снимок',defaultPath:path.join(app.getPath('pictures'),snapshotName(label)),filters:[{name:'Изображение PNG',extensions:['png']}]});
  if(result.canceled||!result.filePath||event.sender.isDestroyed())return {canceled:true};
  return await snapshots.save(result.filePath,png);
 }finally{snapshotOwners.delete(owner);}
});
ipcMain.handle('events:append',(_,kind,label)=>eventLog().append(kind,label));
ipcMain.handle('events:list',()=>eventLog().list());
ipcMain.handle('events:export',async event=>{
 const result=await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender),{title:'Экспортировать журнал (выберите новый файл)',defaultPath:'USC_events_'+Date.now()+'.json',filters:[{name:'Журнал JSON',extensions:['json']}]});
 if(result.canceled||!result.filePath)return {saved:false};return eventLog().export(result.filePath);
});
ipcMain.handle('archive:update',(_,id,metadata)=>recordingArchive().updateMetadata(id,metadata));
const archiveRelinkOwners=new Set();
ipcMain.handle('archive:relink',async(event,id)=>{
 const owner=event.sender.id;if(archiveRelinkOwners.has(owner))throw Error('Дождитесь выбора файла для предыдущей записи');
 archiveRelinkOwners.add(owner);
 try{
  const archive=recordingArchive(),record=await archive.get(id);
  const result=await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender),{title:'Найти перенесённый WebM: '+record.label,buttonLabel:'Выбрать запись',filters:[{name:'Видео WebM',extensions:['webm']}],properties:['openFile']});
  if(result.canceled||!result.filePaths?.length)return {canceled:true};
  return await archive.relink(id,result.filePaths[0]);
 }finally{archiveRelinkOwners.delete(owner);}
});
ipcMain.handle('archive:list',()=>recordingArchive().list());
ipcMain.handle('archive:play',(_,id)=>recordingArchive().playback(id));
ipcMain.handle('archive:reveal',async(_,id)=>{shell.showItemInFolder(await recordingArchive().revealPath(id));return {shown:true};});
ipcMain.handle('archive:forget',(_,id)=>recordingArchive().forget(id));
ipcMain.handle('archive:import',async event=>{
 const result=await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender),{title:'Добавить записи в архив',filters:[{name:'Видео WebM',extensions:['webm']}],properties:['openFile','multiSelections']});
 if(result.canceled)return {canceled:true};return recordingArchive().importFiles(result.filePaths);
});
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
  if(apiServer || starting || stopping)throw Error('Нельзя восстанавливать LiveKit во время работы приложения');
  return managedProcess(livekitExecutable,path.join(app.getPath('userData'),'local-server'),{terminate:true});
});
ipcMain.handle('invite:copy',(_,code)=>secretClipboard.copy(code));
ipcMain.handle('invite:save',async(event,code)=>{validateInvite(code);const result=await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender),{title:'Сохранить конфиденциальный код подключения',defaultPath:'USC_connection.usc',filters:[{name:'Код подключения USC (содержит секреты)',extensions:['usc']}]});if(result.canceled||!result.filePath||event.sender.isDestroyed())return {canceled:true};return saveInvite(result.filePath,code);});
ipcMain.handle('power:configure',(_,enabled)=>powerGuard().setEnabled(enabled));
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
ipcMain.handle('room:rename',(_,id,name)=>api('PATCH',`/api/admin/rooms/${encodeURIComponent(id)}`,{name}));
ipcMain.handle('room:create',(_,name)=>api('POST','/api/admin/rooms',{name}));
ipcMain.handle('room:delete',(_,id)=>deleteRoomThenCleanup({id,api,vpn:vpn(),
  cleanup:async()=>{if(peerCleanupInFlight)await peerCleanupInFlight.catch(()=>{});return reconcileVpnPeers();}}));
ipcMain.handle('operator:rooms',(_,keyId,roomIds)=>api('PATCH',`/api/admin/operators/${encodeURIComponent(keyId)}/rooms`,{roomIds}));
ipcMain.handle('key:rename',(_,id,keyId,name)=>api('PATCH',`/api/admin/rooms/${encodeURIComponent(id)}/keys/${encodeURIComponent(keyId)}`,{name}));
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
  app.whenReady().then(()=>{handleArchiveProtocol(protocol,recordingArchive);mainWindow();});
}
app.on('before-quit',e=>{
  if(shuttingDown || (!apiServer && !livekit.child && !starting))return;
  e.preventDefault();
  if(quitting)return;
  quitting=true;
  // Stop the native server even if the window closes during startup.
  Promise.resolve(starting).catch(()=>{}).then(()=>stopServer()).finally(()=>{shuttingDown=true;app.quit();});
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)mainWindow();});

app.on('will-quit',()=>{secretClipboard.clear();powerGuardInstance?.update(false);});
