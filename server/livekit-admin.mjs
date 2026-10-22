// Local LiveKit RoomService (Twirp) client. Never expose its signed grants to operators.
import crypto from 'node:crypto';

export class LiveKitAdmin {
  constructor({endpoint = 'http://127.0.0.1:7880', apiKey, apiSecret, request = fetch, timeoutMs = 4500}) {
    const u = new URL(endpoint);
    if(u.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) || u.username || u.password || u.pathname !== '/') {
      throw Error('LiveKit administration must use a local loopback HTTP endpoint');
    }
    if(!apiKey || !apiSecret) throw Error('LiveKit API credentials required');
    this.endpoint = u.origin;
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.request = request;
    this.timeoutMs = timeoutMs;
  }
  token(room, roomCreate=false){
    const now = Math.floor(Date.now()/1000);
    const encoded = object => Buffer.from(JSON.stringify(object)).toString('base64url');
    const header = encoded({alg:'HS256',typ:'JWT'});
    const payload = encoded({iss:this.apiKey, sub:'usc-windows-control', iat:now, nbf:now,exp:now+60,
      video:roomCreate?{roomCreate:true}:{room,roomAdmin:true}});
    const signing = `${header}.${payload}`;
    return `${signing}.${crypto.createHmac('sha256',this.apiSecret).update(signing).digest('base64url')}`;
  }
  async call(action, body, room, roomCreate=false){
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(),this.timeoutMs);
    try {
      const response = await this.request(`${this.endpoint}/twirp/livekit.RoomService/${action}`, {
        method:'POST',headers:{authorization:`Bearer ${this.token(room,roomCreate)}`,'content-type':'application/json'},
        body:JSON.stringify(body),signal:controller.signal
      });
      const data = await response.json().catch(()=>({}));
      if(!response.ok){
        const e = Error(`LiveKit ${action}: ${String(data.msg || data.error || response.status).slice(0,180)}`);
        e.status = response.status; e.code = data.code;
        throw e;
      }
      return data;
    } finally {clearTimeout(timer);}
  }
  async listParticipants(room){
    try {return (await this.call('ListParticipants',{room},room)).participants || [];}
    catch(e){if(e.status===404 || e.code==='not_found') return [];throw e;}
  }
  async removeParticipant(room,identity){
    try {await this.call('RemoveParticipant',{room,identity},room);return true;}
    catch(e){if(e.status===404 || e.code==='not_found') return false;throw e;}
  }
  async deleteRoom(room){
    try {await this.call('DeleteRoom',{room},null,true);return true;}
    catch(e){if(e.status===404 || e.code==='not_found') return false;throw e;}
  }
}
