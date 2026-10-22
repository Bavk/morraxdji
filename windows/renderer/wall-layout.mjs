const STORAGE_KEY='usc-wall-layout-v1';
const LIMIT=500;
export function sourceKey(room,identity){
 if(![room,identity].every(x=>typeof x==='string'&&x.length>0&&x.length<=256))throw Error('Некорректный источник');
 return JSON.stringify([room,identity]);
}
function validKey(key){try{const parts=JSON.parse(key);return Array.isArray(parts)&&parts.length===2&&sourceKey(...parts)===key;}catch{return false;}}
export class WallLayout{
 constructor(storage,onError=()=>{}){
  this.storage=storage;this.onError=onError;this.order=[];this.columns=0;
  try{const raw=storage.getItem(STORAGE_KEY);if(raw){const saved=JSON.parse(raw);if(!saved||saved.version!==1||!Array.isArray(saved.order)||saved.order.length>LIMIT||!saved.order.every(validKey))throw Error('Некорректные настройки видеостены');this.order=[...new Set(saved.order)];this.columns=[0,1,2,3,4].includes(saved.columns)?saved.columns:0;}
   else {const legacy=Number(storage.getItem('usc-grid-columns'));this.columns=[0,1,2,3,4].includes(legacy)?legacy:0;}
  }catch{onError();}
 }
 save(){try{this.storage.setItem(STORAGE_KEY,JSON.stringify({version:1,columns:this.columns,order:this.order}));return true;}catch{this.onError();return false;}}
 setColumns(value){if(![0,1,2,3,4].includes(value))return false;this.columns=value;return this.save();}
 remember(keys){let changed=false;for(const key of keys){if(validKey(key)&&!this.order.includes(key)&&this.order.length<LIMIT){this.order.push(key);changed=true;}}if(changed)this.save();}
 sorted(keys){const rank=new Map(this.order.map((key,i)=>[key,i]));return [...keys].sort((a,b)=>(rank.get(a)??LIMIT)-(rank.get(b)??LIMIT));}
 move(key,delta,keys){
  if(![-1,1].includes(delta))return false;this.remember(keys);const visible=this.sorted([...new Set(keys)]);const index=visible.indexOf(key),next=index+delta;
  if(index<0||next<0||next>=visible.length)return false;
  const a=this.order.indexOf(key),b=this.order.indexOf(visible[next]);if(a<0||b<0)return false;
  [this.order[a],this.order[b]]=[this.order[b],this.order[a]];this.save();return true;
 }
 reset(keys){this.order=[...new Set(keys.filter(validKey))].slice(0,LIMIT);return this.save();}
}
export function showWallOrder(layout,{getSources,onChange}){
 if(document.querySelector('#wallOrder'))return;
 const modal=document.createElement('dialog');modal.id='wallOrder';modal.className='recording-archive';
 modal.innerHTML=`<div class="archive-head"><div><h2>Порядок пультов</h2><p class="muted">Расположение сохраняется на этом Windows-ПК</p></div><button class="minor order-close">Закрыть</button></div><p class="small-note">Стрелки меняют порядок слева направо, затем сверху вниз. Отключившийся источник возвращается на сохранённое место среди доступных пультов. Записи продолжаются.</p><div class="order-list"></div><div class="archive-tools"><button class="minor order-reset">По подключению</button></div><p class="small-note muted">Сохраняются до 500 источников. Новые ключи операторов считаются новыми источниками. Кнопка «По подключению» также удаляет порядок отсутствующих источников.</p>`;
 document.body.append(modal);modal.showModal();let signature='';
 const q=s=>modal.querySelector(s);q('.order-close').onclick=()=>modal.close();
 function paint(force=false){const sources=getSources();const byKey=new Map(sources.map(x=>[x.key,x]));const ordered=layout.sorted([...byKey.keys()]);const stamp=JSON.stringify(ordered.map(k=>[k,byKey.get(k).label]));if(!force&&stamp===signature)return;signature=stamp;q('.order-list').replaceChildren();
  ordered.forEach((key,index)=>{const item=document.createElement('article');item.className='archive-row';item.dataset.source=key;const label=document.createElement('strong');label.textContent=`${index+1}. ${byKey.get(key).label}`;label.className='order-label';const actions=document.createElement('div');actions.className='archive-row-actions';
   for(const [delta,text,cls] of [[-1,'↑ Выше','order-up'],[1,'↓ Ниже','order-down']]){const button=document.createElement('button');button.className='minor '+cls;button.textContent=text;button.disabled=delta<0?index===0:index===ordered.length-1;button.setAttribute('aria-label',text+': '+byKey.get(key).label);button.onclick=()=>{const latest=getSources().map(x=>x.key);if(layout.move(key,delta,latest)){onChange();paint(true);[...modal.querySelectorAll('[data-source]')].find(row=>row.dataset.source===key)?.querySelector('.'+cls)?.focus();}};actions.append(button);}
   item.append(label,actions);q('.order-list').append(item);
  });
  if(!ordered.length){const empty=document.createElement('p');empty.className='empty';empty.textContent='Нет открытых видеопотоков. Подключите пульт или откройте «Все пульты».';q('.order-list').append(empty);}
  q('.order-reset').disabled=!layout.order.length;
 }
 q('.order-reset').onclick=()=>{layout.reset(getSources().map(x=>x.key));onChange();paint(true);};
 const timer=setInterval(()=>paint(),1000);modal.addEventListener('close',()=>{clearInterval(timer);modal.remove();});paint(true);
}
