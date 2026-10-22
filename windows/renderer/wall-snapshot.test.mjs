import {test} from 'node:test';import assert from 'node:assert/strict';import {captureWallSnapshot,wallSnapshotLayout,wallSnapshotSources} from './wall-snapshot.mjs';
const video=(width=640,height=360)=>({videoWidth:width,videoHeight:height,readyState:2});
function fixture({blob=new Blob([new Uint8Array([1,2,3])]),context=true}={}){
 const draws=[],texts=[],fills=[];const ctx={drawImage:(...args)=>draws.push(args),fillRect:(...args)=>fills.push(args),fillText:(...args)=>texts.push(args),measureText:text=>({width:Array.from(text).length*10})};
 const canvas={width:0,height:0,getContext:()=>context?ctx:null,toBlob:callback=>callback(blob)};return {draws,texts,fills,canvas,documentObject:{createElement:()=>canvas}};
}
test('all supported wall layouts stay within PNG limits and keep cells inside image',()=>{
 for(let count=1;count<=16;count++)for(let columns=0;columns<=4;columns++){
  const plan=wallSnapshotLayout(count,columns);assert.ok(plan.width<=8192&&plan.height<=8192&&plan.width*plan.height<=16*1024*1024);assert.equal(plan.cells.length,count);
  for(const cell of plan.cells){assert.ok(cell.x>=0&&cell.y>=80&&cell.x+cell.width<=plan.width&&cell.y+cell.height<=plan.height);}
 }
 assert.equal(wallSnapshotLayout(2).columns,2);assert.equal(wallSnapshotLayout(3,1).columns,1);assert.equal(wallSnapshotLayout(2,4).columns,2);
});
test('empty or oversized walls fail before allocating canvas rather than silently dropping sources',async()=>{
 const documentObject={createElement:()=>{throw Error('must not allocate')}};await assert.rejects(captureWallSnapshot([],{documentObject}),/Нет видимых/);await assert.rejects(captureWallSnapshot(Array(17).fill({}),{documentObject}),/16/);
});
test('wall snapshot respects visibility and saved order without mutating entries',()=>{
 const source=(label,hidden,order)=>({label,item:{hidden,style:{order}}});const entries=[source('B',false,'2'),source('hidden',true,'0'),source('A',false,'1')];
 assert.deepEqual(wallSnapshotSources(entries).map(s=>s.label),['A','B']);assert.equal(entries[0].label,'B');assert.equal(entries.length,3);
});
test('composite preserves aspect ratio of portrait and wide video and labels statuses and capture time',async()=>{
 const f=fixture();const portrait=video(360,640),wide=video(1280,360),date=new Date('2026-10-22T10:00:00Z');
 const result=await captureWallSnapshot([{video:portrait,label:'Пульт А',state:'live',status:'LIVE'},{video:wide,label:'Пульт Б',state:'stale',status:'Нет новых кадров'}],{...f,capturedAt:date});
 assert.equal(result.count,2);assert.equal(result.width,1324);assert.equal(result.height,512);assert.deepEqual(f.draws[0],[portrait,234.75,136,202.5,360]);assert.deepEqual(f.draws[1],[wide,668,226,640,180]);assert.ok(f.texts.some(t=>t[0]==='Пульт А'));assert.ok(f.texts.some(t=>t[0]==='Нет новых кадров'));assert.ok(f.texts.some(t=>t[0].includes(date.toLocaleString('ru-RU'))));assert.equal(f.canvas.width,0);assert.deepEqual([...result.png],[1,2,3]);
});
test('missing video gets a placeholder, paused last frame remains explicitly labelled',async()=>{
 const f=fixture();await captureWallSnapshot([{video:video(0,0),label:'Нет видео',status:'Ожидание кадров'},{video:video(),label:'Пульт',state:'paused',status:'Приём приостановлен'}],f);
 assert.equal(f.draws.length,1);assert.ok(f.texts.some(t=>t[0]==='Нет доступного кадра'));assert.ok(f.texts.some(t=>t[0]==='Приём приостановлен'));
});
test('long labels are shortened within a cell and drawn as plain text',async()=>{
 const f=fixture();await captureWallSnapshot([{video:video(),label:'<b>'+('Пульт'.repeat(100))+'</b>',status:'LIVE'}],f);const label=f.texts.find(t=>t[0].startsWith('<b>'))[0];assert.ok(label.endsWith('…'));assert.ok(label.length*10<=616);
});
test('canvas memory is released after missing context or PNG encoding failure',async()=>{
 for(const options of [{context:false},{blob:null}]){const f=fixture(options);await assert.rejects(captureWallSnapshot([{video:video(),label:'A',status:'LIVE'}],f));assert.equal(f.canvas.width,0);assert.equal(f.canvas.height,0);}
});
test('oversized encoded PNG is rejected and canvas released',async()=>{
 const f=fixture({blob:{size:32*1024*1024+1}});await assert.rejects(captureWallSnapshot([{video:video(),label:'A',status:'LIVE'}],f),/32 МБ/);assert.equal(f.canvas.width,0);
});
