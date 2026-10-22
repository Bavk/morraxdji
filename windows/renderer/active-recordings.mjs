export function recordingDuration(startedAt,now=Date.now()){
 if(!Number.isFinite(startedAt))return '—';const seconds=Math.max(0,Math.floor((now-startedAt)/1000));return `${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;
}
export async function stopRecordingBatch(rows,confirm){
 const targets=rows.filter(row=>row.state==='recording');if(!targets.length)return {stopped:0,failed:0};
 if(!confirm(`Завершить и сохранить ${targets.length} записей? Видеотрансляции продолжатся.`))return {canceled:true};
 const results=await Promise.allSettled(targets.map(row=>Promise.resolve().then(()=>row.stop())));
 return {stopped:results.filter(r=>r.status==='fulfilled').length,failed:results.filter(r=>r.status==='rejected').length};
}
export function showActiveRecordings({getRows,onReveal}){
 if(document.querySelector('#activeRecordingsPanel'))return;
 const modal=document.createElement('dialog');modal.id='activeRecordingsPanel';modal.className='recording-archive';
 modal.innerHTML=`<div class="archive-head"><div><h2>Активные записи</h2><p class="muted">Включая пульты, скрытые поиском или крупным просмотром</p></div><button class="minor recordings-close">Закрыть</button></div><p class="recordings-status muted" role="status"></p><p class="recordings-error archive-error" role="alert" hidden></p><div class="recordings-list"></div><div class="archive-tools"><button class="danger recordings-stop-all">Завершить все записи</button></div><p class="small-note">Остановка завершает WebM-файл и сохраняет его в архив. Перед остановкой всех записей требуется подтверждение. Выбор файла и уже начатое сохранение отображаются отдельно.</p>`;
 document.body.append(modal);modal.showModal();const q=s=>modal.querySelector(s),items=new Map();let closed=false,busy=false;
 q('.recordings-close').onclick=()=>modal.close();
 const error=e=>{if(!closed){q('.recordings-error').hidden=false;q('.recordings-error').textContent=e.message||String(e);}};
 function paint(){if(closed)return;const rows=getRows(),wanted=new Set(rows.map(r=>r.id));for(const [id,item] of items)if(!wanted.has(id)){item.remove();items.delete(id);}
  q('.recordings-status').textContent=`Записываются: ${rows.filter(r=>r.state==='recording').length} · Сохраняются: ${rows.filter(r=>r.state==='stopping').length} · Выбор файла: ${rows.filter(r=>r.state==='choosing').length}`;
  q('.recordings-stop-all').disabled=busy||!rows.some(r=>r.state==='recording');
  q('.recordings-list .empty')?.remove();
  for(const row of rows){let item=items.get(row.id);if(!item){item=document.createElement('article');item.className='archive-row';item.dataset.recording=row.id;item.innerHTML='<div class="archive-row-info"><strong class="recordings-label"></strong><span class="recordings-detail muted"></span><span class="archive-location"></span></div><div class="archive-row-actions"><button class="minor recordings-reveal">Показать пульт</button><button class="danger recordings-stop">Завершить</button></div>';items.set(row.id,item);q('.recordings-list').append(item);}
   item.querySelector('.recordings-label').textContent=row.label;item.querySelector('.recordings-detail').textContent=({choosing:'Выбор файла…',stopping:'Сохранение WebM…',recording:'● Запись · '+recordingDuration(row.startedAt)})[row.state]||row.state;
   item.querySelector('.archive-location').textContent=row.filePath||'Путь ещё не выбран';
   const reveal=item.querySelector('.recordings-reveal');reveal.disabled=!row.canReveal;reveal.onclick=()=>{if(onReveal(row.id))modal.close();else paint();};
   const stop=item.querySelector('.recordings-stop');stop.disabled=row.state!=='recording';stop.textContent=row.state==='stopping'?'Сохранение…':'Завершить';stop.onclick=async()=>{stop.disabled=true;try{await row.stop();}catch(e){error(e);}finally{paint();}};
  }
  if(!rows.length){const empty=document.createElement('p');empty.className='empty';empty.textContent='Активных записей нет. Начните запись кнопкой на видеоплитке.';q('.recordings-list').append(empty);}
 }
 q('.recordings-stop-all').onclick=async()=>{if(busy)return;busy=true;paint();try{const result=await stopRecordingBatch(getRows(),message=>window.confirm(message));if(result.failed)error(Error(`Не удалось завершить записей: ${result.failed}. Проверьте уведомления программы.`));}catch(e){error(e);}finally{busy=false;paint();}};
 const timer=setInterval(paint,500);modal.addEventListener('close',()=>{closed=true;clearInterval(timer);modal.remove();});paint();
}
