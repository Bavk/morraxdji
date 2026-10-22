'use strict';
const fs=require('node:fs');
const path=require('node:path');
// Never execute an arbitrary compose file. Only the app-owned project in userData/local-server
// may be stopped by the recovery button. This DOES NOT delete rooms or VPN keys.
function managedComposeFile(dataDir){
 const file=path.join(dataDir,'compose.yaml');
 if(!fs.existsSync(file))return null;
 const src=fs.readFileSync(file,'utf8');
 if(!/^name: universalstreamcontrol\s*$/m.test(src) || !/^\s*image: livekit\/livekit-server:v1\.13\.8\s*$/m.test(src))
  throw Error('Файл compose.yaml изменён или не принадлежит Universal Stream Control; автоматическое восстановление запрещено');
 if(!src.includes('./livekit.yaml:/etc/livekit.yaml:ro'))
  throw Error('Неизвестная конфигурация контейнера; автоматическое восстановление запрещено');
 return file;
}
async function recoverManagedServer(dataDir,run){
 const file=managedComposeFile(dataDir);
 if(!file)return {recovered:false,reason:'Старая конфигурация LiveKit не найдена'};
 await run('docker',['compose','-f',file,'down','--remove-orphans'],dataDir,40000);
 return {recovered:true};
}
async function inspectManagedServer(dataDir,run){
 const file=managedComposeFile(dataDir);
 if(!file)return {configured:false,running:false};
 const ids=(await run('docker',['compose','-f',file,'ps','--status','running','-q','livekit'],dataDir,12000)).trim();
 return {configured:true,running:Boolean(ids)};
}
module.exports={managedComposeFile,recoverManagedServer,inspectManagedServer};
