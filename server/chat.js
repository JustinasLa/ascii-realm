// The lobby's chat relay. Text is cleaned and checked here, whatever the
// page did; who hears a line, and how clearly, follows from the players' last
// reported positions. Each listener gets their own version of it.
import { chatSeed, CHAT_CHANNELS, cleanChatText, clarityAt, isChannel, MAX_CHAT_LENGTH, metresBetween, muffle,
  SPAM } from '../src/multiplayer/chat.js';

export function createChatRelay({ send, now = Date.now }) {
  const notice = (player, code, extra = {}) => send(player.socket, { type: 'chat-notice', code, ...extra });

  // The spam budget lives on the player, so reconnecting doesn't refill it.
  function allow(player) {
    const time = now();
    player.chatSpam = Math.max(0, (player.chatSpam ?? 0) - (time - (player.chatAt ?? time)) * SPAM.drainPerSecond / 1000);
    player.chatAt = time;
    if (player.chatSpam + SPAM.add > SPAM.max) return false;
    player.chatSpam += SPAM.add;
    return true;
  }

  function toggle(player, channel) {
    if (!isChannel(channel) || !CHAT_CHANNELS[channel].toggleable) return notice(player, 'invalid');
    const hidden = !player.hidden.has(channel);
    if (hidden) player.hidden.add(channel);
    else player.hidden.delete(channel);
    notice(player, 'toggled', { channel, hidden });
  }

  function say(room, speaker, channel, raw) {
    if (!isChannel(channel)) return notice(speaker, 'invalid');
    if (speaker.hidden.has(channel)) return notice(speaker, 'hidden');
    const text = cleanChatText(raw);
    if (!text) return;
    if (text.length > MAX_CHAT_LENGTH) return notice(speaker, 'too-long');
    const def = CHAT_CHANNELS[channel];
    const seq = room.chatSeq = (room.chatSeq ?? 0) + 1;
    let heard = 0;
    for (const listener of room.players.values()) {
      if (!listener.socket) continue;
      const self = listener === speaker;
      if (!self && listener.hidden.has(channel)) continue;
      // The speaker hears themselves clearly; a lobby-wide channel reaches
      // everyone however far away they are.
      let clarity = 1;
      let out = { text, muffled: false };
      if (!self && def.range > 0) {
        const distance = metresBetween(speaker.state, listener.state);
        if (distance > def.range) continue;
        if (def.speech) {
          clarity = clarityAt(distance, def.range);
          out = muffle(text, clarity, chatSeed(seq, listener.id));
          if (!out) continue;
        }
      }
      send(listener.socket, { type: 'chat', seq, channel, from: speaker.id, name: speaker.name, text: out.text,
        clarity: Math.round(clarity * 100) / 100, muffled: out.muffled });
      if (!self) heard++;
    }
    // After the echo, so the speaker's log reads in order.
    if (!heard) notice(speaker, 'unheard');
  }

  return {
    handle(session, request) {
      const player = session.player;
      if (!player || (request.type !== 'chat' && request.type !== 'chat-toggle')) return;
      if (!allow(player)) return notice(player, 'rate');
      if (request.type === 'chat-toggle') toggle(player, request.channel);
      else say(session.room, player, request.channel, request.text);
    },
  };
}
