import {test} from 'node:test';
import assert from 'node:assert/strict';
import {StreamHealth,readVideoStats,formatHealth,monitorStream} from './stream-health.mjs';
const report=(bytes,packets,lost)=>new Map([['in',{type:'inbound-rtp',kind:'video',bytesReceived:bytes,packetsReceived:packets,packetsLost:lost}],['pair',{type:'candidate-pair',state:'succeeded',nominated:true,currentRoundTripTime:.025}]]);
test('rates use counter differences, not totals, with real sample duration',()=>{
 const h=new StreamHealth();h.sample({frames:10,report:report(100,10,1)},0);
 const sample=h.sample({frames:40,width:1280,height:720,report:report(300100,108,3)},2000);
 assert.equal(sample.fps,15);assert.equal(sample.mbps,1.2);assert.equal(sample.loss,2);assert.equal(sample.rttMs,25);assert.equal(sample.state,'live');assert.match(formatHealth(sample),/1280×720/);
});
test('stale video and missing first frame are detected; fresh frame clears warning',()=>{
 const h=new StreamHealth();assert.equal(h.sample({frames:0},0).state,'waiting');assert.equal(h.sample({frames:0},4000).state,'stale');assert.equal(h.sample({frames:1},5000).state,'live');assert.equal(h.sample({frames:1},9000).state,'stale');assert.equal(h.sample({frames:2},10000).state,'live');
});
test('hidden adaptive streams reset baseline and get a fresh grace interval when visible',()=>{
 const h=new StreamHealth();h.sample({frames:10},0);assert.equal(h.sample({frames:10,active:false},10000).state,'paused');assert.equal(h.sample({frames:10},20000).state,'live');assert.equal(h.sample({frames:10},23999).state,'live');assert.equal(h.sample({frames:10},24000).state,'stale');
});
test('missing stats, first sample, clock stall and reset counters never produce invented rates',()=>{
 const h=new StreamHealth();const a=h.sample({frames:100,report:report(1000,100,10)},0);assert.equal(a.mbps,null);
 const b=h.sample({frames:2,report:report(10,1,-1)},1000);assert.equal(b.fps,null);assert.equal(b.mbps,null);assert.equal(b.loss,null);
 const c=h.sample({frames:3,report:null},1000);assert.equal(c.fps,null);assert.equal(c.rttMs,null);assert.equal(c.loss,null);
 assert.deepEqual(readVideoStats(null),{bytes:null,packets:null,lost:null,decoded:null,rttMs:null});
});
test('stats parser ignores audio and unselected candidate pairs',()=>{
 const result=readVideoStats(new Map([['a',{type:'inbound-rtp',kind:'audio',bytesReceived:500}],['p',{type:'candidate-pair',state:'succeeded',currentRoundTripTime:1}]]));assert.equal(result.bytes,null);assert.equal(result.rttMs,null);
});
test('stopped monitor discards a pending stats response and schedules no timer',async()=>{
 let resolveReport,updates=0,timers=0;const pending=new Promise(r=>resolveReport=r);
 const stop=monitorStream({track:{getRTCStatsReport:()=>pending},video:{},onUpdate:()=>updates++,setTimer:()=>timers++});stop();resolveReport(null);await pending;await Promise.resolve();assert.equal(updates,0);assert.equal(timers,0);
});

test('hidden recording health uses decoded frames when presentation counter does not advance',async()=>{
 let decoded=10,time=0,tick;const samples=[];const stop=monitorStream({track:{getRTCStatsReport:async()=>new Map([['video',{type:'inbound-rtp',kind:'video',framesDecoded:decoded}]])},video:{getVideoPlaybackQuality:()=>({totalVideoFrames:1})},onUpdate:s=>samples.push(s),now:()=>time,setTimer:callback=>{tick=callback;return 1;},clearTimer:()=>{}});
 await new Promise(resolve=>setTimeout(resolve,0));decoded=60;time=5000;await tick();stop();assert.equal(samples.at(-1).state,'live');assert.equal(samples.at(-1).fps,10);
});
