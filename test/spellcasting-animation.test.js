import assert from 'node:assert/strict';
import test from 'node:test';
import { modelFigure } from '../test-support/model-figure.js';
import { runeScene } from '../test-support/spells.js';
import { withLayers } from './helpers/renderer.js';
import { loadSpells } from '../src/spells/catalog.js';
import { GRASS } from '../src/world/world.js';
import { Player } from '../src/entities/player.js';

test('external launches initialize animation, cancel anticipation and land cleanly', () => {
  const model = modelFigure(), player = new Player(0, 0);
  player.jump(); player.trickQueued = true;
  assert.equal(player.launch(12), true);
  assert.equal(player.jumpKind, 'stand'); assert.equal(player.windUp, -1); assert.equal(player.trickQueued, false);
  assert.ok(player.flight > 0);
  for (let frame = 0; frame < 100; frame++) {
    player.update(0.05, { isWalkable: () => true, typeAt: () => GRASS }, { x: 0, y: 0 }, false);
    model.update(0.05, player);
  }
  assert.equal(player.air, 0);
  assert.ok(Object.values(model.weights).every(Number.isFinite));
});

test('the character model handles externally airborne state without a jump capture', () => {
  const model = modelFigure(), player = new Player(0, 0);
  player.air = 1; player.vy = 3; player.jumpKind = null;
  assert.doesNotThrow(() => model.update(0.05, player));
  assert.equal(model.jump.kind, 'stand');
});

for (const spell of await loadSpells()) test(`${spell.name}: casting, movement, character animation and ASCII effects keep running`, () => {
  const model = modelFigure();
  const { casting, player, world, cast } = runeScene(spell, { allyInPath: true, allyRange: 1 });
  world.typeAt = () => GRASS;
  assert.equal(cast().ok, true);
  const renderer = withLayers({ cols: 160, rows: 100 });
  for (let frame = 0; frame < 180; frame++) {
    player.update(0.05, world, { x: 0, y: 0 }, false);
    model.update(0.05, player);
    casting.update(0.05);
    casting.effects.draw(renderer, { x0: -80, y0: -50 }, casting.projectiles);
    assert.ok([player.x, player.y, player.air, player.vy, player.flight, player.jumpT].every(Number.isFinite));
    assert.ok(Object.values(model.weights).every(Number.isFinite));
    player.events.length = 0;
  }
});
