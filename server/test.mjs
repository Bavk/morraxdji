import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const dir=mkdtempSync(path.join(tmpdir(),'stream-api-'));
const port=33000+crypto.randomInt(1000);
const admin='this-is-a-very-long-admin-secret-for-testing';
const secret='this-is-a-very-long-livekit-api-secret-for-testing';
const child=spawn(process.execPath,['server.mjs'],{
  cwd:path.dirname(fileURLToPath(import.meta.url)), env:{...process.env,HOST:'127.0.0.1', PORT:String(port),
    ADMIN_PASSWORD:admin, LIVEKIT_API_KEY:'testkey', LIVEKIT_API_SECRET:secret,
    LIVEKIT_WS_URL:'wss://example.livekit.cloud',DATA_FILE:path.join(dir,'rooms.json')},stdio:'pipe'});
const url=`http://127.0.0.1:${port}`;
const req=async (route,method='GET',body,auth=false) => {
  const r=await fetch(url+route,{method,headers:{...(auth?{authorization:'Bearer '+admin}:{}),'content-type':'application/json'},
    ...(body?{body:JSON.stringify(body)}:{})});return {code:r.status,data:await r.json()};
};
const wait=async()=>{for(let i=0;i<100;i++){try{await fetch(url+'/health');return;}catch{await new Promise(r=>setTimeout(r,30));}}throw Error('server did not start');};
try {
 await wait();
 await test('admin authentication and operator flow',async()=>{
  assert.equal((await req('/api/admin/rooms')).code,401);
  const room=(await req('/api/admin/rooms','POST',{name:'Группа Альфа'},true));
  assert.equal(room.code,201);
  const id=room.data.room.id;
  const key=(await req(`/api/admin/rooms/${id}/keys`,'POST',{name:'Пульт №1'},true));
  assert.equal(key.code,201);
  const k=key.data.key;
  assert.match(k,/^STRM_[A-Za-z0-9_-]+$/);
  assert.equal((await req('/api/operator/session','POST',{key:'bad'})).code,401);
  const session=(await req('/api/operator/session','POST',{key:k}));
  assert.equal(session.code,200);
  const [,body,signature]=session.data.token.split('.');
  const payload=JSON.parse(Buffer.from(body,'base64url').toString());
  assert.equal(payload.video.canPublishSources[0],'screen_share');
  assert.equal(payload.video.canSubscribe,false);
  const unsigned=session.data.token.slice(0,session.data.token.lastIndexOf('.'));
  assert.equal(crypto.createHmac('sha256',secret).update(unsigned).digest('base64url'),signature);
  const viewer=(await req(`/api/admin/rooms/${id}/viewer`,'POST',{},true));
  const viewerPayload=JSON.parse(Buffer.from(viewer.data.token.split('.')[1],'base64url').toString());
  assert.equal(viewerPayload.video.canPublish,false);
  const keyId=key.data.operator.id;
  assert.equal((await req(`/api/admin/rooms/${id}/keys/${keyId}`,'DELETE',null,true)).code,200);
  assert.equal((await req('/api/operator/session','POST',{key:k})).code,401);
 });
} finally {child.kill();rmSync(dir,{recursive:true,force:true});}
