import {test} from 'node:test';import assert from 'node:assert/strict';import {StreamRecorder} from './stream-recorder.mjs';
test('unsupported WebM is reported before choosing a file or starting recording',async()=>{
 const states=[];const recorder=new StreamRecorder({api:{},track:{},supports:()=>false,onState:state=>states.push(state)});
 await assert.rejects(recorder.start('FPV'),/не поддерживается/);assert.equal(recorder.state,'done');assert.equal(states.at(-1),'error');
});
function setup(overrides={}){
 const calls=[],states=[];let clonedStopped=false;
 const clone={stop:()=>clonedStopped=true};const source={clone:()=>clone};
 const media={state:'inactive',start(){this.state='recording';},stop(){this.state='inactive';queueMicrotask(()=>{this.ondataavailable({data:new Blob(['last'])});this.onstop();});}};
 const api={beginRecording:async()=>({id:'id',filePath:'test.webm'}),appendRecording:async(id,bytes)=>calls.push(['write',new TextDecoder().decode(bytes)]),finishRecording:async()=>{calls.push(['finish']);return {saved:true,filePath:'test.webm',bytes:8};},...overrides};
 const recorder=new StreamRecorder({api,track:source,makeStream:t=>{assert.equal(t,clone);return {};},createRecorder:()=>media,supports:()=>true,onState:(state,data)=>states.push([state,data])});
 return {recorder,media,calls,states,get cloneStopped(){return clonedStopped;}};
}
test('final chunk is written before file closes; only cloned source is stopped',async()=>{
 const h=setup();await h.recorder.start('FPV');h.media.ondataavailable({data:new Blob(['first'])});await h.recorder.stop();assert.deepEqual(h.calls,[['write','first'],['write','last'],['finish']]);assert.equal(h.cloneStopped,true);assert.equal(h.recorder.state,'done');assert.equal(h.states.some(([s])=>s==='saved'),true);
});
test('canceling file selection never starts recording or writes bytes',async()=>{
 const h=setup({beginRecording:async()=>({canceled:true})});assert.equal(await h.recorder.start('FPV'),false);assert.deepEqual(h.calls,[]);assert.equal(h.cloneStopped,false);
});
test('source removal during file selection cancels a late selection',async()=>{
 let select;const h=setup({beginRecording:()=>new Promise(resolve=>select=resolve)});const start=h.recorder.start('FPV');await h.recorder.stop();select({id:'id'});assert.equal(await start,false);assert.deepEqual(h.calls,[['finish']]);assert.equal(h.cloneStopped,false);
});
test('failed disk write stops recorder and closes file without claiming success',async()=>{
 const h=setup({appendRecording:async()=>{throw Error('disk full');}});await h.recorder.start('FPV');h.media.ondataavailable({data:new Blob(['first'])});await h.recorder.tail;await h.recorder.stop();assert.equal(h.states.some(([s])=>s==='saved'),false);assert.equal(h.states.some(([s])=>s==='error'),true);assert.equal(h.calls.at(-1)[0],'finish');
});
