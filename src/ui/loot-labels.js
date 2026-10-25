import { ITEMS } from '../inventory/items.js';
import { ASPECT } from '../world/world.js';
import { SCALE, TILT } from '../entities/rig.js';

// The names shown over stacks lying on the ground. Stacks near the player
// are always named; the rest are named while there is room, and stacks
// whose names would overlap share one label, so none is hidden unaccounted.

export const LABELS = Object.freeze({
  // Stacks this near the player, metres, are always named.
  near: 4,
  // Labels of their own, past the near ones.
  max: 16,
  // Rows above its stack a label sits.
  lift: 2,
  // Names a shared label lists before "+N more".
  names: 2,
  // Characters a name is cut to.
  chars: 24,
});

const LIGHT = [236, 232, 220];

const distance = (a, b) => Math.hypot(((b.x - a.x) * ASPECT) / SCALE, (b.y - a.y) / (SCALE * TILT));

const named = (item, always) => {
  const name = (ITEMS[item.id]?.name ?? item.id).slice(0, LABELS.chars);
  return item.count > 1 || always ? `${name} x${item.count}` : name;
};

// A label's text: its one stack's name, or the first names (every near one
// among them) and how many more share it.
function caption(group) {
  if (group.members.length === 1) return named(group.members[0].item, false);
  const shown = group.members.filter((m, i) => i < LABELS.names || m.near);
  const more = group.members.length - shown.length;
  return shown.map((m) => named(m.item, true)).join(', ') + (more ? ` +${more} more` : '');
}

// A label's box, CSS pixels, centred above its point.
function box(at, text, font) {
  const w = text.length * 0.62 * font + 8;
  const h = font + 4;
  return { x0: at.x - w / 2, x1: at.x + w / 2, y0: at.y - h, y1: at.y };
}

const overlap = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

// The labels for the stacks in `items` on screen: [{ key, text, x, y,
// colour, full, count }], (x, y) in CSS pixels at the bottom middle of the
// label. `project(x, y)` gives { x, y, visible } for a world cell; `font` is
// the label's font size in pixels; `inventory.spaceFor` tells which stacks
// the bag has no room for.
export function lootLabels(items, player, inventory, project, font = 10) {
  const stacks = items.filter((item) => item.count > 0)
    .map((item) => ({ item, d: distance(player, item), at: project(item.x, item.y - LABELS.lift) }))
    .filter((s) => s.at?.visible)
    .sort((a, b) => a.d - b.d);
  const groups = [];
  let own = 0;
  for (const s of stacks) {
    s.near = s.d <= LABELS.near;
    const capped = !s.near && own >= LABELS.max;
    const mine = box(s.at, named(s.item, false), font);
    let group = groups.find((g) => overlap(g.box, mine));
    if (!group && capped) {
      group = groups.reduce((best, g) => (Math.hypot(g.at.x - s.at.x, g.at.y - s.at.y)
        < Math.hypot(best.at.x - s.at.x, best.at.y - s.at.y) ? g : best));
    }
    if (!group) {
      groups.push({ at: s.at, members: [s], box: mine });
      if (!s.near) own++;
      continue;
    }
    group.members.push(s);
    group.box = box(group.at, caption(group), font);
  }
  return groups.map((g) => {
    const first = g.members[0].item;
    const colour = (ITEMS[first.id]?.colour ?? LIGHT).map((c, i) => Math.round(c + (LIGHT[i] - c) * 0.55));
    return { key: first.uid, text: caption(g), x: g.at.x, y: g.at.y, colour, count: g.members.length,
      full: g.members.every((m) => inventory.spaceFor(m.item.id, m.item.count) <= 0) };
  });
}
