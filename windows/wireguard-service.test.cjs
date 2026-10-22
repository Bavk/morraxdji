'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {psQuote,findWireGuard,installationScript,installTunnel}=require('./wireguard-service.cjs');
test('WireGuard executable discovery prefers ProgramFiles and respects absences',()=>{
 const env={ProgramFiles:'C:\\Program Files'};
 assert.equal(findWireGuard({env,exists:(p)=>p.endsWith('wireguard.exe')}),path.join(env.ProgramFiles,'WireGuard','wireguard.exe'));
 assert.equal(findWireGuard({env,exists:()=>false}),null);
});
test('PowerShell arguments correctly escape apostrophes in Windows profile',()=>{
 assert.equal(psQuote("C:\\Users\\O'Neil"),"'C:\\Users\\O''Neil'");
 const script=installationScript('C:\\Program Files\\WireGuard\\wireguard.exe',"C:\\Users\\O'Neil\\AppData\\usc-host.conf");
 assert.match(script,/Start-Process/);assert.match(script,/O''Neil/);
 assert.match(script,/installtunnelservice/);assert.match(script,/Verb RunAs/);
});
test('VPN activation requires approved existing config and invokes elevation',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'usc-vpn-'));
 const file=path.join(dir,'usc-host.conf');fs.writeFileSync(file,'[Interface]\n');let ran=false;
 try{
  const result=await installTunnel(file,{allowTesting:true,env:{ProgramFiles:'C:\\Program Files'},exists:()=>true,execute:async(program,args)=>{ran=true;assert.equal(program,'powershell.exe');assert.ok(args[3].includes('usc-host.conf'));}});
  assert.equal(result.ok,true);assert.equal(ran,true);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
