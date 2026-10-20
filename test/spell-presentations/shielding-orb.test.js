import assert from 'node:assert/strict';
import test from 'node:test';
import profile from '../../src/spells/presentations/shielding-orb.js';
import spell from '../../src/spells/definitions/shielding-orb.js';
import { SpellEffects } from '../../src/spells/effects.js';
import { playSpellSound } from '../../src/audio/spells.js';
import { runeScene } from '../../test-support/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';

function draw(stage, progress = 0.2, age = progress * profile.duration, radius = 1, life = profile.duration, heading = 0) {
  const points = [];
  const effect = Object.freeze({ stage, progress, age, life, radius, heading });
  profile.draw(effect, (...point) => points.push(point));
  return points;
}

// Stage, life, radius and glyph budget as the rune presents them (plus unused stages).
const CASES = [
  ['cast', 0.9, 0.8, 250], ['projectile', 1, 0.65, 110], ['pulse', 0.25, 1, 24], ['pulse', 0.25, 3, 90],
  ['aura', 0.6, 1, 160], ['aura', 0.3, 1, 100], ['impact', 0.9, 1, 230], ['zone', 3, 2, 160],
];
const extent = points => Math.max(...points.map(p => Math.hypot(p[0], p[1])));
const lit = points => points.filter(p => p[4] > 0.05);

test('Shielding Orb opts into its own profile and retains its TF ward parameters', () => {
  assert.equal(spell.presentation, profile);
  assert.equal(profile.id, spell.id);
  assert.equal(spell.root, 'shielding_orb');
  assert.equal(spell.supportive, true);
  assert.deepEqual(spell.variants[0].params, { cooldown: 10, mana: 4, shield_power: 13, shield_duration: 6 });
  assert.equal(spell.source.sha256, 'c9f405f18142629574b33481eadbd1e219bd9e0ed27d41487977509c68af4129');
});

test('all ward stages remain bounded, deterministic, ASCII, within budget and fade to darkness', () => {
  for (const [stage, life, radius, budget] of CASES) {
    for (let i = 0; i <= 40; i++) {
      const progress = i / 40, points = draw(stage, progress, progress * life, radius, life, 0.7);
      assert.ok(points.length <= budget, `${stage} r${radius} uses ${points.length} > ${budget} glyphs`);
      assert.deepEqual(points, draw(stage, progress, progress * life, radius, life, 0.7), 'drawing is deterministic');
      for (const [x, z, char, color, brightness] of points) {
        assert.ok([x, z, brightness, ...color].every(Number.isFinite));
        assert.ok(Math.abs(x) <= 6 && Math.abs(z) <= 6);
        assert.match(char, /^[\x20-\x7e]$/);
        assert.equal(color.length, 3);
        assert.ok(color.every(c => c >= 0 && c <= 255));
        assert.ok(brightness >= 0 && brightness <= 1);
        if (progress === 1) assert.equal(brightness, 0, `${stage} fades completely`);
      }
    }
  }
  assert.ok(draw('pulse', 0.5, 0.12, 1, 0.25).length < draw('pulse', 0.5, 0.12, 3, 0.25).length / 3,
    'projectile tick ripples stay far leaner than the landing seal');
});

test('cast gathers motes into the palm, blooms, reveals a spinning gyroscope and dissolves', () => {
  const at = (p, extra = 0) => draw('cast', p, p * 0.9 + extra, 0.8);
  const motes = p => at(p).filter(q => q[1] < -0.2 && (q[2] === ':' || q[2] === '*'));
  const spread = pts => pts.reduce((sum, q) => sum + Math.hypot(q[0], (q[1] + 1.45) / 1.3), 0) / pts.length;
  assert.ok(spread(motes(0.02)) > spread(motes(0.15)) * 1.5, 'motes spiral inward during the wind-up');
  assert.ok(at(0.19).some(q => q[2] === '@' && q[3][0] > 240), 'a white-hot core gathers at the hand');
  assert.ok(at(0.42).some(q => q[3].every(c => c > 230) && '-/\\|*'.includes(q[2])), 'the lattice snaps open with a white flash');
  const strokes = pts => pts.filter(q => '-/\\|'.includes(q[2]) && q[1] < 0).length;
  assert.ok(strokes(at(0.62)) > 40, 'the gyroscope rings read as continuous strokes');
  assert.notDeepEqual(at(0.62), at(0.62, 0.05), 'rings spin with age');
  const motesOut = p => at(p).filter(q => q[2] === "'" || q[2] === '.').length;
  assert.ok(motesOut(0.92) > motesOut(0.5), 'the lattice dissolves into drifting motes');
  assert.ok(lit(at(0.98)).length < lit(at(0.6)).length);
  assert.ok(at(0.4).some(q => q[1] > 1 && q[2] === '+'), 'a ground sigil anchors the cast');
});

test('projectile is a caged globe with two orbiting satellites and a trailing helix', () => {
  const first = draw('projectile', 0.2, 0, 0.65, 1), later = draw('projectile', 0.2, 0.17, 0.65, 1);
  const cores = points => points.filter(p => p[2] === 'o');
  assert.equal(cores(first).length, 2);
  assert.ok(Math.abs(cores(first)[0][0] + cores(first)[1][0]) < 1e-9, 'satellites orbit on opposite sides');
  assert.notDeepEqual(cores(first), cores(later), 'satellites orbit independently of lifetime');
  assert.equal(first.filter(p => p[2] === '@' && p[0] === 0 && p[1] === 0).length, 1, 'a bright core sits at the centre');
  assert.ok(first.filter(p => p[2] === '(').length >= 2 && first.filter(p => p[2] === ')').length >= 2, 'round silhouette');
  const wake = first.filter(p => p[1] < -0.4 && Math.abs(p[0]) < 0.4);
  assert.ok(wake.length >= 12, 'the helix trails behind the orb');
  assert.ok(wake.some(p => p[0] < -0.02) && wake.some(p => p[0] > 0.02), 'the two helix strands cross sides');
  // Facing east, the adapter's rotation puts the wake to the west.
  const h = Math.PI / 2, east = draw('projectile', 0.2, 0, 0.65, 1, h), c = Math.cos(h), s = Math.sin(h);
  const world = east.map(p => [p[0] * c + p[1] * s, p[1] * c - p[0] * s]);
  assert.ok(world.filter(p => p[0] < -0.4 && Math.abs(p[1]) < 0.4).length >= 12, 'the wake follows the projectile heading');
});

test('the ward lands as a sealing pearl bubble with a closing seal and corner-bracket pulse', () => {
  const at = age => draw('aura', age / 0.6, age, 1, 0.6);
  assert.ok(extent(at(0.3)) > extent(at(0.02)) * 1.4, 'the bubble springs outward');
  assert.ok(at(0.02).some(p => p[3].every(c => c > 230)), 'it flashes white as it seals');
  const settled = at(0.3);
  assert.ok(settled.filter(p => p[2] === '(').length > 8 && settled.filter(p => p[2] === ')').length > 8);
  assert.ok(settled.length >= 120, 'the rim is a dense continuous outline');
  assert.equal(settled.filter(p => p[2] === 'O' || p[2] === 'o').length, 2, 'the twin cores keep orbiting the ward');
  assert.ok(settled.some(p => p[1] > 0.6 && p[2] === '+'), 'a ground ring rests under the bubble');
  // The short absorption aura closes a shell onto the bubble, then clasps it.
  const seal = p => draw('aura', p, p * 0.3, 1, 0.3);
  assert.ok(extent(seal(0.1)) > extent(seal(0.6)), 'the seal closes inward');
  const stars = p => seal(p).filter(q => q[2] === '*').length;
  assert.ok(stars(0.55) >= stars(0.2) + 4, 'four clasps glint once the shell has sealed');
  const pulse = p => draw('pulse', p, p * 0.25, 3, 0.25);
  assert.equal(pulse(0.3).filter(p => p[2] === '+').length, 6, 'the landing pulse is a six-cornered seal');
  assert.ok(extent(pulse(0.8)) > extent(pulse(0.1)), 'the seal expands across the ward radius');
  const tick = p => draw('pulse', p, p * 0.25, 1, 0.25);
  assert.ok(extent(tick(0.8)) > extent(tick(0.1)) && extent(tick(0.9)) < 0.6, 'tick ripples stay small under the orb');
  assert.ok(draw('impact', 0.3, 0.27, 1).some(p => p[2] === '`' || p[2] === ','), 'a direct impact flings petals');
});

test('paired beating bells lead a low rim hum and resilient falling impact thrum', () => {
  const [bellA, bellB, hum] = profile.sounds.cast;
  assert.ok([bellA, bellB].every(v => v.kind === 'tone' && v.type === 'sine' && v.release > v.duration * 0.7));
  assert.ok(Math.abs(bellA.frequency - bellB.frequency) > 0);
  assert.ok(Math.abs(bellA.frequency - bellB.frequency) / bellA.frequency < 0.03, 'near unison bells create a slow beat');
  assert.ok((bellB.delay ?? 0) < 0.04 && hum.delay > bellB.delay);
  assert.ok(hum.frequency < bellA.frequency / 3 && hum.attack > bellA.attack);
  const [thrum, overtone, ...rim] = profile.sounds.impact;
  assert.ok(thrum.endFrequency < thrum.frequency && thrum.frequency < hum.frequency);
  assert.ok(overtone.endFrequency < overtone.frequency);
  assert.ok(rim.every(v => v.delay > overtone.delay && v.type === 'sine'));
  assert.ok(profile.sounds.pulse.every(v => v.gain < 0.02 && v.duration <= 0.1));
  for (const recipe of Object.values(profile.sounds)) {
    assert.ok(recipe.length > 0 && recipe.length <= 8);
    for (const voice of recipe) {
      assert.ok(voice.duration > 0 && voice.duration <= 2.5);
      assert.ok((voice.delay ?? 0) >= 0 && (voice.delay ?? 0) <= 2);
      assert.ok(voice.gain > 0 && voice.gain <= 0.25);
    }
  }
});

test('real rune cast renders the authored projectile and ally ward with typed spatial sound cues', () => {
  const scene = runeScene(spell, { range: 12, allyInPath: true }), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  const acceptedEvents = events.length;
  assert.equal(scene.cast().ok, false);
  assert.equal(events.length, acceptedEvents, 'cooldown rejection emits no cue');
  assert.equal(scene.casting.projectiles.length, 1);
  const castPoints = [];
  scene.casting.effects.paint((...p) => castPoints.push(p));
  assert.ok(castPoints.filter(p => p[2] === ':').length >= 10, 'gathering motes start the cast');
  const projectilePoints = [];
  new SpellEffects().paint((...p) => projectilePoints.push(p), scene.casting.projectiles);
  assert.equal(projectilePoints.filter(p => p[2] === 'o').length, 2);
  assert.ok(projectilePoints.some(p => p[2] === '.'));
  scene.advance(0.3);
  assert.equal(scene.casting.state(scene.ally).shield, 13);
  assert.equal(scene.casting.state().shield, 0);
  assert.equal(scene.foe.health, 100);
  const ward = scene.casting.effects.list.find(e => e.stage === 'aura');
  assert.equal(ward?.presentation, profile);
  const landed = [];
  scene.casting.effects.paint((...p) => landed.push(p));
  assert.ok(landed.some(p => p[2] === '(') && landed.some(p => p[2] === ')'), 'the pearl bubble seals around the ally');
  const cast = events.find(e => e.stage === 'cast'), impact = events.find(e => e.stage === 'impact');
  assert.ok(cast && impact);
  assert.ok(events.every(e => e.type === 'spell' && e.spellId === spell.id && e.presentation === profile));
  assert.ok(events.every(e => !['draw', 'slam'].includes(e.type)));
  assert.equal(impact.x, scene.ally.x);
  assert.equal(impact.y, scene.ally.y);
  const fake = fakeRecordedAudio();
  const handles = [cast, impact].flatMap(event => playSpellSound(fake.engine, event));
  assert.equal(handles.length, profile.sounds.cast.length + profile.sounds.impact.length);
  assert.ok(fake.routes.every(r => r.bus === 'sfx'));
  assert.ok(fake.routes.some(r => r.x === scene.ally.x && r.y === scene.ally.y));
  assert.ok(fake.nodes.some(n => n.starts.some(at => at > fake.context.currentTime)), 'bell and rim layers are scheduled');
  assert.deepEqual(fake.invalid, []);
  for (const handle of handles) handle.stop();
  assert.ok(fake.routes.every(r => r.disposals === 1));
  scene.advance(6.5);
  assert.equal(scene.casting.state(scene.ally).shield, 0, 'ward still expires after the TF duration');
});
