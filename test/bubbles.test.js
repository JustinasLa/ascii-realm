import assert from 'node:assert/strict';
import { test } from 'node:test';
import { drawNameTag } from '../src/entities/figure.js';
import { SCALE } from '../src/entities/rig.js';
import { MAX_CHAT_LENGTH } from '../src/multiplayer/chat.js';
import { anchorRow, bobRows, bottomRule, BUBBLES, bubbleRows, figureTop, followShare, rowBudget, SpeechBubbles,
  wrapBubble } from '../src/ui/bubbles.js';

// Just enough DOM for the bubbles: elements with children, classes, a style
// and text. Markup is refused, so any HTML use fails.
class El {
  constructor(tagName) {
    Object.assign(this, { tagName: tagName.toUpperCase(), children: [], parentNode: null, style: {}, hidden: false,
      className: '', _text: '', rect: { left: 0, top: 0, width: 0, height: 0 } });
    const tokens = () => new Set(this.className.split(/\s+/).filter(Boolean));
    this.classList = {
      contains: (name) => tokens().has(name),
      add: (...names) => { this.className = [...new Set([...tokens(), ...names])].join(' '); },
      toggle: (name, on) => {
        const set = tokens();
        if (on) set.add(name);
        else set.delete(name);
        this.className = [...set].join(' ');
      },
    };
  }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set textContent(value) { this.children = []; this._text = String(value); }
  set innerHTML(_) { throw new Error('bubbles must never use innerHTML'); }
  set outerHTML(_) { throw new Error('bubbles must never use outerHTML'); }
  insertAdjacentHTML() { throw new Error('bubbles must never use insertAdjacentHTML'); }
  append(...nodes) {
    for (const node of nodes) {
      node.remove();
      node.parentNode = this;
      this.children.push(node);
    }
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
    this.parentNode = null;
  }
  getBoundingClientRect() { return this.rect; }
  get rows() { return this.children.map((c) => c.textContent); }
}

const CHAR_W = 7;
const LINE_H = 14;
const CELL = { w: 4, h: 8 };

// A view of world cells: 1 cell = 4 x 8 CSS px, the world's (0, 0) at the
// screen's corner, 1280 x 720 px.
const projection = {
  project: (x, y) => ({ x: x * CELL.w, y: y * CELL.h, visible: x >= 0 && x <= 320 && y >= 0 && y <= 90 }),
};

// A window whose safe-area insets the test sets; `getComputedStyle` gives
// them as the probe's padding, the way `env(safe-area-inset-*)` does.
function fakeWindow() {
  const listeners = {};
  const win = {
    safe: { top: 0, right: 0, left: 0 }, reads: 0, listeners, resized: null,
    // Calls `resized()` when the layer settles on a new size after layout.
    ResizeObserver: class {
      constructor(fn) { this.fn = fn; }
      observe(node) { win.resized = () => this.fn([{ target: node }]); }
    },
    addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
    fire: (type) => { for (const fn of listeners[type] ?? []) fn(); },
    getComputedStyle: (node) => {
      assert.ok(node.className.includes('bubble-safe') && node.parentNode, 'read from a probe in the layer');
      win.reads++;
      const { top, right, left } = win.safe;
      return { paddingTop: `${top}px`, paddingRight: `${right}px`, paddingLeft: left ? `${left}px` : '', paddingBottom: '0px' };
    },
  };
  return win;
}

function setup({ reduced = false, measure, dpr = 1 } = {}) {
  const win = fakeWindow();
  const doc = { createElement: (tag) => new El(tag), defaultView: win };
  const root = new El('div');
  root.rect = { left: 0, top: 0, width: 1280, height: 720 };
  let time = 1000;
  const bubbles = new SpeechBubbles({ doc, root, now: () => time, reducedMotion: () => reduced, pixelRatio: () => dpr,
    measure: measure === undefined ? (() => ({ charW: CHAR_W, lineH: LINE_H, boldKeepsWidth: true })) : measure });
  const boxes = () => root.children;
  return { doc, win, root, bubbles, boxes, tick: (ms) => { time += ms; }, at: () => time };
}

const line = (text, { from = 'b2', channel = 'rp', muffled = false } = {}) => ({ seq: 1, channel, from, name: 'Bryn',
  text, clarity: 1, muffled });
const anchors = (entries) => new Map(entries);
const speaker = (x = 160, feetY = 70, extra = {}) => ({ x, feetY, nameRow: feetY - 25, depth: feetY, covered: false, ...extra });
const translate = (node) => node.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/).slice(1).map(Number);

test('the wrap matches the greedy word wrap at 32 columns', () => {
  const cases = [
    ['well met, traveller', ['well met, traveller']],
    ['Have you seen the old mill by the river? They say the miller vanished last spring.',
      ['Have you seen the old mill by', 'the river? They say the miller', 'vanished last spring.']],
    ['a'.repeat(32), ['a'.repeat(32)]],
    [`${'a'.repeat(32)} b`, ['a'.repeat(32), 'b']],
    ['aaaa bbbb', ['aaaa bbbb']],
  ];
  for (const [text, lines] of cases) assert.deepEqual(wrapBubble(text), lines, text);
  // 32 fit on a line; 33 wrap.
  assert.deepEqual(wrapBubble(`${'x'.repeat(30)} y`), [`${'x'.repeat(30)} y`]);
  assert.deepEqual(wrapBubble(`${'x'.repeat(30)} yz`), ['x'.repeat(30), 'yz']);
  assert.deepEqual(wrapBubble(''), []);
  assert.deepEqual(wrapBubble('   '), []);
  assert.deepEqual(wrapBubble(undefined), []);
  assert.deepEqual(wrapBubble('one two', 3), ['one', 'two']);
});

test('a word over 32 characters is split into 32-character pieces, and no line is wider', () => {
  assert.deepEqual(wrapBubble('a'.repeat(40)), ['a'.repeat(32), 'a'.repeat(8)]);
  assert.deepEqual(wrapBubble(`go ${'a'.repeat(70)} now`), ['go', 'a'.repeat(32), 'a'.repeat(32), 'a'.repeat(6) + ' now']);
  // Sixteen-character words fill a line one at a time: fifteen lines for a
  // whole message.
  const words = Array.from({ length: 15 }, (_, i) => String(i).padStart(16, 'w'));
  const lines = wrapBubble(words.join(' ').slice(0, MAX_CHAT_LENGTH));
  assert.equal(lines.length, 15);
  for (const text of [words.join(' '), 'a'.repeat(MAX_CHAT_LENGTH), 'ab '.repeat(85)]) {
    for (const piece of wrapBubble(text)) assert.ok(piece.length <= BUBBLES.lineChars, piece);
  }
});

test('the box frames each utterance, oldest on top, with the tail under it', () => {
  const one = bubbleRows([{ lines: ['well met, traveller'] }], 20);
  assert.equal(one.width, 19);
  assert.deepEqual(one.rows.map((r) => r.kind), ['top', 'text', 'bottom']);
  assert.equal(one.rows[0].text, '.---------------------.');
  assert.equal(one.rows[1].text, 'well met, traveller');
  assert.deepEqual(bottomRule(one.width, 11), ["'----------", 'v', "----------'"]);
  assert.deepEqual(bottomRule(4, 0), ["'", 'v', "-----'"], 'never on a corner');
  assert.deepEqual(bottomRule(4, 99), ["'-----", 'v', "'"]);

  const old = { lines: ['the road is out'] };
  const newer = { lines: ['well met, traveller.', 'have you seen the mill?'] };
  const two = bubbleRows([old, newer], 20);
  assert.equal(two.width, 23);
  assert.deepEqual(two.rows.map((r) => [r.kind, r.text, r.utterance]), [
    ['top', '.-------------------------.', newer],
    ['text', 'the road is out        ', old],
    ['rule', '|-------------------------|', old],
    ['text', 'well met, traveller.   ', newer],
    ['text', 'have you seen the mill?', newer],
    ['bottom', null, newer],
  ]);
  assert.equal(bubbleRows([{ lines: ['hi'] }], 20).width, BUBBLES.minWidth, 'at least eight wide');
});

test('the row budget keeps the newest utterance and drops the oldest first', () => {
  const u = (n, tag) => ({ lines: Array.from({ length: n }, (_, i) => `${tag}${i}`) });
  // Phone landscape: nine rows hold four one-line utterances (4 + 3 + 2).
  const four = [u(1, 'a'), u(1, 'b'), u(1, 'c'), u(1, 'd'), u(1, 'e')];
  const landscape = bubbleRows(four, BUBBLES.rows.landscape);
  assert.equal(landscape.rows.length, 9);
  assert.equal(landscape.shown, 4);
  assert.deepEqual(landscape.rows.filter((r) => r.kind === 'text').map((r) => r.text.trim()), ['b0', 'c0', 'd0', 'e0']);
  // An older one that doesn't fit whole is left out, and so is all above it.
  const stack = [u(1, 'a'), u(4, 'b'), u(2, 'c')];
  assert.deepEqual(bubbleRows(stack, 8).rows.filter((r) => r.kind === 'text').map((r) => r.text.trim()), ['c0', 'c1']);
  assert.equal(bubbleRows(stack, 9).shown, 2);
  assert.equal(bubbleRows(stack, 11).shown, 3);
  // The newest alone over the budget is cut short with '...'.
  const long = { lines: wrapBubble(Array.from({ length: 25 }, () => 'abcdefghij').join(' ')) };
  const cut = bubbleRows([u(1, 'a'), long], BUBBLES.rows.landscape);
  const text = cut.rows.filter((r) => r.kind === 'text').map((r) => r.text);
  assert.equal(text.length, 7);
  assert.equal(text.at(-1).trim(), 'abcdefghij abcdefghij abcdefg...');
  assert.equal(text.at(-1).trim().length, 32);
  assert.ok(text.every((t) => t.length <= 32));
  for (const form of ['desktop', 'portrait', 'landscape']) {
    assert.ok(bubbleRows([long], BUBBLES.rows[form]).rows.length <= BUBBLES.rows[form], form);
  }
  assert.equal(bubbleRows([{ lines: ['short', 'more'] }], 3).rows.at(-2).text.trim(), 'short...', 'a short line still ends in ...');
  assert.equal(bubbleRows([{ lines: ['one', 'two'] }], 1).rows.length, 3, 'one line at the very least');
});

test('the tail tip hangs 2.18 m over the feet, bobs slowly and never sinks onto the nameplate', () => {
  assert.equal(anchorRow(100, Infinity, 0, 0, true), 100 - 2.18 * SCALE);
  assert.equal(anchorRow(100, Infinity, 0), 100 - 2.18 * SCALE, 'no bob at t = 0');
  assert.ok(Math.abs(bobRows(Math.PI * 1.5) - 0.12 * SCALE) < 1e-9, 'the bob peaks at 1.56 rows');
  const period = 2 * Math.PI * 60 / 20;
  assert.ok(Math.abs(bobRows(1.234) - bobRows(1.234 + period)) < 1e-9);
  assert.ok(Math.abs(bobRows(1.234) - bobRows(1.234 + period / 2)) > 0.5);
  assert.equal(bobRows(Math.PI * 1.5, 0, true), 0, 'still under reduced motion');
  assert.notEqual(bobRows(1, 1), bobRows(1, 0), 'each step of the stack has its own phase');
  // A jump lifts the nameplate over the lift: the tip stays a row above it.
  assert.equal(anchorRow(100, 60, 0, 0, true), 59);
});

test('the follow moves 0.35 of the way every twentieth of a second at any frame rate', () => {
  assert.ok(Math.abs(followShare(0.05) - 0.35) < 1e-12);
  const twice = 1 - (1 - followShare(0.025)) ** 2;
  assert.ok(Math.abs(twice - 0.35) < 1e-9);
  assert.equal(followShare(0), 0);
});

test('the nameplate row the bubbles guard is the one the nameplate is drawn on', () => {
  for (const [y, parts] of [[100.4, [{ y0: -23.2 }, { y0: -10 }]], [57, []], [80.9, [{ y0: -0.5 }]]]) {
    const rows = new Set();
    drawNameTag({ put: (x, row) => rows.add(row), putBg() {} }, { x0: 0, y0: 0 }, { x: 10, y }, parts, 'Ash');
    assert.deepEqual([...rows], [Math.floor(y + figureTop(parts)) - 2]);
  }
});

test('only spoken channels make a bubble, keyed by the speaker, own lines as self', () => {
  const { bubbles } = setup();
  for (const channel of ['whisper', 'ooc', 'looc', 'action', 'scene']) bubbles.receive(line('psst', { channel }), 'a1');
  bubbles.receive(null, 'a1');
  bubbles.receive(line('   '), 'a1');
  assert.equal(bubbles.size, 0);
  for (const channel of ['rp', 'shout', 'yell']) bubbles.receive(line(`a ${channel}`, { channel }), 'a1');
  bubbles.receive(line('my own', { from: 'a1' }), 'a1');
  assert.deepEqual([...bubbles.stacks.keys()], ['b2', 'self']);
  assert.deepEqual(bubbles.stacks.get('b2').utterances.map((u) => u.channel), ['rp', 'shout', 'yell']);
});

test('a sixth line drops the oldest; each line goes 5 s after it arrived, with its box', () => {
  const { bubbles, boxes, tick } = setup();
  for (let i = 1; i <= 6; i++) {
    bubbles.receive(line(`line ${i}`), 'a1');
    tick(100);
  }
  assert.deepEqual(bubbles.stacks.get('b2').utterances.map((u) => u.lines[0]), ['line 2', 'line 3', 'line 4', 'line 5', 'line 6']);
  const where = anchors([['b2', speaker()]]);
  bubbles.update(where, projection);
  assert.equal(boxes().length, 1);
  // Line 2 arrived at +100 ms and line 6 at +500 ms; it is now +600 ms.
  tick(4499);
  bubbles.update(where, projection);
  assert.equal(bubbles.stacks.get('b2').utterances.length, 5, 'still there at 4999 ms');
  tick(1);
  bubbles.update(where, projection);
  assert.equal(bubbles.stacks.get('b2').utterances.length, 4, 'gone at 5000 ms');
  assert.equal(boxes()[0].rows.filter((r) => r.startsWith('| ')).length, 4, 'and the box is laid out again');
  tick(400);
  bubbles.update(where, projection);
  assert.equal(bubbles.size, 0);
  assert.equal(boxes().length, 0, 'the last line takes the box with it');
});

test('an utterance is opaque for 4.6 s and fades over its last 0.4 s', () => {
  const { bubbles, boxes, tick } = setup();
  bubbles.receive(line('first'), 'a1');
  tick(1000);
  bubbles.receive(line('second'), 'a1');
  const where = anchors([['b2', speaker()]]);
  tick(3600);
  bubbles.update(where, projection);
  const rows = () => boxes()[0].children;
  const opacity = (i) => rows()[i].style.opacity ?? '';
  assert.equal(opacity(1), '', 'the first line at 4.6 s');
  tick(200);
  bubbles.update(where, projection);
  assert.equal(opacity(1), '0.5', 'its text at 4.8 s');
  assert.equal(opacity(2), '0.5', 'and the rule under it');
  assert.equal(opacity(0), '', 'the frame goes with the newest line');
  assert.equal(opacity(3), '');
  tick(1);
  bubbles.update(where, projection);
  assert.equal(opacity(1), '0.5', 'written only when it changes');
  const fading = () => rows().map((row) => row.classList.contains('bubble-fading'));
  assert.deepEqual(fading(), [false, true, true, false, false], 'only fading rows get a layer of their own');
  // The first line goes; its rows now hold the second line, opaque again.
  tick(200);
  bubbles.update(where, projection);
  assert.deepEqual(boxes()[0].rows.map((r) => r.trim()), ['.----------.', '| second   |', "'-----v----'"]);
  assert.deepEqual(fading(), [false, false, false]);
  assert.equal(opacity(1), '');
});

test('leaving the lobby clears the bubbles; a player leaving takes theirs', () => {
  const { bubbles, boxes } = setup();
  bubbles.receive(line('hi'), 'a1');
  bubbles.receive(line('yo', { from: 'c3' }), 'a1');
  bubbles.update(anchors([['b2', speaker()], ['c3', speaker(100)]]), projection);
  assert.equal(boxes().length, 2);
  bubbles.roster({ joined: [{ id: 'd4' }] });
  assert.equal(bubbles.size, 2);
  bubbles.roster({ left: [{ id: 'c3', name: 'Cai' }] });
  assert.deepEqual([...bubbles.stacks.keys()], ['b2']);
  assert.equal(boxes().length, 1);
  bubbles.roster({ left: 'self' });
  assert.equal(bubbles.size, 0);
  assert.equal(boxes().length, 0);
});

test('a speaker out of view has no box, and shows with the time left once in view', () => {
  const { bubbles, boxes, tick } = setup();
  bubbles.receive(line('hello'), 'a1');
  bubbles.update(anchors([]), projection);
  assert.equal(boxes().length, 0, 'no anchor yet');
  bubbles.update(anchors([['b2', speaker(500)]]), projection);
  assert.equal(boxes().length, 0, 'off screen');
  bubbles.update(anchors([['b2', speaker()]]), null);
  assert.equal(boxes().length, 0, 'no view yet');
  tick(4000);
  bubbles.update(anchors([['b2', speaker()]]), projection);
  assert.equal(boxes().length, 1);
  assert.equal(boxes()[0].hidden, false);
  bubbles.update(anchors([['b2', speaker(500)]]), projection);
  assert.equal(boxes()[0].hidden, true, 'walking off hides it');
  bubbles.update(anchors([['b2', speaker()]]), projection);
  assert.equal(boxes()[0].hidden, false);
  tick(1000);
  bubbles.update(anchors([['b2', speaker()]]), projection);
  assert.equal(bubbles.size, 0, 'it still goes 5 s after it arrived');
});

test('the box sits on the tail tip, centred over the speaker, snapped to device pixels', () => {
  const { bubbles, boxes } = setup({ reduced: true, dpr: 2 });
  bubbles.receive(line('well met, traveller'), 'a1');
  const feet = 70;
  bubbles.update(anchors([['b2', speaker(160.3, feet)]]), projection);
  const node = boxes()[0];
  assert.equal(node.rows.length, 3);
  const [left, top] = translate(node);
  const tip = (feet - 2.18 * SCALE) * CELL.h;
  assert.ok(Math.abs(top + 3 * LINE_H - tip) <= 0.25, 'the box bottom is on the tip');
  const width = (19 + 4) * CHAR_W;
  assert.ok(Math.abs(left + width / 2 - 160.3 * CELL.w) <= 0.25, 'centred');
  assert.equal(left * 2, Math.round(left * 2), 'on a device pixel');
  const bottom = node.children.at(-1);
  assert.equal(bottom.children[1].textContent, 'v');
  assert.equal(bottom.children[1].className, 'bubble-tail');
  const tail = (bottom.children[0].textContent.length + 0.5) * CHAR_W + left;
  assert.ok(Math.abs(tail - 160.3 * CELL.w) <= CHAR_W, 'the v is over the speaker');
});

test('near a screen edge the box stays inside and the v follows the speaker', () => {
  const { bubbles, boxes, root } = setup({ reduced: true });
  bubbles.receive(line('well met, traveller'), 'a1');
  const width = (19 + 4) * CHAR_W;
  const tails = [];
  for (const x of [2, 6, 12, 20, 300, 310, 319]) {
    bubbles.update(anchors([['b2', speaker(x)]]), projection);
    // The anchor follows; settle it there.
    bubbles.stacks.get('b2').at.x = x;
    bubbles.update(anchors([['b2', speaker(x)]]), projection);
    const node = boxes()[0];
    const [left] = translate(node);
    assert.ok(left >= BUBBLES.edge && left + width <= root.rect.width - BUBBLES.edge, `inside at ${x}`);
    const before = node.children.at(-1).children[0].textContent.length;
    const tail = left + (before + 0.5) * CHAR_W;
    assert.ok(Math.abs(tail - x * CELL.w) <= CHAR_W || before === 1 || before === 21, `v over the speaker at ${x}`);
    tails.push(before);
  }
  assert.equal(new Set(tails).size, tails.length, 'the bottom rule is rewritten as the speaker walks');
  assert.equal(tails[0], 1, 'never past the corner');
});

test('the box keeps above the nameplate on every frame of a fast rise', () => {
  const { bubbles, boxes, tick } = setup();
  bubbles.receive(line('hup!'), 'a1');
  let feet = 80;
  for (let frame = 0; frame < 40; frame++) {
    // A jump: the head and the nameplate rise 1.5 rows a frame, much faster
    // than the follow.
    const nameRow = feet - 25 - (frame < 20 ? frame * 1.5 : (40 - frame) * 1.5);
    bubbles.update(anchors([['b2', speaker(160, feet, { nameRow })]]), projection);
    const node = boxes()[0];
    const [, top] = translate(node);
    const bottom = top + node.rows.length * LINE_H;
    assert.ok(bottom <= nameRow * CELL.h - CELL.h + 0.5, `frame ${frame}: ${bottom} over ${nameRow * CELL.h}`);
    tick(16);
    feet += 0.1;
  }
});

test('the anchor follows the speaker, and a stall snaps rather than drifts', () => {
  const { bubbles, tick } = setup({ reduced: true });
  bubbles.receive(line('walking'), 'a1');
  bubbles.update(anchors([['b2', speaker(100)]]), projection);
  const at = () => bubbles.stacks.get('b2').at;
  assert.equal(at().x, 100, 'a new box starts on its speaker');
  tick(50);
  bubbles.update(anchors([['b2', speaker(120)]]), projection);
  assert.ok(Math.abs(at().x - 107) < 1e-9, '0.35 of the way in 50 ms');
  tick(3000);
  bubbles.update(anchors([['b2', speaker(120)]]), projection);
  assert.ok(Math.abs(at().x - (107 + 13 * followShare(0.25))) < 1e-9, 'a stall counts as a quarter second at most');
  bubbles.update(anchors([['b2', speaker(500)]]), projection);
  assert.equal(at(), null, 'out of view, it forgets where it was');
});

test('nearer speakers are drawn on top; a speaker under a crown is dimmed', () => {
  const { bubbles, boxes } = setup();
  bubbles.receive(line('far'), 'a1');
  bubbles.receive(line('near', { from: 'c3' }), 'a1');
  bubbles.update(anchors([['b2', speaker(150, 70)], ['c3', speaker(160, 80, { covered: true })]]), projection);
  const [far, near] = boxes();
  assert.equal(far.style.zIndex, '1');
  assert.equal(near.style.zIndex, '2');
  assert.equal(near.classList.contains('bubble-covered'), true);
  assert.equal(far.classList.contains('bubble-covered'), false);
  bubbles.update(anchors([['b2', speaker(150, 90)], ['c3', speaker(160, 80)]]), projection);
  assert.equal(far.style.zIndex, '2');
  assert.equal(near.style.zIndex, '1');
  assert.equal(near.classList.contains('bubble-covered'), false);
});

test('channel and muffling set the text style; the form sets the budget', () => {
  const { bubbles, boxes } = setup();
  bubbles.receive(line('*muffled voices*', { muffled: true }), 'a1');
  bubbles.receive(line('WOLVES', { channel: 'yell' }), 'a1');
  for (let i = 0; i < 3; i++) bubbles.receive(line(`over here ${i}`, { channel: 'shout' }), 'a1');
  const where = anchors([['b2', speaker()]]);
  bubbles.update(where, projection);
  const classes = () => boxes()[0].children.filter((r) => r.className.includes('bubble-row bubble-')).map((r) => r.className);
  assert.deepEqual(classes().filter((c) => !c.endsWith('bubble-frame')), ['bubble-row bubble-rp bubble-muffled',
    'bubble-row bubble-yell', 'bubble-row bubble-shout', 'bubble-row bubble-shout', 'bubble-row bubble-shout']);
  assert.equal(boxes()[0].rows.length, 11);
  bubbles.update(where, projection, 'landscape');
  assert.equal(boxes()[0].rows.length, 9, 'four on a landscape phone');
  bubbles.update(where, projection, 'portrait');
  assert.equal(boxes()[0].rows.length, 11);
  bubbles.update(where, projection, 'unknown');
  assert.equal(boxes()[0].rows.length, 11, 'anything else counts as desktop');
});

test('the font is measured once per form, and bold yells drop bold if it would widen them', () => {
  const { bubbles, boxes, root } = setup({ measure: null });
  const widths = { plain: 32 * 7, bold: 32 * 7 };
  const append = root.append.bind(root);
  const probes = [];
  root.append = (node) => {
    append(node);
    if (node.className.includes('bubble-probe')) {
      probes.push(node.textContent);
      node.getBoundingClientRect = () => ({ width: node.classList.contains('bubble-bold') ? widths.bold : widths.plain, height: 14 });
    }
  };
  bubbles.receive(line('WOLVES', { channel: 'yell' }), 'a1');
  const where = anchors([['b2', speaker()]]);
  bubbles.update(where, projection);
  bubbles.update(where, projection);
  assert.deepEqual(probes, ['M'.repeat(32)], 'measured once');
  assert.deepEqual(bubbles.metrics, { form: 'desktop', charW: 7, lineH: 14, boldKeepsWidth: true });
  assert.equal(boxes().length, 1, 'the probe is gone again');
  assert.equal(boxes()[0].classList.contains('bubble-no-bold'), false);
  widths.bold = 32 * 7.5;
  bubbles.update(where, projection, 'portrait');
  assert.equal(probes.length, 2, 'measured again for the phone font');
  assert.equal(boxes()[0].classList.contains('bubble-no-bold'), true);
});

test('chat text reaches the page only as text', () => {
  const { bubbles, boxes } = setup();
  const attack = '<img src=x onerror=alert(1)>';
  bubbles.receive(line(attack), 'a1');
  bubbles.update(anchors([['b2', speaker()]]), projection);
  const text = boxes()[0].children[1].children[1];
  assert.equal(text.textContent.trim(), attack);
  assert.equal(text.children.length, 0, 'no element made from it');
  assert.equal(boxes()[0].children.every((row) => row.children.every((c) => c.children.length === 0)), true);
});

test('nothing is laid out while no speaker is in view, and a cleared page stays empty', () => {
  const { bubbles, boxes } = setup({ measure: () => { throw new Error('measured with nothing to show'); } });
  bubbles.update(anchors([]), projection);
  bubbles.receive(line('hello'), 'a1');
  bubbles.update(anchors([]), projection);
  bubbles.clear();
  bubbles.update(anchors([['b2', speaker()]]), projection);
  assert.equal(boxes().length, 0);
  assert.equal(bubbles.size, 0);
});

test('a landscape phone keeps the box out of its notch, either way round and after a turn', () => {
  const { bubbles, boxes, root, win, tick } = setup({ reduced: true });
  root.rect = { left: 0, top: 0, width: 852, height: 393 };
  win.safe = { top: 0, left: 59, right: 0 };
  bubbles.receive(line('well met, traveller'), 'a1');
  const width = (19 + 4) * CHAR_W;
  // Settles the anchor over a speaker at column `x` and gives the box's
  // left edge and the length of the bottom rule before the `v`.
  const place = (x) => {
    bubbles.update(anchors([['b2', speaker(x, 60)]]), projection, 'landscape');
    bubbles.stacks.get('b2').at.x = x;
    bubbles.update(anchors([['b2', speaker(x, 60)]]), projection, 'landscape');
    tick(16);
    const node = boxes()[0];
    return { left: translate(node)[0], before: node.children.at(-1).children[0].textContent.length };
  };
  // The notch on the left: a speaker under it has the box beside it, the
  // v at the box's corner, as near the speaker as it can be.
  assert.deepEqual(place(2), { left: 59 + BUBBLES.edge, before: 1 });
  assert.equal(place(40).left, Math.round(40 * CELL.w - width / 2), 'clear of the notch, centred again');
  assert.equal(place(212).left, 852 - BUBBLES.edge - width, 'the right edge has no notch');
  // Turned the other way: the same size, the notch now on the right.
  win.safe = { top: 0, left: 0, right: 59 };
  win.fire('orientationchange');
  tick(100);
  assert.equal(place(2).left, BUBBLES.edge, 'the left edge is free now');
  const right = place(212);
  assert.equal(right.left, 852 - 59 - BUBBLES.edge - width);
  assert.equal(right.before, 21, 'the v at the far corner, toward the speaker');
  // Turned upright, the layer settling on its new size well after the
  // resize event.
  win.fire('resize');
  tick(BUBBLES.settle * 2);
  place(97);
  root.rect = { left: 0, top: 0, width: 393, height: 852 };
  win.safe = { top: 59, left: 0, right: 0 };
  win.resized();
  assert.equal(place(1).left, BUBBLES.edge);
  assert.equal(place(97).left, 393 - BUBBLES.edge - width);
  assert.equal(root.children.some((node) => node.className.includes('bubble-safe')), false, 'the probe is gone again');
});

test('the screen box and safe area are read once, and on every frame while a turn settles', () => {
  const { bubbles, win, tick, root } = setup({ reduced: true });
  let boxReads = 0;
  root.getBoundingClientRect = () => { boxReads++; return root.rect; };
  bubbles.receive(line('hello'), 'a1');
  const where = anchors([['b2', speaker()]]);
  bubbles.update(where, projection);
  bubbles.update(where, projection);
  assert.equal(win.reads, 1, 'read once while nothing changes');
  win.fire('resize');
  for (let i = 0; i < 3; i++) {
    tick(BUBBLES.settle / 4);
    bubbles.update(where, projection);
  }
  assert.equal(win.reads, 4, 'read on each frame of the turn');
  tick(BUBBLES.settle);
  bubbles.update(where, projection);
  assert.equal(win.reads, 4, 'settled');
  assert.equal(boxReads, 4, 'the box with it');
  // Turned while nobody speaks: the next bubble still reads the new screen.
  tick(BUBBLES.lifetime * 1000);
  bubbles.update(where, projection);
  assert.equal(bubbles.size, 0);
  root.rect = { left: 0, top: 0, width: 600, height: 900 };
  win.fire('orientationchange');
  tick(BUBBLES.settle * 2);
  bubbles.receive(line('hello again'), 'a1');
  bubbles.update(where, projection);
  assert.equal(bubbles.box.width, 600);
  assert.equal(win.reads, 5);
  assert.deepEqual(new SpeechBubbles({ doc: { defaultView: null }, root: new El('div') }).box, null, 'no window, no listeners');
});

test('a stack stands only as tall as the room over its speaker, within the form cap', () => {
  const { bubbles, boxes, win } = setup({ reduced: true });
  // Nine lines of five-letter words.
  bubbles.receive(line('word '.repeat(50).trim()), 'a1');
  const rise = BUBBLES.lift * SCALE;
  // Feet that put the highest tip `px` CSS px under the screen's top.
  const feetFor = (px) => rise + px / CELL.h;
  // Each view is a teleport: the box starts on its speaker.
  const show = (feetY, form = 'desktop', extra = {}) => {
    if (bubbles.stacks.get('b2')) bubbles.stacks.get('b2').at = null;
    bubbles.update(anchors([['b2', speaker(160, feetY, extra)]]), projection, form);
    const node = boxes()[0];
    return { rows: node.rows, top: translate(node)[1] };
  };
  const roomy = show(70);
  assert.equal(roomy.rows.length, 11, 'all nine lines with room to spare');
  assert.ok(roomy.rows[1].includes('word word'));
  const six = show(feetFor(5 * LINE_H + 5));
  assert.equal(six.rows.length, 6, 'room for five rows and the top rule: four lines');
  assert.ok(six.rows[4].includes('word...'), 'cut at the end, never at the start');
  assert.ok(six.rows[1].startsWith('| word word'));
  assert.ok(six.top + LINE_H >= 0, `the first line is on the screen (${six.top})`);
  // With the tip at full height (no nameplate under it), only the top rule
  // may be over the screen's edge.
  const high = show(feetFor(5 * LINE_H + 5), 'desktop', { nameRow: Infinity });
  assert.equal(high.rows.length, 6);
  assert.ok(high.top < 0 && high.top + LINE_H >= 0, `the top rule over the edge, the text under it (${high.top})`);
  assert.equal(show(feetFor(30 * LINE_H), 'landscape').rows.length, 9, 'never over the form cap');
  assert.equal(show(feetFor(-50)).rows.length, BUBBLES.minRows, 'a head over the top still shows its first line');
  // A jump lifts the nameplate, not the feet: the rows stay and the box
  // still clears the nameplate.
  const feet = feetFor(5 * LINE_H + 5);
  show(feet);
  const nameRow = feet - 40;
  const jumping = show(feet, 'desktop', { nameRow });
  assert.equal(jumping.rows.length, 6);
  assert.ok(jumping.top + 6 * LINE_H <= (nameRow - 1) * CELL.h + 0.5, 'above the nameplate mid-jump');
  // A notch or status bar over the top takes its rows.
  win.safe = { top: 28, left: 0, right: 0 };
  win.fire('resize');
  assert.equal(show(feet).rows.length, 4);
  assert.equal(rowBudget(6 * LINE_H, LINE_H, 9), 7);
  assert.equal(rowBudget(20 * LINE_H, LINE_H, 9), 9);
  assert.equal(rowBudget(-1, LINE_H, 9), BUBBLES.minRows);
});

test('a speaker walking down the screen keeps the first line on it while the box follows', () => {
  const { bubbles, boxes, tick } = setup({ reduced: true });
  bubbles.receive(line('word '.repeat(50).trim()), 'a1');
  const rise = BUBBLES.lift * SCALE;
  // No nameplate under the tip, so the tip stands at its full height.
  const show = (feetY) => {
    bubbles.update(anchors([['b2', speaker(160, feetY, { nameRow: Infinity })]]), projection);
    const node = boxes()[0];
    return { rows: node.rows.length, top: translate(node)[1] };
  };
  assert.equal(show(rise + (5 * LINE_H + 5) / CELL.h).rows, 6);
  let rows = 6;
  for (let frame = 0; frame < 40; frame++) {
    tick(50);
    const now = show(rise + 160 / CELL.h);
    assert.ok(now.top + LINE_H >= -0.5, `frame ${frame}: the first line is on the screen (${now.top})`);
    assert.ok(now.rows >= rows, 'rows only join as the box comes down');
    rows = now.rows;
  }
  assert.equal(rows, 11, 'all nine lines once it has landed');
});

test('a fading row that takes another channel\'s line keeps its own layer', () => {
  const { bubbles, boxes, tick } = setup({ reduced: true });
  bubbles.receive(line('first'), 'a1');
  bubbles.receive(line('second', { channel: 'yell' }), 'a1');
  tick(4800);
  bubbles.update(anchors([['b2', speaker()]]), projection);
  const rows = () => boxes()[0].children;
  const fading = () => rows().map((row) => row.classList.contains('bubble-fading'));
  assert.deepEqual(fading(), [true, true, true, true, true]);
  // The speaker steps up under the screen's top: only the newest line fits,
  // and the row that held the first line now holds the yell, as faded.
  const rise = BUBBLES.lift * SCALE;
  bubbles.update(anchors([['b2', speaker(160, rise + (3 * LINE_H + 5) / CELL.h)]]), projection);
  assert.equal(rows().length, 3);
  assert.equal(rows()[1].style.opacity, '0.5');
  assert.ok(rows()[1].classList.contains('bubble-yell'));
  assert.deepEqual(fading(), [true, true, true], 'the fade keeps its layer through the change');
  tick(100);
  bubbles.update(anchors([['b2', speaker(160, rise + (3 * LINE_H + 5) / CELL.h)]]), projection);
  assert.equal(rows()[1].style.opacity, '0.25');
  assert.deepEqual(fading(), [true, true, true]);
});

test('a new or expired line rewrites the rows in place instead of building them again', () => {
  const { doc, bubbles, boxes, tick } = setup({ reduced: true });
  let made = 0;
  const create = doc.createElement;
  doc.createElement = (tag) => { made++; return create(tag); };
  const where = anchors([['b2', speaker()]]);
  bubbles.receive(line('one'), 'a1');
  bubbles.update(where, projection);
  const first = [...boxes()[0].children];
  assert.deepEqual(boxes()[0].rows, ['.----------.', '| one      |', "'-----v----'"]);
  tick(1000);
  bubbles.receive(line('two', { channel: 'yell' }), 'a1');
  made = 0;
  bubbles.update(where, projection);
  const node = boxes()[0];
  assert.deepEqual(node.rows, ['.----------.', '| one      |', '|----------|', '| two      |', "'-----v----'"]);
  assert.equal(made, 8, 'two new rows of three spans');
  assert.deepEqual(node.children.slice(0, 3), first, 'the old rows are kept');
  const rule = node.children[2];
  assert.equal(rule.className, 'bubble-row bubble-frame');
  assert.deepEqual(rule.children.map((c) => c.className), ['bubble-frame', '', 'bubble-frame'], 'the tail became a rule');
  assert.equal(node.children[3].className, 'bubble-row bubble-yell');
  assert.equal(node.children[4].children[1].className, 'bubble-tail');
  // The first line goes: the rows shrink and the spares leave the box.
  const grown = [...node.children];
  tick(4000);
  made = 0;
  bubbles.update(where, projection);
  assert.deepEqual(node.rows, ['.----------.', '| two      |', "'-----v----'"]);
  assert.equal(made, 0);
  assert.equal(node.children.length, 3);
  assert.deepEqual(node.children, grown.slice(0, 3));
  assert.equal(grown[3].parentNode, null);
  assert.equal(grown[4].parentNode, null);
  assert.equal(node.children[1].className, 'bubble-row bubble-yell');
});
