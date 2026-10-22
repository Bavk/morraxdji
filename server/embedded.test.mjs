import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createApiServer} from './server.mjs';

await test('embedded Windows API uses separate operator and local-viewer endpoints', async () => {
  const dir=mkdtempSync(path.join(tmpdir(),'usc-embedded-'));
  let server;
  try {
    server=await createApiServer({
      host:'127.0.0.1',port:0,
      dataPath:path.join(dir,'rooms.json'),
      adminPassword:'an-administrator-password-very-long-1234567890',
      apiKey:'embeddedtest',apiSecret:'a-very-long-server-signing-secret-for-testing',
      wsUrl:'ws://192.168.10.15:7880',desktopWsUrl:'ws://127.0.0.1:7880'
    });
    const url=`http://127.0.0.1:${server.address().port}`;
    const password='an-administrator-password-very-long-1234567890';
    const req=async(pathname,body,admin=false)=>{
      const response=await fetch(url+pathname,{
        method:'POST',headers:{'Content-Type':'application/json',...(admin?{Authorization:`Bearer ${password}`}:{})},
        body:JSON.stringify(body)
      });
      return {code:response.status,body:await response.json()};
    };
    const created=await req('/api/admin/rooms',{name:'LAN Test'},true);
    assert.equal(created.code,201);
    const roomId=created.body.room.id;
    const key=await req(`/api/admin/rooms/${roomId}/keys`,{name:'Operator'},true);
    assert.equal(key.code,201);
    const operator=await req('/api/operator/session',{key:key.body.key});
    assert.equal(operator.code,200);
    assert.equal(operator.body.wsUrl,'ws://192.168.10.15:7880');
    const viewer=await req(`/api/admin/rooms/${roomId}/viewer`,{},true);
    assert.equal(viewer.code,200);
    assert.equal(viewer.body.wsUrl,'ws://127.0.0.1:7880');
  } finally {
    if(server) await new Promise(resolve=>server.close(resolve));
    rmSync(dir,{recursive:true,force:true});
  }
});
