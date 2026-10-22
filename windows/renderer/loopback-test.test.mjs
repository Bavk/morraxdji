import test from 'node:test';
import assert from 'node:assert/strict';
import {LoopbackTest,createTestPattern} from './loopback-test.mjs';
const ID='selftest_0123456789abcdef0123';
function setup(){
 const calls=[];const timers=new Map();let num=0;
 const track={stop:()=>calls.push('track:stop')};
 const room={connect:async()=>calls.push('room:connect'),disconnect:()=>calls.push('room:disconnect'),
   localParticipant:{publishTrack:async(t,opts)=>{assert.equal(t,track);calls.push(`publish:${opts.source}`);}}};
 const testRig=new LoopbackTest({createRoom:()=>room,createPattern:()=>({track,stop:()=>calls.push('pattern:stop')}),
   screenShareSource:'screen_share',onStatus:message=>calls.push(message),
   onStateChange:active=>calls.push(`active:${active}`),
   setTimer:fn=>{timers.set(++num,fn);return num;},clearTimer:id=>timers.delete(id)});
 return {testRig,calls,timers};
}
test('publishes screen share test pattern and counts only matching received video frame',async()=>{
 const {testRig,calls,timers}=setup();
 await testRig.start({identity:ID,wsUrl:'ws://127.0.0.1:7880',token:'stub'});
 assert.equal(testRig.active,true);
 assert.ok(calls.includes('publish:screen_share'));
 assert.equal(testRig.onVideoFrame('operator_other'),false);
 assert.equal(testRig.onVideoFrame(ID),true);
 assert.equal(testRig.onVideoFrame(ID),false);
 assert.equal(testRig.received,true);
 assert.equal(timers.size,1);
 const [id,fn]=[...timers.entries()][0];fn();timers.delete(id);
 assert.equal(testRig.active,false);
 assert.ok(calls.includes('pattern:stop'));
 assert.ok(calls.includes('room:disconnect'));
 assert.ok(calls.some(x=>x.includes('Тест завершён')));
});
test('missing video frame times out with diagnostic rather than false success',async()=>{
 const {testRig,calls,timers}=setup();
 await testRig.start({identity:ID,wsUrl:'ws://localhost:7880',token:'stub'});
 [...timers.values()][0]();
 assert.equal(testRig.active,false);
 assert.ok(calls.some(x=>x.includes('Не получен видеокадр')));
 assert.equal(testRig.onVideoFrame(ID),false);
});
test('invalid or duplicate runs are rejected',async()=>{
 const {testRig}=setup();
 await assert.rejects(testRig.start({identity:'invalid',token:'stub',wsUrl:'ws://localhost:7880'}));
 await testRig.start({identity:ID,token:'stub',wsUrl:'ws://localhost:7880'});
 await assert.rejects(testRig.start({identity:ID,token:'stub',wsUrl:'ws://localhost:7880'}),/уже запущена/);
 testRig.stop();
});
test('canvas generator draws moving frames, cleans timer and stops capture track',()=>{
 const drawn=[];let timerFn=null;let cleared=false;let stopped=false;
 const fake={createElement:()=>({width:0,height:0,getContext:()=>({
   fillRect:()=>drawn.push('rect'),fillText:()=>drawn.push('text'),set fillStyle(v){},set font(v){}
 }),captureStream:fps=>({getVideoTracks:()=>[{stop:()=>{stopped=true;}}],getTracks:()=>[{stop:()=>{stopped=true;}}]})})};
 const pattern=createTestPattern({documentObject:fake,setIntervalFn:fn=>{timerFn=fn;return 42;},clearIntervalFn:x=>{assert.equal(x,42);cleared=true;}});
 assert.ok(drawn.includes('text'));timerFn();pattern.stop();assert.equal(stopped,true);assert.equal(cleared,true);
});
test('early viewer frame does not get overwritten by late publish acknowledgement',async()=>{
 let signalPublished;
 const pending=new Promise(resolve=>{signalPublished=resolve;});
 const statuses=[];const timers=new Map();let next=0;
 const rig=new LoopbackTest({createRoom:()=>({connect:async()=>{},disconnect:()=>{},localParticipant:{publishTrack:()=>pending}}),
  createPattern:()=>({track:{},stop:()=>{}}),screenShareSource:'screen_share',onStatus:x=>statuses.push(x),
  setTimer:fn=>{timers.set(++next,fn);return next;},clearTimer:id=>timers.delete(id)});
 const p=rig.start({identity:ID,wsUrl:'ws://localhost:7880',token:'stub'});
 await Promise.resolve();await Promise.resolve();
 assert.equal(rig.onVideoFrame(ID),true);
 signalPublished();await p;
 assert.equal(timers.size,1);
 assert.ok(statuses.some(s=>s.startsWith('✓ Видеопоток')));
 assert.equal(statuses.some(s=>s.startsWith('Тест передаётся')),false);
 rig.stop(true);
});
