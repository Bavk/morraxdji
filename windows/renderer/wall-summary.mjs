export function summarizeStreams(rows,now,{maxAgeMs=3500}={}){
 const result={total:rows.length,live:0,stale:0,paused:0,waiting:0,disconnected:0,hidden:0,receiving:0,measured:0,mbps:0};
 for(const row of rows){
  if(row.hidden)result.hidden++;
  if(!row.connected){result.disconnected++;continue;}
  if(!row.receiving){result.paused++;continue;}
  result.receiving++;
  const age=now-row.sampleAt,fresh=Number.isFinite(age)&&age>=0&&age<=maxAgeMs;
  if(fresh&&['live','stale'].includes(row.sample?.state))result[row.sample.state]++;else result.waiting++;
  if(fresh&&Number.isFinite(row.sample?.mbps)&&row.sample.mbps>=0){result.measured++;result.mbps+=row.sample.mbps;}
 }
 return result;
}
export function formatStreamSummary(summary){
 const rate=summary.receiving===0?'0.00 Мбит/с':summary.measured?summary.mbps.toFixed(2)+' Мбит/с':'—';
 return `Потоков: ${summary.total} · LIVE: ${summary.live} · Без новых кадров: ${summary.stale} · Приостановлено: ${summary.paused} · Ожидание: ${summary.waiting} · Нет связи: ${summary.disconnected} · Скрыто: ${summary.hidden} · Приём: ${rate} (${summary.measured}/${summary.receiving})`;
}
