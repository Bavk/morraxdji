export function frameTransition(previous,current){
 if(current==='stale'&&previous!=='stale')return 'frames-stalled';
 if(current==='live'&&previous==='stale')return 'frames-restored';
 return null;
}
export function filterEvents(rows,query){const needle=String(query).trim().toLocaleLowerCase('ru');return rows.filter(row=>`${row.label} ${row.message} ${new Date(row.at).toLocaleString('ru-RU')}`.toLocaleLowerCase('ru').includes(needle));}
export async function showEventLog(api){
 if(document.querySelector('#eventLog'))return;
 const modal=document.createElement('dialog');modal.id='eventLog';modal.className='recording-archive';
 modal.innerHTML=`<div class="archive-head"><div><h2>Журнал событий</h2><p class="muted">Последние 2000 событий просмотра на этом ПК</p></div><button class="minor event-close">Закрыть</button></div><div class="archive-tools"><input class="event-search" type="search" aria-label="Поиск событий" placeholder="Пульт, событие или дата…"><button class="minor event-refresh">Обновить</button><button class="minor event-export">Экспорт JSON</button></div><p class="event-status muted" role="status"></p><p class="event-error" role="alert" hidden></p><p class="small-note">События относятся к открытому просмотру. Отсутствие кадров может означать неподвижное изображение или паузу захвата. Экспорт содержит имена источников.</p><div class="event-list"></div><div class="archive-pages"><button class="minor event-prev">Назад</button><span class="event-page"></span><button class="minor event-next">Далее</button></div>`;
 document.body.append(modal);modal.showModal();const q=s=>modal.querySelector(s);let rows=[],page=0,closed=false,serial=0;
 modal.addEventListener('close',()=>{closed=true;serial++;modal.remove();});q('.event-close').onclick=()=>modal.close();
 q('.event-search').classList.add('archive-search');q('.event-error').classList.add('archive-error');
 const error=e=>{q('.event-error').hidden=false;q('.event-error').textContent=e.message||String(e);};
 function paint(){const found=filterEvents(rows,q('.event-search').value);page=Math.min(page,Math.max(0,Math.ceil(found.length/50)-1));q('.event-status').textContent=`Событий: ${rows.length} · Найдено: ${found.length}`;
  const list=q('.event-list');list.replaceChildren();
  for(const row of found.slice(page*50,(page+1)*50)){const item=document.createElement('article');item.className='archive-row';const text=document.createElement('div');text.className='archive-row-info';const title=document.createElement('strong');title.textContent=row.message;const detail=document.createElement('span');detail.textContent=`${new Date(row.at).toLocaleString('ru-RU')} · ${row.label}`;text.append(title,detail);item.append(text);list.append(item);}
  if(!found.length){const p=document.createElement('p');p.className='empty';p.textContent=rows.length?'Ничего не найдено':'Событий пока нет';list.append(p);}
  q('.event-prev').disabled=page===0;q('.event-next').disabled=(page+1)*50>=found.length;q('.event-page').textContent=`${page+1} / ${Math.max(1,Math.ceil(found.length/50))}`;
 }
 async function load(){const request=++serial;try{const data=await api.listEvents();if(closed||request!==serial)return;rows=data;q('.event-error').hidden=true;paint();}catch(e){if(!closed&&request===serial)error(e);}}
 q('.event-search').oninput=()=>{page=0;paint();};q('.event-prev').onclick=()=>{page--;paint();};q('.event-next').onclick=()=>{page++;paint();};q('.event-refresh').onclick=load;
 q('.event-export').onclick=async()=>{const button=q('.event-export');button.disabled=true;try{const result=await api.exportEvents();if(!closed&&result.saved)q('.event-status').textContent=`Экспортировано событий: ${result.count}`;}catch(e){if(!closed)error(e);}finally{if(!closed)button.disabled=false;}};
 await load();
}
