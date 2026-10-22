import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApiServer} from './server.mjs';

test('presence and revocation immediately disconnect active streaming operators',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'usc-moderation-'));
  const calls=[];let server;
  const adminPassword='long-test-admin-password-for-unit-testing';
  let connected=[];
  const livekitControl={
    listParticipants:async(room)=>connected,
    removeParticipant:async(room,identity)=>{calls.push(['kick',room,identity]);connected=connected.filter(p=>p.identity!==identity);},
    deleteRoom:async(room)=>{calls.push(['delete',room]);connected=[];}
  };
  try{
    server=await createApiServer({host:'127.0.0.1',port:0,dataPath:path.join(dir,'db.json'),
      adminPassword,apiKey:'testkey',apiSecret:'very-long-livekit-secret-unit-testing-only',
      wsUrl:'ws://10.77.0.1:7880',desktopWsUrl:'ws://127.0.0.1:7880',livekitControl});
    const root=`http://127.0.0.1:${server.address().port}`;
    const call=async(method,url,body,auth=true)=>{
      const r=await fetch(root+url,{method,headers:{'Content-Type':'application/json',...(auth?{Authorization:`Bearer ${adminPassword}`}:{})},
        ...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};
    };
    const room=(await call('POST','/api/admin/rooms',{name:'Operators'})).data.room;
    const k=(await call('POST',`/api/admin/rooms/${room.id}/keys`,{name:'Mobile 1'})).data;
    const id=k.operator.id;
    connected=[{identity:`operator_${id}`,joinedAt:1780000000,tracks:[{source:'SCREEN_SHARE',muted:false}]}];
    const status=await call('GET',`/api/admin/rooms/${room.id}/presence`);
    assert.equal(status.status,200);assert.equal(status.data.operators[0].online,true);
    assert.equal(status.data.operators[0].streaming,true);
    assert.equal((await call('GET',`/api/admin/rooms/${room.id}/presence`,null,false)).status,401);
    const removed=await call('DELETE',`/api/admin/rooms/${room.id}/keys/${id}`);
    assert.equal(removed.status,200);
    assert.deepEqual(calls[0],['kick',room.id,`operator_${id}`]);
    assert.equal((await call('POST','/api/operator/session',{key:k.key},false)).status,401);
    const after=await call('GET',`/api/admin/rooms/${room.id}/presence`);
    assert.equal(after.data.operators[0].online,false);
    await call('DELETE',`/api/admin/rooms/${room.id}`);
    assert.deepEqual(calls[1],['delete',room.id]);
    assert.equal((await call('GET',`/api/admin/rooms/${room.id}/presence`)).status,404);
  }finally{if(server)await new Promise(resolve=>server.close(resolve));rmSync(dir,{force:true,recursive:true});}
});

test('revoked key remains blocked even if LiveKit disconnect command fails',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'usc-kick-failure-'));
 let server;
 const adminPassword='long-test-admin-password-for-unit-testing';
 try{
  server=await createApiServer({host:'127.0.0.1',port:0,dataPath:path.join(dir,'db.json'),
   adminPassword,apiKey:'testkey',apiSecret:'very-long-livekit-secret-unit-testing-only',
   wsUrl:'ws://10.77.0.1:7880',livekitControl:{
    listParticipants:async()=>[],removeParticipant:async()=>{throw Error('LiveKit offline');},deleteRoom:async()=>{}
   }});
  const root=`http://127.0.0.1:${server.address().port}`;
  const call=async(method,url,body,admin=false)=>{
   const result=await fetch(root+url,{method,headers:{'Content-Type':'application/json',
    ...(admin?{Authorization:`Bearer ${adminPassword}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
   return {status:result.status,data:await result.json()};
  };
  const r=await call('POST','/api/admin/rooms',{name:'Team'},true);
  const k=await call('POST',`/api/admin/rooms/${r.data.room.id}/keys`,{name:'Pilot'},true);
  const result=await call('DELETE',`/api/admin/rooms/${r.data.room.id}/keys/${k.data.operator.id}`,null,true);
  assert.equal(result.status,200);
  assert.equal(result.data.mediaDisconnected,false);
  assert.ok(result.data.warning);
  assert.equal((await call('POST','/api/operator/session',{key:k.data.key})).status,401);
  const after=await call('GET','/api/admin/rooms',null,true);
  assert.equal(after.data.rooms[0].keys[0].revoked,true);
 }finally{if(server)await new Promise(resolve=>server.close(resolve));rmSync(dir,{force:true,recursive:true});}
});
