const fs=require('node:fs/promises');
const {makeInvite}=require('./vpn.cjs');
function validateInvite(code){
 if(typeof code!=='string'||code.length<80||code.length>2500||!/^USCV1\.[A-Za-z0-9_-]+$/.test(code))throw Error('Для экспорта нужен единый VPN-код USCV1');
 try{const data=JSON.parse(Buffer.from(code.slice(6),'base64url').toString('utf8'));if(data.v!==1)throw Error();makeInvite({operatorKey:data.key,privateKey:data.privateKey,address:data.ip,relayKey:data.relayKey,endpoint:data.endpoint});}
 catch{throw Error('Некорректный VPN-код');}return code;
}
async function saveInvite(file,code){validateInvite(code);await fs.writeFile(file,code+'\n',{flag:'wx',mode:0o600});return {saved:true};}
module.exports={validateInvite,saveInvite};
