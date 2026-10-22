import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LiveKitAdmin} from './livekit-admin.mjs';
const secret='a-test-secret-that-is-long-enough';
const apiKey='test';
const mock = async(url,options)=> {
  assert.ok(url.startsWith('http://127.0.0.1:7880/twirp/livekit.RoomService/'));
  const part=JSON.parse(Buffer.from(options.headers.authorization.split('.')[1],'base64url').toString());
  if(url.endsWith('/DeleteRoom')) assert.equal(part.video.roomCreate,true);
  else assert.equal(part.video.roomAdmin,true);
  if(url.endsWith('/ListParticipants'))return {ok:true,status:200,json:async()=>({participants:[{identity:'operator_key_aaaaaaaaaaaaaaaaaaaa',tracks:[{source:'SCREEN_SHARE'}]}]})};
  if(url.endsWith('/RemoveParticipant'))return {ok:true,status:200,json:async()=>({})};
  if(url.endsWith('/DeleteRoom'))return {ok:true,status:200,json:async()=>({})};
  throw Error('not mocked');
};
test('LiveKit local Twirp API moderation and JWT permissions',async()=>{
  const c=new LiveKitAdmin({endpoint:'http://127.0.0.1:7880',apiKey,apiSecret:secret,request:mock});
  assert.equal((await c.listParticipants('room_test')).length,1);
  assert.equal(await c.removeParticipant('room_test','operator_key_aaaaaaaaaaaaaaaaaaaa'),true);
  assert.equal(await c.deleteRoom('room_test'),true);
});
test('Twirp control does not accept remote endpoints',()=>{
  assert.throws(()=>new LiveKitAdmin({endpoint:'https://evil.example/',apiKey,apiSecret:secret}));
});
