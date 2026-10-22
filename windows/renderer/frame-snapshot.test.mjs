import {test} from 'node:test';import assert from 'node:assert/strict';import {captureFrame} from './frame-snapshot.mjs';
function fixture(blob=new Blob([new Uint8Array([1,2,3])],{type:'image/png'})){
 const draws=[];const canvas={width:0,height:0,getContext:()=>({drawImage:(...args)=>draws.push(args)}),toBlob:callback=>callback(blob)};return {canvas,draws,documentObject:{createElement:()=>canvas}};
}
test('snapshot uses the full decoded frame, not tile dimensions, and releases canvas memory',async()=>{
 const f=fixture(),video={videoWidth:1280,videoHeight:720,clientWidth:160,clientHeight:90,readyState:2};const result=await captureFrame(video,f);
 assert.equal(result.width,1280);assert.equal(result.height,720);assert.deepEqual(f.draws[0],[video,0,0,1280,720]);assert.deepEqual([...result.png],[1,2,3]);assert.equal(f.canvas.width,0);assert.equal(f.canvas.height,0);
});
test('capture refuses an absent first frame before allocating a canvas',async()=>{
 await assert.rejects(captureFrame({videoWidth:0,videoHeight:0,readyState:0},{documentObject:{createElement:()=>{throw Error('Must not allocate');}}}),/дождитесь/);
});
test('oversized frames are refused before allocating a canvas',async()=>{
 await assert.rejects(captureFrame({videoWidth:8192,videoHeight:8192,readyState:2},{documentObject:{createElement:()=>{throw Error('Must not allocate');}}}),/мегапикселей/);
});
test('encoder failure is reported and canvas storage is released',async()=>{
 const f=fixture(null);await assert.rejects(captureFrame({videoWidth:640,videoHeight:360,readyState:2},f),/создать PNG/);assert.equal(f.canvas.width,0);assert.equal(f.canvas.height,0);
});
