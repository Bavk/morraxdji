const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {SnapshotStore,validatePng,snapshotName,MAX_PNG_BYTES}=require('./snapshot-store.cjs');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j00sAAAAASUVORK5CYII=','base64');
test('PNG is saved byte-for-byte and existing files cannot be overwritten',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'usc-frame-test-'));try{
  const target=path.join(dir,'frame.png'),store=new SnapshotStore();const result=await store.save(target,png);assert.equal(result.width,1);assert.equal(result.height,1);assert.deepEqual(await fs.readFile(target),png);
  await assert.rejects(store.save(target,png),{code:'EEXIST'});assert.deepEqual(await fs.readFile(target),png);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('invalid headers, payload sizes and excessive dimensions are rejected',()=>{
 assert.throws(()=>validatePng(new Uint8Array(32)));assert.throws(()=>validatePng(new Uint8Array(MAX_PNG_BYTES+1)),/размер/);assert.throws(()=>validatePng(new Uint8Array(40)),/PNG/);
 const bad=Buffer.from(png);bad.writeUInt32BE(8193,16);assert.throws(()=>validatePng(bad),/большой/);bad.writeUInt32BE(8192,16);bad.writeUInt32BE(8192,20);assert.throws(()=>validatePng(bad),/мегапикселей/);
});
test('decoder failure or wrong extension prevents creating a file',async()=>{
 let opened=false;const store=new SnapshotStore({open:async()=>{opened=true;},decode:()=>{throw Error('invalid image');}});await assert.rejects(store.save('frame.png',png),/invalid/);assert.equal(opened,false);await assert.rejects(store.save('frame.exe',png),/png/);
});
test('disk failure closes the handle and is not reported as a saved snapshot',async()=>{
 let closed=false;const store=new SnapshotStore({open:async()=>({writeFile:async()=>{throw Error('ENOSPC');},close:async()=>{closed=true;}})});await assert.rejects(store.save('frame.png',png),/ENOSPC/);assert.equal(closed,true);
});
test('snapshot filenames use a distinct prefix and sanitize controller names',()=>{
 const name=snapshotName('../FPV: "A"\\x',new Date('2026-10-22T10:00:00Z'));assert.equal(name.startsWith('USC_frame_'),true);assert.equal(name.endsWith('.png'),true);assert.doesNotMatch(name,/[<>:"/\\|?*\x00-\x1f]/);
});
