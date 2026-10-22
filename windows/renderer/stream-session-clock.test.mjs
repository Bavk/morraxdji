import {test} from 'node:test';import assert from 'node:assert/strict';import {StreamSessionClock,formatSessionDuration} from './stream-session-clock.mjs';
const receiving={hasFrame:true,receiving:true},paused={hasFrame:true,receiving:false};
test('observation starts at the first decoded frame rather than subscription',()=>{
 const clock=new StreamSessionClock();assert.equal(clock.update({hasFrame:false,receiving:true},0),null);assert.equal(clock.update({hasFrame:false,receiving:true},5000),null);assert.deepEqual(clock.update(receiving,6000),{elapsedMs:0,receiveMs:0});assert.deepEqual(clock.update(receiving,7000),{elapsedMs:1000,receiveMs:1000});
});
test('pause preserves total observation time while receive estimate stops and resumes',()=>{
 const clock=new StreamSessionClock();clock.update(receiving,0);clock.update(receiving,1000);clock.update(paused,2000);clock.update(paused,3000);clock.update(receiving,4000);assert.deepEqual(clock.update(receiving,5000),{elapsedMs:5000,receiveMs:2000});
});
test('long monitoring gaps never invent continuously received video',()=>{
 const clock=new StreamSessionClock();clock.update(receiving,0);clock.update(receiving,1000);assert.deepEqual(clock.update(receiving,60000),{elapsedMs:60000,receiveMs:1000});assert.deepEqual(clock.update(receiving,61000),{elapsedMs:61000,receiveMs:2000});
});
test('hidden recordings continue receiving, while adaptive pause or disconnection uses paused state',()=>{
 const clock=new StreamSessionClock();clock.update(receiving,0);clock.update(receiving,1000);clock.update(receiving,2000);clock.update(paused,3000);assert.deepEqual(clock.update(paused,4000),{elapsedMs:4000,receiveMs:2000});
});
test('a new track starts a new session; elapsed and receive values never go backwards',()=>{
 const clock=new StreamSessionClock();clock.update(receiving,1000);const a=clock.update(receiving,2000);const b=clock.update(receiving,1500);assert.deepEqual(b,a);assert.deepEqual(clock.update(receiving,3000),{elapsedMs:2000,receiveMs:2000});assert.deepEqual(new StreamSessionClock().update(receiving,5000),{elapsedMs:0,receiveMs:0});assert.throws(()=>clock.update(receiving,NaN));
});
test('duration format supports seconds, hours and multi-day sessions safely',()=>{
 assert.equal(formatSessionDuration(0),'00:00');assert.equal(formatSessionDuration(61000),'01:01');assert.equal(formatSessionDuration(3600000),'01:00:00');assert.equal(formatSessionDuration(90061000),'25:01:01');assert.equal(formatSessionDuration(-1),'00:00');assert.equal(formatSessionDuration(NaN),'00:00');
});
