import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/temp-icicle-blitz.js';
import spell from '../../src/spells/definitions/temp-icicle-blitz.js';
import { paintPresentation } from '../../src/spells/presentation.js';
import { runeScene } from '../../test-support/spells.js';

function sample(stage, progress, radius = 1, heading = 0) {
  const effect = Object.freeze({ stage, progress, age: progress, life: 1, radius, heading });
  const points = [];
  presentation.draw(effect, (x, z, char, color, brightness = 1) => points.push({ x, z, char, color, brightness }));
  return points;
}

test('Icicle Blitz real casts render authored needles and emit spell cues while preserving damage', () => {
  const scene = runeScene(spell), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  const cuesBeforeRejectedCast = events.length;
  assert.equal(scene.castWithoutMana().ok, false);
  assert.equal(events.length, cuesBeforeRejectedCast, 'mana rejection stays silent');
  assert.ok(events.some(event => event.type === 'spell' && event.stage === 'cast' && event.presentation === presentation));
  assert.ok(scene.casting.effects.list.some(effect => effect.stage === 'cast' && effect.presentation === presentation));

  const points = [];
  scene.casting.effects.paint((...point) => points.push(point), scene.casting.projectiles);
  assert.ok(points.some(point => point[2] === 'v'), 'game renderer consumes the needle profile');
  assert.ok(points.some(point => point[2] === '|'), 'game renderer consumes the narrow crystal shaft');
  scene.advance(0.7);
  assert.equal(scene.foe.health, 96, 'authored effects preserve the existing four-damage quill');
  assert.ok(events.some(event => event.type === 'spell' && event.stage === 'impact' && event.presentation === presentation));
  assert.ok(events.every(event => event.type === 'spell' && event.presentation === presentation));
  assert.ok(!events.some(event => event.type === 'draw' || event.type === 'slam'));
});

const BUDGET = { cast: 200, projectile: 110, impact: 180, pulse: 90, aura: 160, zone: 160 };
const peak = points => Math.max(0, ...points.map(point => point.brightness));

test('Icicle Blitz nocks five quills that snap forward one at a time', () => {
  assert.equal(spell.presentation, presentation);
  assert.equal(presentation.id, spell.id);
  const tips = progress => sample('cast', progress).filter(point => point.char === 'v' && point.brightness > 0.05);
  const lanes = new Set([0.02, 0.1, 0.18, 0.26, 0.34, 0.42, 0.5].flatMap(progress => tips(progress).map(point => point.x.toFixed(3))));
  assert.equal(lanes.size, 5, 'five separate quill lanes over the cast');

  // Anticipation: before the first launch the quills form near the caster.
  assert.ok(tips(0.04).every(point => point.z < 0.6), 'quills are nocked close in before launch');
  const furthest = progress => Math.max(...tips(progress).map(point => point.z));
  assert.ok(furthest(0.2) > furthest(0.04) + 0.8, 'the first quill shoots forward');
  assert.ok(furthest(0.5) > 1.8, 'quills fly well out ahead of the caster');
  assert.ok(sample('cast', 0.08).some(point => point.char === '*'), 'a muzzle burst marks each launch');
  assert.ok(sample('cast', 0.15).filter(point => point.char === "'" || point.char === '.' || point.char === ':').length >= 5,
    'frost motes condense around forming quills');
  assert.ok(peak(sample('cast', 0.95)) < 0.1, 'the volley has dissipated by the end of the cast');

  // Smooth motion: tips advance a little between adjacent frames, with no jumps.
  const a = furthest(0.2), b = furthest(0.22);
  assert.ok(b > a && b - a < 0.3, 'tips move continuously between frames');

  // Glyph orientation follows the heading so a quill always reads as a quill.
  const sideways = sample('cast', 0.3, 1, Math.PI / 2);
  assert.ok(sideways.some(point => point.char === '>'));
  assert.ok(sideways.some(point => point.char === '-'));
  assert.ok(!sideways.some(point => point.char === 'v'));
});

test('Icicle Blitz quills stay solid unbroken shafts on screen at side-on headings', () => {
  // Paint through the real adapter and walk each needle tip back along its
  // shaft cells (8-connected): a sampling gap would cut the walk short.
  const reach = (progress, radius, heading) => {
    const cells = new Map();
    paintPresentation(presentation, { x: 0, y: 0, stage: 'cast', age: progress, life: 1, radius, heading }, (x, y, char, color, brightness) => {
      const key = `${Math.floor(x)},${Math.floor(y)}`;
      if (brightness > 0.05 && (cells.get(key)?.brightness ?? -1) <= brightness) cells.set(key, { char, brightness });
    });
    return [...cells].filter(([, cell]) => /[<>v^]/.test(cell.char)).map(([key]) => {
      const tip = key.split(',').map(Number), seen = new Set([key]), queue = [tip];
      let extent = 0;
      while (queue.length) {
        const [cx, cy] = queue.pop();
        extent = Math.max(extent, Math.abs(cx - tip[0]), Math.abs(cy - tip[1]));
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
          const next = `${cx + dx},${cy + dy}`;
          if (!seen.has(next) && /^[-|/\\:]$/.test(cells.get(next)?.char ?? '')) { seen.add(next); queue.push([cx + dx, cy + dy]); }
        }
      }
      return extent;
    }).sort((a, b) => b - a);
  };
  for (let step = 0; step < 48; step++) {
    const heading = step / 48 * Math.PI * 2;
    // Screen cells per metre along the flight line (26 across, 6.5 down).
    const along = Math.max(Math.abs(Math.sin(heading)) * 26, Math.abs(Math.cos(heading)) * 6.5);
    // The leading quill is ~0.77 m long here: ~20 cells side-on, ~5 head-on.
    const flying = reach(0.2, 0.8, heading);
    assert.ok(flying.length >= 2 && flying[0] >= 0.75 * 0.77 * along,
      `the leading quill keeps a solid shaft (${flying.slice(0, 3)}) at heading ${step}/48`);
    if (Math.abs(Math.sin(heading)) >= 0.9) {
      assert.ok(flying[0] >= 22 && flying[1] >= 15, `side-on quills stay unbroken (${flying.slice(0, 3)}) at heading ${step}/48`);
    }
  }
});

test('Icicle Blitz flies as a single long quill with a frost wake', () => {
  const flight = sample('projectile', 0.3, 0.65);
  assert.equal(flight.filter(point => point.char === 'v').length, 1, 'one needle point');
  const shaft = flight.filter(point => point.char === '|' && Math.abs(point.x) < 1e-9);
  assert.ok(shaft.length >= 4, 'a continuous crystal shaft');
  assert.ok(flight.some(point => point.char === '/') && flight.some(point => point.char === '\\'), 'barbed head');
  assert.ok(flight.some(point => point.z < -0.9 && point.brightness > 0.05), 'powder wake streams behind');
  assert.notDeepEqual(sample('projectile', 0.3, 0.65), sample('projectile', 0.32, 0.65), 'the wake animates');
});

test('Icicle Blitz impact flashes, blooms into an ice star, then crumbles away', () => {
  const flash = sample('impact', 0.02);
  assert.ok(flash.some(point => point.char === '@' && point.brightness > 0.9), 'white contact flash');

  const star = sample('impact', 0.2).filter(point => /[|/\\-]/.test(point.char) && point.brightness > 0.5);
  const sectors = new Set(star.map(point => Math.floor(((Math.atan2(point.x, point.z) - 0.2 + Math.PI / 8) / (Math.PI / 4) + 16) % 8)));
  assert.equal(sectors.size, 8, 'eight crystal spikes stand around the hit');
  const width = Math.max(...star.map(point => Math.abs(point.x))) * 26;
  const height = Math.max(...star.map(point => Math.abs(point.z))) * 13;
  assert.ok(width < height * 1.6, 'the star is balanced on screen rather than squashed into a bar');

  const spikes = progress => sample('impact', progress).filter(point => /[|/\\-]/.test(point.char) && point.brightness > 0.5).length;
  assert.ok(spikes(0.6) < spikes(0.2) * 0.5 && spikes(0.75) === 0, 'spikes crumble into fading chips');
  assert.ok(peak(sample('impact', 0.9)) < peak(sample('impact', 0.2)) * 0.4);
  assert.ok(sample('impact', 0.4).some(point => point.char === '*' || point.char === '+'), 'snowflakes settle after the hit');
});

test('Icicle Blitz pulse cracks the ground and aura orbits frost quills', () => {
  const cracks = sample('pulse', 0.5);
  assert.equal(cracks.filter(point => point.char === '*').length, 5, 'five fractures race out to bright ends');
  assert.ok(peak(sample('pulse', 0.95)) < 0.1);

  const orbit = sample('aura', 0.3, 1, 0);
  assert.equal(orbit.filter(point => /[<>v^]/.test(point.char)).length, 3, 'three quills circle the bearer');
  assert.ok(peak(sample('aura', 0.98)) < 0.05 && peak(sample('aura', 0.01)) < 0.2, 'aura eases in and out');
});

test('Icicle Blitz frames are deterministic, bounded, and fade away for every stage', () => {
  for (const stage of ['cast', 'impact', 'projectile', 'pulse', 'aura', 'zone']) {
    for (const radius of [0.1, 1, 12]) {
      for (const heading of [0, 0.8, Math.PI / 2]) {
        for (const progress of [0, 0.05, 0.15, 0.3, 0.4, 0.6, 0.8, 0.99, 1]) {
          const points = sample(stage, progress, radius, heading);
          assert.deepEqual(points, sample(stage, progress, radius, heading));
          assert.ok(points.length <= BUDGET[stage], `${stage} stays inside the plot budget (${points.length})`);
          for (const point of points) {
            assert.ok(Number.isFinite(point.x) && Number.isFinite(point.z));
            assert.ok(Math.abs(point.x) <= 3 && Math.abs(point.z) <= 3);
            assert.match(point.char, /^[\x20-\x7e]$/);
            assert.equal(point.color.length, 3);
            assert.ok(point.color.every(value => Number.isFinite(value) && value >= 0 && value <= 255));
            assert.ok(Number.isFinite(point.brightness) && point.brightness >= 0 && point.brightness <= 1);
          }
        }
      }
    }
    assert.deepEqual(sample(stage, 1), [], `${stage} disappears at its end`);
    assert.ok(peak(sample(stage, 0.999)) < 0.06, `${stage} is fully faded before it ends`);
  }
  assert.ok(peak(sample('projectile', 0.99)) < peak(sample('projectile', 0.2)) * 0.1);
});

test('Icicle Blitz snaps an uneven volley above low glacier strain', () => {
  const { cast, impact, pulse } = presentation.sounds;
  const snaps = cast.filter(v => v.kind === 'tone' && v.frequency > 500);
  assert.ok(snaps.length >= 3);
  assert.ok(new Set(snaps.slice(1).map((v, i) => Number((v.delay - snaps[i].delay).toFixed(3)))).size >= 2, 'uneven volley rhythm');
  assert.ok(cast.some(v => v.kind === 'tone' && v.frequency < 200), 'a low body anchors the spell');
  assert.notDeepEqual(cast, impact);
  assert.ok(pulse.reduce((sum, v) => sum + v.gain, 0) < cast.reduce((sum, v) => sum + v.gain, 0), 'repeat pulses stay beneath the cast');
  for (const sequence of Object.values(presentation.sounds)) {
    assert.ok(sequence.length > 0 && sequence.length <= 8);
    for (const voice of sequence) {
      assert.ok(['tone', 'noise'].includes(voice.kind));
      assert.ok(voice.delay >= 0 && voice.delay <= 2);
      assert.ok(voice.duration > 0 && voice.duration <= 2.5);
      assert.ok(voice.gain > 0 && voice.gain <= 0.25);
      assert.ok(voice.attack > 0 && voice.release > 0 && voice.attack + voice.release <= voice.duration);
    }
  }
});
