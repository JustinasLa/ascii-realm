import { hash2, mulberry32 } from '../core/rng.js';
import { CHUNK_SIZE, WATER } from '../world/world.js';
import { toCells, toMetres } from './monsters.js';

// Wolf packs: what a pack is after and how each wolf moves to get it. A
// pack roams round its home until it notices the player, a deer or a
// rabbit; then it stalks in low and slow, rings its quarry and closes in a
// wolf or two at a time, biting and skipping back out while the ring turns.
// Fleeing quarry is run down by the whole pack. A badly cut wolf slinks off
// for a few seconds; a pack that has lost half its number runs for good.
// The body (moving, footing, wading, hits and death) is the animal's own;
// this module only decides, through the animal's own methods.

const freeze = (o) => Object.freeze(o);

// The pack layer is cut into regions of two by two animal regions, about
// 47 by 39 metres, each holding a pack or none from the seed.
export const PACK_REGION = freeze({ cols: CHUNK_SIZE * 16, rows: CHUNK_SIZE * 4 });
export const PHASES = freeze(['roam', 'stalk', 'surround', 'hunt', 'chase', 'feed', 'rout']);
// Phases in which a pack is on its quarry: it is not let go, may cross
// water (but for the stalk) and is drawn first.
const ENGAGED = new Set(['stalk', 'surround', 'hunt', 'chase']);
const WET = new Set(['hunt', 'chase', 'rout']);
// Wolves stay this close to home while roaming, metres; a player within
// this of the pack is preferred to any prey; one this near a feeding pack
// is taken for a thief.
const ROAM = 20;
const PREFER = 12;
const GUARD = 8;
// A wolf this near its ring place, metres, holds it; a biter skipping back
// rejoins the ring after this long, seconds, wherever it is.
const SLOT_NEAR = 0.8;
const BACK_FOR = 2;
// With nobody behind the quarry for this long, seconds, any wolf may bite.
const FLANK_WAIT = 2.5;
// Having given up on its quarry, a pack takes no other for this long,
// seconds, as it heads home; wolves eat this far from the body, metres.
const REST = 10;
const FEED_AT = 1;

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const between = (random, [a, b]) => a + random() * (b - a);
const metres = (a, b) => Math.hypot(...toMetres(b.x - a.x, b.y - a.y));

// A pack region's habitat from its four animal regions': the commonest
// land, where water regions count for nothing, and no land at all where
// three or more are water.
export function packHabitat(habitats) {
  const counts = { water: 0, meadow: 0, edge: 0, woodland: 0 };
  for (const h of habitats) counts[h]++;
  if (counts.water >= 3) return 'water';
  return ['meadow', 'edge', 'woodland'].reduce((best, h) => (counts[h] > counts[best] ? h : best), 'meadow');
}

// The pack a pack region holds, the same every time for a seed and region:
// its home, size and members' places round the home (metres). Null for
// none.
export function packOf(seed, px, py, habitat, kind) {
  if (habitat === 'water') return null;
  const random = mulberry32(Math.floor(hash2(px, py, seed + 7121) * 2 ** 32));
  if (!(random() < (kind.habitat[habitat] ?? 0))) return null;
  const [lo, hi] = kind.herd.size;
  const size = lo + Math.floor(random() * (hi - lo + 1));
  const home = { x: (px + 0.2 + random() * 0.6) * PACK_REGION.cols, y: (py + 0.2 + random() * 0.6) * PACK_REGION.rows };
  const places = [];
  for (let i = 0; i < size; i++) {
    const spots = [];
    for (let t = 0; t < 4; t++) {
      const angle = random() * Math.PI * 2;
      const r = i === 0 && t === 0 ? 0 : kind.herd.spacing * (1 + random()) * (0.5 + 0.5 * Math.sqrt(i + t));
      spots.push([Math.sin(angle) * r, Math.cos(angle) * r]);
    }
    places.push(spots);
  }
  return { key: `pack:${px},${py}`, kind, home, size, places, seed: Math.floor(random() * 2 ** 31) };
}

// A pack's mind, fresh: roaming, after nothing.
export function newPack(home, size) {
  return { phase: 'roam', phaseTime: 0, target: null, home: { ...home }, size0: size, lost: 0,
    theta: 0, ring: 0, biters: new Set(), carcass: null, chaseFor: 0, idle: 0, rest: 0 };
}

export const engaged = (animal) => Boolean(animal.alive && animal.herd?.pack
  && (ENGAGED.has(animal.herd.pack.phase) || animal.state === 'attack'));

// Whether a wolf may take to water: on the hunt, in a chase or a rout, or
// slinking off hurt.
export const mayWade = (wolf) => wolf.retreatFor > 0 || WET.has(wolf.herd?.pack?.phase);

const alive = (t) => (t.kind === 'player' ? (t.ref.vitals?.health ?? 1) > 0 : t.ref.alive);
const nearest = (members, at) => Math.min(...members.map((m) => metres(m, at)));
const centreOf = (members) => ({ x: members.reduce((s, m) => s + m.x, 0) / members.length,
  y: members.reduce((s, m) => s + m.y, 0) / members.length });

function setPhase(pack, phase) {
  pack.phase = phase;
  pack.phaseTime = 0;
  if (phase !== 'hunt') pack.biters.clear();
  if (phase === 'chase') pack.chaseFor = 0;
}

// What the pack goes after: the player within reach of its senses (unless
// it has learnt to be wary of them), else the nearest deer or rabbit, a
// rabbit counting as nearer. A player close by wins over any prey.
// `candidates` are { ref, kind: 'player' | 'deer' | 'rabbit' }.
export function targetOf(members, candidates, kind, wary = false) {
  let best = null;
  let bestScore = Infinity;
  for (const c of candidates) {
    if (!alive(c)) continue;
    const d = nearest(members, c.ref);
    let score = d;
    if (c.kind === 'player') {
      if (wary || d > kind.senses.player) continue;
      if (d <= PREFER) return c;
    } else {
      if (d > kind.senses.prey) continue;
      score = d * (c.kind === 'rabbit' ? 0.8 : 1);
    }
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

// A blow from the player sets the whole pack on them at once, however wary,
// past the stalk: straight in if it was already ringing them.
export function provoke(pack, player) {
  if (pack.phase === 'rout') return;
  const ringing = pack.target?.ref === player && (pack.phase === 'surround' || pack.phase === 'hunt');
  pack.target = { ref: player, kind: 'player' };
  setPhase(pack, ringing ? 'hunt' : 'surround');
}

// Where ring place `i` of `n` stands round the quarry: spaced evenly from
// the side the pack came at, turned by the ring's drift, and moved round
// in 15 degree steps (up to 60) off ground a wolf could not stand on.
export function slotPoint(pack, target, i, n, kind, clear = () => true) {
  const base = pack.theta + (i - (n - 1) / 2) * ((Math.PI * 2) / n);
  for (let step = 0; step <= 8; step++) {
    const a = base + (step % 2 ? 1 : -1) * Math.ceil(step / 2) * (Math.PI / 12);
    const [dx, dy] = toCells(Math.sin(a) * kind.ring.radius, Math.cos(a) * kind.ring.radius);
    const p = { x: target.x + dx, y: target.y + dy };
    if (clear(p.x, p.y)) return p;
  }
  const [dx, dy] = toCells(Math.sin(base) * kind.ring.radius, Math.cos(base) * kind.ring.radius);
  return { x: target.x + dx, y: target.y + dy };
}

// Whether the quarry is getting away: moving faster than a brisk walk and
// out beyond the ring.
function fleeing(target, centre, kind) {
  const ref = target.ref;
  const walk = ref.walkSpeed ?? ref.kind?.walkSpeed ?? 1.3;
  return (ref.groundSpeed ?? 0) > walk * 1.3 && metres(centre, ref) > kind.ring.radius * 1.5;
}

// The pack's turn: it keeps or drops its quarry, moves through its phases,
// turns its ring and picks who bites next. `ctx` holds the `player`, the
// living `prey`, the wolf `kind`, whether the pack is `wary` of the player,
// `makeWary()` to set that, and `clear(x, y)` for open ground.
export function updatePack(pack, members, ctx, dt) {
  const k = ctx.kind;
  pack.phaseTime += dt;
  pack.rest = Math.max(0, pack.rest - dt);
  if (!members.length) return;
  const centre = centreOf(members);
  const t = pack.target;
  if (pack.phase === 'rout') {
    if (pack.phaseTime >= k.routFor) {
      ctx.makeWary();
      pack.target = null;
      setPhase(pack, 'roam');
    }
    return;
  }
  if (pack.phase === 'feed') {
    const thief = ctx.player && alive({ ref: ctx.player, kind: 'player' }) && nearest(members, ctx.player) < GUARD;
    if (thief) {
      pack.target = { ref: ctx.player, kind: 'player' };
      pack.carcass = null;
      setPhase(pack, 'surround');
    } else if (pack.phaseTime >= k.feed || !pack.carcass || pack.carcass.gone) {
      pack.carcass = null;
      pack.target = null;
      setPhase(pack, 'roam');
    }
    return;
  }
  if (t) {
    if (!alive(t)) {
      pack.target = null;
      // Its prey down, the pack feeds at the body, and makes its home there.
      if (t.kind !== 'player' && !t.ref.gone) {
        pack.carcass = t.ref;
        pack.home = { x: t.ref.x, y: t.ref.y };
        t.ref.linger = Math.max(t.ref.kind.linger, k.feed + 2);
        setPhase(pack, 'feed');
        return;
      }
      setPhase(pack, 'roam');
    } else if (nearest(members, t.ref) > k.senses.forget
      || (t.kind === 'player' && metres(centre, pack.home) > k.senses.leash)
      || (pack.phase === 'chase' && pack.chaseFor > (t.kind === 'player' ? k.attack.chase : k.attack.preyChase))) {
      pack.target = null;
      pack.rest = REST;
      setPhase(pack, 'roam');
    }
  }
  if (!pack.target) {
    if (pack.rest > 0) return;
    const candidates = [];
    if (ctx.player) candidates.push({ ref: ctx.player, kind: 'player' });
    for (const p of ctx.prey ?? []) candidates.push({ ref: p, kind: p.kind.id });
    const found = targetOf(members, candidates, k, ctx.wary);
    if (!found) return;
    pack.target = found;
    setPhase(pack, 'stalk');
  }
  const target = pack.target;
  const ref = target.ref;
  const player = target.kind === 'player';
  const close = nearest(members, ref);
  const away = fleeing(target, centre, k);
  if (members.some((m) => !(m.slot < members.length)) || pack.ring !== members.length) assignSlots(pack, members, ref);
  switch (pack.phase) {
    case 'stalk':
      if (player && close <= k.stalk.until) startRing(pack, members, centre, ref);
      else if (!player && (close <= k.stalk.preyRush || ref.state === 'flee')) setPhase(pack, 'chase');
      else if (pack.phaseTime >= k.stalk.max) {
        if (player) startRing(pack, members, centre, ref);
        else setPhase(pack, 'chase');
      }
      break;
    case 'surround': {
      if (away) {
        setPhase(pack, 'chase');
        break;
      }
      const n = members.length;
      // Once every wolf has its place, or the time to take them is up.
      const placed = members.filter((m) => metres(m, slotPoint(pack, ref, m.slot, n, k, ctx.clear)) < SLOT_NEAR).length;
      if (placed >= n || pack.phaseTime >= k.ring.settle) setPhase(pack, 'hunt');
      break;
    }
    case 'hunt':
      if (away) {
        setPhase(pack, 'chase');
        break;
      }
      pack.theta = wrap(pack.theta + k.ring.drift * dt);
      chooseBiters(pack, members, ref, k, dt);
      break;
    case 'chase':
      pack.chaseFor += dt;
      // A player who stops running, or is caught, is ringed again; prey
      // is run down to the end.
      if (player && !away) startRing(pack, members, centre, ref);
      break;
  }
}

function startRing(pack, members, centre, ref) {
  const [mx, mz] = toMetres(centre.x - ref.x, centre.y - ref.y);
  pack.theta = Math.atan2(mx, mz);
  assignSlots(pack, members, ref);
  setPhase(pack, 'surround');
}

// Each wolf takes the ring place on its own side, in the order they stand
// round the quarry, so none crosses the ring to reach its own.
function assignSlots(pack, members, ref) {
  const side = (m) => wrap(Math.atan2(...toMetres(m.x - ref.x, m.y - ref.y)) - pack.theta);
  [...members].sort((a, b) => side(a) - side(b)).forEach((m, i) => { m.slot = i; });
  pack.ring = members.length;
}

// Biters come from behind the quarry or beside it, a flanking rule: of the
// ring wolves ready to bite, the one most nearly behind goes in, up to
// `attack.biters` at once. With nobody behind for a while, any may.
function chooseBiters(pack, members, ref, k, dt) {
  for (const b of pack.biters) {
    if (!b.alive || b.retreatFor > 0 || !members.includes(b)) pack.biters.delete(b);
  }
  for (const m of members) if (m.role === 'bite' && !pack.biters.has(m)) m.role = 'ring';
  pack.idle += dt;
  while (pack.biters.size < k.attack.biters) {
    const back = (ref.heading ?? 0) + Math.PI;
    let best = null;
    let bestOff = Infinity;
    for (const m of members) {
      if (pack.biters.has(m) || m.cooldown > 0 || m.retreatFor > 0 || m.role !== 'ring') continue;
      const [mx, mz] = toMetres(m.x - ref.x, m.y - ref.y);
      const off = Math.abs(wrap(Math.atan2(mx, mz) - back));
      if (off >= 2 && pack.idle < FLANK_WAIT) continue;
      if (off < bestOff) {
        bestOff = off;
        best = m;
      }
    }
    if (!best) break;
    best.role = 'bite';
    best.flank = bestOff < 2;
    pack.biters.add(best);
    pack.idle = 0;
  }
}

// Starts a bite: the wolf winds up, its jaws closing `attack.windUp` in.
function lunge(wolf) {
  wolf.setState('attack');
  wolf.swing++;
  wolf.bit = false;
  wolf.events.push({ type: 'swing', x: wolf.x, y: wolf.y, strength: 0.5 });
}

// A bite under way: the wolf tracks its quarry while winding up, then
// commits, lunging in. At the moment the jaws close it lands, once, if the
// quarry is within reach in front of it and (the player) not in the air.
function biting(wolf, pack, ctx, dt) {
  const k = wolf.kind;
  const a = k.attack;
  const t = pack.target;
  const off = t ? wolf.offsetTo(t.ref.x, t.ref.y) : null;
  if (off && wolf.stateTime < a.windUp * 0.7) wolf.turnTowards(off.bearing, k.turn.hunt, dt);
  if (!wolf.bit && wolf.stateTime >= a.windUp) {
    wolf.bit = true;
    if (off && alive(t)) {
      const player = t.kind === 'player';
      const reach = a.hitRange + (player ? 0 : t.ref.kind.radius);
      if (off.distance <= reach && Math.abs(wrap(off.bearing - wolf.heading)) <= a.hitArc
        && (!player || (t.ref.air ?? 0) < 0.6)) {
        if (player) wolf.events.push({ type: 'hit-player', amount: a.damage, x: t.ref.x, y: t.ref.y });
        else wolf.events.push({ type: 'bite', prey: t.ref, amount: a.preyDamage, x: t.ref.x, y: t.ref.y });
        pack.chaseFor = 0;
      }
    }
  }
  if (wolf.stateTime >= a.swingTime) {
    wolf.cooldown = a.cooldown;
    if (wolf.role === 'bite') {
      wolf.role = 'back';
      wolf.backFor = BACK_FOR;
    }
    wolf.setState('run');
    return { speed: 0, face: null, turn: k.turn.hunt };
  }
  // Running quarry is bitten on the run; a standing one with a short lunge.
  const chasing = pack.phase === 'chase';
  const inLunge = wolf.stateTime > a.windUp * 0.6 && wolf.stateTime < a.windUp * 1.1;
  const speed = chasing ? k.runSpeed : inLunge ? 1.6 : 0;
  return { speed, face: null, turn: k.turn.hunt };
}

// Heads at `speed` for a point, standing once there.
function goTo(wolf, to, speed, near = 0.3) {
  const off = wolf.offsetTo(to.x, to.y);
  if (off.distance < near) return { speed: 0, face: null, arrived: true, off };
  return { speed: off.distance < 1 ? Math.min(speed, wolf.kind.walkSpeed) : speed, face: off.bearing, arrived: false, off };
}

// Runs from a point, by the most open way.
function runFrom(wolf, from, world) {
  const away = wolf.offsetTo(from.x, from.y).bearing + Math.PI;
  if (wolf.state !== 'retreat') {
    wolf.setState('retreat');
    wolf.away = wolf.bestHeading(world, away);
  } else if (wolf.random() < 0.05) wolf.away = wolf.bestHeading(world, away);
  return { speed: wolf.kind.runSpeed, face: wolf.away, turn: wolf.kind.turn.hunt };
}

// Strolls round home like a herd: the leader picks places within reach of
// home, the rest keep near the leader.
function roam(wolf, pack, world) {
  const k = wolf.kind;
  if (wolf.state !== 'idle' && wolf.state !== 'wander') wolf.setState('idle', between(wolf.random, k.wander.idle));
  if (wolf.state === 'idle') {
    if (!wolf.looking && wolf.stateTime > wolf.duration * 0.4 && wolf.random() < 0.004) wolf.looking = true;
    if (wolf.stateTime >= wolf.duration) {
      let to = wolf.pickTarget(world);
      if (to && wolf.herd.leader === wolf && metres(to, pack.home) > ROAM) {
        const off = wolf.offsetTo(pack.home.x, pack.home.y);
        const [dx, dy] = toCells(Math.sin(off.bearing) * 5, Math.cos(off.bearing) * 5);
        to = { x: wolf.x + dx, y: wolf.y + dy };
      }
      wolf.target = to;
      if (to) wolf.setState('wander', 12);
      else wolf.setState('idle', between(wolf.random, k.wander.idle));
    }
    return { speed: 0, face: null, turn: k.turn.calm };
  }
  const go = goTo(wolf, wolf.target, k.walkSpeed);
  if (go.arrived || wolf.stateTime > wolf.duration) wolf.setState('idle', between(wolf.random, k.wander.idle));
  const facing = go.face !== null && Math.abs(wrap(go.face - wolf.heading)) < 0.8;
  return { speed: facing ? go.speed : 0, face: go.face, turn: k.turn.calm };
}

// One wolf's move this frame: { speed, face, turn }, with its state set for
// the figure ('idle', 'wander', 'stalk', 'run', 'trot', 'snarl', 'attack',
// 'feed', 'retreat' or 'wade').
export function steer(wolf, ctx, dt) {
  const k = wolf.kind;
  const pack = wolf.herd.pack;
  const world = ctx.world;
  wolf.cooldown = Math.max(0, wolf.cooldown - dt);
  wolf.backFor = Math.max(0, wolf.backFor - dt);
  const hunt = k.turn.hunt;
  // Struck, it stands in its flinch.
  if (wolf.flinch) return { speed: 0, face: null, turn: hunt };
  // Wading out of a stream it may no longer cross.
  if (wolf.state === 'wade') {
    if (world.typeAt(wolf.x, wolf.y) !== WATER) wolf.setState('idle', 1);
    else if (!mayWade(wolf)) {
      const bank = wolf.target ?? { x: wolf.x, y: wolf.y + 1 };
      return { speed: k.trotSpeed, face: wolf.offsetTo(bank.x, bank.y).bearing, turn: hunt };
    } else wolf.setState('idle', 1);
  }
  if (wolf.retreatFor > 0) {
    wolf.retreatFor = Math.max(0, wolf.retreatFor - dt);
    pack.biters.delete(wolf);
    wolf.role = 'ring';
    if (wolf.retreatFor > 0) return runFrom(wolf, wolf.threat ?? ctx.player ?? wolf, world);
    wolf.setState('idle', 1);
  }
  if (pack.phase === 'rout') return runFrom(wolf, ctx.player ?? pack.home, world);
  if (wolf.state === 'attack') return biting(wolf, pack, ctx, dt);
  const members = wolf.herd.members.filter((m) => m.alive);
  const n = members.length;
  const i = wolf.slot < n ? wolf.slot : members.indexOf(wolf);
  const t = pack.target;
  if (pack.phase === 'feed') {
    const c = pack.carcass;
    const a = (i / n) * Math.PI * 2;
    const [dx, dy] = toCells(Math.sin(a) * FEED_AT, Math.cos(a) * FEED_AT);
    const go = goTo(wolf, { x: c.x + dx, y: c.y + dy }, k.trotSpeed, 0.4);
    if (go.arrived || wolf.state === 'feed') {
      if (wolf.state !== 'feed') wolf.setState('feed');
      return { speed: 0, face: wolf.offsetTo(c.x, c.y).bearing, turn: k.turn.calm };
    }
    if (wolf.state !== 'trot') wolf.setState('trot');
    return { speed: go.speed, face: go.face, turn: hunt };
  }
  if (pack.phase === 'roam' || !t) {
    wolf.role = 'ring';
    return roam(wolf, pack, world);
  }
  const ref = t.ref;
  const off = wolf.offsetTo(ref.x, ref.y);
  const reach = k.attack.reach + (t.kind === 'player' ? 0 : ref.kind.radius);
  if (pack.phase === 'stalk') {
    // In a loose line abreast, each a little to its own side.
    if (wolf.state !== 'stalk') wolf.setState('stalk');
    const side = (i - (n - 1) / 2) * k.herd.spacing * 1.5;
    const [sx, sy] = toCells(Math.cos(off.bearing) * side, -Math.sin(off.bearing) * side);
    const go = goTo(wolf, { x: ref.x + sx, y: ref.y + sy }, k.stalkSpeed, 1);
    return { speed: go.speed, face: go.face ?? off.bearing, turn: k.turn.calm * 1.5 };
  }
  if (pack.phase === 'chase') {
    if (off.distance <= reach && wolf.cooldown === 0) {
      lunge(wolf);
      return biting(wolf, pack, ctx, dt);
    }
    if (wolf.state !== 'run') wolf.setState('run');
    return { speed: k.runSpeed, face: off.bearing, turn: hunt };
  }
  // Ringing the quarry: biters go in, the rest hold their places.
  if (wolf.role === 'bite' && pack.phase === 'hunt') {
    if (off.distance <= reach && wolf.cooldown === 0) {
      lunge(wolf);
      return biting(wolf, pack, ctx, dt);
    }
    if (wolf.state !== 'run') wolf.setState('run');
    return { speed: off.distance < reach + 1 ? k.trotSpeed : k.runSpeed, face: off.bearing, turn: hunt };
  }
  const slot = slotPoint(pack, ref, i, n, k, ctx.clear);
  // A place round the far side is reached by circling the quarry, not by
  // cutting past it.
  const [wx, wz] = toMetres(wolf.x - ref.x, wolf.y - ref.y);
  const [sx, sz] = toMetres(slot.x - ref.x, slot.y - ref.y);
  const around = wrap(Math.atan2(sx, sz) - Math.atan2(wx, wz));
  let to = slot;
  if (Math.abs(around) > 1) {
    const a = Math.atan2(wx, wz) + Math.sign(around);
    const [dx, dy] = toCells(Math.sin(a) * k.ring.radius, Math.cos(a) * k.ring.radius);
    to = { x: ref.x + dx, y: ref.y + dy };
  }
  const far = metres(wolf, slot) > 4;
  const go = goTo(wolf, to, far ? k.runSpeed : k.trotSpeed, SLOT_NEAR * 0.5);
  if (wolf.role === 'back' && (go.off.distance < SLOT_NEAR || wolf.backFor <= 0)) {
    wolf.role = 'ring';
    pack.biters.delete(wolf);
  }
  if (go.arrived && to === slot) {
    if (wolf.state !== 'snarl') wolf.setState('snarl');
    return { speed: 0, face: off.bearing, turn: hunt };
  }
  const gait = far ? 'run' : 'trot';
  if (wolf.state !== gait) wolf.setState(gait);
  // Close to its place it walks, so it does not overrun.
  const speed = !far && go.off.distance < 2 ? Math.max(k.walkSpeed, go.speed * 0.6) : go.speed;
  return { speed, face: go.face, turn: hunt };
}
