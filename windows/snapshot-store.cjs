'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {recordingName}=require('./recording-store.cjs');
const MAX_PNG_BYTES=32*1024*1024,MAX_PIXELS=16*1024*1024;
function validatePng(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.byteLength<33||bytes.byteLength>MAX_PNG_BYTES)throw Error('Недопустимый размер PNG-снимка');
 const buffer=Buffer.from(bytes);
 if(buffer.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||buffer.readUInt32BE(8)!==13||buffer.toString('ascii',12,16)!=='IHDR')throw Error('Снимок должен быть изображением PNG');
 const width=buffer.readUInt32BE(16),height=buffer.readUInt32BE(20);
 if(!width||!height||width>8192||height>8192||width*height>MAX_PIXELS)throw Error('Слишком большой кадр. Максимум 16 мегапикселей');
 return {buffer,width,height};
}
function snapshotName(label,date=new Date()){return recordingName(label,date).replace(/^USC_/,'USC_frame_').replace(/\.webm$/,'.png');}
class SnapshotStore {
 constructor({open=fs.open,decode=()=>{}}={}){Object.assign(this,{open,decode});}
 async save(filePath,bytes){
  if(typeof filePath!=='string'||path.extname(filePath).toLowerCase()!=='.png')throw Error('Выберите имя файла с расширением .png');
  const {buffer,width,height}=validatePng(bytes);await this.decode(buffer,{width,height});
  let file;
  try{file=await this.open(filePath,'wx',0o600);}catch(error){if(error.code==='EEXIST')throw Object.assign(Error('Файл уже существует. Выберите новое имя для снимка.'),{code:'EEXIST'});throw error;}
  try{await file.writeFile(buffer);await file.sync();}finally{await file.close();}
  return {saved:true,filePath,width,height};
 }
}
module.exports={SnapshotStore,validatePng,snapshotName,MAX_PNG_BYTES,MAX_PIXELS};
