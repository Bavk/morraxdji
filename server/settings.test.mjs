import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createApiServer} from './server.mjs';import {operatorActive} from './settings.mjs';
async function fixture(run){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'usc-settings-')),dataPath=path.join(dir,'rooms.json'),password='settings-test-admin-secret',participants=new Map(),kicks=[];let fail=false;
 const config={host:'127.0.0.1',port:0,dataPath,adminPassword:password,apiKey:'settings-test',apiSecret:'settings-api-secret-long-enough',wsUrl:'ws://127.0.0.1:7880',revocationReconcile:false,livekitControl:{listParticipants:async id=>participants.get(id)||[],removeParticipant:async(id,identity)=>{kicks.push({id,identity});if(fail)throw Error('media offline');participants.set(id,(participants.get(id)||[]).filter(p=>p.identity!==identity));},deleteRoom:async()=>{}}};
 let server=await createApiServer(config);
 const call=async(method,url,body,admin=true)=>{const r=await fetch('http://127.0.0.1:'+server.address().port+url,{method,headers:{'Content-Type':'application/json',...(admin?{Authorization:'Bearer '+password}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 try{const a=(await call('POST','/api/admin/rooms',{name:'Alpha'})).data.room,b=(await call('POST','/api/admin/rooms',{name:'Bravo'})).data.room,operator=(await call('POST',`/api/admin/rooms/${a.id}/keys`,{name:'RC'})).data;
  await run({a,b,operator,call,participants,kicks,dataPath,setFail:value=>fail=value,restart:async()=>{await new Promise(r=>server.close(r));server=await createApiServer(config);}});
 }finally{await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});}
}
const op=id=>`/api/admin/operators/${id}/settings`,room=id=>`/api/admin/rooms/${id}/settings`,grant=id=>`/api/admin/operators/${id}/rooms`;
test('temporary suspension persists, blocks admission and retries disconnection without revoking key',()=>fixture(async({a,b,operator,call,participants,setFail,restart})=>{
 const id=operator.operator.id,identity='operator_'+id;await call('PATCH',grant(id),{roomIds:[a.id,b.id]});for(const r of [a,b])participants.set(r.id,[{identity}]);setFail(true);
 const result=await call('PATCH',op(id),{settings:{enabled:false,team:'Team',device:'DJI',notes:'private memo'}});assert.equal(result.status,200);assert.equal(result.data.mediaDisconnected,false);
 assert.equal((await call('POST','/api/operator/session',{key:operator.key},false)).status,403);await restart();assert.equal((await call('POST','/api/operator/rooms',{key:operator.key},false)).status,403);
 setFail(false);await call('POST','/api/admin/reconcile-revoked',{});for(const r of [a,b])assert.equal(participants.get(r.id).length,0);
 await call('PATCH',op(id),{settings:{enabled:true}});assert.equal((await call('POST','/api/operator/session',{key:operator.key},false)).status,200);
}));
test('failed settings persistence rolls back memory before disconnecting anyone',()=>fixture(async({a,operator,call,dataPath,kicks})=>{
 const contents=await fs.readFile(dataPath);await fs.unlink(dataPath);await fs.mkdir(dataPath);
 try{const result=await call('PATCH',op(operator.operator.id),{name:'Should not save',settings:{enabled:false}});assert.equal(result.status,500);const current=(await call('GET','/api/admin/rooms')).data.rooms.find(r=>r.id===a.id).keys[0];assert.equal(current.name,'RC');assert.equal(current.settings.enabled,true);assert.equal(kicks.length,0);}
 finally{await fs.rmdir(dataPath);await fs.writeFile(dataPath,contents);}
}));
test('expiry restricts JWT lifetime, expired credentials are denied and clock policy is inclusive at expiry',()=>fixture(async({operator,call})=>{
 const id=operator.operator.id,expiry=Date.now()+60000;await call('PATCH',op(id),{settings:{expiresAt:expiry}});
 const issued=(await call('POST','/api/operator/session',{key:operator.key},false)).data;const jwt=JSON.parse(Buffer.from(issued.token.split('.')[1],'base64url'));assert.ok(jwt.exp<=Math.floor(expiry/1000));assert.ok(jwt.exp-jwt.iat<=60);
 await call('PATCH',op(id),{settings:{expiresAt:Date.now()-1000}});assert.equal((await call('POST','/api/operator/session',{key:operator.key},false)).status,403);
 assert.equal(operatorActive({settings:{expiresAt:100}},99),true);assert.equal(operatorActive({settings:{expiresAt:100}},100),false);
}));
test('room closure removes it from admission, kicks existing publishers and preserves viewer access and reopening',()=>fixture(async({a,b,operator,call,participants,restart})=>{
 const id=operator.operator.id;await call('PATCH',grant(id),{roomIds:[a.id,b.id]});participants.set(a.id,[{identity:'operator_'+id}]);
 assert.equal((await call('PATCH',room(a.id),{settings:{open:false}})).status,200);assert.equal(participants.get(a.id).length,0);
 assert.deepEqual((await call('POST','/api/operator/rooms',{key:operator.key},false)).data.rooms,[{id:b.id,name:'Bravo'}]);assert.equal((await call('POST','/api/operator/session',{key:operator.key,roomId:a.id},false)).status,403);
 assert.equal((await call('POST',`/api/admin/rooms/${a.id}/viewer`,{})).status,200);await restart();assert.equal((await call('GET','/api/admin/rooms')).data.rooms[0].settings.open,false);
 await call('PATCH',room(a.id),{settings:{open:true}});assert.equal((await call('POST','/api/operator/session',{key:operator.key,roomId:a.id},false)).status,200);
}));
test('room assignment limit includes cross-room and suspended keys, rejects lowering and frees revoked slots',()=>fixture(async({a,b,operator,call})=>{
 const first=operator.operator.id,second=(await call('POST',`/api/admin/rooms/${a.id}/keys`,{name:'Second'})).data.operator.id;
 await call('PATCH',room(b.id),{settings:{maxOperators:1}});assert.equal((await call('PATCH',grant(first),{roomIds:[a.id,b.id]})).status,200);
 await call('PATCH',op(first),{settings:{enabled:false}});assert.equal((await call('PATCH',grant(second),{roomIds:[a.id,b.id]})).status,409);
 assert.equal((await call('POST',`/api/admin/rooms/${b.id}/keys`,{name:'Third'})).status,409);
 assert.equal((await call('PATCH',room(a.id),{settings:{maxOperators:1},name:'Changed'})).status,409);assert.equal((await call('GET','/api/admin/rooms')).data.rooms[0].name,'Alpha');
 await call('DELETE',`/api/admin/rooms/${a.id}/keys/${first}`);assert.equal((await call('PATCH',grant(second),{roomIds:[a.id,b.id]})).status,200);
}));
test('quality inheritance and preferred room respect access; removing a grant clears preferred room',()=>fixture(async({a,b,operator,call})=>{
 const id=operator.operator.id;await call('PATCH',room(a.id),{settings:{profile:'standard'}});
 assert.equal((await call('POST','/api/operator/session',{key:operator.key},false)).data.streamProfile,'standard');
 assert.equal((await call('PATCH',op(id),{settings:{preferredRoomId:b.id}})).status,400);
 await call('PATCH',grant(id),{roomIds:[a.id,b.id]});await call('PATCH',op(id),{settings:{profile:'economy',preferredRoomId:b.id}});
 assert.equal((await call('POST','/api/operator/rooms',{key:operator.key},false)).data.rooms[0].id,b.id);
 const issued=(await call('POST','/api/operator/session',{key:operator.key},false)).data;assert.equal(issued.roomId,b.id);assert.equal(issued.streamProfile,'economy');
 await call('PATCH',grant(id),{roomIds:[a.id]});const saved=(await call('GET','/api/admin/rooms')).data.rooms[0].keys[0];assert.equal(saved.settings.preferredRoomId,null);
 await call('PATCH',grant(id),{roomIds:[a.id,b.id]});await call('PATCH',op(id),{settings:{preferredRoomId:b.id}});await call('DELETE','/api/admin/rooms/'+b.id);
 const repaired=await call('PATCH',op(id),{settings:{team:'Updated after room deletion'}});assert.equal(repaired.status,200);assert.equal(repaired.data.operator.settings.preferredRoomId,null);
}));
test('metadata survives reload without leaking private notes or allowing malformed/unauthenticated patches',()=>fixture(async({a,operator,call,restart,dataPath})=>{
 const id=operator.operator.id;await call('PATCH',op(id),{name:'Renamed',settings:{team:'FPV',device:'RC Plus',notes:'internal private memo'}});
 await call('PATCH',room(a.id),{settings:{description:'Desk',group:'Group',color:'purple',sortOrder:4}});await restart();
 const saved=(await call('GET','/api/admin/rooms')).data.rooms[0];assert.equal(saved.settings.color,'purple');assert.equal(saved.keys[0].settings.device,'RC Plus');
 for(const route of ['/api/operator/rooms','/api/operator/session'])assert.ok(!JSON.stringify((await call('POST',route,{key:operator.key},false)).data).includes('internal private memo'));
 for(const settings of [{enabled:'false'},{expiresAt:'tomorrow'},{notes:'x'.repeat(1001)},{profile:'4k'},{injected:true}])assert.equal((await call('PATCH',op(id),{settings,name:'Invalid mutation'})).status,400);
 assert.equal((await call('PATCH',op(id),{settings:{enabled:false}},false)).status,401);
 assert.equal((await call('GET','/api/admin/rooms')).data.rooms[0].keys[0].name,'Renamed');assert.ok(!(await fs.readFile(dataPath,'utf8')).includes(operator.key));
}));
