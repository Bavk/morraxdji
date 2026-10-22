import {test} from 'node:test';import assert from 'node:assert/strict';
import {StreamAlerts,AlertTone} from './stream-alert.mjs';
const live={state:'live',fps:30},stale={state:'stale'},paused={state:'paused'};
test('sound is opt-in and requires actual moving frames before a stall',()=>{
 let plays=0;const alerts=new StreamAlerts({play:()=>plays++});
 alerts.observe('a',live);alerts.observe('a',stale);assert.equal(plays,0);
 alerts.enable(true);alerts.observe('a',stale);alerts.observe('a',{state:'live',fps:0});alerts.observe('a',stale);assert.equal(plays,0);
 alerts.observe('a',live);assert.equal(alerts.observe('a',stale),true);alerts.observe('a',stale);assert.equal(plays,1);
});
test('global cooldown coalesces multiple stalls and recovery rearms the source',()=>{
 let time=0,plays=0;const alerts=new StreamAlerts({play:()=>plays++,now:()=>time});alerts.enable(true);
 for(const id of ['a','b'])alerts.observe(id,live);
 alerts.observe('a',stale);alerts.observe('b',stale);assert.equal(plays,1);
 time=10000;alerts.observe('a',live);alerts.observe('a',stale);assert.equal(plays,2);
});
test('manual or adaptive pause, removal and switching never produce a stale alert',()=>{
 let plays=0;const alerts=new StreamAlerts({play:()=>plays++});alerts.enable(true);
 alerts.observe('a',live);alerts.observe('a',paused);alerts.observe('a',stale);
 alerts.observe('a',live);alerts.forget('a');alerts.observe('a',stale);
 alerts.observe('a',live);alerts.clear();alerts.observe('a',stale);assert.equal(plays,0);
});
test('disabling clears armed sources; output failure disables signals and reports once',()=>{
 let errors=0;const alerts=new StreamAlerts({play:()=>{throw Error('output')},onError:()=>errors++});alerts.enable(true);alerts.observe('a',live);alerts.enable(false);alerts.observe('a',stale);assert.equal(errors,0);
 alerts.enable(true);alerts.observe('a',live);assert.equal(alerts.observe('a',stale),false);assert.equal(alerts.enabled,false);alerts.observe('a',stale);assert.equal(errors,1);
});
function audio(){
 const calls=[];const oscillator={frequency:{},connect:()=>calls.push('osc-connect'),disconnect:()=>calls.push('osc-disconnect'),start:time=>calls.push(['start',time]),stop:time=>calls.push(['stop',time])};
 const gain={gain:{setValueAtTime:(...args)=>calls.push(['set',...args]),linearRampToValueAtTime:(...args)=>calls.push(['ramp',...args])},connect:()=>{},disconnect:()=>calls.push('gain-disconnect')};
 const context={state:'running',currentTime:10,destination:{},resume:async()=>{},close:async()=>calls.push('closed'),createOscillator:()=>oscillator,createGain:()=>gain};return {context,calls,oscillator};
}
test('tone has bounded duration and gain, releases nodes and closes context',async()=>{
 const fake=audio(),tone=new AlertTone(()=>fake.context);assert.equal(await tone.ready(),true);tone.play();assert.equal(fake.oscillator.frequency.value,880);assert.ok(fake.calls.some(c=>Array.isArray(c)&&c[0]==='ramp'&&c[1]===.12));assert.ok(fake.calls.some(c=>Array.isArray(c)&&c[0]==='stop'&&c[1]===10.36));fake.oscillator.onended();assert.ok(fake.calls.includes('gain-disconnect'));tone.stop();assert.ok(fake.calls.includes('closed'));assert.throws(()=>tone.play());
});
test('late audio activation cannot re-enable a stopped session',async()=>{
 const fake=audio();let resolve;fake.context.resume=()=>new Promise(r=>resolve=r);const tone=new AlertTone(()=>fake.context);const pending=tone.ready();tone.stop();resolve();assert.equal(await pending,false);
});
test('suspended audio context reports failure instead of pretending to signal',async()=>{
 const fake=audio();fake.context.state='suspended';const tone=new AlertTone(()=>fake.context);await assert.rejects(tone.ready());assert.throws(()=>tone.play());tone.stop();
});
