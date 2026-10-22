import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {verifyServerFiles} from './server-dependencies.mjs';

const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const packaged=path.resolve(process.argv[2]||'windows/release/win-unpacked/resources/server');
const files=verifyServerFiles(path.join(repository,'server'),packaged);
// Import ONLY the installed/packaged entry point, never the repository API.
const {createApiServer}=await import(pathToFileURL(path.join(packaged,'server.mjs')).href);
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'usc-packaged-api-'));
let server;
try{
 const password=crypto.randomBytes(32).toString('hex');
 server=await createApiServer({host:'127.0.0.1',port:0,dataPath:path.join(temporary,'rooms.json'),adminPassword:password,apiKey:'packaged-smoke',apiSecret:crypto.randomBytes(32).toString('hex'),wsUrl:'ws://127.0.0.1:7880'});
 const base='http://127.0.0.1:'+server.address().port;
 async function call(method,route,body){const r=await fetch(base+route,{method,headers:{Authorization:'Bearer '+password,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});assert.equal(r.status<300,true,route+' '+r.status);return r.json();}
 assert.equal((await call('GET','/health')).ok,true);
 const room=(await call('POST','/api/admin/rooms',{name:'Packaged server test'})).room;
 const key=(await call('POST',`/api/admin/rooms/${room.id}/keys`,{name:'Synthetic controller'}));
 assert.equal((await call('PATCH',`/api/admin/rooms/${room.id}/settings`,{settings:{profile:'economy',maxOperators:2}})).room.settings.profile,'economy');
 assert.equal((await call('PATCH',`/api/admin/operators/${key.operator.id}/settings`,{settings:{device:'Synthetic model'}})).operator.settings.device,'Synthetic model');
 assert.equal((await call('POST','/api/operator/session',{key:key.key})).streamProfile,'economy');
 console.log(`PACKAGED_SERVER_START_PASS: ${files.length} dependency files verified; packaged API starts and room/operator settings work`);
}finally{if(server)await new Promise(resolve=>server.close(resolve));await fs.rm(temporary,{recursive:true,force:true});}
