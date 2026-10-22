const profiles=[['auto','По настройкам пульта / комнаты'],['economy','Экономия · 360p / 15 FPS'],['standard','Стандарт · 720p / 15 FPS'],['detail','Детали · 1080p / 15 FPS']];
const colors=[['blue','Синий'],['green','Зелёный'],['orange','Оранжевый'],['purple','Фиолетовый'],['slate','Серый']];
export function showEntitySettings({kind,item,rooms,api,onSaved=()=>{}}){
 if(document.querySelector('#entitySettings'))return;
 const operator=kind==='operator',settings=item.settings||{},dialog=document.createElement('dialog');dialog.id='entitySettings';dialog.className='entity-settings recording-archive';
 dialog.innerHTML='<form><h2></h2><div class="settings-basic"></div><details><summary>Дополнительно</summary><div class="settings-advanced"></div></details><p class="small-note settings-note"></p><p role="alert" class="archive-error" hidden></p><div class="archive-tools"><button type="submit" class="primary">Сохранить</button><button type="button" class="minor settings-cancel">Отмена</button></div></form>';
 dialog.querySelector('h2').textContent=operator?'Настройки оператора':'Настройки комнаты';
 const fields=new Map();
 function field(key,label,{advanced=false,type='text',value='',max,options,min=0}={}){
  const row=document.createElement('label');row.textContent=label;
  const input=document.createElement(options?'select':type==='textarea'?'textarea':'input');input.name=key;input.id='setting-'+key;
  if(options)for(const [value,label] of options){const option=document.createElement('option');option.value=value;option.textContent=label;input.append(option);}
  else if(type!=='textarea')input.type=type;
  if(type==='checkbox')input.checked=value;else input.value=value??'';
  if(max!==undefined){if(type==='number'){input.min=min;input.max=max;input.step=1;}else input.maxLength=max;}
  if(key==='name')input.required=true;
  row.append(input);dialog.querySelector(advanced?'.settings-advanced':'.settings-basic').append(row);fields.set(key,input);return input;
 }
 field('name','Имя',{value:item.name,max:operator?60:80});
 if(operator){
  field('enabled','Доступ включён',{type:'checkbox',value:settings.enabled!==false});
  field('team','Команда / группа',{value:settings.team,max:80});field('device','Модель пульта',{value:settings.device,max:120});
  const date=settings.expiresAt?new Date(settings.expiresAt):null;
  const local=date?new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16):'';
  field('expiresAt','Доступ до (местное время; пусто — бессрочно)',{advanced:true,type:'datetime-local',value:local});
  field('preferredRoomId','Первая комната в списке пульта',{advanced:true,value:settings.preferredRoomId||'',options:[['','Без предпочтения'],...rooms.filter(r=>(item.allowedRoomIds||[]).includes(r.id)).map(r=>[r.id,r.name])]});
  field('notes','Заметки администратора',{advanced:true,type:'textarea',value:settings.notes,max:1000});
 }else{
  field('open','Принимать трансляции',{type:'checkbox',value:settings.open!==false});
  field('group','Группа комнат',{value:settings.group,max:80});field('description','Описание',{type:'textarea',value:settings.description,max:1000});
  field('color','Цвет',{advanced:true,value:settings.color||'blue',options:colors});
  field('maxOperators','Лимит назначенных операторов (0 — без лимита)',{advanced:true,type:'number',value:settings.maxOperators||0,max:141});
  field('sortOrder','Порядок в списке (меньше — выше)',{advanced:true,type:'number',value:settings.sortOrder||0,max:999});
 }
 field('profile',operator?'Профиль качества для этого оператора':'Профиль качества комнаты',{advanced:true,value:settings.profile||'auto',options:profiles});
 dialog.querySelector('.settings-note').textContent=operator?'Приостановка и истечение срока отключают трансляции во всех комнатах. Повторное включение сохраняет прежний ключ. Профиль применяется при следующем запуске на APK v0.33; это настройка штатного приложения. Заметки и модель пульта видны только администратору.':'Закрытие приёма завершает трансляции, но сохраняет операторов и записи. Лимит учитывает все назначенные неотозванные ключи, включая приостановленные. Профиль применяется при следующем запуске на APK v0.33, если у оператора выбран автоматический профиль.';
 let busy=false;dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.querySelector('.settings-cancel').onclick=()=>dialog.close();
 dialog.querySelector('form').onsubmit=async e=>{
  e.preventDefault();if(busy)return;
  const patch={};for(const [key,input] of fields){if(key==='name')continue;patch[key]=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value;}
  if(operator){patch.expiresAt=patch.expiresAt?new Date(patch.expiresAt).getTime():null;patch.preferredRoomId=patch.preferredRoomId||null;}
  if((operator&&!patch.enabled)||(!operator&&!patch.open)||operator&&patch.expiresAt!==null&&patch.expiresAt<=Date.now())if(!confirm('Действующие трансляции будут отключены. Сохранить?'))return;
  busy=true;for(const button of dialog.querySelectorAll('button'))button.disabled=true;
  try{const body={name:fields.get('name').value.trim(),settings:patch};const result=operator?await api.updateOperatorSettings(item.id,body):await api.updateRoomSettings(item.id,body);dialog.close();await onSaved(result);}
  catch(error){const target=dialog.querySelector('[role="alert"]');target.hidden=false;target.textContent=error.message||String(error);}
  finally{busy=false;for(const button of dialog.querySelectorAll('button'))button.disabled=false;}
 };
 document.body.append(dialog);dialog.showModal();
}
