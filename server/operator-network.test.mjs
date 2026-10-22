import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {isProvisionedVpnAddress,vpnPeerMatchesOperator} from './operator-network.mjs';
import {createApiServer} from './server.mjs';

test('allow provisioned WireGuard addresses only, reject spoofed/unrelated IPs',()=>{
 for(const address of ['10.77.0.100','10.77.0.240','::ffff:10.77.0.101']) assert.equal(isProvisionedVpnAddress(address),true,address);
 for(const address of ['127.0.0.1','::1','10.77.0.1','10.77.0.254','10.77.0.99','10.77.0.241',
   '10.77.1.100','10.77.0.100.bad','10.77.0.0100','::ffff:10.77.0.0','192.168.1.8',null])
   assert.equal(isProvisionedVpnAddress(address),false,String(address));
});
test('VPN mode denies operator authorization over loopback/LAN but keeps local admin usable',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'usc-vpn-access-'));let server;
 try{
  const secret='test-admin-password-1234567890123';
  server=await createApiServer({host:'127.0.0.1',port:0,dataPath:path.join(dir,'rooms.json'),
   adminPassword:secret,apiKey:'testkey',apiSecret:'test-secret-12345678901234567',
   wsUrl:'ws://10.77.0.1:7880',operatorAccess:'vpn-only',operatorVpnAddressForId:()=>null});
  const base=`http://127.0.0.1:${server.address().port}`;
  const response=await fetch(base+'/api/operator/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:'bad'})});
  assert.equal(response.status,403);
  const admin=await fetch(base+'/api/admin/rooms',{headers:{Authorization:`Bearer ${secret}`}});
  assert.equal(admin.status,200);
 }finally{if(server)await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});

test('operator invite belongs only to its provisioned WireGuard IP',()=>{
 const a='key_'+'a'.repeat(20),b='key_'+'b'.repeat(20);
 const peers={[a]:'10.77.0.100',[b]:'10.77.0.101'};
 const lookup=id=>peers[id];
 assert.equal(vpnPeerMatchesOperator('10.77.0.100',a,lookup),true);
 assert.equal(vpnPeerMatchesOperator('::ffff:10.77.0.100',a,lookup),true);
 assert.equal(vpnPeerMatchesOperator('10.77.0.101',a,lookup),false);
 assert.equal(vpnPeerMatchesOperator('10.77.0.100',b,lookup),false);
 assert.equal(vpnPeerMatchesOperator('127.0.0.1',a,lookup),false);
 assert.equal(vpnPeerMatchesOperator('10.77.0.100',a,()=>null),false);
 assert.equal(vpnPeerMatchesOperator('10.77.0.100',a,()=>{throw Error('corrupt DB')}),false);
 assert.equal(vpnPeerMatchesOperator('10.77.0.100','invalid',lookup),false);
});
test('VPN mode refuses to start without a trusted per-operator peer mapping',async()=>{
 await assert.rejects(createApiServer({host:'127.0.0.1',port:0,
   adminPassword:'test-admin-password-1234567890123',apiKey:'testkey',
   apiSecret:'test-secret-12345678901234567',wsUrl:'ws://10.77.0.1:7880',
   operatorAccess:'vpn-only'}),/requires operatorVpnAddressForId/);
});
