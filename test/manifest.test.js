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

test('the play card and the Full screen row are in the page, hidden until needed', () => {
  assert.match(html, /<button type="button" id="play-gate" hidden aria-label="Tap to play">/);
  assert.match(html, /class="play-gate-action">TAP TO PLAY</);
  assert.match(html, /<button type="button" id="phone-menu-fullscreen" class="phone-sheet-row" hidden>Full screen<\/button>/);
  assert.match(css, /body.play-gated :is\(#touch-controls, .hud, #phone-menu\) \{ visibility: hidden; \}/);
});
