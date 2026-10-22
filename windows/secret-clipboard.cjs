const {validateInvite}=require('./invite-file.cjs');
class SecretClipboard{
 constructor({clipboard,setTimer=setTimeout,clearTimer=clearTimeout,ttlMs=60000}){Object.assign(this,{clipboard,setTimer,clearTimer,ttlMs});this.secret=null;this.timer=null;this.generation=0;}
 copy(code){
  if(typeof code!=='string'||(!/^STRM_[A-Za-z0-9_-]{32}$/.test(code)&&!code.startsWith('USCV1.')))throw Error('Некорректный код подключения');
  if(code.startsWith('USCV1.'))validateInvite(code);
  this.clipboard.writeText(code);
  if(this.timer!==null)this.clearTimer(this.timer);
  this.secret=code;const generation=++this.generation;
  this.timer=this.setTimer(()=>{if(this.generation===generation)this.clear();},this.ttlMs);this.timer?.unref?.();
  return {copied:true,clearAfterSeconds:this.ttlMs/1000};
 }
 clear(){
  if(this.timer!==null)this.clearTimer(this.timer);this.timer=null;
  const expected=this.secret;this.secret=null;this.generation++;
  if(!expected)return;
  // Never erase text copied by the user or another app after our code.
  try{if(this.clipboard.readText()===expected)this.clipboard.clear();}catch{}
 }
}
module.exports={SecretClipboard};
