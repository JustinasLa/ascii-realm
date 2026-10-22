import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/maelstrom.js';
import spell from '../../src/spells/definitions/maelstrom.js';
import { runeScene } from '../../test-support/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';
import { playSpellSound } from '../../src/audio/spells.js';
import { prepareRecordedSpellTest } from '../../test-support/spell-audio.js';

function draw(stage, age = 0.2, progress = 0.2, radius = 3, heading = 1.1, life = 1) {
  const points = [];
  const effect = Object.freeze({ stage, age, life, progress, radius, heading });
  presentation.draw(effect, (...point) => points.push(point));
  return points;
}
// Samples a stage by progress with the clock the game gives it (heading 0, so local +z is forward).
const at = (stage, progress, radius, life = presentation.duration) => draw(stage, progress * life, progress, radius, 0, life);
const distance = point => Math.hypot(point[0], point[1]);
const luma = color => color[0] + color[1] + color[2];
const WHITE = [238, 255, 253];
const BUDGET = { cast: 160, impact: 160, projectile: 110, pulse: 90, aura: 160, zone: 165 };

test('Maelstrom zone is a three-arm whirlpool that spins around a dark throat and drags flotsam in', () => {
  const life = 5, early = at('zone', 0.5, 7, life), later = draw('zone', 2.5 + 0.02, (2.5 + 0.02) / life, 7, 0, life);
  const eye = early.filter(point => point[2] === '@');
  assert.equal(eye.length, 1, 'one black core');
  assert.ok(distance(eye[0]) < 1, 'the core sits in the throat');
  assert.ok(early.every(point => point === eye[0] || luma(point[3]) > luma(eye[0][3])), 'the throat is the darkest glyph');
  assert.notDeepEqual(early.map(p => p.slice(0, 2)), later.map(p => p.slice(0, 2)), 'the whole vortex turns');
  const core = early.filter(point => distance(point) < 1.5).length, mid = early.filter(point => distance(point) > 2.8 && distance(point) < 6.3).length;
  assert.ok(core > 60, 'dense churning core');
  assert.ok(mid >= 10, 'arms trail out across the pull radius');
  assert.ok(Math.max(...early.map(distance)) > 6.5, 'foam crests mark the 7 m rim');
  const heads = early.filter(point => point[2] === 'o'), laterHeads = later.filter(point => point[2] === 'o');
  assert.ok(heads.length >= 4 && heads.length === laterHeads.length);
  assert.ok(heads.some(point => distance(point) > 3), 'flotsam starts out near the rim');
  assert.ok(heads.every((point, i) => distance(laterHeads[i]) < distance(point)), 'flotsam is dragged inward');
  // Grows in from a smaller vortex, then unravels and calms instead of popping out.
  const opening = at('zone', 0.01, 7, life), calming = at('zone', 0.96, 7, life);
  assert.ok(Math.max(...opening.filter(p => p[2] !== '@').map(p => p[4])) < 0.3, 'fades in');
  assert.ok(calming.length < early.length && Math.max(...calming.map(p => p[4])) < 0.5, 'calms out');
  // The 0.1 m display totem is a small spout of spray, not a second full vortex.
  const spout = at('zone', 0.5, 0.1, life);
  assert.ok(spout.length > 6 && spout.length <= 20 && spout.every(point => distance(point) < 2));
});

// Arms are stroked first, one after another, each from the throat outward; flotsam ('o') follows them.
function foamArms(points) {
  const arms = [[]];
  for (const point of points.slice(0, points.findIndex(p => p[2] === 'o'))) {
    const previous = arms.at(-1).at(-1);
    if (previous && distance(point) < distance(previous) - 0.3) arms.push([]);
    arms.at(-1).push(point);
  }
  return arms;
}
const RADII = [0.7, 1, 2, 3, 5, 7, 9], HEADINGS = [0, 0.5, 1.1, 1.6, 2.4, 3.1, 4.2, 5.5];
// Steady-state ages, plus the two frames a review caught with a broken arm.
const AGES = [...Array.from({ length: 55 }, (_, i) => 1 + i * 0.05), 1.814779613, 3.5];

test('Maelstrom foam arms spread their glyph budget evenly from the throat out to the rim', () => {
  for (const radius of RADII) {
    for (const heading of HEADINGS) {
      for (const age of AGES) {
        const arms = foamArms(draw('zone', age, age / 5, radius, heading, 5)), where = `radius ${radius}, heading ${heading}, age ${age}`;
        assert.equal(arms.length, 3, `three arms (${where})`);
        for (const arm of arms) {
          assert.ok(arm.length >= (radius < 1.5 ? 12 : 27) && arm.length <= 30, `each arm uses its budget (${arm.length}, ${where})`);
          assert.ok(distance(arm[0]) < 0.6, `arm starts at the throat (${where})`);
          // Within about one screen row (1/6.5 m) of the rim.
          assert.ok(distance(arm.at(-1)) > Math.min(9, radius) - 0.25, `arm ends on the rim (${where})`);
          // Dashes of three: no gap may be wider than twice the mean dash period, so the
          // budget covers the interior instead of leaving a stub and a lone tip.
          let length = 0, widest = 0;
          for (let i = 1; i < arm.length; i++) {
            const gap = Math.hypot(arm[i][0] - arm[i - 1][0], arm[i][1] - arm[i - 1][1]);
            length += gap; widest = Math.max(widest, gap);
          }
          assert.ok(widest <= 2 * length * 3 / arm.length, `no hole along the arm (${widest.toFixed(2)} of ${length.toFixed(2)} m, ${where})`);
        }
      }
    }
  }
});

test('Maelstrom foam arms move continuously: no bright glyph pops in or out between adjacent frames', () => {
  // From the grow-in through the calm; dt is a fraction of a 60 fps frame.
  const ages = [...Array.from({ length: 87 }, (_, i) => 0.3 + i * 0.05), 1.814279613, 1.814779613, 3.4995];
  for (const radius of RADII) {
    for (const heading of HEADINGS) {
      for (const age of ages) {
        const frames = [age, age + 0.002].map(t => foamArms(draw('zone', t, t / 5, radius, heading, 5)).flat());
        for (const [from, to] of [frames, [frames[1], frames[0]]]) {
          for (const glyph of from) {
            // A glyph must still be there (within 0.1 m, at nearly the same brightness) or be fading already.
            let change = glyph[4];
            for (const other of to) {
              if (Math.hypot(glyph[0] - other[0], glyph[1] - other[1]) < 0.1) change = Math.min(change, Math.abs(glyph[4] - other[4]));
            }
            assert.ok(change <= 0.05, `glyph at ${distance(glyph).toFixed(2)} m (brightness ${glyph[4].toFixed(2)}) pops `
              + `(radius ${radius}, heading ${heading}, age ${age})`);
          }
        }
      }
    }
  }
});

test('Maelstrom cast draws the sea up into an orb, flares white on release and flings spray forward', () => {
  const gather = at('cast', 0.15, 0.8), drawn = at('cast', 0.38, 0.8), flash = at('cast', 0.45, 0.8), thrown = at('cast', 0.8, 0.8);
  const mean = points => points.reduce((sum, point) => sum + distance(point), 0) / points.length;
  assert.ok(mean(drawn) < mean(gather) * 0.7, 'ribbons and droplets converge on the orb during the wind-up');
  assert.ok(!gather.some(point => point[2] === '#') && flash.some(point => point[2] === '#' && point[3].join() === WHITE.join()),
    'white flare at release');
  assert.ok(Math.max(...thrown.map(distance)) > Math.max(...drawn.map(distance)) * 1.6, 'ripples and spray roll outward');
  assert.ok(thrown.filter(point => point[1] > 1).length > thrown.filter(point => point[1] < -1).length * 1.4, 'spray jet favours the aim');
  assert.ok(thrown.some(point => point[2] === ','), 'falling droplets');
});

test('Maelstrom projectile is a compact whirl with a bow wave and a braided wake; impact coils, flashes and splashes', () => {
  const projectile = at('projectile', 0.3, 0.65, 0.5);
  assert.ok(projectile.some(point => point[2] === '@' && distance(point) < 0.1), 'dark eye at the centre');
  assert.ok(Math.max(...projectile.map(point => point[1])) < 0.8, 'nothing far ahead of the orb');
  assert.ok(projectile.filter(point => point[1] < -1).length >= 15, 'wake trails behind');
  const wind = at('impact', 0.02, 1), coiled = at('impact', 0.24, 1), hit = at('impact', 0.3, 1), crown = at('impact', 0.7, 1);
  assert.ok(Math.max(...coiled.map(distance)) < Math.max(...wind.map(distance)) * 0.5, 'the whip coils tight before the hit');
  assert.ok(!coiled.some(point => point[2] === '#') && hit.some(point => point[2] === '#' && point[3].join() === WHITE.join()), 'white impact frame');
  assert.ok(Math.max(...crown.map(distance)) > 1.5 && crown.some(point => point[2] === ','), 'crown droplets land around the target');
  const splash = at('pulse', 0.05, 1, 0.25), surge = at('pulse', 0.3, 7, 0.25);
  assert.ok(splash.every(point => distance(point) < 0.5) && splash.some(point => point[2] === '*'), 'tick splash starts as a tight white plume');
  const crests = surge.filter(point => point[2] === '^');
  assert.ok(crests.length >= 12 && crests.every(point => Math.abs(distance(point) - 7) < 0.8), 'spawn surge heaves along the boundary');
});

test('Maelstrom stays within budget, prints ASCII and fades every stage', () => {
  for (const stage of ['cast', 'projectile', 'impact', 'pulse', 'aura', 'zone']) {
    for (const radius of [0.1, 0.65, 1, 3, 7]) {
      for (let i = 0; i <= 20; i++) {
        const progress = i / 20, points = draw(stage, progress, progress, radius, 1.1);
        assert.ok(points.length <= BUDGET[stage], `${stage} stays inside its glyph budget (${points.length})`);
        if (progress > 0.1 && progress < 0.7) assert.ok(points.length > 10, `${stage} is visible mid-life`);
        for (const [x, z, char, color, brightness] of points) {
          assert.ok([x, z, brightness, ...color].every(Number.isFinite));
          assert.ok(Math.abs(x) < 12 && Math.abs(z) < 12);
          assert.match(char, /^[\x20-\x7e]$/);
          assert.ok(color.length === 3 && color.every(channel => channel >= 0 && channel <= 255));
          assert.ok(brightness >= 0 && brightness <= 1);
          if (progress === 1) assert.equal(brightness, 0, `${stage} fades completely`);
        }
      }
    }
  }
  const once = draw('zone', 1.3, 0.3, 7), again = draw('zone', 1.3, 0.3, 7);
  assert.deepEqual(once, again, 'draw is a pure function of the effect state');
});

test('Maelstrom layers real returning water and staggered bubbles into a restrained whirlpool', async () => {
  assert.equal(spell.presentation, presentation);
  for (const stage of ['cast', 'impact', 'pulse']) {
    const voices = presentation.sounds[stage];
    assert.ok(voices.length >= 1 && voices.length <= 3);
    assert.ok(voices.some(voice => voice.url.endsWith('/deep-fold.wav')));
    if (stage === 'pulse') assert.equal(voices.length, 1, 'repeated pressure avoids stacked wet textures');
    else assert.ok(new Set(voices.map(voice => voice.delay)).size > 1, 'current gestures enter in staggered turns');
    assert.ok(voices.reduce((sum, voice) => sum + voice.gain, 0) <= (stage === 'pulse' ? 0.07 : 0.65));
    for (const voice of voices) {
      assert.equal(voice.kind, 'recording', 'every layer uses shaped recordings');
      assert.match(voice.url, /^\/assets\/audio\/spells\/mitlan\/[a-z-]+\.wav$/);
      assert.deepEqual(Object.keys(voice).sort(), ['delay', 'gain', 'kind', 'rate', 'url']);
      assert.ok(voice.gain >= 0.04 && voice.gain <= 0.35);
      assert.ok(voice.rate >= 0.75 && voice.rate <= 1.2);
      assert.ok(voice.delay >= 0 && voice.delay <= 2);
    }
    const fake = fakeRecordedAudio();
    await prepareRecordedSpellTest(fake, presentation);
    const handles = playSpellSound(fake.engine, { stage, presentation, x: 4, y: 8 });
    assert.equal(handles.length, voices.length, 'every authored recording reaches playback');
    assert.ok(fake.routes.every(route => route.bus === 'sfx' && route.x === 4 && route.y === 8));
    assert.deepEqual(fake.invalid, []);
    for (const handle of handles) handle.stop();
  }
  assert.notDeepEqual(presentation.sounds.cast, presentation.sounds.impact);
});

test('Maelstrom uses authored projectile/zone geometry and typed cast/impact cues in a real rune scene', () => {
  const scene = runeScene(spell), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  const eventCount = events.length;
  assert.equal(scene.castWithoutMana().ok, false);
  assert.equal(events.length, eventCount, 'mana rejection stays silent');
  const launch = [];
  scene.casting.effects.paint((...p) => launch.push(p), scene.casting.projectiles);
  assert.ok(launch.some(p => p[2] === '@') && launch.some(p => p[2] === '~'), 'real projectile paints its whirlpool');
  assert.equal(scene.casting.mana, 90);
  scene.advance(0.8);
  assert.equal(scene.foe.health, 100, 'warning window remains harmless');
  scene.advance(3);
  assert.ok(scene.foe.health <= 90, 'existing repeated damage still runs');
  assert.ok(scene.casting.effects.list.some(effect => effect.stage === 'zone' && effect.presentation === presentation));
  const zone = [];
  scene.casting.effects.paint((...p) => zone.push(p), scene.casting.projectiles);
  assert.ok(zone.some(p => p[2] === '@') && zone.some(p => p[2] === 'o'), 'active zone paints the whirlpool and its flotsam');
  assert.equal(events.filter(event => event.type === 'spell' && event.stage === 'cast').length, 1);
  assert.ok(events.some(event => event.type === 'spell' && event.stage === 'impact'));
  assert.ok(events.some(event => event.type === 'spell' && event.stage === 'pulse'));
  assert.ok(events.every(event => event.type === 'spell' && event.spellId === 'maelstrom' && event.presentation === presentation));
  assert.ok(events.every(event => !['draw', 'slam'].includes(event.type)));
});
