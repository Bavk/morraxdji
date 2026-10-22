'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const {NativeLiveKit,binaryPath}=require('./native-livekit.cjs');
test('native server stops only its child, supports restart, and distinguishes crashes',async()=>{
 let crashes=0;
 const server=new NativeLiveKit(process.execPath,{onExit:()=>crashes++,launch:()=>spawn(process.execPath,['-e','setInterval(()=>{},1000)'])});
 try{
  await server.start(__filename);
  await assert.rejects(server.start(__filename),/уже запущен/);
  await server.stop();assert.equal(crashes,0);assert.equal(server.child,null);
  await server.start(__filename);
  const child=server.child,exited=once(child,'exit');child.kill();await exited;
  assert.equal(crashes,1);assert.equal(server.child,null);
 }finally{await server.stop();}
});
test('missing native binary gives an actionable error without starting a process',async()=>{
 const server=new NativeLiveKit(__filename+'.missing');
 await assert.rejects(server.start(__filename),/Переустановите/);
 assert.equal(server.child,null);
});
test('packaged binary is outside app.asar in resources',()=>{
 assert.equal(binaryPath({packaged:true,resourcesPath:'resources'}),require('node:path').join('resources','livekit','livekit-server.exe'));
});
