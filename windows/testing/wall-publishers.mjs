import {Room,Track} from 'livekit-client';
import {createTestPattern} from '../renderer/loopback-test.mjs';
const publishers=[];
export async function start(configs){
 for(const config of configs){
  const room=new Room();const pattern=createTestPattern();publishers.push({room,pattern,config});
  await room.connect(config.wsUrl,config.token);
  await room.localParticipant.publishTrack(pattern.track,{source:Track.Source.ScreenShare,simulcast:false});
 }
}
export async function stop(index){const p=publishers[index];p.pattern.stop();await p.room.disconnect();}
export async function restart(index){
 const p=publishers[index];await stop(index);const room=new Room(),pattern=createTestPattern();publishers[index]={room,pattern,config:p.config};
 await room.connect(p.config.wsUrl,p.config.token);await room.localParticipant.publishTrack(pattern.track,{source:Track.Source.ScreenShare,simulcast:false});
}
export function pause(index){publishers[index].pattern.pause();}
export function resume(index){publishers[index].pattern.resume();}
