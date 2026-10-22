const finite=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
export function readVideoStats(report){
 let inbound=null,rttMs=null;
 report?.forEach?.(stat=>{
  if(stat.type==='inbound-rtp'&&(stat.kind==='video'||stat.mediaType==='video')&&!stat.isRemote)inbound=stat;
  if(stat.type==='candidate-pair'&&stat.state==='succeeded'&&(stat.nominated||stat.selected)&&finite(stat.currentRoundTripTime)!==null)rttMs=stat.currentRoundTripTime*1000;
 });
 return {bytes:finite(inbound?.bytesReceived),packets:finite(inbound?.packetsReceived),lost:finite(inbound?.packetsLost),decoded:finite(inbound?.framesDecoded),rttMs};
}
export class StreamHealth {
 constructor({staleAfterMs=4000}={}){this.staleAfterMs=staleAfterMs;this.previous=null;this.lastFrameAt=null;this.startedAt=null;}
 sample({frames=null,width=0,height=0,report=null,active=true},now){
  if(!active){this.previous=null;this.lastFrameAt=null;this.startedAt=null;return {state:'paused',fps:null,mbps:null,loss:null,rttMs:null,width,height,ageMs:0};}
  if(this.startedAt===null)this.startedAt=now;
  const stats=readVideoStats(report);frames=finite(frames)??stats.decoded;
  const current={...stats,frames,now},previous=this.previous;
  if(frames!==null&&frames>0&&(previous===null||frames!==previous.frames))this.lastFrameAt=now;
  const elapsed=previous?(now-previous.now)/1000:0;
  const delta=key=>previous&&finite(current[key])!==null&&finite(previous[key])!==null&&current[key]>=previous[key]?current[key]-previous[key]:null;
  const frameDelta=delta('frames'),byteDelta=delta('bytes'),received=delta('packets'),lost=delta('lost');
  const ageMs=Math.max(0,now-(this.lastFrameAt??this.startedAt));
  this.previous=current;
  return {state:ageMs>=this.staleAfterMs?'stale':this.lastFrameAt===null?'waiting':'live',
   fps:elapsed>0&&frameDelta!==null?frameDelta/elapsed:null,
   mbps:elapsed>0&&byteDelta!==null?byteDelta*8/elapsed/1e6:null,
   loss:received!==null&&lost!==null&&received+lost>0?lost/(received+lost)*100:null,
   rttMs:stats.rttMs,width,height,ageMs};
 }
}
export function monitorStream({track,video,isActive=()=>true,onUpdate,getStaleAfterMs=()=>4000,intervalMs=1000,setTimer=setTimeout,clearTimer=clearTimeout,now=()=>performance.now()}){
 const health=new StreamHealth();let stopped=false,timer=null;
 async function tick(){
  if(stopped)return;
  let report=null;
  if(isActive())try{report=await track.getRTCStatsReport?.();}catch{}
  if(stopped)return;
  const quality=video.getVideoPlaybackQuality?.();
  // Hidden video elements may stop presenting frames while a recording still decodes.
  const frames=readVideoStats(report).decoded??finite(quality?.totalVideoFrames);
  const threshold=getStaleAfterMs();health.staleAfterMs=[2000,4000,8000,15000].includes(threshold)?threshold:4000;
  onUpdate(health.sample({frames,width:video.videoWidth,height:video.videoHeight,report,active:isActive()},now()));
  if(!stopped)timer=setTimer(tick,intervalMs);
 }
 void tick();
 return ()=>{stopped=true;if(timer!==null)clearTimer(timer);};
}
export function formatHealth(sample){
 const {width,height,fps,mbps,loss,rttMs}=sample;
 return [width&&height?`${width}×${height}`:'Размер —',fps===null?'FPS —':`${Math.round(fps)} FPS`,mbps===null?'Битрейт —':`${mbps.toFixed(2)} Мбит/с`,loss===null?'Потери —':`Потери ${loss.toFixed(1)}%`,rttMs===null?null:`RTT сервера ${Math.round(rttMs)} мс`].filter(Boolean).join(' · ');
}
