import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Player } from '../src/entities/player.js';
import { cleanCode, cleanName, cleanSeed, cleanTag, displayName, lobbyServerUrl, playerState, readMembers,
  readPlayerState, validCode } from '../src/multiplayer/protocol.js';
import { blendState, RemotePlayers } from '../src/multiplayer/remote-players.js';

test('player snapshots preserve poses without sharing mutable arrays or private fields', () => {
  const player = new Player(12, -4);
  player.heading = 50;
  player.combat.pose.off = 0.75;
  const state = playerState(player);
  assert.ok(Math.abs(state.heading) <= Math.PI);
  assert.deepEqual(readPlayerState(state), state);
  player.combat.pose.hand[0] = 8;
  assert.notEqual(state.combat.pose.hand[0], 8);
  state.id = 'someone-else';
  state.token = 'private';
  state.combat.move = 'unknown';
  const cleaned = readPlayerState(state);
  assert.equal(cleaned.id, undefined);
  assert.equal(cleaned.token, undefined);
  assert.equal(cleaned.combat.move, undefined);
});

test('invalid numbers and poses are rejected and allowed values are bounded', () => {
  const state = playerState(new Player(0, 0));
  for (const value of [NaN, Infinity, '12', null]) {
    assert.equal(readPlayerState({ ...state, x: value }), null);
  }
  assert.equal(readPlayerState({ ...state, combat: { ...state.combat, pose: { ...state.combat.pose, hand: [0, 1] } } }), null);
  assert.equal(readPlayerState({ ...state, combat: { ...state.combat, inHand: 1 } }), null);
  assert.equal(readPlayerState({ ...state, air: 9000 }).air, 4);
  assert.equal(readPlayerState({ ...state, x: -1e12 }).x, -1000000);
});

test('lobby codes, names and seeds normalize consistently', () => {
  assert.equal(cleanCode(' ab7k2d '), 'AB7K2D');
  assert.equal(validCode('ab7k2d'), true);
  for (const code of ['', 'ABC', 'ABC DEF', 'ABC1234', undefined]) assert.equal(validCode(code), false);
  assert.equal(cleanName('  Kael\n\x00  '), 'Kael');
  assert.equal(cleanName(''), 'Wanderer');
  assert.equal(cleanName('a'.repeat(100)).length, 24);
  assert.equal(cleanSeed(0), 0);
  assert.equal(cleanSeed(-12), -12);
  assert.equal(cleanSeed(Infinity), 1);
  assert.equal(cleanSeed(1.5), 1);
});

test('non-string names use the default without coercing untrusted values', () => {
  for (const name of [null, undefined, 42, true, {}, [], ['Kael'], { toString: null },
    [{ toString: null }], { toString() { throw new Error('Must not coerce names'); } }]) {
    assert.equal(cleanName(name), 'Wanderer');
  }
});

test('server URLs support same-origin and separately hosted lobbies', () => {
  assert.equal(lobbyServerUrl('', 'http://localhost:8000/?seed=42'), 'ws://localhost:8000/multiplayer');
  assert.equal(lobbyServerUrl('', 'https://example.com/ascii-realm/'), 'wss://example.com/multiplayer');
  assert.equal(lobbyServerUrl('https://lobby.example.com', 'https://example.com'), 'wss://lobby.example.com/multiplayer');
  assert.equal(lobbyServerUrl('wss://example.com/game/multiplayer'), 'wss://example.com/game/multiplayer');
  assert.throws(() => lobbyServerUrl('file:///tmp/server'), /address/);
  assert.throws(() => lobbyServerUrl('ws://user:secret@example.com'), /address/);
  assert.throws(() => lobbyServerUrl('http://example.com', 'https://example.com'), /HTTPS/);
});

test('remote interpolation follows the short path across the heading wrap', () => {
  const a = playerState(new Player(0, 0));
  const b = structuredClone(a);
  a.heading = Math.PI - 0.1;
  b.heading = -Math.PI + 0.1;
  b.x = 20;
  b.air = 0.8;
  b.combat.inHand = true;
  const halfway = blendState(a, b, 0.5);
  assert.equal(halfway.x, 10);
  assert.equal(halfway.air, 0.4);
  assert.ok(Math.abs(halfway.heading - Math.PI) < 1e-8);
  assert.ok(Math.abs(Math.hypot(...halfway.combat.pose.blade) - 1) < 1e-8);
});

test('remote players interpolate, exclude self, and disappear on leave', () => {
  const remotes = new RemotePlayers();
  const state = playerState(new Player(0, 0));
  const members = [{ id: 'self', name: 'Kael', color: 0, state }, { id: 'friend', name: 'Rowan', color: 1, state }];
  remotes.sync(members, 'self', 1000);
  remotes.sync([{ ...members[1], state: { ...state, x: 20 } }], 'self', 1100);
  remotes.update(0.016, 1150);
  assert.equal(remotes.peers.size, 1);
  assert.equal(remotes.peers.get('friend').player.x, 10);
  assert.ok(remotes.peers.get('friend').player.cape.pts);
  remotes.sync([], 'self', 1200);
  assert.equal(remotes.peers.size, 0);
});

test('stale remote sword trails expire instead of growing while a tab is paused', () => {
  const remotes = new RemotePlayers();
  const state = playerState(new Player(0, 0));
  state.combat.trailing = true;
  state.combat.inHand = true;
  state.combat.active = 1;
  remotes.sync([{ id: 'friend', name: 'Rowan', color: 1, state }], 'self', 1000);
  remotes.update(0.016, 1100);
  assert.ok(remotes.peers.get('friend').player.trail.length > 0);
  remotes.update(0.1, 1400);
  assert.equal(remotes.peers.get('friend').player.trail.length, 0);
});

test('friends carry their name colour and tag, and only those near the view are drawn', () => {
  const remotes = new RemotePlayers();
  const near = playerState(new Player(10, 10));
  const far = playerState(new Player(500, 10));
  remotes.sync([{ id: 'a', name: 'Ash', tag: 2, color: 1, tint: '#ff5555', state: near },
    { id: 'b', name: 'Bryn', tag: null, color: 2, tint: null, state: far }], 'self', 1000);
  const ash = remotes.peers.get('a');
  assert.deepEqual([ash.name, ash.tag, ash.color, ash.tint], ['Ash', 2, 1, '#ff5555']);
  assert.equal(displayName(ash), 'Ash (2)');
  assert.deepEqual(remotes.visible({ x0: 0, y0: 0, cols: 80, rows: 60 }), [ash]);
  remotes.sync([{ id: 'a', name: 'Ash', tag: 2, color: 1, tint: null, state: near }], 'self', 1100);
  assert.equal(ash.tint, null, 'a cleared colour follows');
});

test('tags and member colours are cleaned', () => {
  for (const tag of [2, 10, 99]) assert.equal(cleanTag(tag), tag);
  for (const tag of [0, 1, 100, 2.5, '2', null, undefined, NaN]) assert.equal(cleanTag(tag), null);
  assert.equal(displayName({ name: 'Ash', tag: null }), 'Ash');
  assert.equal(displayName({ name: 'Ash', tag: 12 }), 'Ash (12)');
  const state = playerState(new Player(0, 0));
  const [member] = readMembers([{ id: 'ab', name: 'Ash', color: 1, tint: '#0000AA', tag: 3, state }]);
  assert.deepEqual([member.tint, member.tag], ['#4a89ff', 3]);
});
