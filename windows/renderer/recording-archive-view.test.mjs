import {test} from 'node:test';import assert from 'node:assert/strict';import {filterRecordings,formatBytes,selectRecordings} from './recording-archive-view.mjs';
test('archive search handles Cyrillic labels, filename, date and empty search',()=>{
 const rows=[{label:'Пульт Альфа',filePath:'C:/Videos/alpha.webm',createdAt:'2026-10-22T10:00:00Z'},{label:'Бета',filePath:'D:/Beta.webm',createdAt:'2025-01-01T00:00:00Z'}];assert.equal(filterRecordings(rows,' АЛЬФА ').length,1);assert.equal(filterRecordings(rows,'beta.webm')[0].label,'Бета');assert.equal(filterRecordings(rows,'2026').length,1);assert.equal(filterRecordings(rows,'').length,2);assert.equal(filterRecordings(rows,'missing').length,0);
});
test('archive sizes format safely without loading video content',()=>{assert.equal(formatBytes(0),'0 Б');assert.equal(formatBytes(1024),'1.0 КБ');assert.equal(formatBytes(1024**2),'1.0 МБ');assert.equal(formatBytes(NaN),'—');});

const records=[{id:'a',label:'Пульт 10',createdAt:'2026-01-02',bytes:20,available:true},{id:'b',label:'Пульт 2',createdAt:'2026-01-01',bytes:40,available:false},{id:'c',label:'Другой',createdAt:'2026-01-03',bytes:10,available:true}];
const ids=rows=>rows.map(row=>row.id);
test('archive sorting supports date, natural controller name and size without mutating source',()=>{
 assert.deepEqual(ids(selectRecordings(records)),['c','a','b']);
 assert.deepEqual(ids(selectRecordings(records,{sort:'oldest'})),['b','a','c']);
 assert.deepEqual(ids(selectRecordings(records,{sort:'name'})),['c','b','a']);
 assert.deepEqual(ids(selectRecordings(records,{sort:'size'})),['b','a','c']);
 assert.deepEqual(ids(records),['a','b','c']);
});
test('archive combines availability, search and sorting',()=>{
 assert.deepEqual(ids(selectRecordings(records,{query:'ПУЛЬТ',availability:'missing',sort:'size'})),['b']);
 assert.deepEqual(ids(selectRecordings(records,{availability:'available'})),['c','a']);
 assert.deepEqual(selectRecordings(records,{query:'Другой',availability:'missing'}),[]);
});
test('archive sorting has deterministic ties and tolerates invalid metadata',()=>{
 const rows=[{id:'b',createdAt:'invalid',bytes:NaN},{id:'a',createdAt:null,bytes:undefined}];
 assert.deepEqual(ids(selectRecordings(rows,{sort:'size'})),['a','b']);
 assert.deepEqual(ids(selectRecordings(rows,{sort:'unknown'})),['a','b']);
});
