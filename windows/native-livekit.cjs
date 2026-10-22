'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawn,execFile}=require('node:child_process');
const {promisify}=require('node:util');
const execute=promisify(execFile);
function binaryPath({packaged=false,resourcesPath='',baseDir=__dirname}={}){
 return packaged?path.join(resourcesPath,'livekit','livekit-server.exe'):path.join(baseDir,'vendor','livekit','livekit-server.exe');
}
class NativeLiveKit {
 constructor(executable,{launch=spawn,onExit=()=>{}}={}){this.executable=executable;this.launch=launch;this.onExit=onExit;this.child=null;this.output='';}
 get available(){return fs.existsSync(this.executable);}
 async start(configPath){
  if(this.child)throw Error('LiveKit уже запущен');
  if(!this.available)throw Error('Встроенный livekit-server.exe не найден. Переустановите приложение.');
  this.output='';
  const child=this.launch(this.executable,['--config',configPath],{cwd:path.dirname(configPath),windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
  this.child=child;
  for(const stream of [child.stdout,child.stderr])stream?.on('data',data=>{this.output=(this.output+String(data)).slice(-6000);});
  child.once('exit',(code)=>{if(this.child===child){this.child=null;this.onExit(code);}});
  try{await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});}
  catch(error){if(this.child===child)this.child=null;throw error;}
 }
 async stop(){
  const child=this.child;if(!child)return;
  this.child=null; // An intentional stop must not trigger the crash callback.
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('LiveKit не завершился за 10 секунд')),10000);
   child.once('exit',()=>{clearTimeout(timer);resolve();});
   if(child.exitCode!==null){clearTimeout(timer);resolve();return;}
   try{child.kill();}catch(error){clearTimeout(timer);reject(error);}
  });
 }
}
function quote(value){return `'${String(value).replaceAll("'","''")}'`;}
// Match the exact bundled executable AND this profile's config, never a process name/PID alone.
async function managedProcess(executable,dataDir,{terminate=false,run=execute}={}){
 if(process.platform!=='win32')return {configured:false,running:false};
 const config=path.join(dataDir,'livekit.yaml');
 const script=`$ErrorActionPreference='Stop'; $p=@(Get-CimInstance Win32_Process -Filter "Name='livekit-server.exe'" | Where-Object { $_.ExecutablePath -eq ${quote(executable)} -and $_.CommandLine.Contains(${quote(config)}) }); `+
  (terminate?`foreach($item in $p){$r=Invoke-CimMethod -InputObject $item -MethodName Terminate; if($r.ReturnValue -ne 0){throw 'Не удалось завершить LiveKit'}}; `:'')+
  `@{configured=$true;running=($p.Count -gt 0);recovered=${terminate?'($p.Count -gt 0)':'$false'}} | ConvertTo-Json -Compress`;
 const {stdout}=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:15000});
 return JSON.parse(stdout.trim());
}
module.exports={NativeLiveKit,binaryPath,managedProcess};
