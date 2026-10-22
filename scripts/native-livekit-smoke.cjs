'use strict';
// Exercise the real Windows binary, authenticated API, and start/stop/restart lifecycle.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {NativeLiveKit,binaryPath,managedProcess}=require('../windows/native-livekit.cjs');
const {renderLivekitConfig}=require('../windows/compose-config.cjs');
const {assertMediaPortsAvailable}=require('../windows/preflight.cjs');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'usc-native-smoke-'));
 const server=new NativeLiveKit(binaryPath());
 let api;
 try{
  await assertMediaPortsAvailable();
  const ip=Object.values(os.networkInterfaces()).flat().find(x=>x.family==='IPv4'&&!x.internal&&!x.address.startsWith('169.254.'))?.address;
  assert.ok(ip,'Missing network interface');
  const apiKey='usc'+crypto.randomBytes(9).toString('hex'),apiSecret=crypto.randomBytes(40).toString('base64url');
  const config=path.join(dir,'livekit.yaml');
  fs.writeFileSync(config,renderLivekitConfig(ip,apiKey,apiSecret));
  for(let attempt=0;attempt<2;attempt++){
   await server.start(config);
   let ready=false;
   for(let i=0;i<100;i++){
    if(!server.child)throw Error('LiveKit exited: '+server.output);
    try{if((await fetch('http://127.0.0.1:7880',{signal:AbortSignal.timeout(500)})).ok){ready=true;break;}}catch{}
    await new Promise(r=>setTimeout(r,100));
   }
   assert.ok(ready,'LiveKit did not become ready');
   assert.equal((await managedProcess(server.executable,dir)).running,true);
   const {LiveKitAdmin}=await import('../server/livekit-admin.mjs');
   const admin=new LiveKitAdmin({apiKey,apiSecret});
   const roomName='usc-native-smoke';
   const created=await admin.call('CreateRoom',{name:roomName},null,true);
   assert.equal(created.name,roomName);
   assert.deepEqual(await admin.listParticipants(roomName),[]);
   assert.equal(await admin.deleteRoom(roomName),true);
   const {createApiServer}=await import('../server/server.mjs');
   const password=crypto.randomBytes(32).toString('hex');
   api=await createApiServer({host:'127.0.0.1',port:3100,dataPath:path.join(dir,'rooms.json'),adminPassword:password,apiKey,apiSecret,wsUrl:`ws://${ip}:7880`,desktopWsUrl:'ws://127.0.0.1:7880',livekitHttpUrl:'http://127.0.0.1:7880'});
   const response=await fetch('http://127.0.0.1:3100/api/admin/rooms',{headers:{Authorization:`Bearer ${password}`}});
   assert.equal(response.status,200);
   await new Promise(resolve=>api.close(resolve));api=null;
   await server.stop();
   assert.equal((await managedProcess(server.executable,dir)).running,false);
   await assertMediaPortsAvailable();
  }
  // Recovery must find only the exact bundled executable using this temporary profile.
  await server.start(config);
  assert.equal((await managedProcess(server.executable,dir,{terminate:true})).recovered,true);
  await server.stop();
  await assertMediaPortsAvailable();
  console.log('Native LiveKit and embedded API: start/stop/restart PASS (no Docker)');
 }finally{
  if(api)await new Promise(resolve=>api.close(resolve));
  await server.stop();fs.rmSync(dir,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
