// The lobby's note relay. A played note is checked here, whatever the page
// did, and goes to every other member of the lobby; each listener decides by
// distance whether it is heard. Nothing is echoed to the performer.
import { readNote, RollingLimit } from '../src/multiplayer/protocol.js';

export function createNoteRelay({ send, now = () => performance.now() }) {
  return {
    handle(session, request) {
      const player = session.player;
      if (!player) return;
      // A malformed note is dropped without touching the budget.
      const note = readNote(request.note);
      if (!note) return;
      // The budget lives on the player, so reconnecting doesn't refill it.
      // Past it, notes are dropped silently.
      player.notes ??= new RollingLimit();
      if (!player.notes.allow(now())) return;
      for (const peer of session.room.players.values()) {
        if (peer.socket && peer !== player) send(peer.socket, { type: 'note', from: player.id, note });
      }
    },
  };
}
