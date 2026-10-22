// A room deleted from the local catalog may still be joined using a previously
// issued LiveKit JWT. Keep a tombstone for token TTL + clock-skew allowance,
// and repeatedly delete the LiveKit room during that protection window.
export const DELETED_ROOM_GUARD_MS = 6 * 60 * 1000; // 5 min JWT + 1 min margin

export async function reconcilePendingRoomDeletions(deletions, mediaControl, acknowledge, now=Date.now()) {
  const summary={pendingRoomsChecked:0,pendingRoomsRemoved:0,pendingRoomsEnforced:0,pendingRoomFailures:[]};
  if (!mediaControl) return summary;
  for (const entry of deletions) {
    summary.pendingRoomsChecked++;
    try {
      await mediaControl.deleteRoom(entry.id); // a missing room is also success
      summary.pendingRoomsEnforced++;
      if (now >= entry.expireAt) {
        await acknowledge(entry.id);
        summary.pendingRoomsRemoved++;
      }
    } catch (error) {
      summary.pendingRoomFailures.push({roomId:entry.id,message:String(error?.message || error).slice(0,160)});
    }
  }
  return summary;
}
