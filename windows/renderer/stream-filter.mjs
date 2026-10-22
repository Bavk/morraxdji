const normalize=value=>String(value??'').normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g,'е');
export function matchesSource(source,query){
 const words=normalize(query).trim().split(/\s+/).filter(Boolean);
 const text=normalize(`${source.label??''} ${source.roomName??''}`);
 return words.every(word=>text.includes(word));
}
export function filteredLayout(sources,query,focusedId=null){
 const matching=sources.filter(source=>matchesSource(source,query)).map(source=>source.id);
 const focus=matching.includes(focusedId)?focusedId:null;
 return {matching,visible:focus?[focus]:matching,focusedId:focus};
}
