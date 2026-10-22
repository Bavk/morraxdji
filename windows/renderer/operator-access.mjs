export function showOperatorAccess({api,operator,homeRoomId,rooms,onSaved=()=>{}}){
 if(document.querySelector('#operatorAccess'))return;
 const dialog=document.createElement('dialog');dialog.id='operatorAccess';dialog.className='recording-archive recording-metadata';
 dialog.innerHTML='<form><h2>Доступ оператора к комнатам</h2><p class="access-name"></p><p class="muted">Выберите комнаты, в которые пульт сможет передавать экран. На Android выбор появится при начале трансляции. Снятие доступа завершит старый сеанс в этой комнате. Ключ создаётся и отзывается в исходной комнате.</p><div class="access-rooms"></div><p class="archive-error" role="alert" hidden></p><div class="archive-tools"><button type="submit" class="primary access-save">Сохранить доступ</button><button type="button" class="minor access-cancel">Отмена</button></div></form>';
 dialog.querySelector('.access-name').textContent=operator.name;const selected=new Set(operator.allowedRoomIds||[homeRoomId]);
 for(const room of rooms){const label=document.createElement('label'),checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.value=room.id;checkbox.checked=selected.has(room.id);label.append(checkbox,document.createTextNode(' '+room.name+(room.id===homeRoomId?' · исходная':'')));dialog.querySelector('.access-rooms').append(label);}
 let busy=false;dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.querySelector('.access-cancel').onclick=()=>dialog.close();
 dialog.querySelector('form').onsubmit=async event=>{event.preventDefault();if(busy)return;const ids=[...dialog.querySelectorAll('.access-rooms input:checked')].map(input=>input.value);const error=dialog.querySelector('[role="alert"]');if(!ids.length){error.hidden=false;error.textContent='Выберите хотя бы одну комнату';return;}busy=true;for(const button of dialog.querySelectorAll('button'))button.disabled=true;
  try{const result=await api.assignOperatorRooms(operator.id,ids);dialog.close();await onSaved(result);}catch(e){if(dialog.isConnected){error.hidden=false;error.textContent=e.message||String(e);}}finally{busy=false;for(const button of dialog.querySelectorAll('button'))button.disabled=false;}
 };
 document.body.append(dialog);dialog.showModal();
}
