import { Room,RoomEvent,Track } from 'livekit-client';
import './style.css';
import {monitorStream,formatHealth} from './stream-health.mjs';
import {MultiRoomViewer} from './multi-room-viewer.mjs';
import {ViewerReconnect} from './viewer-reconnect.mjs';
import {LoopbackTest,createTestPattern} from './loopback-test.mjs';
const el=document.querySelector('#app');
let rooms=[];let active=null;let session=null;let tiles=new Map();let serverInfo=null;
let presence=new Map();let presenceTimer=null;let presenceRequest=0;
let wallMode=false;
let wallStates=new Map();
let connectionSerial=0; let focusedTile=null;
let gridColumns=Number(localStorage.getItem('usc-grid-columns'))||0;
const reconnect=new ViewerReconnect({
 onRetry:id=>{if(active===id && !session)connectRoom(id,{retry:true});},
 onWaiting:(id,delay)=>{if(active===id){const x=q('#roomInfo');if(x)x.textContent=`Видеосервер недоступен — повтор через ${Math.ceil(delay/1000)} с`;}}
});
const q=(s)=>document.querySelector(s);
const videoTest=new LoopbackTest({
 createRoom:()=>new Room(),createPattern:()=>createTestPattern(),screenShareSource:Track.Source.ScreenShare,
 onStatus:message=>{const x=q('#selfTestStatus');if(x)x.textContent=message;},
 onStateChange:active=>{const b=q('#selfTest');if(b)b.textContent=active?'■ Остановить тест':'🧪 Проверить видео';}
});
const wall=new MultiRoomViewer({
 createRoom:()=>new Room({adaptiveStream:true}),getConfig:id=>window.streamControl.viewRoom(id),events:RoomEvent,
 onTrack:(track,pub,p,room)=>attachTrack(track,pub,p,room.id,room.name),
 onUntrack:(track,pub,p,room)=>detachTrack(track,pub,p,room.id),
 onLeave:(p,room)=>removeParticipant(p,room.id),onClear:id=>removeRoomTiles(id),
 onState:(room,state)=>{wallStates.set(room.id,state);updateWallStatus();}
});
const escapeHtml=(text)=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const showError=(err)=>{const e=q('#error');if(e){e.textContent=err.message||String(err);e.hidden=false;}else alert(err.message||String(err));};
async function startup(){
 try{
  serverInfo=await window.streamControl.status();
  if(serverInfo.running){rooms=(await window.streamControl.rooms()).rooms;dashboard();await refresh();}
  else startScreen();
 }catch(err){startScreen();showError(err);}
}
async function startScreen(){
 if(presenceTimer){clearInterval(presenceTimer);presenceTimer=null;}
 const info=await window.streamControl.status();
 const options=info.ips.map(ip=>`<option value="${escapeHtml(ip)}">${escapeHtml(ip)}</option>`).join('');
 const configured=info.vpn?.configured===true;
 el.innerHTML=`<section class="login"><div class="login-card"><div class="brand">◉ UNIVERSAL STREAM CONTROL</div>
 <h1>Windows — сервер и мониторинг</h1><p>Выберите локальную сеть или защищённый VPN для операторов из любых сетей.</p>
 <form id="startForm"><label>Режим соединения</label>
 <select id="networkMode"><option value="vpn" ${configured?'':'disabled'}>VPN — интернет через ретранслятор ${configured?'':'(сначала настройте)'}</option>
 <option value="lan" ${configured?'':'selected'}>LAN — только локальная сеть (отладка)</option></select>
 <label>Локальный IPv4 ПК (для режима LAN)</label>
 <select id="localIp">${options||'<option value="">IPv4 не обнаружен</option>'}</select>
 <button id="startButton" class="primary" type="submit" ${!info.ips.length&&!configured?'disabled':''}>▶ Запустить сервер и просмотр</button></form>
 <details class="vpn-settings" ${configured?'':'open'}><summary>🔒 VPN / подключение через интернет</summary>
 ${configured?`<p class="small-note">Настройка сохранена. VPN IP Windows: ${escapeHtml(info.vpn.windowsIp)}.<br/>
 Конфигурация: <code>${escapeHtml(info.vpn.configPath||'')}</code><br/>
 <button id="activateVpn" class="primary" type="button">⚡ Включить VPN на Windows</button><br/>После подтверждения Windows UAC выберите режим VPN и запустите сервер.</p>`:
 `<form id="vpnSetup">
 <label>HTTPS API ретранслятора</label><input id="relayApi" type="url" required placeholder="https://vpn.example.com/" />
 <label>UDP endpoint WireGuard</label><input id="relayEndpoint" required placeholder="vpn.example.com:51820" />
 <label>Публичный ключ WireGuard ретранслятора</label><input id="relayPub" required placeholder="Ключ Base64" />
 <label>Токен управления ретранслятором</label><input id="relayToken" type="password" required autocomplete="off" />
 <button class="minor" type="submit">Сохранить VPN и создать конфигурацию Windows</button></form>`}</details>
 <button id="runDiagnostics" class="minor" type="button">🔎 Проверить готовность Windows</button>
 <button id="saveDiagnostics" class="minor" type="button">📄 Сохранить диагностику без ключей</button>
 <button id="recoverServer" class="minor" type="button" hidden>♻ Завершить оставшийся LiveKit и восстановить запуск</button><p id="diagResult" class="small-note" aria-live="polite"></p><p class="small-note">Видеосервер LiveKit встроен и запускается автоматически без Docker. VPN требует однократной настройки Linux-ретранслятора и WireGuard на Windows; Android VPN встроен в APK.</p>
 <p class="error" id="error" hidden></p></div></section>`;
 const mode=q('#networkMode');mode.value=configured?'vpn':'lan';
 const activate=q('#activateVpn');
 if(activate)activate.onclick=async()=>{
   activate.disabled=true;activate.textContent='Ожидание подтверждения Windows UAC…';
   try{const d=await window.streamControl.activateVpn();q('#diagResult').textContent=d.vpnInterfaceUp?'VPN включён — теперь можно запускать сервер.':'Команда выполнена, но VPN-адрес ещё не появился. Проверьте WireGuard.';}
   catch(err){showError(err);}finally{activate.disabled=false;activate.textContent='⚡ Включить VPN на Windows';}
 };
 q('#runDiagnostics').onclick=async()=>{
   const button=q('#runDiagnostics');button.disabled=true;
   try{
     const d=await window.streamControl.diagnostics();
     const busy=(d.ports||[]).filter(p=>!p.available).map(p=>`${p.port}/${p.protocol}`).join(', ');
     const relayState=!d.vpnConfigured?'ещё не настроен':d.relay?.reachable?(d.relay.legacy?'доступен, но требуется обновить API на VPS':d.relay.windowsRegistered?'API доступен, Windows зарегистрирован':'API доступен, Windows НЕ зарегистрирован'):'нет связи с VPN-шлюзом';
     const recovery=q('#recoverServer');if(recovery)recovery.hidden=!(d.previousServer?.running && !d.ports.every(p=>p.available));
     q('#diagResult').textContent=`Встроенный LiveKit: ${d.nativeReady?'готов':'не найден — переустановите приложение'} · WireGuard: ${d.wireGuardInstalled?'установлен':'не установлен'}, ${d.vpnConfigured?(d.vpnInterfaceUp?'VPN активен':'VPN выключен'):'VPN не настроен'} · VPS: ${relayState} · Порты: ${busy?'заняты '+busy:'свободны'} · IP: ${d.ips.join(', ')||'нет'}`;
   }catch(err){showError(err);}finally{button.disabled=false;}
 };
 q('#saveDiagnostics').onclick=async()=>{
  try{const result=await window.streamControl.saveDiagnostics();
    if(result.saved)q('#diagResult').textContent='Отчёт сохранён. Ключи, адреса и сведения об операторах не включены.';
  }catch(err){showError(err);}
 };
 q('#recoverServer').onclick=async()=>{
   if(!confirm('Завершить оставшийся LiveKit предыдущего запуска? Активные трансляции будут прерваны. Комнаты и ключи сохранятся.'))return;
   const btn=q('#recoverServer');btn.disabled=true;
   try{const result=await window.streamControl.recoverServer();
     q('#diagResult').textContent=result.recovered?'Предыдущий LiveKit завершён. Запустите сервер ещё раз.':'Предыдущий LiveKit не найден.';
     btn.hidden=true;
   }catch(err){showError(err);}finally{btn.disabled=false;}
 };
 q('#startForm').onsubmit=async e=>{
  e.preventDefault();const btn=q('#startButton');btn.disabled=true;btn.textContent='Запуск LiveKit и API…';
  try{serverInfo=await window.streamControl.startServer(q('#localIp').value,mode.value);rooms=(await window.streamControl.rooms()).rooms;dashboard();await refresh();}
  catch(err){showError(err);btn.disabled=false;btn.textContent='▶ Повторить запуск';
   // If a previous Windows process crashed, its native LiveKit process may still own the ports.
   try{const d=await window.streamControl.diagnostics();
     if(d.previousServer?.running){q('#recoverServer').hidden=false;
       q('#diagResult').textContent='Обнаружен LiveKit от предыдущего запуска. Используйте кнопку восстановления, затем повторите запуск.';}
   }catch{}
  }
 };
 const form=q('#vpnSetup');
 if(form)form.onsubmit=async e=>{
  e.preventDefault();const btn=form.querySelector('button');btn.disabled=true;
  try{
   const cfg=await window.streamControl.configureVpn({baseUrl:q('#relayApi').value.trim(),endpoint:q('#relayEndpoint').value.trim(),
    relayPublicKey:q('#relayPub').value.trim(),adminToken:q('#relayToken').value.trim()});
   await startScreen();alert(`Конфигурация VPN сохранена:\n${cfg.configPath}\n\nНажмите «Включить VPN на Windows». Если WireGuard не установлен, установите его заранее.`);
  }catch(err){showError(err);btn.disabled=false;}
 };
}
function dashboard(){
 if(presenceTimer)clearInterval(presenceTimer);
 presenceTimer=setInterval(()=>{if(active)pollPresence();},8000);
 el.innerHTML=`<div class="layout"><aside class="sidebar"><div class="brand">◉ UNIVERSAL STREAM CONTROL</div><div class="sectionlabel">КОМНАТЫ</div>
 <button id="allControllers" class="minor wall-button">▦ Все пульты</button><div id="roomList" class="room-list"></div><button id="addRoom" class="minor">+ Создать комнату</button>
 <div class="sidebar-footer"><div class="server-live">● СЕРВЕР ЗАПУЩЕН</div><div id="modeInfo"></div>
 <div id="endpoint" class="endpoint"></div><div id="pendingRoomCleanup" class="muted" role="status"></div><button id="copyUrl" class="minor">Копировать адрес</button>
 <button id="reconcileRevoked" class="minor">Проверить отключения операторов</button>
 <button id="saveDashboardDiagnostics" class="minor">📄 Сохранить диагностику</button>
 <button id="cleanupVpn" class="minor" ${serverInfo?.mode==='vpn'?'':'hidden'}>Проверить отзыв VPN-ключей</button>
 <button id="stopServer" class="danger">Остановить сервер</button><br/>Только видеотрансляции<br/>Звук и чат отключены</div></aside>
 <main class="main"><header><div><div id="roomTitle" class="room-title">Выберите комнату</div><span id="roomInfo" class="muted">Мониторинг операторов</span></div>
 <div class="toolbar"><label class="grid-picker">Сетка <select id="gridColumns">
 <option value="0">Авто</option><option value="1">1 столбец</option><option value="2">2 столбца</option><option value="3">3 столбца</option><option value="4">4 столбца</option>
 </select></label><button id="wallFullscreen" class="minor">Во весь экран</button><button id="selfTest" class="minor" disabled>🧪 Проверить видео</button><button id="newKey" class="primary" disabled>+ Ключ оператора</button><button id="refresh" class="minor">Обновить</button></div></header>
 <div id="alert" class="alert" hidden></div><div id="selfTestStatus" class="self-test-status" aria-live="polite"></div><div id="wallRoomStates" class="wall-room-states" hidden></div><div id="presenceSummary" class="presence-summary">Обновление статуса операторов…</div><section id="content" class="content"><div class="empty">Выберите комнату слева</div></section>
 <section class="keys-panel"><div class="keys-head"><h2>Ключи операторов</h2><button id="deleteRoom" class="danger" disabled>Удалить комнату</button></div><div id="keys"></div></section></main></div>`;
 q('#allControllers').onclick=()=>selectAllControllers();
 q('#wallFullscreen').onclick=()=>q('#content').requestFullscreen?.().catch(displayErr);
 q('#endpoint').textContent=serverInfo?.operatorUrl||'';
 q('#modeInfo').textContent=serverInfo?.mode==='vpn'?'🔒 WireGuard VPN':'LAN / локальная сеть';
 q('#copyUrl').onclick=()=>navigator.clipboard.writeText(serverInfo?.operatorUrl||'').catch(err=>displayErr(err));
 const cleanup=q('#cleanupVpn');
 cleanup.onclick=async()=>{
  cleanup.disabled=true;
  try{const result=await window.streamControl.cleanupRevokedVpn();
   if(result.failed?.length)displayErr(new Error(`Не удалось удалить ${result.failed.length} VPN-пиров. Проверьте доступность VPS и повторите.`));
   else alert(`Проверка завершена. Удалено оставшихся VPN-пиров: ${result.removed}.`);
  }catch(err){displayErr(err);}finally{cleanup.disabled=false;}
 };
 q('#saveDashboardDiagnostics').onclick=async()=>{
  try{const result=await window.streamControl.saveDiagnostics();
    if(result.saved)alert('Диагностика сохранена без кодов и ключей операторов.');
  }catch(err){displayErr(err);}
 };
 q('#reconcileRevoked').onclick=async()=>{
   const button=q('#reconcileRevoked');button.disabled=true;
   try{
     const result=await window.streamControl.reconcileRevoked();
     if(result.failures.length || result.pendingRoomFailures?.length){
       displayErr(new Error(`Не удалось завершить отключение: ${result.failures.length} операторов, ${result.pendingRoomFailures?.length||0} удалённых комнат. Повторите после восстановления LiveKit.`));
     }else alert(`Отключено операторов: ${result.participantsRemoved}; завершено удаление комнат: ${result.pendingRoomsRemoved||0}.`);
     await refresh(false);
   }catch(err){displayErr(err);}finally{button.disabled=false;}
 };
 q('#stopServer').onclick=async()=>{
  if(!confirm('Остановить все трансляции и локальный сервер?'))return;
  try{await disconnect();await window.streamControl.stopServer();rooms=[];active=null;wallMode=false;serverInfo=null;startScreen();}
  catch(err){displayErr(err);}
 };
 q('#addRoom').onclick=async()=>{const name=prompt('Название новой комнаты');if(!name?.trim())return;try{await window.streamControl.createRoom(name.trim());await refresh();}catch(err){displayErr(err);}};
 q('#newKey').onclick=async()=>{if(!active)return;const name=prompt('Название оператора (например: Оператор 01)');if(!name?.trim())return;
 try{const data=await window.streamControl.createKey(active,name.trim());await refresh(false);showKey(data.key,name);}catch(err){displayErr(err);}};
 q('#selfTest').onclick=async()=>{
   const button=q('#selfTest');
   if(videoTest.active){videoTest.stop();button.textContent='🧪 Проверить видео';return;}
   if(!active)return;
   button.disabled=true;
   try{
     if(!session || session.state!=='connected')await connectRoom(active);
     if(!session || session.state!=='connected')throw Error('Сначала дождитесь подключения комнаты');
     const config=await window.streamControl.selfTestRoom(active);
     await videoTest.start(config);
     button.textContent='■ Остановить тест';
   }catch(err){displayErr(err);videoTest.stop(true);button.textContent='🧪 Проверить видео';}
   finally{button.disabled=false;}
 };
 q('#gridColumns').value=String([0,1,2,3,4].includes(gridColumns)?gridColumns:0);
 q('#gridColumns').onchange=e=>{gridColumns=Number(e.target.value);localStorage.setItem('usc-grid-columns',String(gridColumns));applyGridLayout();};
 q('#refresh').onclick=()=>refresh(false);
 q('#deleteRoom').onclick=async()=>{if(!active)return;const r=rooms.find(x=>x.id===active);if(!confirm(`Удалить комнату «${r?.name}»?`))return;
 try{const result=await window.streamControl.deleteRoom(active);active=null;await disconnect();await refresh(false);
   if(result?.warning)displayErr(new Error(result.warning));}catch(err){displayErr(err);}};
 paintRoomList();
}
function displayErr(err){const a=q('#alert');a.hidden=false;a.textContent=err.message||String(err);}
function showKey(key,name){
 const dialog=document.createElement('dialog');dialog.className='key-dialog';
 dialog.innerHTML=`<h2>Код для ${escapeHtml(name)}</h2><p>${serverInfo?.mode==='vpn'?'Единый код: вставить в Android APK — VPN и поток подключатся автоматически.':'LAN: ключ и локальный IP передайте оператору.'} Показывается один раз; передавайте конфиденциально.</p>
 <textarea readonly rows="3"></textarea><div class="actions"><button id="copyKey" class="primary">Скопировать код</button><button id="closeKey" class="minor">Закрыть</button></div>`;
 dialog.querySelector('textarea').value=key;
 document.body.append(dialog);dialog.showModal();
 dialog.querySelector('#copyKey').onclick=()=>navigator.clipboard.writeText(key).then(()=>alert('Ключ скопирован')).catch(()=>{dialog.querySelector('textarea').select();document.execCommand('copy');});
 dialog.querySelector('#closeKey').onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove());
}
function paintRoomList(){
 q('#roomList').innerHTML=rooms.map(r=>`<button class="room ${active===r.id?'selected':''}" data-room="${r.id}">
 <span>▣</span><span>${escapeHtml(r.name)}</span><small>${r.keys.filter(k=>!k.revoked).length}</small></button>`).join('')||'<p class="muted">Пока нет комнат</p>';
 q('#roomList').querySelectorAll('[data-room]').forEach(btn=>btn.onclick=()=>selectRoom(btn.dataset.room));
 q('#allControllers').classList.toggle('selected',wallMode);
 const panel=q('.keys-panel');if(panel)panel.hidden=wallMode;
 if(wallMode){q('#roomTitle').textContent='Все ФПВ-пульты';q('#newKey').disabled=true;q('#deleteRoom').disabled=true;q('#selfTest').disabled=true;q('#keys').textContent='';updateWallStatus();return;}
 const r=rooms.find(r=>r.id===active);q('#newKey').disabled=!r;q('#deleteRoom').disabled=!r;
 q('#selfTest').disabled=!r;
 q('#roomTitle').textContent=r?.name||'Выберите комнату';q('#roomInfo').textContent=r?'Операторы в комнате — трансляция экрана':'Мониторинг операторов';
 if(r)paintKeys(r);else{q('#keys').innerHTML='<span class="muted">Ключей нет</span>';q('#content').innerHTML='<div class="empty">Выберите комнату слева</div>';}
}
function paintKeys(r){
 q('#keys').innerHTML=r.keys.length?r.keys.map(k=>{const state=presence.get(k.id);const stateName=k.revoked?'Отозван':state?.streaming?'● Транслирует':state?.online?'● Подключён':'○ Не в сети';const cls=k.revoked?'muted':state?.streaming?'streaming':state?.online?'online':'muted';return `<div class="key-row"><span>${escapeHtml(k.name)}</span><span class="${cls}">${stateName}</span>
 ${k.revoked?'':`<button class="danger" data-revoke="${k.id}">Отозвать</button>`}</div>`;}).join(''):'<span class="muted">Нажмите «Ключ оператора» для подключения первого пульта</span>';
 q('#keys').querySelectorAll('[data-revoke]').forEach(btn=>btn.onclick=async()=>{if(!confirm('Отозвать этот ключ?'))return;
 try{const result=await window.streamControl.revokeKey(r.id,btn.dataset.revoke);await refresh(false);if(result?.warning)displayErr(new Error(result.warning));}catch(err){displayErr(err);}});
}
async function pollPresence(){
 const roomId=active; if(!roomId)return;
 const request=++presenceRequest;
 try{
  const response=await window.streamControl.roomPresence(roomId);
  if(active!==roomId||request!==presenceRequest)return;
  presence=new Map(response.operators.map(x=>[x.id,x]));
  const r=rooms.find(r=>r.id===roomId);
  const live=response.operators.filter(o=>o.streaming).length;
  const online=response.operators.filter(o=>o.online).length;
  const summary=q('#presenceSummary');if(summary)summary.textContent=`В эфире: ${live}   ·   Подключено: ${online}   ·   Всего ключей: ${r?.keys.filter(k=>!k.revoked).length||0}`;
  if(r)paintKeys(r);
 }catch(err){const summary=q('#presenceSummary');if(summary)summary.textContent='Не удалось получить статусы операторов (проверьте LiveKit)';}
}
async function refresh(fallback=true){try{const data=await window.streamControl.rooms();rooms=data.rooms;
 const pending=q('#pendingRoomCleanup');if(pending)pending.textContent=data.pendingDeletedRooms?`Защита удалённых комнат (старые токены): ${data.pendingDeletedRooms}`:'';
 if(!rooms.some(r=>r.id===active)){active=!wallMode&&fallback&&rooms.length?rooms[0].id:null;}
 paintRoomList();if(wallMode){await wall.sync(rooms);updateWallStatus();}else if(active){await pollPresence();if(!session)await connectRoom(active);}}catch(err){displayErr(err);}}
async function selectRoom(id){if(!wallMode&&active===id&&session)return;await disconnect();wallMode=false;wallStates.clear();q('#wallRoomStates').hidden=true;videoTest.stop(true);active=id;presence=new Map();paintRoomList();await Promise.all([pollPresence(),connectRoom(id)]);}
function clearTiles(){
 for(const entry of tiles.values()){entry.stopMonitor?.();entry.track.detach();entry.item.remove();}
 tiles.clear();focusedTile=null;
}
async function disconnect(){
 wall.stop();wallStates.clear();
 videoTest.stop(true);
 connectionSerial++;reconnect.stop();
 const prev=session;session=null;
 if(prev)prev.disconnect();
 clearTiles();
}
function applyGridLayout(){
 const grid=q('#grid');if(!grid)return;
 grid.style.setProperty('--grid-columns',gridColumns?String(gridColumns):'0');
 grid.classList.toggle('fixed-grid',gridColumns>0);
 grid.classList.toggle('focused-grid',Boolean(focusedTile));
 for(const [id,entry] of tiles){
  entry.item.hidden=Boolean(focusedTile && id!==focusedTile);
  entry.item.classList.toggle('is-focused',id===focusedTile);
  entry.focus.textContent=id===focusedTile?'Вернуть сетку':'Крупно';
 }
}
function focusTile(id){focusedTile=focusedTile===id?null:id;applyGridLayout();}
async function connectRoom(id,{retry=false}={}){
 if(!retry)reconnect.stop();
 const generation=++connectionSerial;
 if(session){const old=session;session=null;old.disconnect();}
 clearTiles();
 const content=q('#content');if(!content)return;
 content.innerHTML='<div class="empty">Подключение к комнате…</div>';
 let current;
 const valid=()=>id===active && generation===connectionSerial;
 try{
  const config=await window.streamControl.viewRoom(id);
  if(!valid())return;
  current=new Room({adaptiveStream:true});session=current;
  content.innerHTML='<div id="grid" class="stream-grid"></div><div id="placeholder" class="empty">Ожидание подключения операторов…</div>';
  applyGridLayout();
  current.on(RoomEvent.TrackSubscribed,(track,pub,participant)=>{if(valid() && session===current)attachTrack(track,pub,participant);});
  current.on(RoomEvent.TrackUnsubscribed,(track,pub,participant)=>{if(valid() && session===current)detachTrack(track,pub,participant);});
  current.on(RoomEvent.ParticipantDisconnected,p=>{if(valid() && session===current)removeParticipant(p);});
  current.on(RoomEvent.Reconnecting,()=>{if(valid() && session===current){const x=q('#roomInfo');if(x)x.textContent='Восстановление видеосоединения…';}});
  current.on(RoomEvent.Reconnected,()=>{if(valid() && session===current){const x=q('#roomInfo');if(x)x.textContent='Трансляции экрана операторов';reconnect.success();}});
  current.on(RoomEvent.Disconnected,()=>{
   if(!valid()||session!==current)return;
   session=null;clearTiles();updatePlaceholder();
   const x=q('#roomInfo');if(x)x.textContent='Сеанс завершён — повторное подключение';
   reconnect.failure(id);
  });
  await current.connect(config.wsUrl,config.token);
  if(!valid()||session!==current){current.disconnect();return;}
  reconnect.success();
  const x=q('#roomInfo');if(x)x.textContent='Трансляции экрана операторов';
  current.remoteParticipants.forEach(p=>p.trackPublications.forEach(pub=>{if(pub.track && pub.isSubscribed)attachTrack(pub.track,pub,p);}));
 }catch(err){
  if(current)current.disconnect();
  if(!valid())return;
  if(session===current)session=null;
  clearTiles();
  displayErr(err);
  content.innerHTML='<div class="empty">Не удалось подключиться к комнате — повторяем попытку…</div>';
  reconnect.failure(id);
 }
}
function attachTrack(track,pub,p,roomId=active,roomName=null){
 if(track.kind!==Track.Kind.Video || pub.source!==Track.Source.ScreenShare)return;
 const id=`${roomId}:${p.identity}:${pub.trackSid}`;if(tiles.has(id))return;
 const grid=q('#grid');if(!grid)return;
 const item=document.createElement('article');item.className='tile';
 const video=document.createElement('video');video.autoplay=true;video.playsInline=true;video.muted=true;
 const footer=document.createElement('div');footer.className='tile-footer';const n=document.createElement('span');n.textContent=(roomName?roomName+' · ':'')+(p.name||p.identity);n.title=n.textContent;
 const badge=document.createElement('span');badge.className='online';badge.textContent='Ожидание видео';
 const focus=document.createElement('button');focus.className='focus-button';focus.textContent='Крупно';focus.title='Увеличить выбранный поток';focus.onclick=()=>focusTile(id);
 const visual=document.createElement('div');visual.className='tile-visual';
 const warning=document.createElement('div');warning.className='stream-stale';warning.hidden=true;warning.setAttribute('role','status');
 const metrics=document.createElement('div');metrics.className='tile-metrics';metrics.textContent='Получение статистики…';
 metrics.title='Параметры приёма на этом Windows-ПК. RTT — путь до видеосервера и обратно, не задержка изображения с пульта.';
 warning.title='Кадр мог перестать обновляться из-за неподвижного экрана, паузы захвата или проблем связи.';
 visual.append(video,warning);footer.append(n,badge,focus);item.append(visual,footer,metrics);video.ondblclick=()=>item.requestFullscreen?.();
 grid.append(item);track.attach(video);
 const entry={item,track,focus,roomId,badge,warning,metrics,health:null};tiles.set(id,entry);
 entry.stopMonitor=monitorStream({track,video,isActive:()=>!item.hidden&&!track.isMuted,onUpdate:sample=>{
  if(tiles.get(id)!==entry)return;entry.health=sample;renderEntryHealth(entry);if(wallMode)updateWallStatus();
 }});if(p.identity===videoTest.identity){
  if(typeof video.requestVideoFrameCallback==='function')video.requestVideoFrameCallback(()=>videoTest.onVideoFrame(p.identity));
  else video.addEventListener('playing',()=>videoTest.onVideoFrame(p.identity),{once:true});
 }
 applyGridLayout();updatePlaceholder();
}
function detachTrack(track,pub,p,roomId=active){const id=`${roomId}:${p.identity}:${pub.trackSid}`;const obj=tiles.get(id);if(obj){obj.stopMonitor?.();obj.track.detach();obj.item.remove();tiles.delete(id);}if(focusedTile===id)focusedTile=null;applyGridLayout();updatePlaceholder();}
function removeParticipant(p,roomId=active){for(const [id,t] of tiles){if(id.startsWith(roomId+':'+p.identity+':')){t.stopMonitor?.();t.track.detach();t.item.remove();tiles.delete(id);if(focusedTile===id)focusedTile=null;}}applyGridLayout();updatePlaceholder();}
function updatePlaceholder(){const placeholder=q('#placeholder');if(placeholder)placeholder.hidden=tiles.size>0;if(wallMode)updateWallStatus();}
window.addEventListener('beforeunload',()=>{wall.stop();videoTest.stop(true);reconnect.stop();session?.disconnect();});
async function selectAllControllers(){
 await disconnect();wallMode=true;active=null;wallStates.clear();
 q('#content').innerHTML='<div id="grid" class="stream-grid"></div><div id="placeholder" class="empty">Ожидание трансляций со всех пультов…</div>';
 applyGridLayout();paintRoomList();await wall.sync(rooms);updateWallStatus();
}
function removeRoomTiles(roomId){
 for(const [id,t] of tiles)if(t.roomId===roomId){t.stopMonitor?.();t.track.detach();t.item.remove();tiles.delete(id);if(focusedTile===id)focusedTile=null;}
 applyGridLayout();updatePlaceholder();
}
function updateWallStatus(){
 if(!wallMode)return;
 for(const entry of tiles.values())renderEntryHealth(entry);
 const connected=rooms.filter(r=>wallStates.get(r.id)==='connected').length;
 const waiting=rooms.filter(r=>wallStates.get(r.id)==='reconnecting').length;
 const info=q('#roomInfo');if(info)info.textContent='Общая видеостена · '+rooms.length+' комнат';
 const stale=[...tiles.values()].filter(t=>!t.item.hidden&&t.health?.state==='stale').length;
 const summary=q('#presenceSummary');if(summary)summary.textContent='Видеопотоков: '+tiles.size+' · Комнат подключено: '+connected+'/'+rooms.length+(waiting?' · Переподключение: '+waiting:'')+(stale?' · Без новых кадров: '+stale:'');
 const states=q('#wallRoomStates');if(states){states.hidden=false;states.innerHTML=rooms.map(r=>{
  const state=wallStates.get(r.id)||'connecting';const labels={connected:'подключена',connecting:'подключение…',reconnecting:'восстановление…'};
  return '<span class="wall-room-state '+state+'">'+escapeHtml(r.name)+' · '+labels[state]+'</span>';
 }).join('')||'<span class="muted">Создайте комнату и подключите пульт.</span>';}
 const placeholder=q('#placeholder');if(placeholder)placeholder.textContent=rooms.length?'Ожидание трансляций со всех пультов…':'Пока нет комнат. Создайте комнату для подключения пультов.';
}
function renderEntryHealth(entry){
 const sample=entry.health;
 const connected=wallMode?wallStates.get(entry.roomId)==='connected':session?.state==='connected';
 const stale=connected&&sample?.state==='stale';
 entry.badge.textContent=!connected?'↻ Восстановление связи':stale?'⚠ Нет новых кадров':sample?.state==='live'?'● LIVE':sample?.state==='paused'?'Пауза':'Ожидание видео';
 entry.badge.classList.toggle('tile-reconnecting',!connected||stale);
 entry.item.classList.toggle('is-stale',Boolean(stale));entry.warning.hidden=!stale;
 if(stale)entry.warning.textContent='Нет новых кадров · '+Math.floor(sample.ageMs/1000)+' с';
 if(sample)entry.metrics.textContent=sample.state==='paused'?'Приём приостановлен для скрытого или выключенного потока':formatHealth(sample);
}
startup();
