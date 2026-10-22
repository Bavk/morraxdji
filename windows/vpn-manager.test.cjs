const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {manager}=require('./vpn-manager.cjs');
const {wireguardKeys}=require('./vpn.cjs');
test('Windows provisioning: enroll hub/operator, persist encrypted relay token, revoke',async()=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'usc-win-'));
 const relayKey=wireguardKeys().publicKey;
 const peers=new Map();const calls=[];
 const mock=async(url,options)=>{
  const pathname=new URL(url).pathname,c=JSON.parse(options.body||'{}');calls.push(`${options.method} ${pathname}`);
  if(options.headers.Authorization!=='Bearer '+'T'.repeat(40))return{ok:false,status:401,text:async()=>''};
  if(options.method==='GET'&&pathname==='/v1/status'){return {ok:true,json:async()=>({ok:true,windowsRegistered:peers.has('windows'),operatorPeers:peers.size-1})};}
  if(options.method==='POST'){
   if(peers.has(c.id))return{ok:false,status:409,text:async()=>''};
   peers.set(c.id,c);return{ok:true,json:async()=>({ok:true})};
  }
  if(options.method==='DELETE'){const id=pathname.split('/').pop();peers.delete(id);return{ok:true,json:async()=>({ok:true})};}
  return{ok:false,status:404,text:async()=>''};
 };
 const safeStorage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s.split('').reverse().join('')),decryptString:b=>b.toString().split('').reverse().join('')};
 const vpn=manager({dataDir,safeStorage,request:mock});
 try{
  assert.equal(vpn.status().configured,false);
  const config=await vpn.configure({baseUrl:'https://vpn.example.com/',endpoint:'vpn.example.com:51820',relayPublicKey:relayKey,adminToken:'T'.repeat(40)});
  assert.ok(fs.existsSync(config.configPath));assert.equal(peers.size,1);
  assert.deepEqual(await vpn.probeRelay(),{reachable:true,windowsRegistered:true,operatorPeers:0});
  const settings=fs.readFileSync(path.join(dataDir,'vpn-settings.json'),'utf8');assert.doesNotMatch(settings,/TTTTTT/);
  const opId='key_'+'a'.repeat(20);
  const key=await vpn.createOperator(async()=>({key:'STRM_'+'z'.repeat(32),operator:{id:opId,name:'Test'}}),()=>{throw Error('unexpected');});
  assert.ok(key.key.startsWith('USCV1.'));assert.equal(peers.get(opId).ip,'10.77.0.100');
  assert.equal(vpn.peerAddress(opId),'10.77.0.100');
  let revoked=false;
  await vpn.revokeOperator(opId,async()=>{revoked=true;});
  assert.equal(revoked,true);assert.equal(peers.has(opId),false);assert.equal(vpn.peerAddress(opId),null);
 }finally{fs.rmSync(dataDir,{recursive:true,force:true});}
});

test('revoked VPN peers are retried after temporary relay outage',async()=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'usc-vpn-retry-'));
 const relayKey=wireguardKeys().publicKey;
 const opId='key_'+'b'.repeat(20);
 const remotePeers=new Set();let failure=true;
 const request=async(url,options)=>{
   const id=new URL(url).pathname.split('/').pop();
   if(options.method==='POST'){remotePeers.add(JSON.parse(options.body).id);return{ok:true,json:async()=>({ok:true})};}
   if(options.method==='DELETE'&&id===opId&&failure)return{ok:false,status:503,text:async()=>''};
   if(options.method==='DELETE'){remotePeers.delete(id);return{ok:true,json:async()=>({ok:true})};}
   return{ok:true,json:async()=>({ok:true})};
 };
 const safeStorage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
 const vpn=manager({dataDir,safeStorage,request});
 try{
  await vpn.configure({baseUrl:'https://vpn.example.com/',endpoint:'vpn.example.com:51820',relayPublicKey:relayKey,adminToken:'T'.repeat(40)});
  await vpn.createOperator(async()=>({key:'STRM_'+'x'.repeat(32),operator:{id:opId,name:'Pilot'}}),async()=>{});
  let revoked=false;
  const partial=await vpn.revokeOperator(opId,async()=>{revoked=true;return{ok:true};});
  assert.equal(partial.ok,true);
  assert.equal(partial.vpnRemovalPending,true);
  assert.match(partial.warning,/VPN-пир/);
  assert.equal(revoked,true);
  assert.equal(vpn.hasPeer(opId),true);
  assert.equal(remotePeers.has(opId),true);
  const first=await vpn.cleanupRevoked([opId]);
  assert.equal(first.failed.length,1);
  failure=false;
  const second=await vpn.cleanupRevoked([opId,'key_'+'c'.repeat(20),'wrong']);
  assert.equal(second.removed,1);
  assert.equal(second.failed.length,0);
  assert.equal(vpn.hasPeer(opId),false);
  assert.equal(remotePeers.has(opId),false);
 }finally{fs.rmSync(dataDir,{recursive:true,force:true});}
});

test('individual key revocation happens BEFORE broken VPN settings/DPAPI access',async()=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'usc-revoke-first-'));
  const opId='key_'+'e'.repeat(20);
  fs.writeFileSync(path.join(dataDir,'vpn-settings.json'),'{ broken json');
  fs.writeFileSync(path.join(dataDir,'vpn-peers.json'),JSON.stringify({[opId]:{ip:'10.77.0.102',publicKey:wireguardKeys().publicKey}}));
  const vpn=manager({dataDir,safeStorage:{isEncryptionAvailable:()=>false}});
  let localCalls=0;
  try{
    const result=await vpn.revokeOperator(opId,async()=>{localCalls++;return{ok:true};});
    assert.equal(localCalls,1);
    assert.equal(result.ok,true);
    assert.equal(result.vpnRemovalPending,true);
    assert.match(result.warning,/Ключ заблокирован на Windows/);
  }finally{fs.rmSync(dataDir,{recursive:true,force:true});}
});

test('individual key revocation works without encrypted VPN credentials when peer is absent',async()=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'usc-revoke-nonpeer-'));
  const vpn=manager({dataDir,safeStorage:{isEncryptionAvailable:()=>false}});
  try{
    const result=await vpn.revokeOperator('key_'+'d'.repeat(20),async()=>({ok:true}));
    assert.equal(result.vpnRemovalPending,false);
    assert.equal(result.ok,true);
  }finally{fs.rmSync(dataDir,{recursive:true,force:true});}
});

test('bulk peer cleanup is bounded to three parallel relay requests',async()=>{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'usc-bulk-vpn-'));
  const relayKey=wireguardKeys().publicKey;
  const ids=Array.from({length:8},(_,i)=>'key_'+String(i+1).repeat(20));
  let inFlight=0,maxInFlight=0;
  const request=async(url,options)=>{
    if(options.method==='POST')return{ok:true,json:async()=>({ok:true})};
    if(options.method==='DELETE'){
      inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);
      await new Promise(r=>setTimeout(r,12));inFlight--;
      return{ok:true,json:async()=>({ok:true})};
    }
    return{ok:true,json:async()=>({ok:true})};
  };
  const safeStorage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
  const vpn=manager({dataDir,safeStorage,request});
  try {
    await vpn.configure({baseUrl:'https://vpn.example.com/',endpoint:'vpn.example.com:51820',relayPublicKey:relayKey,adminToken:'T'.repeat(40)});
    for(let i=0;i<ids.length;i++)await vpn.createOperator(async()=>({key:'STRM_'+String(i%10).repeat(32),operator:{id:ids[i],name:'Pilot'}}),async()=>{});
    const result=await vpn.cleanupRevoked([...ids,ids[0]]);
    assert.equal(result.removed,8);
    assert.equal(result.failed.length,0);
    assert.ok(maxInFlight<=3);
    assert.ok(maxInFlight>=2,'should issue independent DELETE requests concurrently');
    assert.equal(vpn.peerIds().length,0);
  }finally{fs.rmSync(dataDir,{recursive:true,force:true});}
});
