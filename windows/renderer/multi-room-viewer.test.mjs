import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {MultiRoomViewer} from './multi-room-viewer.mjs';
const events=Object.fromEntries(['TrackSubscribed','TrackUnsubscribed','ParticipantDisconnected','Reconnecting','Reconnected','Disconnected'].map(x=>[x,x]));
class FakeRoom extends EventEmitter{
 constructor(){super();this.remoteParticipants=new Map();this.stopped=false;}
 async connect(){this.connected=true;}
 disconnect(){this.stopped=true;this.emit(events.Disconnected);}
}
function harness(overrides={}){
 const clients=[],cleared=[],states=[],timers=new Map();let tid=0;
 const wall=new MultiRoomViewer({events,createRoom:()=>{const c=new FakeRoom();clients.push(c);return c;},getConfig:async id=>({wsUrl:id,token:'test'}),onClear:id=>cleared.push(id),onState:(room,state)=>states.push([room.id,state]),setTimer:fn=>{timers.set(++tid,fn);return tid;},clearTimer:id=>timers.delete(id),...overrides});
 return {wall,clients,cleared,states,timers};
}
test('multiple rooms connect independently; sync preserves existing connections',async()=>{
 const h=harness();await h.wall.sync([{id:'a'},{id:'b'}]);assert.equal(h.clients.length,2);
 await h.wall.sync([{id:'a'},{id:'b'},{id:'c'}]);assert.equal(h.clients.length,3);assert.equal(h.clients[0].stopped,false);
 await h.wall.sync([{id:'b'},{id:'c'}]);assert.equal(h.clients[0].stopped,true);assert.equal(h.clients[1].stopped,false);h.wall.stop();assert.equal(h.timers.size,0);
});
test('disconnect retries only failed room and removes its own tiles',async()=>{
 const h=harness();await h.wall.sync([{id:'a'},{id:'b'}]);h.clients[0].emit(events.Disconnected);
 assert.deepEqual(h.cleared,['a']);assert.equal(h.clients[1].stopped,false);assert.equal(h.timers.size,1);
 const retry=[...h.timers.values()][0];await retry();assert.equal(h.clients.length,3);assert.equal(h.wall.entries.get('a').state,'connected');h.wall.stop();
});
test('stopping wall cancels pending enrollment and retry; late tracks are ignored',async()=>{
 let resolveConfig,tracks=0;const h=harness({getConfig:()=>new Promise(resolve=>resolveConfig=resolve),onTrack:()=>tracks++});
 const pending=h.wall.sync([{id:'a'}]);h.wall.stop();resolveConfig({});await pending;assert.equal(h.clients.length,0);
 const k=harness({onTrack:()=>tracks++});await k.wall.sync([{id:'b'}]);const old=k.clients[0];old.emit(events.Disconnected);k.wall.stop();assert.equal(k.timers.size,0);old.emit(events.TrackSubscribed,{}, {}, {});assert.equal(tracks,0);
});
test('failed enrollment does not block healthy room',async()=>{
 const h=harness({getConfig:async id=>{if(id==='a')throw Error('offline');return {};}});await h.wall.sync([{id:'a'},{id:'b'}]);assert.equal(h.wall.entries.get('a').state,'reconnecting');assert.equal(h.wall.entries.get('b').state,'connected');h.wall.stop();
});
test('events preserve room identity, including identical publisher identities across rooms',async()=>{
 const seen=[];const h=harness({onTrack:(t,p,u,r)=>seen.push(r.id)});await h.wall.sync([{id:'a'},{id:'b'}]);for(const c of h.clients)c.emit(events.TrackSubscribed,{}, {}, {identity:'same'});assert.deepEqual(seen,['a','b']);h.wall.stop();
});
