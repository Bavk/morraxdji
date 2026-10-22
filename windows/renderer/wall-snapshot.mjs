const CELL_WIDTH=640,VIDEO_HEIGHT=360,LABEL_HEIGHT=56,GAP=12,PADDING=16,HEADER=80;
export function wallSnapshotLayout(count,columns=0){
 if(!Number.isInteger(count)||count<1)throw Error('Нет видимых пультов для снимка');
 if(count>16)throw Error('В общий снимок помещается до 16 видимых пультов. Используйте поиск или избранное.');
 const cols=Math.min(count,Number.isInteger(columns)&&columns>=1&&columns<=4?columns:Math.ceil(Math.sqrt(count))),rows=Math.ceil(count/cols);
 return {columns:cols,width:2*PADDING+cols*CELL_WIDTH+(cols-1)*GAP,height:HEADER+rows*(VIDEO_HEIGHT+LABEL_HEIGHT)+(rows-1)*GAP+PADDING,cells:Array.from({length:count},(_,i)=>({x:PADDING+(i%cols)*(CELL_WIDTH+GAP),y:HEADER+Math.floor(i/cols)*(VIDEO_HEIGHT+LABEL_HEIGHT+GAP),width:CELL_WIDTH,height:VIDEO_HEIGHT+LABEL_HEIGHT}))};
}
export function wallSnapshotSources(entries){return entries.filter(entry=>!entry.item.hidden).slice().sort((a,b)=>Number(a.item.style.order||0)-Number(b.item.style.order||0));}
function fitText(context,text,width){
 text=String(text).replace(/[\r\n\t]/g,' ');if(context.measureText(text).width<=width)return text;
 const characters=Array.from(text);while(characters.length&&context.measureText(characters.join('')+'…').width>width)characters.pop();return characters.join('')+'…';
}
export async function captureWallSnapshot(sources,{columns=0,capturedAt=new Date(),documentObject=document}={}){
 const layout=wallSnapshotLayout(sources.length,columns),canvas=documentObject.createElement('canvas');canvas.width=layout.width;canvas.height=layout.height;
 try{
  const context=canvas.getContext('2d');if(!context)throw Error('Не удалось подготовить снимок видеостены');
  context.fillStyle='#0e1420';context.fillRect(0,0,layout.width,layout.height);context.fillStyle='#e7eefb';context.font='bold 24px "Segoe UI", sans-serif';context.fillText('Universal Stream Control · Видеостена',PADDING,30);
  context.font='16px "Segoe UI", sans-serif';context.fillStyle='#b3c4de';context.fillText(capturedAt.toLocaleString('ru-RU')+' · '+sources.length+' пульт(ов) · кадры источников не синхронизированы',PADDING,58,layout.width-2*PADDING);
  for(let i=0;i<sources.length;i++){
   const source=sources[i],cell=layout.cells[i],video=source.video;
   context.fillStyle='#192439';context.fillRect(cell.x,cell.y,cell.width,cell.height);
   context.fillStyle='#e7eefb';context.font='bold 18px "Segoe UI", sans-serif';context.fillText(fitText(context,source.label,cell.width-24),cell.x+12,cell.y+23);
   context.font='14px "Segoe UI", sans-serif';context.fillStyle=source.state==='live'?'#65e6ad':'#ffd08a';context.fillText(fitText(context,source.status,cell.width-24),cell.x+12,cell.y+45);
   const top=cell.y+LABEL_HEIGHT;context.fillStyle='#050b15';context.fillRect(cell.x,top,CELL_WIDTH,VIDEO_HEIGHT);
   if(video?.readyState>=2&&video.videoWidth>0&&video.videoHeight>0){
    const scale=Math.min(CELL_WIDTH/video.videoWidth,VIDEO_HEIGHT/video.videoHeight),width=video.videoWidth*scale,height=video.videoHeight*scale;
    context.drawImage(video,cell.x+(CELL_WIDTH-width)/2,top+(VIDEO_HEIGHT-height)/2,width,height);
   }else{context.font='20px "Segoe UI", sans-serif';context.fillStyle='#93a2ba';context.fillText('Нет доступного кадра',cell.x+20,top+VIDEO_HEIGHT/2);}
  }
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('Не удалось создать PNG видеостены')),'image/png'));
  if(blob.size>32*1024*1024)throw Error('Снимок превышает 32 МБ');
  return {png:new Uint8Array(await blob.arrayBuffer()),width:layout.width,height:layout.height,count:sources.length};
 }finally{canvas.width=0;canvas.height=0;}
}
