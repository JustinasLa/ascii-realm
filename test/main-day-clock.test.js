import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGame } from './helpers/main-game.js';

// Records what the frame hands the sky reflection and the sound.
async function load(query, options = {}) {
  const skies = [];
  const loaded = await loadGame(undefined, { href: `http://localhost/?debug&nogate${query}`, ...options,
    real: { drawSkyReflection: (r, view, t, sky) => skies.push(sky), ...options.real } });
  const nights = [];
  loaded.game.sound.update = (...args) => nights.push(args[6]);
  return { ...loaded, skies, nights };
}

test('the world clock starts where the URL says and lights the frame by its sky', async () => {
  const { game, frame, skies, nights } = await load('&time=noon');
  assert.ok(Math.abs(game.dayClock.tick - 6000) < 1e-6);
  frame();
  const sky = skies.at(-1);
  assert.equal(sky, game.dayClock.state, 'one sky state, passed down');
  assert.equal(sky.sun, 1);
  assert.equal(game.renderer.sky, sky.grade);
  assert.ok(game.renderer.sky.gain[0] > 2);
  assert.equal(nights.at(-1), 0, 'the sound hears the day');
});

test('days pass with the world step and hold with a pinned frame', async () => {
  const fast = await load('&daylen=20&time=0');
  for (let i = 0; i < 60; i++) fast.frame(1 / 60);
  assert.ok(fast.game.dayClock.tick > 400, `${fast.game.dayClock.tick}`);
  const pinned = await load('&daylen=20&time=0&pintime=5');
  for (let i = 0; i < 60; i++) pinned.frame(1 / 60);
  assert.ok(Math.abs(pinned.game.dayClock.tick) < 1e-6);
});

test('a lobby shares the wall clock, and leaving it carries on solo', async () => {
  const { game, frame } = await load('&time=noon');
  game.multiplayer.room = { code: 'AB7K2D' };
  frame();
  assert.equal(game.dayClock.shared, true);
  const shared = game.dayClock.tick;
  game.multiplayer.room = null;
  frame();
  assert.equal(game.dayClock.shared, false);
  assert.ok(Math.abs(game.dayClock.tick - shared) < 5, 'no jump on leaving');
});

test('the frame hands its sky to the moonlight, the grass, the glowcaps, the fireflies and the monsters', async () => {
  const { game, frame } = await load('&time=noon');
  const calls = {};
  const spy = (label, object, name) => {
    const real = object[name];
    object[name] = function (...args) { (calls[label] ??= []).push(args); return real.apply(this, args); };
  };
  spy('night', game.nightLight, 'prepare');
  spy('monsters', game.monsters, 'update');
  spy('fireflies', game.fireflies, 'update');
  spy('glow', game.mushrooms, 'drawGlow');
  frame();
  const sky = game.dayClock.state;
  assert.equal(calls.night.at(-1)[2].sky, sky);
  assert.equal(game.grass.light, sky.direct);
  assert.equal(calls.monsters.at(-1)[3], sky);
  assert.equal(calls.fireflies.at(-1)[7], sky.fireflies);
  assert.equal(calls.glow.at(-1)[3], sky.glow);
  game.fires.list.push({ x: 4, y: 5, kind: 'campfire' });
  game.torches.list.push({ x: 6, y: 7 });
  assert.deepEqual(game.monsters.env.lights(), [{ x: 4, y: 5, level: 15 }, { x: 6, y: 7, level: 14 }]);
  assert.equal(game.monsters.env.weather, game.weather);
});

test('the world\'s season rolls with the clock\'s days, and the URL can pin it', async () => {
  const { makeTree } = await import('../src/world/trees.js');
  const { seasonAt } = await import('../src/world/seasons.js');
  const { realmDay } = await import('../src/world/clock.js');
  // Trees are seen only in the water here.
  const fresh = await load('', { real: { propDepthSlices: () => null, propInView: (view, p, reflected) => reflected === true } });
  assert.equal(fresh.game.world.options.season, 'summer', 'a fresh world is summer, as it was');
  const seasons = [];
  fresh.game.sound.update = (...args) => seasons.push(args[7]);
  fresh.frame();
  assert.equal(fresh.game.world.season, 'summer');
  fresh.game.dayClock.days = 28;
  fresh.frame();
  assert.equal(fresh.game.world.season, 'autumn');
  assert.deepEqual(seasons, ['summer', 'autumn'], 'the sound hears the world\'s season');
  assert.equal(typeof fresh.game.metrics.seasonMs, 'number');
  // A tree in view, here only in the water, waits to turn until it leaves.
  const tree = makeTree(2.5, 3.5, () => 0.5, { species: 'oak' });
  fresh.game.world.propsIn = () => [tree];
  fresh.game.dayClock.days = 55;
  fresh.game.dayClock.set(23999);
  fresh.frame();
  assert.equal(fresh.game.seasons.pending, 0);
  assert.equal(tree.season, 'summer');
  // While a lobby is being joined, nothing about the season changes.
  fresh.game.multiplayer.status = 'connecting';
  fresh.game.dayClock.days = 60;
  fresh.frame();
  assert.equal(fresh.game.world.season, 'autumn');

  const pinned = await load('&season=winter&seasondays=3');
  assert.equal(pinned.game.world.options.season, 'winter');
  assert.equal(pinned.game.seasons.pinned, 'winter');
  assert.equal(pinned.game.seasons.length, 3);
  const lobby = await load('&season=winter&room=AB7K2D');
  assert.equal(lobby.game.world.options.season, seasonAt(realmDay(Date.now())), 'a lobby starts in the realm\'s season');
});

test('land first made on the sunrise frame grows in the new season', async () => {
  const { game, frame } = await load('&daylen=20');
  const seen = [];
  const propsIn = game.world.propsIn.bind(game.world);
  game.world.propsIn = (...args) => { seen.push(game.world.season); return propsIn(...args); };
  game.dayClock.days = 27;
  game.dayClock.set(23999.9);
  frame(1 / 60);
  assert.equal(game.dayClock.day, 28, 'this frame crossed sunrise');
  assert.ok(seen.length && seen.every((season) => season === 'autumn'), `${seen}`);
});

test('a pinned frame turns no tree in view, only those out of it', async () => {
  const { makeTree } = await import('../src/world/trees.js');
  const { rebakeHere } = await import('../src/world/fine-bakes.js');
  const { bakeWhole } = await import('../src/world/props.js');
  rebakeHere(bakeWhole);
  try {
    const { game, frame } = await load('&pintime=5', { real: { propDepthSlices: () => null,
      propInView: (view, p) => p.x < 5 } });
    const seen = makeTree(2.5, 3.5, () => 0.5, { species: 'oak' });
    const away = makeTree(9.5, 3.5, () => 0.5, { species: 'oak' });
    game.world.propsIn = () => [seen, away];
    game.world.measureProp = () => {};
    game.dayClock.days = 27;
    game.dayClock.set(23999);
    frame();
    assert.equal(seen.season, 'summer', 'in view, so it keeps its season');
    assert.equal(game.seasons.pending, 0);
    assert.equal(away.season, 'autumn');
  } finally {
    rebakeHere(null);
  }
});

test('a page started in a lobby follows the realm while shared, and leaving it brings back its own seasons', async () => {
  const { seasonAt } = await import('../src/world/seasons.js');
  const { realmDay } = await import('../src/world/clock.js');
  for (const [query, after] of [['&season=winter&seasondays=3', 'winter'], ['&seasondays=3', 'autumn']]) {
    const { game, frame } = await load(`${query}&room=AB7K2D`);
    const realm = game.world.season;
    // Joining: the season holds until the clock is shared.
    game.multiplayer.status = 'connecting';
    game.dayClock.days = 3;
    frame();
    assert.equal(game.world.season, realm, query);
    game.multiplayer.room = { code: 'AB7K2D' };
    game.multiplayer.status = 'connected';
    frame();
    assert.equal(game.world.season, seasonAt(realmDay(Date.now())), query);
    assert.equal(game.seasons.pinned, null);
    assert.equal(game.seasons.length, 28);
    game.multiplayer.room = null;
    game.multiplayer.status = 'idle';
    game.dayClock.days = 3;
    frame();
    assert.equal(game.seasons.pinned, after === 'winter' ? 'winter' : null, query);
    assert.equal(game.seasons.length, 3);
    assert.equal(game.world.season, after, query);
  }
});
