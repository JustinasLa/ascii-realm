// Weapon geometry is expressed in metres in the rig's weapon frame: x is
// across the blade, y runs from the guard towards the tip, z is its depth.
// These parts are projected and rasterised into ASCII by figure.js, just like
// armour, so each silhouette follows the hands at every heading.

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

const limb = (a, b, ra, rb, material, glyph) => ({ shape: 'limb', a, b, ra, rb, material, ...(glyph ? { glyph } : {}) });
const blob = (c, rx, ry, material, glyph) => ({ shape: 'blob', c, rx, ry, material, ...(glyph ? { glyph } : {}) });
const panel = (points, material, glyph) => ({ shape: 'panel', points, material, ...(glyph ? { glyph } : {}) });

// Steel is the baseline. Earlier tiers cost more effort and swing more
// slowly; upgrading improves damage without changing physical reach.
export const WEAPON_MATERIALS = freeze({
  stone: { id: 'stone', name: 'Stone', damage: 0.56, speed: 0.82, staminaCost: 1.2, weight: 1.3, color: [150, 153, 162] },
  copper: { id: 'copper', name: 'Copper', damage: 0.7, speed: 0.91, staminaCost: 1.12, weight: 1.1, color: [218, 139, 96] },
  bronze: { id: 'bronze', name: 'Bronze', damage: 0.8, speed: 0.95, staminaCost: 1.07, weight: 1.05, color: [199, 165, 99] },
  iron: { id: 'iron', name: 'Iron', damage: 0.91, speed: 0.98, staminaCost: 1.03, weight: 1.02, color: [167, 180, 195] },
  steel: { id: 'steel', name: 'Steel', damage: 1, speed: 1, staminaCost: 1, weight: 1, color: [206, 214, 228] },
});

export const MATERIAL_IDS = freeze(Object.keys(WEAPON_MATERIALS));

const back = (hand, blade, guard, tip, pommel) => ({ mount: 'back', hand, blade, guard, tip, pommel });
const hip = (hand, blade, guard, tip, pommel) => ({ mount: 'hip', hand, blade, guard, tip, pommel });

export const WEAPONS = freeze({
  greatsword: {
    id: 'greatsword', name: 'Greatsword', type: 'greatsword', category: 'blade',
    damage: 32, reach: 1.02, speed: 1, staminaCost: 18, weight: 3.8,
    hands: 2, handedness: 'two', trailColor: [176, 224, 255],
    combo: ['cleave', 'return-cut', 'overhead'],
    sprintAttack: 'running-cleave', airAttack: 'plunge', chargedAttack: 'charged-cleave',
    sheath: back([0.17, 0.66, -0.16], [-0.32, -0.95, -0.02], [0.15, 0.56, -0.2], [-0.2, -0.46, -0.21], [0.21, 0.72, -0.2]),
    rig: { gripLength: 0.2, gripOffset: 0.08, guardWidth: 0.12, offGrip: 0.13 },
    spriteDimensions: { bladeWidth: 0.034, tipWidth: 0.006, gripLength: 0.28, guardWidth: 0.12, shaftWidth: 0.024 },
    spriteParts: [
      limb([0, 0, 0], [0, 1.02, 0], 0.034, 0.006, 'blade'),
      limb([0, 0.051, 0.002], [0, 0.714, 0.002], 0.009, 0.006, 'darkPlate'),
      limb([-0.12, 0, 0], [0.12, 0, 0], 0.024, 0.024, 'trim'),
      limb([0, -0.28, 0], [0, 0, 0], 0.024, 0.024, 'leather'),
      blob([0, -0.28, 0], 0.036, 0.036, 'trim'),
    ],
  },
  'sword-shield': {
    id: 'sword-shield', name: 'Sword & shield', type: 'sword-shield', category: 'blade',
    damage: 24, reach: 0.7, speed: 1.18, staminaCost: 12, weight: 2.7,
    hands: 1, handedness: 'one', trailColor: [159, 213, 255],
    combo: ['slash', 'riposte', 'shield-bash'],
    sprintAttack: 'shield-rush', airAttack: 'air-slash', chargedAttack: 'charged-thrust',
    sheath: hip([0.25, 0.05, -0.1], [0.12, -0.99, 0], [0.25, 0.02, -0.12], [0.33, -0.67, -0.12], [0.23, 0.2, -0.12]),
    rig: { gripLength: 0.12, gripOffset: 0.05, guardWidth: 0.09, offGrip: 0 },
    spriteDimensions: { bladeWidth: 0.028, tipWidth: 0.005, gripLength: 0.17, guardWidth: 0.09, shaftWidth: 0.02 },
    spriteParts: [
      limb([0, 0, 0], [0, 0.7, 0], 0.028, 0.005, 'blade'),
      limb([-0.09, 0, 0], [0.09, 0, 0], 0.022, 0.022, 'trim'),
      limb([0, -0.17, 0], [0, 0, 0], 0.021, 0.021, 'leather'),
      blob([0, -0.17, 0], 0.03, 0.03, 'trim'),
    ],
    shieldParts: [
      panel([[-0.19, 0.19, 0], [0.19, 0.19, 0], [0.15, -0.14, 0], [-0.15, -0.14, 0]], 'darkPlate', '#'),
      panel([[-0.15, -0.14, 0], [0.15, -0.14, 0], [0.02, -0.29, 0], [-0.02, -0.29, 0]], 'darkPlate', '#'),
      limb([-0.19, 0.19, 0.008], [0.19, 0.19, 0.008], 0.02, 0.02, 'trim'),
      limb([-0.19, 0.19, 0.008], [-0.15, -0.14, 0.008], 0.018, 0.018, 'trim'),
      limb([0.19, 0.19, 0.008], [0.15, -0.14, 0.008], 0.018, 0.018, 'trim'),
      limb([-0.15, -0.14, 0.008], [0, -0.29, 0.008], 0.018, 0.018, 'trim'),
      limb([0.15, -0.14, 0.008], [0, -0.29, 0.008], 0.018, 0.018, 'trim'),
      blob([0, 0, 0.025], 0.05, 0.05, 'trim', '+'),
    ],
  },
  axe: {
    id: 'axe', name: 'Battle axe', type: 'axe', category: 'heavy',
    damage: 36, reach: 0.72, speed: 0.85, staminaCost: 20, weight: 3.3,
    hands: 2, handedness: 'two', trailColor: [255, 187, 119],
    combo: ['hew', 'cross-chop', 'splitter'],
    sprintAttack: 'running-hew', airAttack: 'axe-plunge', chargedAttack: 'tree-feller',
    sheath: back([0.18, 0.65, -0.2], [-0.18, -0.98, 0], [0.16, 0.55, -0.21], [0.03, -0.16, -0.21], [0.2, 0.78, -0.21]),
    rig: { gripLength: 0.18, gripOffset: 0.07, guardWidth: 0.08, offGrip: 0.13 },
    spriteDimensions: { bladeWidth: 0.028, tipWidth: 0.02, gripLength: 0.25, guardWidth: 0.08, shaftWidth: 0.028, headWidth: 0.25, headLength: 0.23 },
    spriteParts: [
      limb([0, -0.25, 0], [0, 0.72, 0], 0.028, 0.022, 'wood'),
      limb([0, -0.25, 0.002], [0, 0.12, 0.002], 0.03, 0.03, 'leather'),
      panel([[-0.06, 0.69, 0], [0.24, 0.72, 0], [0.25, 0.46, 0], [-0.05, 0.5, 0]], 'blade', '#'),
      limb([0.24, 0.72, 0.008], [0.25, 0.46, 0.008], 0.012, 0.016, 'blade'),
      blob([0, 0.58, 0.018], 0.045, 0.07, 'trim'),
    ],
  },
  hammer: {
    id: 'hammer', name: 'War hammer', type: 'hammer', category: 'heavy',
    damage: 44, reach: 0.68, speed: 0.65, staminaCost: 26, weight: 4.6,
    hands: 2, handedness: 'two', trailColor: [255, 211, 132],
    combo: ['hammer-sweep', 'hammer-return', 'ground-slam'],
    sprintAttack: 'hammer-charge', airAttack: 'meteor-slam', chargedAttack: 'charged-slam',
    sheath: back([0.17, 0.64, -0.2], [-0.18, -0.98, 0], [0.15, 0.53, -0.23], [0.03, -0.14, -0.23], [0.2, 0.78, -0.23]),
    rig: { gripLength: 0.2, gripOffset: 0.06, guardWidth: 0.06, offGrip: 0.16 },
    spriteDimensions: { bladeWidth: 0.03, tipWidth: 0.025, gripLength: 0.26, guardWidth: 0.06, shaftWidth: 0.03, headWidth: 0.22, headLength: 0.2 },
    spriteParts: [
      limb([0, -0.26, 0], [0, 0.65, 0], 0.031, 0.025, 'wood'),
      limb([0, -0.26, 0.004], [0, 0.08, 0.004], 0.033, 0.033, 'leather'),
      panel([[-0.2, 0.68, 0], [0.2, 0.68, 0], [0.2, 0.48, 0], [-0.2, 0.48, 0]], 'darkPlate', '#'),
      limb([-0.21, 0.49, 0.006], [-0.21, 0.67, 0.006], 0.04, 0.04, 'blade', '#'),
      limb([0.21, 0.49, 0.006], [0.21, 0.67, 0.006], 0.04, 0.04, 'blade', '#'),
      blob([0, -0.26, 0], 0.04, 0.04, 'trim'),
    ],
  },
  spear: {
    id: 'spear', name: 'Spear', type: 'spear', category: 'polearm',
    damage: 26, reach: 1.45, speed: 1.06, staminaCost: 13, weight: 2,
    hands: 2, handedness: 'two', trailColor: [174, 247, 204],
    combo: ['jab', 'long-thrust', 'spear-sweep'],
    sprintAttack: 'spear-charge', airAttack: 'spear-plunge', chargedAttack: 'piercing-thrust',
    sheath: back([0.18, 0.66, -0.22], [-0.1, -0.995, 0], [0.14, 0.55, -0.22], [-0.005, -0.89, -0.22], [0.17, 0.85, -0.22]),
    rig: { gripLength: 0.25, gripOffset: 0.05, guardWidth: 0.04, offGrip: 0.22 },
    spriteDimensions: { bladeWidth: 0.055, tipWidth: 0.005, gripLength: 0.3, guardWidth: 0.04, shaftWidth: 0.02 },
    spriteParts: [
      limb([0, -0.3, 0], [0, 1.23, 0], 0.021, 0.018, 'wood'),
      limb([0, -0.15, 0.002], [0, 0.14, 0.002], 0.024, 0.024, 'leather'),
      limb([0, 1.18, 0], [0, 1.27, 0], 0.027, 0.027, 'trim'),
      panel([[0, 1.45, 0], [0.065, 1.28, 0], [0, 1.2, 0], [-0.065, 1.28, 0]], 'blade'),
      limb([0, 1.2, 0.008], [0, 1.45, 0.008], 0.008, 0.003, 'blade'),
    ],
  },
  dagger: {
    id: 'dagger', name: 'Dagger', type: 'dagger', category: 'blade',
    damage: 14, reach: 0.36, speed: 1.55, staminaCost: 7, weight: 0.55,
    hands: 1, handedness: 'one', trailColor: [218, 183, 255],
    combo: ['quick-cut', 'reverse-cut', 'backstab'],
    sprintAttack: 'lunge', airAttack: 'dagger-plunge', chargedAttack: 'deep-stab',
    sheath: hip([0.24, 0.02, -0.08], [0.3, -0.95, 0], [0.25, -0.02, -0.1], [0.36, -0.36, -0.1], [0.21, 0.1, -0.1]),
    rig: { gripLength: 0.1, gripOffset: 0.03, guardWidth: 0.055, offGrip: 0 },
    spriteDimensions: { bladeWidth: 0.027, tipWidth: 0.004, gripLength: 0.13, guardWidth: 0.055, shaftWidth: 0.019 },
    spriteParts: [
      limb([0, 0, 0], [0, 0.36, 0], 0.027, 0.004, 'blade'),
      limb([-0.055, 0, 0], [0.055, 0, 0], 0.018, 0.018, 'trim'),
      limb([0, -0.13, 0], [0, 0, 0], 0.019, 0.019, 'leather'),
      blob([0, -0.13, 0], 0.025, 0.025, 'trim'),
    ],
  },
  bow: {
    id: 'bow', name: 'Bow', type: 'bow', category: 'ranged',
    damage: 22, reach: 0.65, speed: 1, staminaCost: 10, weight: 1.25,
    hands: 2, handedness: 'two', trailColor: [238, 208, 140],
    combo: ['quick-shot', 'double-shot', 'power-shot'],
    sprintAttack: 'running-shot', airAttack: 'air-shot', chargedAttack: 'draw-shot',
    projectile: 'arrow', projectileRange: 10,
    // The bow's hand sits one gripOffset behind its visible carried handle.
    sheath: { mount: 'quiver', hand: [0.041543768803, 0.129880120338, -0.23], blade: [-0.1, -0.64, 0], guard: [0.04, 0.12, -0.23], tip: [-0.06, -0.52, -0.23], pommel: [0.05, 0.19, -0.23] },
    quiver: { mount: [0.23, 0.44, -0.18], radius: 0.075, length: 0.55, arrowCount: 3 },
    rig: { gripLength: 0.06, gripOffset: 0.01, guardWidth: 0.025, offGrip: 0.08 },
    spriteDimensions: { bladeWidth: 0.027, tipWidth: 0.012, gripLength: 0.07, guardWidth: 0.025, shaftWidth: 0.027, bowWidth: 0.21 },
    spriteParts: [
      limb([-0.21, -0.6, 0], [-0.06, -0.34, 0], 0.012, 0.025, 'wood'),
      limb([-0.06, -0.34, 0], [0, -0.06, 0], 0.025, 0.031, 'wood'),
      limb([0, -0.06, 0], [0, 0.09, 0], 0.033, 0.033, 'leather'),
      limb([0, 0.09, 0], [-0.06, 0.38, 0], 0.031, 0.025, 'wood'),
      limb([-0.06, 0.38, 0], [-0.21, 0.65, 0], 0.025, 0.012, 'wood'),
      limb([-0.21, -0.6, 0], [-0.21, 0.65, 0], 0.004, 0.004, 'string'),
      limb([-0.21, -0.6, 0], [-0.175, -0.55, 0], 0.018, 0.018, 'trim'),
      limb([-0.21, 0.65, 0], [-0.175, 0.6, 0], 0.018, 0.018, 'trim'),
    ],
  },
  staff: {
    id: 'staff', name: 'Staff', type: 'staff', category: 'magic',
    damage: 20, reach: 1.05, speed: 0.96, staminaCost: 15, weight: 1.7,
    hands: 2, handedness: 'two', trailColor: [141, 245, 238],
    combo: ['staff-jab', 'staff-sweep', 'arcane-burst'],
    sprintAttack: 'vault-strike', airAttack: 'staff-plunge', chargedAttack: 'charged-burst',
    sheath: back([0.18, 0.65, -0.22], [-0.15, -0.988, 0], [0.14, 0.54, -0.22], [-0.02, -0.5, -0.22], [0.18, 0.79, -0.22]),
    rig: { gripLength: 0.25, gripOffset: 0.05, guardWidth: 0.06, offGrip: 0.2 },
    spriteDimensions: { bladeWidth: 0.036, tipWidth: 0.055, gripLength: 0.3, guardWidth: 0.06, shaftWidth: 0.032, headWidth: 0.07, headLength: 0.12 },
    spriteParts: [
      limb([0, -0.3, 0], [0, 0.93, 0], 0.032, 0.036, 'wood'),
      limb([0, -0.12, 0.003], [0, 0.16, 0.003], 0.035, 0.035, 'leather'),
      limb([0, 0.78, 0], [0, 0.86, 0], 0.041, 0.041, 'trim'),
      limb([-0.055, 0.88, 0], [-0.07, 1.03, 0], 0.021, 0.014, 'trim'),
      limb([0.055, 0.88, 0], [0.07, 1.03, 0], 0.021, 0.014, 'trim'),
      blob([0, 0.98, 0], 0.065, 0.07, 'eye', '*'),
    ],
  },
  javelin: {
    id: 'javelin', name: 'Javelin', type: 'javelin', category: 'throwing',
    damage: 28, reach: 1.2, speed: 1.08, staminaCost: 14, weight: 1.15,
    hands: 1, handedness: 'one', trailColor: [255, 172, 149],
    combo: ['javelin-jab', 'butt-strike', 'throw'],
    sprintAttack: 'running-throw', airAttack: 'air-throw', chargedAttack: 'charged-throw',
    projectile: 'javelin', projectileRange: 7,
    sheath: back([0.15, 0.63, -0.2], [-0.09, -0.996, 0], [0.12, 0.52, -0.2], [0.012, -0.675, -0.2], [0.142, 0.77, -0.2]),
    rig: { gripLength: 0.2, gripOffset: 0.05, guardWidth: 0.035, offGrip: 0 },
    spriteDimensions: { bladeWidth: 0.038, tipWidth: 0.004, gripLength: 0.25, guardWidth: 0.035, shaftWidth: 0.017 },
    spriteParts: [
      limb([0, -0.25, 0], [0, 1.04, 0], 0.018, 0.014, 'wood'),
      limb([0, -0.1, 0.003], [0, 0.12, 0.003], 0.021, 0.021, 'leather'),
      limb([0, 0.98, 0], [0, 1.07, 0], 0.024, 0.024, 'trim'),
      panel([[0, 1.2, 0], [0.04, 1.07, 0], [0, 1.01, 0], [-0.04, 1.07, 0]], 'blade'),
      limb([0, 1.02, 0.006], [0, 1.2, 0.006], 0.007, 0.003, 'blade'),
    ],
  },
});

export const WEAPON_IDS = freeze(Object.keys(WEAPONS));

const round = (value) => Math.round(value * 100) / 100;
const profiles = new Map();

// Invalid selections independently fall back to the familiar steel
// greatsword. Cached profiles are deeply frozen, so an animation can safely
// retain one without accidentally changing the catalogue or another player.
export function getWeapon(id = 'greatsword', material = 'steel') {
  const weaponId = typeof id === 'string' && Object.hasOwn(WEAPONS, id) ? id : 'greatsword';
  const materialId = typeof material === 'string' && Object.hasOwn(WEAPON_MATERIALS, material) ? material : 'steel';
  const key = `${weaponId}:${materialId}`;
  if (!profiles.has(key)) {
    const base = WEAPONS[weaponId];
    const tier = WEAPON_MATERIALS[materialId];
    const stats = {
      damage: round(base.damage * tier.damage),
      reach: base.reach,
      speed: round(base.speed * tier.speed),
      staminaCost: round(base.staminaCost * tier.staminaCost),
      weight: round(base.weight * tier.weight),
    };
    profiles.set(key, freeze({
      ...base,
      ...stats,
      material: materialId,
      materialName: tier.name,
      materialColor: tier.color,
      stats,
    }));
  }
  return profiles.get(key);
}
