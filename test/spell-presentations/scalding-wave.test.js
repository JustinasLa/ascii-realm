import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/scalding-wave.js';
import spell from '../../src/spells/definitions/scalding-wave.js';
import { paintPresentation } from '../../src/spells/presentation.js';
import { readFileSync } from 'node:fs';
import { playSpellSound } from '../../src/audio/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';
import { prepareRecordedSpellTest } from '../../test-support/spell-audio.js';
import { runeScene } from '../../test-support/spells.js';

const LIFE = { cast: presentation.duration, impact: 0.6, pulse: 0.4, aura: 1.5, zone: 3, projectile: 1 };
const BUDGET = { cast: 240, impact: 160, pulse: 90, aura: 110, zone: 160, projectile: 110 };
const draw = (stage, progress, { radius = stage === 'cast' ? 0.8 : 1, heading = 0 } = {}) => {
  const points = [];
  const effect = Object.freeze({ stage, progress, age: progress * LIFE[stage], life: LIFE[stage], radius, heading });
  presentation.draw(effect, (...point) => points.push(point));
  return points;
};
const lit = points => points.filter(p => p[4] > 0.05);
const isSteam = p => ':;'.includes(p[2]);
const distance = p => Math.hypot(p[0], p[1]);
// With heading 0, screen-up is local -z, so a lifted glyph sits at negative z
// relative to the ground directly below it.
const lip = points => lit(points).filter(p => '^~,.'.includes(p[2]) && p[3][1] > 240);
const foot = points => lit(points).filter(p => p[2] === '=');

test('Scalding Wave gathers a boiling pool, then rolls a crest across the TF cone', () => {
  assert.equal(spell.presentation, presentation);
  const windup = lit(draw('cast', 0.07));
  assert.ok(windup.length >= 15, 'wind-up pool is drawn');
  assert.ok(windup.every(p => distance(p) < 1.1), 'anticipation stays at the feet of the caster');
  assert.ok(windup.some(p => 'oO'.includes(p[2]) && p[3][0] > p[3][2]), 'warm boiling beads in the pool');

  const reach = progress => Math.max(...foot(draw('cast', progress)).map(distance));
  assert.ok(reach(0.3) < reach(0.5) && reach(0.5) < reach(0.75), 'the roller surges outwards');
  assert.ok(reach(0.5) - reach(0.3) > reach(0.75) - reach(0.5), 'and eases out as it spends itself');
  assert.ok(reach(0.75) > 3.3 && reach(0.75) < 4.4, 'it reaches the four-metre TF cone');

  const peak = draw('cast', 0.5);
  const angles = foot(peak).map(p => Math.atan2(p[0], p[1]));
  assert.ok(Math.min(...angles) < -0.9 && Math.max(...angles) > 0.9, 'crest spans the 120-degree cone');
  assert.ok(angles.every(a => Math.abs(a) < Math.PI / 3 + 0.05), 'and stays inside it');
  assert.ok(lip(peak).length >= 30, 'a dense, continuous foaming lip');
  const meanZ = points => points.reduce((sum, p) => sum + p[1], 0) / points.length;
  assert.ok(meanZ(lip(peak)) < meanZ(foot(peak)) - 0.1, 'the lip is lifted above the foot of the wave');
  assert.ok(peak.some(p => 'oO'.includes(p[2]) && p[3][0] === 255), 'yellow boiling beads ride the crest');
  const lipLight = lip(peak).reduce((s, p) => s + p[4], 0) / lip(peak).length;
  const wash = lit(peak).filter(p => p[2] === '.' && p[3][0] < 100);
  assert.ok(wash.length > 0 && wash.every(p => p[4] < lipLight), 'bright crest fades to a sparse backwash');

  const late = lit(draw('cast', 0.95));
  assert.ok(late.length < lit(peak).length * 0.75, 'the wave breaks and thins out');
  assert.ok(late.filter(p => ',.'.includes(p[2])).length > late.filter(p => p[2] === '^').length, 'into foam flecks');
  assert.ok(lit(draw('cast', 0.7)).filter(isSteam).length >= 6, 'steam boils off the wake');
});

test('Scalding Wave motion is smooth between frames', () => {
  for (let k = 0; k < 40; k++) {
    const p = 0.2 + k * 0.015;
    const a = draw('cast', p), b = draw('cast', p + 1 / 60 / presentation.duration);
    const front = points => Math.max(...foot(points).map(distance));
    assert.ok(Math.abs(front(a) - front(b)) < 0.2, `no jumps in the wave front at ${p}`);
  }
});

test('heights and steam rise up the screen whichever way the wave faces', () => {
  for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 3]) {
    const cells = [];
    paintPresentation(presentation, { x: 0, y: 0, stage: 'aura', age: 0.6, life: 1.5, radius: 1, heading },
      (x, y, char, color, light) => { if (light > 0.05) cells.push({ y, char }); });
    const steamY = cells.filter(c => ':;'.includes(c.char)), ground = cells.filter(c => '-'.includes(c.char));
    const mean = list => list.reduce((s, c) => s + c.y, 0) / list.length;
    assert.ok(steamY.length >= 4 && mean(steamY) < mean(ground) - 2, `steam climbs at heading ${heading}`);
  }
});

test('Scalding Wave impact slaps white-hot, throws a forward crown and vents steam', () => {
  const flash = draw('impact', 0.03);
  assert.ok(flash.some(p => p[2] === '@' && p[3].every(c => c > 240) && p[4] > 0.9), 'white-hot impact frame');
  assert.ok(!lit(draw('impact', 0.3)).some(p => p[2] === '@'), 'the flash is brief');
  const mid = lit(draw('impact', 0.25));
  const crown = mid.filter(p => "'o,".includes(p[2]));
  assert.ok(crown.length >= 16, 'a crown of droplets is airborne');
  assert.ok(crown.reduce((s, p) => s + p[1], 0) / crown.length > -0.6, 'pushed along the wave direction');
  assert.ok(lit(draw('impact', 0.5)).filter(isSteam).length >= 5, 'a steam column follows');
  const pulse = lit(draw('pulse', 0.4, { radius: 2 }));
  const sheet = pulse.filter(p => '~^'.includes(p[2]));
  assert.ok(sheet.length >= 8, 'the pulse flings a crescent sheet of water');
  assert.ok(sheet.reduce((s, p) => s + p[1], 0) / sheet.length > 0.8, 'forward across the cone');
  const aura = lit(draw('aura', 0.5));
  assert.ok(aura.some(p => 'oO*'.includes(p[2])) && aura.some(isSteam), 'burnt targets blister and steam');
  assert.ok(draw('projectile', 0.3).some(p => p[1] < -0.5), 'compact travelling crest has a wake');
});

test('all Scalding Wave stages are deterministic, bounded, evolving, and fade out', () => {
  for (const stage of ['cast', 'impact', 'pulse', 'aura', 'zone', 'projectile']) {
    for (const radius of [0.65, 1, 2]) {
      for (const progress of [0, 0.05, 0.25, 0.5, 0.7, 0.9, 1]) {
        const points = draw(stage, progress, { radius, heading: 0.7 });
        assert.ok(points.length <= BUDGET[stage], `${stage} stays within its plot budget (${points.length})`);
        if (progress > 0.2 && progress < 0.8) assert.ok(lit(points).length > 10, `${stage} is visible`);
        assert.deepEqual(points, draw(stage, progress, { radius, heading: 0.7 }));
        for (const [x, z, char, color, brightness] of points) {
          assert.ok([x, z, brightness, ...color].every(Number.isFinite));
          assert.ok(Math.abs(x) < 6 && Math.abs(z) < 6);
          assert.match(char, /^[ -~]$/);
          assert.ok(color.every(c => c >= 0 && c <= 255));
          assert.ok(brightness >= 0 && brightness <= 1);
          if (progress === 1) assert.equal(brightness, 0);
        }
      }
    }
    assert.notDeepEqual(draw(stage, 0.1), draw(stage, 0.6));
  }
});

test('Scalding Wave uses natural boiling and water recordings for every sound stage', async () => {
  const { cast, impact, pulse } = presentation.sounds;
  assert.ok(cast.some(v => v.url.endsWith('/boil.wav')), 'real boiling leads the cast');
  assert.ok(cast.some(v => v.url.endsWith('/water-lift.wav')), 'displaced water follows the boiling pool');
  assert.ok(impact.some(v => v.url.endsWith('/water-strike.wav')), 'real water impact');
  assert.ok(impact.some(v => v.url.endsWith('/bubbles.wav')), 'close bubbling follows the scald');
  assert.notDeepEqual(cast, impact);
  assert.ok(pulse.every(v => v.gain <= 0.15 && v.url.endsWith('/boil.wav')), 'repeated simmer stays quiet');
  assert.deepEqual(Object.keys(presentation.sounds).sort(), ['cast', 'impact', 'pulse']);
  for (const [stage, recipe] of Object.entries(presentation.sounds)) {
    assert.ok(recipe.length > 0 && recipe.length <= 3);
    assert.ok(recipe.reduce((total, voice) => total + voice.gain, 0) <= 1.2);
    for (const voice of recipe) {
      assert.equal(voice.kind, 'recording');
      assert.deepEqual(Object.keys(voice).sort(), ['delay', 'gain', 'kind', 'rate', 'url']);
      assert.match(voice.url, /^\/assets\/audio\/spells\/mitlan\/[a-z-]+\.wav$/);
      assert.ok(voice.gain >= 0.1 && voice.gain <= 0.8);
      assert.ok(voice.rate >= 0.75 && voice.rate <= 1.2);
      assert.ok(voice.delay >= 0 && voice.delay <= 2);
      const wav = readFileSync(new URL(`../../${voice.url.slice(1)}`, import.meta.url));
      assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
      assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
      assert.ok(wav.length > 10000, 'a recorded waveform is present');
    }
    const fake = fakeRecordedAudio();
    await prepareRecordedSpellTest(fake, presentation);
    const handles = playSpellSound(fake.engine, { stage, presentation, x: 2, y: 4 });
    assert.equal(handles.length, recipe.length);
    assert.ok(fake.routes.every(route => route.bus === 'sfx' && route.x === 2 && route.y === 4));
    assert.deepEqual(fake.invalid, []);
    for (const handle of handles) handle.stop();
    assert.ok(fake.routes.every(route => route.disposals === 1));
  }
});

test('real Scalding Wave cast uses authored profile and typed cues while retaining TF burn', () => {
  const scene = runeScene(spell), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  assert.equal(scene.castWithoutMana().ok, false, 'an empty mana pool rejects a duplicate cast');
  assert.equal(events.filter(e => e.stage === 'cast').length, 1);
  assert.ok(events.some(e => e.stage === 'impact'), 'burn aura emits impact steam release');
  assert.ok(events.every(e => e.type === 'spell' && e.presentation === presentation && e.spellId === spell.id));
  assert.ok(events.every(e => !['draw', 'slam'].includes(e.type)));
  assert.ok(scene.casting.effects.list.every(e => e.presentation === presentation));
  const rendered = [], expected = [];
  scene.casting.effects.paint((...p) => rendered.push(p), scene.casting.projectiles);
  for (const effect of scene.casting.effects.list) paintPresentation(presentation, effect, (...p) => expected.push(p));
  assert.deepEqual(rendered, expected, 'the real effects renderer consumes the authored geometry');
  assert.ok(rendered.some(p => p[2] === '~') && rendered.some(p => 'oO'.includes(p[2])), 'water sheet and boiling beads');
  scene.advance(4);
  assert.equal(scene.foe.health, 85, 'three original five-damage burn pulses');
});
