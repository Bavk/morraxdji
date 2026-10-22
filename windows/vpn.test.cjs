const {test}=require('node:test');
const assert=require('node:assert/strict');
const {wireguardKeys,makeConfig,makeInvite,allocIP}=require('./vpn.cjs');
test('WireGuard x25519 keypair and operator enrollment code',()=>{
 const a=wireguardKeys(),b=wireguardKeys();
 assert.equal(Buffer.from(a.privateKey,'base64').length,32);
 assert.equal(Buffer.from(a.publicKey,'base64').length,32);
 const config=makeConfig({privateKey:a.privateKey,address:'10.77.0.1',relayKey:b.publicKey,endpoint:'vpn.example.com:51820',windows:true});
 assert.match(config,/AllowedIPs = 10\.77\.0\.0\/24/);
 assert.match(config,/MTU = 1280/);
 const code=makeInvite({operatorKey:'STRM_'+ 'a'.repeat(32),privateKey:a.privateKey,address:'10.77.0.100',relayKey:b.publicKey,endpoint:'vpn.example.com:51820'});
 const parsed=JSON.parse(Buffer.from(code.split('.')[1],'base64url').toString());
 assert.equal(parsed.v,1);assert.equal(parsed.key,'STRM_'+ 'a'.repeat(32));
 assert.equal(parsed.ip,'10.77.0.100');
 assert.equal(parsed.privateKey,a.privateKey);
 assert.equal(allocIP({'key1':{ip:'10.77.0.100'}}),'10.77.0.101');
});
test('Reject malformed key and endpoint',()=>{
 const a=wireguardKeys(),b=wireguardKeys();
 assert.throws(()=>makeConfig({privateKey:a.privateKey,address:'8.8.8.8',relayKey:b.publicKey,endpoint:'vpn.example.com:51820'}));
 assert.throws(()=>makeConfig({privateKey:a.privateKey,address:'10.77.0.101',relayKey:b.publicKey,endpoint:'127.0.0.1:0'}));
});
