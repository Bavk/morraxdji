// Video-only recording. A cloned track keeps recording shutdown independent of viewing.
export class StreamRecorder {
 constructor({api,track,onState=()=>{},createRecorder=(stream,options)=>new MediaRecorder(stream,options),makeStream=track=>new MediaStream([track]),supports=type=>MediaRecorder.isTypeSupported(type),maxPendingBytes=16*1024*1024}){
  Object.assign(this,{api,track,onState,createRecorder,makeStream,supports,maxPendingBytes});this.state='idle';this.tail=Promise.resolve();this.pending=0;this.error=null;this.id=null;this.stopPromise=null;
 }
 async start(label){
  if(this.state!=='idle')throw Error('Запись уже запущена');
  this.state='choosing';this.onState(this.state);
  try{
   const mimeType=['video/webm;codecs=vp8','video/webm;codecs=vp9','video/webm'].find(this.supports);
   if(!mimeType)throw Error('Запись WebM не поддерживается этим Chromium');
   const selected=await this.api.beginRecording(label);
   if(!selected?.id){this.state='done';this.onState('canceled');return false;}
   this.id=selected.id;this.filePath=selected.filePath;this.freeBytesAtStart=selected.freeBytesAtStart;
   if(this.cancelRequested){await this.api.finishRecording(this.id);this.state='done';this.onState('canceled');return false;}
   this.clone=this.track.clone();
   this.recorder=this.createRecorder(this.makeStream(this.clone),{mimeType,videoBitsPerSecond:2_500_000});
   this.recorder.ondataavailable=event=>this.enqueue(event.data);
   this.recorder.onerror=()=>{this.error??=Error('Ошибка кодирования видео');void this.stop();};
   this.recorder.onstop=()=>{void this.finalize();};
   this.startedAt=Date.now();this.state='recording';this.recorder.start(1000);this.onState(this.state);return true;
  }catch(error){
   this.error=error;
   try{this.clone?.stop();}catch{}
   if(this.id)await this.api.finishRecording(this.id).catch(()=>{});
   this.state='done';this.onState('error',error);throw error;
  }finally{
   // stop() during the save dialog must wait for its result and late-file cleanup.
   if(this.state==='done')this.resolveStop?.();
  }
 }
 enqueue(blob){
  if(this.finalizing||!blob?.size)return;
  if(this.error)return;
  if(this.pending+blob.size>this.maxPendingBytes){this.error=Error('Диск не успевает сохранять запись');void this.stop();return;}
  this.pending+=blob.size;
  this.tail=this.tail.then(async()=>{
   if(this.error)return;
   const bytes=new Uint8Array(await blob.arrayBuffer());
   for(let offset=0;offset<bytes.length;offset+=1024*1024)await this.api.appendRecording(this.id,bytes.subarray(offset,offset+1024*1024));
  }).catch(error=>{this.error=error;void this.stop();}).finally(()=>{this.pending-=blob.size;});
 }
 stop(){
  if(this.stopPromise)return this.stopPromise;
  this.cancelRequested=true;
  if(this.state==='choosing'){
   this.stopPromise=new Promise(resolve=>this.resolveStop=resolve);
   return this.stopPromise;
  }
  if(this.state==='idle'||this.state==='done')return Promise.resolve();
  this.stopPromise=new Promise(resolve=>this.resolveStop=resolve);
  this.state='stopping';this.onState(this.state);
  try{if(this.recorder?.state!=='inactive')this.recorder.stop();else void this.finalize();}
  catch{
   this.error??=Error('Браузер не смог завершить видеозапись. Файл может быть неполным.');
   void this.finalize();
  }
  return this.stopPromise;
 }
 async finalize(){
  if(this.finalizing)return;this.finalizing=true;
  // Capture the final dataavailable event before closing the file.
  if(!this.stopPromise)this.stopPromise=new Promise(resolve=>this.resolveStop=resolve);
  this.state='stopping';this.onState(this.state);
  await this.tail;
  try{this.clone?.stop();}catch{this.error??=Error('Не удалось освободить трек записи. Проверьте сохранённый файл.');}
  let result;
  try{result=await this.api.finishRecording(this.id);if(!result.saved)throw Error(result.error||'В записи не было видеоданных');if(this.error)throw this.error;}
  catch(error){this.error=error;}
  // UI observers must see the terminal state when releasing receive/pause controls.
  this.state='done';
  try{this.onState(this.error?'error':'saved',this.error||result);}
  finally{this.resolveStop?.(result);}
 }
}
