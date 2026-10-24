import assert from 'node:assert/strict';
import test from 'node:test';
import fireShard from '../src/spells/definitions/fire-shard.js';
import { paintPresentation } from '../src/spells/presentation.js';
import { SpellEffects } from '../src/spells/effects.js';
import { GameAudio } from '../src/audio/audio.js';
import { playSpellSound } from '../src/audio/spells.js';
import { runeScene } from '../test-support/spells.js';
import { fakeRecordedAudio } from '../test-support/recorded-audio.js';
import { prepareRecordedSpellTest } from '../test-support/spell-audio.js';

test('Fire Shard emits its authored cast/impact cues, never sword cues, and rejects silently', () => {
  const scene = runeScene(fireShard), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  assert.equal(scene.castWithoutMana().ok, false);
  assert.equal(events.filter(e => e.stage === 'cast').length, 1);
  scene.advance(0.3);
  assert.equal(scene.foe.health, 88, 'presentation preserves rune damage');
  assert.ok(events.some(e => e.type === 'spell' && e.stage === 'impact'));
  assert.ok(events.every(e => !['draw', 'slam'].includes(e.type)));
  assert.ok(events.every(e => e.presentation === fireShard.presentation));
});

test('Fire Shard draws distinct snapping launch, moving shard, and fracture burst geometry', () => {
  const signatures = [];
  for (const stage of ['cast', 'projectile', 'impact']) {
    const points = [];
    paintPresentation(fireShard.presentation, { x: 0, y: 0, stage, age: 0.12, life: 0.55, radius: 1 }, (...point) => points.push(point));
    assert.ok(points.length >= 10 && points.length <= 256);
    assert.ok(points.flatMap(p => [p[0], p[1], p[4], ...p[3]]).every(Number.isFinite));
    signatures.push(JSON.stringify(points));
  }
  assert.equal(new Set(signatures).size, 3);
  for (const stage of ['cast', 'impact']) {
    const start = [], end = [];
    paintPresentation(fireShard.presentation, { x: 0, y: 0, stage, age: 0, life: 0.55 }, (...p) => start.push(p));
    paintPresentation(fireShard.presentation, { x: 0, y: 0, stage, age: 0.55, life: 0.55 }, (...p) => end.push(p));
    assert.notDeepEqual(start, end, 'authored geometry moves over time');
    assert.ok(end.every(p => p[4] === 0), 'casting and fracture fade completely');
  }
});

test('Fire Shard projectile head, facets, and ember wake fade throughout their final lifetime', () => {
  const frames = [0, 0.999, 1].map(age => {
    const points = [];
    paintPresentation(fireShard.presentation, { x: 0, y: 0, stage: 'projectile', age, life: 1 }, (...point) => points.push(point));
    return points;
  });
  assert.ok(frames[0].length > 10, 'test includes the head, facets, and both wake strands');
  assert.ok(frames.every(frame => frame.length === frames[0].length));
  assert.ok(frames[0].every(point => point[4] > 0), 'projectile is readable at launch');
  assert.ok(frames[1].every((point, index) => point[4] > 0 && point[4] < frames[0][index][4] * 0.01), 'every glyph dims near expiry');
  assert.ok(frames[2].every(point => point[4] === 0), 'no head, facet, or ember remains bright at expiry');
});

test('presentation adapter rotates local metre geometry and bounds malformed output', () => {
  const points = [];
  const profile = { duration: NaN, draw(state, plot) {
    assert.ok(Number.isFinite(state.life));
    plot(NaN, 0, '*', [255, 255, 255]);
    plot(1000, 0, '*', [255, 255, 255]);
    plot(0, 1, '^', [500, -5, 100], 20);
    for (let i = 0; i < 500; i++) plot(0, 1, '^', [255, 200, 100]);
  } };
  const count = paintPresentation(profile, { x: 10, y: 20, stage: 'cast', heading: Math.PI / 2 }, (...p) => points.push(p), 5);
  assert.equal(count, 5);
  assert.ok(points[0][0] > 10);
  assert.ok(Math.abs(points[0][1] - 20) < 1e-9);
  assert.deepEqual(points[0].slice(3), [[255, 0, 100], 1]);
});

test('effects renderer uses projectile profiles and clears on pause/reset/death', () => {
  const scene = runeScene(fireShard), events = [];
  scene.casting.onSound = event => events.push(event);
  scene.cast();
  const dots = [];
  scene.casting.effects.paint((...p) => dots.push(p), scene.casting.projectiles);
  assert.ok(dots.some(p => p[2] === 'v'), 'the shard tip points along its southward flight');
  scene.casting.setPresentationPaused(true);
  assert.equal(scene.casting.effects.list.length, 0);
  const pausedDots = [];
  scene.casting.effects.paint((...p) => pausedDots.push(p), scene.casting.projectiles);
  assert.equal(pausedDots.length, 0);
  assert.equal(events.at(-1).type, 'spell-stop');
  scene.casting.setPresentationPaused(false);
  scene.casting.reset();
  assert.equal(scene.casting.projectiles.length, 0);
  scene.cast(); scene.player.vitals.health = 0; scene.advance(0.05);
  assert.equal(scene.casting.effects.list.length, 0);
  assert.equal(events.at(-1).type, 'spell-stop');
});

test('source visual spam is sound-limited and retained effects stay bounded', () => {
  const scene = runeScene(fireShard), events = [];
  scene.casting.onSound = event => events.push(event);
  const ctx = scene.casting.context(fireShard, scene.casting.variant(fireShard), scene.player);
  for (let i = 0; i < 300; i++) scene.casting.present(ctx, scene.player, 'pulse');
  assert.equal(events.length, 1);
  assert.equal(scene.casting.effects.list.length, 160);
  let count = 0;
  scene.casting.effects.paint(() => count++);
  assert.ok(count <= 4096);
});

test('spell voices use SFX routing and stop delayed layers by casting owner', async () => {
  const fake = fakeRecordedAudio(), audio = new GameAudio({}, fake.engine), owner = {};
  await prepareRecordedSpellTest(fake, fireShard);
  const handles = audio.play({ type: 'spell', stage: 'cast', presentation: fireShard.presentation, x: 3, y: 7, owner });
  assert.equal(handles.length, fireShard.presentation.sounds.cast.length);
  assert.ok(fake.routes.every(r => r.bus === 'sfx' && r.x === 3 && r.y === 7));
  assert.ok(fake.nodes.some(n => n.starts[0] > fake.context.currentTime));
  audio.play({ type: 'spell-stop', owner });
  assert.ok(handles.every(h => h.ended));
  assert.ok(fake.routes.every(r => r.disposals === 1));
  assert.equal(audio.effects.size, 0);
  assert.equal(audio.spellEffects.size, 0);
  assert.deepEqual(fake.invalid, []);
});

test('locked sound stays silent and malformed layered recipes remain finite and bounded', () => {
  const fake = fakeRecordedAudio();
  fake.context.state = 'suspended';
  assert.deepEqual(playSpellSound(fake.engine, { x: 0, y: 0, stage: 'cast', presentation: fireShard.presentation }), []);
  assert.equal(fake.nodes.length, 0);
  fake.context.state = 'running';
  const presentation = { sounds: { cast: Array.from({ length: 100 }, () => ({ kind: 'tone', duration: Infinity, delay: Infinity, frequency: NaN, gain: Infinity })) } };
  const handles = playSpellSound(fake.engine, { x: 0, y: 0, stage: 'cast', presentation });
  assert.equal(handles.length, 8);
  assert.deepEqual(fake.invalid, []);
  for (const handle of handles) handle.stop();
});

test('unconverted spells retain the generic bounded renderer', () => {
  const effects = new SpellEffects(); effects.add({ x: 0, y: 0 });
  const dots = []; effects.paint((...p) => dots.push(p));
  assert.ok(dots.length >= 12 && dots.every(p => p[2] === '*'));
});
