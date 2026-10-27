import { ITEMS } from '../inventory/items.js';
import { SCALE, TILT } from '../entities/rig.js';
import { inStrike } from './harvesting.js';
import { minedKey, ORES } from './ore-veins.js';
import { ASPECT, CHUNK_SIZE } from './world.js';

// Classic mining: a pickaxe of a high enough tier breaks an ore block in a
// few blows and gets its ore; anything else takes many blows and the block
// crumbles to nothing.
export const PICKAXES = Object.freeze({
  wood: { name: 'wooden pickaxe', blows: 6, level: 0 },
  stone: { name: 'stone pickaxe', blows: 3, level: 1 },
});
export const OTHER_BLOWS = 40;
const STRIKE_RADIUS = 3.5;

// The pickaxe tier in the main hand, or null for any other tool.
export function toolOf(equipment) {
  const item = ITEMS[equipment?.mainHand?.id];
  return item?.tool === 'pickaxe' ? item.toolTier : null;
}

export const blowsFor = (tier) => PICKAXES[tier]?.blows ?? OTHER_BLOWS;

export const canHarvest = (tier, ore) => tier in PICKAXES && PICKAXES[tier].level >= PICKAXES[ORES[ore].tier].level;

// What a harvested block drops: its ore, a count between the bounds.
export function rollDrops(ore, random = Math.random) {
  const { id, count: [min, max] } = ORES[ore].drop;
  return [{ id, count: min + Math.floor(random() * (max - min + 1)) }];
}

const needs = (ore) => (ORES[ore].tier === 'wood' ? 'a pickaxe' : `a ${PICKAXES[ORES[ore].tier].name}`);
const distance = (a, b) => Math.hypot((a.x - b.x) * ASPECT, a.y - b.y);

export class Mining {
  constructor(world, { reachable = () => true, drop = () => {}, random = Math.random } = {}) {
    this.world = world;
    this.reachable = reachable;
    this.drop = drop;
    this.random = random;
    this.strikes = new WeakSet();
  }

  blocksIn(x0, y0, x1, y1) {
    return this.world.propsIn(x0, y0, x1, y1).filter((p) => p.ore && !p.mined);
  }

  // The nearest reachable block a strike along this line would hit.
  target(player, event) {
    const xReach = STRIKE_RADIUS / ASPECT;
    let best = null;
    for (const block of this.blocksIn(Math.min(player.x, event.x) - xReach, Math.min(player.y, event.y) - STRIKE_RADIUS,
      Math.max(player.x, event.x) + xReach, Math.max(player.y, event.y) + STRIKE_RADIUS)) {
      if (!inStrike(player, event, block) || (best && distance(player, block) >= distance(player, best))) continue;
      if (this.reachable(player, block)) best = block;
    }
    return best;
  }

  // The block the next swing would hit, by the strike's own reach and
  // corridor, with its prompt.
  nearby(player, tier) {
    const reach = (player.feel?.reach ?? 0.95) * SCALE;
    const heading = player.heading ?? 0;
    const aim = { x: player.x + Math.sin(heading) * reach / ASPECT, y: player.y + Math.cos(heading) * reach * TILT };
    const block = this.target(player, aim);
    if (!block) return null;
    const name = ORES[block.ore].name;
    const ok = canHarvest(tier, block.ore);
    return { block, name, ok, prompt: ok ? `${name} · ${PICKAXES[tier].name}` : `${name} · needs ${needs(block.ore)}` };
  }

  react(event, player, tier) {
    if (event.type !== 'strike' || this.strikes.has(event)) return [];
    this.strikes.add(event);
    const block = this.target(player, event);
    return block ? [this.strike(block, tier)] : [];
  }

  // One blow on a block with a tool of this tier.
  strike(block, tier) {
    const blows = blowsFor(tier);
    block.hits = Math.min(blows, (block.hits ?? 0) + 1);
    const name = ORES[block.ore].name.toLowerCase();
    const result = { block, name, hits: block.hits, blows, rewards: [] };
    if (block.hits < blows) return { ...result, status: 'hit', message: `Mining ${name}: ${block.hits}/${blows}` };
    this.mine(block);
    if (!canHarvest(tier, block.ore)) {
      return { ...result, status: 'crumbled', message: `The ${name} crumbles: it needs ${needs(block.ore)}.` };
    }
    const rewards = rollDrops(block.ore, this.random);
    this.drop(rewards, block);
    return { ...result, rewards, status: 'mined', message: `Mined ${name}.` };
  }

  // Takes a block out of its chunk for good; the grass grows back.
  mine(block) {
    const c = this.world.chunk(Math.floor(block.x / CHUNK_SIZE), Math.floor(block.y / CHUNK_SIZE));
    if (c.props) c.props = c.props.filter((p) => p !== block);
    this.world.mined.add(minedKey(block));
    block.mined = true;
    this.world.coverGrass(block, -1);
  }
}
