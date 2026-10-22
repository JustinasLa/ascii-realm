import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/ice-shield.js';
import spell from '../../src/spells/definitions/ice-shield.js';
import { paintPresentation } from '../../src/spells/presentation.js';
import { runeScene } from '../../test-support/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';
import { GameAudio } from '../../src/audio/audio.js';

const LIFE = presentation.duration;
const BUDGET = { cast: 250, impact: 250, aura: 160, zone: 160, pulse: 90, projectile: 110 };

function frame(stage, progress, radius = 1.4, heading = 1.1) {
  const points = [];
  const effect = Object.freeze({ stage, progress, radius, age: progress * LIFE, life: LIFE, heading });
  presentation.draw(effect, (x, z, char, color, brightness = 1) => points.push({ x, z, char, color, brightness }));
  return points;
}

// Screen cells through the real adapter, with the effect origin in cell (0, 0).
function cells(stage, progress, { radius = 0.8, heading = 0, life = LIFE, x = 0, y = 0 } = {}) {
  const out = [];
  paintPresentation(presentation, { x, y, stage, age: progress * life, life, radius, heading },
    (cx, cy, char, color, brightness) => out.push({ x: Math.floor(cx) - Math.floor(x), y: Math.floor(cy) - Math.floor(y), char, color, brightness }),
    stage === 'projectile' ? 128 : 256);
  return out;
}
const mean = (points, key) => points.reduce((sum, point) => sum + key(point), 0) / Math.max(1, points.length);

test('a real Ice Shield cast paints its honeycomb shield and routes its chord as a typed spell cue', () => {
  const scene = runeScene(spell), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  const castCue = events.find(event => event.type === 'spell' && event.stage === 'cast');
  assert.ok(castCue, 'the runtime emits a cast cue');
  assert.equal(castCue.spellId, spell.id);
  assert.equal(castCue.presentation, presentation);
  assert.ok(events.every(event => event.type === 'spell' && event.presentation === presentation));
  assert.ok(events.every(event => !['draw', 'slam'].includes(event.type)));
  const count = events.length;
  assert.equal(scene.castWithoutMana().ok, false);
  assert.equal(events.length, count, 'a cast without mana stays silent');
  const launch = scene.casting.effects.list.find(effect => effect.stage === 'cast');
  assert.equal(launch.presentation, presentation);
  scene.advance(0.6);
  const points = [];
  scene.casting.effects.paint((...point) => points.push(point));
  for (const char of ['_', '/', '\\', '+']) {
    assert.ok(points.some(point => point[2] === char), `the live renderer draws plate seams and cores (${char})`);
  }
  const fake = fakeRecordedAudio(), audio = new GameAudio({}, fake.engine);
  const voices = audio.play(castCue);
  assert.equal(voices.length, presentation.sounds.cast.length);
  assert.ok(fake.routes.every(route => route.bus === 'sfx' && route.x === scene.player.x && route.y === scene.player.y));
  assert.deepEqual(fake.invalid, []);
  audio.play({ type: 'spell-stop', owner: castCue.owner });
  assert.ok(voices.every(voice => voice.ended));
});

test('Ice Shield locks seven honeycomb plates into a raised heater shield with a pointed rim', () => {
  assert.equal(spell.presentation, presentation);
  assert.equal(presentation.id, spell.id);
  const formed = cells('cast', 0.55);
  const cores = formed.filter(point => point.char === '+');
  assert.equal(cores.length, 7, 'one core per plate');
  assert.equal(cores.filter(point => point.x < 0).length, 2);
  assert.equal(cores.filter(point => point.x > 0).length, 2);
  assert.equal(cores.filter(point => point.x === 0).length, 3, 'a centre column of three plates');
  assert.ok(cores.every(point => point.y < -4), 'the shield is raised before the caster');
  const tip = formed.filter(point => point.char === 'V');
  assert.equal(tip.length, 1, 'the rim closes to a single point');
  assert.equal(tip[0].x, 0);
  const crown = formed.filter(point => point.char === '_' && point.y === Math.min(...formed.filter(p => p.char === '_').map(p => p.y)));
  assert.ok(crown.length > 20, 'a straight crown across the top');
  assert.ok(formed.filter(point => point.char === '|' && point.x < 0).length >= 3, 'left rim');
  assert.ok(formed.filter(point => point.char === '|' && point.x > 0).length >= 3, 'right rim');
  assert.ok(formed.filter(point => point.char === '/').length >= 14);
  assert.ok(formed.filter(point => point.char === '\\').length >= 14);
  assert.ok(formed.filter(point => point.char === '_').length >= 50, 'plates share crisp horizontal seams');
  assert.equal(new Set(formed.map(point => `${point.x},${point.y}`)).size, formed.length, 'no cell is drawn twice');
  const mirrored = new Set(formed.filter(point => point.char === '|').map(point => `${-point.x},${point.y}`));
  assert.ok(formed.filter(point => point.char === '|').every(point => mirrored.has(`${point.x},${point.y}`)), 'symmetric rim');
});

test('Ice Shield cast choreography: motes gather, plates seat centre-first, the shield flashes, then sublimates', () => {
  const gather = cells('cast', 0.05);
  assert.ok(gather.length > 10 && gather.every(point => ['.', ':', '*'].includes(point.char)), 'anticipation frost motes');
  const seating = cells('cast', 0.25), formed = cells('cast', 0.55);
  const seated = list => list.filter(point => point.char === '+').length;
  assert.ok(seated(seating) < seated(formed), 'outer plates join after the centre');
  assert.ok(seating.some(point => point.char === '*'), 'the rim frost runs round with a bright head');
  const flash = cells('cast', 0.435), held = cells('cast', 0.65);
  assert.ok(mean(flash, point => point.brightness) > mean(held, point => point.brightness) + 0.1, 'locking flashes the shield');
  assert.ok(mean(flash, point => point.color[0]) > mean(held, point => point.color[0]), 'the flash runs white-hot');
  assert.ok(held.some(point => (point.char === "'" || point.char === '.') && point.y < -22), 'shards spit off the rim');
  const melting = cells('cast', 0.93);
  assert.ok(melting.length < formed.length, 'the shield thins glyph by glyph as it melts');
  assert.ok(mean(melting, point => point.brightness) < mean(formed, point => point.brightness) * 0.6);
  assert.ok(mean(melting, point => point.color[0]) < mean(held, point => point.color[0]), 'melting cools the palette');
  assert.notDeepEqual(cells('cast', 0.6), cells('cast', 0.62), 'the glint keeps moving while it holds');
  assert.deepEqual(cells('cast', 0.55), formed, 'animation is deterministic');
});

test('Ice Shield stays on the screen grid at any aim and position', () => {
  const key = list => list.map(point => `${point.x},${point.y},${point.char}`).join(' ');
  for (const stage of ['cast', 'impact']) {
    const straight = key(cells(stage, 0.5));
    for (const heading of [0.4, 1.1, -2.6]) {
      assert.equal(key(cells(stage, 0.5, { heading, x: 40.3, y: 17.8 })), straight, `${stage} at heading ${heading}`);
    }
  }
});

test('Ice Shield contact cracks the shield, shudders it and spits chips that settle', () => {
  const struck = cells('impact', 0.06, { radius: 1 });
  const contact = struck.filter(point => point.char === 'X');
  assert.equal(contact.length, 1, 'a single contact point');
  const near = (list, origin) => list.filter(point => Math.abs(point.x - origin.x) <= 12 && Math.abs(point.y - origin.y) <= 6
    && ['/', '\\', '|', '-'].includes(point.char) && point.brightness > 0.9);
  const later = cells('impact', 0.3, { radius: 1 });
  const laterContact = later.find(point => point.char === 'X');
  const start = cells('impact', 0.02, { radius: 1 }), startContact = start.find(point => point.char === 'X');
  assert.ok(near(later, laterContact).length > near(start, startContact).length * 1.5, 'cracks race out from the contact');
  assert.ok(mean(struck, point => point.brightness) > mean(cells('impact', 0.5, { radius: 1 }), point => point.brightness),
    'contact flashes then settles');
  const shakes = new Set([0.02, 0.04, 0.06, 0.08].map(p => cells('impact', p, { radius: 1 }).find(point => point.char === 'V').x));
  assert.ok(shakes.size > 1, 'the shield shudders on contact');
  assert.equal(cells('impact', 0.5, { radius: 1 }).find(point => point.char === 'V').x, 0, 'and comes back to rest');
  // Chips are the cells that are not part of the resting shield.
  const rest = new Set(cells('impact', 0.5, { radius: 1 }).map(point => point.x + ',' + point.y));
  const chips = list => list.filter(point => !rest.has(point.x + ',' + point.y) && point.brightness > 0.05).length;
  assert.ok(chips(cells('impact', 0.35, { radius: 1 })) >= 6, 'chips fly out from the contact');
  assert.equal(chips(cells('impact', 0.58, { radius: 1 })), 0, 'chips are spent before the shield melts');
});

test('Ice Shield ground stages lay hexagonal frost and a projectile carries one spinning plate', () => {
  const extent = list => Math.max(...list.map(point => Math.hypot(point.x / (13 / 0.6), point.y / 6.5)));
  const early = cells('pulse', 0.15, { radius: 2, life: 0.4 }), late = cells('pulse', 0.7, { radius: 2, life: 0.4 });
  assert.ok(extent(late) > extent(early) * 1.3, 'the cold snap rushes outward');
  assert.equal(late.filter(point => point.char === '*').length, 6, 'six hex vertices on the front');
  const aura = cells('aura', 0.5, { radius: 1, life: 1.5 });
  assert.equal(aura.filter(point => point.char === '*').length, 6, 'the ward seals as a hexagon');
  assert.ok(extent(cells('aura', 0.05, { radius: 1, life: 1.5 })) > extent(cells('aura', 0.7, { radius: 1, life: 1.5 })),
    'the ward contracts as it settles');
  const zone = cells('zone', 0.5, { radius: 2, life: 4 });
  assert.ok(zone.filter(point => point.char === '*' || point.char === '+').length >= 6);
  assert.notDeepEqual(zone, cells('zone', 0.55, { radius: 2, life: 4 }), 'the ward keeps turning');

  const projectile = frame('projectile', 0.35, 1.4, 0);
  assert.equal(projectile.filter(point => point.char === '*').length, 1, 'one plate core');
  assert.ok(projectile.filter(point => '_/\\|-'.includes(point.char)).length >= 8, 'a hexagonal plate outline');
  const wake = projectile.filter(point => (point.char === '.' || point.char === ':') && point.z < -0.4);
  assert.ok(wake.length >= 8, 'a frost wake trails behind');
  const nearest = wake.reduce((a, b) => (a.z > b.z ? a : b)), farthest = wake.reduce((a, b) => (a.z < b.z ? a : b));
  assert.ok(nearest.brightness > farthest.brightness, 'the wake recedes in brightness');
  assert.ok(projectile.length < frame('impact', 0.35).length / 3);
});

test('Ice Shield stages keep finite local ASCII geometry, a bounded draw budget, and a clean fade', () => {
  for (const stage of ['cast', 'impact', 'pulse', 'aura', 'zone', 'projectile']) {
    for (const radius of [0, 0.8, 40, NaN]) {
      for (const progress of [0.05, 0.3, 0.5, 0.9, 0.999]) {
        const points = frame(stage, progress, radius);
        assert.ok((points.length > 0 || progress > 0.95) && points.length <= BUDGET[stage], `${stage} respects the glyph budget`);
        for (const point of points) {
          assert.ok(Number.isFinite(point.x) && Number.isFinite(point.z));
          assert.ok(Math.abs(point.x) <= 5 && Math.abs(point.z) <= 5);
          assert.match(point.char, /^[\x21-\x7e]$/);
          assert.equal(point.color.length, 3);
          assert.ok(point.color.every(value => Number.isFinite(value) && value >= 0 && value <= 255));
          assert.ok(Number.isFinite(point.brightness) && point.brightness >= 0 && point.brightness <= 1);
        }
      }
    }
    for (let progress = 0; progress < 1; progress += 0.01) {
      assert.ok(frame(stage, progress, 2.4).length <= BUDGET[stage], `${stage} stays in budget through its life`);
    }
    assert.deepEqual(frame(stage, 1), []);
    const peak = Math.max(...frame(stage, 0.5).map(point => point.brightness));
    const final = Math.max(...frame(stage, 0.999).map(point => point.brightness));
    assert.ok(final < peak * 0.02, `${stage} fades before removal`);
  }
});

test('Ice Shield locks heavy slabs over a sustained dark ward resonance', () => {
  const { cast, impact, pulse } = presentation.sounds;
  assert.ok(cast.filter(v => v.kind === 'noise' && v.delay > 0.2).length >= 2, 'staggered slab locks');
  assert.ok(impact.some(v => v.kind === 'tone' && v.duration > 0.8), 'contact rings through the shield');
  assert.ok(cast.some(v => v.kind === 'tone' && v.frequency < 200), 'a low body anchors the spell');
  assert.notDeepEqual(cast, impact);
  assert.ok(pulse.reduce((sum, v) => sum + v.gain, 0) < cast.reduce((sum, v) => sum + v.gain, 0), 'repeat pulses stay beneath the cast');
  for (const voices of Object.values(presentation.sounds)) {
    assert.ok(voices.length > 0 && voices.length <= 8);
    for (const voice of voices) {
      assert.ok(['tone', 'noise'].includes(voice.kind));
      assert.ok(voice.delay >= 0 && voice.delay <= 2);
      assert.ok(voice.duration > 0 && voice.duration <= 2.5);
      assert.ok(voice.gain > 0 && voice.gain <= 0.25);
      assert.ok(voice.attack > 0 && voice.release > 0 && voice.attack + voice.release <= voice.duration);
      if (voice.kind === 'tone') assert.ok(voice.frequency >= 20 && voice.frequency <= 20000);
    }
  }
});
