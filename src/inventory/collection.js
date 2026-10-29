import { ASPECT, WATER } from '../world/world.js';
import { stackExtras } from './inventory.js';
import { ITEMS } from './items.js';
import { DENARS, denars } from './wallet.js';

const TOUCH_RADIUS = 1.3;
const MAGNET_RADIUS = 6;
const MAGNET_SPEED = 10;
const DROP_COOLDOWN = 1;
const DROP_RADII = [1.8, 2.6, 3.4];
const DROP_EXIT_RADIUS = MAGNET_RADIUS + Math.max(...DROP_RADII);
const PATH_STEP = 0.2;
const stateByWorld = new WeakMap();

const positionValid = (position) => Number.isFinite(position?.x) && Number.isFinite(position?.y);
const distance = (a, b) => Math.hypot((a.x - b.x) * ASPECT, a.y - b.y);
const validCount = (count) => Number.isSafeInteger(count) && count > 0;
const result = (status, message, details = {}) => ({ ok: false, status, message, ...details });
const coin = (item) => item.id === DENARS;

// Collection owns transfers between the bag and the persistent loose stacks.
// Effects consume its events only after an actual, possibly partial transfer.
// Coin skips the bag: with a wallet it goes to the pouch, however full the
// bag is; without one it is left lying.
export class Collection {
  constructor(world, inventory, groundItems, harvesting = null, wallet = null) {
    this.world = world;
    this.inventory = inventory;
    this.items = groundItems;
    this.harvesting = harvesting;
    this.wallet = wallet;
    this.events = [];
    this.time = 0;
    this.blocked = false;
    // A player must leave magnet range before returning to a drop. Remember
    // that exit outside spatial queries, including across controller instances.
    if (!stateByWorld.has(world)) stateByWorld.set(world, { drops: new Set(), time: 0 });
    this.worldState = stateByWorld.get(world);
    this.drops = this.worldState.drops;
  }

  get currentTime() {
    return Math.max(this.time, this.worldState.time, Number.isFinite(this.items.time) ? this.items.time : 0);
  }

  canCollect(player) {
    return positionValid(player) && !this.blocked && !(player.air > 0)
      && !(player.windUp >= 0) && !player.combat?.busy && !this.harvesting?.busy;
  }

  walkable(x, y) {
    return this.world.isWalkable(x, y)
      && (typeof this.world.typeAt !== 'function' || this.world.typeAt(x, y) !== WATER);
  }

  pathClear(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    // Sample in cell coordinates so a narrow prop base or shoreline cannot be
    // skipped when traversing the horizontally compressed world.
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / PATH_STEP));
    for (let step = 0; step <= steps; step++) {
      const fraction = step / steps;
      if (!this.walkable(from.x + dx * fraction, from.y + dy * fraction)) return false;
    }
    return true;
  }

  releaseDropOrigin(item, player) {
    const origin = item.dropOrigin;
    if (!positionValid(origin)) return;
    const radius = Number.isFinite(origin.radius) && origin.radius > 0 ? origin.radius : DROP_EXIT_RADIUS;
    if (distance(origin, player) > radius) {
      item.dropOrigin = null;
      this.drops.delete(item);
    }
  }

  updateDropOrigins(player) {
    if (!positionValid(player)) return;
    for (const item of this.drops) {
      if (!item.dropOrigin || !validCount(item.count)) this.drops.delete(item);
      else this.releaseDropOrigin(item, player);
    }
  }

  // Whether this stack has somewhere to go: the pouch for coin, else the bag.
  takes(item) {
    return coin(item) ? !!this.wallet : this.inventory.spaceFor(item.id, item.count, item.extras ?? {}) > 0;
  }

  available(item, player, { manual = false } = {}) {
    if (!Object.hasOwn(ITEMS, item.id) || !validCount(item.count) || !positionValid(item)) return false;
    if (coin(item) && !this.wallet) return false;
    if (Number.isFinite(item.pickupAfter) && item.pickupAfter > this.currentTime) return false;
    if (!manual && positionValid(item.dropOrigin)) {
      const radius = Number.isFinite(item.dropOrigin.radius) && item.dropOrigin.radius > 0
        ? item.dropOrigin.radius : DROP_EXIT_RADIUS;
      if (distance(item.dropOrigin, player) <= radius) return false;
    }
    return true;
  }

  nearby(player, { candidates = null, requireSpace = false, manual = false } = {}) {
    const nearbyItems = candidates ?? this.items.in(
      player.x - MAGNET_RADIUS / ASPECT, player.y - MAGNET_RADIUS,
      player.x + MAGNET_RADIUS / ASPECT, player.y + MAGNET_RADIUS,
    );
    return nearbyItems
      .filter((item) => this.available(item, player, { manual }) && distance(item, player) <= MAGNET_RADIUS
        && (!requireSpace || this.takes(item))
        && this.pathClear(item, player))
      .sort((a, b) => distance(a, player) - distance(b, player));
  }

  // Pays a coin stack into the pouch once, under its own id. Paid or
  // refused, it leaves the ground with its count spent, so it never lies
  // as free money nor counts against the drop store's room.
  earn(item) {
    const cents = item.count;
    const paid = this.wallet.earn(`coin:${item.uid}`, cents);
    item.count = 0;
    this.items.remove(item);
    this.drops.delete(item);
    if (!paid) return result('paid', 'Those coins were already taken.', { id: DENARS, cents: 0 });
    this.events.push({ type: 'coin', cents, x: item.x, y: item.y });
    return result('earned', `+${denars(cents)}d`, { ok: true, id: DENARS, cents });
  }

  transfer(item) {
    if (coin(item)) return this.earn(item);
    const accepted = this.inventory.add(item.id, item.count, item.extras ?? {});
    if (!accepted) return result('full', 'Inventory full — make room before collecting.', { id: item.id, count: 0 });
    item.count -= accepted;
    if (!item.count) {
      this.items.remove(item);
      this.drops.delete(item);
    }
    const event = { type: 'pickup', id: item.id, count: accepted, x: item.x, y: item.y };
    this.events.push(event);
    return result('picked', `Picked up ${ITEMS[item.id].name}${accepted > 1 ? ` x${accepted}` : ''}.`, {
      ok: true, id: item.id, count: accepted, remaining: item.count,
    });
  }

  interactionTarget(player) {
    const item = this.nearby(player, { manual: true })[0];
    const resource = this.harvesting?.nearby?.(player);
    if (resource && (!item || distance(resource, player) < distance(item, player))) return { resource };
    return item ? { item } : { resource };
  }

  update(dt, player, { blocked = false } = {}) {
    const elapsed = Number.isFinite(dt) && dt > 0 ? dt : 0;
    this.time = this.currentTime + elapsed;
    this.worldState.time = this.time;
    this.items.time = this.time;
    this.blocked = !!blocked;
    this.updateDropOrigins(player);
    if (!this.canCollect(player)) return;

    // Record leaving the origin even when this stack's cooldown is active.
    const candidates = this.items.in(
      player.x - MAGNET_RADIUS / ASPECT, player.y - MAGNET_RADIUS,
      player.x + MAGNET_RADIUS / ASPECT, player.y + MAGNET_RADIUS,
    );
    for (const item of candidates) this.releaseDropOrigin(item, player);

    for (const item of this.nearby(player, { candidates, requireSpace: true })) {
      if (!this.takes(item)) continue;
      let gap = distance(item, player);
      if (gap > TOUCH_RADIUS && elapsed > 0) {
        const amount = Math.min(gap, MAGNET_SPEED * elapsed);
        const fraction = amount / gap;
        const x = item.x + (player.x - item.x) * fraction;
        const y = item.y + (player.y - item.y) * fraction;
        if (this.items.move(item, x, y)) gap = distance(item, player);
      }
      if (gap <= TOUCH_RADIUS) this.transfer(item);
    }
  }

  interact(player) {
    this.updateDropOrigins(player);
    if (!this.canCollect(player)) return result('busy', 'Finish your current action before collecting.');
    const { item } = this.interactionTarget(player);
    if (item) return this.transfer(item);
    return this.harvesting?.interact(player) ?? result('empty', 'Nothing nearby to collect.');
  }

  prompt(player) {
    if (!this.canCollect(player)) return '';
    const { item, resource } = this.interactionTarget(player);
    if (item && coin(item)) return `E Pick up ${denars(item.count)}d`;
    if (item) {
      const name = `${ITEMS[item.id].name}${item.count > 1 ? ` x${item.count}` : ''}`;
      return this.takes(item) ? `E Pick up ${name}` : `Inventory full · ${name}`;
    }
    if (resource?.kind === 'tree') return `J / click Chop ${resource.name}`;
    return resource ? `E ${resource.action || resource.name}` : '';
  }

  drop(player, index, count = 1) {
    const selected = this.inventory.getItem(index);
    if (!selected || !validCount(count) || count > selected.stack.count) {
      return result('invalid', 'Select an item and a valid amount to drop.');
    }
    if (player?.air > 0 || player?.windUp >= 0 || player?.combat?.busy) {
      return result('busy', 'Finish your current action before dropping.');
    }
    if (!positionValid(player)) return result('blocked', 'No safe place nearby to drop this item.');

    const heading = Number.isFinite(player.heading) ? player.heading : 0;
    const turns = [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, Math.PI, 3 * Math.PI / 4, -3 * Math.PI / 4];
    let destination = null;
    for (const radius of DROP_RADII) {
      for (const turn of turns) {
        const angle = heading + turn;
        const point = { x: player.x + Math.sin(angle) * radius / ASPECT, y: player.y + Math.cos(angle) * radius };
        if (this.pathClear(player, point)) {
          destination = point;
          break;
        }
      }
      if (destination) break;
    }
    if (!destination) return result('blocked', 'No safe place nearby to drop this item.');

    const original = { ...selected.stack };
    // Allocate first: a rejected ground placement must never consume the bag.
    const item = this.items.add(original.id, count, destination.x, destination.y, {
      pickupAfter: this.currentTime + DROP_COOLDOWN,
      dropOrigin: { x: player.x, y: player.y, radius: DROP_EXIT_RADIUS },
      extras: stackExtras(original),
    });
    if (!item) return result('blocked', 'No safe place nearby to drop this item.');
    const removed = this.inventory.remove(index, count);
    if (!removed || removed.id !== original.id || removed.count !== count) {
      this.items.remove(item);
      // The source slot is the only slot a removal can change.
      this.inventory.slots[index] = original;
      return result('invalid', 'The selected item could not be dropped.');
    }
    this.drops.add(item);
    return result('dropped', `Dropped ${ITEMS[original.id].name}${count > 1 ? ` x${count}` : ''}.`, {
      ok: true, id: original.id, count, item,
    });
  }
}
