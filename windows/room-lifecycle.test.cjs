'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {cleanupStalePeers,deleteRoomThenCleanup}=require('./room-lifecycle.cjs');
const ID='room_'+'1'.repeat(20);

test('deleting a room ALWAYS removes Windows room even when VPN relay is offline',async()=>{
  const calls=[];
  const api=async(method,url)=>{
    calls.push(`${method} ${url}`);
    if(method==='DELETE')return {ok:true,mediaDisconnected:false,warning:'LiveKit недоступен'};
    if(method==='GET')return {rooms:[]};
    throw Error('unexpected API call');
  };
  const vpn={status:()=>({configured:true}),peerIds:()=>['key_'+ 'a'.repeat(20)],cleanupRevoked:async()=>{throw Error('VPS offline');}};
  const result=await deleteRoomThenCleanup({id:ID,api,vpn});
  assert.equal(result.ok,true);
  assert.equal(result.vpnRemovalPending,true);
  assert.match(result.warning,/Комната удалена/);
  assert.match(result.warning,/LiveKit недоступен/);
  assert.equal(calls[0],`DELETE /api/admin/rooms/${ID}`);
  assert.equal(calls[1],'GET /api/admin/rooms');
});

test('deleting a room is local-first even when VPN credentials cannot decrypt',async()=>{
  let removed=false;
  const api=async(method)=>{
    if(method==='DELETE'){removed=true;return {ok:true};}
    throw Error('unexpected API call');
  };
  const vpn={status:()=>{throw Error('DPAPI not available');}};
  const result=await deleteRoomThenCleanup({id:ID,api,vpn});
  assert.equal(removed,true);
  assert.equal(result.vpnRemovalPending,true);
  assert.match(result.warning,/проверка VPN пока недоступна/);
});

test('stale peers cleanup ignores active peers and retries peers from deleted rooms',async()=>{
  const active='key_'+'1'.repeat(20),revoked='key_'+'2'.repeat(20),deleted='key_'+'3'.repeat(20);
  let removed=[];
  const api=async()=>({rooms:[{keys:[{id:active,revoked:false},{id:revoked,revoked:true}]}]});
  const vpn={status:()=>({configured:true}),peerIds:()=>[active,revoked,deleted],cleanupRevoked:async ids=>{removed=ids;return{removed:ids.length,failed:[],remaining:0};}};
  const outcome=await cleanupStalePeers({api,vpn});
  assert.deepEqual(removed,[revoked,deleted]);
  assert.equal(outcome.removed,2);
});

test('deleting a room completes even when only SOME VPN peers fail deletion',async()=>{
  const api=async method=>method==='DELETE'?{ok:true}:{rooms:[]};
  const vpn={status:()=>({configured:true}),peerIds:()=>['key_'+ '4'.repeat(20)],cleanupRevoked:async()=>({removed:0,failed:[{id:'key_'+ '4'.repeat(20)}],remaining:1})};
  const result=await deleteRoomThenCleanup({id:ID,api,vpn});
  assert.equal(result.ok,true);
  assert.equal(result.vpnRemovalPending,true);
  assert.match(result.warning,/1 VPN-подключений/);
});

test('deleting a room without VPN does not require the relay',async()=>{
  const calls=[];
  const api=async(method,url)=>{calls.push([method,url]);return{ok:true};};
  const vpn={status:()=>({configured:false}),peerIds:()=>[]};
  const outcome=await deleteRoomThenCleanup({id:ID,api,vpn});
  assert.equal(outcome.vpnRemovalPending,false);
  assert.equal(calls[0][0],'DELETE');
  assert.equal(calls.length,1);
});

test('invalid room list never silently counts as successful cleanup',async()=>{
  const vpn={status:()=>({configured:true}),peerIds:()=>['key_'+ '5'.repeat(20)]};
  await assert.rejects(cleanupStalePeers({vpn,api:async()=>({})}),/список комнат/);
});

test('missing VPN settings with orphaned local peers reports incomplete deletion',async()=>{
  const api=async method=>method==='DELETE'?{ok:true}:{rooms:[]};
  const vpn={status:()=>({configured:false}),peerIds:()=>['key_'+'f'.repeat(20)]};
  const result=await deleteRoomThenCleanup({id:ID,api,vpn});
  assert.equal(result.ok,true);
  assert.equal(result.vpnRemovalPending,true);
  assert.match(result.warning,/настройки VPN отсутствуют/);
});
