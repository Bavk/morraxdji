export function recordingBusy(state){return ['choosing','recording','stopping'].includes(state);}
export function receiveEnabled({paused=false,hidden=false,recordingState=null}){return recordingBusy(recordingState)||(!paused&&!hidden);}
export function toggleReceive(entry){if(recordingBusy(entry.recorder?.state))return false;entry.receivePaused=!entry.receivePaused;return true;}
