import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileRevokedOperators,startRevocationReconciler} from './revoked-reconciler.mjs';
const room={id:'room_test',keys:[{id:'key_revoked',revoked:true},{id:'key_live',revoked:false}]};
test('removes only revoked identities',async()=>{
 const removed=[];
 const result=await reconcileRevokedOperators([room],{listParticipants:async()=>[
  {identity:'operator_key_revoked'},{identity:'operator_key_live'},{identity:'viewer_x'}],
  removeParticipant:async(r,id)=>removed.push([r,id])});
 assert.deepEqual(removed,[['room_test','operator_key_revoked']]);
 assert.equal(result.participantsRemoved,1);assert.deepEqual(result.failures,[]);
});
test('retries after a media server outage',async()=>{
 let offline=true;const kicked=[];
 const client={listParticipants:async()=>{if(offline)throw Error('offline');return [{identity:'operator_key_revoked'}]},
  removeParticipant:async(r,id)=>kicked.push(id)};
 assert.equal((await reconcileRevokedOperators([room],client)).failures.length,1);
 offline=false;
 assert.equal((await reconcileRevokedOperators([room],client)).participantsRemoved,1);
 assert.deepEqual(kicked,['operator_key_revoked']);
});
test('one failed room or participant does not block the rest',async()=>{
 const extra={id:'key_extra',revoked:true};const ids=[];
 const result=await reconcileRevokedOperators([room,{id:'room_other',keys:[...room.keys,extra]}],{
  listParticipants:async(r)=>r==='room_test'?Promise.reject(Error('down')):Promise.resolve([
   {identity:'operator_key_revoked'},{identity:'operator_key_extra'}]),
  removeParticipant:async(r,id)=>{ids.push(id);if(id==='operator_key_revoked')throw Error('kick failed')}});
 assert.deepEqual(ids,['operator_key_revoked','operator_key_extra']);
 assert.equal(result.failures.length,2);assert.equal(result.participantsRemoved,1);
});
test('serial sweeps cannot overlap and stop cancels future ticks',async()=>{
 let scheduled,stopCalled=false,requests=0,release;
 const pending=new Promise(resolve=>{release=resolve});
 const mgr=startRevocationReconciler({getRooms:()=>[room],mediaControl:{
  listParticipants:async()=>{requests++;await pending;return []},removeParticipant:async()=>{}},
  interval:fn=>{scheduled=fn;return 1},cancelInterval:()=>{stopCalled=true},logger:{warn:()=>{}}});
 const first=mgr.sweep();assert.equal(await mgr.sweep(),null);
 release();await first;assert.equal(requests,1);
 mgr.stop();scheduled();assert.equal(await mgr.sweep(),null);assert.equal(stopCalled,true);
});
test('rooms without revoked keys incur no LiveKit calls',async()=>{
 const result=await reconcileRevokedOperators([{id:'x',keys:[{id:'key_active',revoked:false}]}],{
  listParticipants:()=>{throw Error('unexpected query')}});
 assert.equal(result.roomsChecked,0);
});
