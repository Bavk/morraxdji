const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {RecordingStore,recordingName}=require('./recording-store.cjs');
test('recording chunks are serialized and finalization closes a complete owner-scoped file',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'usc-rec-test-'));const store=new RecordingStore();
 try{const s=await store.begin(1,path.join(dir,'a.webm'));await assert.rejects(async()=>store.append(2,s.id,new Uint8Array([9])),/недоступен/);
 await Promise.all([store.append(1,s.id,new Uint8Array([1,2])),store.append(1,s.id,new Uint8Array([3,4]))]);
 const r=await store.finish(1,s.id);assert.equal(r.saved,true);assert.equal(r.bytes,4);assert.deepEqual([...await fs.readFile(r.filePath)],[1,2,3,4]);assert.equal(store.sessions.size,0);
 }finally{await store.closeOwner(1);await fs.rm(dir,{recursive:true,force:true});}
});
test('existing files, invalid extensions and oversized fragments are refused',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'usc-rec-test-'));const store=new RecordingStore({maxChunkBytes:2});
 try{const target=path.join(dir,'a.webm');await fs.writeFile(target,'keep');await assert.rejects(store.begin(1,target),{code:'EEXIST'});assert.equal(await fs.readFile(target,'utf8'),'keep');await assert.rejects(store.begin(1,path.join(dir,'a.exe')),/webm/);
 const s=await store.begin(1,path.join(dir,'b.webm'));assert.throws(()=>store.append(1,s.id,new Uint8Array(3)),/размер/);assert.equal((await store.finish(1,s.id)).saved,false);
 }finally{await store.closeOwner(1);await fs.rm(dir,{recursive:true,force:true});}
});
test('disk failure is reported and the handle is still closed',async()=>{
 let closed=false;const store=new RecordingStore({open:async()=>({writeFile:async()=>{throw Error('ENOSPC');},sync:async()=>{},close:async()=>{closed=true;}})});
 const s=await store.begin(1,'a.webm');await assert.rejects(store.append(1,s.id,new Uint8Array([1])));const result=await store.finish(1,s.id);assert.equal(result.saved,false);assert.match(result.error,/частично/);assert.equal(closed,true);
});
test('session and queued-data limits are enforced and owner cleanup is isolated',async()=>{
 let release;const pending=new Promise(resolve=>release=resolve);const store=new RecordingStore({maxSessions:2,maxPendingBytes:2,open:async()=>({writeFile:()=>pending,sync:async()=>{},close:async()=>{}})});
 const a=await store.begin(1,'a.webm'),b=await store.begin(2,'b.webm');await assert.rejects(store.begin(3,'c.webm'),/четырёх/);
 const writing=store.append(1,a.id,new Uint8Array(2));assert.throws(()=>store.append(1,a.id,new Uint8Array([1])),/не успевает/);release();await writing;await store.closeOwner(1);assert.equal(store.sessions.has(b.id),true);await store.closeOwner(2);assert.equal(store.sessions.size,0);
});
test('suggested filename excludes path and Windows filename control characters',()=>{
 const name=recordingName('../FPV: "A"\\x',new Date('2026-10-22T10:00:00Z'));assert.equal(name.endsWith('.webm'),true);assert.doesNotMatch(name,/[<>:"/\\|?*\x00-\x1f]/);assert.equal(name.startsWith('USC_'),true);
});
