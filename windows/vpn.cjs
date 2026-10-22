'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ADDRESS = '10.77.0.1';
const RELAY_PORT = 51820;

function wireguardKeys() {
  const pair = crypto.generateKeyPairSync('x25519');
  const priv = pair.privateKey.export({format:'jwk'});
  const pub = pair.publicKey.export({format:'jwk'});
  return {privateKey: Buffer.from(priv.d,'base64url').toString('base64'), publicKey: Buffer.from(pub.x,'base64url').toString('base64')};
}
function validatePubKey(k) {
  return typeof k === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(k) && Buffer.from(k,'base64').length===32;
}
function validateEndpoint(value) {
  // Bracketed IPv6 intentionally unsupported in prototype: use IPv4 or DNS.
  if(typeof value!=='string' || !/^[a-zA-Z0-9.-]+:[0-9]{1,5}$/.test(value)) throw Error('Укажите relay.example.com:51820');
  const [host, port] = value.split(':');
  if(host.length > 253 || Number(port)<1 || Number(port)>65535 || !host.includes('.') || host.includes('..')) throw Error('Некорректный VPN-адрес');
  return value;
}
function makeConfig({privateKey, address, relayKey, endpoint, windows}) {
  if(!validatePubKey(privateKey) || !validatePubKey(relayKey))throw Error('Некорректный ключ WireGuard');
  if(address!==ADDRESS && !/^10\.77\.0\.(?:1\d\d|2[0-3]\d|240)$/.test(address))throw Error('Недопустимый VPN-IP');
  return `[Interface]\nPrivateKey = ${privateKey}\nAddress = ${address}/32\nMTU = 1280\n\n[Peer]\nPublicKey = ${relayKey}\nEndpoint = ${validateEndpoint(endpoint)}\nAllowedIPs = ${windows ? '10.77.0.0/24' : ADDRESS+'/32'}\nPersistentKeepalive = 25\n`;
}
function makeInvite({operatorKey,privateKey,address,relayKey,endpoint,transport}) {
  if(!/^STRM_[A-Za-z0-9_-]{32}$/.test(operatorKey)) throw Error('Некорректный операторский ключ');
  makeConfig({privateKey,address,relayKey,endpoint,windows:false}); // validate only; Android composes a strict split tunnel
  if(transport){const u=new URL(transport.url);if(u.protocol!=='wss:'||u.username||u.password||u.search||u.hash||!/^\/v1\/tunnel\/key_[a-f0-9]{20}$/.test(u.pathname)||!/^[A-Za-z0-9_-]{43}$/.test(transport.token))throw Error('Некорректный HTTPS-транспорт VPN');}
  const data={v:1,key:operatorKey,ip:address,privateKey,relayKey,endpoint,...(transport?{transport}:{})};
  return `USCV1.${Buffer.from(JSON.stringify(data)).toString('base64url')}`;
}
function savePrivateJSON(target,data) {
  fs.mkdirSync(path.dirname(target),{recursive:true});
  const tmp=target+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(data,null,2),{mode:0o600});
  fs.renameSync(tmp,target);
}
function allocIP(peers) {
  const taken=new Set(Object.values(peers).map(v=>v.ip));
  for(let n=100;n<=240;n++){const ip=`10.77.0.${n}`;if(!taken.has(ip))return ip;}
  throw Error('Нет свободных VPN-адресов (максимум 141 оператор)');
}
module.exports={ADDRESS,RELAY_PORT,wireguardKeys,validatePubKey,validateEndpoint,makeConfig,makeInvite,savePrivateJSON,allocIP};
