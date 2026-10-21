import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/temp-shock-wave.js';
import spell from '../../src/spells/definitions/temp-shock-wave.js';
import { runeScene } from '../../test-support/spells.js';
import { paintPresentation } from '../../src/spells/presentation.js';
import { playSpellSound } from '../../src/audio/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';

function draw(stage, progress, { heading = 0, radius = 1, life = presentation.duration } = {}) {
  const points = [];
  presentation.draw({ stage, progress, age: progress * life, life, radius, heading }, (...point) => points.push(point));
  return points;
}

// Screen cells through the shared adapter, relative to the effect origin.
function screen(stage, progress, heading = 0) {
  const cells = [];
  paintPresentation(presentation, { x: 0, y: 0, stage, age: progress * presentation.duration,
    life: presentation.duration, radius: 1, heading }, (...cell) => cells.push(cell));
  return cells;
}

const AT = 0.545, CENTER = 0.95;
const fromAnvil = ([x, z]) => Math.hypot(x, z - CENTER);
const lit = points => points.filter(p => (p[4] ?? 1) > 0.05);

test('Woodland Anvil grows from gathering roots, then a lifted mallet slams onto the horned anvil', () => {
  assert.equal(spell.presentation, presentation);
  const gathering = lit(draw('cast', 0.1)), formed = lit(draw('cast', 0.42));
  assert.ok(gathering.filter(p => fromAnvil(p) > 1.5).length >= 12, 'roots start wide around the anvil site');
  assert.ok(!formed.some(p => fromAnvil(p) > 1.8 && p[1] > 0), 'roots have been drawn into the anvil before the strike');
  assert.ok(formed.some(p => p[1] > 1.75 && Math.abs(p[0]) < 0.15), 'a horn projects forward from the working face');
  assert.ok(formed.some(p => p[0] < -0.3) && formed.some(p => p[0] > 0.3), 'the anvil body has both flanks');
  // The mallet ('#' cheeks) is held high during the wind-up and lands on the face at contact.
  const cheeks = points => points.filter(p => p[2] === '#');
  assert.ok(cheeks(formed).length >= 2 && cheeks(formed).every(p => p[1] < 0.2), 'mallet is lifted toward the top of the screen');
  const landing = cheeks(lit(draw('cast', AT - 0.005)));
  assert.ok(landing.length >= 2 && landing.every(p => p[1] > 0.7), 'mallet comes down onto the anvil');
  assert.ok(!formed.some(p => p[2] === '@'), 'no flash before contact');
  const contact = lit(draw('cast', AT + 0.02));
  assert.ok(contact.some(p => p[2] === '@' && p[3][0] > 250 && p[3][2] > 200), 'contact throws a white flash');
  const reach = progress => Math.max(...lit(draw('cast', progress)).filter(p => p[1] > -0.5).map(fromAnvil));
  assert.ok(reach(0.62) < reach(0.8), 'the shockwave ring and fissures roll outward after the blow');
  const glow = progress => draw('cast', progress).reduce((sum, p) => sum + (p[4] ?? 1), 0);
  assert.ok(glow(0.97) < glow(0.75) * 0.5, 'the cast thins out before it ends');
});

test('airborne parts lift toward the top of the screen for every heading', () => {
  for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 3]) {
    const cells = screen('cast', 0.42, heading).filter(c => c[2] === '#');
    assert.ok(cells.length >= 2 && cells.every(c => c[1] < 0), `mallet rises above the caster at heading ${heading.toFixed(2)}`);
  }
  assert.deepEqual(draw('cast', 0.3, { heading: 1 }), draw('cast', 0.3, { heading: 1 }), 'drawing is a pure function of the effect');
});

test('projectile rides a cresting earth wave over a cooling fissure that sprouts grass', () => {
  const travel = age => draw('projectile', age, { life: 1 });
  const early = lit(travel(0.05)), late = lit(travel(0.6));
  assert.ok(late.filter(p => p[1] > -0.25 && Math.abs(p[0]) > 0.6).length >= 4, 'a wide crest leads the wave');
  const crest = late.filter(p => p[1] > -0.25);
  assert.ok(Math.max(...crest.filter(p => Math.abs(p[0]) < 0.2).map(p => p[1]))
    > Math.max(...crest.filter(p => Math.abs(p[0]) > 0.8).map(p => p[1])), 'the crest bows forward in the middle');
  assert.ok(late.some(p => p[2] === 'o' && Math.abs(p[0]) < 0.3), 'the anvil echo rides the crest');
  const wake = points => points.filter(p => p[1] < -1).length;
  assert.ok(wake(early) < wake(late), 'the fissure wake lengthens as the wave travels');
  assert.ok(late.some(p => p[2] === '"' && p[1] < -0.8), 'grass springs up in the fissure behind the wave');
});

test('impact stamps a flashing anvil imprint, splits the ground, and lifts debris and leaves', () => {
  const start = lit(draw('impact', 0.02)), mid = lit(draw('impact', 0.5));
  assert.ok(start.some(p => p[2] === '@' && p[3][0] > 250), 'impact opens on a white flash');
  assert.ok(!mid.some(p => p[2] === '@'), 'the flash is brief');
  const reach = points => Math.max(...points.map(p => Math.hypot(p[0], p[1])));
  assert.ok(reach(start) < reach(mid), 'shock ring and fissures spread from the foe');
  assert.ok(mid.some(p => [',', '\''].includes(p[2]) && p[3][1] > 190), 'shaken leaves drift around the hit');
  assert.ok(mid.some(p => ['o', '+', '#', '%'].includes(p[2])), 'clods of earth are thrown up');
  assert.notDeepEqual(draw('impact', 0.1), draw('cast', 0.1));
});

test('pulse cracks open and grass sprouts in the fresh fissures', () => {
  const early = lit(draw('pulse', 0.05, { radius: 2 })), late = lit(draw('pulse', 0.6, { radius: 2 }));
  assert.ok(!early.some(p => p[2] === '"'), 'no grass at the instant the ground splits');
  assert.ok(late.some(p => p[2] === '"'), 'grass grows into the cracks');
  const reach = points => Math.max(...points.map(p => Math.hypot(p[0], p[1])));
  assert.ok(reach(late) > reach(early), 'cracks run outward');
});

test('all stages remain finite, bounded, ASCII, deterministic, and fade completely', () => {
  const budget = { cast: 240, impact: 215, projectile: 110, pulse: 90, aura: 160, zone: 160 };
  for (const stage of Object.keys(budget)) {
    for (const radius of [1, 2, 3]) for (let i = 0; i <= 40; i++) {
      const progress = i / 40, points = draw(stage, progress, { radius });
      assert.ok(points.length > 0 && points.length <= budget[stage], `${stage} fits its draw budget (${points.length})`);
      for (const [x, z, char, color, brightness = 1] of points) {
        assert.ok([x, z, brightness, ...color].every(Number.isFinite));
        assert.ok(Math.abs(x) < 8 && Math.abs(z) < 8);
        assert.match(char, /^[ -~]$/);
        assert.equal(color.length, 3);
        assert.ok(color.every(value => value >= 0 && value <= 255));
        assert.ok(brightness >= 0 && brightness <= 1);
        if (progress === 1) assert.equal(brightness, 0, `${stage} fades completely`);
      }
    }
    assert.deepEqual(draw(stage, 0.35), draw(stage, 0.35));
    assert.notDeepEqual(draw(stage, 0.1), draw(stage, 0.95), `${stage} evolves with time`);
  }
});

test('glyph budgets hold for every heading, progress, and effect life the game uses', () => {
  // Line glyph counts follow on-screen length, so they depend on the cast heading.
  const budget = { cast: 240, impact: 215, projectile: 110, pulse: 90, aura: 160, zone: 160 };
  const lives = { cast: [presentation.duration], impact: [0.6, presentation.duration], projectile: [1, 10],
    pulse: [0.25, 0.5], aura: [0.3, 1, 1.5], zone: [1, 8] };
  const radii = { cast: [0.8], impact: [1], projectile: [0.65], pulse: [1, 2], aura: [0.8, 1], zone: [1, 3] };
  for (const stage of Object.keys(budget)) {
    let peak = 0;
    for (let h = 0; h < 48; h++) for (const life of lives[stage]) for (const radius of radii[stage]) {
      for (let i = 0; i <= 160; i++) {
        const heading = (h - 24) * Math.PI / 24, progress = i / 160;
        peak = Math.max(peak, draw(stage, progress, { heading, radius, life }).length);
      }
    }
    assert.ok(peak <= budget[stage], `${stage} peaks at ${peak} glyphs (budget ${budget[stage]})`);
  }
  // The reviewer's case: nothing is dropped by the shared adapter's 256 cap.
  const heading = 5 * Math.PI / 24, life = presentation.duration, raw = draw('cast', 0.6375, { heading, life }).length;
  const painted = paintPresentation(presentation, { x: 0, y: 0, stage: 'cast', age: 0.6375 * life, life, radius: 1, heading }, () => {});
  assert.equal(painted, raw);
  assert.ok(raw <= budget.cast);
});

test('motion is smooth between neighbouring frames', () => {
  // Contact and the impact flash are deliberate cuts; elsewhere the brightness-weighted centroid drifts gently at 60 fps.
  const spans = [['cast', 0.05, 0.5], ['cast', 0.6, 0.95], ['projectile', 0.05, 0.95], ['impact', 0.2, 0.95], ['aura', 0.05, 0.95]];
  for (const [stage, from, to] of spans) {
    const centroid = progress => {
      const points = draw(stage, progress), weight = points.reduce((s, p) => s + p[4], 0);
      return [points.reduce((s, p) => s + p[0] * p[4], 0) / weight, points.reduce((s, p) => s + p[1] * p[4], 0) / weight];
    };
    for (let p = from; p < to; p += 1 / 60) {
      const [ax, az] = centroid(p), [bx, bz] = centroid(p + 1 / 60);
      assert.ok(Math.hypot(bx - ax, bz - az) < 0.35, `${stage} centroid jumps at ${p.toFixed(3)}`);
    }
  }
});

test('sound has a delayed wooden strike, resonant anvil body, and separate low aftershock', () => {
  const { cast, impact, pulse } = presentation.sounds;
  assert.ok(cast.some(v => v.kind === 'noise' && v.delay >= 0.5 && v.filterType === 'bandpass'), 'mallet strike waits for the hammer descent');
  assert.ok(cast.filter(v => v.kind === 'tone' && v.delay >= 0.6).length >= 2, 'inharmonic body tones follow the mallet');
  assert.ok(impact.some(v => v.kind === 'noise' && v.delay >= 0.2 && v.cutoff <= 200), 'soil aftershock follows the contact');
  assert.ok(impact.some(v => v.kind === 'tone' && v.delay >= 0.2 && v.endFrequency < 40), 'aftershock has a descending sub-bass body');
  assert.notDeepEqual(cast, impact);
  assert.ok(pulse.every(v => v.gain <= 0.03 && v.duration <= 0.15), 'repeated ground ticks remain quiet and brief');
  for (const recipe of Object.values(presentation.sounds)) {
    assert.ok(recipe.length > 0 && recipe.length <= 8);
    for (const voice of recipe) {
      assert.ok(voice.gain > 0 && voice.gain <= 0.25);
      assert.ok(voice.duration > 0 && voice.duration <= 2.5);
      assert.ok((voice.delay ?? 0) >= 0 && (voice.delay ?? 0) <= 2);
    }
    const fake = fakeRecordedAudio();
    const stage = Object.entries(presentation.sounds).find(([, value]) => value === recipe)[0];
    const handles = playSpellSound(fake.engine, { presentation, stage, x: 4, y: 7 });
    assert.equal(handles.length, recipe.length, 'every authored layer reaches the existing voice instruments');
    assert.ok(fake.routes.every(route => route.bus === 'sfx' && route.x === 4 && route.y === 7));
    assert.deepEqual(fake.invalid, []);
    for (const handle of handles) handle.stop();
  }
});

test('real rune cast renders authored cues and travelling anvil without sword sounds or gameplay changes', () => {
  const scene = runeScene(spell), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  assert.equal(scene.cast().ok, false, 'original cooldown still rejects repeated casts');
  assert.equal(events.filter(event => event.stage === 'cast').length, 1);
  const castDots = [], authored = [];
  scene.casting.effects.paint((...point) => castDots.push(point), scene.casting.projectiles);
  paintPresentation(presentation, scene.casting.effects.list.find(effect => effect.stage === 'cast'), (...point) => authored.push(point));
  assert.ok(authored.length > 0 && authored.every(point => castDots.some(other => JSON.stringify(other) === JSON.stringify(point))),
    'runtime paints the authored anvil cast');
  scene.advance(1);
  assert.equal(scene.foe.health, 100, 'earthquake retains its charge delay');
  assert.equal(scene.player.magicSpeed, 0, 'charge retains its movement restriction');
  scene.advance(1.5);
  assert.ok(scene.casting.projectiles.length > 0, 'original projectile carries the earthquake');
  const projectile = scene.casting.projectiles[0], expected = [], actual = [];
  paintPresentation(presentation, { x: projectile.x, y: projectile.y - projectile.h * 5,
    stage: 'projectile', age: projectile.age, life: projectile.life, radius: 0.65,
    heading: Math.atan2(projectile.dx, projectile.dz) }, (...point) => expected.push(point));
  scene.casting.effects.paint((...point) => actual.push(point), scene.casting.projectiles);
  assert.ok(expected.length > 0 && expected.every(point => actual.some(other => JSON.stringify(other) === JSON.stringify(point))), 'live projectile renderer uses the authored profile');
  scene.advance(2.5);
  assert.equal(scene.foe.health, 80, 'original TF damage remains 20');
  assert.ok(events.some(event => event.type === 'spell' && event.stage === 'impact'));
  assert.ok(events.every(event => event.type === 'spell' && event.presentation === presentation));
  assert.ok(events.every(event => !['draw', 'slam'].includes(event.type)));
});
