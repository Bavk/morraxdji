const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const EVENTS=Object.freeze({
 'stream-started':'Начат просмотр потока',
 'participant-left':'Пульт отключился от комнаты',
 'frames-stalled':'Нет новых кадров',
 'frames-restored':'Кадры снова поступают',
 'room-reconnecting':'Восстановление связи с комнатой',
 'room-connected':'Соединение с комнатой установлено',
 'room-disconnected':'Потеря связи с комнатой'
});
const LIMIT=2000;
function safeLabel(value){
 if(typeof value!=='string'||value.length>1000)throw Error('Некорректное имя источника');
 return value.replace(/(?:USCV1\.[A-Za-z0-9_=-]+|STRM_[A-Za-z0-9_-]+|[A-Za-z0-9+/]{43}=|eyJ[A-Za-z0-9_.-]+)/g,'[скрыто]').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,200);
}
class EventLog{
 constructor(file){this.file=file;this.rows=[];
  try{const data=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(data))throw Error();
   this.rows=data.slice(-LIMIT).map(row=>{if(!Object.hasOwn(EVENTS,row.kind)||typeof row.id!=='string'||!Number.isFinite(Date.parse(row.at)))throw Error();return {id:row.id,at:row.at,kind:row.kind,label:safeLabel(row.label)};});
  }catch(error){if(error.code!=='ENOENT')throw Error('Не удалось прочитать журнал событий. Исходный файл сохранён.');}
 }
 append(kind,label){
  if(!Object.hasOwn(EVENTS,kind))throw Error('Неизвестное событие');
  const row={id:randomUUID(),at:new Date().toISOString(),kind,label:safeLabel(label)};
  const next=[...this.rows,row].slice(-LIMIT);
  fs.mkdirSync(path.dirname(this.file),{recursive:true});
  fs.writeFileSync(this.file+'.tmp',JSON.stringify(next)+'\n',{mode:0o600});
  fs.renameSync(this.file+'.tmp',this.file);this.rows=next;return row;
 }
 list(){return this.rows.slice().reverse().map(row=>({...row,message:EVENTS[row.kind]}));}
 export(file){fs.writeFileSync(file,JSON.stringify({format:'USC events v1',exportedAt:new Date().toISOString(),events:this.list()},null,2)+'\n',{flag:'wx',mode:0o600});return {saved:true,count:this.rows.length};}
}
module.exports={EventLog,EVENTS,LIMIT,safeLabel};
