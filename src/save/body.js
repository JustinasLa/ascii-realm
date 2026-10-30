// A body: what one character takes into the realm record and back out of it,
// that is their place, vitals, bag and worn gear (`docs/saves.md`). These
// functions move a body between the live game and a realm record; nothing
// here touches storage.
//
// `game` is `{ player, inventory, world, appliedId }`. `appliedId` names the
// body the live player and bag hold, so a capture is always filed under the
// character it was played as, whichever character is active by then.

import { MAX_BODIES, MAX_COORD, OUTLAW } from './format.js';

// The fields a body has; any other field is a newer build's, kept on save.
const KNOWN = ['savedAt', 'x', 'y', 'heading', 'health', 'stamina', 'respawn', 'bag', 'worn'];

export const bodyIdOf = (characters) => characters?.active?.id ?? OUTLAW;

// What a new character sets out with: the sword at the hip and a stone
// pickaxe for ore veins.
export const starterKit = () => ({ bag: [{ id: 'stonePickaxe', count: 1 }], worn: { mainHand: { id: 'shortSword', count: 1 } } });

export function captureBody({ player, inventory }, now = Date.now()) {
  const { x, y, heading, vitals } = player;
  return { savedAt: now, x, y, heading, health: vitals.health, stamina: vitals.stamina, respawn: null, ...inventory.serialize() };
}

// Puts `body` into the live game as `id`'s: `{ repaired }`, counting items
// with no room left and a place that had to move. A place that is missing,
// out of bounds or no longer walkable wakes at the world spawn, and so does a
// body saved fallen, with full vitals.
export function applyBody(body, game, id) {
  const { player, inventory, world } = game;
  const { dropped } = inventory.restore(body);
  const fallen = Number.isFinite(body.health) && body.health <= 0;
  const placed = [body.x, body.y].every((n) => Number.isFinite(n) && Math.abs(n) <= MAX_COORD)
    && world.isWalkable(body.x, body.y);
  const at = placed && !fallen ? body : world.spawn;
  player.restoreAt(at.x, at.y, fallen ? {} : body);
  game.appliedId = id;
  return { repaired: dropped + (placed || fallen ? 0 : 1) };
}

// Files `body` under `id` and marks it the one last played. Fields of the
// stored body this build doesn't know stay. Bodies of characters no longer in
// `liveIds` go, and past MAX_BODIES the oldest go first.
export function putBody(realm, id, body, liveIds) {
  const old = realm.bodies[id] ?? {};
  const kept = Object.fromEntries(Object.entries(old).filter(([key]) => !KNOWN.includes(key)));
  const bodies = { ...realm.bodies, [id]: { ...kept, ...body } };
  const live = new Set([OUTLAW, id, ...liveIds]);
  const ids = Object.keys(bodies).filter((key) => live.has(key))
    .sort((a, b) => (b === id) - (a === id) || bodies[b].savedAt - bodies[a].savedAt);
  realm.bodies = Object.fromEntries(ids.slice(0, MAX_BODIES).map((key) => [key, bodies[key]]));
  realm.active = id;
}

// Files the live body under `outgoingId`, then plays `incomingId`'s body, or
// the starter kit at the world spawn when they have none.
export function switchBody(realm, outgoingId, incomingId, game, liveIds, now = Date.now()) {
  putBody(realm, outgoingId, captureBody(game, now), liveIds);
  const { spawn } = game.world;
  return applyBody(realm.bodies[incomingId] ?? { ...starterKit(), x: spawn.x, y: spawn.y }, game, incomingId);
}

// Files the live body into `realm` before a save. When the active character
// changed since the body was applied (here, in another tab or by creating
// one), the live body goes under its own id first and the active character's
// is played. True when it switched.
export function fileBody(realm, game, characters, now = Date.now()) {
  const active = bodyIdOf(characters);
  const liveIds = characters.characters.map((character) => character.id);
  const switched = active !== game.appliedId;
  if (switched) switchBody(realm, game.appliedId, active, game, liveIds, now);
  putBody(realm, active, captureBody(game, now), liveIds);
  return switched;
}
