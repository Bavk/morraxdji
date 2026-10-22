/** Retry only after terminal viewer disconnections. LiveKit handles its own transient reconnection. */
export function retryDelay(attempt) {
  if (!Number.isInteger(attempt) || attempt < 0) throw new RangeError('attempt must be >= 0');
  return Math.min(15000, 1000 * 2 ** Math.min(attempt, 4));
}
export class ViewerReconnect {
  constructor({onRetry, onWaiting = () => {}, setTimer = setTimeout, clearTimer = clearTimeout}) {
    this.onRetry=onRetry; this.onWaiting=onWaiting;
    this.setTimer=setTimer; this.clearTimer=clearTimer;
    this.attempt=0; this.timer=null; this.generation=0;
  }
  failure(roomId) {
    if (this.timer !== null) return false;
    const delay=retryDelay(this.attempt++);
    const version=this.generation;
    this.onWaiting(roomId,delay,this.attempt);
    this.timer=this.setTimer(() => {
      this.timer=null;
      if(version!==this.generation) return;
      this.onRetry(roomId);
    },delay);
    return true;
  }
  stop() {
    this.generation++;
    if(this.timer!==null){this.clearTimer(this.timer);this.timer=null;}
    this.attempt=0;
  }
  success(){this.stop();}
}
