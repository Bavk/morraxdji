'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const net=require('node:net');
const dgram=require('node:dgram');
const {checkPort,checkMediaPorts}=require('./preflight.cjs');
test('preflight verifies free TCP and UDP ports',async()=>{
 const tcp=await checkPort({port:0,protocol:'tcp',purpose:'test'});
 const udp=await checkPort({port:0,protocol:'udp',purpose:'test'});
 assert.equal(tcp.available,true);assert.equal(udp.available,true);
});
test('preflight catches a TCP port conflict',async()=>{
 const server=net.createServer();await new Promise(resolve=>server.listen(0,'0.0.0.0',resolve));
 try{
  const result=await checkPort({port:server.address().port,protocol:'tcp',purpose:'occupied'});
  assert.equal(result.available,false);assert.equal(result.reason,'EADDRINUSE');
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('preflight catches a UDP port conflict',async()=>{
 const socket=dgram.createSocket('udp4');await new Promise(resolve=>socket.bind(0,'0.0.0.0',resolve));
 try{
  const result=await checkPort({port:socket.address().port,protocol:'udp',purpose:'occupied'});
  assert.equal(result.available,false);assert.equal(result.reason,'EADDRINUSE');
 }finally{socket.close();}
});
