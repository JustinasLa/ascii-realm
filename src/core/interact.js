// The contextual touch button: it shows only when something in reach can be
// used, names it, and does that one thing when pressed. E does the same
// from the keyboard, but leaves fires to C.
import { ITEMS } from '../inventory/items.js';

// How long, in seconds, the button stays after its target goes out of
// reach, so it doesn't flicker at the edge.
export const INTERACT_LINGER = 0.3;
// The reach of a fire, in cells, as putting one out uses it.
const FIRE_REACH = 12;

// What the button would do right now, best first: pick up a ground item,
// use a furnace, an alloy forge or a weapon station, release a glowcap's
// spores, put out a fire.
// Null when there is nothing. `douse: false` skips the fire, as E does.
export function interaction({ player, mushrooms, fires, collection = null, furnaces = null, forges = null,
  smithies = null },
  { douse = true } = {}) {
  const item = collection?.canCollect(player) ? collection.interactionTarget(player).item : null;
  if (item) return { kind: 'pickup', label: 'TAKE', ariaLabel: `Pick up ${ITEMS[item.id]?.name ?? 'item'}` };
  if (furnaces?.nearby(player)) return { kind: 'furnace', label: 'SMELT', ariaLabel: 'Use the furnace' };
  if (forges?.nearby(player)) return { kind: 'forge', label: 'FORGE', ariaLabel: 'Use the alloy forge' };
  if (smithies?.nearby(player)) return { kind: 'smithy', label: 'SMITH', ariaLabel: 'Use the weapon station' };
  const node = mushrooms.nearby(player);
  if (node && node.cooldown <= mushrooms.time) {
    return { kind: 'spores', label: 'SPORES', ariaLabel: 'Release spores from the glowcap' };
  }
  if (douse && player.air <= 0.05 && fires.nearest(player.x, player.y, FIRE_REACH)) {
    return { kind: 'fire', label: 'DOUSE', ariaLabel: 'Put out the fire' };
  }
  return null;
}

// Does what the button offers, checked again at the press so a late tap can
// never build a campfire. Returns what happened, or null.
export function performInteraction(context, options) {
  const target = interaction(context, options);
  if (!target) return null;
  const { player, mushrooms, fires, world, collection, furnaces, forges, smithies } = context;
  if (target.kind === 'pickup') return { kind: 'pickup', result: collection.interact(player) };
  if (target.kind === 'furnace') return { kind: 'furnace', prop: furnaces.nearby(player) };
  if (target.kind === 'forge') return { kind: 'forge', prop: forges.nearby(player) };
  if (target.kind === 'smithy') return { kind: 'smithy', prop: smithies.nearby(player) };
  if (target.kind === 'spores') return { kind: 'spores', released: mushrooms.interact(player) };
  return { kind: 'fire', result: fires.toggle(world, player) };
}

// Keeps the button in step with the target, touching the page only when
// something changed.
export class InteractButton {
  constructor(button) {
    this.button = button;
    this.shown = null;
    this.key = '';
    this.until = -Infinity;
  }

  update(target, time) {
    if (target) this.until = time + INTERACT_LINGER;
    const next = target ?? (time < this.until ? this.shown : null);
    this.shown = next;
    const key = next ? `${next.kind}|${next.label}|${next.ariaLabel}` : '';
    if (key === this.key) return;
    this.key = key;
    this.button.hidden = !next;
    if (!next) return;
    this.button.textContent = next.label;
    this.button.setAttribute('aria-label', next.ariaLabel);
    this.button.dataset.kind = next.kind;
  }

  get kind() { return this.shown?.kind ?? null; }
}
