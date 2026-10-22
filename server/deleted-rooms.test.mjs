import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApiServer} from './server.mjs';

test('room deletion revokes access immediately and persists LiveKit cleanup across Windows restart',async()=>{
  const folder=mkdtempSync(path.join(tmpdir(),'usc-deleted-room-'));
  const file=path.join(folder,'rooms.json');
  const adminPassword='this-is-a-secret-with-more-than-twenty';
  let offline=true,server,deleted=[];
  const media={
    deleteRoom:async id=>{if(offline)throw Error('Simulated LiveKit outage');deleted.push(id);},
    listParticipants:async()=>[],removeParticipant:async()=>{}
  };
  const options={host:'127.0.0.1',port:0,dataPath:file,adminPassword,apiKey:'testkey',
    apiSecret:'long-test-secret-for-media-server',wsUrl:'ws://10.77.0.1:7880',
    livekitControl:media,revocationReconcile:false};
  async function request(method,endpoint,data,auth=true){
    const response=await fetch(`http://127.0.0.1:${server.address().port}${endpoint}`,{
      method,headers:{'content-type':'application/json',...(auth?{authorization:`Bearer ${adminPassword}`}:{})},
      ...(data===undefined?{}:{body:JSON.stringify(data)})});
    return {status:response.status,result:await response.json()};
  }
  try{
    server=await createApiServer(options);
    const {result:{room}}=await request('POST','/api/admin/rooms',{name:'Alpha'});
    const {result:{key}}=await request('POST',`/api/admin/rooms/${room.id}/keys`,{name:'Operator'});
    const deletedResponse=await request('DELETE',`/api/admin/rooms/${room.id}`);
    assert.equal(deletedResponse.status,200);
    assert.equal(deletedResponse.result.mediaDisconnected,false);
    assert.ok(deletedResponse.result.warning);
    assert.equal((await request('POST','/api/operator/session',{key},false)).status,401);
    let saved=JSON.parse(readFileSync(file,'utf8'));
    assert.deepEqual(saved.rooms,[]);
    assert.equal(saved.pendingRoomDeletes.length,1);
    assert.equal(saved.pendingRoomDeletes[0].id,room.id);
    assert.ok(saved.pendingRoomDeletes[0].expireAt>Date.now());
    await new Promise(resolve=>server.close(resolve));server=null;
    // Retry remains possible after re-launching the embedded Windows API.
    server=await createApiServer(options);
    assert.deepEqual((await request('GET','/api/admin/rooms')).result.rooms,[]);
    assert.equal((await request('POST','/api/admin/reconcile-revoked',{})).result.pendingRoomFailures.length,1);
    offline=false;
    const protectedRoom=await request('POST','/api/admin/reconcile-revoked',{});
    assert.equal(protectedRoom.result.pendingRoomsEnforced,1);
    assert.equal(protectedRoom.result.pendingRoomsRemoved,0);
    // Advance the persisted protection deadline and simulate another Windows restart.
    await new Promise(resolve=>server.close(resolve));server=null;
    saved=JSON.parse(readFileSync(file,'utf8'));
    saved.pendingRoomDeletes[0].expireAt=Date.now()-1;
    writeFileSync(file,JSON.stringify(saved));
    server=await createApiServer(options);
    const cleaned=await request('POST','/api/admin/reconcile-revoked',{});
    assert.equal(cleaned.result.pendingRoomsRemoved,1);
    assert.deepEqual(deleted,[room.id,room.id]);
    saved=JSON.parse(readFileSync(file,'utf8'));
    assert.deepEqual(saved.pendingRoomDeletes,[]);
    assert.equal((await request('POST','/api/admin/reconcile-revoked',{})).result.pendingRoomsRemoved,0);
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    rmSync(folder,{force:true,recursive:true});
  }
});

test('legacy v0.11 rooms data upgrades without resetting keys',async()=>{
  const folder=mkdtempSync(path.join(tmpdir(),'usc-old-db-'));
  const file=path.join(folder,'rooms.json');
  const room={id:'room_'+'f'.repeat(20),name:'Existing',keys:[{id:'key_'+'c'.repeat(20),
    name:'Active',hash:'abc',revoked:false}]};
  writeFileSync(file,JSON.stringify({rooms:[room]}));
  let server;
  try{
    server=await createApiServer({host:'127.0.0.1',port:0,dataPath:file,
      adminPassword:'a-long-test-admin-secret-123',apiKey:'testkey',
      apiSecret:'long-test-secret-for-media-server',wsUrl:'ws://127.0.0.1:7880',revocationReconcile:false});
    const res=await fetch(`http://127.0.0.1:${server.address().port}/api/admin/rooms`,
      {headers:{authorization:'Bearer a-long-test-admin-secret-123'}});
    assert.equal((await res.json()).rooms[0].keys[0].id,room.keys[0].id);
  }finally{if(server)await new Promise(resolve=>server.close(resolve));rmSync(folder,{force:true,recursive:true});}
});
