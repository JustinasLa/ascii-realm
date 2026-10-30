import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KINDS, Monsters, toCells, toMetres } from '../src/entities/monsters.js';
import {
  FIRE_LIGHT, NIGHT_HOURS, TORCH_LIGHT, darkChance, lightLevel, lightSources, rainOf, skyDarken, skyLight, spawnChance,
  thunderOf,
} from '../src/entities/night-spawns.js';
import { NIGHT_SKY, skyAt } from '../src/world/clock.js';
import { Fires } from '../src/world/fire.js';
import { Torches } from '../src/world/torch.js';
import { WEATHER_EFFECTS } from '../src/world/weather.js';
import { GRASS, WATER } from '../src/world/world.js';

const NOON = skyAt(6000, 0, 0);
const MIDNIGHT = skyAt(18000, 0, 0);
const NEW_MOON = skyAt(18000, 4, 4);
const storm = { preset: 'thunderstorm', intensity: 1 };
const rain = { preset: 'rain', intensity: 1 };

test('the sky darkens by the hour and the weather, as many levels as the world\'s light rule says', () => {
  assert.equal(skyDarken(1, 0, 0), 0);
  assert.equal(skyDarken(0, 0, 0), 11);
  assert.equal(skyDarken(1, 1, 0), 3);
  assert.equal(skyDarken(1, 1, 1), 5);
  assert.deepEqual([skyLight(NOON), skyLight(MIDNIGHT), skyLight(NOON, rain), skyLight(NOON, storm)], [15, 4, 12, 10]);
  assert.deepEqual([darkChance(4), darkChance(8), darkChance(0), darkChance(15)], [0.5, 0, 1, 0]);
});

test('rain, hail, sleet and snow count as rain; thunder needs both lightning and rain', () => {
  for (const [preset, profile] of Object.entries(WEATHER_EFFECTS)) {
    const weather = { preset, intensity: 0.6 };
    const wet = ['rain', 'hail', 'sleet', 'snow'].includes(profile.kind);
    assert.equal(rainOf(weather), wet ? 0.6 : 0, preset);
    assert.equal(thunderOf(weather), wet && profile.lightning ? 0.6 : 0, preset);
  }
  assert.equal(thunderOf({ preset: 'distant-thunder', intensity: 1 }), 0);
  assert.deepEqual([rainOf(null), rainOf({ preset: 'nowhere', intensity: 1 }), rainOf({ preset: 'rain' })], [0, 0, 0]);
});

test('night creatures come only in the night\'s hours, by its darkness and the moon; the rest at any hour', () => {
  for (const id of ['goblin', 'elf']) {
    assert.equal(KINDS[id].night, false);
    for (const sky of [NOON, MIDNIGHT]) assert.equal(spawnChance(KINDS[id], sky, null), 1);
  }
  for (const id of ['skeleton', 'troll']) {
    const kind = KINDS[id];
    assert.equal(kind.night, true);
    for (const tick of [6000, NIGHT_HOURS[0] - 1, NIGHT_HOURS[1]]) assert.equal(spawnChance(kind, skyAt(tick, 0, 0), null), 0, `${tick}`);
    assert.equal(spawnChance(kind, NOON, storm), 0);
    assert.equal(spawnChance(kind, MIDNIGHT, null), 1);
    assert.equal(spawnChance(kind, NIGHT_SKY, { preset: 'clear', intensity: 0 }), 1);
    assert.ok(Math.abs(spawnChance(kind, NEW_MOON, null) - 0.8) < 1e-12);
    assert.equal(spawnChance(kind, skyAt(13200, 0, 0), null), 0.25);
    assert.equal(spawnChance(kind, skyAt(13400, 0, 0), null), 0.5);
  }
});

test('fires and thrown torches light the ground around them, a level less a metre', () => {
  const east = (m, north = 0) => { const [x, y] = toCells(m, north); return { x, y }; };
  const fire = (m, north) => lightSources([{ ...east(m, north), kind: 'campfire' }], []);
  assert.equal(lightLevel(0, 0, fire(10)), 5);
  assert.equal(lightLevel(0, 0, fire(14, 1)), 0);
  assert.equal(lightLevel(0, 0, lightSources([], [east(13)])), 1);
  assert.equal(lightLevel(0, 0, []), 0);
  assert.equal(lightLevel(0, 0, lightSources()), 0);
  // Light holds through every part-metre up to its reach.
  for (const [m, north, fireLevel, torchLevel] of [[14.5, 0, 1, 0], [14.999, 0, 1, 0], [7.25, 7.25, 1, 0],
    [15, 0, 0, 0], [15.01, 0, 0, 0], [13.5, 0, 2, 1], [9.5, 0, 6, 5], [0, 0, 15, 14]]) {
    assert.equal(lightLevel(0, 0, fire(m, north)), fireLevel, `a fire ${m} m east, ${north} m north`);
    assert.equal(lightLevel(0, 0, lightSources([], [east(m, north)])), torchLevel, `a torch ${m} m east`);
  }
  assert.deepEqual(lightSources([{ x: 1, y: 2, kind: 'ground' }], [{ x: 3, y: 4 }]),
    [{ x: 1, y: 2, level: FIRE_LIGHT }, { x: 3, y: 4, level: TORCH_LIGHT }]);
});

// Open grass east of x = 1000, a lake beyond.
const land = { seed: 1, typeAt: (x) => (x > 1000 ? WATER : GRASS), isWalkable: () => true,
  burnGrass() {}, coverGrass() {} };

test('a thrown torch keeps the dead off the ground beneath it, then the fire it lights does, until it is out', () => {
  const fires = new Fires();
  const torches = new Torches();
  const lights = () => lightSources(fires.list, torches.list);
  const thrower = { x: 0.5, y: 0.5, heading: 0, torch: true, handsFull: false };
  assert.equal(torches.throw(thrower, { x: 0, y: 0, h: 20 }), 'thrown');
  const under = (at) => lightLevel(at.x, at.y, lights());
  assert.ok(under(torches.list[0]) > 0, 'in flight');
  let landed = [];
  for (let k = 0; k < 300 && !landed.length; k++) landed = torches.update(1 / 60, land, fires);
  assert.equal(landed[0].type, 'lit');
  assert.equal(torches.list.length, 0);
  const lit = fires.list[0];
  assert.equal(lit.kind, 'ground');
  assert.equal(under(lit), FIRE_LIGHT, 'its fire lights the spot');
  fires.extinguish(land, lit);
  assert.equal(under(lit), 0, 'burnt out');
  const wildfire = fires.ignite(land, 50, 50, { source: 'lightning' }) ?? fires.create(land, 50.5, 50.5, 'ground');
  assert.equal(under(wildfire), FIRE_LIGHT);
  fires.extinguish(land, wildfire);
  const wet = { ...thrower, x: 1100.5, torch: true };
  torches.throw(wet, { x: 0, y: 0, h: 20 });
  for (let k = 0; k < 300 && torches.list.length; k++) landed = torches.update(1 / 60, land, fires);
  assert.equal(landed[0].type, 'water');
  assert.equal(lights().length, 0, 'drowned: nothing lights the lake');
});

const player = { x: 0, y: 0, air: 0, heading: 0, runSpeed: 5, feel: { reach: 0.95 } };
// Runs `seconds` of spawning (every 0.1 s, the monsters left standing) and
// returns the spawn times per kind.
function spawns(sky, { counts = { skeleton: 4, goblin: 4, troll: 4, elf: 4 }, seconds = 30, env } = {}) {
  const monsters = new Monsters({ counts, first: 0.1, every: 0.1, seed: 3 });
  if (env) monsters.env = env;
  const times = {};
  let seen = 0;
  for (let t = 0; t < seconds; t += 0.05) {
    if (sky) monsters.update(0.05, { isWalkable: () => true, typeAt: () => GRASS }, player, sky);
    else monsters.update(0.05, { isWalkable: () => true, typeAt: () => GRASS }, player);
    for (const m of monsters.list.slice(seen)) (times[m.kind.id] ??= []).push(+t.toFixed(2));
    seen = monsters.list.length;
    for (const m of monsters.list) m.update = () => {};
    if (monsters.list.length > 200) break;
  }
  return { times, monsters };
}

test('by day only goblins and elves come; a full-moon midnight brings them all as ever', () => {
  const day = spawns(NOON, { seconds: 600 });
  assert.deepEqual(Object.keys(day.times).sort(), ['elf', 'goblin']);
  assert.deepEqual(day.monsters.chances, { skeleton: 0, goblin: 1, troll: 0, elf: 1 });
  const night = spawns(MIDNIGHT);
  assert.deepEqual(night.times, spawns().times, 'the same spawns as with no clock');
  assert.deepEqual(Object.keys(night.times).sort(), ['elf', 'goblin', 'skeleton', 'troll']);
  const dusk = spawns(skyAt(13400, 0, 0), { counts: { skeleton: 40 }, seconds: 8 });
  assert.equal(dusk.monsters.chances.skeleton, 0.5);
  const risen = dusk.times.skeleton.length;
  assert.ok(risen > 15 && risen < 65, `half of the tries: ${risen}`);
});

test('no night creature rises where a fire lights the ground; one at dawn stays when the day comes', () => {
  const at = { x: player.x, y: player.y };
  const lights = () => lightSources([{ ...at, kind: 'campfire' }], []);
  const { monsters } = spawns(MIDNIGHT, { counts: { skeleton: 100 }, seconds: 12, env: { weather: null, lights } });
  assert.ok(monsters.list.length >= 50, `${monsters.list.length}`);
  for (const m of monsters.list) {
    const [mx, mz] = toMetres(m.x - at.x, m.y - at.y);
    assert.ok(Math.abs(mx) + Math.abs(mz) >= FIRE_LIGHT - 1e-6, `${Math.abs(mx) + Math.abs(mz)} m from the fire`);
  }
  const plain = spawns(MIDNIGHT, { counts: { skeleton: 100 }, seconds: 12, env: { weather: null, lights: lights() } });
  assert.ok(plain.monsters.list.length >= 50, 'a list works as well as a function');
  const ground = { isWalkable: () => true, typeAt: () => GRASS };
  const close = { near: 2, far: 5 };
  assert.equal(monsters.spawnNear(ground, player, 'skeleton', close), null, 'none by the fire');
  // 10.5 m away in any direction is 10.5 to 14.85 m along the ground's axes.
  const edge = { near: 10.5, far: 10.5 };
  for (let k = 0; k < 20; k++) assert.equal(monsters.spawnNear(ground, player, 'skeleton', edge), null, 'none in its last metre');
  assert.ok(monsters.spawnNear(ground, player, 'skeleton', { near: 15, far: 15 }), 'one just past its reach');
  assert.ok(monsters.spawnNear(ground, player, 'goblin', close), 'a goblin heeds no fire');
  const left = monsters.list.length;
  monsters.update(0.05, { isWalkable: () => true, typeAt: () => GRASS }, player, NOON);
  assert.equal(monsters.list.length, left, 'nothing goes at sunrise');
});
