import {test} from 'node:test';import assert from 'node:assert/strict';
import {frameTransition,filterEvents} from './event-log-view.mjs';
test('frame journal reports transitions once and ignores hidden and waiting samples',()=>{
 let previous;const emitted=[];for(const state of ['waiting','live','stale','stale','paused','paused','stale','live','live']){const event=frameTransition(previous,state);if(event)emitted.push(event);if(['live','stale'].includes(state))previous=state;}
 assert.deepEqual(emitted,['frames-stalled','frames-restored']);assert.equal(frameTransition('live','paused'),null);
});
test('event search matches source and event case insensitively',()=>{const rows=[{label:'Пульт А',message:'Нет новых кадров',at:'2026-10-22T10:00:00Z'},{label:'Пульт Б',message:'Кадры снова поступают',at:'2026-10-22T11:00:00Z'}];assert.deepEqual(filterEvents(rows,' пУЛЬт а '),[rows[0]]);assert.deepEqual(filterEvents(rows,'снова'),[rows[1]]);assert.deepEqual(filterEvents(rows,'нет совпадения'),[]);});
