'use strict';
// Safe, allowlisted support report. Never export token, invite, operator names,
// room data, config file locations, full IP addresses or WireGuard secrets.
function makeDiagnosticReport({diag={},status={},version='unknown',now=new Date()}={}) {
  const state = {
    applicationVersion:String(version).slice(0,32),
    serverRunning:status.running===true,
    serverMode:status.mode==='vpn'?'vpn':'lan',
    nativeReady:diag.nativeReady===true,
    vpnConfigured:diag.vpnConfigured===true,
    vpnInterfaceUp:diag.vpnInterfaceUp===true,
    wireGuardInstalled:diag.wireGuardInstalled===true,
    relayReachable:diag.relay?.reachable===true,
    relayWindowsRegistered:diag.relay?.windowsRegistered===true,
    relayLegacyApi:diag.relay?.legacy===true,
    managedServerRunning:diag.previousServer?.running===true,
    ports:(Array.isArray(diag.ports)?diag.ports:[]).map(p=>({
      port:Number.isInteger(p.port)?p.port:null,
      protocol:p.protocol==='udp'?'udp':'tcp',
      available:p.available===true
    })).filter(p=>p.port!==null)
  };
  const guidance=[];
  if(!state.nativeReady)guidance.push('Встроенный LiveKit не найден. Переустановите приложение.');
  if(state.serverMode==='vpn' || state.vpnConfigured) {
    if(!state.wireGuardInstalled)guidance.push('Установите WireGuard для Windows.');
    if(!state.vpnInterfaceUp)guidance.push('Включите VPN-туннель Windows.');
    if(!state.relayReachable)guidance.push('Проверьте доступность VPN-ретранслятора.');
    else if(!state.relayWindowsRegistered)guidance.push('Windows не зарегистрирован на VPN-ретрансляторе.');
  }
  if(state.ports.some(p=>!p.available)&&!state.serverRunning)guidance.push('Проверьте конфликтующие порты и оставшийся процесс LiveKit.');
  return {format:'usc-support-v1',generatedAt:new Date(now).toISOString(),...state,guidance};
}
module.exports={makeDiagnosticReport};
