import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LiveKitAdmin } from './livekit-admin.mjs';
import { isProvisionedVpnAddress, vpnPeerMatchesOperator } from './operator-network.mjs';
import { startRevocationReconciler, reconcileRevokedOperators } from './revoked-reconciler.mjs';
import {reconcilePendingRoomDeletions,DELETED_ROOM_GUARD_MS} from './pending-deletions.mjs';
import {operatorSettings,roomSettings,operatorActive,validatedSettings,validatedName} from './settings.mjs';

const base = path.dirname(fileURLToPath(import.meta.url));
// Used both as a standalone Node.js API and embedded inside the Windows Electron main process.
export async function createApiServer(config = {}) {
const dataPath = config.dataPath || process.env.DATA_FILE || path.join(base, 'data', 'rooms.json');
const port = Number(config.port ?? process.env.PORT ?? 3100);
const host = config.host || process.env.HOST || '127.0.0.1';
const adminPassword = config.adminPassword || process.env.ADMIN_PASSWORD || '';
const apiKey = config.apiKey || process.env.LIVEKIT_API_KEY || '';
const apiSecret = config.apiSecret || process.env.LIVEKIT_API_SECRET || '';
const wsUrl = config.wsUrl || process.env.LIVEKIT_WS_URL || '';
const desktopWsUrl = config.desktopWsUrl || wsUrl;
const operatorAccess = config.operatorAccess || 'any';
if(!['any','vpn-only'].includes(operatorAccess))throw Error('Invalid operatorAccess policy');
// VPN-only deployments must supply the operator-to-VPN-IP mapping (no fallback).
if(operatorAccess==='vpn-only' && typeof config.operatorVpnAddressForId !== 'function')
  throw Error('VPN-only mode requires operatorVpnAddressForId');
// Standalone test API can omit moderation; the Electron host enables it explicitly.
const mediaControl = config.livekitControl || (config.livekitHttpUrl ? new LiveKitAdmin({endpoint:config.livekitHttpUrl,apiKey,apiSecret}) : null);
if (adminPassword.length < 20 || apiSecret.length < 20 || !apiKey || !/^wss?:\/\//.test(wsUrl)) {
  throw Error('Configure ADMIN_PASSWORD (>=20 chars), LIVEKIT_API_KEY, LIVEKIT_API_SECRET (>=20 chars), LIVEKIT_WS_URL.');
}
if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Invalid PORT');

function hash(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function uid(prefix) { return `${prefix}_${crypto.randomBytes(10).toString('hex')}`; }
function fixedEqual(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x,y);
}
function encodeBase64(data) { return Buffer.from(JSON.stringify(data)).toString('base64url'); }
function jwt({ identity, name, room, publisher, ttlSeconds = 300 }) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    iss: apiKey, sub: identity, name, iat: now, nbf: now, exp: now + ttlSeconds,
    video: { room, roomJoin: true, canPublish: publisher, canSubscribe: !publisher,
      canPublishData: false, ...(publisher ? { canPublishSources: ['screen_share'] } : {}) }
  };
  const unsigned = `${encodeBase64(header)}.${encodeBase64(payload)}`;
  return `${unsigned}.${crypto.createHmac('sha256', apiSecret).update(unsigned).digest('base64url')}`;
}
function readDb() {
  try { return JSON.parse(fs.readFileSync(dataPath,'utf8')); }
  catch(e) { if (e.code === 'ENOENT') return { rooms: [] }; throw e; }
}
let db = readDb();
if (!Array.isArray(db.rooms)) throw Error('Bad data file: expected rooms[]');
if (db.pendingRoomDeletes === undefined) db.pendingRoomDeletes=[]; // v0.11 migration
if (!Array.isArray(db.pendingRoomDeletes) || db.pendingRoomDeletes.some(item=>!item || !/^room_[a-f0-9]{20}$/.test(item.id) || !Number.isSafeInteger(item.expireAt) || item.expireAt <= 0))
  throw Error('Bad data file: invalid pendingRoomDeletes');
if(db.accessRevocations===undefined)db.accessRevocations=[];
if(!Array.isArray(db.accessRevocations))throw Error('Invalid access revocations');
const accessIds=(home,key)=>Array.isArray(key.allowedRoomIds)?key.allowedRoomIds:[home.id];
const allOperators=()=>db.rooms.flatMap(home=>home.keys.map(key=>({home,key})));
const allowedRooms=(home,key)=>db.rooms.filter(room=>accessIds(home,key).includes(room.id));
const assignmentCount=(room,exceptId)=>allOperators().filter(({home,key})=>!key.revoked&&key.id!==exceptId&&accessIds(home,key).includes(room.id)).length;
const fullRoom=(room,exceptId)=>roomSettings(room).maxOperators>0&&assignmentCount(room,exceptId)>=roomSettings(room).maxOperators;
const visibleOperator=(home,key)=>({id:key.id,name:key.name,homeRoomId:home.id,createdAt:key.createdAt,revoked:!!key.revoked,allowedRoomIds:allowedRooms(home,key).map(r=>r.id),settings:operatorSettings(key)});
function enforcementRooms(){
 const operators=allOperators(),now=Date.now();
 return db.rooms.map(room=>({...room,keys:[...operators.map(({home,key})=>({...key,revoked:!operatorActive(key,now)||!roomSettings(room).open||!accessIds(home,key).includes(room.id)})),...db.accessRevocations.filter(item=>item.roomId===room.id&&item.expireAt>now).map(item=>({id:item.keyId,revoked:true}))]}));
}
function holdAccessRevocation(roomId,keyId){db.accessRevocations=db.accessRevocations.filter(item=>item.expireAt>Date.now()&&!(item.roomId===roomId&&item.keyId===keyId));db.accessRevocations.push({roomId,keyId,expireAt:Date.now()+330000});}
async function kickFromRooms(keyId,roomIds){
 let mediaDisconnected=true;
 if(mediaControl)for(const roomId of roomIds){try{await mediaControl.removeParticipant(roomId,'operator_'+keyId);}catch{mediaDisconnected=false;}}
 return mediaDisconnected;
}
function persist() {
  fs.mkdirSync(path.dirname(dataPath),{recursive:true});
  const temp = `${dataPath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(db,null,2),{mode:0o600});
  fs.renameSync(temp,dataPath);
}
function acknowledgeDeletedRoom(id) {
  if (!db.pendingRoomDeletes.some(item=>item.id===id && Date.now()>=item.expireAt)) return;
  db.pendingRoomDeletes=db.pendingRoomDeletes.filter(item=>item.id!==id);
  persist();
}
function reply(res,code,body) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8',
    'cache-control':'no-store', 'x-content-type-options':'nosniff',
    'referrer-policy':'no-referrer' });
  res.end(JSON.stringify(body));
}
async function readBody(req) {
  let body = '';
  for await (const chunk of req) { body += chunk.toString('utf8'); if (body.length > 4096) throw Object.assign(Error('Payload too large'),{code:413}); }
  try { return body ? JSON.parse(body) : {}; } catch { throw Object.assign(Error('Invalid JSON'),{code:400}); }
}
function visibleRoom(room) {
  return {id:room.id,name:room.name,settings:roomSettings(room),assignedCount:assignmentCount(room),assignedOperators:allOperators().filter(({home,key})=>home.id!==room.id&&!key.revoked&&accessIds(home,key).includes(room.id)).map(({home,key})=>visibleOperator(home,key)),keys:room.keys.map(key=>visibleOperator(room,key))};
}
function admin(req) {
  // Management endpoints are never available from other computers in this prototype.
  // Operators only need /api/operator/session.
  if (!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return false;
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') && fixedEqual(h.slice(7),adminPassword);
}
const server = http.createServer(async (req,res) => {
  try {
    const pathname = new URL(req.url,'http://localhost').pathname;
    if (req.method === 'GET' && pathname === '/health') return reply(res,200,{ok:true});
    if (req.method === 'POST' && ['/api/operator/session','/api/operator/rooms'].includes(pathname)) {
      if(operatorAccess==='vpn-only' && !isProvisionedVpnAddress(req.socket.remoteAddress))
        return reply(res,403,{error:'Operator access requires the configured VPN tunnel'});
      const body = await readBody(req);
      const key = typeof body.key === 'string' ? body.key.trim() : '';
      if (!key || key.length > 160) return reply(res,400,{error:'Invalid key'});
      const keyHash = hash(key);
      for (const room of db.rooms) {
        const operator = room.keys.find(k => !k.revoked && fixedEqual(k.hash,keyHash));
        if (operator) {
          if(operatorAccess==='vpn-only' && !vpnPeerMatchesOperator(req.socket.remoteAddress,operator.id,config.operatorVpnAddressForId))
            return reply(res,403,{error:'This key does not belong to the connected VPN device'});
          if(!operatorActive(operator))return reply(res,403,{error:operatorSettings(operator).enabled?'Срок доступа оператора истёк':'Доступ оператора временно приостановлен'});
          const preferences=operatorSettings(operator);
          const available=allowedRooms(room,operator).filter(target=>roomSettings(target).open).sort((a,b)=>Number(b.id===preferences.preferredRoomId)-Number(a.id===preferences.preferredRoomId));
          if(pathname==='/api/operator/rooms')return reply(res,200,{rooms:available.map(r=>({id:r.id,name:r.name})),operatorName:operator.name});
          const target=body.roomId===undefined?available[0]:available.find(r=>r.id===body.roomId);
          if(!target)return reply(res,403,{error:'Нет доступа к выбранной комнате'});
          return reply(res,200,{wsUrl,roomId:target.id,roomName:target.name,operatorName:operator.name,
          streamProfile:preferences.profile==='auto'?roomSettings(target).profile:preferences.profile,
          token:jwt({identity:`operator_${operator.id}`,name:operator.name,room:target.id,publisher:true,ttlSeconds:preferences.expiresAt===null?300:Math.max(1,Math.min(300,Math.floor(preferences.expiresAt/1000)-Math.floor(Date.now()/1000)))})});
        }
      }
      return reply(res,401,{error:'Invalid or revoked key'});
    }
    if (!pathname.startsWith('/api/admin/')) return reply(res,404,{error:'Not found'});
    if (!admin(req)) return reply(res,401,{error:'Unauthorized'});
    if (req.method === 'POST' && pathname === '/api/admin/reconcile-revoked') {
      if (!mediaControl) return reply(res,503,{error:'LiveKit moderation is not enabled'});
      const revoke=await reconcileRevokedOperators(enforcementRooms(),mediaControl);
      const deleted=await reconcilePendingRoomDeletions(db.pendingRoomDeletes,mediaControl,acknowledgeDeletedRoom);
      return reply(res,200,{...revoke,...deleted});
    }
    if (req.method === 'GET' && pathname === '/api/admin/rooms') return reply(res,200,{rooms:db.rooms.map(visibleRoom),pendingDeletedRooms:db.pendingRoomDeletes.length});
    if (req.method === 'POST' && pathname === '/api/admin/rooms') {
      const body = await readBody(req);
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name || name.length > 80) return reply(res,400,{error:'Room name must be 1..80 chars'});
      const room = { id:uid('room'),name,keys:[] };
      db.rooms.push(room); persist(); return reply(res,201,{room:visibleRoom(room)});
    }
    const settingsMatch=pathname.match(/^\/api\/admin\/(operators|rooms)\/((?:key|room)_[a-f0-9]{20})\/settings$/);
    if(req.method==='PATCH'&&settingsMatch){
      const isOperator=settingsMatch[1]==='operators',id=settingsMatch[2];
      const found=isOperator?allOperators().find(({key})=>key.id===id):null;
      const item=isOperator?found?.key:db.rooms.find(room=>room.id===id);
      if(!item)return reply(res,404,{error:'Объект не найден'});
      if(isOperator&&item.revoked)return reply(res,409,{error:'Отозванный ключ нельзя активировать. Создайте новый.'});
      const body=await readBody(req);
      if(!body||typeof body!=='object'||Array.isArray(body))return reply(res,400,{error:'Ожидается объект настроек'});
      const next=validatedSettings(isOperator?'operator':'room',item.settings,body.settings===undefined?{}:body.settings);
      const name=body.name===undefined?item.name:validatedName(body.name,isOperator?60:80);
      if(isOperator&&next.preferredRoomId!==null&&!allowedRooms(found.home,item).some(room=>room.id===next.preferredRoomId))return reply(res,400,{error:'Предпочтительная комната должна быть разрешена оператору'});
      if(!isOperator&&next.maxOperators>0&&assignmentCount(item)>next.maxOperators)return reply(res,409,{error:'Сначала сократите число назначенных операторов или увеличьте лимит'});
      const oldName=item.name,oldSettings=item.settings;item.name=name;item.settings=next;
      try{persist();}catch(error){item.name=oldName;if(oldSettings===undefined)delete item.settings;else item.settings=oldSettings;throw error;}
      let mediaDisconnected=true;
      if(isOperator&&!operatorActive(item))mediaDisconnected=await kickFromRooms(item.id,accessIds(found.home,item));
      if(!isOperator&&!next.open)for(const {home,key} of allOperators().filter(({home,key})=>accessIds(home,key).includes(id)))if(!await kickFromRooms(key.id,[id]))mediaDisconnected=false;
      return reply(res,200,{ok:true,...(isOperator?{operator:visibleOperator(found.home,item)}:{room:visibleRoom(item)}),mediaDisconnected,...(!mediaDisconnected?{warning:'Настройки сохранены. Отключение действующих сеансов будет повторено автоматически.'}:{})});
    }
    const accessMatch=pathname.match(/^\/api\/admin\/operators\/(key_[a-f0-9]{20})\/rooms$/);
    if(req.method==='PATCH'&&accessMatch){
      const found=allOperators().find(({key})=>key.id===accessMatch[1]);if(!found)return reply(res,404,{error:'Оператор не найден'});
      if(found.key.revoked)return reply(res,409,{error:'Ключ отозван'});
      const body=await readBody(req),ids=body.roomIds;
      if(!Array.isArray(ids)||!ids.length||ids.length>100||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!db.rooms.some(room=>room.id===id)))return reply(res,400,{error:'Выберите от 1 до 100 существующих комнат без повторений'});
      if(ids.some(id=>fullRoom(db.rooms.find(room=>room.id===id),found.key.id)))return reply(res,409,{error:'Достигнут лимит назначенных операторов в одной из комнат'});
      const previous=accessIds(found.home,found.key),removed=previous.filter(id=>!ids.includes(id));
      const old=found.key.allowedRoomIds,oldSettings=found.key.settings,oldRevocations=[...db.accessRevocations];found.key.allowedRoomIds=[...ids];
      if(found.key.settings?.preferredRoomId&&!ids.includes(found.key.settings.preferredRoomId))found.key.settings={...found.key.settings,preferredRoomId:null};
      for(const id of removed)holdAccessRevocation(id,found.key.id);
      // A re-grant makes the operator legitimate in that room again.
      db.accessRevocations=db.accessRevocations.filter(item=>item.keyId!==found.key.id||!ids.includes(item.roomId));
      try{persist();}catch(error){if(old===undefined)delete found.key.allowedRoomIds;else found.key.allowedRoomIds=old;if(oldSettings===undefined)delete found.key.settings;else found.key.settings=oldSettings;db.accessRevocations=oldRevocations;throw error;}
      const mediaDisconnected=await kickFromRooms(found.key.id,removed);
      return reply(res,200,{ok:true,roomIds:ids,mediaDisconnected,...(!mediaDisconnected?{warning:'Доступ изменён. Отключение старых сеансов будет повторено автоматически.'}:{})});
    }
    const roomMatch = pathname.match(/^\/api\/admin\/rooms\/(room_[a-f0-9]{20})(?:\/(keys|viewer|presence|selftest))?(?:\/(key_[a-f0-9]{20}))?$/);
    if (!roomMatch) return reply(res,404,{error:'Not found'});
    const [,id,action,keyId] = roomMatch;
    const room = db.rooms.find(r => r.id === id);
    if (!room) return reply(res,404,{error:'Room not found'});
    if (req.method === 'PATCH' && !action) {
      const body=await readBody(req);
      const name=typeof body.name==='string'?body.name.trim():'';
      if(!name||name.length>80||/[\u0000-\u001f\u007f]/.test(name))return reply(res,400,{error:'Название комнаты: 1–80 символов, без управляющих символов'});
      const previous=room.name;room.name=name;
      try{persist();}catch(error){room.name=previous;throw error;}
      return reply(res,200,{room:visibleRoom(room)});
    }
    if (req.method === 'DELETE' && !action) {
      // Remove local access FIRST, then attempt LiveKit deletion. If LiveKit is
      // down, retain a persistent tombstone until a later reconciliation sweep.
      if (mediaControl && !db.pendingRoomDeletes.some(item=>item.id===id))
        db.pendingRoomDeletes.push({id,expireAt:Date.now()+DELETED_ROOM_GUARD_MS});
      const inherited=room.keys.flatMap(key=>allowedRooms(room,key).filter(target=>target.id!==id).map(target=>({roomId:target.id,keyId:key.id})));
      for(const item of inherited)holdAccessRevocation(item.roomId,item.keyId);
      db.rooms = db.rooms.filter(r => r.id !== id); persist();
      for(const item of inherited)await kickFromRooms(item.keyId,[item.roomId]);
      let mediaDisconnected=!mediaControl;
      if (mediaControl) {
        try {await mediaControl.deleteRoom(id);mediaDisconnected=true;}
        catch(e){console.error('LiveKit room deletion pending:',e.message);}
      }
      return reply(res,200,{ok:true,mediaDisconnected,
        ...(!mediaDisconnected?{warning:'Комната удалена на Windows, но LiveKit пока недоступен. Отключение активных участников будет повторено автоматически.'}:{})});
    }
    if (req.method === 'GET' && action === 'presence' && !keyId) {
      if(!mediaControl) return reply(res,503,{error:'LiveKit management is not enabled'});
      const connected=await mediaControl.listParticipants(id);
      const byIdentity=new Map(connected.map(p=>[p.identity,p]));
      const operators=allOperators().filter(({home,key})=>accessIds(home,key).includes(id)).map(({key:k})=>{
        const p=byIdentity.get(`operator_${k.id}`);
        return {id:k.id,online:!!p && !k.revoked,streaming:!!p && !k.revoked && Array.isArray(p.tracks) && p.tracks.some(t=>
          (t.source===3 || t.source==='SCREEN_SHARE') && !t.muted),
          joinedAt:p?.joinedAt || p?.joined_at || null};
      });
      return reply(res,200,{operators});
    }
    if (req.method === 'POST' && action === 'keys' && !keyId) {
      if(fullRoom(room))return reply(res,409,{error:'Достигнут лимит назначенных операторов комнаты'});
      const body = await readBody(req);
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name || name.length > 60) return reply(res,400,{error:'Operator name must be 1..60 chars'});
      const secret = `STRM_${crypto.randomBytes(24).toString('base64url')}`;
      const k = {id:uid('key'),name,hash:hash(secret),createdAt:new Date().toISOString(),revoked:false};
      room.keys.push(k); persist();
      return reply(res,201,{key:secret,operator:{id:k.id,name:k.name}});
    }
    if (req.method === 'PATCH' && action === 'keys' && keyId) {
      const operator=room.keys.find(k=>k.id===keyId);
      if(!operator)return reply(res,404,{error:'Key not found'});
      if(operator.revoked)return reply(res,409,{error:'Отозванный ключ нельзя переименовать'});
      const body=await readBody(req),name=typeof body.name==='string'?body.name.trim():'';
      if(!name||name.length>60||/[\u0000-\u001f\u007f]/.test(name))return reply(res,400,{error:'Имя оператора: 1–60 символов, без управляющих символов'});
      const previous=operator.name;operator.name=name;
      try{persist();}catch(error){operator.name=previous;throw error;}
      return reply(res,200,{operator:{id:operator.id,name:operator.name}});
    }
    if (req.method === 'DELETE' && action === 'keys' && keyId) {
      const k = room.keys.find(k => k.id === keyId);
      if (!k) return reply(res,404,{error:'Key not found'});
      // Persist revocation first, then kick the connected participant.
      k.revoked = true; persist();
      const mediaDisconnected=await kickFromRooms(k.id,db.rooms.map(r=>r.id));
      return reply(res,200,{ok:true,mediaDisconnected,
        ...(mediaDisconnected?{}:{warning:'Ключ заблокирован, но активный видеосеанс не удалось принудительно завершить. Проверьте LiveKit.'})});
    }
    if (req.method === 'POST' && action === 'selftest' && !keyId) {
      // Local Windows-only test: publish a synthetic screen track, never a camera or microphone.
      // Does not create a reusable operator key or a VPN peer.
      const identity = uid('selftest');
      return reply(res,200,{wsUrl:desktopWsUrl,identity,
        token:jwt({identity,name:'Тест Windows',room:room.id,publisher:true,ttlSeconds:90})});
    }
    if (req.method === 'POST' && action === 'viewer' && !keyId) {
      return reply(res,200,{wsUrl:desktopWsUrl,token:jwt({identity:uid('viewer'),name:'Windows Viewer',room:room.id,publisher:false})});
    }
    return reply(res,405,{error:'Method not allowed'});
  } catch(e) {
    console.error(e.message);
    // Filesystem codes such as EISDIR/ENOSPC are not HTTP status codes.
    const status=Number.isInteger(e.code)&&e.code>=400&&e.code<=599?e.code:500;
    reply(res,status,{error:status===500?'Server error':e.message});
  }
});
const reconciler = mediaControl && config.revocationReconcile !== false
  ? startRevocationReconciler({getRooms:() => enforcementRooms(),mediaControl,
      getDeletedRooms:()=>db.pendingRoomDeletes,ackDeletedRoom:acknowledgeDeletedRoom,
      periodMs:config.revocationPeriodMs ?? 30000}) : null;
if (reconciler) server.once('close', () => reconciler.stop());
return await new Promise((resolve, reject) => {
  server.once('error', err => {reconciler?.stop();reject(err);});
  server.listen(port,host,() => {
    if(reconciler)void reconciler.sweep().catch(e=>console.warn('Initial revoke reconciliation failed:',e.message));
    console.log(`Universal Stream API listening on http://${host}:${port}`);
    resolve(server);
  });
});
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await createApiServer();
}

