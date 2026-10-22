import {test} from 'node:test';import assert from 'node:assert/strict';import {markerTime,noteWithMarker,parseMarkerLine,markerSeekTime} from './recording-markers.mjs';
test('marker time uses whole playback seconds and round-trips through notes',()=>{
 for(const seconds of [0,1,59,60,3599,3600,90061,3599999]){const code=markerTime(seconds+.1>3599999?seconds:seconds+.1);assert.equal(parseMarkerLine(code+' — событие').seconds,seconds);}
 assert.equal(markerTime(65.8),'01:05');assert.equal(markerTime(3661),'01:01:01');
});
test('marker draft preserves previous note and enforces existing limit without truncation',()=>{
 assert.equal(noteWithMarker('Проверка связи',125.9),'Проверка связи\n02:05 — ');assert.equal(noteWithMarker('',0),'00:00 — ');assert.equal(noteWithMarker('  ',1),'00:01 — ');
 assert.throws(()=>noteWithMarker('x'.repeat(2000),0),/нет места/);assert.throws(()=>noteWithMarker(null,0));for(const value of [-1,NaN,Infinity,3600000])assert.throws(()=>markerTime(value));
});
test('only valid timecodes at line start become navigation markers',()=>{
 assert.equal(parseMarkerLine('90:03 — старый формат').seconds,5403);assert.equal(parseMarkerLine('2:03:04').seconds,7384);
 for(const line of ['текст 02:15','02:99 — ошибка','1:2','02:15<script>','02:15:999','99999:59'])assert.equal(parseMarkerLine(line),null,line);
});
test('marker descriptions remain unchanged plain text',()=>{
 assert.deepEqual(parseMarkerLine('02:15 — <b>событие</b>'),{code:'02:15',seconds:135,tail:' — <b>событие</b>'});assert.equal(parseMarkerLine('Примечание <img>'),null);
});
test('seeking validates position and refuses known out-of-range markers',()=>{
 assert.equal(markerSeekTime(10,20),10);assert.equal(markerSeekTime(20,20),20);assert.equal(markerSeekTime(10,Infinity),10);assert.equal(markerSeekTime(10,NaN),10);assert.throws(()=>markerSeekTime(21,20),/за пределами/);for(const value of [-1,Infinity,NaN,3600000])assert.throws(()=>markerSeekTime(value,100));
});
