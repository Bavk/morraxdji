const fs=require('node:fs/promises');
const path=require('node:path');
const MIN_FREE=256*1024*1024,WARN_FREE=1024*1024*1024;
function formatSpace(bytes){return bytes>=1024**3?`${(bytes/1024**3).toFixed(2)} ГиБ`:`${Math.floor(bytes/1024**2)} МиБ`;}
async function checkRecordingSpace(filePath,{statfs=fs.statfs}={}){
 let free;
 try{const info=await statfs(path.dirname(filePath),{bigint:true});if(typeof info.bavail!=='bigint'||typeof info.bsize!=='bigint'||info.bavail<0n||info.bsize<=0n)throw Error();free=Number(info.bavail*info.bsize);if(!Number.isSafeInteger(free)||free<0)throw Error();}
 catch{throw Error('Не удалось определить свободное место в выбранной папке. Проверьте доступ к диску или выберите другую папку.');}
 if(free<MIN_FREE)throw Error(`Недостаточно места для начала записи: свободно ${formatSpace(free)}. Требуется не менее 256 МиБ. Выберите другой диск или освободите место.`);
 return {freeBytes:free,low:free<WARN_FREE};
}
async function prepareRecordingSpace(filePath,{check=checkRecordingSpace,confirmLow=async()=>false}={}){
 const result=await check(filePath);if(!result.low)return result;
 if(!await confirmLow(result))return {canceled:true};
 return check(filePath);
}
module.exports={MIN_FREE,WARN_FREE,formatSpace,checkRecordingSpace,prepareRecordingSpace};
