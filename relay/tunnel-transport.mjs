import crypto from 'node:crypto';
import dgram from 'node:dgram';
import {WebSocketServer,WebSocket} from 'ws';

// Each authenticated operator gets a UDP socket to this host's WireGuard only.
// WireGuard still authenticates/decrypts every packet; TLS carries its datagrams.
export function attachTunnelTransport(server,{getPeer,port=51820}) {
 const wss=new WebSocketServer({noServer:true,maxPayload:2048,perMessageDeflate:false});
 const active=new Map();
 const deny=socket=>{socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');};
 server.on('upgrade',(req,socket,head)=>{
  const match=req.url?.match(/^\/v1\/tunnel\/(key_[a-f0-9]{20})$/);
  const id=match?.[1],peer=id&&getPeer(id),token=req.headers.authorization?.replace(/^Bearer /,'');
  const hash=typeof token==='string'&&token.length===43?crypto.createHash('sha256').update(token).digest('hex'):'';
  if(!peer?.transportHash||hash.length!==peer.transportHash.length||!crypto.timingSafeEqual(Buffer.from(hash),Buffer.from(peer.transportHash)))return deny(socket);
  wss.handleUpgrade(req,socket,head,ws=>{
   active.get(id)?.close(1000,'Replaced');active.set(id,ws);
   const udp=dgram.createSocket('udp4');let ready=false,alive=true;
   const close=()=>{clearInterval(timer);if(active.get(id)===ws)active.delete(id);try{udp.close();}catch{}};
   const timer=setInterval(()=>{if(!alive)return ws.terminate();alive=false;ws.ping();},25000);timer.unref();
   ws.on('pong',()=>{alive=true;});ws.on('close',close);ws.on('error',()=>ws.terminate());
   udp.on('error',()=>ws.close(1011,'UDP transport error'));
   udp.on('message',data=>{if(ws.readyState===WebSocket.OPEN){if(ws.bufferedAmount>1024*1024)return ws.close(1013,'Slow transport');ws.send(data);}});
   udp.connect(port,'127.0.0.1',()=>{ready=true;ws.send('ready');});
   ws.on('message',(data,binary)=>{if(!binary||!ready||data.length<32||data.length>2048)return ws.close(1008,'Invalid datagram');udp.send(data);});
  });
 });
 server.on('close',()=>{for(const ws of active.values())ws.terminate();wss.close();});
 return {revoke:id=>active.get(id)?.close(1008,'Peer revoked')};
}
