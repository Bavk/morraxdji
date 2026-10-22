'use strict';
// Room deletion is authoritative on Windows. Never make it contingent on
// remote VPS availability. VPN peer removal is an idempotent follow-up that
// can be retried as long as the peer registry is retained on disk.
const {stalePeerIds}=require('./vpn-manager.cjs');

const cleanError=err=>String(err?.message||err).slice(0,140);

async function cleanupStalePeers({api,vpn}) {
  const peerIds=vpn.peerIds();
  if(!peerIds.length)return {removed:0,failed:[],remaining:0};
  const response=await api('GET','/api/admin/rooms');
  if(!Array.isArray(response?.rooms))throw Error('API не вернул список комнат');
  const stale=stalePeerIds(peerIds,response.rooms);
  if(!stale.length)return {removed:0,failed:[],remaining:0};
  if(!vpn.status().configured)throw Error('Найдены оставшиеся VPN-пиры, но настройки VPN отсутствуют');
  return vpn.cleanupRevoked(stale);
}

async function deleteRoomThenCleanup({id,api,vpn,cleanup}) {
  // Always delete locally FIRST. The API blocks new tokens immediately and
  // schedules disconnection from LiveKit if the media service is unreachable.
  const result=await api('DELETE',`/api/admin/rooms/${encodeURIComponent(id)}`);
  const warnings=[result.warning].filter(Boolean);
  let vpnRemovalPending=false;
  try {
    const outcome=await (cleanup ? cleanup() : cleanupStalePeers({api,vpn}));
    if(outcome.remaining>0){
      vpnRemovalPending=true;
      warnings.push(`Комната удалена. Не удалось отозвать ${outcome.remaining} VPN-подключений на VPS; повторная проверка выполнится автоматически.`);
    }
  }catch(err){
    vpnRemovalPending=true;
    warnings.push(`Комната удалена, но проверка VPN пока недоступна (${cleanError(err)}). Повтор будет выполнен автоматически.`);
  }
  return {...result,vpnRemovalPending,...(warnings.length?{warning:warnings.join(' ')}:{})};
}

module.exports={cleanupStalePeers,deleteRoomThenCleanup};
