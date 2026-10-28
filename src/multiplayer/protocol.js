import { isInstrumentNote } from '../audio/instruments.js';
import { readForged } from '../crafting/forged.js';
import { isMaterialId } from '../entities/weapons.js';
import { nameError, normalName, textLength } from '../character/rules.js';
import { EQUIPMENT_SLOTS, ITEMS } from '../inventory/items.js';
import { parseTint } from './tint.js';

export { PLAYER_COLORS } from './tint.js';
export const PROTOCOL_VERSION = 5;
export const MAX_PLAYERS = 8;
export const UPDATE_MS = 50;
// A player plays at most NOTES_PER_SECOND notes in any rolling window of
// NOTE_WINDOW_MS. The server allows NOTE_SLACK more at once, so network
// jitter bunching a steady performer's notes doesn't cost any.
export const NOTES_PER_SECOND = 20;
export const NOTE_WINDOW_MS = 1000;
export const NOTE_SLACK = 3;

// Only these fields cross the network. Cape physics and blade trails are local.
export const STATE_RANGES = {
  x: [-1000000, 1000000], y: [-1000000, 1000000],
  heading: [-Math.PI, Math.PI], phase: [-1e9, 1e9], time: [0, 1e9],
  walk: [0, 1], run: [0, 1], air: [0, 4], crouch: [0, 1], reach: [-1, 1],
  kneel: [0, 1], bank: [-1, 1], lean: [-1, 1], speed: [0, 20],
  look: [-2, 2], nod: [-1, 1], blink: [0, 1],
  // Shown in friends' party frames.
  health: [0, 1000], stamina: [0, 1000],
};

// What a player wears and holds, so friends see their gear and weapon: per
// slot an item that belongs there, a weapon's material and a forged weapon's
// look (its metal's name and colour, never its stats).
export function readEquipment(raw) {
  const equipment = Object.fromEntries(EQUIPMENT_SLOTS.map((slot) => [slot, null]));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return equipment;
  for (const slot of EQUIPMENT_SLOTS) {
    const stack = raw[slot];
    const id = stack?.id;
    if (typeof id !== 'string' || !Object.hasOwn(ITEMS, id) || ITEMS[id].equipmentSlot !== slot) continue;
    const forged = readForged(stack.forged, { look: true });
    equipment[slot] = { id, count: 1, ...(isMaterialId(stack.material) ? { material: stack.material } : {}), ...(forged ? { forged } : {}) };
  }
  return equipment;
}

// A played note as it crosses the network: a known instrument, degree 0-7,
// octave -1, 0 or 1 and a boolean chord, every field present and nothing
// else. Any instrument may sound a chord. The result is always a new object.
export function readNote(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (Object.keys(raw).length !== 4 || !Number.isInteger(raw.octave) || typeof raw.chord !== 'boolean') return null;
  if (!isInstrumentNote(raw)) return null;
  return { instrument: raw.instrument, degree: raw.degree, octave: raw.octave, chord: raw.chord };
}

// At most `count` events in any rolling window: a ring of the last accepted
// times, each slot reusable once its time is a full window old. A refused
// event takes no slot.
export class RollingLimit {
  constructor(count = NOTES_PER_SECOND, windowMs = NOTE_WINDOW_MS) {
    this.windowMs = windowMs;
    this.times = new Array(count).fill(-Infinity);
    this.next = 0;
  }

  allow(now) {
    // Written so a NaN clock refuses.
    if (!(now - this.times[this.next] >= this.windowMs)) return false;
    this.times[this.next] = now;
    this.next = (this.next + 1) % this.times.length;
    return true;
  }
}

// A sustained `perSecond` events with room for `burst` at once. Each accepted
// event books the next 1/perSecond of a second, from now or from the end of
// what is already booked, and is refused if that would book more than
// `burst` of them ahead of now. A refused event books nothing.
export class RateBudget {
  constructor(burst = NOTES_PER_SECOND + NOTE_SLACK, perSecond = NOTES_PER_SECOND) {
    this.interval = 1000 / perSecond;
    this.ahead = burst * this.interval;
    this.booked = -Infinity;
  }

  allow(now) {
    const booked = Math.max(this.booked, now) + this.interval;
    // Written so a NaN clock refuses.
    if (!(booked - now <= this.ahead)) return false;
    this.booked = booked;
    return true;
  }
}

const POSE_RANGES = { twist: [-4, 4], lean: [-2, 2], crouch: [0, 2], off: [0, 1] };
const finite = (value, [min, max]) => typeof value === 'number' && Number.isFinite(value)
  ? Math.max(min, Math.min(max, value)) : null;

// Longer input is refused before any work on it.
const MAX_NAME_UNITS = 96;
const UNSAFE = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;

// A name as a player joins with it: the character sheet's rule, 3 to 24
// letters in any alphabet, after control characters are dropped. Anything
// else joins as Wanderer.
export function cleanName(value) {
  if (typeof value !== 'string' || value.length > MAX_NAME_UNITS) return 'Wanderer';
  const name = normalName(value.replace(UNSAFE, ''));
  return nameError(name) ? 'Wanderer' : name;
}

// A name as the server sent it, kept as it is when it is safe to show: no
// control or format characters and 1 to 24 letters. The join rule isn't
// applied again, so the tags the server gave stay right.
export function readName(value) {
  if (typeof value !== 'string' || value.length > MAX_NAME_UNITS || value.match(UNSAFE)) return 'Wanderer';
  const length = textLength(value);
  return length >= 1 && length <= 24 ? value : 'Wanderer';
}

// The server numbers players who share a name, by join order: Ash, Ash (2),
// Ash (3). A tag is 2-99, or null for none.
export function cleanTag(value) {
  return Number.isInteger(value) && value >= 2 && value <= 99 ? value : null;
}

// A member's name as every list, frame, nameplate and chat line shows it.
export function displayName(member) {
  return member.tag ? `${member.name} (${member.tag})` : member.name;
}

export function cleanCode(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

export function validCode(value) {
  return /^[A-Z0-9]{6}$/.test(cleanCode(value));
}

export function cleanSeed(value) {
  return Number.isSafeInteger(value) && value >= -2147483648 && value <= 2147483647 ? value : 1;
}

export function readPlayerState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const state = {};
  for (const [key, range] of Object.entries(STATE_RANGES)) {
    const value = finite(raw[key], range);
    if (value === null) return null;
    state[key] = value;
  }
  const combat = raw.combat;
  if (!combat || typeof combat.inHand !== 'boolean' || typeof combat.trailing !== 'boolean') return null;
  const active = finite(combat.active, [0, 1]);
  if (active === null || !combat.pose) return null;
  const pose = {};
  for (const key of ['hand', 'blade']) {
    const vector = combat.pose[key];
    if (!Array.isArray(vector) || vector.length !== 3) return null;
    pose[key] = vector.map((v) => finite(v, [-4, 4]));
    if (pose[key].includes(null)) return null;
  }
  for (const [key, range] of Object.entries(POSE_RANGES)) {
    const value = finite(combat.pose[key], range);
    if (value === null) return null;
    pose[key] = value;
  }
  state.combat = { inHand: combat.inHand, trailing: combat.trailing, active, pose };
  state.equipment = readEquipment(raw.equipment);
  return state;
}

// Lobby members as the server reports them, keeping only well-formed ones:
// a hex id, a clean short name and tag, a palette colour, a readable name
// colour and a valid state. A malicious server cannot make the page loop
// over a huge name, crash on a missing colour or show an unreadable one.
export function readMembers(raw) {
  if (!Array.isArray(raw)) return [];
  const members = [];
  for (const member of raw.slice(0, MAX_PLAYERS)) {
    if (!member || typeof member !== 'object' || typeof member.id !== 'string' || !/^[0-9a-f]{1,32}$/.test(member.id)) continue;
    const state = readPlayerState(member.state);
    if (!state) continue;
    const color = Number.isInteger(member.color) && member.color >= 0 && member.color < MAX_PLAYERS ? member.color : 0;
    members.push({ id: member.id, name: readName(member.name),
      tag: cleanTag(member.tag), color, tint: parseTint(member.tint), state });
  }
  return members;
}

export function playerState(player) {
  const state = {};
  for (const key of Object.keys(STATE_RANGES)) state[key] = player[key];
  state.health = player.vitals?.health ?? 100;
  state.stamina = player.vitals?.stamina ?? 100;
  state.heading = Math.atan2(Math.sin(player.heading), Math.cos(player.heading));
  state.equipment = readEquipment(player.equipment);
  const c = player.combat;
  state.combat = { inHand: c.inHand, trailing: c.trailing, active: c.active,
    pose: { ...c.pose, hand: [...c.pose.hand], blade: [...c.pose.blade] } };
  return state;
}

export function lobbyServerUrl(input = '', base = globalThis.location?.href) {
  const url = input.trim() ? new URL(input.trim()) : new URL('/multiplayer', base);
  if (url.protocol === 'http:') url.protocol = 'ws:';
  else if (url.protocol === 'https:') url.protocol = 'wss:';
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Enter an HTTP, HTTPS, WS or WSS lobby server address.');
  }
  if (base && new URL(base).protocol === 'https:' && url.protocol !== 'wss:') {
    throw new Error('Use an HTTPS or WSS lobby server with this page.');
  }
  if (url.pathname === '/') url.pathname = '/multiplayer';
  url.hash = '';
  return url.href;
}
