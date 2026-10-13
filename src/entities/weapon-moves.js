// Poses use the torso frame: metres from the hips, y up, z forward,
// with x pointing towards the weapon hand. All weapons share Combat's
// step runner; this file contains their poses and move timing only.
const BASE_KEYS = {
  rest: { hand: [0.26, 0.05, 0.05], blade: [0.1, -0.4, 0.9] },
  hilt: { hand: [0.17, 0.66, -0.16], blade: [-0.32, -0.95, -0.02], twist: 0.2 },
  free: { hand: [0.36, 0.86, 0.12], blade: [0.3, 0.4, -0.86], twist: 0.1 },
  guard: { hand: [0.12, 0.24, 0.3], blade: [-0.55, 0.5, 0.67], twist: 0.3, crouch: 0.14, off: 1 },
  carry: { hand: [0.27, 0.12, 0.1], blade: [0.15, -0.35, 0.92] },
  a0: { hand: [0.44, 0.62, -0.04], blade: [0.6, 0.45, -0.66], twist: 0.55, crouch: 0.1 },
  a1: { hand: [0.16, 0.45, 0.5], blade: [0.15, 0.08, 1], lean: 0.1, crouch: 0.15 },
  a2: { hand: [-0.28, 0.32, 0.32], blade: [-0.88, -0.08, 0.45], twist: -0.5, lean: 0.15, crouch: 0.2 },
  b1: { hand: [0.06, 0.42, 0.52], blade: [-0.05, 0.12, 1], lean: 0.1, crouch: 0.15 },
  b2: { hand: [0.46, 0.44, 0.14], blade: [0.92, 0.1, 0.3], twist: 0.5, lean: 0.1, crouch: 0.2 },
  c0: { hand: [0.1, 0.96, -0.02], blade: [0, 0.3, -0.95], twist: 0.1, lean: -0.12, off: 1 },
  c1: { hand: [0.08, 0.74, 0.4], blade: [0, 0.75, 0.62], lean: 0.1, off: 1 },
  c2: { hand: [0.05, 0.22, 0.52], blade: [0, -0.6, 0.8], lean: 0.38, crouch: 0.5, off: 1 },
};

const draw = [
  { key: 'hilt', time: 0.14, rate: 30 },
  { key: 'free', time: 0.12, rate: 26, grab: true },
  { key: 'guard', time: 0.14, rate: 20 },
];
const sheathe = [
  { key: 'free', time: 0.16, rate: 22 },
  { key: 'hilt', time: 0.16, rate: 26 },
  { key: 'rest', time: 0.2, rate: 14, release: true },
];

// A strike has preparation, contact, follow-through and a cancellable
// combo recovery. Impacts fire once, at the end of the contact step.
function strike(name, from, contact, end, options = {}) {
  const {
    type = 'slash', windup = 0.11, swing = 0.06, follow = 0.08,
    recovery = 0.23, combo = true, forward = 0, turn = 0,
    plunge = false, projectile, count = 1,
    damage = 1, reach = 1, stamina = 1,
  } = options;
  return {
    name, damage, reach, stamina, kind: projectile ? 'ranged' : 'melee',
    steps: [
      { key: from, time: windup, rate: 32 },
      { key: contact, time: swing, rate: 60, trail: !projectile, forward, turn },
      {
        key: end, time: follow, rate: 50, trail: !projectile, forward, turn,
        waitForGround: plunge, event: { type, projectile, count },
      },
      { key: end, time: recovery, rate: 18, combo },
    ],
  };
}

function moveset(keys, combo, attacks, specials, chargeKey, chargeDuration = 1) {
  const moves = Object.fromEntries(attacks.map((move) => [move.name, move]));
  for (const move of specials) moves[move.name] = move;
  moves.draw = { name: 'draw', steps: draw, kind: 'utility' };
  moves.sheathe = { name: 'sheathe', steps: sheathe, kind: 'utility' };
  moves.charge = { name: 'charge', steps: [{ key: chargeKey, time: Infinity, rate: 18 }], kind: 'utility' };
  return {
    keys: { ...BASE_KEYS, ...keys }, moves, combo, comboNames: [...combo],
    sprint: specials[0].name, air: specials[1].name, charged: specials[2].name,
    chargeDuration,
  };
}

const greatsword = moveset({}, ['cleave', 'return-cut', 'overhead'], [
  strike('cleave', 'a0', 'a1', 'a2'),
  strike('return-cut', 'a2', 'b1', 'b2', { windup: 0, swing: 0.06 }),
  strike('overhead', 'c0', 'c1', 'c2', { type: 'slam', windup: 0.18, follow: 0.07, recovery: 0.34, combo: false, damage: 1.35, stamina: 1.2 }),
], [
  strike('running-cleave', 'a0', 'a1', 'a2', { forward: 1.3, damage: 1.25, stamina: 1.25 }),
  strike('plunge', 'c0', 'c1', 'c2', { type: 'slam', plunge: true, damage: 1.55, stamina: 1.4, recovery: 0.32 }),
  strike('charged-cleave', 'c0', 'a1', 'a2', { windup: 0.15, damage: 1.55, reach: 1.15, stamina: 1.65, recovery: 0.32 }),
], 'c0', 1.1);
// Keep the original public greatsword move names for saved/debug poses.
for (const [old, name] of [['a', 'cleave'], ['b', 'return-cut'], ['c', 'overhead']]) {
  greatsword.moves[old] = greatsword.moves[name];
}
greatsword.combo = ['a', 'b', 'c'];

const swordShield = moveset({
  hilt: { hand: [0.27, 0.04, -0.06], blade: [0.1, -1, 0.1] },
  free: { hand: [0.42, 0.35, 0.08], blade: [0.15, 0.8, 0.55], twist: 0.3 },
  guard: { hand: [0.18, 0.31, 0.24], blade: [0.1, 0.8, 0.6], twist: 0.2, crouch: 0.08 },
  block: { hand: [0.14, 0.25, 0.18], blade: [-0.2, 0.88, 0.3], twist: 0.12, crouch: 0.22, shield: 1 },
  cut: { hand: [0.5, 0.46, 0.06], blade: [0.75, 0.25, -0.55], twist: 0.4 },
  cutEnd: { hand: [-0.15, 0.27, 0.45], blade: [-0.8, 0.1, 0.6], twist: -0.35 },
  thrust: { hand: [0.08, 0.35, 0.68], blade: [0, 0.06, 1], lean: 0.18 },
  bash: { hand: [0.32, 0.32, 0.14], blade: [0.3, 0.9, 0.1], lean: 0.24, crouch: 0.18, shield: 1 },
}, ['slash', 'riposte', 'shield-bash'], [
  strike('slash', 'cut', 'a1', 'cutEnd', { windup: 0.08, recovery: 0.17 }),
  strike('riposte', 'guard', 'thrust', 'thrust', { type: 'thrust', windup: 0.08, reach: 1.18, recovery: 0.18 }),
  strike('shield-bash', 'block', 'bash', 'bash', { type: 'bash', damage: 0.7, stamina: 0.9, recovery: 0.2 }),
], [
  strike('shield-rush', 'block', 'bash', 'bash', { type: 'bash', forward: 1.4, damage: 1.1, stamina: 1.3 }),
  strike('air-slash', 'c0', 'a1', 'cutEnd', { plunge: true, damage: 1.4, stamina: 1.3 }),
  strike('charged-thrust', 'guard', 'thrust', 'thrust', { type: 'thrust', damage: 1.65, reach: 1.25, stamina: 1.6, forward: 0.7 }),
], 'guard', 0.85);

const axe = moveset({
  guard: { hand: [0.2, 0.32, 0.2], blade: [0.12, 0.93, 0.32], twist: 0.24, off: 0.6 },
  high: { hand: [0.42, 0.8, -0.03], blade: [0.35, 0.78, -0.52], twist: 0.45, off: 0.8 },
  hew: { hand: [0.15, 0.3, 0.5], blade: [-0.25, -0.5, 0.85], lean: 0.28, off: 0.8 },
  cross: { hand: [-0.15, 0.38, 0.22], blade: [-0.92, 0.04, 0.4], twist: -0.45, off: 0.6 },
  split: { hand: [0.09, 0.15, 0.48], blade: [0, -0.8, 0.6], lean: 0.35, crouch: 0.32, off: 1 },
}, ['hew', 'cross-chop', 'splitter'], [
  strike('hew', 'high', 'a1', 'hew', { type: 'chop', windup: 0.14, damage: 1.05 }),
  strike('cross-chop', 'hew', 'b1', 'cross', { type: 'chop', windup: 0.06, damage: 1.1 }),
  strike('splitter', 'c0', 'c1', 'split', { type: 'chop', windup: 0.2, damage: 1.4, stamina: 1.25, recovery: 0.3 }),
], [
  strike('running-hew', 'high', 'a1', 'hew', { type: 'chop', forward: 1.1, damage: 1.3, stamina: 1.3 }),
  strike('axe-plunge', 'c0', 'c1', 'split', { type: 'chop', plunge: true, damage: 1.55, stamina: 1.4 }),
  strike('tree-feller', 'c0', 'c1', 'split', { type: 'chop', windup: 0.2, damage: 1.75, stamina: 1.7, recovery: 0.38 }),
], 'high', 1.1);

const hammer = moveset({
  guard: { hand: [0.13, 0.26, 0.21], blade: [0.1, 0.94, 0.3], crouch: 0.13, off: 1 },
  wind: { hand: [0.45, 0.5, -0.06], blade: [0.8, 0.36, -0.48], twist: 0.6, off: 1 },
  sweep: { hand: [-0.2, 0.26, 0.36], blade: [-0.93, -0.14, 0.32], twist: -0.55, lean: 0.2, off: 1 },
  return: { hand: [0.43, 0.32, 0.26], blade: [0.94, -0.06, 0.32], twist: 0.55, off: 1 },
  raised: { hand: [0.08, 0.94, -0.03], blade: [0, 0.4, -0.92], lean: -0.15, crouch: 0.15, off: 1 },
  slam: { hand: [0.06, 0.08, 0.48], blade: [0, -0.95, 0.3], lean: 0.42, crouch: 0.6, off: 1 },
}, ['hammer-sweep', 'hammer-return', 'ground-slam'], [
  strike('hammer-sweep', 'wind', 'a1', 'sweep', { type: 'bash', windup: 0.22, recovery: 0.3, damage: 1.1 }),
  strike('hammer-return', 'sweep', 'b1', 'return', { type: 'bash', windup: 0.1, recovery: 0.3, damage: 1.15 }),
  strike('ground-slam', 'raised', 'c1', 'slam', { type: 'slam', windup: 0.28, recovery: 0.4, damage: 1.5, stamina: 1.4 }),
], [
  strike('hammer-charge', 'wind', 'a1', 'sweep', { type: 'bash', forward: 0.85, windup: 0.18, damage: 1.35, stamina: 1.4 }),
  strike('meteor-slam', 'raised', 'c1', 'slam', { type: 'slam', plunge: true, windup: 0.2, damage: 1.8, stamina: 1.6, recovery: 0.4 }),
  strike('charged-slam', 'raised', 'c1', 'slam', { type: 'slam', windup: 0.22, damage: 1.85, stamina: 1.9, recovery: 0.45 }),
], 'raised', 1.25);

const thrownSpear = { kind: 'spear', speed: 9.5, gravity: 5 };
const spear = moveset({
  guard: { hand: [0.12, 0.32, 0.12], blade: [0.02, 0.12, 1], twist: 0.24, crouch: 0.1, off: 1 },
  coil: { hand: [0.24, 0.36, -0.18], blade: [0.08, 0.1, 1], twist: 0.5, off: 1 },
  jab: { hand: [0.02, 0.3, 0.6], blade: [0, 0.1, 1], lean: 0.12, off: 1 },
  lunge: { hand: [-0.03, 0.3, 0.78], blade: [0, 0.04, 1], lean: 0.28, crouch: 0.2, off: 1 },
  sweep: { hand: [0.34, 0.32, 0.22], blade: [0.96, 0.04, 0.25], twist: 0.7, off: 1 },
  throwReady: { hand: [0.32, 0.82, -0.15], blade: [0, -0.05, 1], twist: 0.6, lean: -0.08, off: 0.35 },
  throwContact: { hand: [0.06, 0.75, 0.54], blade: [0, 0.06, 1], twist: -0.15, lean: 0.24, off: 0 },
  throwEnd: { hand: [-0.02, 0.54, 0.72], blade: [-0.08, -0.12, 0.99], twist: -0.38, lean: 0.32, crouch: 0.18, off: 0 },
}, ['jab', 'long-thrust', 'spear-sweep'], [
  strike('jab', 'coil', 'jab', 'jab', { type: 'thrust', windup: 0.1, recovery: 0.16 }),
  strike('long-thrust', 'coil', 'jab', 'lunge', { type: 'thrust', reach: 1.2, damage: 1.15, recovery: 0.22 }),
  strike('spear-sweep', 'a0', 'a1', 'sweep', { damage: 1.2, recovery: 0.24 }),
], [
  strike('spear-charge', 'coil', 'jab', 'lunge', { type: 'thrust', forward: 1.8, reach: 1.25, damage: 1.4, stamina: 1.4 }),
  strike('spear-plunge', 'c0', 'c1', 'c2', { type: 'thrust', plunge: true, damage: 1.5, stamina: 1.3 }),
  strike('spear-throw', 'throwReady', 'throwContact', 'throwEnd', { type: 'projectile', projectile: thrownSpear, windup: 0.14, recovery: 0.3, damage: 1.6, stamina: 1.6 }),
], 'throwReady', 0.95);

const dagger = moveset({
  hilt: { hand: [0.25, 0.02, -0.08], blade: [0.1, -1, 0.05] },
  free: { hand: [0.35, 0.24, 0.07], blade: [0.3, 0.25, 0.92] },
  guard: { hand: [0.22, 0.22, 0.22], blade: [0.15, 0.2, 0.97], twist: 0.25, crouch: 0.17 },
  cut: { hand: [0.42, 0.35, 0.03], blade: [0.8, 0.1, 0.6], twist: 0.4 },
  reverse: { hand: [-0.12, 0.24, 0.4], blade: [-0.7, -0.1, 0.7], twist: -0.4, lean: 0.15 },
  stab: { hand: [0.02, 0.34, 0.67], blade: [0, 0.02, 1], lean: 0.28, crouch: 0.15 },
}, ['quick-cut', 'reverse-cut', 'backstab'], [
  strike('quick-cut', 'cut', 'a1', 'reverse', { windup: 0.05, swing: 0.04, follow: 0.04, recovery: 0.12, damage: 0.85, stamina: 0.85 }),
  strike('reverse-cut', 'reverse', 'b1', 'cut', { windup: 0.02, swing: 0.04, follow: 0.04, recovery: 0.12, stamina: 0.85 }),
  strike('backstab', 'guard', 'stab', 'stab', { type: 'thrust', windup: 0.06, swing: 0.04, follow: 0.04, recovery: 0.16, damage: 1.2 }),
], [
  strike('lunge', 'guard', 'stab', 'stab', { type: 'thrust', forward: 1.8, damage: 1.2, reach: 1.2, stamina: 1.25, windup: 0.06 }),
  strike('dagger-plunge', 'c0', 'stab', 'stab', { type: 'thrust', plunge: true, damage: 1.35, stamina: 1.25, windup: 0.06 }),
  strike('deep-stab', 'guard', 'stab', 'stab', { type: 'thrust', forward: 0.8, damage: 1.65, stamina: 1.5, windup: 0.08 }),
], 'guard', 0.7);

const arrow = { kind: 'arrow', speed: 18, gravity: 5 };
const bow = moveset({
  // Extend the bow arm near the torso's centre so the opposite hand can
  // pull the string back to the cheek instead of reaching across the bow.
  guard: { hand: [0.1, 0.4, 0.46], blade: [0, 1, 0], twist: 0.28, off: 0.2 },
  aim: { hand: [0.06, 0.45, 0.65], blade: [0, 1, 0], twist: 0.32, off: 1 },
  loose: { hand: [0.1, 0.44, 0.56], blade: [0, 1, 0], twist: 0.2, off: 0.1 },
  carry: { hand: [0.31, 0.15, 0.2], blade: [0.2, 0.94, 0.3] },
}, ['quick-shot', 'double-shot', 'power-shot'], [
  strike('quick-shot', 'aim', 'aim', 'loose', { type: 'projectile', projectile: arrow, windup: 0.06, swing: 0.04, follow: 0.04, recovery: 0.2, damage: 0.85 }),
  strike('double-shot', 'aim', 'aim', 'loose', { type: 'projectile', projectile: arrow, count: 2, windup: 0.1, damage: 0.65, stamina: 1.25 }),
  strike('power-shot', 'aim', 'aim', 'loose', { type: 'projectile', projectile: arrow, windup: 0.16, damage: 1.25, reach: 1.15, stamina: 1.25 }),
], [
  strike('running-shot', 'aim', 'aim', 'loose', { type: 'projectile', projectile: arrow, forward: 0.7, damage: 1.05, stamina: 1.2, windup: 0.04 }),
  strike('air-shot', 'aim', 'aim', 'loose', { type: 'projectile', projectile: arrow, damage: 1.2, stamina: 1.2, windup: 0.04 }),
  strike('draw-shot', 'aim', 'aim', 'loose', { type: 'projectile', projectile: arrow, damage: 1.45, reach: 1.2, stamina: 1.5, windup: 0.02, swing: 0.03, follow: 0.03 }),
], 'aim', 0.9);

const magic = { kind: 'magic', speed: 12, gravity: 0 };
const staff = moveset({
  guard: { hand: [0.15, 0.33, 0.2], blade: [0.18, 0.84, 0.51], twist: 0.3, off: 1 },
  jab: { hand: [0.03, 0.34, 0.6], blade: [0, 0.12, 1], lean: 0.16, off: 1 },
  spin: { hand: [-0.22, 0.43, 0.21], blade: [-0.95, 0.05, 0.3], twist: -0.8, off: 1 },
  raised: { hand: [0.1, 0.66, 0.27], blade: [0, 1, 0.1], lean: -0.08, off: 1 },
  burst: { hand: [0.05, 0.36, 0.56], blade: [0, 0.18, 1], lean: 0.18, off: 1 },
}, ['staff-jab', 'staff-sweep', 'arcane-burst'], [
  strike('staff-jab', 'guard', 'jab', 'jab', { type: 'thrust', recovery: 0.18 }),
  strike('staff-sweep', 'a0', 'a1', 'spin', { turn: Math.PI * 8, swing: 0.1, follow: 0.15, damage: 1.1 }),
  strike('arcane-burst', 'raised', 'burst', 'burst', { type: 'magic', projectile: magic, damage: 1.3, stamina: 1.3 }),
], [
  strike('vault-strike', 'raised', 'jab', 'jab', { type: 'thrust', forward: 1.5, damage: 1.3, stamina: 1.3 }),
  strike('staff-plunge', 'raised', 'c1', 'c2', { type: 'slam', plunge: true, damage: 1.4, stamina: 1.3 }),
  strike('charged-burst', 'raised', 'burst', 'burst', { type: 'magic', projectile: magic, damage: 1.65, reach: 1.4, stamina: 1.7 }),
], 'raised', 1);

const thrown = { kind: 'javelin', speed: 10, gravity: 5 };
const javelin = moveset({
  guard: { hand: [0.28, 0.42, 0.16], blade: [0, 0.1, 1], twist: 0.28 },
  jab: { hand: [0.04, 0.37, 0.67], blade: [0, 0.07, 1], lean: 0.18 },
  butt: { hand: [0.4, 0.34, 0.24], blade: [0.93, 0.02, 0.36], twist: 0.5 },
  ready: { hand: [0.35, 0.76, -0.13], blade: [0, -0.04, 1], twist: 0.55, lean: -0.1 },
  throw: { hand: [0.03, 0.64, 0.6], blade: [0, 0.08, 1], twist: -0.15, lean: 0.3 },
}, ['javelin-jab', 'butt-strike', 'throw'], [
  strike('javelin-jab', 'guard', 'jab', 'jab', { type: 'thrust', windup: 0.08, recovery: 0.18 }),
  strike('butt-strike', 'jab', 'a1', 'butt', { type: 'bash', damage: 0.9, recovery: 0.19 }),
  strike('throw', 'ready', 'throw', 'throw', { type: 'projectile', projectile: thrown, damage: 1.3, stamina: 1.3 }),
], [
  strike('running-throw', 'ready', 'throw', 'throw', { type: 'projectile', projectile: thrown, forward: 1, damage: 1.4, reach: 1.15, stamina: 1.4 }),
  strike('air-throw', 'ready', 'throw', 'throw', { type: 'projectile', projectile: thrown, damage: 1.4, reach: 1.15, stamina: 1.3 }),
  strike('charged-throw', 'ready', 'throw', 'throw', { type: 'projectile', projectile: thrown, damage: 1.65, reach: 1.3, stamina: 1.7 }),
], 'ready', 1);

export const WEAPON_MOVESETS = Object.freeze({
  greatsword,
  'sword-shield': swordShield,
  axe, hammer, spear, dagger, bow, staff, javelin,
});

export function getWeaponMoves(weapon = 'greatsword') {
  const id = typeof weapon === 'string' ? weapon : weapon?.id;
  return typeof id === 'string' && Object.hasOwn(WEAPON_MOVESETS, id)
    ? WEAPON_MOVESETS[id] : WEAPON_MOVESETS.greatsword;
}
