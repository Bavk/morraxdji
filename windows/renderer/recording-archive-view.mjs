export function formatBytes(bytes){if(!Number.isFinite(bytes)||bytes<0)return '—';if(bytes<1024)return `${bytes} Б`;if(bytes<1024*1024)return `${(bytes/1024).toFixed(1)} КБ`;if(bytes<1024**3)return `${(bytes/1024**2).toFixed(1)} МБ`;return `${(bytes/1024**3).toFixed(2)} ГБ`;}
export function filterRecordings(rows,query){const needle=String(query).trim().toLocaleLowerCase('ru');return rows.filter(row=>`${row.label} ${row.note||''} ${row.filePath} ${new Date(row.createdAt).toLocaleString('ru-RU')}`.toLocaleLowerCase('ru').includes(needle));}
export function selectRecordings(rows,{query='',sort='newest',availability='all'}={}){
 const number=value=>Number.isFinite(Number(value))?Number(value):0;
 const date=row=>number(Date.parse(row.createdAt));
 const tie=(a,b)=>date(b)-date(a)||String(a.id).localeCompare(String(b.id));
 return filterRecordings(rows,query).filter(row=>availability==='missing'?!row.available:availability==='available'?!!row.available:true).sort((a,b)=>{
  if(sort==='name')return String(a.label).localeCompare(String(b.label),'ru',{numeric:true,sensitivity:'base'})||tie(a,b);
  if(sort==='size')return number(b.bytes)-number(a.bytes)||tie(a,b);
  if(sort==='oldest')return date(a)-date(b)||tie(a,b);
  return tie(a,b);
 });
}
export function editRecordingMetadata(api,row){
 return new Promise(resolve=>{
  const dialog=document.createElement('dialog');dialog.id='recordingMetadata';dialog.className='recording-archive recording-metadata';
  dialog.innerHTML=`<form><h2>Название и заметка</h2><label for="recordingLabel">Название записи</label><input id="recordingLabel" name="label" maxlength="300" required autocomplete="off"><label for="recordingNote">Заметка</label><textarea id="recordingNote" name="note" maxlength="2000" rows="6" placeholder="Например: 02:15 — проверка связи"></textarea><p class="muted">До 300 символов в названии и 2000 в заметке. Изменяется только архив; имя и содержимое видеофайла сохраняются.</p><p class="archive-error" role="alert" hidden></p><div class="archive-tools"><button class="primary metadata-save" type="submit">Сохранить</button><button class="minor metadata-cancel" type="button">Отмена</button></div></form>`;
  const q=selector=>dialog.querySelector(selector);let busy=false,result=null;
  q('input').value=row.label;q('textarea').value=row.note||'';
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  dialog.addEventListener('close',()=>{dialog.remove();resolve(result);},{once:true});
  q('.metadata-cancel').onclick=()=>dialog.close();
  q('form').onsubmit=async event=>{event.preventDefault();if(busy)return;busy=true;q('.metadata-save').disabled=true;q('.metadata-cancel').disabled=true;
   try{const saved=await api.updateRecording(row.id,{label:q('input').value,note:q('textarea').value});if(!dialog.isConnected)return;result=saved;dialog.close();}
   catch(error){if(dialog.isConnected){q('.archive-error').hidden=false;q('.archive-error').textContent=error.message||String(error);}}
   finally{busy=false;if(dialog.isConnected){q('.metadata-save').disabled=false;q('.metadata-cancel').disabled=false;}}
  };
  document.body.append(dialog);dialog.showModal();q('input').focus();q('input').select();
 });
}
export async function showRecordingArchive(api){
 if(document.querySelector('#recordingArchive'))return;
 const modal=document.createElement('dialog');modal.id='recordingArchive';modal.className='recording-archive';
 modal.innerHTML=`<div class="archive-head"><div><h2>Архив записей</h2><p class="muted">Видео сохранено на этом компьютере</p></div><button class="minor archive-close" aria-label="Закрыть архив">Закрыть</button></div>
 <div class="archive-tools"><input class="archive-search" type="search" aria-label="Поиск записей" placeholder="Название, заметка, файл или дата…"><select class="archive-sort" aria-label="Сортировка записей"><option value="newest">Сначала новые</option><option value="oldest">Сначала старые</option><option value="name">По имени пульта</option><option value="size">Сначала большие</option></select><select class="archive-availability" aria-label="Доступность файлов"><option value="all">Все файлы</option><option value="available">Доступные</option><option value="missing">Недоступные</option></select><button class="minor archive-import">Добавить WebM</button><button class="minor archive-refresh">Обновить</button></div>
 <p class="archive-summary muted" role="status"></p><p class="archive-error" role="alert" hidden></p>
 <section class="archive-player" hidden><div class="archive-player-head"><strong class="archive-playing-name"></strong><button class="minor archive-stop">Закрыть видео</button></div><video controls muted playsinline preload="metadata"></video><p class="small-note muted">Воспроизведение сохранённого файла. Трансляции продолжают работать.</p></section>
 <div class="archive-list"></div><div class="archive-pages"><button class="minor archive-prev">Назад</button><span class="archive-page"></span><button class="minor archive-next">Далее</button></div>`;
 document.body.append(modal);modal.showModal();
 const q=selector=>modal.querySelector(selector);let rows=[],page=0,closed=false,request=0,playRequest=0,playingId=null;const pageSize=30;
 const error=value=>{q('.archive-error').hidden=false;q('.archive-error').textContent=value.message||String(value);};
 const stopPlayback=()=>{playingId=null;playRequest++;const video=q('video');video.pause();video.removeAttribute('src');video.load();q('.archive-player').hidden=true;};
 modal.addEventListener('close',()=>{closed=true;request++;document.querySelector('#recordingMetadata')?.close();stopPlayback();modal.remove();});
 q('.archive-close').onclick=()=>modal.close();q('.archive-stop').onclick=stopPlayback;
 q('video').onerror=()=>{if(q('video').getAttribute('src'))error(Error('Не удалось воспроизвести файл. Возможно, он перемещён или повреждён.'));};
 function paint(){
  const filtered=selectRecordings(rows,{query:q('.archive-search').value,sort:q('.archive-sort').value,availability:q('.archive-availability').value});page=Math.min(page,Math.max(0,Math.ceil(filtered.length/pageSize)-1));
  q('.archive-summary').textContent=`Записей: ${rows.length} · Найдено: ${filtered.length} · Недоступно: ${rows.filter(r=>!r.available).length}`;
  const list=q('.archive-list');list.replaceChildren();
  if(!filtered.length){const empty=document.createElement('p');empty.className='empty';empty.textContent=rows.length?'Ничего не найдено':'Записей пока нет. Начните запись потока или добавьте существующие WebM-файлы.';list.append(empty);}
  for(const row of filtered.slice(page*pageSize,(page+1)*pageSize)){
   const item=document.createElement('article');item.className='archive-row';item.dataset.recording=row.id;
   const info=document.createElement('div');info.className='archive-row-info';
   const title=document.createElement('strong');title.textContent=row.label;title.title=row.filePath;
   const details=document.createElement('span');details.className='muted';details.textContent=`${new Date(row.createdAt).toLocaleString('ru-RU')} · ${formatBytes(row.bytes)}${row.available?'':' · Файл недоступен'}`;
   const location=document.createElement('span');location.className='archive-location';location.textContent=row.filePath;
   info.append(title,details,location);if(row.note){const note=document.createElement('p');note.className='archive-note';note.textContent=row.note;info.append(note);}const buttons=document.createElement('div');buttons.className='archive-row-actions';
   const play=document.createElement('button');play.className='primary archive-play';play.textContent='Смотреть';play.disabled=!row.available;
   play.onclick=async()=>{const generation=++playRequest;play.disabled=true;try{const result=await api.playRecording(row.id);if(closed||generation!==playRequest)return;
    playingId=row.id;q('.archive-error').hidden=true;q('.archive-playing-name').textContent=row.label;q('.archive-player').hidden=false;
    const video=q('video');video.src=result.url;await video.play();q('.archive-player').scrollIntoView({block:'nearest'});
   }catch(e){if(!closed&&generation===playRequest)error(e);}finally{if(!closed)play.disabled=!row.available;}};
   const reveal=document.createElement('button');reveal.className='minor archive-reveal';reveal.textContent='В папке';reveal.title='Показать файл в проводнике';reveal.disabled=!row.available;reveal.onclick=async()=>{try{await api.revealRecording(row.id);}catch(e){if(!closed)error(e);}};
   const forget=document.createElement('button');forget.className='minor archive-forget';forget.textContent='Убрать';forget.title='Убрать из списка; видеофайл останется на диске';
   forget.onclick=async()=>{if(!confirm('Убрать запись из списка? Сам видеофайл останется на диске.'))return;try{await api.forgetRecording(row.id);if(!closed){stopPlayback();await load();}}catch(e){if(!closed)error(e);}};
   const edit=document.createElement('button');edit.className='minor archive-edit';edit.textContent='Название / заметка';
   edit.onclick=async()=>{if(document.querySelector('#recordingMetadata'))return;const saved=await editRecordingMetadata(api,row);if(closed||!saved)return;if(playingId===row.id)q('.archive-playing-name').textContent=saved.label;await load();};
   buttons.append(play,edit,reveal,forget);item.append(info,buttons);list.append(item);
  }
  q('.archive-prev').disabled=page===0;q('.archive-next').disabled=(page+1)*pageSize>=filtered.length;q('.archive-page').textContent=`${page+1} / ${Math.max(1,Math.ceil(filtered.length/pageSize))}`;
 }
 async function load(){const generation=++request;try{const data=await api.listRecordings();if(closed||generation!==request)return;rows=data;q('.archive-error').hidden=true;paint();}catch(e){if(!closed&&generation===request)error(e);}}
 for(const selector of ['.archive-sort','.archive-availability'])q(selector).onchange=()=>{page=0;paint();};
 q('.archive-search').oninput=()=>{page=0;paint();};q('.archive-prev').onclick=()=>{page--;paint();};q('.archive-next').onclick=()=>{page++;paint();};q('.archive-refresh').onclick=load;
 q('.archive-import').onclick=async()=>{const button=q('.archive-import');button.disabled=true;try{const result=await api.importRecordings();if(closed||result?.canceled)return;await load();if(result.skipped)error(Error(`Не добавлено файлов: ${result.skipped}. Выберите непустые видео WebM.`));}catch(e){if(!closed)error(e);}finally{if(!closed)button.disabled=false;}};
 await load();
}
