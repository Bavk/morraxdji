const {contextBridge,ipcRenderer}=require('electron');
const call=(name,...args)=>ipcRenderer.invoke(name,...args);
contextBridge.exposeInMainWorld('streamControl',Object.freeze({
  status:()=>call('server:status'),
  diagnostics:()=>call('server:diagnostics'),
  saveDiagnostics:()=>call('diagnostics:save'),
  beginRecording:label=>call('recording:begin',label),
  appendRecording:(id,bytes)=>call('recording:append',id,bytes),
  finishRecording:id=>call('recording:finish',id),
  recoverServer:()=>call('server:recover'),
  cleanupRevokedVpn:()=>call('vpn:cleanup'),
  vpnStatus:()=>call('vpn:status'),
  activateVpn:()=>call('vpn:activate'),
  configureVpn:(data)=>call('vpn:configure',data),
  startServer:(ip,mode)=>call('server:start',ip,mode),
  stopServer:()=>call('server:stop'),
  reconcileRevoked:()=>call('room:reconcile'),
  rooms:()=>call('room:list'),
  createRoom:(name)=>call('room:create',name),
  deleteRoom:(id)=>call('room:delete',id),
  createKey:(id,name)=>call('key:create',id,name),
  revokeKey:(id,keyId)=>call('key:revoke',id,keyId),
  viewRoom:(id)=>call('room:view',id),
  selfTestRoom:(id)=>call('room:selftest',id),
  roomPresence:(id)=>call('room:presence',id)
}));
