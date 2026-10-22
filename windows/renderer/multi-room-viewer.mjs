// Independent room lifecycles: a failed room must never disconnect the rest of the wall.
export class MultiRoomViewer {
 constructor({createRoom,getConfig,events,onTrack=()=>{},onUntrack=()=>{},onLeave=()=>{},onClear=()=>{},onState=()=>{},setTimer=setTimeout,clearTimer=clearTimeout}){
  Object.assign(this,{createRoom,getConfig,events,onTrack,onUntrack,onLeave,onClear,onState,setTimer,clearTimer});
  this.entries=new Map();
 }
 async sync(rooms){
  const wanted=new Set(rooms.map(r=>r.id));
  for(const [id,entry] of this.entries)if(!wanted.has(id))this.remove(id,entry);
  const added=[];
  for(const room of rooms){
   if(this.entries.has(room.id)){this.entries.get(room.id).room=room;continue;}
   const entry={room,client:null,timer:null,attempt:0,state:'connecting'};
   this.entries.set(room.id,entry);added.push(entry);
  }
  // Limit simultaneous enrollment/connect requests while keeping existing streams alive.
  const queue=[...added];
  await Promise.all(Array.from({length:Math.min(3,queue.length)},async()=>{while(queue.length)await this.connect(queue.shift());}));
 }
 valid(entry){return this.entries.get(entry.room.id)===entry;}
 state(entry,state){if(!this.valid(entry))return;entry.state=state;this.onState(entry.room,state);}
 async connect(entry){
  if(!this.valid(entry))return;
  entry.timer=null;this.state(entry,'connecting');
  let client;
  const valid=()=>this.valid(entry)&&entry.client===client;
  try{
   const config=await this.getConfig(entry.room.id);
   if(!this.valid(entry))return;
   client=this.createRoom();entry.client=client;
   const e=this.events;
   client.on(e.TrackSubscribed,(track,pub,p)=>{if(valid())this.onTrack(track,pub,p,entry.room);});
   client.on(e.TrackUnsubscribed,(track,pub,p)=>{if(valid())this.onUntrack(track,pub,p,entry.room);});
   client.on(e.ParticipantDisconnected,p=>{if(valid())this.onLeave(p,entry.room);});
   client.on(e.Reconnecting,()=>{if(valid())this.state(entry,'reconnecting');});
   client.on(e.Reconnected,()=>{if(valid()){entry.attempt=0;this.state(entry,'connected');}});
   client.on(e.Disconnected,()=>{if(valid())this.failed(entry);});
   await client.connect(config.wsUrl,config.token);
   if(!valid()){client.disconnect();return;}
   entry.attempt=0;this.state(entry,'connected');
   client.remoteParticipants.forEach(p=>p.trackPublications.forEach(pub=>{if(pub.track&&pub.isSubscribed)this.onTrack(pub.track,pub,p,entry.room);}));
  }catch{
   if(this.valid(entry)&&(!client||entry.client===client))this.failed(entry);
  }
 }
 failed(entry){
  if(!this.valid(entry)||entry.timer!==null)return;
  const client=entry.client;entry.client=null;client?.disconnect();
  this.onClear(entry.room.id);this.state(entry,'reconnecting');
  const delay=Math.min(15000,1000*2**Math.min(entry.attempt++,4));
  entry.timer=this.setTimer(()=>this.connect(entry),delay);
 }
 remove(id,entry){
  this.entries.delete(id);if(entry.timer!==null)this.clearTimer(entry.timer);
  const client=entry.client;entry.client=null;client?.disconnect();this.onClear(id);
 }
 stop(){for(const [id,entry] of this.entries)this.remove(id,entry);}
}
