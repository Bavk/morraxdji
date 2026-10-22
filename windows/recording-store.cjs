'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
class RecordingStore {
 constructor({open=fs.open,maxSessions=4,maxChunkBytes=4*1024*1024,maxPendingBytes=16*1024*1024,onSaved=async()=>{}}={}){Object.assign(this,{open,maxSessions,maxChunkBytes,maxPendingBytes,onSaved});this.sessions=new Map();this.opening=0;}
 async begin(owner,filePath,{label=''}={}){
  if(this.sessions.size+this.opening>=this.maxSessions)throw Error('Одновременно можно записывать не более четырёх потоков');
  if(path.extname(filePath).toLowerCase()!=='.webm')throw Error('Для записи выберите файл .webm');
  this.opening++;let file;
  try{file=await this.open(filePath,'wx',0o600);}finally{this.opening--;}
  const id=crypto.randomUUID();this.sessions.set(id,{owner,file,filePath,label,startedAt:new Date().toISOString(),tail:Promise.resolve(),bytes:0,pending:0,error:null,finishing:null});
  return {id,filePath};
 }
 session(owner,id){const session=this.sessions.get(id);if(!session||session.owner!==owner)throw Error('Сеанс записи недоступен');return session;}
 append(owner,id,chunk){
  const session=this.session(owner,id);
  if(session.finishing)throw Error('Запись уже завершается');
  if(!(chunk instanceof Uint8Array)||!chunk.byteLength||chunk.byteLength>this.maxChunkBytes)throw Error('Недопустимый размер фрагмента записи');
  if(session.pending+chunk.byteLength>this.maxPendingBytes)throw Error('Диск не успевает сохранять запись');
  const buffer=Buffer.from(chunk);session.pending+=buffer.length;
  const write=session.tail.then(async()=>{
   try{if(session.error)throw session.error;await session.file.writeFile(buffer);session.bytes+=buffer.length;}catch(error){session.error=error;throw error;}
   finally{session.pending-=buffer.length;}
  });session.tail=write.catch(()=>{});return write;
 }
 async finish(owner,id){
  const session=this.session(owner,id);if(session.finishing)return session.finishing;
  session.finishing=(async()=>{
   await session.tail;
   try{await session.file.sync();}catch(error){session.error??=error;}
   try{await session.file.close();}catch(error){session.error??=error;}
   this.sessions.delete(id);
   const result={saved:!session.error&&session.bytes>0,filePath:session.filePath,label:session.label,startedAt:session.startedAt,bytes:session.bytes,error:session.error?'Ошибка записи на диск. Файл мог сохраниться частично.':null};
   if(result.saved)try{await this.onSaved(result);}catch{result.archiveWarning='Видео сохранено, но не добавлено в архив. Его можно добавить вручную.';}
   return result;
  })();return session.finishing;
 }
 async closeOwner(owner){await Promise.allSettled([...this.sessions].filter(([,s])=>s.owner===owner).map(([id])=>this.finish(owner,id)));}
}
function recordingName(label,date=new Date()){
 const name=String(label||'Пульт').normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'').slice(0,80)||'Пульт';
 return `USC_${name}_${date.toISOString().replace(/[:.]/g,'-')}.webm`;
}
module.exports={RecordingStore,recordingName};
