const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {RecordingArchive,parseRange,handleArchiveProtocol}=require('./recording-archive.cjs');
async function fixture(run){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'usc-archive-test-'));try{await run(dir,new RecordingArchive(path.join(dir,'index.json')));}finally{await fs.rm(dir,{recursive:true,force:true});}}
async function video(dir,name='a.webm'){const file=path.join(dir,name);await fs.writeFile(file,Buffer.from('1a45dfa300010203040506070809','hex'));return file;}
test('archive persists and duplicate imports keep the same ID',()=>fixture(async(dir,archive)=>{
 const filePath=await video(dir);const first=await archive.add({saved:true,filePath,label:'Пульт А',startedAt:'2026-10-22T10:00:00Z'});await archive.importFiles([filePath]);const rows=await archive.list();assert.equal(rows.length,1);assert.equal(rows[0].id,first.id);
 const restored=new RecordingArchive(path.join(dir,'index.json'));assert.equal((await restored.list())[0].available,true);assert.equal((await restored.list())[0].label,'Пульт А');
}));
test('parallel registrations do not overwrite other metadata',()=>fixture(async(dir,archive)=>{
 const files=await Promise.all(Array.from({length:8},(_,i)=>video(dir,`${i}.webm`)));await Promise.all(files.map(filePath=>archive.add({saved:true,filePath})));assert.equal((await archive.list()).length,8);assert.equal(JSON.parse(await fs.readFile(path.join(dir,'index.json'),'utf8')).records.length,8);
}));
test('missing file remains visible, forgetting it only changes the index',()=>fixture(async(dir,archive)=>{
 const a=await archive.add({saved:true,filePath:await video(dir,'a.webm')});const b=await archive.add({saved:true,filePath:await video(dir,'b.webm')});await fs.unlink(a.filePath);assert.equal((await archive.list()).find(x=>x.id===a.id).available,false);await assert.rejects(archive.playback(a.id));await archive.forget(b.id);assert.ok(await fs.stat(b.filePath));assert.equal((await archive.list()).length,1);
}));
test('corrupt index is preserved instead of silently replaced',()=>fixture(async(dir)=>{
 const index=path.join(dir,'bad.json');await fs.writeFile(index,'{broken');const archive=new RecordingArchive(index);await assert.rejects(archive.add({saved:true,filePath:await video(dir)}),/список записей/);assert.equal(await fs.readFile(index,'utf8'),'{broken');
}));
test('non-WebM files and changed file contents cannot be played',()=>fixture(async(dir,archive)=>{
 const filePath=await video(dir);const entry=await archive.add({saved:true,filePath});await fs.writeFile(filePath,'MZ executable');await assert.rejects(archive.playback(entry.id));await assert.rejects(archive.response(entry.id,null));await assert.rejects(archive.add({saved:true,filePath:path.join(dir,'a.exe')}));await assert.rejects(archive.playback(crypto.randomUUID()));
}));
test('range streaming supports partial reads, suffixes, HEAD and invalid ranges',()=>fixture(async(dir,archive)=>{
 const entry=await archive.add({saved:true,filePath:await video(dir)});const response=await archive.response(entry.id,'bytes=4-7');assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),'bytes 4-7/14');assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[0,1,2,3]);
 const suffix=await archive.response(entry.id,'bytes=-2');assert.deepEqual([...new Uint8Array(await suffix.arrayBuffer())],[8,9]);const head=await archive.response(entry.id,null,'HEAD');assert.equal(head.body,null);assert.equal(head.headers.get('content-length'),'14');assert.equal((await archive.response(entry.id,'bytes=99-100')).status,416);
 for(const value of ['bytes=','bytes=-0','bytes=1-0','bytes=0-1,3-4','bytes=x-y'])assert.equal(parseRange(value,13),null);
}));
test('custom protocol accepts known recording IDs only and rejects paths',()=>fixture(async(dir,archive)=>{
 const entry=await archive.add({saved:true,filePath:await video(dir)});let handler;handleArchiveProtocol({handle:(name,fn)=>handler=fn},()=>archive);
 assert.equal((await handler(new Request(`usc-recording://${entry.id}/`,{method:'HEAD'}))).status,200);assert.equal((await handler(new Request(`usc-recording://${entry.id}/secret`))).status,404);assert.equal((await handler(new Request('usc-recording://invalid/'))).status,404);assert.equal((await handler(new Request(`usc-recording://${entry.id}/`,{method:'POST'}))).status,405);
}));
