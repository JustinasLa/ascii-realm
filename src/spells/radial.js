// A two-stage radial wheel: the first ring picks a group, the second one of
// its items. Hold to open, point, and release (or click) to choose. Pointing
// past the rim of a group also opens it, so a whole choice fits one gesture.
// The wheel is measured in its own units; the view scales it to the screen.
export const WHEEL = { inner: 84, outer: 224, reach: 1.7, flick: 22 };

// The sector under a point, counted clockwise from the top; -1 in the hub or
// far beyond the rim.
export function sectorAt(dx, dy, count, wheel = WHEEL) {
  const distance = Math.hypot(dx, dy);
  if (!count || distance < wheel.inner || distance > wheel.outer * wheel.reach) return -1;
  const step = Math.PI * 2 / count;
  const angle = (Math.atan2(dx, -dy) + Math.PI * 2) % (Math.PI * 2);
  return Math.floor((angle + step / 2) / step) % count;
}

export class RadialMenu {
  constructor(wheel = WHEEL) {
    this.wheel = wheel;
    this.groups = [];
    this.close();
  }

  // groups: [{ id, items: [{ id }] }]; empty groups are left off the wheel.
  setGroups(groups) {
    this.groups = groups.filter(g => g.items.length);
    if (this.group && !this.groups.includes(this.group)) this.close();
  }

  get entries() { return this.stage === 'items' ? this.group.items : this.groups; }
  get hovered() { return this.entries[this.hover] ?? null; }

  open(held = true) {
    if (!this.groups.length) return false;
    Object.assign(this, { isOpen: true, held, stage: 'groups', group: null, hover: -1, armed: false, dx: 0, dy: 0 });
    return true;
  }

  close(result = { type: 'close' }) {
    Object.assign(this, { isOpen: false, held: false, stage: 'groups', group: null, hover: -1, armed: false, dx: 0, dy: 0 });
    return result;
  }

  enter(group) {
    Object.assign(this, { stage: 'items', group, armed: false });
    this.point(this.dx, this.dy);
    return { type: 'group', group };
  }

  back() {
    if (this.stage !== 'items') return this.close();
    Object.assign(this, { stage: 'groups', group: null, armed: false });
    this.point(this.dx, this.dy);
    return { type: 'back' };
  }

  // The pointer relative to the wheel's centre. Pushing out through a group's
  // rim while holding opens it.
  point(dx, dy) {
    if (!this.isOpen) return null;
    this.dx = dx;
    this.dy = dy;
    const distance = Math.hypot(dx, dy);
    this.hover = sectorAt(dx, dy, this.entries.length, this.wheel);
    if (distance <= this.wheel.outer) this.armed = true;
    if (this.stage === 'groups' && this.held && this.armed && this.hover >= 0
      && distance > this.wheel.outer + this.wheel.flick) return this.enter(this.groups[this.hover]);
    return null;
  }

  // A click or tap on the wheel.
  press(dx = this.dx, dy = this.dy) {
    if (!this.isOpen) return null;
    this.point(dx, dy);
    const distance = Math.hypot(dx, dy);
    if (this.hover < 0) return distance < this.wheel.inner ? (this.stage === 'items' ? this.back() : null) : this.close();
    return this.stage === 'items' ? this.close({ type: 'item', item: this.hovered, group: this.group })
      : this.enter(this.hovered);
  }

  // Letting go of the hold. A group stays open for a click on its items;
  // letting go anywhere else puts the wheel away.
  release() {
    if (!this.isOpen || !this.held) return null;
    this.held = false;
    if (this.hover < 0) return this.close();
    return this.stage === 'items' ? this.close({ type: 'item', item: this.hovered, group: this.group })
      : this.enter(this.hovered);
  }
}

