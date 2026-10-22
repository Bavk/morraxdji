'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {ADDRESS,wireguardKeys,validatePubKey,validateEndpoint,makeConfig,makeInvite,savePrivateJSON,allocIP}=require('./vpn.cjs');

function manager({dataDir,safeStorage,request=fetch}){
  const settingsPath=path.join(dataDir,'vpn-settings.json');
  const peersPath=path.join(dataDir,'vpn-peers.json');
  const configPath=path.join(dataDir,'usc-host.conf');
  function readJSON(p,def){return fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):def;}
  const peerAddress=keyId=>readJSON(peersPath,{})[keyId]?.ip || null;
  const hasPeer=keyId=>Boolean(peerAddress(keyId));
  const peerIds=()=>Object.keys(readJSON(peersPath,{}));
  const status=()=>({configured:fs.existsSync(settingsPath),windowsIp:ADDRESS,configPath:fs.existsSync(configPath)?configPath:null,peerCount:Object.keys(readJSON(peersPath,{})).length});
  function settings(){
    const config=readJSON(settingsPath,null);
    if(!config)throw Error('Сначала настройте VPN-ретранслятор');
    if(!safeStorage.isEncryptionAvailable())throw Error('Шифрование Windows DPAPI недоступно');
    return {...config, token:safeStorage.decryptString(Buffer.from(config.encryptedToken,'base64'))};
  }
  async function relayCall(config,method,endpoint,body){
    const target=new URL(endpoint,config.baseUrl+'/');
    if(target.origin!==new URL(config.baseUrl).origin)throw Error('Некорректный адрес ретранслятора');
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);
    try {
      const response=await request(target,{method,headers:{Authorization:`Bearer ${config.token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:controller.signal});
      if(!response.ok){const info=await response.text().catch(()=> '');const error=Error(`VPN-ретранслятор ответил ${response.status}: ${info.slice(0,140)}`);error.status=response.status;throw error;}
      return response.json();
    } finally{clearTimeout(timer);}
  }
  async function probeRelay(){
    if(!status().configured)return {reachable:false,error:'VPN не настроен'};
    try {
      const response=await relayCall(settings(),'GET','/v1/status');
      return {reachable:true,windowsRegistered:!!response.windowsRegistered,operatorPeers:Number(response.operatorPeers)||0};
    }catch(err){
      if(err.status===404)return {reachable:true,legacy:true,error:'VPS использует старую версию API; обновите relay.mjs и перезапустите службу'};
      return {reachable:false,error:String(err.message||err).slice(0,170)};
    }
  }
  async function configure({baseUrl,endpoint,relayPublicKey,adminToken}) {
    if(fs.existsSync(settingsPath))throw Error('VPN уже настроен. Для замены узла нужна миграция текущих операторов.');
    if(!safeStorage.isEncryptionAvailable())throw Error('Для защиты VPN-учётных данных недоступен Windows DPAPI');
    let parsed;try{parsed=new URL(baseUrl);}catch{throw Error('Укажите корректный https:// адрес API ретранслятора');}
    if(parsed.protocol!=='https:' || parsed.username || parsed.password || parsed.pathname!=='/' || parsed.search || parsed.hash)throw Error('VPN API должен быть вида https://vpn.example.com/');
    validateEndpoint(endpoint);
    if(!validatePubKey(relayPublicKey))throw Error('Неверный публичный ключ ретранслятора');
    if(typeof adminToken!=='string'||adminToken.trim().length<32)throw Error('Неверный секрет управления ретранслятором');
    const keys=wireguardKeys();
    const config={baseUrl:parsed.origin,endpoint,relayPublicKey,token:adminToken.trim()};
    await relayCall(config,'POST','/v1/peers',{id:'windows',ip:ADDRESS,publicKey:keys.publicKey});
    try{
      const wg=makeConfig({privateKey:keys.privateKey,address:ADDRESS,relayKey:relayPublicKey,endpoint,windows:true});
      fs.mkdirSync(dataDir,{recursive:true});
      fs.writeFileSync(configPath,wg,{mode:0o600,flag:'wx'});
      savePrivateJSON(settingsPath,{baseUrl:config.baseUrl,endpoint,relayPublicKey,encryptedToken:safeStorage.encryptString(config.token).toString('base64')});
      return status();
    }catch(error){
      await relayCall(config,'DELETE','/v1/peers/windows').catch(()=>{});
      throw error;
    }
  }
  async function createOperator(createKey, revokeKey){
    const config=settings();
    const key=await createKey();
    let registered=false;
    try {
      const peers=readJSON(peersPath,{});
      const ip=allocIP(peers);
      const keys=wireguardKeys();
      const transportToken=crypto.randomBytes(32).toString('base64url');
      const registeredPeer=await relayCall(config,'POST','/v1/peers',{id:key.operator.id,ip,publicKey:keys.publicKey,transportToken});
      registered=true;
      peers[key.operator.id]={ip,publicKey:keys.publicKey};
      savePrivateJSON(peersPath,peers);
      const url=new URL(config.baseUrl);url.protocol='wss:';url.pathname='/v1/tunnel/'+key.operator.id;
      return {key:makeInvite({operatorKey:key.key,privateKey:keys.privateKey,address:ip,relayKey:config.relayPublicKey,endpoint:config.endpoint,...(registeredPeer.transport===true?{transport:{url:url.href,token:transportToken}}:{})}),operator:key.operator};
    }catch(e){
      if(registered)await relayCall(config,'DELETE',`/v1/peers/${key.operator.id}`).catch(()=>{});
      await revokeKey(key.operator.id).catch(()=>{});throw e;
    }
  }
  async function revokeOperator(keyId,localRevoke){
    // Security invariant: local access MUST be revoked even if DPAPI, the
    // settings file, HTTPS, or the VPS is unavailable.
    const localResult=await localRevoke();
    let vpnRemovalPending=false;
    let localRegistryError=false;
    let peers={};
    try{peers=readJSON(peersPath,{});}catch(e){
      vpnRemovalPending=true;localRegistryError=true;
    }
    if(!localRegistryError && peers[keyId]){
      try {
        const config=settings();
        await relayCall(config,'DELETE',`/v1/peers/${keyId}`);
        delete peers[keyId];savePrivateJSON(peersPath,peers);
      } catch(e) {
        if(e.status===404){delete peers[keyId];savePrivateJSON(peersPath,peers);}
        else vpnRemovalPending=true;
      }
    }
    const messages=[localResult?.warning, vpnRemovalPending?
      'Ключ заблокирован на Windows, но состояние VPN на VPS не подтверждено. Проверьте и повторите очистку VPN-пиров после восстановления связи.':null]
      .filter(Boolean);
    return {ok:true, ...(messages.length?{warning:messages.join(' ')}:{}),
      vpnRemovalPending,mediaDisconnected:localResult?.mediaDisconnected!==false};
  }
  // A failed relay DELETE must not permanently strand a revoked operator's VPN peer.
  // Only retry peers whose local API key is explicitly revoked.
  async function cleanupRevoked(revokedIds){
    const config=settings();
    const pending=readJSON(peersPath,{});
    const ids=[...new Set(revokedIds)].filter(id=>/^key_[a-f0-9]{20}$/.test(id)&&pending[id]);
    const failed=[];let removed=0;
    // Bounded concurrency: with a dead VPS, N revoked peers should not block
    // the Windows UI for N x the HTTPS timeout. Each success is durably saved.
    let next=0;
    async function worker(){
      while(next<ids.length){
        const id=ids[next++];
        try{
          await relayCall(config,'DELETE',`/v1/peers/${id}`);
          delete pending[id];savePrivateJSON(peersPath,pending);removed++;
        }catch(e){
          if(e.status===404){delete pending[id];savePrivateJSON(peersPath,pending);removed++;}
          else failed.push({id,error:String(e.message).slice(0,120)});
        }
      }
    }
    await Promise.all(Array.from({length:Math.min(3,ids.length)},()=>worker()));
    return {removed,failed,remaining:failed.length};
  }
  return {status,configure,createOperator,revokeOperator,cleanupRevoked,hasPeer,peerIds,peerAddress,probeRelay};
}
// Retain only VPN devices with an active, unrevoked operator key. A deleted
// room cannot leave a VPN peer stranded just because its keys disappeared.
function stalePeerIds(peerIds, rooms) {
  const active = new Set(rooms.flatMap(room=>room.keys.filter(key=>!key.revoked).map(key=>key.id)));
  return [...new Set(peerIds)].filter(id=>!active.has(id));
}
module.exports={manager,stalePeerIds};
