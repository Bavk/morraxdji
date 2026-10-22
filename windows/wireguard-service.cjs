'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');

const SERVICE_NAME='usc-host';
function windowsWireGuardPaths(env=process.env){
 return [env.ProgramFiles,env['ProgramFiles(x86)']].filter(Boolean).map(dir=>path.join(dir,'WireGuard','wireguard.exe'));
}
function findWireGuard({env=process.env,exists=fs.existsSync}={}){
 return windowsWireGuardPaths(env).find(exists)||null;
}
function psQuote(value){return `'${String(value).replace(/'/g,"''")}'`;}
function installationScript(exe,configPath){
 // Arguments for Start-Process need embedded Windows double quotes around paths with spaces.
 return `$wg=${psQuote(exe)}; $cfg=${psQuote(configPath)}; `+
   `$arguments='/installtunnelservice "'+$cfg+'"'; `+
   `$child=Start-Process -FilePath $wg -ArgumentList $arguments -Verb RunAs -Wait -PassThru; `+
   `if ($null -eq $child -or $child.ExitCode -ne 0) { throw 'Установка VPN-службы завершилась с ошибкой' }`;
}
function command(program,args,{timeoutMs=90000,run=spawn}={}){
 return new Promise((resolve,reject)=>{
  const child=run(program,args,{windowsHide:true,shell:false});let data='';let settled=false;
  const end=(error)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(data);};
  const timer=setTimeout(()=>{child.kill();end(Error('Истекло время ожидания WireGuard / подтверждения UAC'))},timeoutMs);
  child.on('error',e=>end(Error(`Невозможно запустить ${program}: ${e.message}`)));
  child.stdout?.on('data',b=>{data+=String(b);data=data.slice(-2000)});
  child.stderr?.on('data',b=>{data+=String(b);data=data.slice(-2000)});
  child.on('close',code=>end(code===0?null:Error(`${program} завершился с кодом ${code}: ${data}`)));
 });
}
async function installTunnel(configPath,options={}){
 if(process.platform!=='win32' && !options.allowTesting) throw Error('Автозапуск VPN доступен только на Windows');
 const exe=findWireGuard(options);
 if(!exe)throw Error('Не установлен WireGuard для Windows. Установите его с официального сайта wireguard.com/install/.');
 if(!fs.existsSync(configPath)||path.basename(configPath)!=='usc-host.conf')throw Error('Не найдена настроенная VPN-конфигурация usc-host.conf');
 await (options.execute||command)('powershell.exe',['-NoProfile','-NonInteractive','-Command',installationScript(exe,configPath)]);
 return {ok:true};
}
module.exports={SERVICE_NAME,windowsWireGuardPaths,findWireGuard,psQuote,installationScript,installTunnel};
