import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import dgram from 'node:dgram';
import crypto from 'node:crypto';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {attachTunnelTransport} from './tunnel-transport.mjs';

test('TLS upstream transport authenticates, preserves binary UDP packets and disconnects revoked peers',{timeout:10000},async()=>{
 const udp=dgram.createSocket('udp4');udp.bind(0,'127.0.0.1');await once(udp,'listening');
 udp.on('message',(data,peer)=>udp.send(data,peer.port,peer.address));
 const server=http.createServer();const id='key_'+'a'.repeat(20),token='t'.repeat(43);
 const transport=attachTunnelTransport(server,{port:udp.address().port,getPeer:key=>key===id?{transportHash:crypto.createHash('sha256').update(token).digest('hex')}:null});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const url=`ws://127.0.0.1:${server.address().port}/v1/tunnel/${id}`;let ws;
 try{
  const bad=new WebSocket(url,{headers:{Authorization:'Bearer '+'x'.repeat(43)}});
  assert.match((await once(bad,'error'))[0].message,/401/);
  ws=new WebSocket(url,{headers:{Authorization:'Bearer '+token}});
  const ready=once(ws,'message');await once(ws,'open');assert.equal((await ready)[0].toString(),'ready');
  const packet=crypto.randomBytes(1360),echo=once(ws,'message');ws.send(packet);assert.deepEqual((await echo)[0],packet);
  const closed=once(ws,'close');transport.revoke(id);assert.equal((await closed)[0],1008);
 }finally{ws?.terminate();udp.close();await new Promise(r=>server.close(r));}
});
