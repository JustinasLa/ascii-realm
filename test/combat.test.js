import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Combat, SWORD_SIDE } from '../src/entities/combat.js';
import { getWeapon, MATERIAL_IDS, WEAPON_IDS } from '../src/entities/weapons.js';

const DT = 0.01;
const GROUND = { moving: false, running: false, air: 0 };
const STRIKES = new Set(['slash', 'thrust', 'slam', 'chop', 'backstab', 'projectile', 'bash', 'magic']);
const strikes = (events) => events.filter((event) => STRIKES.has(event.type));

function assertPose(combat) {
  for (const key of ['hand', 'blade']) {
    assert.equal(combat.pose[key].length, 3, `${combat.weaponId}: ${key} has three coordinates`);
    assert.ok(combat.pose[key].every(Number.isFinite), `${combat.weaponId}: finite ${key}`);
  }
  assert.ok(Math.abs(Math.hypot(...combat.pose.blade) - 1) < 1e-9,
    `${combat.weaponId}: blade direction stays normalized`);
  for (const key of ['twist', 'lean', 'crouch', 'off']) {
    assert.ok(Number.isFinite(combat.pose[key]), `${combat.weaponId}: finite ${key}`);
  }
  assert.ok(combat.stamina >= 0 && combat.stamina <= combat.maxStamina,
    `${combat.weaponId}: bounded stamina ${combat.stamina}`);
  assert.ok(Number.isFinite(combat.active), `${combat.weaponId}: finite animation weight`);
  assert.ok(Number.isFinite(combat.motion.forward), `${combat.weaponId}: finite forward motion`);
  assert.ok(Number.isFinite(combat.motion.turn), `${combat.weaponId}: finite turn motion`);
}

function tick(combat, dt = DT, context = GROUND) {
  combat.update(dt, context);
  assertPose(combat);
  return combat.events.splice(0);
}

function advance(combat, seconds, context = GROUND) {
  const events = [];
  const count = Math.ceil(seconds / DT);
  for (let frame = 0; frame < count; frame++) {
    events.push(...tick(combat, Math.min(DT, seconds - frame * DT), context));
  }
  return events;
}

function finish(combat, context = GROUND, timeout = 8) {
  const events = combat.events.splice(0);
  for (let frame = 0; combat.busy && frame < Math.ceil(timeout / DT); frame++) {
    events.push(...tick(combat, DT, context));
  }
  assert.equal(combat.busy, false, `${combat.weaponId}: ${combat.moveName} finishes within ${timeout}s`);
  return events;
}

function drawn(id = 'greatsword', material = 'steel') {
  const combat = new Combat(id, material);
  combat.toggle();
  assert.equal(strikes(finish(combat)).length, 0, `${id}: drawing does not strike`);
  assert.equal(combat.inHand, true, `${id}: weapon is drawn`);
  return combat;
}

function oneStrike(combat, events, move) {
  const hits = strikes(events);
  assert.equal(hits.length, 1, `${combat.weaponId}: ${move} emits one strike, got ${hits.map((e) => e.type)}`);
  const hit = hits[0];
  assert.equal(hit.weapon, combat.weaponId);
  assert.equal(hit.material, combat.material);
  assert.equal(hit.move, move);
  for (const key of ['damage', 'reach', 'strength']) {
    assert.ok(Number.isFinite(hit[key]) && hit[key] > 0,
      `${combat.weaponId}: ${move} has positive finite ${key}`);
  }
  assert.deepEqual(hit.trailColor, combat.weapon.trailColor);
  if (hit.type === 'projectile') {
    assert.ok(hit.projectile && typeof hit.projectile === 'object', 'projectile launch data is present');
  }
  if (hit.projectile) {
    assert.equal(typeof hit.projectile.kind, 'string');
    for (const key of ['speed', 'gravity', 'lifetime', 'range']) {
      assert.ok(Number.isFinite(hit.projectile[key]) && hit.projectile[key] >= 0,
        `${combat.weaponId}: finite projectile ${key}`);
    }
    assert.ok(hit.projectile.speed > 0);
    assert.ok(hit.projectile.lifetime > 0);
    assert.ok(hit.projectile.range > 0);
  }
  return hit;
}

test('default combat keeps the steel greatsword and legacy sword side', () => {
  const combat = new Combat();
  assert.equal(SWORD_SIDE, -1);
  assert.equal(combat.weaponId, 'greatsword');
  assert.equal(combat.material, 'steel');
  assert.equal(combat.inHand, false);
  assert.equal(combat.busy, false);
  assert.equal(combat.stamina, combat.maxStamina);
  tick(combat);
});

test('each weapon and material has an immutable, complete combat profile', () => {
  assert.deepEqual(MATERIAL_IDS, ['stone', 'copper', 'bronze', 'iron', 'steel']);
  assert.equal(new Set(WEAPON_IDS).size, 9);
  for (const id of WEAPON_IDS) {
    let previousDamage = 0;
    for (const material of MATERIAL_IDS) {
      const weapon = getWeapon(id, material);
      assert.equal(weapon.id, id);
      assert.equal(weapon.material, material);
      for (const key of ['damage', 'reach', 'speed', 'staminaCost', 'weight']) {
        assert.ok(Number.isFinite(weapon[key]) && weapon[key] > 0, `${id}/${material}: ${key}`);
      }
      assert.ok([1, 2].includes(weapon.hands), `${id}: hand count`);
      assert.ok(weapon.spriteParts.length > 0, `${id}: ASCII rig parts`);
      assert.ok(['back', 'hip', 'quiver'].includes(weapon.sheath.mount), `${id}: body mount`);
      assert.equal(weapon.trailColor.length, 3);
      assert.ok(weapon.trailColor.every((value) => Number.isFinite(value) && value >= 0 && value <= 255));
      assert.ok(weapon.damage > previousDamage, `${id}: material upgrades increase damage`);
      previousDamage = weapon.damage;
      assert.ok(weapon.combo.length > 0, `${id}: light combo`);
      for (const move of [...weapon.combo, weapon.sprintAttack, weapon.airAttack, weapon.chargedAttack]) {
        assert.equal(typeof move, 'string', `${id}: move names are defined`);
        assert.ok(move.length > 0);
      }
      assert.ok(Object.isFrozen(weapon));
      assert.ok(Object.isFrozen(weapon.stats));
      assert.ok(Object.isFrozen(weapon.combo));
      assert.ok(Object.isFrozen(weapon.trailColor));
    }
  }
  assert.equal(getWeapon('unknown', 'unknown').id, 'greatsword');
  assert.equal(getWeapon('unknown', 'unknown').material, 'steel');
  assert.equal(getWeapon('dagger').sheath.mount, 'hip');
  assert.equal(getWeapon('bow').sheath.mount, 'quiver');
  assert.equal(getWeapon('hammer').sheath.mount, 'back');
});

test('draw and sheathe approach each weapon\'s actual hilt on its body mount', () => {
  const distance = (a, b) => Math.hypot(...a.map((value, index) => value - b[index]));
  const direction = (vector) => vector.map((value) => value / Math.hypot(...vector));
  const checkHilt = (combat, elapsed, action) => {
    const targetHand = combat.weapon.sheath.hand;
    const targetBlade = direction(combat.weapon.sheath.blade);
    const handGap = distance(combat.pose.hand, targetHand);
    const bladeGap = distance(combat.pose.blade, targetBlade);
    tick(combat, elapsed);
    const label = `${combat.weaponId}: ${action} reaches its ${combat.weapon.sheath.mount} hilt`;
    assert.ok(distance(combat.pose.hand, targetHand) < handGap * 0.03, `${label} with the hand`);
    assert.ok(distance(combat.pose.blade, targetBlade) < bladeGap * 0.03, `${label} with the blade`);
  };
  for (const id of WEAPON_IDS) {
    const combat = new Combat(id);
    tick(combat);
    combat.toggle();
    checkHilt(combat, 0.13 / combat.weapon.speed, 'drawing');
    assert.equal(combat.step, 0, `${id}: the draw is still at the hilt`);
    finish(combat);
    combat.toggle();
    tick(combat, 0.16 / combat.weapon.speed);
    assert.equal(combat.step, 1, `${id}: sheathing returns from the free pose to the hilt`);
    checkHilt(combat, 0.15 / combat.weapon.speed, 'sheathing');
    finish(combat);
    assert.equal(combat.inHand, false);
  }
});

test('holding run while stationary keeps taps and immediate attacks in the light combo', () => {
  for (const id of WEAPON_IDS) {
    const held = drawn(id);
    const context = { ...GROUND, running: true, moving: false, held: true };
    assert.equal(held.attack(context), true);
    advance(held, 0.05, context);
    assert.equal(held.release({ ...context, held: false }), true);
    const hit = oneStrike(held, finish(held, { ...context, held: false }), held.weapon.combo[0]);
    assert.equal(hit.charged, false);
    const immediate = drawn(id);
    assert.equal(immediate.attack({ running: true, moving: false }), true);
    tick(immediate, 0.001, { ...GROUND, running: true, moving: false });
    oneStrike(immediate, finish(immediate), immediate.weapon.combo[0]);
  }
});

for (const id of WEAPON_IDS) {
  test(`${id}: every light-combo move completes and reports its own strike`, () => {
    const combat = drawn(id);
    for (const move of combat.weapon.combo) {
      assert.equal(combat.attack(), true, `${id}: accepts ${move}`);
      oneStrike(combat, finish(combat), move);
    }
  });

  test(`${id}: each material tier delivers a stronger first strike`, () => {
    let previousDamage = 0;
    for (const material of MATERIAL_IDS) {
      const combat = drawn(id, material);
      combat.attack();
      const hit = oneStrike(combat, finish(combat), combat.weapon.combo[0]);
      assert.ok(hit.damage > previousDamage, `${id}/${material}: delivered damage improves`);
      previousDamage = hit.damage;
    }
  });

  test(`${id}: running selects the sprint attack`, () => {
    const combat = drawn(id);
    assert.equal(combat.attack({ running: true, moving: true }), true);
    const events = [];
    let advances = false;
    for (let frame = 0; combat.busy && frame < 800; frame++) {
      advances ||= combat.motion.forward > 0;
      events.push(...tick(combat, DT, { ...GROUND, running: true, moving: true }));
    }
    assert.equal(combat.busy, false);
    assert.equal(advances, true, `${id}: sprint strike drives the warrior forwards`);
    oneStrike(combat, events, combat.weapon.sprintAttack);
  });

  test(`${id}: airborne attack uses the weapon's air moveset`, () => {
    const combat = drawn(id);
    assert.equal(combat.attack({ air: 0.5 }), true);
    const airborneEvents = advance(combat, 1.5, { ...GROUND, air: 0.5 });
    if (id === 'bow' || id === 'javelin') {
      const events = [...airborneEvents, ...finish(combat, { ...GROUND, air: 0.5 })];
      assert.equal(oneStrike(combat, events, combat.weapon.airAttack).type, 'projectile');
    } else {
      assert.equal(strikes(airborneEvents).length, 0, `${id}: no plunge impact before landing`);
      assert.equal(combat.busy, true, `${id}: holds the plunge until landing`);
      oneStrike(combat, finish(combat), combat.weapon.airAttack);
    }
  });

  test(`${id}: holding charges, releasing executes the charged moveset`, () => {
    const combat = drawn(id);
    assert.equal(combat.attack({ held: true }), true);
    assert.equal(combat.charging, true);
    assert.equal(strikes(advance(combat, 2, { ...GROUND, held: true })).length, 0,
      `${id}: a held charge does not fire`);
    assert.equal(combat.charge, 1, `${id}: charge caps at full strength`);
    assert.equal(combat.release(), true);
    const hit = oneStrike(combat, finish(combat), combat.weapon.chargedAttack);
    assert.equal(hit.charged, true);
    assert.equal(combat.charging, false);
    assert.equal(combat.charge, 0, `${id}: released charge does not leak into the next action`);
  });
}

test('material tiers affect delivered damage, stamina cost, and attack timing', () => {
  const stone = drawn('spear', 'stone');
  const steel = drawn('spear', 'steel');
  stone.attack();
  steel.attack();
  assert.ok(stone.stamina < steel.stamina, 'stone spends more stamina');
  const duration = (combat) => {
    const events = [];
    let frames = 0;
    while (combat.busy && frames < 800) {
      events.push(...tick(combat));
      frames++;
    }
    assert.equal(combat.busy, false);
    return { frames, hit: oneStrike(combat, events, combat.weapon.combo[0]) };
  };
  const stoneResult = duration(stone);
  const steelResult = duration(steel);
  assert.ok(stoneResult.frames > steelResult.frames, 'stone attacks more slowly');
  assert.ok(stoneResult.hit.damage < steelResult.hit.damage, 'steel strikes harder');
});

test('insufficient stamina refuses attacks and idle recovery reaches the cap', () => {
  const combat = drawn('hammer');
  combat.stamina = 0;
  assert.equal(combat.attack(), false);
  assert.equal(combat.busy, false);
  assert.equal(combat.events.length, 0);
  advance(combat, 1, { ...GROUND, moving: true });
  assert.ok(combat.stamina > 0, 'idle stamina begins recovering');
  advance(combat, 15, { ...GROUND, moving: true });
  assert.equal(combat.stamina, combat.maxStamina);
  assert.equal(combat.attack(), true, 'recovered stamina enables the move');
  assert.ok(combat.stamina < combat.maxStamina);
  finish(combat);
});

test('spending stamina delays recovery and a queued attack cannot overspend', () => {
  const combat = drawn();
  combat.attack();
  const paid = combat.stamina;
  advance(combat, 0.1);
  assert.equal(combat.stamina, paid, 'no recovery immediately after spending');
  combat.stamina = 0;
  combat.attack();
  const events = finish(combat);
  assert.equal(strikes(events).length, 1, 'only the already-paid strike lands');
  assert.ok(combat.stamina >= 0);
  advance(combat, 1, { ...GROUND, moving: true });
  assert.ok(combat.stamina > 0, 'recovery resumes after combat');
});

test('stamina recovery accounts for the idle remainder when an attack finishes in a long frame', () => {
  for (const id of ['greatsword', 'dagger', 'hammer']) {
    const smallFrames = drawn(id);
    const longFrame = drawn(id);
    smallFrames.stamina = longFrame.stamina = 60;
    smallFrames.attack();
    longFrame.attack();
    const smallHits = strikes(advance(smallFrames, 1.5));
    const longHits = strikes(tick(longFrame, 1.5));
    assert.equal(smallFrames.busy, false, id);
    assert.equal(longFrame.busy, false, id);
    assert.equal(smallHits.length, 1, id);
    assert.deepEqual(longHits, smallHits, `${id}: strike delivery is independent of frame size`);
    assert.ok(Math.abs(longFrame.stamina - smallFrames.stamina) < 1e-8,
      `${id}: stamina ${longFrame.stamina} matches small frames ${smallFrames.stamina}`);
  }
});

test('drawing and repeated input retain only one queued combo continuation', () => {
  const combat = new Combat();
  combat.attack();
  assert.equal(combat.move, 'draw');
  combat.attack();
  combat.attack();
  const first = oneStrike(combat, finish(combat), combat.weapon.combo[0]);
  assert.equal(first.move, 'cleave');
  combat.attack();
  assert.equal(combat.move, 'b', 'a recent first hit continues with legacy b');
  combat.attack();
  combat.attack();
  const events = strikes(finish(combat));
  assert.deepEqual(events.map((event) => event.move), combat.weapon.combo.slice(1));
  assert.equal(combat.queued, null);
  advance(combat, 0.7, { ...GROUND, moving: true });
  combat.attack();
  assert.equal(combat.move, 'a', 'after a pause the combo starts over');
  finish(combat);
});

test('equipping waits for draw, strike, charge, or block to finish', () => {
  const combat = new Combat();
  combat.toggle();
  assert.equal(combat.equip('dagger', 'bronze'), false);
  finish(combat);
  combat.toggle();
  assert.equal(combat.equip('dagger', 'bronze'), false, 'cannot replace a weapon while sheathing it');
  finish(combat);
  combat.toggle();
  finish(combat);
  combat.attack();
  assert.equal(combat.equip('dagger', 'bronze'), false);
  finish(combat);
  combat.attack({ held: true });
  assert.equal(combat.equip('dagger', 'bronze'), false);
  combat.cancel();
  assert.equal(combat.inHand, true, 'cancelling keeps the weapon drawn');
  assert.equal(combat.equip('sword-shield', 'bronze'), true);
  assert.equal(combat.inHand, false, 'replacement starts sheathed');
  combat.toggle();
  finish(combat);
  combat.block();
  assert.equal(combat.equip('dagger', 'bronze'), false);
  combat.block(false);
  assert.equal(combat.equip('dagger', 'bronze'), true);
  assert.equal(combat.weaponId, 'dagger');
  assert.equal(combat.material, 'bronze');
  assert.equal(combat.move, null);
  assert.equal(combat.queued, null);
  assert.equal(combat.trailing, false);
  tick(combat);
});

test('sword and shield parries early hits, then blocks frontal damage', () => {
  const combat = drawn('sword-shield');
  assert.equal(combat.block(), true);
  assert.equal(combat.parrying, true);
  const early = combat.defend(20, { front: true });
  assert.equal(early.parried, true);
  assert.equal(early.blocked, true);
  assert.equal(early.damage, 0);
  assert.ok(combat.events.some((event) => event.type === 'parry'));
  const afterParry = combat.stamina;
  advance(combat, 0.2);
  assert.equal(combat.parrying, false);
  assert.equal(combat.blocking, true);
  assert.ok(combat.stamina < afterParry, 'holding the shield drains stamina');
  const blocked = combat.defend(20, { front: true });
  assert.equal(blocked.parried, false);
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.damage, 5);
  const rear = combat.defend(20, { front: false });
  assert.equal(rear.blocked, false);
  assert.equal(rear.damage, 20);
  combat.stamina = 0;
  const broken = combat.defend(20, { front: true });
  assert.equal(broken.blocked, false);
  assert.equal(broken.damage, 20);
  assert.equal(combat.blocking, false);
});

test('weapons without a shield cannot enter block or parry', () => {
  for (const id of WEAPON_IDS.filter((weapon) => weapon !== 'sword-shield')) {
    const combat = drawn(id);
    assert.equal(combat.block(), false, id);
    assert.equal(combat.blocking, false, id);
    const incoming = combat.defend(20);
    assert.equal(incoming.damage, 20, id);
    assert.equal(incoming.blocked, false, id);
  }
});

test('an exhausted shield stays lowered until block input is released and pressed again', () => {
  const combat = drawn('sword-shield');
  combat.stamina = 0.03;
  assert.equal(combat.block(), true);
  tick(combat, DT, { ...GROUND, blocking: true });
  assert.equal(combat.blocking, false, 'exhaustion breaks the guard');
  advance(combat, 1, { ...GROUND, blocking: true });
  assert.ok(combat.stamina > 0, 'stamina recovers after the guard breaks');
  assert.equal(combat.blocking, false, 'continued held input cannot repeatedly open parry windows');
  tick(combat, DT, { ...GROUND, blocking: false });
  tick(combat, DT, { ...GROUND, blocking: true });
  assert.equal(combat.blocking, true, 'a new press raises the recovered shield');
  assert.equal(combat.parrying, true);
});

test('dagger backstabs require a rear attack and triple normal damage', () => {
  const front = drawn('dagger');
  const rear = drawn('dagger');
  front.attack();
  rear.attack({ behind: true });
  const normal = oneStrike(front, finish(front), front.weapon.combo[0]);
  const backstab = oneStrike(rear, finish(rear), rear.weapon.combo[0]);
  assert.notEqual(normal.type, 'backstab');
  assert.equal(backstab.type, 'backstab');
  assert.equal(backstab.damage, normal.damage * 3);
});

test('bow draw holds the arrow until release and longer draws strike harder', () => {
  const shot = (hold) => {
    const combat = new Combat('bow');
    assert.equal(combat.attack({ held: true }), true);
    assert.equal(combat.inHand, true, 'the bow can be drawn immediately from the quiver');
    assert.equal(strikes(advance(combat, hold, { ...GROUND, held: true })).length, 0);
    assert.equal(combat.release(), true);
    const events = strikes(finish(combat));
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'projectile');
    return events[0];
  };
  const tap = shot(0.05);
  const full = shot(1.5);
  assert.equal(tap.charged, false);
  assert.equal(full.charged, true);
  assert.ok(full.damage > tap.damage);
  assert.ok(full.strength > tap.strength);
});

test('bow combo releases a single arrow, a close pair, and a stronger final shot', () => {
  const combat = drawn('bow');
  const hits = [];
  for (const move of combat.weapon.combo) {
    combat.attack();
    hits.push(oneStrike(combat, finish(combat), move));
  }
  assert.equal(hits[0].projectile.count ?? 1, 1);
  assert.equal(hits[1].projectile.count, 2);
  assert.equal(hits[2].projectile.count ?? 1, 1);
  assert.ok(hits[2].damage > hits[0].damage);
});

test('staff sweep turns the warrior and the finisher launches magic', () => {
  const combat = drawn('staff');
  combat.attack();
  finish(combat);
  combat.attack();
  let turns = false;
  for (let frame = 0; combat.busy && frame < 800; frame++) {
    turns ||= combat.motion.turn !== 0;
    tick(combat);
  }
  assert.equal(combat.busy, false);
  assert.equal(turns, true, 'the staff sweep spins the torso and heading');
  combat.attack();
  const hit = oneStrike(combat, finish(combat), combat.weapon.combo[2]);
  assert.equal(hit.type, 'magic');
  assert.equal(hit.projectile.kind, 'magic');
});

test('releasing through update is equivalent to explicit bow release', () => {
  const combat = drawn('bow');
  combat.attack({ held: true });
  advance(combat, 0.5, { ...GROUND, held: true });
  const events = [...tick(combat, DT, { ...GROUND, held: false }), ...finish(combat)];
  assert.equal(oneStrike(combat, events, combat.weapon.chargedAttack).type, 'projectile');
  assert.equal(combat.charging, false);
});

test('a tap released during drawing becomes one light attack instead of a stuck charge', () => {
  const combat = new Combat('axe');
  assert.equal(combat.attack({ held: true }), true);
  assert.equal(combat.move, 'draw');
  advance(combat, 0.05, { ...GROUND, held: true });
  combat.release();
  const hit = oneStrike(combat, finish(combat, { ...GROUND, held: false }), combat.weapon.combo[0]);
  assert.equal(hit.charged, false);
  assert.equal(combat.charging, false);
  assert.equal(combat.queued, null);
});

test('a held attack draws a sheathed melee weapon before charging', () => {
  const combat = new Combat('axe');
  assert.equal(combat.attack({ held: true }), true);
  assert.equal(strikes(advance(combat, 2, { ...GROUND, held: true })).length, 0);
  assert.equal(combat.inHand, true);
  assert.equal(combat.charging, true);
  combat.release();
  assert.equal(oneStrike(combat, finish(combat), combat.weapon.chargedAttack).charged, true);
});

test('javelin charged throw creates a javelin projectile instead of a melee strike', () => {
  const combat = drawn('javelin');
  combat.attack({ held: true });
  advance(combat, 1.5, { ...GROUND, held: true });
  combat.release();
  const hit = oneStrike(combat, finish(combat), combat.weapon.chargedAttack);
  assert.equal(hit.type, 'projectile');
  assert.equal(hit.projectile.kind, 'javelin');
});

test('spear overarm throws wait for release and gain damage, speed, and range with charge', () => {
  const thrown = (seconds) => {
    const combat = drawn('spear');
    assert.equal(combat.attack({ held: true }), true);
    assert.equal(strikes(advance(combat, seconds, { ...GROUND, held: true })).length, 0,
      'holding the spear never launches a projectile');
    assert.ok(combat.pose.hand[1] > 0.65, 'the spear hand rises into an overarm throw');
    assert.ok(combat.pose.off < 0.5, 'the other hand releases the throwing grip');
    assert.equal(combat.release(), true);
    const hit = oneStrike(combat, finish(combat), 'spear-throw');
    assert.equal(hit.type, 'projectile');
    assert.equal(hit.projectile.kind, 'spear');
    assert.equal(hit.projectile.count, 1);
    assert.equal(hit.charged, true);
    assert.ok(hit.projectile.gravity > 0, 'a thrown spear follows a ballistic flight');
    assert.equal(combat.charge, 0);
    assert.equal(strikes(advance(combat, 0.5)).length, 0, 'a throw is delivered once');
    return hit;
  };
  const partial = thrown(0.25);
  const full = thrown(1.3);
  assert.ok(full.damage > partial.damage);
  assert.ok(full.projectile.speed > partial.projectile.speed);
  assert.ok(full.projectile.range > partial.projectile.range);
});

test('spear taps stay melee and cancelled or unaffordable throws cannot launch phantom projectiles', () => {
  const tap = drawn('spear');
  tap.attack({ held: true });
  advance(tap, 0.05, { ...GROUND, held: true });
  tap.release();
  const jab = oneStrike(tap, finish(tap), tap.weapon.combo[0]);
  assert.equal(jab.type, 'thrust');
  assert.equal(jab.projectile, undefined);
  assert.equal(jab.charged, false);

  const cancelled = drawn('spear');
  cancelled.attack({ held: true });
  advance(cancelled, 1.3, { ...GROUND, held: true });
  cancelled.cancelAction();
  assert.equal(cancelled.release(), false);
  assert.equal(strikes(advance(cancelled, 1)).length, 0);

  const exhausted = drawn('spear');
  exhausted.stamina = 10;
  exhausted.attack({ held: true });
  advance(exhausted, 1.3, { ...GROUND, held: true });
  assert.equal(exhausted.release(), false, 'insufficient stamina refuses the charged throw');
  assert.equal(exhausted.busy, false);
  assert.equal(exhausted.charge, 0);
  assert.equal(strikes(advance(exhausted, 1)).length, 0);
});

test('cancel clears queued actions and a cancelled charge never strikes', () => {
  const combat = drawn('staff');
  combat.attack({ held: true });
  advance(combat, 0.4, { ...GROUND, held: true });
  combat.cancel();
  assert.equal(combat.busy, false);
  assert.equal(combat.charging, false);
  assert.equal(combat.queued, null);
  assert.equal(strikes(advance(combat, 2)).length, 0);
  assert.equal(combat.release(), false);
});

test('focus cancellation removes a queued charge while preserving an ordinary strike', () => {
  const combat = drawn('spear');
  combat.attack();
  combat.attack({ held: true });
  advance(combat, 0.05, { ...GROUND, held: true });
  const current = combat.move;
  combat.cancelAction();
  assert.equal(combat.move, current, 'the paid strike continues');
  assert.equal(combat.queued, null);
  assert.equal(combat.charging, false);
  oneStrike(combat, finish(combat), combat.weapon.combo[0]);
  assert.equal(strikes(advance(combat, 1)).length, 0, 'cancelled continuation cannot fire later');
});

test('focus cancellation drops a held bow shot and shield block', () => {
  const bow = drawn('bow');
  bow.attack({ held: true });
  advance(bow, 0.5, { ...GROUND, held: true });
  bow.cancelAction();
  assert.equal(bow.busy, false);
  assert.equal(bow.release(), false);
  assert.equal(strikes(advance(bow, 1)).length, 0);
  const shield = drawn('sword-shield');
  shield.block();
  shield.cancelAction();
  assert.equal(shield.blocking, false);
  assert.equal(shield.parrying, false);
  assert.equal(shield.busy, false);
});

test('zero, negative, and invalid elapsed times cannot advance a strike or corrupt its pose', () => {
  const combat = drawn();
  combat.attack();
  const stamina = combat.stamina;
  const move = combat.move;
  for (const dt of [0, -1, NaN, Infinity]) {
    assert.equal(strikes(tick(combat, dt)).length, 0);
    assert.equal(combat.move, move);
    assert.equal(combat.step, 0);
    assert.equal(combat.t, 0);
    assert.equal(combat.stamina, stamina);
  }
  oneStrike(combat, finish(combat), combat.weapon.combo[0]);
});

test('unknown and inherited move names are rejected without spending stamina or changing state', () => {
  const combat = drawn();
  const stamina = combat.stamina;
  for (const move of ['unknown', 'constructor', '__proto__', 'toString']) {
    assert.equal(combat.start(move), false, move);
    assert.equal(combat.move, null, move);
    assert.equal(combat.stamina, stamina, move);
    assert.equal(combat.events.length, 0, move);
    tick(combat);
  }
});

test('large update steps consume complete moves without duplicating strike events', () => {
  for (const id of WEAPON_IDS) {
    const combat = new Combat(id);
    combat.attack();
    const events = tick(combat, 3);
    assert.equal(combat.busy, false, `${id}: draw and first strike complete in one update`);
    oneStrike(combat, events, combat.weapon.combo[0]);
    assert.equal(strikes(tick(combat, 0.1)).length, 0, `${id}: strike cannot fire twice`);
  }
});

test('legacy boolean movement updates still complete the default draw and attack', () => {
  const combat = new Combat();
  combat.attack();
  const events = tick(combat, 2, false);
  oneStrike(combat, events, combat.weapon.combo[0]);
  assert.equal(combat.busy, false);
  tick(combat, 1, true);
  assert.equal(combat.inHand, true);
});

test('idle sheathing and moving carry preserve the legacy greatsword lifecycle', () => {
  const idle = drawn();
  const moving = drawn();
  advance(idle, 7);
  advance(moving, 7, { ...GROUND, moving: true });
  assert.equal(idle.inHand, false);
  assert.equal(moving.inHand, true);
  moving.toggle();
  assert.equal(strikes(finish(moving)).length, 0);
  assert.equal(moving.inHand, false);
});
