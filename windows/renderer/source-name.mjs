export function sourceDisplayName(room,identity,fallback){
 if(typeof identity==='string'&&identity.startsWith('operator_')){const key=room?.keys?.find(key=>'operator_'+key.id===identity);if(key)return key.name;}
 return fallback||identity;
}
