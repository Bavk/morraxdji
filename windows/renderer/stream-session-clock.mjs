// Local observation time, never a flight timer or the publisher's broadcast duration.
export class StreamSessionClock {
 constructor(){this.startedAt=null;this.previousAt=null;this.receiving=false;this.receiveMs=0;this.elapsedMs=0;}
 update({hasFrame,receiving},now){
  if(!Number.isFinite(now)||now<0)throw new RangeError('Invalid monotonic time');
  if(this.startedAt===null){if(!hasFrame)return null;this.startedAt=now;this.previousAt=now;}
  const delta=now-this.previousAt;
  // Do not infer reception through long unobserved gaps (sleep or a blocked renderer).
  if(this.receiving&&receiving&&delta>=0&&delta<=3500)this.receiveMs+=delta;
  this.previousAt=Math.max(this.previousAt,now);this.receiving=!!receiving;
  this.elapsedMs=Math.max(this.elapsedMs,now-this.startedAt);
  return {elapsedMs:this.elapsedMs,receiveMs:this.receiveMs};
 }
}
export function formatSessionDuration(ms){
 const seconds=Math.floor(Math.max(0,Number.isFinite(ms)?ms:0)/1000),hours=Math.floor(seconds/3600),minutes=Math.floor(seconds/60)%60,remainder=seconds%60;
 return (hours?String(hours).padStart(2,'0')+':':'')+String(minutes).padStart(2,'0')+':'+String(remainder).padStart(2,'0');
}
