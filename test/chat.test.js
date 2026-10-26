import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capChat, channelForCommand, CHAT_CHANNELS, chatSeed, clarityAt, cleanChatText, DEFAULT_CHANNEL, HELP_LINES,
  MAX_CHAT_LENGTH, metresBetween, muffle, noticeText, parseChatInput, phoneticMuffle, readChat, readChatNotice,
  HEARING, SWITCHABLE, TOGGLEABLE } from '../src/multiplayer/chat.js';
import { SCALE, TILT } from '../src/entities/rig.js';
import { ASPECT } from '../src/world/world.js';

const u = (...codes) => String.fromCharCode(...codes);

test('the channel table keeps local speech as the default and the lobby-wide channel unlimited', () => {
  assert.equal(DEFAULT_CHANNEL, 'rp');
  assert.deepEqual(Object.keys(CHAT_CHANNELS), ['rp', 'ooc', 'looc', 'whisper', 'shout', 'yell', 'action', 'scene']);
  assert.deepEqual(SWITCHABLE, ['rp', 'ooc', 'looc', 'whisper', 'shout', 'yell', 'action']);
  assert.deepEqual(TOGGLEABLE, ['ooc', 'looc']);
  assert.equal(CHAT_CHANNELS.ooc.range, 0);
  assert.deepEqual(['rp', 'shout', 'yell', 'whisper'].map((id) => CHAT_CHANNELS[id].range), [15, 24, 48, 2]);
  assert.ok(Object.isFrozen(CHAT_CHANNELS.rp));
  assert.equal(CHAT_CHANNELS.scene.switchable, false);
  assert.equal(CHAT_CHANNELS.whisper.bubble, false);
});

test('chat text is cleaned to printable ASCII', () => {
  const quotes = `${u(0x201c)}Hi${u(0x201d)} it${u(0x2019)}s ${u(0x2014)} fine${u(0x2026)}`;
  assert.equal(cleanChatText(quotes), '"Hi" it\'s - fine...');
  assert.equal(cleanChatText(`Kl${u(0x0105)}da caf${u(0x00e9)}`), 'Klada cafe');
  assert.equal(cleanChatText(`hi ${u(0xd83d, 0xde00)} there`), 'hi there');
  assert.equal(cleanChatText(`a${u(0x202e)}b${u(0x200b)}c${u(0x2066)}d${u(0x0007)}e${u(0x00a7)}6f`), 'abcde6f');
  assert.equal(cleanChatText(`  lots \t of\n\nspace${u(0x00a0)}${u(0x3000)}here  `), 'lots of space here');
  assert.equal(cleanChatText('   '), '');
  assert.equal(cleanChatText(42), null);
  assert.equal(cleanChatText(null), null);
  assert.equal(cleanChatText('x'.repeat(1025)), null);
  assert.equal(cleanChatText('x'.repeat(1024)).length, 1024);
  assert.equal(cleanChatText('x'.repeat(256)).length, 256);
  assert.equal(cleanChatText('x'.repeat(257)).length, 257);
  assert.equal(cleanChatText('<img src=x onerror=alert(1)>'), '<img src=x onerror=alert(1)>');
});

test('plain text goes to the active channel and commands send once elsewhere', () => {
  assert.deepEqual(parseChatInput('hello  there'), { kind: 'send', channel: 'rp', text: 'hello there' });
  assert.deepEqual(parseChatInput('hello', { active: 'ooc' }), { kind: 'send', channel: 'ooc', text: 'hello' });
  const sends = { '/rp a': 'rp', '/ooc a': 'ooc', '/looc a': 'looc', '/whisper a': 'whisper', '/wh a': 'whisper',
    '/shout a': 'shout', '/yell a': 'yell', '/y a': 'yell', '/me a': 'action', '/scene a': 'scene',
    '   /SHOUT a': 'shout', '/x:shout a': 'shout', '/Y a': 'yell' };
  for (const [input, channel] of Object.entries(sends)) {
    assert.deepEqual(parseChatInput(input), { kind: 'send', channel, text: 'a' }, input);
  }
  assert.deepEqual(parseChatInput('/me   waves  hello'), { kind: 'send', channel: 'action', text: 'waves hello' });
  assert.deepEqual(parseChatInput('/shout'), { kind: 'error', code: 'usage', label: 'shout' });
  assert.deepEqual(parseChatInput('/y    '), { kind: 'error', code: 'usage', label: 'y' });
  assert.deepEqual(parseChatInput(''), { kind: 'empty' });
  assert.deepEqual(parseChatInput('   '), { kind: 'empty' });
  assert.deepEqual(parseChatInput(undefined), { kind: 'empty' });
  assert.deepEqual(parseChatInput('/'), { kind: 'error', code: 'unknown' });
  assert.deepEqual(parseChatInput('/ hi'), { kind: 'error', code: 'unknown' });
  assert.deepEqual(parseChatInput('/dance now'), { kind: 'error', code: 'unknown' });
  assert.deepEqual(parseChatInput('/admin hi'), { kind: 'error', code: 'unknown' });
  assert.deepEqual(parseChatInput('/help'), { kind: 'help' });
  assert.deepEqual(parseChatInput('x'.repeat(250) + u(0x2026, 0x2026, 0x2026)), { kind: 'error', code: 'too-long' });
  assert.deepEqual(parseChatInput('hi', { hidden: new Set(['rp']) }), { kind: 'error', code: 'hidden' });
  assert.deepEqual(parseChatInput('/ooc hi', { hidden: new Set(['ooc']) }), { kind: 'error', code: 'hidden' });
});

test('/channel shows, switches and refuses; /channeltoggle hides only out-of-character channels', () => {
  assert.deepEqual(parseChatInput('/channel'), { kind: 'show-channel', channel: 'rp' });
  assert.deepEqual(parseChatInput('/channel', { active: 'yell' }), { kind: 'show-channel', channel: 'yell' });
  assert.deepEqual(parseChatInput('/channel ooc'), { kind: 'switch', channel: 'ooc' });
  assert.deepEqual(parseChatInput('/CHANNEL me'), { kind: 'switch', channel: 'action' });
  assert.deepEqual(parseChatInput('/channel wh'), { kind: 'switch', channel: 'whisper' });
  assert.deepEqual(parseChatInput('/channel rp'), { kind: 'error', code: 'already' });
  assert.deepEqual(parseChatInput('/channel scene'), { kind: 'error', code: 'not-switchable' });
  assert.deepEqual(parseChatInput('/channel admin'), { kind: 'error', code: 'not-switchable' });
  assert.deepEqual(parseChatInput('/channel __proto__'), { kind: 'error', code: 'not-switchable' });
  assert.deepEqual(parseChatInput('/channel a b'), { kind: 'error', code: 'syntax', label: 'channel' });
  assert.deepEqual(parseChatInput('/channeltoggle looc'), { kind: 'toggle', channel: 'looc' });
  assert.deepEqual(parseChatInput('/channeltoggle OOC'), { kind: 'toggle', channel: 'ooc' });
  assert.deepEqual(parseChatInput('/channeltoggle rp'), { kind: 'error', code: 'not-toggleable' });
  assert.deepEqual(parseChatInput('/channeltoggle'), { kind: 'error', code: 'syntax', label: 'channeltoggle' });
  assert.equal(channelForCommand('NS:Wh'), 'whisper');
  assert.equal(channelForCommand('shout:'), null);
  assert.equal(channelForCommand('dance'), null);
});

test('distance is measured in the party frames\' metres', () => {
  const old = (a, b) => Math.hypot((a.x - b.x) * ASPECT / SCALE, (a.y - b.y) / (SCALE * TILT));
  for (const [a, b] of [[{ x: 0, y: 0 }, { x: 100, y: 0 }], [{ x: 3, y: -7 }, { x: -40, y: 90 }]]) {
    assert.equal(metresBetween(a, b), old(a, b));
  }
  assert.equal(metresBetween({ x: 0, y: 0 }, { x: 0, y: SCALE * TILT * 15 }), 15);
});

test('clarity is full up to 60% of the range and eases to nothing at its edge', () => {
  assert.equal(clarityAt(0, 15), 1);
  assert.equal(clarityAt(9, 15), 1);
  assert.ok(Math.abs(clarityAt(12, 15) - 0.5) < 1e-9);
  assert.equal(clarityAt(15, 15), 0);
  assert.equal(clarityAt(16, 15), 0);
  assert.equal(clarityAt(500, 0), 1);
  assert.ok(clarityAt(10, 15) < 1 && clarityAt(10, 15) > clarityAt(11, 15));
});

test('muffling follows the clarity thresholds and is the same for the same seed', () => {
  assert.equal(muffle('hello', HEARING.minAudible - 0.01, 1), null);
  assert.deepEqual(muffle('hello', 0.1, 1), { text: '*muffled voices*', muffled: true });
  assert.deepEqual(muffle('hello there', 0.85, 1), { text: 'hello there', muffled: false });
  assert.deepEqual(muffle('hello there', 1, 1), { text: 'hello there', muffled: false });
  const seed = chatSeed(1, 'b2');
  assert.deepEqual(muffle('the ship is lost', 0.3, seed), muffle('the ship is lost', 0.3, seed));
  // The configured rules blur the first "th" and "sh"; nothing else changes then.
  assert.deepEqual(muffle('the ship is lost', 0.3, seed), { text: 'th...e sh...ip is lost', muffled: false });
  // Without a rule's match, the sounds themselves blur.
  assert.deepEqual(muffle('the ship is lost', 0.7, seed), { text: 'ne ship is losn', muffled: false });
  assert.notEqual(chatSeed(1, 'b2'), chatSeed(2, 'b2'));
  assert.notEqual(chatSeed(1, 'b2'), chatSeed(1, 'b3'));
});

// A scripted random source: doubles, ints and booleans in turn from lists.
const script = ({ doubles = [], ints = [], bools = [] }) => {
  const [d, i, b] = [[...doubles], [...ints], [...bools]];
  return { double: () => d.length ? d.shift() : 0.999, int: (n) => i.length ? i.shift() : n - 1, bool: () => b.length ? b.shift() : true };
};

test('the phonetic muffler swaps clusters, smears consonants, breaks and slurs long words', () => {
  const always = () => ({ double: () => 0, int: () => 0, bool: () => true });
  // Barely muffled speech is left alone.
  assert.equal(phoneticMuffle('stop', 0.96, script({})), 'stop');
  // st and ss are forced past 0.45 distortion, whatever the roll; words are
  // lower-cased, and punctuation and one-letter words stay.
  assert.equal(phoneticMuffle('Stop, a stop!', 0.5, script({})), 'snop, a snop!');
  // The last consonant turns nasal, and an inner one with it.
  assert.equal(phoneticMuffle('stop', 0.5, always()), 'smom');
  // Long words break at syllable edges, twice when long enough, and lose a
  // leading letter.
  assert.equal(phoneticMuffle('wonderful', 0.5, always()), '...omn...emf...ul');
  // A doubled consonant is where a word breaks, without repeating it.
  assert.equal(phoneticMuffle('puffing', 0.5, always()), 'puf...in');
  // Suffixes keep their sound while the stem's last consonant blurs.
  assert.equal(phoneticMuffle('walked', 0.7, script({ doubles: [0.999, 0, 0.999, 0.999] })), 'walmed');
  assert.equal(phoneticMuffle('waiting', 0.7, script({ doubles: [0.999, 0.999, 0, 0.999, 0.999] })), 'waining');
  assert.equal(phoneticMuffle('candle', 0.7, script({ doubles: [0.999, 0, 0.999, 0.999, 0.999] })), 'cannle');
  assert.equal(phoneticMuffle('offer', 0.7, script({ doubles: [0.999, 0, 0.999, 0.999] })), 'ofer');
  assert.equal(phoneticMuffle('banana', 0.7, script({})), 'banana');
  assert.equal(phoneticMuffle('paradox', 0.5, script({ doubles: [0.999, 0.999, 0.999, 0.999, 0, 0] })), '...radox');
});

test('muffled lines stay within the message limit at every clarity', () => {
  const text = 'the shy thrush sits ' .repeat(13).slice(0, MAX_CHAT_LENGTH);
  assert.equal(text.length, MAX_CHAT_LENGTH);
  let longer = 0;
  for (let clarity = 0.15; clarity < 0.85; clarity += 0.01) {
    for (let seed = 0; seed < 20; seed++) {
      const heard = muffle(text, clarity, seed);
      assert.ok(heard.text.length <= MAX_CHAT_LENGTH, `${clarity} ${seed}`);
      if (heard.text.endsWith('...')) longer++;
    }
  }
  assert.ok(longer > 0);
  assert.equal(capChat('short'), 'short');
  const words = capChat(`${'abcd '.repeat(60)}`);
  assert.equal(words.length, 252);
  assert.ok(words.endsWith('abcd...'));
  assert.equal(capChat('x'.repeat(300)), `${'x'.repeat(253)}...`);
});

test('relayed lines and notices are checked again on the page', () => {
  const line = { type: 'chat', seq: 3, channel: 'rp', from: 'ab12', name: 'Ash', text: 'hi', clarity: 0.5, muffled: false };
  assert.deepEqual(readChat(line), { seq: 3, channel: 'rp', from: 'ab12', name: 'Ash', tag: null, text: 'hi', clarity: 0.5, muffled: false });
  assert.equal(readChat({ ...line, tag: 2 }).tag, 2, 'a second Ash is tagged');
  for (const tag of [1, 100, 2.5, '2', -3]) assert.equal(readChat({ ...line, tag }).tag, null, `tag ${tag}`);
  assert.equal(readChat({ ...line, clarity: 7, muffled: 'yes' }).clarity, 1);
  assert.equal(readChat({ ...line, clarity: -1 }).clarity, 0);
  assert.equal(readChat({ ...line, clarity: Number.NaN }).clarity, 1);
  assert.equal(readChat({ ...line, muffled: 'yes' }).muffled, false);
  assert.equal(readChat({ ...line, muffled: true }).muffled, true);
  assert.equal(readChat({ ...line, name: `${u(0x202e)}${'N'.repeat(40)}` }).name, 'N'.repeat(24));
  assert.equal(readChat({ ...line, text: `a${u(0x202e)}b` }).text, 'ab');
  for (const bad of [null, 'chat', [], { ...line, type: 'snapshot' }, { ...line, seq: -1 }, { ...line, seq: 1.5 },
    { ...line, channel: 'admin' }, { ...line, channel: '__proto__' }, { ...line, channel: 'constructor' },
    { ...line, from: 'XYZ' }, { ...line, from: 'a'.repeat(33) }, { ...line, text: 5 }, { ...line, text: '  ' },
    { ...line, text: 'x'.repeat(257) }]) {
    assert.equal(readChat(bad), null, JSON.stringify(bad));
  }
  assert.deepEqual(readChatNotice({ type: 'chat-notice', code: 'rate' }), { code: 'rate' });
  assert.deepEqual(readChatNotice({ type: 'chat-notice', code: 'toggled', channel: 'ooc', hidden: true }),
    { code: 'toggled', channel: 'ooc', hidden: true });
  assert.deepEqual(readChatNotice({ type: 'chat-notice', code: 'toggled', channel: 'looc', hidden: 1 }),
    { code: 'toggled', channel: 'looc', hidden: false });
  for (const bad of [null, { type: 'chat', code: 'rate' }, { type: 'chat-notice', code: 'hacked' },
    { type: 'chat-notice', code: 'toggled', channel: 'rp' }, { type: 'chat-notice', code: 'toggled', channel: 'nope' }]) {
    assert.equal(readChatNotice(bad), null);
  }
});

test('every notice and local error reads as the game says it', () => {
  assert.equal(noticeText('unheard'), 'No one can hear you in this channel.');
  assert.equal(noticeText('rate'), 'You are sending messages too fast.');
  assert.equal(noticeText('too-long'), 'Message too long (256 characters at most).');
  assert.equal(noticeText('hidden'), 'Channel is toggled off. Toggle it back on.');
  assert.equal(noticeText('toggled', { channel: 'ooc', hidden: true }), 'Toggled ooc visibility OFF.');
  assert.equal(noticeText('toggled', { channel: 'ooc', hidden: false }), 'Toggled ooc visibility ON.');
  assert.equal(noticeText('usage', { label: 'shout' }), 'Usage: /shout <message>');
  assert.equal(noticeText('syntax', { label: 'channel' }), 'Bad syntax. Try /channel <channel>.');
  assert.equal(noticeText('not-switchable'),
    'You cannot target that channel. Allowed channels: rp, ooc, looc, whisper, shout, yell, action.');
  assert.equal(noticeText('not-toggleable'), 'You cannot target that channel. Allowed channels: ooc, looc.');
  assert.equal(noticeText('already'), 'You are already using that channel.');
  assert.equal(noticeText('switched', { channel: 'yell' }), 'Switched to yell.');
  assert.equal(noticeText('show-channel', { channel: 'rp' }), 'Your default chat channel is rp.');
  assert.equal(noticeText('unknown'), 'Unknown command. Type /help for a list.');
  assert.equal(noticeText('offline'), 'Not connected. Your message was not sent.');
  assert.equal(noticeText('invalid'), 'That channel cannot be used.');
  assert.equal(HELP_LINES[0], 'Chat commands:');
  assert.ok(HELP_LINES.includes('/rp <message> - Say (15 m)'));
  assert.ok(HELP_LINES.includes('/ooc <message> - OOC (whole lobby)'));
  assert.ok(HELP_LINES.includes('/yell, /y <message> - Yell (48 m)'));
});
