// Speech bubbles: a line said, shouted or yelled floats over the speaker's
// head for a few seconds, as this page heard it (clean, blurred or only
// `*muffled voices*`). Each speaker has a stack of their last few lines, the
// oldest on top, framed in plain ASCII on a dark shade. The boxes are DOM
// text in a layer above the scene and below the HUD, placed each frame from
// the speaker's position, and every line goes in as text, never markup.
import { SCALE } from '../entities/rig.js';
import { CHAT_CHANNELS } from '../multiplayer/chat.js';

// Distances in metres, times in seconds. `rows` caps how many rows a stack
// may stand, frame and rules included, per form factor; `covered` is the
// opacity of a bubble whose speaker stands under a tree's crown.
export const BUBBLES = Object.freeze({
  lineChars: 32, maxUtterances: 5, lifetime: 5, fade: 0.4,
  lift: 2.18, bob: 0.12, bobPeriod: 60, bobStep: 8, tickRate: 20, follow: 0.35,
  rows: Object.freeze({ desktop: 20, portrait: 14, landscape: 9 }),
  minWidth: 8, covered: 0.6, edge: 4, stall: 0.25,
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
// is two rows over it (see drawNameTag).
export const figureTop = (parts) => parts.reduce((top, part) => Math.min(top, part.y0), 0);

// How far the anchor moves toward its target after `dt` seconds: 0.35 of
// the way every twentieth of a second, at any frame rate.
export const followShare = (dt) => 1 - (1 - BUBBLES.follow) ** (dt * BUBBLES.tickRate);

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export class SpeechBubbles {
  constructor({ doc = document, root, now = () => performance.now(), reducedMotion = () => false,
    pixelRatio = () => globalThis.devicePixelRatio || 1, measure = null } = {}) {
    Object.assign(this, { doc, root, now, reducedMotion, pixelRatio });
    this.measure = measure ?? ((form) => this.probe(form));
    this.stacks = new Map();
    this.metrics = null;
    this.form = null;
    this.last = null;
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
      stack = { utterances: [], node: null, at: null, dirty: true, tail: -1, rows: [], opacity: [], z: '',
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
      const before = stack.utterances.length;
      stack.utterances = stack.utterances.filter((u) => now - u.born < life);
      if (!stack.utterances.length) this.remove(key);
      else if (stack.utterances.length !== before) stack.dirty = true;
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
      if (!stack.at) stack.at = { x: anchor.x, row };
      else {
        stack.at.x += (anchor.x - stack.at.x) * share;
        stack.at.row += (row - stack.at.row) * share;
      }
      showing.push({ stack, anchor, tip: Math.min(stack.at.row, anchor.nameRow - 1) });
    }
    if (!showing.length) return;
    this.metrics ??= this.measure(form);
    const box = this.root.getBoundingClientRect();
    const dpr = this.pixelRatio();
    const snap = (v) => Math.round(v * dpr) / dpr;
    showing.sort((a, b) => a.anchor.depth - b.anchor.depth);
    showing.forEach(({ stack, anchor, tip }, rank) => {
      if (stack.dirty) this.build(stack, form);
      const { charW, lineH } = this.metrics;
      const p = projection.project(stack.at.x, tip);
      const columns = stack.width + 4;
      const boxW = columns * charW;
      const px = p.x - box.left;
      const left = clamp(px - boxW / 2, BUBBLES.edge, box.width - BUBBLES.edge - boxW);
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

  span(text, className) {
    const node = this.doc.createElement('span');
    node.className = className;
    node.textContent = text;
    return node;
  }

  // Lays the stack's rows out afresh, for a new or expired line or another
  // form factor.
  build(stack, form) {
    if (!stack.node) {
      stack.node = this.doc.createElement('div');
      stack.node.className = 'bubble';
      stack.node.hidden = stack.hidden;
      this.root.append(stack.node);
    }
    stack.node.classList.toggle('bubble-no-bold', !this.metrics.boldKeepsWidth);
    const { rows, width } = bubbleRows(stack.utterances, BUBBLES.rows[form] ?? BUBBLES.rows.desktop);
    stack.node.textContent = '';
    stack.rows = rows.map((row) => {
      const node = this.doc.createElement('span');
      if (row.kind === 'text') {
        const { channel, muffled } = row.utterance;
        node.className = `bubble-row bubble-${channel}${muffled ? ' bubble-muffled' : ''}`;
        node.append(this.span('| ', 'bubble-frame'), this.span(row.text, 'bubble-text'), this.span(' |', 'bubble-frame'));
      } else {
        node.className = 'bubble-row bubble-frame';
        if (row.text !== null) node.textContent = row.text;
      }
      stack.node.append(node);
      return { ...row, node, opacity: '' };
    });
    stack.width = width;
    stack.tail = -1;
    stack.dirty = false;
  }

  // Only the bottom rule is rewritten when the speaker's column moves under
  // a box held inside the screen.
  setTail(stack, tail) {
    stack.tail = tail;
    const [left, , right] = bottomRule(stack.width, tail);
    const bottom = stack.rows.at(-1).node;
    bottom.textContent = '';
    bottom.append(this.span(left, 'bubble-frame'), this.span('v', 'bubble-tail'), this.span(right, 'bubble-frame'));
  }

  // Each utterance fades over its last moments; the frame goes with the
  // newest.
  fade(stack, now) {
    const life = BUBBLES.lifetime * 1000;
    const fadeMs = BUBBLES.fade * 1000;
    for (const row of stack.rows) {
      const left = clamp((life - (now - row.utterance.born)) / fadeMs, 0, 1);
      const opacity = left < 1 ? String(Math.round(left * 100) / 100) : '';
      if (opacity !== row.opacity) row.node.style.opacity = row.opacity = opacity;
    }
  }
}
