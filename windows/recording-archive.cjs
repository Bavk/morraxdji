'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {Readable}=require('node:stream');
const validId=id=>typeof id==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id);
const key=file=>process.platform==='win32'?file.toLowerCase():file;
function parseRange(value,size){
 if(!value)return {start:0,end:size-1,partial:false};
 const match=/^bytes=(\d*)-(\d*)$/.exec(value);if(!match||(!match[1]&&!match[2]))return null;
 let start,end;
 if(!match[1]){const suffix=Number(match[2]);if(!Number.isSafeInteger(suffix)||suffix<=0)return null;start=Math.max(0,size-suffix);end=size-1;}
 else {start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),size-1):size-1;}
 return Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>=0&&start<size&&end>=start?{start,end,partial:true}:null;
}
class RecordingArchive {
 constructor(indexPath){this.indexPath=indexPath;this.records=[];this.loading=null;this.tail=Promise.resolve();}
 async load(){
  if(!this.loading)this.loading=(async()=>{
   let text;try{const info=await fs.stat(this.indexPath);if(info.size>8*1024*1024)throw Error('Слишком большой индекс');text=await fs.readFile(this.indexPath,'utf8');}catch(error){if(error.code==='ENOENT')return;throw error;}
   try{const data=JSON.parse(text);if(data.version!==1||!Array.isArray(data.records)||data.records.length>10000||!data.records.every(r=>validId(r.id)&&typeof r.filePath==='string'&&path.isAbsolute(r.filePath)&&path.extname(r.filePath).toLowerCase()==='.webm'&&typeof r.label==='string'&&r.label.length<=300&&(r.note===undefined||(typeof r.note==='string'&&r.note.length<=2000))&&Number.isFinite(Date.parse(r.createdAt))&&Number.isSafeInteger(r.bytes)&&r.bytes>=0))throw Error('Неверный формат');
    this.records=data.records.map(r=>({id:r.id,filePath:r.filePath,label:r.label,note:r.note||'',createdAt:r.createdAt,bytes:r.bytes}));
   }catch{throw Error('Не удалось прочитать список записей. Видеофайлы остаются в выбранных папках.');}
  })();return this.loading;
 }
 mutate(change){
  const operation=this.tail.then(async()=>{
   await this.load();const records=change([...this.records]);if(records.length>10000)throw Error('Слишком много записей в списке');
   const content=JSON.stringify({version:1,records},null,2);if(Buffer.byteLength(content,'utf8')>8*1024*1024)throw Error('Индекс записей превышает 8 МиБ; сократите заметки или уберите старые записи из списка');
   await fs.mkdir(path.dirname(this.indexPath),{recursive:true});const temporary=this.indexPath+'.tmp-'+crypto.randomUUID();
   try{await fs.writeFile(temporary,content,{flag:'wx',mode:0o600});await fs.rename(temporary,this.indexPath);}finally{await fs.unlink(temporary).catch(()=>{});}
   this.records=records;
  });this.tail=operation.catch(()=>{});return operation;
 }
 async probe(filePath){
  if(typeof filePath!=='string'||!path.isAbsolute(filePath)||path.extname(filePath).toLowerCase()!=='.webm')throw Error('Выберите файл WebM');
  const resolved=await fs.realpath(filePath);const file=await fs.open(resolved,'r');
  try{const info=await file.stat();if(!info.isFile()||info.size<4)throw Error('Пустой видеофайл');const header=Buffer.alloc(4);await file.read(header,0,4,0);if(header.toString('hex')!=='1a45dfa3')throw Error('Файл не содержит WebM-видео');return {filePath:resolved,info};}finally{await file.close();}
 }
 async add(result){
  if(!result.saved)return;
  const {filePath,info}=await this.probe(result.filePath);
  const entry={id:crypto.randomUUID(),filePath,label:String(result.label||path.basename(filePath)).slice(0,300),note:'',createdAt:result.startedAt||info.mtime.toISOString(),bytes:info.size};
  await this.mutate(records=>{const old=records.find(r=>key(r.filePath)===key(filePath));if(old){entry.id=old.id;entry.note=old.note||'';if(!result.label)entry.label=old.label;if(!result.startedAt)entry.createdAt=old.createdAt;}return [entry,...records.filter(r=>r.id!==entry.id)].sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt));});return entry;
 }
 async importFiles(files){
  let added=0,skipped=0;for(const filePath of files){try{await this.probe(filePath);}catch{skipped++;continue;}await this.add({saved:true,filePath});added++;}return {added,skipped};
 }
 async list(){
  await this.tail;await this.load();
  return Promise.all(this.records.map(async record=>{try{const info=await fs.stat(record.filePath);return {...record,bytes:info.size,available:info.isFile()};}catch{return {...record,available:false};}}));
 }
 async get(id){await this.tail;await this.load();const entry=this.records.find(r=>r.id===id);if(!validId(id)||!entry)throw Error('Запись не найдена в архиве');return {...entry};}
 async forget(id){await this.get(id);await this.mutate(records=>records.filter(r=>r.id!==id));return {removed:true};}
 async updateMetadata(id,metadata){
  if(!validId(id))throw Error('Запись не найдена в архиве');
  if(!metadata||typeof metadata.label!=='string'||!metadata.label.trim()||metadata.label.length>300||/[\x00-\x1f\x7f]/.test(metadata.label))throw Error('Название должно содержать от 1 до 300 символов без переносов строк');
  if(typeof metadata.note!=='string'||metadata.note.length>2000||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(metadata.note))throw Error('Заметка должна содержать не более 2000 символов');
  const label=metadata.label.trim(),note=metadata.note.trim();let updated;
  await this.mutate(records=>{const index=records.findIndex(r=>r.id===id);if(index===-1)throw Error('Запись не найдена в архиве');updated={...records[index],label,note};records[index]=updated;return records;});
  return {id:updated.id,label:updated.label,note:updated.note};
 }
 async playback(id){const entry=await this.get(id);await this.probe(entry.filePath);return {url:`usc-recording://${entry.id}/`,label:entry.label};}
 async revealPath(id){const entry=await this.get(id);if(!(await fs.stat(entry.filePath)).isFile())throw Error('Файл недоступен');return fs.realpath(entry.filePath);}
 async response(id,rangeHeader,method='GET'){
  if(!['GET','HEAD'].includes(method))return new Response(null,{status:405});
  const entry=await this.get(id);if(path.extname(entry.filePath).toLowerCase()!=='.webm')throw Error('Не видео');
  const file=await fs.open(entry.filePath,'r');let streaming=false;
  try{
   const info=await file.stat(),header=Buffer.alloc(4);if(!info.isFile()||info.size<4)throw Error('Нет видео');await file.read(header,0,4,0);if(header.toString('hex')!=='1a45dfa3')throw Error('Не WebM');
   const range=parseRange(rangeHeader,info.size);if(!range)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${info.size}`}});
   const headers={'Content-Type':'video/webm','Accept-Ranges':'bytes','Content-Length':String(range.end-range.start+1),'Cache-Control':'no-store'};
   if(range.partial)headers['Content-Range']=`bytes ${range.start}-${range.end}/${info.size}`;
   const body=method==='HEAD'?null:Readable.toWeb(file.createReadStream({start:range.start,end:range.end,autoClose:true}));streaming=method!=='HEAD';
   return new Response(body,{status:range.partial?206:200,headers});
  }finally{if(!streaming)await file.close();}
 }
}
function registerArchiveScheme(protocol){protocol.registerSchemesAsPrivileged([{scheme:'usc-recording',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);}
function handleArchiveProtocol(protocol,archive){protocol.handle('usc-recording',async request=>{
 try{const url=new URL(request.url);if(url.pathname!=='/'||url.search||url.hash||!validId(url.hostname))return new Response(null,{status:404});return await archive().response(url.hostname,request.headers.get('range'),request.method);}catch{return new Response(null,{status:404});}
});}
module.exports={RecordingArchive,parseRange,registerArchiveScheme,handleArchiveProtocol};
