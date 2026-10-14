import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextSoundVariant, seededRandom, ShuffleBag, soundVariantBank,
  SOUND_VARIANT_COUNT, varySound } from '../src/audio/variations.js';
import { SEASONS, SEASON_LENGTH, seasonAt, weatherMood, climateAmbience } from '../src/audio/climate.js';

test('every cue visits 25 distinct recipes before repeating, including deck boundaries', () => {
  const engine = {};
  const random = seededRandom(42);
  for (const key of ['step:dirt', 'sword:swing', 'ambience:bird', 'weather:rain:event:0', 'fire:crackle']) {
    const ids = Array.from({ length: 100 }, () => nextSoundVariant(engine, key, random).id);
    for (let start = 0; start < ids.length; start += SOUND_VARIANT_COUNT) {
      assert.equal(new Set(ids.slice(start, start + SOUND_VARIANT_COUNT)).size, SOUND_VARIANT_COUNT);
    }
    assert.ok(ids.every((id, index) => index === 0 || id !== ids[index - 1]));
    assert.notDeepEqual(ids.slice(0, 25), ids.slice(25, 50), 'fresh decks reshuffle');
  }
});

test('cue decks are independent for separate cues and engines, even with broken randomness', () => {
  const a = {};
  const b = {};
  const drawA = () => nextSoundVariant(a, 'step:dirt', () => 0.5).id;
  const drawB = () => nextSoundVariant(b, 'step:dirt', () => 0.5).id;
  assert.equal(drawA(), drawB());
  for (let index = 0; index < 30; index++) nextSoundVariant(a, 'sword:swing');
  assert.equal(drawA(), drawB());
  for (const random of [() => NaN, () => Infinity, () => -50, () => 50, () => { throw new Error(); }]) {
    const bag = new ShuffleBag([0, 1, 2], random);
    const values = Array.from({ length: 9 }, () => bag.next());
    assert.ok(values.every(value => [0, 1, 2].includes(value)));
    assert.ok(values.every((value, index) => index === 0 || value !== values[index - 1]));
  }
});

test('recipes change texture, timing, envelope and grain while retaining routing and loudness bounds', () => {
  const options = { bus: 'sword', x: 3, y: 4, when: 10, duration: 0.2,
    attack: 0.01, decay: 0.04, sustain: 0.12, release: 0.08, cutoff: 850, gain: 0.05 };
  const bank = soundVariantBank('sword:swing');
  assert.ok(Object.isFrozen(bank) && bank.every(Object.isFrozen));
  const rendered = bank.map(variant => varySound(variant, options));
  assert.equal(new Set(rendered.map(value => JSON.stringify(value))).size, 25);
  for (const result of rendered) {
    assert.equal(result.bus, 'sword');
    assert.equal(result.x, 3);
    assert.equal(result.y, 4);
    assert.equal(result.when, 10, 'absolute audio clock stays unchanged');
    assert.ok(result.gain > 0 && result.gain <= options.gain);
    assert.ok(Object.values(result).filter(value => typeof value === 'number').every(Number.isFinite));
    assert.ok(result.offset > 0 && result.offset < 1);
  }
  assert.notDeepEqual(varySound(bank[0], options, 0), varySound(bank[0], options, 1));
  assert.equal(varySound(bank[0], null), null);
  assert.deepEqual(options, { bus: 'sword', x: 3, y: 4, when: 10, duration: 0.2,
    attack: 0.01, decay: 0.04, sustain: 0.12, release: 0.08, cutoff: 850, gain: 0.05 });
});

test('audio seasons follow simulation time and weather moods cover all preset families', () => {
  for (const [index, season] of SEASONS.entries()) {
    assert.equal(seasonAt(index * SEASON_LENGTH), season);
    assert.equal(seasonAt((index + 1) * SEASON_LENGTH - 0.01), season);
    assert.equal(seasonAt(index * SEASON_LENGTH + SEASON_LENGTH * 4), season);
  }
  for (const value of [NaN, Infinity, -100, undefined]) assert.equal(seasonAt(value), 'spring');
  for (const [mood, presets] of Object.entries({ rain: ['rain', 'drizzle', 'heavy-rain'],
    storm: ['thunderstorm', 'distant-thunder', 'hail', 'ocean-storm', 'forest-squall'],
    snow: ['light-snow', 'snowstorm', 'blizzard', 'sleet', 'ice-storm'],
    wind: ['wind-gusts', 'gale', 'sandstorm'], fog: ['fog'] })) {
    for (const preset of presets) {
      assert.equal(weatherMood(preset, 0.6), mood);
      assert.equal(weatherMood(preset, 0), 'clear');
    }
  }
  assert.equal(weatherMood('unknown'), 'clear');
});

test('winter quiets insects and frogs, autumn strengthens leaves, and storms shelter wildlife', () => {
  const winter = climateAmbience('winter');
  const spring = climateAmbience('spring');
  assert.equal(winter.insects, 0);
  assert.equal(winter.frogs, 0);
  assert.ok(winter.birds < spring.birds);
  assert.ok(climateAmbience('autumn').leaves > spring.leaves);
  const storm = climateAmbience('spring', 'thunderstorm', 1);
  assert.ok(storm.birds < spring.birds && storm.insects < spring.insects);
  assert.deepEqual(climateAmbience('spring', 'thunderstorm', 0), spring);
});
