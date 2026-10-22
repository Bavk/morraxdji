export function markerTime(seconds){
 if(!Number.isFinite(seconds)||seconds<0||seconds>3599999)throw Error('Время кадра недоступно для отметки');
 const total=Math.floor(seconds),hours=Math.floor(total/3600),minutes=Math.floor(total/60)%60,rest=total%60;
 return (hours?String(hours).padStart(2,'0')+':':'')+String(minutes).padStart(2,'0')+':'+String(rest).padStart(2,'0');
}
export function noteWithMarker(note,seconds){
 if(typeof note!=='string')throw Error('Заметка недоступна');
 const result=(note.trimEnd()?note.trimEnd()+'\n':'')+markerTime(seconds)+' — ';
 if(result.length>2000)throw Error('В заметке нет места для отметки. Сократите текст через «Название / заметка».');
 return result;
}
export function parseMarkerLine(line){
 const match=/^(?:(\d{1,3}):([0-5]\d):([0-5]\d)|(\d{1,5}):([0-5]\d))(?=\s|$)/.exec(line);
 if(!match)return null;
 const seconds=match[1]!==undefined?Number(match[1])*3600+Number(match[2])*60+Number(match[3]):Number(match[4])*60+Number(match[5]);
 if(seconds>3599999)return null;
 return {code:match[0],seconds,tail:line.slice(match[0].length)};
}
export function markerSeekTime(seconds,duration){
 if(!Number.isFinite(seconds)||seconds<0||seconds>3599999)throw Error('Некорректный таймкод');
 if(Number.isFinite(duration)&&seconds>duration)throw Error('Отметка находится за пределами этой записи');
 return seconds;
}
