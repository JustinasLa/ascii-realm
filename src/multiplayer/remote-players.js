import { Player } from '../entities/player.js';
import { buildRig, SCALE, TILT } from '../entities/rig.js';
import { ASPECT } from '../world/world.js';
import { readPlayerState, STATE_RANGES } from './protocol.js';

const DELAY_MS = 100;
const lerp = (a, b, t) => a + (b - a) * t;
const angle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

// Render a little behind the network so movement is interpolated between actual
// samples, including the airborne pose, instead of guessing through collisions.
export function blendState(a, b, t) {
  const state = {};
  for (const key of Object.keys(STATE_RANGES)) {
    state[key] = (key === 'heading' || key === 'phase' ? angle : lerp)(a[key], b[key], t);
  }
  const pose = {};
  for (const key of ['hand', 'blade']) pose[key] = a.combat.pose[key].map((v, i) => lerp(v, b.combat.pose[key][i], t));
  const length = Math.hypot(...pose.blade) || 1;
  pose.blade = pose.blade.map((v) => v / length);
  for (const key of ['twist', 'lean', 'crouch', 'off']) pose[key] = lerp(a.combat.pose[key], b.combat.pose[key], t);
  const discrete = t < 0.5 ? a.combat : b.combat;
  state.combat = { inHand: discrete.inHand, trailing: discrete.trailing,
    active: lerp(a.combat.active, b.combat.active, t), pose };
  state.equipment = b.equipment;
  return state;
}

export class RemotePlayers {
  constructor() { this.peers = new Map(); }

  sync(members, selfId, now = performance.now()) {
    const present = new Set();
    for (const member of members) {
      if (member.id === selfId || typeof member.id !== 'string') continue;
      const state = readPlayerState(member.state);
      if (!state) continue;
      present.add(member.id);
      let peer = this.peers.get(member.id);
      if (!peer) {
        peer = { player: new Player(state.x, state.y), samples: [] };
        this.peers.set(member.id, peer);
        this.apply(peer.player, state);
        peer.player.settleCape();
      }
      peer.name = member.name;
      peer.color = member.color;
      peer.samples.push({ at: now, state });
      if (peer.samples.length > 8) peer.samples.shift();
    }
    for (const id of this.peers.keys()) if (!present.has(id)) this.peers.delete(id);
  }

  apply(player, state) {
    for (const key of Object.keys(STATE_RANGES)) player[key] = state[key];
    Object.assign(player.combat, state.combat);
    if (state.equipment) player.equipment = state.equipment;
  }

  update(dt, now = performance.now()) {
    const at = now - DELAY_MS;
    for (const peer of this.peers.values()) {
      const p = peer.player;
      const x = p.x;
      const y = p.y;
      const samples = peer.samples;
      while (samples.length > 2 && samples[1].at <= at) samples.shift();
      const a = samples[0];
      const b = samples[1] ?? a;
      const t = a.at === b.at ? 1 : Math.max(0, Math.min(1, (at - a.at) / (b.at - a.at)));
      this.apply(p, blendState(a.state, b.state, t));
      const rig = buildRig(p);
      const poseTime = p.time;
      // Trails expire even when a backgrounded friend's simulation is paused.
      p.time = now / 1000;
      if (poseTime !== peer.lastTrailPoseTime) p.recordTrail(rig);
      else p.trail = p.trail.filter((point) => point.t > p.time - 0.16);
      peer.lastTrailPoseTime = poseTime;
      peer.trailTime = p.time;
      p.time = poseTime;
      const moved = [(p.x - x) * ASPECT / SCALE, 0, (p.y - y) / (SCALE * TILT)];
      const wind = [2.2 + Math.sin(p.time * 0.7) * 1.6, 0, Math.sin(p.time * 0.43) * 1.2];
      p.cape.update(dt, ...p.capeMount(rig), moved, wind);
    }
  }

  visible(view) {
    return [...this.peers.values()].filter(({ player: p }) => p.x > view.x0 - 35
      && p.x < view.x0 + view.cols + 35 && p.y > view.y0 - view.rows - 35
      && p.y < view.y0 + view.rows + 40);
  }
}
