// Speech bubbles: a line said, shouted or yelled floats over the speaker's
// head for a few seconds, as this page heard it (clean, blurred or only
// `*muffled voices*`). Each speaker has a stack of their last few lines, the
// oldest on top, framed in plain ASCII on a dark shade. The boxes are DOM
// text in a layer above the scene and below the HUD, placed each frame from
// the speaker's position, and every line goes in as text, never markup.
import { SCALE } from '../entities/rig.js';
import { CHAT_CHANNELS } from '../multiplayer/chat.js';

// Distances in metres, times in seconds. `rows` caps how many rows a stack
// may stand, frame and rules included, per form factor; a stack also never
// stands taller than the room between the screen's top and its speaker's
// head. `covered` is the opacity of a bubble whose speaker stands under a
// tree's crown; `edge` keeps a box that many CSS px inside the safe area.
export const BUBBLES = Object.freeze({
  lineChars: 32, maxUtterances: 5, lifetime: 5, fade: 0.4,
  lift: 2.18, bob: 0.12, bobPeriod: 60, bobStep: 8, tickRate: 20, follow: 0.35,
  rows: Object.freeze({ desktop: 20, portrait: 14, landscape: 9 }),
  minWidth: 8, minRows: 3, covered: 0.6, edge: 4, stall: 0.25, settle: 500,
});

const CUT = '...';

// Greedy word wrap: words join a line while it stays within `width`; a word
// longer than that is split into pieces of `width`. Blank text gives [].
export function wrapBubble(text, width = BUBBLES.lineChars) {
  const lines = [];
  let current = '';
  for (const word of String(text ?? '').split(/\s+/)) {
    for (let at = 0; at < word.length; at += width) {
      const piece = word.slice(at, at + width);
      if (!current) current = piece;
      else if (current.length + 1 + piece.length <= width) current += ` ${piece}`;
      else {
        lines.push(current);
        current = piece;
      }
    }
  }
  if (current) lines.push(current);
  return lines;
}

const rule = (left, width, right) => `${left}${'-'.repeat(width + 2)}${right}`;

// The bottom rule with the tail `v` at column `tail` (1 to width + 2).
export function bottomRule(width, tail) {
  const line = rule("'", width, "'");
  const at = Math.max(1, Math.min(width + 2, tail));
  return [line.slice(0, at), 'v', line.slice(at + 1)];
}

// The box for a stack (oldest utterance first) within `budget` rows. The
// newest utterance always shows, cut short with `...` if it alone is too
// tall; older ones join, newest first, while each fits whole. Rows are
// `top`, `text` (with its utterance), `rule` (with the utterance above it)
// and `bottom`.
export function bubbleRows(utterances, budget) {
  const newest = utterances.at(-1);
  const room = Math.max(1, budget - 2);
  let lines = newest.lines;
  if (lines.length > room) {
    lines = lines.slice(0, room);
    lines[room - 1] = `${lines[room - 1].slice(0, BUBBLES.lineChars - CUT.length)}${CUT}`;
  }
  const shown = [{ utterance: newest, lines }];
  let used = lines.length + 2;
  for (let i = utterances.length - 2; i >= 0; i--) {
    const cost = utterances[i].lines.length + 1;
    if (used + cost > budget) break;
    used += cost;
    shown.unshift({ utterance: utterances[i], lines: utterances[i].lines });
  }
  const width = Math.max(BUBBLES.minWidth, ...shown.flatMap((s) => s.lines.map((line) => line.length)));
  const rows = [{ kind: 'top', text: rule('.', width, '.'), utterance: newest }];
  shown.forEach((s, i) => {
    if (i > 0) rows.push({ kind: 'rule', text: rule('|', width, '|'), utterance: shown[i - 1].utterance });
    for (const line of s.lines) rows.push({ kind: 'text', text: line.padEnd(width), utterance: s.utterance });
  });
  rows.push({ kind: 'bottom', text: null, utterance: newest });
  return { rows, width, shown: shown.length };
}

// The slow bob, in rows: every bubble rises and sinks together, once every
// 2π·60/20 seconds.
export function bobRows(t, index = 0, reduced = false) {
  if (reduced) return 0;
  return BUBBLES.bob * SCALE * Math.sin((t * BUBBLES.tickRate + index * BUBBLES.bobStep) / BUBBLES.bobPeriod);
}

// The world row of the tail's tip: 2.18 m over the feet, bobbing, and never
// lower than the row over the nameplate.
export function anchorRow(feetY, nameRow, t, index = 0, reduced = false) {
  return Math.min(feetY - BUBBLES.lift * SCALE + bobRows(t, index, reduced), nameRow - 1);
}

// The top row of a shape-built figure, relative to its feet; its nameplate
// is two rows over it (see the frame in main.js and ui/nameplates.js).
export const figureTop = (parts) => parts.reduce((top, part) => Math.min(top, part.y0), 0);

// How far the anchor moves toward its target after `dt` seconds: 0.35 of
// the way every twentieth of a second, at any frame rate.
export const followShare = (dt) => 1 - (1 - BUBBLES.follow) ** (dt * BUBBLES.tickRate);

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

// How many rows a stack may stand when its tail tip can rise to `tipY` CSS
// px below the top of the safe area: every text row fits, and only the top
// rule may leave the screen at the top of the bob. Never over the form's cap.
export function rowBudget(tipY, lineH, cap) {
  return clamp(Math.floor(tipY / lineH) + 1, BUBBLES.minRows, cap);
}

export class SpeechBubbles {
  constructor({ doc = document, win = doc.defaultView, root, now = () => performance.now(), reducedMotion = () => false,
    pixelRatio = () => globalThis.devicePixelRatio || 1, measure = null, insets = null } = {}) {
    Object.assign(this, { doc, win, root, now, reducedMotion, pixelRatio });
    this.measure = measure ?? ((form) => this.probe(form));
    this.insets = insets ?? (() => this.probeInsets());
    this.stacks = new Map();
    this.metrics = null;
    this.box = null;
    this.settleUntil = -Infinity;
    this.form = null;
    this.last = null;
    // A phone turned from one landscape to the other keeps its size but
    // swaps its notch's side, so the safe area is read again for a moment
    // after any turn or resize. The layer itself can settle on its new size
    // later than the event, so its own resizes count too.
    const unsettle = () => {
      this.box = null;
      this.settleUntil = this.now() + BUBBLES.settle;
    };
    win?.addEventListener?.('resize', unsettle);
    win?.addEventListener?.('orientationchange', unsettle);
    if (win?.ResizeObserver && root) new win.ResizeObserver(unsettle).observe(root);
  }

  get size() { return this.stacks.size; }

  // A line relayed to this page. Only spoken channels show a bubble; the
  // page's own lines go over its own head.
  receive(message, selfId) {
    if (!CHAT_CHANNELS[message?.channel]?.bubble) return;
    const lines = wrapBubble(message.text);
    if (!lines.length) return;
    const key = message.from === selfId ? 'self' : message.from;
    let stack = this.stacks.get(key);
    if (!stack) {
      stack = { utterances: [], node: null, at: null, dirty: true, budget: 0, tail: -1, rows: [], slots: [], opacity: [], z: '',
        transform: '', covered: false, hidden: true };
      this.stacks.set(key, stack);
    }
    stack.utterances.push({ lines, channel: message.channel, muffled: message.muffled === true, born: this.now() });
    while (stack.utterances.length > BUBBLES.maxUtterances) stack.utterances.shift();
    stack.dirty = true;
  }

  // A player leaving takes their bubbles; this page leaving takes them all.
  roster(change) {
    if (change.left === 'self') {
      this.clear();
      return;
    }
    for (const member of change.left ?? []) this.remove(member.id);
  }

  remove(key) {
    this.stacks.get(key)?.node?.remove();
    this.stacks.delete(key);
  }

  clear() {
    for (const key of [...this.stacks.keys()]) this.remove(key);
  }

  // Character width and line height of the bubble font, and whether bold
  // letters keep its width.
  probe(form) {
    const span = this.doc.createElement('span');
    span.className = 'bubble bubble-probe';
    span.textContent = 'M'.repeat(32);
    this.root.append(span);
    const plain = span.getBoundingClientRect();
    span.classList.add('bubble-bold');
    const bold = span.getBoundingClientRect();
    span.remove();
    return { form, charW: plain.width / 32, lineH: plain.height, boldKeepsWidth: Math.abs(bold.width - plain.width) <= 0.5 };
  }

  // The screen's safe-area insets in CSS px (a notch, rounded corners, the
  // home bar), from a hidden probe padded by `env(safe-area-inset-*)`.
  probeInsets() {
    const span = this.doc.createElement('span');
    span.className = 'bubble-safe';
    this.root.append(span);
    const style = this.win.getComputedStyle(span);
    const px = (value) => Number.parseFloat(value) || 0;
    const insets = { top: px(style.paddingTop), left: px(style.paddingLeft), right: px(style.paddingRight) };
    span.remove();
    return insets;
  }

  // The layer's box and the screen's safe area, read once and then again
  // on every frame while a turn or resize settles: read on every frame,
  // after the frame's first DOM writes, they would force a style pass.
  layout(now) {
    if (!this.box || now <= this.settleUntil) {
      const { left, top, width, height } = this.root.getBoundingClientRect();
      this.box = { left, top, width, height, safe: this.insets() };
    }
    return this.box;
  }

  // `anchors` maps a speaker to `{ x, feetY, nameRow, depth, covered }` in
  // world cells; `projection` turns world cells into CSS pixels (or is null);
  // `form` is 'desktop', 'portrait' or 'landscape'.
  update(anchors, projection, form = 'desktop') {
    const now = this.now();
    const dt = this.last === null ? 0 : clamp((now - this.last) / 1000, 0, BUBBLES.stall);
    this.last = now;
    if (form !== this.form) {
      this.form = form;
      this.metrics = null;
      for (const stack of this.stacks.values()) stack.dirty = true;
    }
    const life = BUBBLES.lifetime * 1000;
    for (const [key, stack] of this.stacks) {
      // The oldest goes first, so only a stack whose oldest is due changes.
      if (now - stack.utterances[0].born < life) continue;
      stack.utterances = stack.utterances.filter((u) => now - u.born < life);
      if (!stack.utterances.length) this.remove(key);
      else stack.dirty = true;
    }
    if (!this.stacks.size) return;
    const reduced = this.reducedMotion();
    const t = now / 1000;
    const share = followShare(dt);
    const showing = [];
    for (const [key, stack] of this.stacks) {
      const anchor = anchors?.get(key);
      const feet = anchor && projection ? projection.project(anchor.x, anchor.feetY) : null;
      if (!feet?.visible) {
        this.hide(stack, true);
        stack.at = null;
        continue;
      }
      const row = anchorRow(anchor.feetY, anchor.nameRow, t, 0, reduced);
      if (!stack.at) stack.at = { x: anchor.x, row, feetY: anchor.feetY };
      else {
        stack.at.x += (anchor.x - stack.at.x) * share;
        stack.at.row += (row - stack.at.row) * share;
        stack.at.feetY += (anchor.feetY - stack.at.feetY) * share;
      }
      showing.push({ stack, anchor, tip: Math.min(stack.at.row, anchor.nameRow - 1) });
    }
    if (!showing.length) return;
    this.metrics ??= this.measure(form);
    const box = this.layout(now);
    const { safe } = box;
    const dpr = this.pixelRatio();
    const snap = (v) => Math.round(v * dpr) / dpr;
    const cap = BUBBLES.rows[form] ?? BUBBLES.rows.desktop;
    // The highest the tip rises over standing feet, so a stack keeps its rows
    // through the bob and through a jump (which lifts the nameplate, not the
    // feet). The feet are the higher of where they stand and where the box
    // follows them: a box still coming down keeps its rows until it lands.
    const rise = (BUBBLES.lift + (reduced ? 0 : BUBBLES.bob)) * SCALE;
    showing.sort((a, b) => a.anchor.depth - b.anchor.depth);
    showing.forEach(({ stack, anchor, tip }, rank) => {
      const { charW, lineH } = this.metrics;
      const feetY = Math.min(anchor.feetY, stack.at.feetY);
      const budget = rowBudget(projection.project(stack.at.x, feetY - rise).y - box.top - safe.top, lineH, cap);
      if (stack.dirty || budget !== stack.budget) this.build(stack, budget);
      const p = projection.project(stack.at.x, tip);
      const columns = stack.width + 4;
      const boxW = columns * charW;
      const px = p.x - box.left;
      const left = clamp(px - boxW / 2, safe.left + BUBBLES.edge, box.width - safe.right - BUBBLES.edge - boxW);
      const tail = clamp(Math.floor((px - left) / charW), 1, stack.width + 2);
      if (tail !== stack.tail) this.setTail(stack, tail);
      this.fade(stack, now);
      const transform = `translate(${snap(left)}px, ${snap(p.y - box.top - stack.rows.length * lineH)}px)`;
      if (transform !== stack.transform) stack.node.style.transform = stack.transform = transform;
      const z = String(rank + 1);
      if (z !== stack.z) stack.node.style.zIndex = stack.z = z;
      const covered = Boolean(anchor.covered);
      if (covered !== stack.covered) {
        stack.covered = covered;
        stack.node.classList.toggle('bubble-covered', covered);
      }
      this.hide(stack, false);
    });
  }

  hide(stack, hidden) {
    if (stack.hidden === hidden) return;
    stack.hidden = hidden;
    if (stack.node) stack.node.hidden = hidden;
  }

  // A row of the box: three spans (frame, text or tail, frame) that are
  // kept and rewritten, never rebuilt, so a new line costs a few text writes.
  slot(stack, index) {
    let slot = stack.slots[index];
    if (!slot) {
      const node = this.doc.createElement('span');
      const parts = [0, 1, 2].map(() => this.doc.createElement('span'));
      node.append(...parts);
      slot = { node, parts, className: null, texts: ['', '', ''], classes: ['', '', ''], opacity: '' };
      stack.slots.push(slot);
    }
    return slot;
  }

  // A fading row keeps its layer when it takes another channel's line.
  write(slot, className, texts, classes) {
    if (slot.className !== className) {
      slot.className = className;
      slot.node.className = slot.opacity ? `${className} bubble-fading` : className;
    }
    for (let i = 0; i < 3; i++) {
      if (slot.texts[i] !== texts[i]) slot.parts[i].textContent = slot.texts[i] = texts[i];
      if (slot.classes[i] !== classes[i]) slot.parts[i].className = slot.classes[i] = classes[i];
    }
  }

  // Lays the stack's rows out within `budget` rows, for a new or expired
  // line, another form factor or more or less room overhead.
  build(stack, budget) {
    if (!stack.node) {
      stack.node = this.doc.createElement('div');
      stack.node.className = 'bubble';
      stack.node.hidden = stack.hidden;
      this.root.append(stack.node);
    }
    stack.node.classList.toggle('bubble-no-bold', !this.metrics.boldKeepsWidth);
    const { rows, width } = bubbleRows(stack.utterances, budget);
    stack.rows = rows.map((row, i) => {
      const slot = this.slot(stack, i);
      if (row.kind === 'text') {
        const { channel, muffled } = row.utterance;
        this.write(slot, `bubble-row bubble-${channel}${muffled ? ' bubble-muffled' : ''}`, ['| ', row.text, ' |'],
          ['bubble-frame', 'bubble-text', 'bubble-frame']);
      } else {
        this.write(slot, 'bubble-row bubble-frame', [row.text ?? '', '', ''], ['bubble-frame', '', 'bubble-frame']);
      }
      if (slot.node.parentNode !== stack.node) stack.node.append(slot.node);
      return { ...row, slot };
    });
    for (const spare of stack.slots.splice(rows.length)) spare.node.remove();
    stack.width = width;
    stack.budget = budget;
    stack.tail = -1;
    stack.dirty = false;
  }

  // Only the bottom rule is rewritten when the speaker's column moves under
  // a box held inside the screen.
  setTail(stack, tail) {
    stack.tail = tail;
    this.write(stack.rows.at(-1).slot, 'bubble-row bubble-frame', bottomRule(stack.width, tail),
      ['bubble-frame', 'bubble-tail', 'bubble-frame']);
  }

  // Each utterance fades over its last moments; the frame goes with the
  // newest. A fading row is lifted onto a layer of its own (`bubble-fading`),
  // so its opacity changes without drawing the box again.
  fade(stack, now) {
    const life = BUBBLES.lifetime * 1000;
    const fadeMs = BUBBLES.fade * 1000;
    for (const row of stack.rows) {
      const left = clamp((life - (now - row.utterance.born)) / fadeMs, 0, 1);
      const opacity = left < 1 ? String(Math.round(left * 100) / 100) : '';
      const { slot } = row;
      if (opacity === slot.opacity) continue;
      if (!opacity !== !slot.opacity) slot.node.classList.toggle('bubble-fading', opacity !== '');
      slot.node.style.opacity = slot.opacity = opacity;
    }
  }
}
