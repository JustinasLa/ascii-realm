import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url));
const manifest = JSON.parse(read('manifest.webmanifest'));
const html = read('index.html').toString();
const css = read('style.css').toString();

// A PNG's size is in its IHDR chunk, right after the signature.
function pngSize(bytes) {
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

test('the web-app manifest installs a standalone, dark game from wherever it is served', () => {
  assert.equal(manifest.name, 'ASCII Realm');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.theme_color, '#080c0d');
  assert.match(html, new RegExp(`<meta name="theme-color" content="${manifest.theme_color}"`));
  assert.match(html, /<link rel="manifest" href="manifest.webmanifest"/);
  assert.equal(manifest.background_color, '#05060a');
  assert.match(css, /html, body \{[^}]*background: #05060a/);
});

test('every icon exists at its declared size, one of them maskable, plus the home-screen icon', () => {
  for (const icon of manifest.icons) {
    assert.equal(icon.type, 'image/png');
    const bytes = read(icon.src);
    assert.equal(pngSize(bytes), icon.sizes, icon.src);
    assert.ok(bytes.length < 20_000, `${icon.src} is ${bytes.length} bytes`);
  }
  assert.equal(manifest.icons.filter(icon => icon.purpose === 'maskable').length, 1);
  const touchIcon = html.match(/<link rel="apple-touch-icon" href="([^"]+)"/)[1];
  assert.equal(pngSize(read(touchIcon)), '180x180');
});

test('the page never zooms, scrolls, bounces or selects text during play, but fields still do', () => {
  assert.match(html, /name="viewport" content="[^"]*maximum-scale=1, user-scalable=no/);
  assert.match(css, /html, body \{[^}]*overscroll-behavior: none/);
  const coarse = css.slice(css.indexOf('@media (pointer: coarse) {'));
  assert.match(coarse, /body \{ touch-action: manipulation; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; \}/);
  assert.match(coarse, /input, textarea, select, #lobby-share \{ user-select: text;/);
  assert.match(coarse, /#panel-dock, .inventory-screen \{ touch-action: pan-y; \}/);
  const phone = css.slice(css.indexOf('@media (pointer: coarse) and (hover: none) and (max-width: 600px)'));
  assert.match(phone, /body \{ touch-action: none; \}/);
});

test('the paper doll keeps one layout at every size, with the icon sized only by its box', () => {
  assert.doesNotMatch(css, /equipment-slots \{[^}]*repeat\(4, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(css, /inventory-portrait|equipment-slot-name|inventory-load/);
  assert.equal(css.match(/\.equipment-slot-icon \{/g).length, 1);
  assert.match(css, /\.equipment-slot-icon \{[^}]*font-size: min\(calc\(100cqw \/ 7\.2\), calc\(100cqh \/ 10\)\)/);
  const phone = css.slice(css.indexOf('@media (pointer: coarse) and (hover: none) and (max-width: 600px)'));
  assert.match(phone, /\.equipment-slots \{ grid-template-rows: repeat\(7, max\(44px,/);
  assert.match(phone, /\.equipment-slot::after \{ content: ""; position: absolute; inset: calc\(var\(--gap\) \/ -2\); \}/);
});

test('the bag is filter tabs over tall cards, with 44 px tabs on phones and no old slot rules', () => {
  assert.doesNotMatch(css, /\.inventory-slot/);
  assert.match(css, /\.inventory-screen \.bag-card \{[^}]*aspect-ratio: 1 \/ 2;[^}]*-webkit-touch-callout: none;/);
  assert.match(css, /\.bag-card-art \{[^}]*font-size: min\(calc\(100cqw \/ 7\.2\), calc\(100cqh \/ 10\)\)/);
  const phone = css.slice(css.indexOf('@media (pointer: coarse) and (hover: none) and (max-width: 600px)'));
  // The same selector as the desktop rule, declared later, so it wins.
  assert.match(css, /\.inventory-screen \.bag-filter \{ min-height: 22px;/);
  assert.match(phone, /\.inventory-screen \.bag-filter \{ min-height: 44px;/);
  assert.match(phone, /\.bag-cards \{ overflow-y: visible; min-height: 0; \}/);
});

test('the item tooltip keeps inside the screen, its lines scrolling over 44 px buttons', () => {
  assert.match(css, /\.item-tooltip \{[^}]*position: fixed;[^}]*max-height: calc\(100dvh - 2 \* var\(--tip-margin\)\);/);
  assert.match(css, /\.item-tooltip-body \{[^}]*overflow-y: auto;[^}]*overscroll-behavior: contain;/);
  assert.match(css, /\.item-tooltip-name \{[^}]*color: #7cc4ff;[^}]*font-weight: 700;/);
  assert.match(css, /\.item-tooltip-actions button \{[^}]*min-height: 44px;/);
  assert.match(css, /\.item-tooltip-actions:empty \{ display: none; \}/);
  assert.match(css, /\.inventory-screen :is\(\.bag-card, \.equipment-slot\) \{ touch-action: pan-y; -webkit-touch-callout: none;/);
});

test('a drag ghost sizes its art to itself, and the details pane is gone', () => {
  assert.match(css, /\.drag-ghost \{ container-type: size;[^}]*width: 56px; aspect-ratio: 1 \/ 2;[^}]*pointer-events: none; \}/);
  assert.match(css, /\.inventory-screen :is\(\.equipment-slot, \.inventory-bag\)\.drop-ok \{ border-color: var\(--accent\); \}/);
  assert.doesNotMatch(css, /\.inventory-(details|actions|item-|stats|weight|durability|description)/);
});

test('the play card and the Full screen row are in the page, hidden until needed', () => {
  assert.match(html, /<button type="button" id="play-gate" hidden aria-label="Tap to play">/);
  assert.match(html, /class="play-gate-action">TAP TO PLAY</);
  assert.match(html, /<button type="button" id="phone-menu-fullscreen" class="phone-sheet-row" hidden>Full screen<\/button>/);
  assert.match(css, /body.play-gated :is\(#touch-controls, .hud, #phone-menu\) \{ visibility: hidden; \}/);
});
