export const operatorDefaults=Object.freeze({enabled:true,expiresAt:null,team:'',device:'',notes:'',profile:'auto',preferredRoomId:null});
export const roomDefaults=Object.freeze({open:true,description:'',group:'',color:'blue',maxOperators:0,profile:'auto',sortOrder:0});
export const operatorSettings=key=>({...operatorDefaults,...key.settings});
export const roomSettings=room=>({...roomDefaults,...room.settings});
export const operatorActive=(key,now=Date.now())=>!key.revoked&&operatorSettings(key).enabled&&(operatorSettings(key).expiresAt===null||operatorSettings(key).expiresAt>now);
const bad=message=>{throw Object.assign(Error(message),{code:400});};
export function validatedSettings(kind,current,patch){
 if(!patch||typeof patch!=='object'||Array.isArray(patch))bad('Настройки должны быть объектом');
 const defaults=kind==='operator'?operatorDefaults:roomDefaults,result={...defaults,...current};
 for(const [key,value] of Object.entries(patch)){
  if(!Object.hasOwn(defaults,key))bad('Неизвестная настройка: '+key);
  if(['enabled','open'].includes(key)){if(typeof value!=='boolean')bad('Ожидается переключатель: '+key);}
  else if(key==='expiresAt'){if(value!==null&&(!Number.isSafeInteger(value)||value<=0||value>8640000000000000))bad('Некорректный срок доступа');}
  else if(key==='preferredRoomId'){if(value!==null&&(typeof value!=='string'||!/^room_[a-f0-9]{20}$/.test(value)))bad('Некорректная предпочтительная комната');}
  else if(key==='profile'){if(!['auto','economy','standard','detail'].includes(value))bad('Некорректный профиль качества');}
  else if(key==='color'){if(!['blue','green','orange','purple','slate'].includes(value))bad('Некорректный цвет комнаты');}
  else if(key==='maxOperators'){if(!Number.isInteger(value)||value<0||value>141)bad('Лимит назначенных операторов: 0–141 (0 — без лимита)');}
  else if(key==='sortOrder'){if(!Number.isInteger(value)||value<0||value>999)bad('Порядок комнат: 0–999');}
  else {const max={team:80,device:120,notes:1000,description:1000,group:80}[key];if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b-\u001f\u007f]/.test(value))bad('Некорректный текст: '+key);}
  result[key]=typeof value==='string'?value.trim():value;
 }
 return result;
}
export function validatedName(value,max){if(typeof value!=='string'||!value.trim()||value.trim().length>max||/[\u0000-\u001f\u007f]/.test(value))bad('Имя: 1–'+max+' символов без управляющих символов');return value.trim();}
