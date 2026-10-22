const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {EventLog,LIMIT}=require('./event-log.cjs');
function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'usc-events-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return {dir,file:path.join(dir,'event-log.json')};}
test('events survive restart and export only approved fields, never raw extra data',t=>{
 const {dir,file}=setup(t);const log=new EventLog(file);log.append('stream-started','Пульт А');log.append('frames-stalled','Пульт Б');
 const reload=new EventLog(file);assert.deepEqual(reload.list(),log.list());assert.equal(reload.list()[0].kind,'frames-stalled');
 const out=path.join(dir,'out.json');assert.equal(reload.export(out).count,2);assert.deepEqual(JSON.parse(fs.readFileSync(out)).events,log.list());assert.throws(()=>reload.export(out),{code:'EEXIST'});
 assert.throws(()=>log.append('raw-error','secret'));assert.throws(()=>log.append('constructor','secret'));assert.throws(()=>log.append('stream-started',{}));
 assert.deepEqual(Object.keys(log.list()[0]).sort(),['at','id','kind','label','message']);
});
test('journal redacts connection codes and WireGuard-shaped keys from labels',t=>{
 const {file}=setup(t);const log=new EventLog(file);log.append('stream-started','Пульт USCV1.abc123 STRM_abcdef '+ 'A'.repeat(43)+'= eyJhbGci.abc.def\n');
 const contents=fs.readFileSync(file,'utf8');assert.ok(!contents.includes('USCV1.'));assert.ok(!contents.includes('STRM_'));assert.ok(!contents.includes('A'.repeat(43)));assert.ok(!contents.includes('eyJhbGci'));
});
test('bounded history rotates oldest events and preserves a damaged file',t=>{
 const {file}=setup(t);const seed=Array.from({length:LIMIT},(_,i)=>({id:String(i),kind:'stream-started',label:'Пульт',at:'2026-10-22T10:00:00Z'}));fs.writeFileSync(file,JSON.stringify(seed));
 const log=new EventLog(file);log.append('frames-stalled','Последний');assert.equal(log.list().length,LIMIT);assert.equal(log.list().at(-1).id,'1');
 fs.writeFileSync(file,'damaged');assert.throws(()=>new EventLog(file),/Исходный файл сохранён/);assert.equal(fs.readFileSync(file,'utf8'),'damaged');
});
test('disk write failure leaves in-memory history intact',t=>{
 const {dir}=setup(t);const log=new EventLog(path.join(dir,'missing','events.json'));fs.writeFileSync(path.join(dir,'missing'),'not a directory');assert.throws(()=>log.append('stream-started','Пульт'));assert.deepEqual(log.list(),[]);
});
