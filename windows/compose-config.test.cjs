'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {renderCompose,renderLivekitConfig,validateAddress}=require('./compose-config.cjs');
test('LiveKit binds to localhost and only selected VPN IP',()=>{
 const y=renderCompose('10.77.0.1');
 for(const port of [7880,7881,7882]){
  const protocol=port===7882?'udp':'tcp';
  assert.ok(y.includes(`"127.0.0.1:${port}:${port}/${protocol}"`));
  assert.ok(y.includes(`"10.77.0.1:${port}:${port}/${protocol}"`));
 }
 assert.ok(!y.includes('"7880:7880/tcp"'));
 assert.ok(!y.includes('0.0.0.0:'));
 assert.ok(y.includes('name: universalstreamcontrol'));
});
test('bind to selected LAN IP for LAN development mode',()=>{
 const y=renderCompose('192.168.10.55');
 assert.ok(y.includes('192.168.10.55:7882:7882/udp'));
 assert.ok(!y.includes('10.77.0.1:'));
});
test('reject misconfigured or injected network addresses',()=>{
 for(const bad of ['0.0.0.0','127.0.0.1','169.254.1.7','1.2.3.4\nfoo','[::1]','bad.com','10.77.0.1:53'])
  assert.throws(()=>validateAddress(bad));
});
test('LiveKit announces only chosen host address and validates secret',()=>{
 const y=renderLivekitConfig('10.77.0.1','usc'+'a'.repeat(18),'S'.repeat(50));
 assert.match(y,/node_ip: 10\.77\.0\.1/);
 assert.throws(()=>renderLivekitConfig('10.77.0.1','bad','S'.repeat(50)));
});
