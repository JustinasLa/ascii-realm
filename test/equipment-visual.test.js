import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dressFigure, drawFigure } from '../src/entities/figure.js';
import { MATERIALS } from '../src/entities/materials.js';
import { Player } from '../src/entities/player.js';
import { buildRig, project } from '../src/entities/rig.js';
import { Inventory } from '../src/inventory/inventory.js';
import { ASPECT } from '../src/world/world.js';

const view = { x0: -30, y0: -30, cols: 60, rows: 60 };

function render(player) {
  const cells = new Map();
  drawFigure({}, view, player, dressFigure(player), (r, x, y, ...appearance) => {
    cells.set(`${x + view.x0},${y + view.y0}`, appearance);
  });
  return cells;
}

function outlaw(heading = 0) {
  const player = new Player(0, 0);
  player.heading = heading;
  player.settleCape();
  return player;
}

function equipAgain(inventory, id) {
  const index = inventory.slots.findIndex((stack) => stack?.id === id);
  assert.notEqual(index, -1, 'the removed item remains in the bag');
  assert.equal(inventory.equip(index), true);
}

test('starter equipment preserves the fully dressed outlaw from every cardinal direction', () => {
  for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const player = outlaw(heading);
    const legacy = render(player);
    player.equipment = new Inventory().equipment;
    assert.deepEqual(render(player), legacy);
  }
});

test('unequipping and restoring the cape changes and restores the visible figure', () => {
  const player = outlaw(Math.PI);
  const inventory = new Inventory();
  player.equipment = inventory.equipment;
  const equipped = render(player);

  assert.equal(inventory.unequip('cape'), true);
  assert.notDeepEqual(render(player), equipped, 'removing the cape changes rendered cells');
  equipAgain(inventory, 'travelCloak');
  assert.deepEqual(render(player), equipped);
});

test('unequipping and restoring a sheathed short sword removes and restores its visible scabbard', () => {
  const player = outlaw(Math.PI / 2);
  const inventory = new Inventory();
  player.equipment = inventory.equipment;
  const equipped = render(player);

  assert.equal(inventory.unequip('mainHand'), true);
  assert.notDeepEqual(render(player), equipped, 'the sword and scabbard no longer render');
  equipAgain(inventory, 'shortSword');
  assert.deepEqual(render(player), equipped);
});

test('a drawn blade disappears immediately when its equipment slot is cleared', () => {
  const player = outlaw();
  const inventory = new Inventory();
  player.equipment = inventory.equipment;
  player.combat.toggle();
  for (let i = 0; i < 30; i++) player.combat.update(1 / 60, false);
  player.settleCape();
  assert.ok(buildRig(player).sword, 'the outlaw is holding the drawn sword');
  assert.ok(dressFigure(player).some((part) => part.mat === MATERIALS.blade));
  const equipped = render(player);

  assert.equal(inventory.unequip('mainHand'), true);
  assert.equal(dressFigure(player).some((part) => part.mat === MATERIALS.blade), false);
  assert.notDeepEqual(render(player), equipped);
  equipAgain(inventory, 'shortSword');
  assert.deepEqual(render(player), equipped);
});

test('the off-hand buckler visibly equips, removes, and restores beside the non-sword arm', () => {
  const player = outlaw();
  const inventory = new Inventory();
  player.equipment = inventory.equipment;
  assert.equal(inventory.unequip('mainHand'), true);
  const unarmed = render(player);
  equipAgain(inventory, 'woodenBuckler');
  const shielded = render(player);
  assert.notDeepEqual(shielded, unarmed);
  const addedCells = [...shielded.keys()].filter((key) => !unarmed.has(key));
  assert.ok(addedCells.length > 0, 'the buckler extends the visible arm silhouette');
  assert.ok(addedCells.every((key) => Number(key.split(',')[0]) > 0),
    'the buckler appears beside the non-sword arm on the right');

  assert.equal(inventory.unequip('offHand'), true);
  assert.deepEqual(render(player), unarmed);
  equipAgain(inventory, 'woodenBuckler');
  assert.deepEqual(render(player), shielded);
});

for (const [slot, id] of [
  ['helm', 'outlawHood'], ['chest', 'leatherJerkin'],
  ['legs', 'ridingBoots'], ['hands', 'leatherBracers'],
]) {
  test(`removing ${slot} reveals an underlying body and re-equipping restores the figure`, () => {
    const player = outlaw();
    const inventory = new Inventory();
    player.equipment = inventory.equipment;
    const equipped = render(player);
    assert.equal(inventory.unequip(slot), true);
    assert.notDeepEqual(render(player), equipped);
    equipAgain(inventory, id);
    assert.deepEqual(render(player), equipped);
  });
}

test('an unequipped outlaw still renders its head, torso, hands, and every leg segment', () => {
  const player = outlaw();
  player.equipment = new Inventory({ starter: false }).equipment;
  const cells = [...render(player).keys()].map((key) => key.split(',').map(Number));
  const rig = buildRig(player);
  const joints = [rig.head, rig.chest, rig.pelvis,
    ...rig.arms.flatMap((arm) => [arm.shoulder, arm.elbow, arm.wrist, arm.hand]),
    ...rig.legs.flatMap((leg) => [leg.hip, leg.knee, leg.ankle, leg.toe])];
  for (const joint of joints) {
    const [x, y] = project(joint);
    assert.ok(cells.some(([cx, cy]) => Math.abs(cx + 0.5 - x / ASPECT) < 2
      && Math.abs(cy + 0.5 - y) < 1.5), `body is visible near projected joint ${x},${y}`);
  }
  const parts = dressFigure(player);
  // A linen shirt, bare hands and hair; no hood, jerkin, boots, bracers,
  // cloak or blade.
  assert.ok(parts.some((part) => part.mat === MATERIALS.linen));
  assert.ok(parts.some((part) => part.mat === MATERIALS.skin));
  assert.ok(parts.some((part) => part.mat === MATERIALS.hair));
  assert.equal(parts.some((part) => [MATERIALS.hood, MATERIALS.jerkin, MATERIALS.boot, MATERIALS.bracer,
    MATERIALS.cloak, MATERIALS.blade].includes(part.mat)), false);
});
