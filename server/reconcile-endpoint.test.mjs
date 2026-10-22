import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApiServer} from './server.mjs';

test('admin-only reconciliation endpoint retries revocation on LiveKit recovery',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'usc-reconcile-'));
 const adminPassword='admin-password-long-enough-for-testing';
 let available=false,live=[],kicked=[];let server;
 try{
  const media={listParticipants:async()=>{if(!available)throw Error('LiveKit offline');return live;},
   removeParticipant:async(r,id)=>{if(!available)throw Error('LiveKit offline');kicked.push(id);live=live.filter(p=>p.identity!==id);},
   deleteRoom:async()=>{}};
  server=await createApiServer({host:'127.0.0.1',port:0,dataPath:path.join(dir,'rooms.json'),
   adminPassword,apiKey:'testkey',apiSecret:'long-secret-secret-secret-secret',
   wsUrl:'ws://10.77.0.1:7880',livekitControl:media,revocationReconcile:false});
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=async(method,url,body,auth=true)=>{
    const res=await fetch(base+url,{method,headers:{'content-type':'application/json',
     ...(auth?{authorization:'Bearer '+adminPassword}:{})},
     ...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:res.status,data:await res.json()};
  };
  const room=(await request('POST','/api/admin/rooms',{name:'Crew'})).data.room;
  const op=(await request('POST',`/api/admin/rooms/${room.id}/keys`,{name:'Operator'})).data;
  live=[{identity:`operator_${op.operator.id}`}];
  const revoked=await request('DELETE',`/api/admin/rooms/${room.id}/keys/${op.operator.id}`);
  assert.equal(revoked.data.mediaDisconnected,false);
  assert.equal((await request('POST','/api/admin/reconcile-revoked',{},false)).status,401);
  const failed=await request('POST','/api/admin/reconcile-revoked',{});
  assert.equal(failed.status,200);assert.equal(failed.data.failures.length,1);
  available=true;
  const fixed=await request('POST','/api/admin/reconcile-revoked',{});
  assert.equal(fixed.status,200);assert.equal(fixed.data.participantsRemoved,1);
  assert.deepEqual(kicked,[`operator_${op.operator.id}`]);
  assert.equal((await request('POST','/api/operator/session',{key:op.key},false)).status,401);
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  rmSync(dir,{recursive:true,force:true});
 }
});
