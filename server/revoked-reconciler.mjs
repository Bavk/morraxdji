import {reconcilePendingRoomDeletions} from './pending-deletions.mjs';

// Periodic best-effort enforcement of already-revoked operator credentials.
// A failed LiveKit kick must not leave a participant streaming indefinitely when
// the media server later becomes available again.
export async function reconcileRevokedOperators(rooms, mediaControl) {
  const summary = { roomsChecked: 0, participantsRemoved: 0, failures: [] };
  if (!mediaControl) return summary;
  for (const room of rooms) {
    const revoked = new Set((room.keys || []).filter(k => k.revoked).map(k => `operator_${k.id}`));
    if (!revoked.size) continue;
    summary.roomsChecked++;
    try {
      const participants = await mediaControl.listParticipants(room.id);
      for (const participant of participants) {
        if (!revoked.has(participant.identity)) continue;
        try {
          await mediaControl.removeParticipant(room.id, participant.identity);
          summary.participantsRemoved++;
        } catch (error) {
          summary.failures.push({roomId:room.id,identity:participant.identity,
            message:String(error?.message || error).slice(0,160)});
        }
      }
    } catch (error) {
      summary.failures.push({roomId:room.id,identity:null,
        message:String(error?.message || error).slice(0,160)});
    }
  }
  return summary;
}

// Serializes attempts; a slow LiveKit response cannot create overlapping sweeps.
export function startRevocationReconciler({getRooms,getDeletedRooms=()=>[],ackDeletedRoom=()=>{},mediaControl,periodMs=30000,
  interval=setInterval,cancelInterval=clearInterval, logger=console}={}) {
  if (typeof getRooms !== 'function' || !mediaControl || !Number.isInteger(periodMs) || periodMs < 1000)
    throw Error('Invalid revocation reconciler configuration');
  let stopped = false;
  let inFlight = false;
  const sweep = async () => {
    if (stopped || inFlight) return null;
    inFlight = true;
    try {
      const outcome = await reconcileRevokedOperators(getRooms(),mediaControl);
      const removed = await reconcilePendingRoomDeletions(getDeletedRooms(), mediaControl, ackDeletedRoom);
      const result={...outcome,...removed};
      if (outcome.failures.length) logger.warn('USC revocation retry pending', outcome.failures);
      if (removed.pendingRoomFailures.length) logger.warn('USC room deletions pending', removed.pendingRoomFailures);
      return result;
    } finally { inFlight = false; }
  };
  const timer = interval(() => {
    Promise.resolve(sweep()).catch(e => logger.warn('USC revocation sweep failed:',e.message));
  },periodMs);
  timer?.unref?.();
  return {sweep,stop(){stopped=true;cancelInterval(timer);}};
}
