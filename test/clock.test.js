import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DAY_SECONDS, MOON_BRIGHTNESS, NIGHT_SHARE, NIGHT_SKY, START_TICK, WorldClock, celestial, clockOptions,
  daylightAt, fractionAt, parseTime, skyAt, starlightAt, tickAt } from '../src/world/clock.js';
import { GRADE_NIGHT } from '../src/render/palette.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const params = (query) => new URLSearchParams(query);

test('daylight and starlight follow the sky-darkening and star curves', () => {
  for (let tick = 1000; tick <= 11000; tick += 500) {
    assert.equal(daylightAt(tick), 1, `day at ${tick}`);
    assert.equal(starlightAt(tick), 0, `no stars at ${tick}`);
  }
  for (let tick = 14000; tick <= 22000; tick += 500) {
    assert.equal(daylightAt(tick), 0, `night at ${tick}`);
    assert.equal(starlightAt(tick), 1, `full stars at ${tick}`);
  }
  assert.ok(near(daylightAt(13000), 0.379, 1e-3));
  assert.ok(near(daylightAt(23000), 0.379, 1e-3));
  assert.ok(near(celestial(6000), 0) && near(celestial(18000), 0.5));
});

test('the night half takes its share of the real day, and the warp round-trips', () => {
  for (let f = 0; f < 1; f += 0.013) assert.ok(near(fractionAt(tickAt(f)), f), `f ${f}`);
  assert.ok(near(fractionAt(24000 + 6000), fractionAt(6000)));
  assert.ok(near(fractionAt(-6000), fractionAt(18000)));
  assert.ok(near(fractionAt(12000), 1 - NIGHT_SHARE));
  assert.equal(tickAt(1 - NIGHT_SHARE), 12000);
  const clock = new WorldClock({ dayLength: 120, start: 3000 });
  for (let i = 0; i < 120 * 60; i++) clock.advance(1 / 60);
  assert.ok(near(clock.tick, 3000, 1e-6));
  assert.equal(clock.day, 1);
  // Ticks 12000 to 24000 take 60 % of the 120 s.
  const night = new WorldClock({ dayLength: 120, start: 12000 });
  night.advance(120 * NIGHT_SHARE - 1e-6);
  assert.ok(night.tick > 23999 && night.day === 0);
});

test('a new day and moon phase start at sunrise, in order from full', () => {
  const clock = new WorldClock({ dayLength: 100, start: 23000, moon: 6 });
  assert.equal(clock.phase, 6);
  clock.advance(fractionAt(23999.9) * 100 - fractionAt(23000) * 100);
  assert.equal(clock.day, 0);
  clock.advance(0.01);
  assert.equal(clock.day, 1);
  assert.ok(clock.tick < 10);
  assert.equal(clock.phase, 7);
  clock.advance(100);
  assert.equal(clock.phase, 0);
  // A long step crosses several days at once.
  clock.advance(350);
  assert.equal(clock.day, 5);
  const phases = [];
  for (let day = 0; day < 8; day++) phases.push(skyAt(18000, day, day).moonBrightness);
  assert.deepEqual(phases, MOON_BRIGHTNESS);
});

test('times are read as ticks, names or clock times', () => {
  assert.equal(parseTime('0'), 0);
  assert.equal(parseTime('23999'), 23999);
  assert.equal(parseTime('noon'), 6000);
  assert.equal(parseTime(' Midnight '), 18000);
  assert.equal(parseTime('dawn'), 23200);
  assert.equal(parseTime('06:00'), 0);
  assert.equal(parseTime('18:00'), 12000);
  assert.equal(parseTime('00:00'), 18000);
  assert.equal(parseTime('7:30'), 1500);
  for (const junk of [null, undefined, '', '24000', '-5', '12.5', '25:00', '10:60', 'teatime', 'toString']) {
    assert.equal(parseTime(junk), null, String(junk));
  }
});

test('the URL sets the clock, within limits, except in a lobby', () => {
  assert.deepEqual(clockOptions(params('')), { dayLength: DAY_SECONDS, start: START_TICK, moon: 0, cycle: true });
  assert.deepEqual(clockOptions(params('daylen=120&time=noon&moon=3&daycycle=0')),
    { dayLength: 120, start: 6000, moon: 3, cycle: false });
  assert.equal(clockOptions(params('daylen=1')).dayLength, 20);
  assert.equal(clockOptions(params('daylen=1e9')).dayLength, 86400);
  for (const bad of ['daylen=', 'daylen=-5', 'daylen=soon']) assert.equal(clockOptions(params(bad)).dayLength, DAY_SECONDS);
  assert.equal(clockOptions(params('time=whenever')).start, START_TICK);
  for (const bad of ['moon=8', 'moon=-1', 'moon=2.5']) assert.equal(clockOptions(params(bad)).moon, 0);
  assert.deepEqual(clockOptions(params('daylen=120&time=noon&moon=3&daycycle=0'), { inLobby: true }),
    { dayLength: DAY_SECONDS, start: START_TICK, moon: 0, cycle: true });
});

test('a held or still clock does not move, and set() jumps', () => {
  const clock = new WorldClock();
  assert.ok(near(clock.tick, START_TICK, 1e-6));
  clock.advance(0);
  clock.advance(-1);
  clock.advance(NaN);
  assert.ok(near(clock.tick, START_TICK, 1e-6));
  clock.hold(true);
  clock.advance(60);
  assert.ok(near(clock.tick, START_TICK, 1e-6));
  clock.hold(false);
  clock.advance(60);
  assert.ok(clock.tick > START_TICK);
  const still = new WorldClock({ cycle: false, start: 6000 });
  still.advance(600);
  assert.ok(near(still.tick, 6000, 1e-6));
  still.set('dusk');
  assert.ok(near(still.tick, 12800, 1e-6));
  still.set(1000);
  assert.ok(near(still.tick, 1000, 1e-6));
  still.set('nonsense');
  still.set(Infinity);
  assert.ok(near(still.tick, 1000, 1e-6));
});

test('a lobby shares one clock from the wall clock, ignoring the play gate and honouring holds', () => {
  const now = 1_790_000_000_000;
  const a = new WorldClock({ dayLength: 60, start: 6000, moon: 5 });
  const b = new WorldClock();
  a.share(now);
  b.share(now);
  assert.equal(a.tick, b.tick);
  assert.equal(a.day, b.day);
  assert.equal(a.phase, b.phase);
  assert.equal(a.phase, a.day % 8, 'no ?moon= offset in a lobby');
  const later = new WorldClock();
  later.share(now + 15000);
  assert.ok(near(later.f - b.f, 15 / DAY_SECONDS, 1e-9));
  // The gate's zero step does not stop shared time.
  a.advance(0, now + 60000);
  assert.ok(near(a.f - b.f, 60 / DAY_SECONDS, 1e-9));
  // A frozen debug frame holds it, and letting go jumps back to lobby time.
  a.hold(true);
  const held = a.tick;
  a.advance(1 / 60, now + 120000);
  assert.equal(a.tick, held);
  a.hold(false);
  a.advance(1 / 60, now + 120000);
  const fresh = new WorldClock();
  fresh.share(now + 120000);
  assert.equal(a.tick, fresh.tick);
  // Leaving carries on from there, solo, at the player's own day length.
  a.unshare();
  const left = a.tick;
  a.advance(1);
  assert.ok(a.tick > left);
  assert.equal(a.phase, (a.day + 5) % 8);
});

test('the sky state: night is the identity grade, the moon and sun never meet, no allocation', () => {
  const night = skyAt(18000, 0, 0);
  assert.deepEqual(night.grade, { gain: [1, 1, 1], sat: 1, edge: GRADE_NIGHT.edge.map((v) => +(v / 255).toFixed(4)),
    vignette: GRADE_NIGHT.vignette });
  assert.equal(night.stars, 1);
  assert.equal(night.moon, 1);
  assert.equal(night.sun, 0);
  assert.equal(night.moonLit, 1);
  assert.deepEqual(skyAt(START_TICK, 0, 0).grade, night.grade, 'a fresh world starts in that night');
  assert.ok(Object.isFrozen(NIGHT_SKY) && Object.isFrozen(NIGHT_SKY.grade.gain));
  assert.deepEqual({ ...NIGHT_SKY, moonPhase: { ...NIGHT_SKY.moonPhase } }, { ...night, moonPhase: { ...night.moonPhase } });
  for (let tick = 0; tick < 24000; tick += 25) {
    const s = skyAt(tick, 0, 0);
    assert.ok(!(s.moon > 0 && s.sun > 0), `moon and sun at ${tick}`);
    assert.equal(s.dawn, tick >= 18000 || tick < 6000);
    assert.ok(s.grade.gain.every((g) => g >= 1) && s.grade.vignette > 0);
  }
  assert.equal(skyAt(6000, 0, 0).warm, 0);
  assert.equal(skyAt(18000, 0, 0).warm, 0);
  const noon = skyAt(6000, 0, 0);
  assert.equal(noon.sun, 1);
  assert.equal(noon.moon, 0);
  assert.ok(noon.grade.gain[0] > 2);
  assert.ok(skyAt(12800, 0, 0).warm > 0.9 && !skyAt(12800, 0, 0).dawn);
  assert.ok(skyAt(23200, 0, 0).dawn);
  const quarter = skyAt(18000, 2, 2).moonPhase;
  assert.ok(near(quarter.cos, 0) && near(quarter.sin, 1) && !quarter.waxing);
  assert.ok(skyAt(18000, 6, 6).moonPhase.waxing);
  assert.ok(near(skyAt(18000, 4, 4).moonLit, 0));
  const clock = new WorldClock({ start: 12800 });
  const first = clock.sky();
  clock.advance(10);
  assert.equal(clock.sky(), first);
  assert.equal(first.grade, clock.state.grade);
  assert.ok(near(first.tick, clock.tick));
});
