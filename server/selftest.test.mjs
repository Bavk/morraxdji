import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {createApiServer} from './server.mjs';

test('Windows-local test publisher is authenticated, short-lived, screen-only and requires room', async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'usc-video-check-'));
 let server;
 try{
  const adminPassword='admin-secret-for-local-only-test-abcdef';
  server=await createApiServer({host:'127.0.0.1',port:0,dataPath:path.join(dir,'rooms.json'),adminPassword,
    apiKey:'usc-v08-test',apiSecret:'test-secret-123456789012345678901234',
    wsUrl:'ws://10.77.0.1:7880',desktopWsUrl:'ws://127.0.0.1:7880'});
  const base=`http://127.0.0.1:${server.address().port}`;
  const req=async(route,method='POST',body={},secret=adminPassword)=>{
   const res=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(secret?{authorization:`Bearer ${secret}`}:{})},...(method==='GET'?{}:{body:JSON.stringify(body)})});
   return {status:res.status,body:await res.json()};
  };
  const room=(await req('/api/admin/rooms','POST',{name:'Видео-проверка'})).body.room;
  const route=`/api/admin/rooms/${room.id}/selftest`;
  assert.equal((await req(route,'POST',{},'')).status,401);
  assert.equal((await req('/api/admin/rooms/room_00000000000000000000/selftest')).status,404);
  const response=await req(route);
  assert.equal(response.status,200);
  assert.equal(response.body.wsUrl,'ws://127.0.0.1:7880');
  assert.match(response.body.identity,/^selftest_[a-f0-9]{20}$/);
  const [h,p,sig]=response.body.token.split('.');
  const payload=JSON.parse(Buffer.from(p,'base64url'));
  assert.equal(payload.sub,response.body.identity);
  assert.equal(payload.video.room,room.id);
  assert.equal(payload.video.canPublish,true);
  assert.equal(payload.video.canSubscribe,false);
  assert.deepEqual(payload.video.canPublishSources,['screen_share']);
  assert.equal(payload.exp-payload.iat,90);
  assert.equal(sig,crypto.createHmac('sha256','test-secret-123456789012345678901234').update(`${h}.${p}`).digest('base64url'));
  assert.equal((await req(route,'GET')).status,405);
  const rooms=await fetch(base+'/api/admin/rooms',{headers:{authorization:`Bearer ${adminPassword}`}}).then(r=>r.json());
  assert.equal(rooms.rooms[0].keys.length,0);
 }finally{if(server)await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
