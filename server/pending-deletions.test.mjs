import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcilePendingRoomDeletions,DELETED_ROOM_GUARD_MS} from './pending-deletions.mjs';

test('deletes only distinct pending rooms and acknowledges after LiveKit success',async()=>{
  const calls=[],ack=[];
  const result=await reconcilePendingRoomDeletions([{id:'room_a',expireAt:500},{id:'room_b',expireAt:500}],
    {deleteRoom:async id=>{calls.push(id);}}, id=>ack.push(id),1000);
  assert.deepEqual(calls,['room_a','room_b']);
  assert.deepEqual(ack,['room_a','room_b']);
  assert.equal(result.pendingRoomsRemoved,2);
  assert.deepEqual(result.pendingRoomFailures,[]);
});

test('keeps a deletion tombstone when LiveKit is offline; retries later',async()=>{
  const tombstones=[{id:'room_orphan',expireAt:500}];let offline=true;
  const media={deleteRoom:async()=>{if(offline)throw Error('offline');}};
  const ack=id=>{const index=tombstones.findIndex(entry=>entry.id===id);if(index>=0)tombstones.splice(index,1);};
  const first=await reconcilePendingRoomDeletions(tombstones,media,ack,1000);
  assert.equal(first.pendingRoomFailures.length,1);
  assert.deepEqual(tombstones,[{id:'room_orphan',expireAt:500}]);
  offline=false;
  const next=await reconcilePendingRoomDeletions(tombstones,media,ack,1000);
  assert.equal(next.pendingRoomsRemoved,1);
  assert.deepEqual(tombstones,[]);
});

test('lack of a media controller must not acknowledge pending deletions',async()=>{
  let acknowledged=false;
  const result=await reconcilePendingRoomDeletions([{id:'room_x',expireAt:500}],null,()=>{acknowledged=true;},1000);
  assert.equal(result.pendingRoomsRemoved,0);
  assert.equal(acknowledged,false);
});

test('a deleted room is repeatedly disconnected while an issued JWT may still be valid',async()=>{
  const keep={id:'room_recent',expireAt:1000+DELETED_ROOM_GUARD_MS};
  const deleted=[];const acknowledged=[];
  const control={deleteRoom:async id=>deleted.push(id)};
  for(const time of [1000,60000,180000,1000+DELETED_ROOM_GUARD_MS-1]) {
    const result=await reconcilePendingRoomDeletions([keep],control,id=>acknowledged.push(id),time);
    assert.equal(result.pendingRoomsEnforced,1);
    assert.equal(result.pendingRoomsRemoved,0);
  }
  assert.deepEqual(acknowledged,[]);
  const expired=await reconcilePendingRoomDeletions([keep],control,id=>acknowledged.push(id),keep.expireAt);
  assert.equal(expired.pendingRoomsRemoved,1);
  assert.deepEqual(acknowledged,['room_recent']);
  assert.equal(deleted.length,5);
});
