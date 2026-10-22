/** Synthetic video round-trip test. Video only; no camera, mic or operator credential. */
export class LoopbackTest {
  constructor({createRoom,createPattern,screenShareSource,onStatus=()=>{},onStateChange=()=>{},
    setTimer=setTimeout,clearTimer=clearTimeout,receiptTimeoutMs=15000,durationMs=30000}) {
    this.createRoom=createRoom;
    this.createPattern=createPattern;
    this.screenShareSource=screenShareSource;
    this.onStatus=onStatus;this.onStateChange=onStateChange;
    this.setTimer=setTimer;
    this.clearTimer=clearTimer;
    this.receiptTimeoutMs=receiptTimeoutMs;
    this.durationMs=durationMs;
    this.version=0;
    this.active=false;
    this.identity=null;
    this.received=false;
    this.room=null;
    this.pattern=null;
    this.timer=null;
    this.startedAt=0;
  }
  async start({wsUrl,token,identity}) {
    if(this.active) throw Error('Проверка уже запущена');
    if(!wsUrl || !token || !/^selftest_[a-f0-9]{20}$/.test(identity))throw Error('Некорректные данные проверки');
    const generation=++this.version;
    this.active=true;this.identity=identity;this.received=false;this.startedAt=Date.now();this.onStateChange(true);
    this.onStatus('Запуск тестового видеопотока…');
    try {
      this.pattern=this.createPattern();
      this.room=this.createRoom();
      const room=this.room;
      await room.connect(wsUrl,token);
      if(generation!==this.version){room.disconnect();return;}
      await room.localParticipant.publishTrack(this.pattern.track,{
        name:'USC_TEST_PATTERN',source:this.screenShareSource,simulcast:false
      });
      if(generation!==this.version){room.disconnect();return;}
      // The viewer may receive a frame before publishTrack() resolves.
      if(this.received)return;
      this.onStatus('Тест передаётся. Ожидание видеокадров в окне просмотра…');
      this.timer=this.setTimer(()=>{
        if(generation!==this.version || this.received)return;
        this.onStatus('✕ Не получен видеокадр за 15 секунд. Проверьте LiveKit и подписку.');
        this.stop(true);
      },this.receiptTimeoutMs);
    } catch(e) {
      if(generation===this.version){
        this.onStatus(`✕ Тест не запустился: ${e.message||e}`);
        this.stop(true);
      }
      throw e;
    }
  }
  onVideoFrame(identity) {
    if(!this.active || this.received || identity!==this.identity)return false;
    this.received=true;
    this.clearCurrentTimer();
    const elapsed=((Date.now()-this.startedAt)/1000).toFixed(1);
    this.onStatus(`✓ Видеопоток получен (${elapsed} с от начала проверки). Тест выключится автоматически.`);
    const generation=this.version;
    this.timer=this.setTimer(()=>{if(this.version===generation)this.stop();},this.durationMs);
    return true;
  }
  clearCurrentTimer(){if(this.timer!==null){this.clearTimer(this.timer);this.timer=null;}}
  stop(silent=false){
    if(!this.active && !this.room && !this.pattern)return;
    const succeeded=this.received;
    this.version++;this.active=false;this.identity=null;this.onStateChange(false);
    this.clearCurrentTimer();
    const room=this.room;const pattern=this.pattern;
    this.room=null;this.pattern=null;
    try{pattern?.stop();}catch{}
    try{room?.disconnect();}catch{}
    if(!silent)this.onStatus(succeeded?'✓ Тест завершён: видеокадр получен.':'Тестовый поток остановлен');
  }
}
/** Canvas.captureStream is a synthetic source; it never requests camera/screen permissions. */
export function createTestPattern({documentObject=document,setIntervalFn=setInterval,clearIntervalFn=clearInterval}={}){
  const canvas=documentObject.createElement('canvas');
  canvas.width=640;canvas.height=360;
  const context=canvas.getContext('2d');
  if(!context || typeof canvas.captureStream!=='function')throw Error('Встроенный Chromium не поддерживает canvas.captureStream');
  let tick=0;
  const draw=()=>{
    const w=canvas.width,h=canvas.height;
    context.fillStyle='#101b2c';context.fillRect(0,0,w,h);
    context.fillStyle='#3486ed';context.fillRect(16+(tick*5)%(w-130),90,100,12);
    context.fillStyle='#ffffff';context.font='bold 31px sans-serif';context.fillText('USC | VIDEO SELF-TEST',30,60);
    context.font='22px sans-serif';context.fillText(`Frame ${tick}  |  ${new Date().toLocaleTimeString()}`,30,170);
    context.fillStyle='#65d6a6';context.fillRect(30,200,570,6);
    tick++;
  };
  draw();
  const timer=setIntervalFn(draw,100);
  const media=canvas.captureStream(10);
  const track=media.getVideoTracks()[0];
  if(!track){clearIntervalFn(timer);throw Error('Chromium не создал видеотрек');}
  return {track,stop(){clearIntervalFn(timer);media.getTracks().forEach(t=>t.stop());}};
}
