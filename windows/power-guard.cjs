const fs=require('node:fs'),path=require('node:path');
class PowerGuard{
 constructor({blocker,file}){this.blocker=blocker;this.file=file;this.enabled=true;this.running=false;this.id=null;this.error=null;this.warning=null;
  try{const data=JSON.parse(fs.readFileSync(file,'utf8'));if(typeof data.keepAwake!=='boolean')throw Error();this.enabled=data.keepAwake;}
  catch(e){if(e.code!=='ENOENT')this.warning='Не удалось прочитать настройку питания. Защита включена по умолчанию.';}
 }
 update(running){this.running=Boolean(running);this.error=null;
  try{if(this.running&&this.enabled){if(this.id===null||!this.blocker.isStarted(this.id))this.id=this.blocker.start('prevent-display-sleep');}
   else if(this.id!==null){this.blocker.stop(this.id);this.id=null;}
  }catch{this.error='Не удалось изменить блокировку автоматического сна.';}
  return this.status();
 }
 setEnabled(value){if(typeof value!=='boolean')throw Error('Некорректная настройка питания');
  fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify({keepAwake:value})+'\n',{mode:0o600});fs.renameSync(this.file+'.tmp',this.file);
  this.enabled=value;this.warning=null;return this.update(this.running);
 }
 status(){let active=false;try{active=this.id!==null&&this.blocker.isStarted(this.id);}catch{this.error='Не удалось проверить блокировку автоматического сна.';}return {enabled:this.enabled,active,error:this.error,warning:this.warning};}
}
module.exports={PowerGuard};
