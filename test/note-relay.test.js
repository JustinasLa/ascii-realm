import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNoteRelay } from '../server/notes.js';

// A relay with a settable clock, recording what it sends to whom, and two
// lobbies: three connected players and a held place in one, a stranger in
// the other.
function lobby() {
  let time = 0;
  const sent = [];
  const relay = createNoteRelay({ send: (socket, message) => sent.push([socket, message]), now: () => time });
  const member = (id) => ({ id, socket: { id: `socket-${id}` } });
  const [ash, bryn, cole] = ['a1', 'b2', 'c3'].map(member);
  const held = { id: 'd4', socket: null };
  const room = { players: new Map([ash, bryn, cole, held].map((p) => [p.id, p])) };
  const stranger = member('e5');
  const other = { players: new Map([[stranger.id, stranger]]) };
  return { relay, sent, ash, bryn, cole, room, other, stranger,
    at: (ms) => { time = ms; },
    play: (player, note = LUTE_C, room0 = room, extra = {}) => relay.handle({ player, room: room0 }, { type: 'note', note, ...extra }) };
}

const LUTE_C = { instrument: 'lute', degree: 0, octave: 0, chord: false };

test('a note reaches the other connected members once each, from the performer, never echoed', () => {
  const { sent, ash, bryn, cole, play, stranger } = lobby();
  const note = { ...LUTE_C, chord: true };
  play(ash, note, undefined, { from: 'b2', id: 'x' });
  assert.deepEqual(sent.map(([socket]) => socket), [bryn.socket, cole.socket]);
  for (const [, message] of sent) {
    assert.deepEqual(message, { type: 'note', from: 'a1', note });
    assert.notEqual(message.note, note, 'a fresh note, not what the page sent');
  }
  assert.ok(!sent.some(([socket]) => socket === ash.socket || socket === stranger.socket));
});

test('a session with no player, or a malformed note, relays nothing and spends no budget', () => {
  const { relay, sent, ash, room, play } = lobby();
  relay.handle({ player: null, room }, { type: 'note', note: LUTE_C });
  for (let i = 0; i < 20; i++) play(ash, { ...LUTE_C, degree: 9 });
  play(ash, 'x');
  relay.handle({ player: ash, room }, { type: 'note' });
  assert.equal(sent.length, 0);
  assert.equal(ash.notes, undefined, 'no budget is made for garbage');
  for (let i = 0; i < 20; i++) play(ash);
  assert.equal(sent.length, 40, 'all 20 valid notes in the same moment pass');
});

test('exactly 20 notes pass in any rolling second; the 21st is refused', () => {
  const { sent, ash, play, at } = lobby();
  const passed = () => sent.length / 2;
  for (let t = 0; t < 250; t += 10) { at(t); play(ash); }
  assert.equal(passed(), 20, '25 notes in a quarter second give 20');
  at(999);
  play(ash);
  assert.equal(passed(), 20, 'still within the second of the first');
  at(1000);
  play(ash);
  assert.equal(passed(), 21, 'the first slot frees after a full second');
  at(1005);
  play(ash);
  assert.equal(passed(), 21);
  at(1010);
  play(ash);
  assert.equal(passed(), 22);
});

test('the budget survives a reconnect, and each player has their own', () => {
  const { sent, ash, bryn, room, play, at } = lobby();
  for (let i = 0; i < 20; i++) play(ash);
  // The same player record resumed on a new socket, within the second.
  ash.socket = { id: 'socket-a1-again' };
  at(500);
  play(ash);
  assert.equal(sent.filter(([, m]) => m.from === 'a1').length, 40);
  play(bryn);
  assert.equal(sent.filter(([, m]) => m.from === 'b2').length, 2, 'another player is untouched');
  // Leaving and joining again makes a new player record, with a new budget.
  const fresh = { id: 'f6', socket: { id: 'socket-f6' } };
  room.players.set(fresh.id, fresh);
  play(fresh);
  assert.equal(sent.filter(([, m]) => m.from === 'f6').length, 3);
});

test('a lobby of one plays to no one', () => {
  const { sent, stranger, other, play } = lobby();
  play(stranger, LUTE_C, other);
  assert.equal(sent.length, 0);
  assert.ok(stranger.notes, 'the note still counts against the budget');
});
