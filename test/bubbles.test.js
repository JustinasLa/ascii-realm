import assert from 'node:assert/strict';
import { test } from 'node:test';
import { drawNameTag } from '../src/entities/figure.js';
import { SCALE } from '../src/entities/rig.js';
import { MAX_CHAT_LENGTH } from '../src/multiplayer/chat.js';
import { anchorRow, bobRows, bottomRule, BUBBLES, bubbleRows, figureTop, followShare, SpeechBubbles,
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

function setup({ reduced = false, measure, dpr = 1 } = {}) {
  const doc = { createElement: (tag) => new El(tag) };
  const root = new El('div');
  root.rect = { left: 0, top: 0, width: 1280, height: 720 };
  let time = 1000;
  const bubbles = new SpeechBubbles({ doc, root, now: () => time, reducedMotion: () => reduced, pixelRatio: () => dpr,
    measure: measure === undefined ? (() => ({ charW: CHAR_W, lineH: LINE_H, boldKeepsWidth: true })) : measure });
  const boxes = () => root.children;
  return { doc, root, bubbles, boxes, tick: (ms) => { time += ms; }, at: () => time };
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
