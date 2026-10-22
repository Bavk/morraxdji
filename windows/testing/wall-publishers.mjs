import {Room,Track} from 'livekit-client';
import {createTestPattern} from '../renderer/loopback-test.mjs';
const publishers=[];
export async function start(configs){
 for(const config of configs){
  const room=new Room();const pattern=createTestPattern();publishers.push({room,pattern});
  await room.connect(config.wsUrl,config.token);
  await room.localParticipant.publishTrack(pattern.track,{source:Track.Source.ScreenShare,simulcast:false});
 }
}
export async function stop(index){const p=publishers[index];p.pattern.stop();await p.room.disconnect();}
export function pause(index){publishers[index].pattern.pause();}
export function resume(index){publishers[index].pattern.resume();}
