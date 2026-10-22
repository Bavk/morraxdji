// Actual two-room video decoding in the real renderer, using synthetic canvas publishers.
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {NativeLiveKit,binaryPath}=require('./native-livekit.cjs');
const {renderLivekitConfig}=require('./compose-config.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'usc-wall-smoke-'));
app.setPath('userData',dir);app.disableHardwareAcceleration();
app.on('window-all-closed',()=>{});
let api,viewer,publisher;const native=new NativeLiveKit(binaryPath());
async function until(check,label,timeout=30000){
 const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,150));}throw Error('Timeout: '+label);
}
async function cleanup(){
 viewer?.destroy();publisher?.destroy();if(api){const server=api;api=null;await new Promise(r=>server.close(r));}await native.stop();
 // Chromium keeps its temporary profile open until app.exit; remove synthetic credentials only.
 for(const name of ['livekit.yaml','rooms.json'])fs.rmSync(path.join(dir,name),{force:true});
}
const deadline=setTimeout(()=>{console.error('Wall smoke exceeded 90 seconds');app.exit(1);},90000);
app.whenReady().then(async()=>{
 const ip=Object.values(os.networkInterfaces()).flat().find(x=>x.family==='IPv4'&&!x.internal&&!x.address.startsWith('169.254.')).address;
 const apiKey='usc'+crypto.randomBytes(9).toString('hex'),apiSecret=crypto.randomBytes(40).toString('base64url'),password=crypto.randomBytes(32).toString('hex');
 const config=path.join(dir,'livekit.yaml');
 fs.writeFileSync(config,renderLivekitConfig(ip,apiKey,apiSecret).replace('port: 7880','port: 17880').replace('tcp_port: 7881','tcp_port: 17881').replace('udp_port: 7882','udp_port: 17882'));
 await native.start(config);
 await until(async()=>{try{return (await fetch('http://127.0.0.1:17880')).ok;}catch{return false;}},'native SFU');
 const {createApiServer}=await import('../server/server.mjs');
 api=await createApiServer({host:'127.0.0.1',port:0,dataPath:path.join(dir,'rooms.json'),adminPassword:password,apiKey,apiSecret,wsUrl:`ws://${ip}:17880`,desktopWsUrl:'ws://127.0.0.1:17880',livekitHttpUrl:'http://127.0.0.1:17880'});
 const base=`http://127.0.0.1:${api.address().port}`;
 const call=async(route,method='GET',data)=>{
  const response=await fetch(base+route,{method,headers:{authorization:`Bearer ${password}`,'content-type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});
  assert.ok(response.ok,route+' '+response.status);return response.json();
 };
 const rooms=[];for(const name of ['Пульт A','Пульт B'])rooms.push((await call('/api/admin/rooms','POST',{name})).room);
 ipcMain.handle('server:status',()=>({running:true,mode:'lan',ips:[ip],vpn:{configured:false},operatorUrl:base}));
 ipcMain.handle('room:list',()=>call('/api/admin/rooms'));
 ipcMain.handle('room:view',(_,id)=>call(`/api/admin/rooms/${id}/viewer`,'POST',{}));
 ipcMain.handle('room:presence',(_,id)=>call(`/api/admin/rooms/${id}/presence`));
 viewer=new BrowserWindow({show:false,width:1600,height:1000,webPreferences:{preload:path.join(__dirname,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 await viewer.loadFile(path.join(__dirname,'dist/index.html'));
 await until(()=>viewer.webContents.executeJavaScript("Boolean(document.querySelector('#allControllers'))"),'dashboard');
 await viewer.webContents.executeJavaScript("document.querySelector('#allControllers').click()");
 const configs=[];for(const room of rooms)configs.push(await call(`/api/admin/rooms/${room.id}/selftest`,'POST',{}));
 const {build}=await import('vite');
 const built=await build({configFile:false,logLevel:'error',build:{write:false,lib:{entry:path.join(__dirname,'testing/wall-publishers.mjs'),formats:['iife'],name:'USCWallPublisher'},minify:false}});
 const bundle=(Array.isArray(built)?built[0]:built).output.find(x=>x.type==='chunk').code;
 publisher=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 await publisher.loadURL('data:text/html,<html><body>USC synthetic publishers</body></html>');
 await publisher.webContents.executeJavaScript(bundle+`;USCWallPublisher.start(${JSON.stringify(configs)})`);
 await until(()=>viewer.webContents.executeJavaScript("document.querySelectorAll('.tile video').length===2 && [...document.querySelectorAll('.tile video')].every(v=>v.videoWidth>0 && v.readyState>=2 && v.getVideoPlaybackQuality().totalVideoFrames>=3)"),'two decoded video streams');
 assert.equal(await viewer.webContents.executeJavaScript("document.querySelectorAll('.wall-room-state.connected').length"),2);
 assert.equal(await viewer.webContents.executeJavaScript("getComputedStyle(document.querySelector('#placeholder')).display"),'none');
 await viewer.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
 fs.mkdirSync(path.join(__dirname,'release'),{recursive:true});
 fs.writeFileSync(path.join(__dirname,'release/wall-smoke.png'),(await viewer.webContents.capturePage()).toPNG());
 await viewer.webContents.executeJavaScript("document.querySelector('.focus-button').click()");
 assert.equal(await viewer.webContents.executeJavaScript("document.querySelectorAll('.tile:not([hidden])').length"),1);
 await viewer.webContents.executeJavaScript("document.querySelector('.tile:not([hidden]) .focus-button').click()");
 await publisher.webContents.executeJavaScript('USCWallPublisher.stop(0)');
 await until(()=>viewer.webContents.executeJavaScript("document.querySelectorAll('.tile video').length===1 && document.querySelector('.tile video').videoWidth>0"),'second stream survives first publisher disconnect');
 await viewer.webContents.executeJavaScript("document.querySelector('[data-room]').click()");
 await until(()=>viewer.webContents.executeJavaScript("!document.querySelector('.keys-panel').hidden && document.querySelector('#wallRoomStates').hidden"),'return to single room');
 console.log('USC_WALL_SMOKE_PASS: two decoded rooms, focus/grid, independent disconnect, return to room');
}).then(async()=>{clearTimeout(deadline);await cleanup();app.exit(0);}).catch(async error=>{console.error(error);clearTimeout(deadline);try{await cleanup();}finally{app.exit(1);}});
