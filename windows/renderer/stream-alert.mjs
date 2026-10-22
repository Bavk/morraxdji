// A signal means no new decoded frames, not proof of network failure.
export class StreamAlerts {
 constructor({play,now=()=>performance.now(),onError=()=>{}}){Object.assign(this,{play,now,onError});this.enabled=false;this.sources=new Map();this.last=-Infinity;this.cooldownMs=10000;}
 enable(value){this.enabled=!!value;this.sources.clear();this.last=-Infinity;}
 forget(id){this.sources.delete(id);}
 clear(){this.sources.clear();}
 observe(id,sample){
  if(!this.enabled)return false;
  const previous=this.sources.get(id)||false;
  if(sample.state==='live'){if(sample.fps>0)this.sources.set(id,true);return false;}
  this.sources.delete(id);
  if(sample.state!=='stale'||!previous)return false;
  const time=this.now();if(time-this.last<this.cooldownMs)return false;
  this.last=time;
  try{this.play();return true;}catch{this.enable(false);this.onError();return false;}
 }
}
export class AlertTone {
 constructor(createContext=()=>new AudioContext()){this.createContext=createContext;this.context=null;this.generation=0;}
 async ready(){
  const generation=++this.generation;
  const context=this.context||(this.context=this.createContext());
  await context.resume();
  if(this.context!==context||generation!==this.generation)return false;
  if(context.state!=='running')throw Error('Звуковой выход недоступен');
  return true;
 }
 play(){
  const context=this.context;if(context?.state!=='running')throw Error('Звуковой выход недоступен');
  const oscillator=context.createOscillator(),gain=context.createGain(),time=context.currentTime;
  oscillator.frequency.value=880;gain.gain.setValueAtTime(0,time);gain.gain.linearRampToValueAtTime(.12,time+.02);gain.gain.linearRampToValueAtTime(0,time+.35);
  oscillator.connect(gain);gain.connect(context.destination);
  oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};oscillator.start(time);oscillator.stop(time+.36);
 }
 stop(){this.generation++;const context=this.context;this.context=null;if(context)void context.close().catch(()=>{});}
}
