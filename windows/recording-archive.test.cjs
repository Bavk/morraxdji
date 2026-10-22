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

test('recording title and notes persist, preserve file and playback ID, and survive reimport',()=>fixture(async(dir,archive)=>{
 const filePath=await video(dir),before=await fs.readFile(filePath),row=await archive.add({saved:true,filePath,label:'Пульт А'});
 const result=await archive.updateMetadata(row.id,{label:'  Проверка связи  ',note:'  02:15 — смена канала\nПроверить антенну  ',filePath:'ignored.webm'});
 assert.deepEqual(result,{id:row.id,label:'Проверка связи',note:'02:15 — смена канала\nПроверить антенну'});
 const restored=new RecordingArchive(path.join(dir,'index.json'));let saved=await restored.get(row.id);assert.equal(saved.filePath,filePath);assert.equal(saved.createdAt,row.createdAt);assert.equal(saved.bytes,row.bytes);assert.deepEqual(await fs.readFile(filePath),before);
 await restored.importFiles([filePath]);saved=(await restored.list())[0];assert.equal(saved.label,result.label);assert.equal(saved.note,result.note);assert.equal(saved.id,row.id);assert.equal((await restored.playback(row.id)).url,`usc-recording://${row.id}/`);
}));
test('old archives without notes still load and missing files can be annotated',()=>fixture(async(dir,archive)=>{
 const row=await archive.add({saved:true,filePath:await video(dir),label:'Старое видео'});const old={...row};delete old.note;await fs.writeFile(path.join(dir,'index.json'),JSON.stringify({version:1,records:[old]}));await fs.unlink(row.filePath);
 const restored=new RecordingArchive(path.join(dir,'index.json'));assert.equal((await restored.get(row.id)).note,'');await restored.updateMetadata(row.id,{label:'Найти файл',note:'Перенесён на внешний диск'});assert.equal((await restored.list())[0].available,false);
}));
test('invalid metadata or unknown recording cannot change the index',()=>fixture(async(dir,archive)=>{
 const row=await archive.add({saved:true,filePath:await video(dir)}),before=await fs.readFile(path.join(dir,'index.json'),'utf8');
 for(const data of [null,{}, {label:' ',note:''},{label:'x'.repeat(301),note:''},{label:'bad\nline',note:''},{label:'ok',note:3},{label:'ok',note:'x'.repeat(2001)},{label:'ok',note:'bad\0text'}])await assert.rejects(archive.updateMetadata(row.id,data));
 await assert.rejects(archive.updateMetadata(crypto.randomUUID(),{label:'x',note:''}));await assert.rejects(archive.updateMetadata('../file',{label:'x',note:''}));assert.equal(await fs.readFile(path.join(dir,'index.json'),'utf8'),before);
 await archive.updateMetadata(row.id,{label:'x'.repeat(300),note:'y'.repeat(2000)});assert.equal((await archive.get(row.id)).note.length,2000);
}));
test('serialized edits preserve concurrent registrations and never resurrect removed recordings',()=>fixture(async(dir,archive)=>{
 const row=await archive.add({saved:true,filePath:await video(dir,'a.webm')}),second=await video(dir,'b.webm');
 await Promise.all([archive.updateMetadata(row.id,{label:'Новое',note:'Заметка'}),archive.add({saved:true,filePath:second})]);assert.equal((await archive.list()).length,2);assert.equal((await archive.get(row.id)).note,'Заметка');
 await archive.forget(row.id);await assert.rejects(archive.updateMetadata(row.id,{label:'Вернуть',note:''}));assert.equal((await archive.list()).length,1);
}));
test('oversized metadata index is rejected before replacing the readable index',()=>fixture(async(dir,archive)=>{
 const row=await archive.add({saved:true,filePath:await video(dir)}),before=await fs.readFile(path.join(dir,'index.json'),'utf8');
 await assert.rejects(archive.mutate(()=>Array.from({length:5000},()=>({...row,note:'x'.repeat(2000)}))),/8 МиБ/);assert.equal(await fs.readFile(path.join(dir,'index.json'),'utf8'),before);assert.equal((await archive.list()).length,1);
}));

test('relink moved video preserves ID, labels, notes, date and file bytes across archive reload',()=>fixture(async(dir,archive)=>{
 const oldPath=await video(dir,'old.webm'),row=await archive.add({saved:true,filePath:oldPath,label:'Пульт А',startedAt:'2026-10-22T10:00:00Z'});await archive.updateMetadata(row.id,{label:'Тренировка',note:'02:15 — связь'});const moved=path.join(dir,'moved.webm');await fs.rename(oldPath,moved);const before=await fs.readFile(moved);
 assert.equal((await archive.list())[0].available,false);await archive.relink(row.id,moved);const restored=new RecordingArchive(path.join(dir,'index.json')),saved=(await restored.list())[0];assert.equal(saved.id,row.id);assert.equal(saved.label,'Тренировка');assert.equal(saved.note,'02:15 — связь');assert.equal(saved.createdAt,row.createdAt);assert.equal(saved.filePath,moved);assert.equal(saved.available,true);assert.equal(saved.bytes,before.length);assert.deepEqual(await fs.readFile(moved),before);await assert.rejects(fs.stat(oldPath));assert.equal((await restored.playback(row.id)).url,`usc-recording://${row.id}/`);assert.deepEqual(Buffer.from(await (await restored.response(row.id,null)).arrayBuffer()),before);
}));
test('relink validates file type and header without replacing the previous archive entry',()=>fixture(async(dir,archive)=>{
 const row=await archive.add({saved:true,filePath:await video(dir)}),before=await fs.readFile(path.join(dir,'index.json'),'utf8');const wrong=path.join(dir,'wrong.webm');await fs.writeFile(wrong,'Not WebM');
 for(const selected of [wrong,path.join(dir,'missing.webm'),path.join(dir,'video.exe'),'relative.webm',null])await assert.rejects(archive.relink(row.id,selected));
 await assert.rejects(archive.relink(crypto.randomUUID(),row.filePath));assert.equal(await fs.readFile(path.join(dir,'index.json'),'utf8'),before);assert.equal((await archive.get(row.id)).filePath,row.filePath);
}));
test('relink refuses a file already associated with another archive entry',()=>fixture(async(dir,archive)=>{
 const a=await archive.add({saved:true,filePath:await video(dir,'a.webm')}),b=await archive.add({saved:true,filePath:await video(dir,'b.webm')});const before=await fs.readFile(path.join(dir,'index.json'),'utf8');await assert.rejects(archive.relink(a.id,b.filePath),/уже связан/);assert.equal(await fs.readFile(path.join(dir,'index.json'),'utf8'),before);assert.equal((await archive.list()).length,2);
}));
test('concurrent relinks cannot bind two entries to the same file',()=>fixture(async(dir,archive)=>{
 const a=await archive.add({saved:true,filePath:await video(dir,'a.webm')}),b=await archive.add({saved:true,filePath:await video(dir,'b.webm')}),target=await video(dir,'new.webm');
 const results=await Promise.allSettled([archive.relink(a.id,target),archive.relink(b.id,target)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await archive.list()).filter(r=>r.filePath===target).length,1);assert.equal((await archive.list()).length,2);
}));
test('relink preserves simultaneous metadata edits and cannot restore forgotten entries',()=>fixture(async(dir,archive)=>{
 const row=await archive.add({saved:true,filePath:await video(dir,'a.webm')}),target=await video(dir,'new.webm');await Promise.all([archive.relink(row.id,target),archive.updateMetadata(row.id,{label:'Обновлённое',note:'Заметка'})]);assert.equal((await archive.get(row.id)).label,'Обновлённое');assert.equal((await archive.get(row.id)).note,'Заметка');assert.equal((await archive.get(row.id)).filePath,target);await archive.forget(row.id);await assert.rejects(archive.relink(row.id,target));assert.equal((await archive.list()).length,0);assert.ok(await fs.stat(target));
}));
test('failed index replacement keeps the old association and selected video intact',()=>fixture(async(dir,archive)=>{
 const row=await archive.add({saved:true,filePath:await video(dir,'a.webm')}),target=await video(dir,'new.webm'),before=await fs.readFile(target),index=archive.indexPath;const blocked=path.join(dir,'blocked-index');await fs.mkdir(blocked);archive.indexPath=blocked;
 await assert.rejects(archive.relink(row.id,target));archive.indexPath=index;assert.equal((await archive.get(row.id)).filePath,row.filePath);assert.deepEqual(await fs.readFile(target),before);assert.equal(JSON.parse(await fs.readFile(index,'utf8')).records[0].filePath,row.filePath);
}));
