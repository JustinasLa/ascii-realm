export const PROTOCOL_VERSION = 1;
export const MAX_PLAYERS = 8;
export const UPDATE_MS = 50;
export const PLAYER_COLORS = [
  [169, 212, 174], [146, 198, 235], [224, 176, 229], [239, 207, 151],
  [237, 162, 155], [149, 220, 208], [183, 180, 237], [224, 222, 174],
];

// Only these fields cross the network. Cape physics and blade trails are local.
export const STATE_RANGES = {
  x: [-1000000, 1000000], y: [-1000000, 1000000],
  heading: [-Math.PI, Math.PI], phase: [-1e9, 1e9], time: [0, 1e9],
  walk: [0, 1], run: [0, 1], air: [0, 4], crouch: [0, 1], reach: [-1, 1],
  kneel: [0, 1], bank: [-1, 1], lean: [-1, 1], speed: [0, 20],
  look: [-2, 2], nod: [-1, 1], blink: [0, 1],
};

const POSE_RANGES = { twist: [-4, 4], lean: [-2, 2], crouch: [0, 2], off: [0, 1] };
const finite = (value, [min, max]) => typeof value === 'number' && Number.isFinite(value)
  ? Math.max(min, Math.min(max, value)) : null;

export function cleanName(value) {
  return String(value ?? '').replace(/[^\x20-\x7e]/g, '').trim().slice(0, 24) || 'Wanderer';
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
  return state;
}

export function playerState(player) {
  const state = {};
  for (const key of Object.keys(STATE_RANGES)) state[key] = player[key];
  state.heading = Math.atan2(Math.sin(player.heading), Math.cos(player.heading));
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
