export function wallShortcut(event,{ids,focusedId=null,blocked=false}={}){
 if(blocked||event.defaultPrevented||event.repeat||event.isComposing||event.ctrlKey||event.altKey||event.metaKey||event.shiftKey)return null;
 if(event.key==='Escape')return focusedId?{focus:null}:null;
 if(!/^[1-9]$/.test(event.key))return null;
 const id=ids[Number(event.key)-1];return id===undefined?null:{focus:id};
}
