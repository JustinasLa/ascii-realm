// The off-hand instrument on the 3D outlaw: one simple silhouette per
// instrument, held where the buckler sits. Each is built with its grip at
// the origin, its long axis along +x away from the hand and its broad face
// to +z. The left hand carries it hanging below the hand, face to the front,
// in the standing pose; walking swings it with the arm. Holding only:
// nothing on it moves. `THREE` is passed in, so the shapes build in Node as
// well as in the page.
import { INSTRUMENT_ITEMS } from '../inventory/instrument-items.js';

export const INSTRUMENT_SHAPES = Object.freeze(INSTRUMENT_ITEMS.map(item => item.id));
// Where the shapes hang from, in the left forearm bone's own space: the grip
// just past the wrist, turned so +x points down and +z to the front while
// the outlaw stands (measured from the standing pose's forearm).
export const HOLD = Object.freeze({ at: Object.freeze([0, 0.34, 0]),
  quaternion: Object.freeze([0.6371, -0.2765, -0.2984, -0.6547]) });
// The grip's place along each shape, which is drawn from the forearm's middle.
const GRIP = 0.14;
const COLOUR = Object.fromEntries(INSTRUMENT_ITEMS.map(item => [item.id, (item.colour[0] << 16) | (item.colour[1] << 8) | item.colour[2]]));
// Dark wood for trims, pegs and sound holes; iron for tines and keys.
const DARK = 0x3a2a1c;
const IRON = 0x70747c;
const PIPE = 0x2a1e14;
const STRING = 0xd8d0b8;

// Builders take a small kit and add pieces to the group.
const SHAPES = {
  lute(k) {
    k.ellipsoid([0.13, 0.09, 0.045], [0.4, 0, 0], k.colour);
    k.box([0.18, 0.045, 0.03], [0.22, 0, 0], k.colour);
    k.box([0.07, 0.05, 0.025], [0.1, 0, -0.012], DARK, [0, 0.5, 0]);
    k.disc(0.03, 0.01, [0.36, 0, 0.045], DARK);
  },
  celticHarp(k) {
    // A triangle: the pillar, the curved neck and the slanting soundbox.
    k.box([0.38, 0.04, 0.04], [0.31, 0, 0], k.colour);
    k.box([0.05, 0.1, 0.04], [0.13, -0.05, 0], k.colour, [0, 0, 0.25]);
    k.box([0.05, 0.1, 0.04], [0.12, -0.15, 0], k.colour);
    k.box([0.05, 0.08, 0.04], [0.14, -0.23, 0], k.colour, [0, 0, -0.3]);
    k.box([0.46, 0.06, 0.07], [0.31, -0.13, 0], k.colour, [0, 0, 0.6]);
    for (let i = 1; i <= 5; i++) {
      const y = -0.04 * i;
      const end = 0.12 + (y + 0.26) * (0.38 / 0.26);
      k.rod(0.006, end - 0.14, [(end + 0.14) / 2, y, 0], STRING);
    }
  },
  dulcimer(k) {
    // A trapezoid soundboard, its long edge furthest from the hand.
    k.prism([[0, -0.08], [0, 0.08], [0.22, 0.21], [0.22, -0.21]], 0.05, [0.14, 0, -0.025], k.colour);
    k.disc(0.025, 0.01, [0.25, 0.05, 0.026], DARK);
    k.disc(0.025, 0.01, [0.25, -0.05, 0.026], DARK);
    // Two light hammers tucked under the strap.
    for (const y of [-0.03, 0.03]) {
      k.rod(0.008, 0.18, [0.24, y, 0.04], DARK);
      k.ball(0.02, [0.34, y, 0.04], DARK);
    }
  },
  kalimba(k) {
    k.box([0.14, 0.1, 0.04], [0.2, 0, 0], k.colour);
    k.disc(0.018, 0.01, [0.24, 0, 0.02], DARK);
    for (let i = 0; i < 7; i++) {
      const length = 0.09 - Math.abs(i - 3) * 0.01;
      k.box([length, 0.008, 0.012], [0.14 + length / 2, (i - 3) * 0.012, 0.026], IRON);
    }
  },
  vielle(k) {
    // A figure-eight body on one axis, a short neck and a round pegbox.
    k.ellipsoid([0.09, 0.075, 0.04], [0.34, 0, 0], k.colour);
    k.ellipsoid([0.11, 0.095, 0.04], [0.49, 0, 0], k.colour);
    k.box([0.14, 0.04, 0.03], [0.2, 0, 0], k.colour);
    k.disc(0.035, 0.025, [0.11, 0, 0], DARK);
    k.box([0.012, 0.08, 0.012], [0.42, 0, 0.042], DARK);
  },
  accordion(k) {
    k.box([0.22, 0.2, 0.14], [0.27, 0, 0], k.colour);
    for (let i = 0; i < 4; i++) k.box([0.012, 0.21, 0.15], [0.19 + i * 0.055, 0, 0], DARK);
    k.box([0.03, 0.22, 0.16], [0.145, 0, 0], DARK);
    k.box([0.03, 0.22, 0.16], [0.395, 0, 0], DARK);
  },
  bagpipe(k) {
    k.ellipsoid([0.11, 0.08, 0.08], [0.28, 0, 0], k.colour);
    // Three drones up past the hand, behind the arm, and the chanter below.
    k.rod(0.015, 0.3, [0.13, 0.07, -0.06], PIPE);
    k.rod(0.015, 0.24, [0.16, 0.1, -0.03], PIPE);
    k.rod(0.015, 0.2, [0.18, 0.04, -0.09], PIPE);
    k.rod(0.016, 0.22, [0.46, 0, 0.03], PIPE);
  },
  flute(k) {
    k.rod(0.022, 0.55, [0.2, 0, 0], k.colour);
    for (const x of [0.3, 0.36, 0.42]) k.disc(0.012, 0.012, [x, 0, 0.021], DARK);
  },
  trumpet(k) {
    k.rod(0.016, 0.36, [0.22, 0, 0], k.colour);
    k.bell(0.07, 0.12, [0.46, 0, 0], k.colour);
    for (const x of [0.17, 0.21, 0.25]) k.box([0.022, 0.06, 0.022], [x, 0.04, 0], k.colour);
    k.box([0.24, 0.02, 0.02], [0.22, 0.07, 0], k.colour);
  },
};

/** The held shape of an instrument, as a THREE.Group, or null for anything else. */
export function buildInstrumentShape(THREE, id) {
  const build = Object.hasOwn(SHAPES, id) ? SHAPES[id] : null;
  if (!build) return null;
  const group = new THREE.Group();
  group.name = `instrument:${id}`;
  group.position.x = -GRIP;
  const add = (geometry, at, colour, turn = [0, 0, 0]) => {
    const piece = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color: colour }));
    piece.position.set(...at);
    piece.rotation.set(...turn);
    group.add(piece);
    return piece;
  };
  build({
    colour: COLOUR[id],
    box: ([x, y, z], at, colour, turn) => add(new THREE.BoxGeometry(x, y, z), at, colour, turn),
    // Long pieces lie along the forearm (+x).
    rod: (radius, length, at, colour) => add(new THREE.CylinderGeometry(radius, radius, length, 8), at, colour, [0, 0, Math.PI / 2]),
    // Round faces look to the front (+z).
    disc: (radius, depth, at, colour) => add(new THREE.CylinderGeometry(radius, radius, depth, 12), at, colour, [Math.PI / 2, 0, 0]),
    ball: (radius, at, colour) => add(new THREE.SphereGeometry(radius, 8, 6), at, colour),
    ellipsoid: (radii, at, colour) => {
      const piece = add(new THREE.SphereGeometry(1, 14, 10), at, colour);
      piece.scale.set(...radii);
      return piece;
    },
    // An open bell flaring away from the hand.
    bell: (radius, length, at, colour) => {
      const piece = add(new THREE.ConeGeometry(radius, length, 14, 1, true), at, colour, [0, 0, Math.PI / 2]);
      piece.material.side = THREE.DoubleSide;
      return piece;
    },
    prism: (points, depth, at, colour) => {
      const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
      return add(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }), at, colour);
    },
  });
  return group;
}
