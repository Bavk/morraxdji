import test from 'node:test';
import assert from 'node:assert/strict';
import { ViewerReconnect, retryDelay } from './viewer-reconnect.mjs';

test('retry uses capped exponential backoff',()=>{
  assert.deepEqual([0,1,2,3,4,5,10].map(retryDelay),[1000,2000,4000,8000,15000,15000,15000]);
  assert.throws(()=>retryDelay(-1),RangeError);
});
test('schedules only one retry per disconnect and carries selected room',()=>{
  const tasks=new Map();let id=0;const seen=[];let waiting=[];
  const retry=new ViewerReconnect({onRetry: room=>seen.push(room),onWaiting:(_,ms)=>waiting.push(ms),
    setTimer:fn=>{const key=++id;tasks.set(key,fn);return key;},clearTimer:key=>tasks.delete(key)});
  assert.equal(retry.failure('room-a'),true);
  assert.equal(retry.failure('room-a'),false);
  assert.equal(tasks.size,1);
  tasks.get(1)();tasks.delete(1);
  assert.deepEqual(seen,['room-a']);
  assert.equal(retry.failure('room-a'),true);
  assert.deepEqual(waiting,[1000,2000]);
});
test('room switch cancels scheduled reconnection',()=>{
  const tasks=new Map(); let next=0;const called=[];
  const retry=new ViewerReconnect({onRetry: room=>called.push(room),setTimer:fn=>{tasks.set(++next,fn);return next;},clearTimer:id=>tasks.delete(id)});
  retry.failure('old');const pending=tasks.get(1);
  retry.stop();pending();
  assert.deepEqual(called,[]);
  retry.failure('new');tasks.get(2)();
  assert.deepEqual(called,['new']);
  assert.equal(retry.attempt,1);
  retry.success();assert.equal(retry.attempt,0);
});
