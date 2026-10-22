import assert from 'node:assert/strict';
import test from 'node:test';
import profile from '../../src/spells/presentations/drowning-prison.js';
import spell from '../../src/spells/definitions/drowning-prison.js';
import { paintPresentation } from '../../src/spells/presentation.js';
import { runeScene } from '../../test-support/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';
import { GameAudio } from '../../src/audio/audio.js';

// The runtime stages as Drowning Prison actually raises them: the cast flash, the
// flying capsule, the converging tide (r 3-4), the 4 s hold around the target
// (r 0.1), the slow lock, the bubble ticks and the drowning damage.
const STAGES = {
  cast: { radius: 0.8, life: 1.2, budget: 200 },
  projectile: { radius: 0.65, life: 10, budget: 110 },
  tide: { stage: 'zone', radius: 4, life: 1, budget: 160 },
  hold: { stage: 'zone', radius: 0.1, life: 4, budget: 160 },
  aura: { radius: 1, life: 0.3, budget: 160 },
  pulse: { radius: 1, life: 0.25, budget: 90 },
  impact: { radius: 1, life: 0.6, budget: 200 },
};

const capture = (name, progress = 0.2, heading = 0) => {
  const { stage = name, radius, life } = STAGES[name], points = [];
  profile.draw({ stage, progress, age: progress * life, life, radius, heading },
    (x, z, char, color, brightness = 1) => points.push({ x, z, char, color, brightness }));
  return points;
};
const lit = points => points.filter(point => point.brightness > 0.05);
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
// Screen cells through the real adapter, which applies the world heading.
const screen = (name, progress, heading) => {
  const { stage = name, radius, life } = STAGES[name], cells = [];
  paintPresentation(profile, { x: 0, y: 0, stage, age: progress * life, life, radius, heading },
    (x, y, char, color, brightness) => cells.push(`${Math.round(x)},${Math.round(y)},${char},${brightness.toFixed(2)}`));
  return cells;
};

test('the hold seals a rotating barred water globe around the target', () => {
  assert.equal(spell.presentation, profile);
  const globe = capture('hold', 0.4);
  const skin = globe.filter(point => '-|/\\'.includes(point.char));
  // The globe is round on screen: twice as many z metres as x metres, centred above the feet.
  const width = Math.max(...skin.map(point => Math.abs(point.x)));
  const top = Math.min(...skin.map(point => point.z)), bottom = Math.max(...skin.map(point => point.z));
  assert.ok(width > 0.8 && width < 1.1, 'the globe spans the target');
  assert.ok(Math.abs((bottom - top) / 2 / width - 2.15) < 0.3, 'the skin reads as a circle on screen');
  assert.ok(top < -3.3 && bottom > 0, 'it encloses the target from the feet to above the head');
  for (const char of ['-', '|', '/', '\\']) assert.ok(skin.some(point => point.char === char), `outline uses ${char}`);
  const bars = globe.filter(point => point.char === '|' && Math.abs(point.x) < width * 0.8);
  assert.ok(bars.length >= 16, 'vertical bars run through the interior');
  assert.ok(globe.some(point => point.char === '='), 'an equatorial band locks the bars');
  const later = capture('hold', 0.45).filter(point => point.char === '|' && Math.abs(point.x) < width * 0.8);
  assert.notDeepEqual(bars.map(point => point.x.toFixed(2)), later.map(point => point.x.toFixed(2)), 'the cage rotates');
  // Bubbles rise inside and widen as they near the crown.
  const bubbles = globe.filter(point => '.oO'.includes(point.char) && point.brightness > 0.05);
  const height = char => mean(bubbles.filter(point => point.char === char).map(point => point.z));
  assert.ok(bubbles.length >= 6);
  assert.ok(height('O') < height('.'), 'large bubbles sit above small ones');
});

test('cage bars fade out at the rim instead of popping off as the globe turns', () => {
  // A popping bar used to drop about 16 glyphs and 7 units of light within 5 ms.
  const light = age => capture('hold', age / 4).reduce((sum, point) => sum + point.brightness, 0);
  let previous = light(0.5), worst = 0;
  for (let age = 0.505; age < 3.4; age += 0.005) {
    const current = light(age);
    worst = Math.max(worst, Math.abs(current - previous));
    previous = current;
  }
  assert.ok(worst < 1, `the settled globe changes by at most ${worst.toFixed(2)} light per 5 ms`);
});

test('the globe builds from the ground up, then bursts into falling droplets', () => {
  const forming = lit(capture('hold', 0.03)), held = lit(capture('hold', 0.5));
  assert.ok(forming.length > 10 && forming.length < held.length * 0.7, 'the walls are still climbing');
  assert.ok(mean(forming.map(point => point.z)) > mean(held.map(point => point.z)), 'water rises from the base');
  const early = lit(capture('hold', 0.93)), late = lit(capture('hold', 0.97));
  assert.ok(early.every(point => '.,-|/\\~()'.includes(point.char)), 'only droplets and splash crests remain');
  assert.ok(mean(late.map(point => point.z)) > mean(early.map(point => point.z)), 'droplets fall');
  assert.ok(Math.max(...late.map(point => Math.abs(point.x))) > Math.max(...held.map(point => Math.abs(point.x))), 'the skin flies apart');
  assert.ok(mean(late.map(point => point.brightness)) < mean(early.map(point => point.brightness)));
});

test('the globe stays upright on screen whatever the cast heading', () => {
  for (const progress of [0.03, 0.4, 0.95]) assert.deepEqual(screen('hold', progress, 1.2), screen('hold', progress, 0));
  assert.deepEqual(screen('impact', 0.2, -2), screen('impact', 0.2, 0));
  assert.deepEqual(screen('pulse', 0.5, 2.5), screen('pulse', 0.5, 0));
});

test('the tide converges on the target before the globe forms', () => {
  const radial = points => mean(lit(points).map(point => Math.hypot(point.x, point.z)));
  const outer = capture('tide', 0.15), inner = capture('tide', 0.5);
  assert.ok(radial(outer) > radial(inner) + 0.6, 'crests and streams rush inward');
  assert.ok(outer.some(point => point.char === '~') && outer.some(point => '()'.includes(point.char)), 'crests read as ripples');
  const spout = lit(capture('tide', 0.6)).filter(point => "'.".includes(point.char));
  assert.ok(spout.some(point => point.z < -0.6), 'water climbs where the rings meet');
});

test('the cast gathers water, squashes in anticipation and hurls it down the heading', () => {
  const gather = lit(capture('cast', 0.06)), hand = { x: 0, z: 0.55 - 1.9 };
  assert.ok(gather.some(point => Math.hypot(point.x, point.z) > 0.9), 'droplets leave the ground');
  const orb = shape => {
    const skin = lit(capture('cast', shape)).filter(point => '-|/\\'.includes(point.char)
      && Math.abs(point.z - hand.z) < 0.6 && Math.abs(point.x) < 0.45);
    return { w: Math.max(...skin.map(point => Math.abs(point.x))), h: Math.max(...skin.map(point => Math.abs(point.z - hand.z))) };
  };
  const round = orb(0.1), squashed = orb(0.14);
  assert.ok(squashed.w / squashed.h > round.w / round.h * 1.2, 'the orb squashes before release');
  const jet = lit(capture('cast', 0.3)).filter(point => point.z > 0.8);
  assert.ok(jet.length >= 12, 'the jet runs forward along the heading');
  // Through the adapter the jet turns with the heading while the screen stays upright.
  const jetCells = heading => {
    const cells = [];
    paintPresentation(profile, { x: 0, y: 0, stage: 'cast', age: 0.36, life: 1.2, radius: 0.8, heading },
      (x, y, char, color, brightness) => { if (brightness > 0.3 && '|-/\\'.includes(char)) cells.push({ x, y }); });
    return { x: mean(cells.map(point => point.x)), y: mean(cells.map(point => point.y)) };
  };
  assert.ok(jetCells(Math.PI / 2).x - jetCells(-Math.PI / 2).x > 40, 'east and west casts throw sideways');
  assert.ok(jetCells(0).y - jetCells(Math.PI).y > 10, 'south and north casts throw down and up');
  const settle = lit(capture('cast', 0.8));
  assert.ok(settle.length > 0 && settle.every(point => '.,\'~-()/\\|'.includes(point.char)), 'ripples and drips follow through');
});

test('the capsule flies as a small barred bubble trailing a braided wake', () => {
  const projectile = capture('projectile', 0.01);
  const body = projectile.filter(point => Math.abs(point.z) < 0.65 && Math.abs(point.x) < 0.35);
  assert.ok(body.some(point => point.char === '|') && body.some(point => '-/\\'.includes(point.char)));
  const wake = projectile.filter(point => point.z < -0.7);
  assert.ok(wake.length >= 20 && wake.every(point => point.z < 0), 'the wake trails behind the flight');
  assert.ok(projectile.every(point => Math.abs(point.x) < 0.6 && point.z > -4 && point.z < 0.75));
});

test('each drowning tick squeezes the globe with a flash and forces out a last breath', () => {
  const skin = progress => capture('impact', progress).filter(point => point.char === '|' && Math.abs(point.z + 1.75) < 0.4);
  const span = progress => Math.max(...skin(progress).map(point => Math.abs(point.x)));
  assert.ok(span(0.14) < span(0) - 0.08, 'the globe crushes inward');
  assert.ok(span(0.4) > span(0.14), 'and springs back');
  const flash = capture('impact', 0.01).filter(point => point.color.every(channel => channel > 220));
  assert.ok(flash.length > 20, 'the first frame flashes white');
  const breath = capture('impact', 0.3).filter(point => '@O'.includes(point.char));
  assert.ok(breath.length >= 3 && breath.some(point => point.z < -3.5), 'big bubbles burst out of the crown');
  const spray = lit(capture('impact', 0.5)).filter(point => "'.,".includes(point.char));
  assert.ok(spray.length >= 10, 'water is thrown off the crown');
});

test('the slow snaps two shackle hoops shut and the ticks bubble up through the crown', () => {
  const span = progress => Math.max(...capture('aura', progress).map(point => Math.abs(point.x)));
  assert.ok(span(0) > span(0.6) * 2);
  assert.ok(capture('aura', 0.6).filter(point => point.char === '+').length === 2, 'both locks close');
  const pulse = lit(capture('pulse', 0.6));
  assert.ok(pulse.filter(point => 'oO*'.includes(point.char)).length >= 3);
  assert.ok(pulse.filter(point => point.char === '~').every(point => point.z < -3.5), 'the ripple runs over the crown');
});

test('every stage is deterministic, moves, stays finite and within its plot budget, and fades fully', () => {
  for (const [name, { budget }] of Object.entries(STAGES)) {
    assert.deepEqual(capture(name), capture(name));
    assert.notDeepEqual(capture(name, 0.1), capture(name, 0.7));
    for (let step = 0; step <= 40; step++) {
      const progress = name === 'projectile' ? step / 4000 : step / 40;
      const points = capture(name, progress);
      assert.ok(points.length <= budget, `${name} at ${progress} plots ${points.length}`);
      if (progress === 1) assert.ok(points.every(point => point.brightness === 0), `${name} fades out`);
      for (const point of points) {
        assert.ok([point.x, point.z, point.brightness, ...point.color].every(Number.isFinite));
        assert.ok(Math.abs(point.x) < 6 && Math.abs(point.z) < 6);
        assert.ok(point.brightness >= 0 && point.brightness <= 1);
        assert.ok(point.color.every(channel => channel >= 0 && channel <= 255));
        assert.match(point.char, /^[\x20-\x7e]$/);
      }
    }
    assert.ok(lit(capture(name, name === 'projectile' ? 0.01 : 0.3)).length > 0, `${name} is visible mid-life`);
  }
});

test('the sound phrase combines a hollow gong, accelerating rising bubbles and a low pressure close', () => {
  const { cast, impact, pulse } = profile.sounds;
  const gong = cast.filter(voice => !voice.delay && voice.kind === 'tone');
  assert.equal(gong.length, 2, 'two unequal partials make the submerged gong');
  assert.ok(gong.every(voice => voice.duration > 0.6 && voice.release > 0.6));
  const bubbles = cast.filter(voice => voice.kind === 'tone' && voice.delay > 0);
  assert.ok(bubbles.length >= 3);
  assert.ok(bubbles.every(voice => voice.endFrequency > voice.frequency));
  assert.ok(bubbles[2].delay - bubbles[1].delay < bubbles[1].delay - bubbles[0].delay, 'bubble rhythm accelerates');
  assert.ok(bubbles.every((voice, index) => index === 0 || voice.frequency > bubbles[index - 1].frequency));
  assert.ok(impact.some(voice => voice.endFrequency < 60 && voice.attack >= 0.05), 'closing pressure is a rounded bass fall');
  assert.ok(impact.some(voice => voice.kind === 'noise' && voice.cutoff < 500));
  assert.ok(pulse.every(voice => voice.gain <= 0.025 && voice.duration <= 0.15), 'hold ticks stay quiet and brief');
  for (const voices of Object.values(profile.sounds)) {
    assert.ok(voices.length >= 3 && voices.length <= 6);
    assert.ok(voices.some(voice => voice.kind === 'tone') && voices.some(voice => voice.kind === 'noise'), 'each stage mixes submerged resonance and water texture');
    assert.ok(voices.reduce((sum, voice) => sum + voice.gain, 0) <= 0.45, 'layer peaks leave mix headroom');
    for (const voice of voices) {
      assert.ok(voice.gain > 0 && voice.gain <= 0.25);
      assert.ok(voice.duration > 0 && voice.duration <= 2.5);
      assert.ok((voice.delay ?? 0) >= 0 && (voice.delay ?? 0) <= 2);
      assert.ok(voice.attack > 0 && voice.decay > 0 && voice.release > 0);
      assert.ok(voice.sustain > 0 && voice.sustain < 1);
      assert.ok(voice.attack + voice.decay + voice.release <= voice.duration, 'authored envelope fits its voice without runtime clamping');
      assert.ok(Object.values(voice).filter(value => typeof value === 'number').every(Number.isFinite));
    }
  }
});

test('a real rune cast renders its profile and emits spell cues while preserving hold and damage', () => {
  const scene = runeScene(spell, { range: 20 }), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  assert.equal(scene.castWithoutMana().ok, false);
  assert.equal(events.filter(event => event.stage === 'cast').length, 1);
  const flying = [];
  scene.casting.effects.paint((...point) => flying.push(point), scene.casting.projectiles);
  assert.ok(flying.some(point => point[2] === '|') && flying.some(point => "'.o".includes(point[2])));
  scene.advance(0.7);
  assert.equal(scene.foe.magicSpeed, 0);
  const held = [];
  scene.casting.effects.paint((...point) => held.push(point), scene.casting.projectiles);
  assert.ok(held.some(point => point[2] === '=') && held.some(point => point[2] === '|'), 'the runtime paints the globe during confinement');
  scene.advance(4);
  assert.equal(scene.foe.health, 76);
  assert.ok(events.some(event => event.type === 'spell' && event.stage === 'impact'));
  assert.ok(events.some(event => event.type === 'spell' && event.stage === 'pulse'));
  assert.ok(events.every(event => event.presentation === profile && !['draw', 'slam'].includes(event.type)));
});

test('the authored layers run through spatial SFX without invalid audio parameters', () => {
  const fake = fakeRecordedAudio(), audio = new GameAudio({}, fake.engine), owner = {};
  for (const stage of ['cast', 'impact', 'pulse']) {
    const handles = audio.play({ type: 'spell', stage, presentation: profile, owner, x: 4, y: 12 });
    assert.equal(handles.length, profile.sounds[stage].length);
  }
  assert.ok(fake.routes.every(route => route.bus === 'sfx' && route.x === 4 && route.y === 12));
  assert.ok(fake.nodes.some(node => node.starts[0] > fake.context.currentTime));
  assert.deepEqual(fake.invalid, []);
  audio.play({ type: 'spell-stop', owner });
  assert.ok(fake.routes.every(route => route.disposals === 1));
});
