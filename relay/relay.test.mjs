import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {makeRelayServer} from './relay.mjs';
test('Provision Windows and operator peers + revoke via authenticated API',async()=>{
 const calls=[];const dir=fs.mkdtempSync(path.join(os.tmpdir(),'usc-relay-'));
 const secret='s'.repeat(50);
 const server=await makeRelayServer({dir,secret,port:0,wg:async args=>{calls.push(args);}});
 const base=`http://127.0.0.1:${server.address().port}`;
 const headers={Authorization:`Bearer ${secret}`,'Content-Type':'application/json'};
 const validKey=Buffer.alloc(32,4).toString('base64');
 try {
  let r=await fetch(base+'/v1/peers',{method:'POST',headers,body:JSON.stringify({id:'windows',ip:'10.77.0.1',publicKey:validKey})});assert.equal(r.status,201);
  r=await fetch(base+'/v1/peers',{method:'POST',headers,body:JSON.stringify({id:'key_'+'a'.repeat(20),ip:'10.77.0.100',publicKey:Buffer.alloc(32,5).toString('base64')})});assert.equal(r.status,201);
  r=await fetch(base+'/v1/peers',{method:'POST',headers,body:JSON.stringify({id:'key_'+'b'.repeat(20),ip:'10.77.0.100',publicKey:Buffer.alloc(32,6).toString('base64')})});assert.equal(r.status,409);
  r=await fetch(base+'/v1/peers',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(r.status,401);
  r=await fetch(base+'/v1/peers/key_'+'a'.repeat(20),{method:'DELETE',headers});assert.equal(r.status,200);
  assert.equal(Object.keys(JSON.parse(fs.readFileSync(path.join(dir,'peers.json')))).length,1);
  const stat=await fetch(base+'/v1/status',{headers});assert.equal(stat.status,200);
  assert.deepEqual(await stat.json(),{ok:true,windowsRegistered:true,operatorPeers:0});
  assert.equal(calls.length,3);
 }finally{await new Promise(done=>server.close(done));fs.rmSync(dir,{recursive:true,force:true});}
});
