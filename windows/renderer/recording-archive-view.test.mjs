import {test} from 'node:test';import assert from 'node:assert/strict';import {filterRecordings,formatBytes} from './recording-archive-view.mjs';
test('archive search handles Cyrillic labels, filename, date and empty search',()=>{
 const rows=[{label:'Пульт Альфа',filePath:'C:/Videos/alpha.webm',createdAt:'2026-10-22T10:00:00Z'},{label:'Бета',filePath:'D:/Beta.webm',createdAt:'2025-01-01T00:00:00Z'}];assert.equal(filterRecordings(rows,' АЛЬФА ').length,1);assert.equal(filterRecordings(rows,'beta.webm')[0].label,'Бета');assert.equal(filterRecordings(rows,'2026').length,1);assert.equal(filterRecordings(rows,'').length,2);assert.equal(filterRecordings(rows,'missing').length,0);
});
test('archive sizes format safely without loading video content',()=>{assert.equal(formatBytes(0),'0 Б');assert.equal(formatBytes(1024),'1.0 КБ');assert.equal(formatBytes(1024**2),'1.0 МБ');assert.equal(formatBytes(NaN),'—');});
