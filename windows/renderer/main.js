import {StreamSessionClock,formatSessionDuration} from './stream-session-clock.mjs';
import {captureWallSnapshot,wallSnapshotSources} from './wall-snapshot.mjs';
import {StreamAlerts,AlertTone} from './stream-alert.mjs';
import {FavoriteSources} from './favorite-sources.mjs';
import {sourceDisplayName} from './source-name.mjs';
import {summarizeStreams,formatStreamSummary} from './wall-summary.mjs';
import {wallShortcut} from './wall-shortcuts.mjs';
import {confirmViewSwitch} from './view-switch.mjs';
import {showActiveRecordings} from './active-recordings.mjs';
import {filteredLayout} from './stream-filter.mjs';
import {recordingBusy,receiveEnabled,toggleReceive} from './receive-control.mjs';
import {WallLayout,sourceKey,showWallOrder} from './wall-layout.mjs';
import {frameTransition,showEventLog} from './event-log-view.mjs';
import { Room,RoomEvent,Track } from 'livekit-client';
import './style.css';
import {captureFrame} from './frame-snapshot.mjs';
import {showRecordingArchive} from './recording-archive-view.mjs';
import {StreamRecorder} from './stream-recorder.mjs';
import {monitorStream,formatHealth} from './stream-health.mjs';
import {MultiRoomViewer} from './multi-room-viewer.mjs';
import {ViewerReconnect} from './viewer-reconnect.mjs';
import {LoopbackTest,createTestPattern} from './loopback-test.mjs';
const el=document.querySelector('#app');
let rooms=[];let active=null;let session=null;let tiles=new Map();let serverInfo=null;
let presence=new Map();let presenceTimer=null;let presenceRequest=0;
const activeRecordings=new Set();
const recordingMetadata=new Map();let recordingSerial=0;
const activeSnapshots=new Set();let wallSnapshotPending=false;
const alertTone=new AlertTone();
const streamAlerts=new StreamAlerts({play:()=>alertTone.play(),onError:()=>{const checkbox=q('#streamSound');if(checkbox)checkbox.checked=false;const button=q('#testStreamSound');if(button)button.disabled=true;alertTone.stop();recordingNotice('Звуковой сигнал недоступен. Проверьте устройство вывода и включите сигнал снова.',true);}});
const pendingEvents=new Set();
const observedSources=new Map(),journalRoomStates=new Map();
let eventLogWarning=false;
function logEvent(kind,label){
 const pending=window.streamControl.logEvent(kind,String(label||'Комната')).catch(()=>{if(!eventLogWarning){eventLogWarning=true;recordingNotice('Журнал событий недоступен. Проверьте свободное место и права доступа к профилю приложения.',true);}});
 pendingEvents.add(pending);void pending.finally(()=>pendingEvents.delete(pending));
}
function roomEvent(room,state){
 if(state==='connecting'||journalRoomStates.get(room.id)===state)return;journalRoomStates.set(room.id,state);
 const kind={connected:'room-connected',reconnecting:'room-reconnecting'}[state];if(kind)logEvent(kind,room.name);
}
let closingRecordings=false;
let wallMode=false;
let wallStates=new Map();
let connectionSerial=0; let focusedTile=null;let streamQuery='';let favoritesOnly=false;
let layoutWarning=false;
const wallLayout=new WallLayout(localStorage,()=>{layoutWarning=true;});
const favoriteSources=new FavoriteSources(localStorage,()=>{layoutWarning=true;});
let gridColumns=wallLayout.columns;
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
 onState:(room,state)=>{roomEvent(room,state);wallStates.set(room.id,state);updateWallStatus();}
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
 <div id="powerSettings"></div><button id="openEvents" class="minor" type="button">Журнал событий</button><button id="openArchive" class="minor" type="button">▤ Архив записей</button>
 <button id="runDiagnostics" class="minor" type="button">🔎 Проверить готовность Windows</button>
 <button id="saveDiagnostics" class="minor" type="button">📄 Сохранить диагностику без ключей</button>
 <button id="recoverServer" class="minor" type="button" hidden>♻ Завершить оставшийся LiveKit и восстановить запуск</button><p id="diagResult" class="small-note" aria-live="polite"></p><p class="small-note">Видеосервер LiveKit встроен и запускается автоматически без Docker. VPN требует однократной настройки Linux-ретранслятора и WireGuard на Windows; Android VPN встроен в APK.</p>
 <p class="error" id="error" hidden></p></div></section>`;
 mountPowerSettings(info.power);
 const mode=q('#networkMode');mode.value=configured?'vpn':'lan';
 const activate=q('#activateVpn');
 if(activate)activate.onclick=async()=>{
   activate.disabled=true;activate.textContent='Ожидание подтверждения Windows UAC…';
   try{const d=await window.streamControl.activateVpn();q('#diagResult').textContent=d.vpnInterfaceUp?'VPN включён — теперь можно запускать сервер.':'Команда выполнена, но VPN-адрес ещё не появился. Проверьте WireGuard.';}
   catch(err){showError(err);}finally{activate.disabled=false;activate.textContent='⚡ Включить VPN на Windows';}
 };
 q('#openEvents').onclick=()=>showEventLog(window.streamControl);
 q('#openArchive').onclick=()=>showRecordingArchive(window.streamControl);
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
 <div class="sidebar-footer"><div id="powerSettings"></div><button id="openEvents" class="minor" type="button">Журнал событий</button><button id="openArchive" class="minor">▤ Архив записей</button><div class="server-live">● СЕРВЕР ЗАПУЩЕН</div><div id="modeInfo"></div>
 <div id="endpoint" class="endpoint"></div><div id="pendingRoomCleanup" class="muted" role="status"></div><button id="copyUrl" class="minor">Копировать адрес</button>
 <button id="reconcileRevoked" class="minor">Проверить отключения операторов</button>
 <button id="saveDashboardDiagnostics" class="minor">📄 Сохранить диагностику</button>
 <button id="cleanupVpn" class="minor" ${serverInfo?.mode==='vpn'?'':'hidden'}>Проверить отзыв VPN-ключей</button>
 <button id="stopServer" class="danger">Остановить сервер</button><br/>Только видеотрансляции<br/>Передача звука и чат отключены</div></aside>
 <main class="main"><header><div><div id="roomTitle" class="room-title">Выберите комнату</div><span id="roomInfo" class="muted">Мониторинг операторов</span></div>
 <div class="toolbar"><label class="grid-picker">Сетка <select id="gridColumns">
 <option value="0">Авто</option><option value="1">1 столбец</option><option value="2">2 столбца</option><option value="3">3 столбца</option><option value="4">4 столбца</option>
 </select></label><button id="activeRecordingsButton" class="minor">Записи: 0</button><button id="wallOrderButton" class="minor">Порядок пультов</button><button id="wallSnapshot" class="minor" type="button" disabled title="Сохранить видимые потоки, названия и состояния в один PNG. До 16 пультов; кадры источников не синхронизированы.">Снимок стены</button><button id="wallFullscreen" class="minor">Во весь экран</button><button id="selfTest" class="minor" disabled>🧪 Проверить видео</button><button id="newKey" class="primary" disabled>+ Ключ оператора</button><button id="refresh" class="minor">Обновить</button></div></header>
 <div id="alert" class="alert" hidden></div><div id="selfTestStatus" class="self-test-status" aria-live="polite"></div><div id="wallRoomStates" class="wall-room-states" hidden></div><div id="presenceSummary" class="presence-summary">Обновление статуса операторов…</div><div id="streamSummary" class="stream-summary" role="status" title="Сумма свежих измерений входящего видеотрафика этого окна, включая скрытые записываемые потоки. Не включает VPN, аудио и служебный трафик. Доля в скобках — число потоков со свежим битрейтом из принимаемых."></div><div class="stream-filter"><label for="streamSearch">Найти пульт</label><input id="streamSearch" type="search" maxlength="120" placeholder="Имя пульта или комната…" autocomplete="off"><label class="favorites-filter"><input id="favoritesOnly" type="checkbox"> Только избранные</label><button id="clearStreamSearch" class="minor" type="button">Сбросить</button><span id="streamSearchSummary" class="muted" role="status"></span><label class="favorites-filter" title="Один короткий сигнал при отсутствии новых кадров около 4 секунд. Только после работающего видео; интервал между сигналами 10 секунд. Включается на текущий сеанс."><input id="streamSound" type="checkbox"> Сигнал зависания</label><button id="testStreamSound" class="minor" type="button" disabled>Проверить звук</button><span class="shortcut-help" title="Вне полей ввода, диалогов и полноэкранного режима">1–9 — крупно · Esc — сетка</span></div><p id="streamFilterEmpty" class="filter-empty" hidden>По этому запросу пульты не найдены. Измените поиск или нажмите «Сбросить».</p><section id="content" class="content"><div class="empty">Выберите комнату слева</div></section>
 <section class="keys-panel"><div class="keys-head"><h2>Ключи операторов</h2><button id="renameRoom" class="minor" disabled>Переименовать</button><button id="deleteRoom" class="danger" disabled>Удалить комнату</button></div><div id="keys"></div></section></main></div>`;
 mountPowerSettings(serverInfo?.power);
 q('#openEvents').onclick=()=>showEventLog(window.streamControl);
 q('#openArchive').onclick=()=>showRecordingArchive(window.streamControl);
 q('#activeRecordingsButton').onclick=()=>showActiveRecordings({getRows:activeRecordingRows,onReveal:revealActiveRecording});
 q('#streamSound').checked=streamAlerts.enabled;
 q('#testStreamSound').disabled=!streamAlerts.enabled;
 q('#streamSound').onchange=async e=>{
  const checkbox=e.target;checkbox.disabled=true;
  try{if(checkbox.checked){if(await alertTone.ready())streamAlerts.enable(true);}else{streamAlerts.enable(false);alertTone.stop();}}
  catch{checkbox.checked=false;streamAlerts.enable(false);alertTone.stop();recordingNotice('Не удалось включить звук. Проверьте устройство вывода.',true);}
  finally{checkbox.disabled=false;const button=q('#testStreamSound');if(button)button.disabled=!streamAlerts.enabled;}
 };
 q('#testStreamSound').onclick=()=>{try{alertTone.play();}catch{recordingNotice('Звуковой выход недоступен. Выключите и снова включите сигнал.',true);}};
 updateActiveRecordingButton();updateStreamSummary();
 q('#favoritesOnly').checked=favoritesOnly;q('#favoritesOnly').onchange=e=>{favoritesOnly=e.target.checked;applyGridLayout();};
 q('#streamSearch').value=streamQuery;
 q('#streamSearch').oninput=e=>{streamQuery=e.target.value;applyGridLayout();};
 q('#clearStreamSearch').onclick=()=>{streamQuery='';favoritesOnly=false;q('#favoritesOnly').checked=false;q('#streamSearch').value='';applyGridLayout();q('#streamSearch').focus();};
 q('#streamSearch').onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();q('#clearStreamSearch').click();}};
 q('#allControllers').onclick=()=>selectAllControllers();
 q('#wallOrderButton').onclick=()=>showWallOrder(wallLayout,{getSources:()=>[...tiles.values()].map(t=>({key:t.sourceKey,label:t.label})),onChange:applyGridLayout});
 if(layoutWarning)recordingNotice('Не удалось прочитать настройки видеостены. Используются доступные настройки в памяти.',true);
 q('#wallSnapshot').onclick=()=>{if(activeSnapshots.size)return;const pending=saveWallSnapshot();activeSnapshots.add(pending);void pending.finally(()=>{activeSnapshots.delete(pending);updateWallSnapshotButton();});};
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
  try{await disconnect();await window.streamControl.stopServer();rooms=[];active=null;wallMode=false;serverInfo=null;streamAlerts.enable(false);alertTone.stop();startScreen();}
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
 q('#gridColumns').onchange=e=>{gridColumns=Number(e.target.value);wallLayout.setColumns(gridColumns);applyGridLayout();};
 q('#refresh').onclick=()=>refresh(false);
 q('#renameRoom').onclick=async()=>{if(!active)return;const id=active,room=rooms.find(r=>r.id===id);const name=prompt('Новое название комнаты (до 80 символов)',room?.name||'');if(name===null||name.trim()===room?.name)return;if(!name.trim()||name.trim().length>80||/[\u0000-\u001f\u007f]/.test(name)){displayErr(Error('Введите название от 1 до 80 символов без управляющих символов'));return;}const button=q('#renameRoom');button.disabled=true;try{await window.streamControl.renameRoom(id,name.trim());await refresh(false);}catch(err){displayErr(err);}finally{if(button.isConnected)button.disabled=!active;}};
 q('#deleteRoom').onclick=async()=>{if(!active)return;const r=rooms.find(x=>x.id===active);if(!confirm(`Удалить комнату «${r?.name}»?`))return;
 try{const result=await window.streamControl.deleteRoom(active);active=null;await disconnect();await refresh(false);
   if(result?.warning)displayErr(new Error(result.warning));}catch(err){displayErr(err);}};
 paintRoomList();
}
function mountPowerSettings(state){const host=q('#powerSettings');if(!host)return;host.innerHTML='<label class="power-setting"><input id="keepAwake" type="checkbox"> Не выключать экран при работающем сервере</label><p id="powerState" class="small-note" role="status"></p>';
 let current=state||{enabled:true,active:false};const input=q('#keepAwake');const paint=()=>{input.checked=current.enabled;q('#powerState').textContent=current.error||current.warning||(current.active?'Автоматический сон экрана заблокирован программой':current.enabled?'Защита включится после запуска сервера':'Используются обычные настройки питания Windows');};paint();
 input.onchange=async()=>{const requested=input.checked;input.disabled=true;try{current=await window.streamControl.setKeepAwake(requested);if(serverInfo)serverInfo.power=current;}catch{recordingNotice('Не удалось сохранить настройку питания.',true);}finally{input.disabled=false;paint();}};
}
function displayErr(err){const a=q('#alert');a.hidden=false;a.textContent=err.message||String(err);}
function showKey(key,name){
 const dialog=document.createElement('dialog');dialog.className='key-dialog';
 dialog.innerHTML=`<h2>Код для ${escapeHtml(name)}</h2><p>${serverInfo?.mode==='vpn'?'Единый код: вставить в Android APK — VPN и поток подключатся автоматически.':'LAN: ключ и локальный IP передайте оператору.'} Показывается один раз; передавайте конфиденциально.</p>
 <textarea readonly rows="3"></textarea><div class="actions"><button id="copyKey" class="primary">Скопировать код</button><button id="saveInvite" class="minor">Сохранить VPN-код</button><button id="closeKey" class="minor">Закрыть</button></div>`;
 dialog.querySelector('textarea').value=key;
 document.body.append(dialog);dialog.showModal();
 dialog.querySelector('#copyKey').onclick=async()=>{const button=dialog.querySelector('#copyKey');button.disabled=true;try{await window.streamControl.copyInvite(key);recordingNotice('Код скопирован. Через 60 секунд программа очистит его из буфера, если вы не скопируете другой текст.');}catch{recordingNotice('Не удалось скопировать код. Повторите попытку или сохраните VPN-код в файл.',true);}finally{button.disabled=false;}};
 const save=dialog.querySelector('#saveInvite');save.disabled=!key.startsWith('USCV1.');save.onclick=async()=>{save.disabled=true;try{const result=await window.streamControl.saveInvite(key);if(result.saved)recordingNotice('Код сохранён в файл .usc. Он содержит секрет подключения: передайте его только нужному оператору.');}catch{recordingNotice('Не удалось сохранить код. Выберите новый файл .usc.',true);}finally{save.disabled=false;}};
 const note=document.createElement('p');note.textContent='Файл .usc содержит секреты VPN. На Android нажмите «Загрузить код из файла». Не публикуйте файл и удалите лишние копии после передачи.';dialog.append(note);
 dialog.querySelector('#closeKey').onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove());
}
function paintRoomList(){
 q('#roomList').innerHTML=rooms.map(r=>`<button class="room ${active===r.id?'selected':''}" data-room="${r.id}">
 <span>▣</span><span>${escapeHtml(r.name)}</span><small>${r.keys.filter(k=>!k.revoked).length}</small></button>`).join('')||'<p class="muted">Пока нет комнат</p>';
 q('#roomList').querySelectorAll('[data-room]').forEach(btn=>btn.onclick=()=>selectRoom(btn.dataset.room));
 q('#allControllers').classList.toggle('selected',wallMode);
 const panel=q('.keys-panel');if(panel)panel.hidden=wallMode;
 if(wallMode){q('#roomTitle').textContent='Все ФПВ-пульты';q('#newKey').disabled=true;q('#renameRoom').disabled=true;q('#deleteRoom').disabled=true;q('#selfTest').disabled=true;q('#keys').textContent='';updateWallStatus();return;}
 const r=rooms.find(r=>r.id===active);q('#newKey').disabled=!r;q('#renameRoom').disabled=!r;q('#deleteRoom').disabled=!r;
 q('#selfTest').disabled=!r;
 q('#roomTitle').textContent=r?.name||'Выберите комнату';q('#roomInfo').textContent=r?'Операторы в комнате — трансляция экрана':'Мониторинг операторов';
 if(r)paintKeys(r);else{q('#keys').innerHTML='<span class="muted">Ключей нет</span>';q('#content').innerHTML='<div class="empty">Выберите комнату слева</div>';}
}
function paintKeys(r){
 q('#keys').innerHTML=r.keys.length?r.keys.map(k=>{const state=presence.get(k.id);const stateName=k.revoked?'Отозван':state?.streaming?'● Транслирует':state?.online?'● Подключён':'○ Не в сети';const cls=k.revoked?'muted':state?.streaming?'streaming':state?.online?'online':'muted';return `<div class="key-row"><span>${escapeHtml(k.name)}</span><span class="${cls}">${stateName}</span>
 ${k.revoked?'':`<button class="minor" data-rename-operator="${k.id}">Переименовать</button><button class="danger" data-revoke="${k.id}">Отозвать</button>`}</div>`;}).join(''):'<span class="muted">Нажмите «Ключ оператора» для подключения первого пульта</span>';
 q('#keys').querySelectorAll('[data-rename-operator]').forEach(button=>button.onclick=async()=>{const id=button.dataset.renameOperator,operator=r.keys.find(k=>k.id===id);const name=prompt('Новое имя пульта (до 60 символов)',operator?.name||'');if(name===null||name.trim()===operator?.name)return;if(!name.trim()||name.trim().length>60||/[\u0000-\u001f\u007f]/.test(name)){displayErr(Error('Введите имя от 1 до 60 символов без управляющих символов'));return;}button.disabled=true;try{await window.streamControl.renameOperator(r.id,id,name.trim());await refresh(false);}catch(err){displayErr(err);}finally{if(button.isConnected)button.disabled=false;}});
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
 paintRoomList();if(wallMode){await wall.sync(rooms);applyGridLayout();updateWallStatus();}else if(active){await pollPresence();if(!session)await connectRoom(active);applyGridLayout();}}catch(err){displayErr(err);}}
async function selectRoom(id){if(!wallMode&&active===id&&session)return;if(!confirmViewSwitch(activeRecordings,message=>confirm(message)))return;await disconnect();wallMode=false;wallStates.clear();q('#wallRoomStates').hidden=true;videoTest.stop(true);active=id;presence=new Map();paintRoomList();await Promise.all([pollPresence(),connectRoom(id)]);}
function clearTiles(){
 for(const entry of tiles.values()){void entry.recorder?.stop();entry.stopMonitor?.();entry.track.detach();entry.item.remove();}
 tiles.clear();streamAlerts.clear();observedSources.clear();focusedTile=null;updateStreamFilterSummary(0,0);updateStreamSummary();
}
async function disconnect(){
 wall.stop();wallStates.clear();journalRoomStates.clear();
 videoTest.stop(true);
 connectionSerial++;reconnect.stop();
 const prev=session;session=null;
 if(prev)prev.disconnect();
 clearTiles();
}
function applyGridLayout(){
 const grid=q('#grid');if(!grid)return;
 grid.style.setProperty('--grid-columns',gridColumns?String(gridColumns):'0');
 if(layoutWarning){layoutWarning=false;recordingNotice('Настройки видеостены не удалось сохранить на диск. Изменения действуют до закрытия приложения.',true);}
 grid.classList.toggle('fixed-grid',gridColumns>0);
 for(const entry of tiles.values()){const room=rooms.find(r=>r.id===entry.roomId);const name=sourceDisplayName(room,entry.identity,entry.participantName);entry.label=(entry.showRoomName&&room?room.name+' · ':'')+name;entry.nameNode.textContent=entry.label;entry.nameNode.title=entry.label;observedSources.set(`${entry.roomId}:${entry.identity}`,entry.label);}
 const view=filteredLayout([...tiles].map(([id,t])=>({id,label:t.label,roomName:rooms.find(r=>r.id===t.roomId)?.name,favorite:favoriteSources.has(t.sourceKey)})),streamQuery,focusedTile,favoritesOnly);focusedTile=view.focusedId;const visible=new Set(view.visible);
 grid.classList.toggle('focused-grid',Boolean(focusedTile));
 const order=wallLayout.sorted([...new Set([...tiles.values()].map(t=>t.sourceKey))]);
 const shortcutIds=view.matching.slice().sort((a,b)=>order.indexOf(tiles.get(a).sourceKey)-order.indexOf(tiles.get(b).sourceKey));
 for(const [id,entry] of tiles){
  const starred=favoriteSources.has(entry.sourceKey);entry.favoriteButton.textContent=starred?'★':'☆';entry.favoriteButton.setAttribute('aria-pressed',String(starred));entry.favoriteButton.setAttribute('aria-label',(starred?'Убрать из избранного: ':'Добавить в избранное: ')+entry.label);entry.favoriteButton.title=starred?'Убрать из избранного':'Добавить в избранное';
  entry.item.style.order=String(order.indexOf(entry.sourceKey));
  const shortcutIndex=shortcutIds.indexOf(id);entry.shortcutNumber.textContent=shortcutIndex<9?String(shortcutIndex+1):'';entry.shortcutNumber.hidden=shortcutIndex<0||shortcutIndex>=9;
  entry.focus.title=shortcutIndex>=0&&shortcutIndex<9?'Крупно: клавиша '+(shortcutIndex+1)+'; Escape — сетка':'Увеличить выбранный поток';
  entry.item.hidden=!visible.has(id);
  entry.item.classList.toggle('is-focused',id===focusedTile);
  entry.focus.textContent=id===focusedTile?'Вернуть сетку':'Крупно';
  applyReceiveState(entry);
 }
 updateStreamFilterSummary(view.matching.length,tiles.size);updateStreamSummary();
}
function updateActiveRecordingButton(){const button=q('#activeRecordingsButton');if(button)button.textContent='Записи: '+activeRecordings.size;}
function activeRecordingRows(){return [...activeRecordings].map(recorder=>{const meta=recordingMetadata.get(recorder);return {...meta,state:recorder.state,startedAt:recorder.startedAt,filePath:recorder.filePath,freeBytesAtStart:recorder.freeBytesAtStart,canReveal:tiles.get(meta.tileId)?.recorder===recorder,stop:async()=>{await recorder.stop();if(recorder.error)throw Error('Не удалось сохранить запись. Проверьте уведомление об ошибке.');}};});}
function revealActiveRecording(id){const row=activeRecordingRows().find(row=>row.id===id);if(!row?.canReveal)return false;streamQuery='';favoritesOnly=false;const favorites=q('#favoritesOnly');if(favorites)favorites.checked=false;const search=q('#streamSearch');if(search)search.value='';focusedTile=row.tileId;applyGridLayout();tiles.get(row.tileId)?.item.scrollIntoView({block:'nearest'});return true;}
function updateStreamFilterSummary(matched,total=tiles.size){
 matched??=filteredLayout([...tiles].map(([id,t])=>({id,label:t.label,roomName:rooms.find(r=>r.id===t.roomId)?.name,favorite:favoriteSources.has(t.sourceKey)})),streamQuery,null,favoritesOnly).matching.length;
 const hiddenRecordings=[...tiles.values()].filter(t=>t.item.hidden&&activeRecordings.has(t.recorder)&&recordingBusy(t.recorder?.state)).length;
 const summary=q('#streamSearchSummary');if(summary)summary.textContent=`Найдено потоков: ${matched} из ${total}`+(hiddenRecordings?` · Скрытых записей: ${hiddenRecordings}`:'');
 const clear=q('#clearStreamSearch');if(clear)clear.disabled=!streamQuery&&!favoritesOnly;
 const empty=q('#streamFilterEmpty');if(empty)empty.hidden=!total||matched>0;
}
function updateWallSnapshotButton(){const button=q('#wallSnapshot');if(button){button.disabled=wallSnapshotPending||activeSnapshots.size>0||!wallSnapshotSources([...tiles.values()]).length;button.textContent=wallSnapshotPending?'Сохранение…':'Снимок стены';}}
function updateStreamSummary(){updateWallSnapshotButton();const host=q('#streamSummary');if(!host)return;
 const rows=[...tiles.values()].map(entry=>({hidden:entry.item.hidden,connected:wallMode?wallStates.get(entry.roomId)==='connected':session?.state==='connected',receiving:!entry.track.isMuted&&receiveEnabled({paused:entry.receivePaused,hidden:entry.item.hidden,recordingState:entry.recorder?.state}),sample:entry.health,sampleAt:entry.sampleAt}));
 const summary=summarizeStreams(rows,performance.now());host.textContent=formatStreamSummary(summary);host.dataset.live=String(summary.live);host.dataset.stale=String(summary.stale);host.dataset.paused=String(summary.paused);host.dataset.hidden=String(summary.hidden);host.dataset.receiving=String(summary.receiving);host.dataset.measured=String(summary.measured);
}
function applyReceiveState(entry){
 entry.pub.setEnabled(receiveEnabled({paused:entry.receivePaused,hidden:entry.item.hidden,recordingState:entry.recorder?.state}));
 entry.pauseButton.textContent=entry.receivePaused?'▶ Приём':'Ⅱ Пауза';entry.pauseButton.disabled=recordingBusy(entry.recorder?.state);
 entry.pauseButton.setAttribute('aria-pressed',String(entry.receivePaused));entry.pauseButton.title=entry.receivePaused?'Возобновить приём этого пульта':'Приостановить приём на этом Windows-ПК; другие зрители продолжают просмотр';
 entry.item.classList.toggle('receive-paused',Boolean(entry.receivePaused));
 entry.recordButton.disabled=entry.receivePaused||['choosing','stopping'].includes(entry.recorder?.state);
 renderEntryHealth(entry);updateStreamSummary();
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
  current.on(RoomEvent.Reconnecting,()=>{if(valid() && session===current){logEvent('room-reconnecting',rooms.find(r=>r.id===id)?.name);const x=q('#roomInfo');if(x)x.textContent='Восстановление видеосоединения…';}});
  current.on(RoomEvent.Reconnected,()=>{if(valid() && session===current){logEvent('room-connected',rooms.find(r=>r.id===id)?.name);const x=q('#roomInfo');if(x)x.textContent='Трансляции экрана операторов';reconnect.success();}});
  current.on(RoomEvent.Disconnected,()=>{
   if(!valid()||session!==current)return;
   logEvent('room-disconnected',rooms.find(r=>r.id===id)?.name);session=null;clearTiles();updatePlaceholder();
   const x=q('#roomInfo');if(x)x.textContent='Сеанс завершён — повторное подключение';
   reconnect.failure(id);
  });
  await current.connect(config.wsUrl,config.token);
  if(!valid()||session!==current){current.disconnect();return;}
  reconnect.success();logEvent('room-connected',rooms.find(r=>r.id===id)?.name);
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
 const footer=document.createElement('div');footer.className='tile-footer';const n=document.createElement('span');n.textContent=(roomName?roomName+' · ':'')+sourceDisplayName(rooms.find(r=>r.id===roomId),p.identity,p.name||p.identity);n.title=n.textContent;
 const badge=document.createElement('span');badge.className='online';badge.textContent='Ожидание видео';
 const focus=document.createElement('button');focus.className='focus-button';focus.textContent='Крупно';focus.title='Увеличить выбранный поток';focus.onclick=()=>focusTile(id);
 const visual=document.createElement('div');visual.className='tile-visual';
 const warning=document.createElement('div');warning.className='stream-stale';warning.hidden=true;warning.setAttribute('role','status');
 const duration=document.createElement('div');duration.className='tile-duration';duration.textContent='Таймер начнётся после первого кадра';duration.title='Время наблюдения в этом окне с первого кадра текущего источника, включая паузы. Приём — приблизительное время разрешённого приёма; скрытые записываемые потоки учитываются. Пауза, отсутствие соединения и большие интервалы без измерений не учитываются в приёме. Сброс при новом треке или смене просмотра. Это не длительность полёта или записи.';
 const metrics=document.createElement('div');metrics.className='tile-metrics';metrics.textContent='Получение статистики…';
 metrics.title='Параметры приёма на этом Windows-ПК. RTT — путь до видеосервера и обратно, не задержка изображения с пульта.';
 warning.title='Кадр мог перестать обновляться из-за неподвижного экрана, паузы захвата или проблем связи.';
 const recordButton=document.createElement('button');recordButton.className='record-button';recordButton.textContent='● Запись';recordButton.title='Сохранить видео этого пульта в WebM без звука';
 const snapshotButton=document.createElement('button');snapshotButton.className='snapshot-button';snapshotButton.textContent='Кадр';snapshotButton.disabled=true;snapshotButton.title='Сохранить кадр в PNG в исходном разрешении, без интерфейса Windows';
 const pauseButton=document.createElement('button');pauseButton.className='pause-button';pauseButton.textContent='Ⅱ Пауза';
 const favoriteButton=document.createElement('button');favoriteButton.className='favorite-button';favoriteButton.textContent='☆';
 const shortcutNumber=document.createElement('span');shortcutNumber.className='tile-shortcut';shortcutNumber.setAttribute('aria-hidden','true');
 visual.append(video,warning,shortcutNumber,favoriteButton);footer.append(n,badge,pauseButton,snapshotButton,recordButton,focus);item.append(visual,footer,metrics,duration);video.ondblclick=()=>item.requestFullscreen?.();
 grid.append(item);track.attach(video);
 const stableKey=sourceKey(String(roomId),p.identity);item.dataset.source=stableKey;wallLayout.remember([stableKey]);
 const entry={sessionClock:new StreamSessionClock(),duration,sourceKey:stableKey,nameNode:n,participantName:p.name||p.identity,identity:p.identity,showRoomName:Boolean(roomName),item,track,focus,roomId,badge,warning,metrics,health:null,pub,recordButton,snapshotButton,video,label:n.textContent,snapshotPending:false,pauseButton,receivePaused:false,shortcutNumber,favoriteButton};tiles.set(id,entry);observedSources.set(`${roomId}:${p.identity}`,entry.label);logEvent('stream-started',entry.label);
 favoriteButton.onclick=()=>{if(!favoriteSources.toggle(entry.sourceKey)){recordingNotice('Не удалось добавить пульт: в избранном не более 500 источников.',true);return;}applyGridLayout();};
 pauseButton.onclick=()=>{if(toggleReceive(entry)){entry.lastFrameState=null;applyReceiveState(entry);}};
 snapshotButton.onclick=()=>{
  const pending=saveTileSnapshot(entry);activeSnapshots.add(pending);void pending.then(()=>activeSnapshots.delete(pending),()=>activeSnapshots.delete(pending));
 };
 recordButton.onclick=async()=>{
  if(entry.receivePaused)return;
  if(entry.recorder&&['recording','stopping'].includes(entry.recorder.state)){await entry.recorder.stop();return;}
  if(entry.recorder?.state==='choosing')return;
  const recorder=new StreamRecorder({api:window.streamControl,track:track.mediaStreamTrack,onState:(state,data)=>{
   recordButton.disabled=['choosing','stopping'].includes(state);recordButton.classList.toggle('recording',state==='recording');
   recordButton.textContent=state==='choosing'?'Выбор файла…':state==='stopping'?'Сохранение…':state==='recording'?'■ Стоп':'● Запись';
   recordButton.title=state==='recording'?'Остановить запись и сохранить WebM':'Записать видео этого пульта в WebM без звука';
   recordButton.setAttribute('aria-label',state==='recording'?'Остановить запись: '+n.textContent:'Записать: '+n.textContent);
   if(tiles.get(id)===entry){applyReceiveState(entry);updateStreamFilterSummary();}
   if(['saved','error','canceled'].includes(state)){
    activeRecordings.delete(recorder);recordingMetadata.delete(recorder);updateStreamFilterSummary();
    if(state==='saved')recordingNotice('Запись сохранена: '+data.filePath+(data.archiveWarning?' · '+data.archiveWarning:''));
    if(state==='error')recordingNotice('Ошибка записи: '+(data.message||String(data))+(recorder.filePath?' · Файл может быть неполным: '+recorder.filePath:''),true);
   }
   updateActiveRecordingButton();
  }});entry.recorder=recorder;recordingMetadata.set(recorder,{id:String(++recordingSerial),label:n.textContent,tileId:id});activeRecordings.add(recorder);
  await recorder.start(n.textContent).catch(()=>{});
 };
 entry.stopMonitor=monitorStream({track,video,isActive:()=>!track.isMuted&&receiveEnabled({paused:entry.receivePaused,hidden:item.hidden,recordingState:entry.recorder?.state}),onUpdate:sample=>{
  if(tiles.get(id)!==entry)return;const transition=frameTransition(entry.lastFrameState,sample.state);if(transition)logEvent(transition,entry.label);if(['live','stale'].includes(sample.state))entry.lastFrameState=sample.state;entry.health=sample;streamAlerts.observe(id,sample);entry.sampleAt=performance.now();renderEntryHealth(entry);updateStreamSummary();if(wallMode)updateWallStatus();
 }});if(p.identity===videoTest.identity){
  if(typeof video.requestVideoFrameCallback==='function')video.requestVideoFrameCallback(()=>videoTest.onVideoFrame(p.identity));
  else video.addEventListener('playing',()=>videoTest.onVideoFrame(p.identity),{once:true});
 }
 applyGridLayout();updatePlaceholder();
}
function detachTrack(track,pub,p,roomId=active){const id=`${roomId}:${p.identity}:${pub.trackSid}`;const obj=tiles.get(id);if(obj){void obj.recorder?.stop();obj.stopMonitor?.();obj.track.detach();obj.item.remove();tiles.delete(id);streamAlerts.forget(id);}if(focusedTile===id)focusedTile=null;applyGridLayout();updatePlaceholder();}
function removeParticipant(p,roomId=active){const key=`${roomId}:${p.identity}`;const label=observedSources.get(key);if(label){logEvent('participant-left',label);observedSources.delete(key);}for(const [id,t] of tiles){if(id.startsWith(roomId+':'+p.identity+':')){void t.recorder?.stop();t.stopMonitor?.();t.track.detach();t.item.remove();tiles.delete(id);streamAlerts.forget(id);if(focusedTile===id)focusedTile=null;}}applyGridLayout();updatePlaceholder();}
function updatePlaceholder(){const placeholder=q('#placeholder');if(placeholder)placeholder.hidden=tiles.size>0;if(wallMode)updateWallStatus();}
window.addEventListener('keydown',event=>{
 const target=event.composedPath()[0];const blocked=Boolean(document.fullscreenElement||q('dialog[open]')||target?.isContentEditable||target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])'));
 const ids=[...tiles].filter(([,entry])=>!entry.shortcutNumber.hidden).sort(([,a],[,b])=>Number(a.item.style.order)-Number(b.item.style.order)).map(([id])=>id);
 const action=wallShortcut(event,{ids,focusedId:focusedTile,blocked});if(!action)return;
 event.preventDefault();focusedTile=action.focus;applyGridLayout();if(focusedTile)tiles.get(focusedTile)?.item.scrollIntoView({block:'nearest'});
});
window.addEventListener('beforeunload',event=>{
 if((activeRecordings.size||activeSnapshots.size||pendingEvents.size)&&!closingRecordings){event.preventDefault();event.returnValue=false;void Promise.allSettled([...activeRecordings].map(r=>r.stop()).concat([...activeSnapshots],[...pendingEvents])).then(()=>{closingRecordings=true;window.close();});return;}
 wall.stop();videoTest.stop(true);reconnect.stop();session?.disconnect();});
async function selectAllControllers(){
 if(wallMode)return;
 if(!confirmViewSwitch(activeRecordings,message=>confirm(message)))return;
 await disconnect();wallMode=true;active=null;wallStates.clear();
 q('#content').innerHTML='<div id="grid" class="stream-grid"></div><div id="placeholder" class="empty">Ожидание трансляций со всех пультов…</div>';
 applyGridLayout();paintRoomList();await wall.sync(rooms);updateWallStatus();
}
function removeRoomTiles(roomId){
 for(const key of observedSources.keys())if(key.startsWith(roomId+':'))observedSources.delete(key);
 for(const [id,t] of tiles)if(t.roomId===roomId){void t.recorder?.stop();t.stopMonitor?.();t.track.detach();t.item.remove();tiles.delete(id);streamAlerts.forget(id);if(focusedTile===id)focusedTile=null;}
 applyGridLayout();updatePlaceholder();
}
function updateWallStatus(){
 if(!wallMode)return;
 for(const entry of tiles.values())renderEntryHealth(entry);
 const connected=rooms.filter(r=>wallStates.get(r.id)==='connected').length;
 const waiting=rooms.filter(r=>wallStates.get(r.id)==='reconnecting').length;
 const info=q('#roomInfo');if(info)info.textContent='Общая видеостена · '+rooms.length+' комнат';
 const stale=[...tiles.values()].filter(t=>!t.receivePaused&&!t.item.hidden&&t.health?.state==='stale').length;
 const summary=q('#presenceSummary');if(summary)summary.textContent='Видеопотоков: '+tiles.size+' · Комнат подключено: '+connected+'/'+rooms.length+(waiting?' · Переподключение: '+waiting:'')+(stale?' · Без новых кадров: '+stale:'');
 const states=q('#wallRoomStates');if(states){states.hidden=false;states.innerHTML=rooms.map(r=>{
  const state=wallStates.get(r.id)||'connecting';const labels={connected:'подключена',connecting:'подключение…',reconnecting:'восстановление…'};
  return '<span class="wall-room-state '+state+'">'+escapeHtml(r.name)+' · '+labels[state]+'</span>';
 }).join('')||'<span class="muted">Создайте комнату и подключите пульт.</span>';}
 const placeholder=q('#placeholder');if(placeholder)placeholder.textContent=rooms.length?'Ожидание трансляций со всех пультов…':'Пока нет комнат. Создайте комнату для подключения пультов.';
}
function renderEntryDuration(entry){
 const connected=wallMode?wallStates.get(entry.roomId)==='connected':session?.state==='connected';
 const receiving=connected&&!entry.track.isMuted&&receiveEnabled({paused:entry.receivePaused,hidden:entry.item.hidden,recordingState:entry.recorder?.state});
 const sample=entry.sessionClock.update({hasFrame:entry.video.readyState>=2&&entry.video.videoWidth>0,receiving},performance.now());
 if(!sample)return;
 entry.duration.textContent='В просмотре '+formatSessionDuration(sample.elapsedMs)+' · Приём ≈ '+formatSessionDuration(sample.receiveMs);
 entry.duration.dataset.elapsedMs=String(Math.floor(sample.elapsedMs));entry.duration.dataset.receiveMs=String(Math.floor(sample.receiveMs));
}
function renderEntryHealth(entry){
 renderEntryDuration(entry);
 entry.snapshotButton.disabled=wallSnapshotPending||entry.receivePaused||entry.snapshotPending||entry.video.readyState<2||!entry.video.videoWidth;
 if(entry.recorder?.state==='recording'){const seconds=Math.floor((Date.now()-entry.recorder.startedAt)/1000);entry.recordButton.textContent='■ '+Math.floor(seconds/60).toString().padStart(2,'0')+':'+(seconds%60).toString().padStart(2,'0');}
 const sample=entry.health;
 const connected=wallMode?wallStates.get(entry.roomId)==='connected':session?.state==='connected';
 const stale=!entry.receivePaused&&connected&&sample?.state==='stale';
 entry.badge.textContent=entry.receivePaused?'Ⅱ Приём на паузе':!connected?'↻ Восстановление связи':stale?'⚠ Нет новых кадров':sample?.state==='live'?'● LIVE':sample?.state==='paused'?'Пауза':'Ожидание видео';
 entry.badge.classList.toggle('tile-reconnecting',!connected||stale);
 entry.item.classList.toggle('is-stale',Boolean(stale));entry.warning.hidden=!stale;
 if(stale)entry.warning.textContent='Нет новых кадров · '+Math.floor(sample.ageMs/1000)+' с';
 if(entry.receivePaused){entry.metrics.textContent='Приём приостановлен вручную · Последний кадр не обновляется';return;}
 if(sample)entry.metrics.textContent=sample.state==='paused'?'Приём приостановлен для скрытого или выключенного потока':formatHealth(sample);
}
function recordingNotice(message,error=false){
 let notice=document.querySelector('#recordingNotice');if(!notice){notice=document.createElement('div');notice.id='recordingNotice';document.body.append(notice);}
 notice.className='recording-notice'+(error?' recording-error':'');notice.setAttribute('role','status');notice.replaceChildren();
 const text=document.createElement('span');text.textContent=message;const close=document.createElement('button');close.textContent='×';close.setAttribute('aria-label','Закрыть уведомление');close.onclick=()=>notice.remove();notice.append(text,close);
}
async function saveWallSnapshot(){
 if(wallSnapshotPending)return;wallSnapshotPending=true;updateWallSnapshotButton();for(const entry of tiles.values())renderEntryHealth(entry);
 try{
  const sources=wallSnapshotSources([...tiles.values()]).map(entry=>{
   const connected=wallMode?wallStates.get(entry.roomId)==='connected':session?.state==='connected';
   const state=entry.receivePaused?'paused':!connected?'offline':entry.health?.state||'waiting';
   const status={paused:'Приём приостановлен · последний доступный кадр',offline:'Нет связи · последний доступный кадр',waiting:'Ожидание кадров',live:'LIVE · принимаемое видео',stale:'Нет новых кадров · '+Math.floor((entry.health?.ageMs||0)/1000)+' с'}[state]||'Ожидание кадров';
   return {video:entry.video,label:entry.label,state,status};
  });
  const frame=await captureWallSnapshot(sources,{columns:gridColumns});
  const result=await window.streamControl.saveSnapshot('Видеостена',frame.png);
  if(result?.saved)recordingNotice('Снимок видеостены сохранён: '+result.filePath+' · '+frame.count+' пульт(ов) · '+result.width+'×'+result.height);
 }catch(error){recordingNotice('Не удалось сохранить видеостену: '+(error.message||String(error)),true);}
 finally{wallSnapshotPending=false;for(const entry of tiles.values())renderEntryHealth(entry);updateWallSnapshotButton();}
}
async function saveTileSnapshot(entry){
 if(wallSnapshotPending||entry.snapshotPending||entry.receivePaused)return;
 entry.snapshotPending=true;entry.snapshotButton.disabled=true;entry.snapshotButton.textContent='Сохранение…';
 const staleAge=entry.health?.state==='stale'?Math.floor(entry.health.ageMs/1000):null;
 try{const frame=await captureFrame(entry.video);const result=await window.streamControl.saveSnapshot(entry.label,frame.png);
  if(result?.saved)recordingNotice((staleAge===null?'Кадр сохранён':'Сохранён последний доступный кадр (без обновления '+staleAge+' с)')+': '+result.filePath+' · '+result.width+'×'+result.height);
 }catch(error){recordingNotice('Не удалось сохранить кадр: '+(error.message||String(error)),true);}
 finally{entry.snapshotPending=false;entry.snapshotButton.textContent='Кадр';entry.snapshotButton.disabled=entry.receivePaused||entry.video.readyState<2||!entry.video.videoWidth;}
}
setInterval(()=>{updateStreamSummary();for(const entry of tiles.values())renderEntryDuration(entry);},1000);
startup();
