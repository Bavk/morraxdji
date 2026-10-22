export function validateName(value,maxLength){
 const name=String(value).trim();if(!name||name.length>maxLength||/[\u0000-\u001f\u007f]/.test(name))throw Error(`Введите название от 1 до ${maxLength} символов без управляющих символов`);return name;
}
export function askName({title,value='',maxLength=80}){
 if(document.querySelector('#nameDialog'))return Promise.resolve(null);
 return new Promise(resolve=>{
  const dialog=document.createElement('dialog');dialog.id='nameDialog';dialog.className='recording-archive recording-metadata';
  dialog.innerHTML='<form><h2></h2><label for="nameDialogInput">Название</label><input id="nameDialogInput" required autocomplete="off"><p class="archive-error" role="alert" hidden></p><div class="archive-tools"><button class="primary name-save" type="submit">Продолжить</button><button class="minor name-cancel" type="button">Отмена</button></div></form>';
  let result=null;const input=dialog.querySelector('input');input.maxLength=maxLength;input.value=value;dialog.querySelector('h2').textContent=title;
  dialog.querySelector('.name-cancel').onclick=()=>dialog.close();
  dialog.querySelector('form').onsubmit=event=>{event.preventDefault();try{result=validateName(input.value,maxLength);dialog.close();}catch(error){const host=dialog.querySelector('[role="alert"]');host.hidden=false;host.textContent=error.message;input.focus();}};
  dialog.addEventListener('close',()=>{dialog.remove();resolve(result);},{once:true});document.body.append(dialog);dialog.showModal();input.focus();input.select();
 });
}
