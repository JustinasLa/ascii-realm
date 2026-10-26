import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGame } from './helpers/main-game.js';

test('without ?horse no horse stands and their figures are never set up', async () => {
  const { game, frame, horseLoads } = await loadGame();
  for (let i = 0; i < 5; i++) frame();
  assert.equal(game.horses.list.length, 0);
  assert.equal(horseLoads.length, 0);
  assert.equal(game.horseFigures, undefined);
});

test('?horse=2 stands two ridden horses, sets their figures up once and draws them band by band', async () => {
  const { game, frame, setPhone, horseLoads, horseDraws, loadHorseFigures } = await loadGame({ x: 0, y: 0 },
    { href: 'http://localhost/?debug&horse=2' });
  assert.equal(game.horses.list.length, 2);
  assert.ok(game.horses.list.every((h) => h.rider));
  for (let i = 0; i < 5; i++) frame();
  assert.equal(horseLoads.length, 1, 'asked for once, however many frames pass before it arrives');
  assert.equal(horseLoads[0].phone(), false);
  setPhone(true);
  assert.equal(horseLoads[0].phone(), true);
  setPhone(false);
  const seen = { updates: 0, rasterised: 0 };
  await loadHorseFigures({
    update: (dt, list) => { seen.updates++; assert.ok(list === game.horses.list); },
    rasterise: (view, list, near) => {
      seen.rasterised++;
      assert.ok(near === game.player);
      return list.map((horse) => {
        const cells = [{ sx: 1, sy: 1, row: horse.y }, { sx: 1, sy: 2, row: horse.y + 1 }];
        return { horse, animal: horse, cells, depth: horse.y, shadow: [1.15, 0.36], base: 0,
          bands: [{ y: horse.y, cells: cells.slice(0, 1), base: 0 }, { y: horse.y + 1, cells: cells.slice(1), base: 0 }] };
      });
    },
  });
  // The grass draws what it is handed, among its rows and in the water.
  game.grass.drawLayered = (r, w, v, t, list) => list.forEach((d) => d.draw());
  game.grass.drawReflections = (r, w, v, t, mirror, list) => list.forEach((d) => d.draw());
  horseDraws.length = 0;
  frame();
  assert.ok(game.horseFigures, 'the figures are on the debug handle');
  assert.equal(seen.updates, 1);
  assert.equal(seen.rasterised, 1);
  // Each horse is mirrored whole and drawn as its two bands.
  const bands = horseDraws.filter((f) => !f.horse);
  const whole = horseDraws.filter((f) => f.horse);
  assert.equal(bands.length, 4);
  assert.equal(whole.length, 2);
  assert.equal(horseLoads.length, 1);
  // Paused, the horses are drawn but not posed.
  game.freeze = true;
  frame();
  assert.equal(seen.updates, 1);
  assert.equal(seen.rasterised, 2);
});

test('a horse placed through the debug handle stands where asked', async () => {
  const { game, frame, horseLoads } = await loadGame();
  const horse = game.horses.spawn({ x: game.player.x + 20, y: game.player.y, heading: 0 });
  assert.ok(horse);
  assert.equal(game.horses.list.length, 1);
  frame();
  assert.equal(horseLoads.length, 1);
});
