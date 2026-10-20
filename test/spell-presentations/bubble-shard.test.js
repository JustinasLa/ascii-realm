import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/bubble-shard.js';
import spell from '../../src/spells/definitions/bubble-shard.js';
import { paintPresentation } from '../../src/spells/presentation.js';
import { playSpellSound } from '../../src/audio/spells.js';
import { toCells } from '../../src/entities/monsters.js';
import { runeScene } from '../../test-support/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';

const LIFE = { cast: presentation.duration, projectile: 10, impact: 0.6, pulse: 0.25, aura: 1.5, zone: 3 };
const BUDGET = { cast: 200, projectile: 110, impact: 200, pulse: 70, aura: 90, zone: 160 };
const G = 0.45; // where the cast bubble gathers, in front of the caster

function draw(stage, progress, { heading = 0, radius = 1, life = presentation.duration, x, y } = {}) {
  const points = [];
  presentation.draw({ stage, progress, age: life * progress, life, radius, heading, x, y },
    (...p) => points.push(p));
  return points;
}
// What the renderer actually shows: one glyph per cell, the last plot wins.
function cellAt(stage, age, life, mx, mz, heading = 0) {
  const cells = new Map();
  paintPresentation(presentation, { x: 0, y: 0, stage, age, life, radius: 1, heading },
    (x, y, char, color, brightness) => cells.set(`${Math.floor(x)},${Math.floor(y)}`, { char, color, brightness }));
  const [x, y] = toCells(mx * Math.cos(heading) + mz * Math.sin(heading), mz * Math.cos(heading) - mx * Math.sin(heading));
  return cells.get(`${Math.floor(x)},${Math.floor(y)}`);
}
const shown = cell => cell && cell.color.every(c => c >= 225) && cell.brightness > 0.65;
const at = (stage, age, options = {}) => draw(stage, age / LIFE[stage], { ...options, life: LIFE[stage] });
const lit = points => points.filter(p => p[4] > 0.05);
const glyphs = (points, chars) => lit(points).filter(p => chars.includes(p[2]));
const light = points => points.reduce((sum, p) => sum + p[4], 0);
const white = p => p[3].every(c => c >= 235);
const centroid = points => {
  const w = light(points);
  return [points.reduce((s, p) => s + p[0] * p[4], 0) / w, points.reduce((s, p) => s + p[1] * p[4], 0) / w];
};
// The main cast bubble's rim, in on-screen cells at heading 0 (26 columns, 6.5 rows per metre).
function rim(points) {
  const near = lit(points).filter(p => Math.abs(p[0]) < 0.6 && Math.abs(p[1] - G) < 0.9);
  const left = near.filter(p => p[2] === '('), right = near.filter(p => p[2] === ')');
  const top = near.filter(p => p[2] === '-'), bottom = near.filter(p => p[2] === '_');
  return {
    cols: (Math.max(...right.map(p => p[0])) - Math.min(...left.map(p => p[0]))) * 26,
    rows: (Math.max(...bottom.map(p => p[1])) - Math.min(...top.map(p => p[1]))) * 6.5,
  };
}

test('Bubble Shard cast inflates a screen-round film around a crystallising shard', () => {
  assert.equal(spell.presentation, presentation);
  assert.equal(presentation.id, spell.id);
  const early = draw('cast', 0.02), full = draw('cast', 0.11);
  const a = rim(early), b = rim(full);
  assert.ok(b.cols > a.cols * 1.3, 'the film inflates during the wind-up');
  assert.ok(b.cols / b.rows > 1.4 && b.cols / b.rows < 2.8, 'bubble reads round on screen, not as a flat ground ellipse');
  assert.ok(glyphs(full, ['o']).some(white), 'specular glint on the film');
  assert.ok(glyphs(full, ["'"]).length >= 3, 'curved highlight arc inside the rim');
  const tip = glyphs(full, ['v']);
  assert.equal(tip.length, 1, 'shard point aims forward along the heading');
  assert.ok(Math.abs(tip[0][0]) < 0.05 && tip[0][1] > G && tip[0][1] < G + 0.75, 'shard sits inside the bubble');
  assert.ok(glyphs(full, ['/']).length >= 3 && glyphs(full, ['\\']).length >= 3, 'shard has faceted edges');
  const motes = glyphs(draw('cast', 0.01), ['.', ':']).filter(p => Math.hypot(p[0], p[1] - G) > 0.6);
  assert.ok(motes.length >= 8, 'droplets converge on the gathering point first');
});

test('Bubble Shard release punches through the film with a flash, then sprays, rises, and pops', () => {
  const before = glyphs(draw('cast', 0.11), ['v'])[0], after = glyphs(draw('cast', 0.25), ['v'])[0];
  assert.ok(after[1] - before[1] > 0.5, 'the shard launches forward with easing');
  for (const heading of [0, 1.3, -2.4]) {
    for (const p of [0.13, 0.135, 0.15]) {
      const cell = cellAt('cast', p * LIFE.cast, LIFE.cast, 0, G, heading);
      assert.ok('@#'.includes(cell?.char) && shown(cell), `white release flash shows at the muzzle (${heading}, ${p})`);
    }
  }
  assert.equal(glyphs(draw('cast', 0.35), ['v']).length, 0, 'the shard has left the cast effect');
  const fast = glyphs(draw('cast', 0.25), ['/', '\\', '|', '-']).filter(p => Math.hypot(p[0], p[1] - G) > 0.5);
  assert.ok(fast.length >= 12, 'torn film streaks outward while it is fast');
  assert.ok(glyphs(draw('cast', 0.4), ["'", '.']).filter(p => Math.hypot(p[0], p[1] - G) > 0.5).length >= 12,
    'the streaks slow into droplets as drag catches them');
  const risen = glyphs(draw('cast', 0.6), ['(', ')', 'o']).filter(p => p[1] < G - 0.4);
  assert.ok(risen.length >= 3, 'leftover bubbles drift up the screen');
  let pops = 0;
  for (let p = 0.55; p < 0.95; p += 0.01) pops += glyphs(draw('cast', p), ['*']).filter(white).length;
  assert.ok(pops >= 3, 'leftover bubbles pop with a white snap');
  assert.ok(light(draw('cast', 0.95)) < light(draw('cast', 0.3)) * 0.25, 'the cast thins out gracefully');
});

test('Bubble Shard flight is a shard leading a wobbling film and a wake of bubbles', () => {
  const flight = at('projectile', 0.2);
  const front = Math.max(...flight.map(p => p[1]));
  assert.ok(flight.some(p => p[2] === 'v' && p[1] === front), 'the shard point leads the projectile');
  assert.ok(glyphs(flight, ['(']).length >= 2 && glyphs(flight, [')']).length >= 2, 'film sheath around the shard');
  assert.ok(lit(flight).some(p => p[1] < -1.2), 'wake trails well behind the head');
  assert.ok(flight.length <= BUDGET.projectile);
  const side = at('projectile', 0.2, { heading: Math.PI / 2 });
  assert.ok(side.some(p => p[2] === '>') && side.some(p => p[2] === '='), 'stroke glyphs follow the on-screen heading');
  let step = 0;
  for (let t = 0; t < 1; t += 1 / 60) {
    const [x0, z0] = centroid(at('projectile', t)), [x1, z1] = centroid(at('projectile', t + 1 / 60));
    step = Math.max(step, Math.hypot(x1 - x0, z1 - z0));
  }
  assert.ok(step < 0.08, `flight animates smoothly at 60 fps (largest step ${step.toFixed(3)} m)`);
});

test('Bubble Shard impact flashes, shatters, bursts the shell, splashes a crown, and ripples', () => {
  const hit = at('impact', 0);
  for (const heading of [0, 1.3, -2.4]) {
    for (const frame of [0, 1, 2, 3]) {
      const cell = cellAt('impact', frame / 60, LIFE.impact, 0, 0, heading);
      assert.ok('@#'.includes(cell?.char) && shown(cell),
        `the white impact flash survives the slivers and droplets on screen (${heading}, frame ${frame}: ${cell?.char})`);
    }
  }
  assert.ok(glyphs(hit, ['(', ')']).length >= 2, 'the bubble shell is still whole on contact');
  const shatter = at('impact', 0.25);
  assert.ok(glyphs(shatter, ['/', '\\', '|', '-']).filter(p => Math.hypot(p[0], p[1]) > 0.3).length >= 8,
    'shard slivers fly outward');
  assert.ok(glyphs(at('impact', 0.1), ["'"]).filter(p => p[1] < -0.25).length >= 4, 'crown droplets arc up');
  assert.ok(glyphs(at('impact', 0.3), ['~']).length >= 6, 'ground ripples spread');
  assert.ok(glyphs(at('impact', 0.3), ['(', ')']).length === 0 || light(at('impact', 0.3)) < light(hit),
    'the shell has burst open');
  let pops = 0;
  for (let t = 0.38; t < 0.6; t += 0.01) pops += glyphs(at('impact', t), ['*']).filter(white).length;
  assert.ok(pops >= 2, 'follow-through bubbles rise and pop');
});

test('Bubble Shard trail ticks and slow aura stay lean and distinct', () => {
  for (const radius of [1, 2]) {
    for (let p = 0; p <= 1; p += 0.05) assert.ok(draw('pulse', p, { radius, life: 0.25 }).length <= BUDGET.pulse);
  }
  assert.ok(glyphs(draw('pulse', 0.3, { life: 0.25 }), ['(', ')', 'o', '.']).length >= 3, 'shed beads swell');
  let pops = 0;
  for (let p = 0.4; p < 1; p += 0.02) pops += glyphs(draw('pulse', p, { life: 0.25 }), ['*']).length;
  assert.ok(pops >= 3, 'each bead pops in turn');
  assert.notDeepEqual(draw('pulse', 0.3, { x: 10, y: 4 }), draw('pulse', 0.3, { x: 200, y: 31 }),
    'ticks along the path vary deterministically by position');
  const cocoon = at('aura', 0.6);
  const left = Math.min(...glyphs(cocoon, ['(']).map(p => p[0])), right = Math.max(...glyphs(cocoon, [')']).map(p => p[0]));
  assert.ok(right - left > 0.6, 'a film cocoon wraps the slowed target');
  let drips = 0;
  for (let t = 0; t < 1.5; t += 0.05) drips += glyphs(at('aura', t), [',']).length;
  assert.ok(drips >= 3, 'drips slide off the cocoon');
  const [x0, z0] = centroid(at('aura', 0.6)), [x1, z1] = centroid(at('aura', 0.6 + 1 / 30));
  assert.ok(Math.hypot(x1 - x0, z1 - z0) < 0.03, 'the slowing film moves lazily');
});

test('all Bubble Shard stages use finite ASCII geometry, bounded light, budgets, and a complete fade', () => {
  const signatures = [];
  for (const stage of ['cast', 'projectile', 'impact', 'pulse', 'aura', 'zone']) {
    for (const heading of [0, 1.3, -2.4]) {
      for (const p of [0, 0.05, 0.15, 0.3, 0.5, 0.7, 0.9, 1]) {
        const points = draw(stage, p, { heading });
        assert.ok(points.length > 0 && points.length <= BUDGET[stage], `${stage} ${p} has ${points.length} glyphs`);
        assert.ok(points.every(([x, z, char, color, brightness]) =>
          Number.isFinite(x) && Number.isFinite(z) && Math.abs(x) < 4 && Math.abs(z) < 4
          && /^[\x20-\x7e]$/.test(char) && color.length === 3
          && color.every(c => Number.isFinite(c) && c >= 0 && c <= 255)
          && Number.isFinite(brightness) && brightness >= 0 && brightness <= 1));
        if (p === 1) assert.ok(points.every(point => point[4] === 0), `${stage} fades fully`);
      }
    }
    assert.notDeepEqual(draw(stage, 0.15), draw(stage, 0.5));
    assert.deepEqual(draw(stage, 0.42), draw(stage, 0.42), `${stage} is a pure function of the effect clock`);
    signatures.push(JSON.stringify(draw(stage, 0.3)));
  }
  assert.equal(new Set(signatures).size, 6, 'every stage has its own form');
});

test('bubbly sound uses three unevenly spaced falling plops and a softer rounded pop cluster', () => {
  for (const stage of ['cast', 'impact']) {
    const voices = presentation.sounds[stage], tones = voices.filter(v => v.kind === 'tone');
    assert.equal(tones.length, 3);
    assert.ok(tones.every(v => v.type === 'sine' && v.endFrequency < v.frequency && v.release > v.attack));
    assert.notEqual(tones[1].delay - tones[0].delay, tones[2].delay - tones[1].delay, 'irregular rhythm');
    assert.equal(new Set(tones.map(v => v.frequency)).size, 3, 'each bubble has a different pitch');
    assert.ok(voices.some(v => v.kind === 'noise' && v.gain < 0.025), 'soft film texture under the rounded tones');
    assert.ok(voices.length <= 8 && voices.every(v => v.gain <= 0.1 && v.duration <= 2.5 && (v.delay ?? 0) <= 2));
    const fake = fakeRecordedAudio();
    assert.equal(playSpellSound(fake.engine, { stage, presentation, x: 3, y: 7 }).length, voices.length);
    assert.ok(fake.routes.every(route => route.bus === 'sfx' && route.x === 3 && route.y === 7));
    const oscillators = fake.nodes.filter(node => node.kind === 'oscillator');
    assert.deepEqual(oscillators.map(node => node.starts[0] - fake.context.currentTime), tones.map(v => v.delay).map(delay => fake.context.currentTime + delay - fake.context.currentTime));
    assert.deepEqual(fake.invalid, []);
  }
  assert.notDeepEqual(presentation.sounds.cast, presentation.sounds.impact);
  assert.ok(presentation.sounds.pulse.every(v => v.gain < 0.02 && v.duration < 0.06), 'repeated projectile ticks stay quiet');
});

test('real Bubble Shard cast renders the profile, emits typed cues, and preserves damage and slowing', () => {
  const scene = runeScene(spell), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  assert.equal(scene.casting.mana, 96);
  assert.equal(scene.cast().ok, false);
  assert.equal(events.filter(e => e.stage === 'cast').length, 1, 'cooldown rejection is silent');
  const dots = [];
  scene.casting.effects.paint((...p) => dots.push(p), scene.casting.projectiles);
  assert.ok(dots.some(p => p[2] === '(') && dots.some(p => p[2] === 'o'), 'runtime paints authored film and bubbles');
  const projectile = scene.casting.projectiles[0], expected = [];
  paintPresentation(presentation, { x: projectile.x, y: projectile.y - projectile.h * 5,
    stage: 'projectile', age: projectile.age, life: projectile.life, radius: 0.65,
    heading: Math.atan2(projectile.dx, projectile.dz) }, (...p) => expected.push(p));
  assert.deepEqual(dots.slice(-expected.length), expected, 'runtime uses this profile for moving projectiles');
  scene.advance(0.15);
  assert.equal(scene.foe.health, 94);
  assert.ok(scene.aura(scene.foe, 'Slowed'));
  assert.ok(events.some(e => e.type === 'spell' && e.stage === 'impact'));
  assert.ok(events.every(e => e.type === 'spell' && e.spellId === spell.id && e.presentation === presentation));
  assert.ok(!events.some(e => ['draw', 'slam'].includes(e.type)));
});
