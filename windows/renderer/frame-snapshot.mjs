export async function captureFrame(video,{documentObject=document}={}){
 const width=video.videoWidth,height=video.videoHeight;
 if(video.readyState<2||!width||!height)throw Error('Сначала дождитесь видеокадра от пульта');
 if(width>8192||height>8192||width*height>16*1024*1024)throw Error('Слишком большой кадр. Максимум 16 мегапикселей');
 const canvas=documentObject.createElement('canvas');canvas.width=width;canvas.height=height;
 const context=canvas.getContext('2d');if(!context)throw Error('Не удалось подготовить снимок');
 try{
  context.drawImage(video,0,0,width,height);
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('Не удалось создать PNG-снимок')),'image/png'));
  if(blob.size>32*1024*1024)throw Error('Снимок превышает 32 МБ');
  return {png:new Uint8Array(await blob.arrayBuffer()),width,height};
 }finally{canvas.width=0;canvas.height=0;}
}
