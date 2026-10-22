// Small WireGuard peer-provisioning API on a Linux VPS. WireGuard relays packets;
// LiveKit and management API remain on the Windows host.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {attachTunnelTransport} from './tunnel-transport.mjs';
const base=process.env.USC_RELAY_DIR || '/etc/universal-stream-relay';
const interfaceName=process.env.USC_WG_INTERFACE || 'usc0';
const token=process.env.USC_RELAY_TOKEN || '';
if (process.argv[1] && import.meta.url.endsWith(process.argv[1]) && token.length<32) throw Error('Set USC_RELAY_TOKEN (>=32 chars)');
function allowed(id,ip){
 if(id==='windows')return ip==='10.77.0.1';
 return /^key_[a-f0-9]{20}$/.test(id) && /^10\.77\.0\.(1\d\d|2[0-3]\d|240)$/.test(ip);
}
function pub(k){return typeof k==='string'&&/^[A-Za-z0-9+/]{43}=$/.test(k)&&Buffer.from(k,'base64').length===32;}
function secureEqual(a,b){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length && crypto.timingSafeEqual(x,y);}
function runWg(args) {return new Promise((resolve,reject)=>{
 const child=spawn('wg',args,{stdio:['ignore','pipe','pipe'],shell:false});let out='';
 child.stdout.on('data',b=>out+=b.toString());child.stderr.on('data',b=>out+=b.toString());
 child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error(`wg failed: ${out.slice(0,500)}`)));
 });}
async function makeRelayServer({dir=base,wg=runWg,secret=token,host='127.0.0.1',port=8777}={}) {
 if(secret.length<32)throw Error('Missing relay API secret');
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const file=path.join(dir,'peers.json');
 let peers=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
 let busy=Promise.resolve();
 function commit(){const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(peers,null,2),{mode:0o600});fs.renameSync(tmp,file);}
 async function sync(){for(const peer of Object.values(peers))await wg(['set',interfaceName,'peer',peer.publicKey,'allowed-ips',peer.ip+'/32']);}
 let transport;
 function json(res,status,body){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));}
 const server=http.createServer((req,res)=>{
  const work=async()=>{
   try {
    if(!secureEqual((req.headers.authorization||'').replace(/^Bearer /,''),secret))return json(res,401,{error:'Unauthorized'});
    const url=new URL(req.url,'http://localhost');
    if(req.method==='GET'&&url.pathname==='/health')return json(res,200,{ok:true});
    if(req.method==='GET'&&url.pathname==='/v1/status')return json(res,200,{ok:true,windowsRegistered:Boolean(peers.windows),operatorPeers:Object.keys(peers).filter(id=>id!=='windows').length});
    if(req.method==='POST'&&url.pathname==='/v1/peers'){
     let body='';for await(const part of req){body+=part.toString();if(body.length>1200)return json(res,413,{error:'Too large'});}
     let data;try{data=JSON.parse(body);}catch{return json(res,400,{error:'Invalid JSON'});}
     const {id,ip,publicKey,transportToken}=data||{};
     if(!allowed(id,ip)||!pub(publicKey))return json(res,400,{error:'Invalid peer'});
     if(transportToken!==undefined && (id==='windows'||typeof transportToken!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(transportToken)))return json(res,400,{error:'Invalid transport token'});
     if(peers[id])return json(res,409,{error:'Peer ID already registered'});
     if(Object.values(peers).some(p=>p.ip===ip||p.publicKey===publicKey))return json(res,409,{error:'Peer already exists'});
     await wg(['set',interfaceName,'peer',publicKey,'allowed-ips',ip+'/32']);
     peers[id]={ip,publicKey,...(transportToken?{transportHash:crypto.createHash('sha256').update(transportToken).digest('hex')}:{})};commit();return json(res,201,{ok:true,...(transportToken?{transport:true}:{})});
    }
    const match=url.pathname.match(/^\/v1\/peers\/(windows|key_[a-f0-9]{20})$/);
    if(req.method==='DELETE'&&match){
     const id=match[1],old=peers[id];
     if(!old)return json(res,404,{error:'No such peer'});
     await wg(['set',interfaceName,'peer',old.publicKey,'remove']);
     delete peers[id];transport?.revoke(id);commit();return json(res,200,{ok:true});
    }
    return json(res,404,{error:'Not found'});
   }catch(e){console.error(e);return json(res,500,{error:'Relay internal error'});}
  };
  busy=busy.catch(()=>{}).then(work);
 });
 transport=attachTunnelTransport(server,{getPeer:id=>peers[id],port:Number(process.env.USC_WG_PORT||51820)});
 await sync();
 await new Promise((resolve,reject)=>server.once('error',reject).listen(port,host,resolve));
 return server;
}
export {makeRelayServer};
if(process.argv[1] && import.meta.url===new URL('file://'+path.resolve(process.argv[1])).href){
 const s=await makeRelayServer();console.log('Relay provisioning API ready',s.address());
}
