import assert from 'node:assert/strict';
import test from 'node:test';
import profile from '../../src/spells/presentations/temp-summon-phoenix.js';
import spell from '../../src/spells/definitions/temp-summon-phoenix.js';
import { runeScene } from '../../test-support/spells.js';

const STAGES = ['cast', 'impact', 'pulse', 'aura', 'zone', 'projectile'];
// Lives the game actually uses: the cast flash, TF's 10 s projectile (md 200),
// the 0.25 s burn visual, the 1.5 s aura refresh and the 3 s burning totem.
const LIFE = { cast: profile.duration, impact: profile.duration, pulse: 0.25, aura: 1.5, zone: 3, projectile: 10 };
const BUDGET = { cast: 160, impact: 245, pulse: 90, aura: 60, zone: 40, projectile: 110 };

function points(stage, progress = 0.4, { age = progress * LIFE[stage], heading = 0, radius = 2 } = {}) {
  const result = [];
  profile.draw(Object.freeze({ stage, progress, age, life: LIFE[stage], radius, heading, x: 12, y: 30 }),
    (x, z, char, color, brightness) => result.push({ x, z, char, color, brightness }));
  return result;
}
// The projectile clock is its travel age; TF slows it for 1.25 s, then dives.
const flight = (age, heading = 0) => points('projectile', age / LIFE.projectile, { age, heading });
const lit = list => list.filter(p => p.brightness > 0.05);
const extentX = list => Math.max(...lit(list).map(p => Math.abs(p.x)));
const meanRadius = list => list.reduce((sum, p) => sum + Math.hypot(p.x, p.z), 0) / list.length;

test('Fire Phoenix opts into its bird presentation without changing rune costs or source identity', () => {
  assert.equal(spell.presentation, profile);
  assert.equal(profile.id, spell.id);
  assert.equal(spell.name, 'Fire Phoneix');
  assert.deepEqual(spell.variants[0].params, { cooldown: 15, mana: 6, damage: 15, duration: 3 });
  assert.equal(spell.source.sha256, 'ec0ccba909eda1abd6b943f87d4d185cf742744933ad399198df367b999656c7');
});

test('a real Phoenix cast lights the pyre, flies the bird, burns its path and bursts on impact', () => {
  const scene = runeScene(spell, { range: 6 });
  const cues = [];
  scene.casting.onSound = cue => cues.push(cue);
  assert.equal(scene.cast().ok, true);
  const castCue = cues.find(cue => cue.type === 'spell' && cue.stage === 'cast');
  assert.ok(castCue);
  assert.equal(castCue.spellId, spell.id);
  assert.equal(castCue.presentation, profile);
  assert.ok(!cues.some(cue => cue.type === 'draw'));
  const castEffect = scene.casting.effects.list.find(effect => effect.stage === 'cast');
  assert.equal(castEffect.presentation, profile);
  assert.equal(castEffect.life, profile.duration);
  scene.advance(0.5);
  const painted = [];
  scene.casting.effects.paint((x, z, char) => painted.push({ x, z, char }), scene.casting.projectiles);
  assert.ok(painted.some(point => point.char === 'o'), 'the travelling projectile paints the bird head');
  scene.advance(1.2);
  assert.ok(scene.casting.effects.list.some(effect => effect.stage === 'zone' && effect.presentation === profile),
    'after the dive the totems leave burning ground with the Phoenix profile');
  scene.advance(1.4);
  assert.ok(cues.some(cue => cue.type === 'spell' && cue.stage === 'impact' && cue.presentation === profile && cue.y > 0),
    'the travelling Phoenix keeps its profile on impact');
});

test('cast gathers motes into a pyre, ignites with a white flash, then raises a flame pillar and cinders', () => {
  const early = lit(points('cast', 0.06)), gathered = lit(points('cast', 0.2));
  const motes = list => list.filter(p => ['.', ':', '*'].includes(p.char) && Math.hypot(p.x, p.z) > 0.2);
  assert.ok(meanRadius(motes(gathered)) < meanRadius(motes(early)) * 0.8, 'anticipation motes spiral inward');
  assert.ok(!early.some(p => p.char === '^'), 'no flame before ignition');
  const ignition = lit(points('cast', 0.25));
  assert.ok(ignition.some(p => p.char === '@' && p.color[2] > 180 && p.brightness > 0.5), 'white-hot ignition flash');
  const burning = lit(points('cast', 0.42));
  const top = Math.min(...burning.filter(p => p.char === '^').map(p => p.z));
  assert.ok(top < -1.5, 'flame tongues climb well above the pyre (up is -z on screen)');
  const ring = list => list.filter(p => p.char === '~' || p.char === '=');
  assert.ok(meanRadius(ring(points('cast', 0.45))) > meanRadius(ring(points('cast', 0.3))), 'shock ring races outward');
  const whiteHot = progress => points('cast', progress).filter(p => p.color[2] > 180)
    .reduce((sum, p) => sum + p.brightness, 0);
  assert.ok(whiteHot(0.6) < whiteHot(0.25) * 0.5, 'the ignition flash has cooled by follow-through');
});

test('the projectile is a phoenix that unfurls, beats its wings, then sweeps back into a streaming dive', () => {
  for (const age of [0.6, 2]) {
    const bird = flight(age);
    const head = bird.find(p => p.char === 'o');
    assert.ok(head && head.z > 0.2, `${age}: head leads along +z`);
    assert.ok(bird.some(p => p.char === 'v' && p.z > head.z), `${age}: beak ahead of the head`);
    const wings = lit(bird).filter(p => ['/', '\\', '-'].includes(p.char) && Math.abs(p.x) > 0.4);
    assert.ok(wings.some(p => p.x < 0) && wings.some(p => p.x > 0), `${age}: two wings`);
    for (const left of wings.filter(p => p.x < 0)) {
      const mirror = { '/': '\\', '\\': '/', '-': '-' }[left.char];
      assert.ok(wings.some(p => Math.abs(p.x + left.x) < 1e-9 && Math.abs(p.z - left.z) < 1e-9 && p.char === mirror),
        `${age}: wings mirror each other`);
    }
  }
  assert.ok(extentX(flight(0.03)) < extentX(flight(0.6)) * 0.6, 'wings unfurl as the bird is born');
  const xs = list => list.filter(p => p.char === '*').map(p => p.z).join();
  assert.notEqual(xs(flight(0.6)), xs(flight(0.7)), 'wings beat over time');
  const hover = flight(0.8), dive = flight(2);
  assert.ok(extentX(dive) < extentX(hover), 'wings fold back for the dive');
  const behind = list => lit(list).filter(p => p.z < -2).length;
  assert.ok(behind(dive) > behind(hover) + 6, 'a flame streamer trails the diving bird');
  const beak = heading => flight(0.6, heading).find(p => '<>^v'.includes(p.char) && p.brightness > 0.9).char;
  assert.deepEqual([0, Math.PI / 2, Math.PI, -Math.PI / 2].map(beak), ['v', '>', '^', '<'],
    'beak and feather strokes follow the on-screen flight direction');
});

test('impact flashes white, tears the bird into feathers and leaves a dimming rebirth ember', () => {
  const flash = lit(points('impact', 0.02));
  assert.ok(flash.some(p => p.char === '@' && p.color.every(c => c > 200) && p.brightness > 0.9), 'white impact frame');
  assert.ok(flash.some(p => p.char === 'o'), 'the bird is still whole at the moment of impact');
  const bird = list => list.filter(p => p.char === 'o' || p.char === "'");
  assert.ok(meanRadius(bird(points('impact', 0.3))) > meanRadius(bird(points('impact', 0.05))) * 1.3,
    'feathers fly outward as the bird bursts');
  assert.ok(!lit(points('impact', 0.6)).some(p => p.char === 'o'), 'the burst bird has fully scattered');
  const late = lit(points('impact', 0.7));
  assert.ok(late.some(p => p.char === 'O') && late.some(p => p.char === '(') && late.some(p => p.char === ')'),
    'a small rebirth ember remains');
  assert.ok(late.length < lit(points('impact', 0.25)).length / 2, 'the burst thins out into follow-through');
  const ember = progress => points('impact', progress).find(p => p.char === 'O').brightness;
  assert.ok(ember(0.95) < ember(0.75), 'the ember cools before the end');
});

test('burn ticks, burning ground and the guardian aura stay lean flame shapes', () => {
  const burst = lit(points('pulse', 0.1, { radius: 1 }));
  assert.ok(burst.some(p => p.char === '@') && burst.some(p => p.char === '^'), 'burn tick flares then licks up');
  assert.ok(!lit(points('pulse', 0.6, { radius: 1 })).some(p => p.char === '@'), 'flare core is brief');
  const ground = lit(points('zone', 0.3));
  assert.equal(ground.filter(p => p.char === '^').length, 3, 'three flame tongues on each burning patch');
  assert.ok(Math.max(...ground.map(p => Math.hypot(p.x, p.z))) < 1.2, 'patches stay compact along the flight path');
  assert.notDeepEqual(points('zone', 0.3).map(({ x, z, char }) => ({ x, z, char })), (() => {
    const other = [];
    profile.draw({ stage: 'zone', progress: 0.3, age: 0.9, life: 3, radius: 2, heading: 0, x: 40, y: 7 },
      (x, z, char) => other.push({ x, z, char }));
    return other;
  })(), 'neighbouring totems place their flames differently');
  const aura = lit(points('aura', 0.5, { radius: 1 }));
  assert.ok(aura.filter(p => p.char === '*').length >= 3, 'orbiting wisp heads');
  assert.ok(aura.length <= 40, 'aura stays light: it is refreshed every second');
  const wisps = (age) => points('aura', 0.5, { radius: 1, age }).filter(p => p.char === '*').map(p => p.x).join();
  assert.notEqual(wisps(0.7), wisps(0.8), 'wisps orbit over time');
});

test('all stages obey the draw budget and fade to silence at the end of their life', () => {
  for (const stage of STAGES) {
    for (let i = 0; i <= 40; i++) {
      const progress = i / 40;
      const plotted = points(stage, progress);
      assert.ok(plotted.length <= BUDGET[stage], `${stage} at ${progress}: ${plotted.length} glyphs`);
      for (const point of plotted) {
        assert.ok(Number.isFinite(point.x) && Number.isFinite(point.z));
        assert.ok(Math.hypot(point.x, point.z) < 12);
        assert.match(point.char, /^[\x20-\x7e]$/);
        assert.equal(point.color.length, 3);
        assert.ok(point.color.every(c => Number.isInteger(c) && c >= 0 && c <= 255));
        assert.ok(Number.isFinite(point.brightness) && point.brightness >= 0 && point.brightness <= 1);
      }
    }
    const peak = list => Math.max(0, ...list.map(p => p.brightness));
    assert.ok(peak(points(stage, 0.99)) < peak(points(stage, 0.5)) * 0.1, `${stage} dims at the end`);
    assert.deepEqual(points(stage, 1), [], `${stage} is silent at progress 1`);
    assert.deepEqual(points(stage, 0.4), points(stage, 0.4), 'no random geometry');
  }
  for (let age = 0; age <= 3.2; age += 0.05) {
    assert.ok(flight(age).length <= BUDGET.projectile, `projectile at ${age.toFixed(2)} s`);
    assert.ok(Math.max(...flight(age).map(p => p.brightness)) > 0.9, 'the flying bird stays fully lit');
  }
});

test('motion is continuous between 60 fps frames instead of jumping', () => {
  for (const [stage, from, to] of [['cast', 0.3, 0.9], ['impact', 0.05, 0.6]]) {
    for (let progress = from; progress < to; progress += 0.05) {
      const a = points(stage, progress), b = points(stage, progress + 1 / 60 / LIFE[stage]);
      if (a.length !== b.length) continue;
      const moved = a.map((p, i) => Math.hypot(p.x - b[i].x, p.z - b[i].z)).sort((x, y) => x - y);
      assert.ok(moved[Math.floor(moved.length * 0.9)] < 0.35, `${stage} at ${progress.toFixed(2)} moves smoothly`);
    }
  }
  for (let age = 0.1; age < 3; age += 0.1) {
    const a = flight(age), b = flight(age + 1 / 60);
    if (a.length !== b.length) continue;
    const moved = a.map((p, i) => Math.hypot(p.x - b[i].x, p.z - b[i].z)).sort((x, y) => x - y);
    assert.ok(moved[Math.floor(moved.length * 0.9)] < 0.35, `projectile at ${age.toFixed(2)} s moves smoothly`);
  }
});

test('Phoenix unfolds dark cloth wings, pulses on rebirth and leaves a soft resonance', () => {
  const uses = (stage, file) => profile.sounds[stage].filter(v => v.url.endsWith('/' + file + '.wav'));
  const wings = uses('cast', 'wing-sweep');
  assert.equal(wings.length, 2, 'two physical wingbeats lift the Phoenix');
  assert.ok(wings[1].delay - wings[0].delay >= 0.4, 'wingbeats have a deliberate slow cadence');
  assert.equal(uses('cast', 'dark-swell').length, 1, 'a brief swell supports the wings');
  const rebirth = uses('impact', 'pressure');
  assert.equal(rebirth.length, 1);
  assert.equal(rebirth[0].delay, 0, 'rebirth catches at the collision');
  assert.equal(uses('impact', 'wing-sweep').length, 1);
  assert.ok(uses('impact', 'wing-sweep')[0].delay > rebirth[0].delay, 'wings follow the rebirth impulse');
  assert.notDeepEqual(profile.sounds.impact, profile.sounds.cast);
  assert.equal(profile.sounds.pulse.length, 1, 'frequent burn ticks use one small recording');
  assert.equal(uses('pulse', 'soft-return').length, 1);
  assert.ok(profile.sounds.pulse[0].gain <= 0.08, 'repeating resonance stays quiet');
  for (const event of Object.values(profile.sounds)) {
    assert.ok(event.length > 0 && event.length <= 4);
    assert.ok(event.reduce((sum, voice) => sum + voice.gain, 0) <= 0.75);
    for (const voice of event) {
      assert.deepEqual(Object.keys(voice).sort(), ['delay', 'gain', 'kind', 'rate', 'url']);
      assert.equal(voice.kind, 'recording');
      assert.match(voice.url, /^\/assets\/audio\/spells\/oseni\/[a-z-]+\.wav$/);
      assert.ok(voice.gain >= 0.04 && voice.gain <= 0.35);
      assert.ok(voice.delay >= 0 && voice.delay <= 2);
      assert.ok(voice.rate >= 0.75 && voice.rate <= 1.2);
    }
  }
});
