import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PLAYER_COLORS as PROTOCOL_COLORS } from '../src/multiplayer/protocol.js';
import { FOG, FOG_PILED, FOG_THIN, NIGHT, VIGNETTE } from '../src/render/palette.js';
import { autoColour, BRIGHTEST_SCENE, contrast, deltaE2000, fromOklab, hexRgb, labDeltaE2000, luminance,
  memberColour, MIN_CONTRAST, MIN_DELTA_E, NAME_COLOURS, NAMEPLATE_BACKDROP, normalHex, OPEN_PANEL_SHADE,
  PANEL_SHADE, parseTint, PLAYER_COLORS, readableTint, resolveTints, rgbHex, SOLO_COLOR, SURFACES, tintFromAlias,
  toOklab, worstContrast } from '../src/multiplayer/tint.js';

const hue = ([, a, b]) => Math.atan2(b, a) * 180 / Math.PI;

test('the network takes a colour only as exactly #rrggbb, in either case', () => {
  for (const raw of ['#ff5555', '#FF5555', '#Ff5555']) assert.equal(parseTint(raw), '#ff5555', raw);
  for (const raw of ['ff5555', ' #ff5555 ', '\t#Ff5555\n', '#ff5555 ', ' #ff5555', 'fff', '#ff55', '#ff55551', '#gg0000',
    '', '#', '##ff5555', 'red', 'dark_aqua', '__proto__', null, undefined, 42, 0xff5555, {}, [], ['#ff5555'], true]) {
    assert.equal(parseTint(raw), null, JSON.stringify(raw) ?? String(raw));
  }
});

test('the page tidies a colour typed loosely before it is sent', () => {
  for (const raw of ['#FF5555', 'ff5555', ' #ff5555 ', '\t#Ff5555\n']) assert.equal(normalHex(raw), '#ff5555', raw);
  for (const raw of ['fff', '#ff55', '##ff5555', 'red', ' '.repeat(5) + '#ff5555' + ' '.repeat(5), null, 42]) {
    assert.equal(normalHex(raw), null, String(raw));
  }
  assert.equal(normalHex('#AbCdEf'), '#abcdef', 'normalHex only cleans; it never lightens');
  assert.equal(normalHex('#000000'), '#000000');
});

test('the page alone takes a named colour by its id', () => {
  assert.equal(tintFromAlias('dark_aqua'), '#00aaaa');
  assert.equal(tintFromAlias('gold'), '#ffaa00');
  assert.equal(tintFromAlias('dark_blue'), NAME_COLOURS[0].hex, 'lightened like the swatch');
  for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'black', 'Gold', '#ffaa00', '', null, 3]) {
    assert.equal(tintFromAlias(id), null, String(id));
  }
});

test('a colour too dark for any surface is lightened, keeping its hue, never refused', () => {
  assert.equal(parseTint('#000000'), '#8d8d8d', 'black reads as a mid grey');
  assert.equal(parseTint('#0000aa'), '#4a89ff');
  assert.equal(parseTint('#000010'), '#7c8daf');
  for (const vanilla of ['#aa0000', '#aa00aa', '#5555ff', '#0000aa', '#555555', '#123456', '#300000']) {
    const lifted = parseTint(vanilla);
    assert.notEqual(lifted, vanilla);
    assert.ok(worstContrast(hexRgb(lifted)) >= MIN_CONTRAST, vanilla);
    assert.equal(readableTint(lifted), lifted, `lightening ${vanilla} twice changes nothing`);
    assert.ok(toOklab(hexRgb(lifted))[0] > toOklab(hexRgb(vanilla))[0], 'only ever lighter');
    const [before, after] = [toOklab(hexRgb(vanilla)), toOklab(hexRgb(lifted))];
    if (Math.hypot(before[1], before[2]) > 0.02) assert.ok(Math.abs(hue(after) - hue(before)) < 4, `${vanilla} keeps its hue`);
  }
  assert.equal(readableTint('#ffaa00'), '#ffaa00', 'a colour that reads stays as it is');
});

test('every colour that can be chosen reads at 4.5:1 on every surface that shows a name', () => {
  for (let i = 0; i < 4096; i += 3) {
    const hex = rgbHex([i >> 8, (i >> 4) & 15, i & 15].map((v) => v * 17));
    const tint = parseTint(hex);
    for (const [surface, colour] of Object.entries(SURFACES)) {
      assert.ok(contrast(hexRgb(tint), colour) >= MIN_CONTRAST, `${hex} → ${tint} on ${surface}`);
    }
  }
  for (const colour of [...PLAYER_COLORS, SOLO_COLOR, ...NAME_COLOURS.map((c) => hexRgb(c.hex))]) {
    assert.ok(worstContrast(colour) >= MIN_CONTRAST, rgbHex(colour));
  }
});

test('the surfaces are the real ones: the nameplate\'s own backdrop and the panels over the brightest scene', () => {
  assert.deepEqual(NAMEPLATE_BACKDROP, [10, 9, 19], 'style.css .nameplate, over the scene (see nameplates.test.js)');
  assert.deepEqual(BRIGHTEST_SCENE, [255, 255, 255]);
  assert.deepEqual(PANEL_SHADE, [6, 9, 10, 0.88], 'style.css --surface');
  assert.deepEqual(OPEN_PANEL_SHADE, [6, 9, 10, 0.97], 'an open panel in style.css');
  assert.deepEqual(Object.keys(SURFACES), ['nameplate', 'chatLine', 'chatLog', 'partyFrame', 'playerList']);
  assert.deepEqual(SURFACES.chatLine.map(Math.round), [36, 39, 39]);
  assert.deepEqual(SURFACES.playerList.map(Math.round), [13, 16, 17]);
  assert.equal(luminance([255, 255, 255]), 1);
  assert.equal(luminance([0, 0, 0]), 0);
  assert.equal(contrast([255, 255, 255], [0, 0, 0]), 21);
  assert.equal(contrast([0, 0, 0], [255, 255, 255]), 21, 'either order');
});

test('names read on every panel over whatever the scene shows behind it, fog and dark edges included', () => {
  // A panel's shade over each colour the scene ends on: the night, the
  // darkened corners, the fog from thin to piled up, and pure white.
  const scenes = [NIGHT, VIGNETTE, FOG_THIN, FOG, FOG_PILED, [0, 0, 0], BRIGHTEST_SCENE];
  const over = ([r, g, b, alpha], under) => [r, g, b].map((c, i) => c * alpha + under[i] * (1 - alpha));
  const colours = [...PLAYER_COLORS, SOLO_COLOR, ...NAME_COLOURS.map((c) => hexRgb(c.hex)), hexRgb(parseTint('#000000'))];
  for (const colour of colours) {
    assert.ok(contrast(colour, NAMEPLATE_BACKDROP) >= MIN_CONTRAST, `${rgbHex(colour)} on a nameplate`);
    for (const shade of [PANEL_SHADE, OPEN_PANEL_SHADE]) {
      for (const scene of scenes) {
        assert.ok(contrast(colour, over(shade, scene)) >= MIN_CONTRAST, `${rgbHex(colour)} over ${scene}`);
      }
    }
  }
  assert.equal(parseTint('#000000'), '#8d8d8d');
});

test('the named colours come in the picker\'s order, without Black, each told apart', () => {
  assert.deepEqual(NAME_COLOURS.map((c) => c.label), ['Dark Blue', 'Dark Green', 'Dark Aqua', 'Dark Red', 'Dark Purple',
    'Gold', 'Gray', 'Dark Gray', 'Blue', 'Green', 'Aqua', 'Red', 'Light Purple', 'Yellow', 'White']);
  assert.deepEqual(Object.fromEntries(NAME_COLOURS.filter((c) => c.hex !== c.vanilla).map((c) => [c.id, c.hex])), {
    dark_blue: '#4a89ff', dark_red: '#f15949', dark_purple: '#df4edd', dark_gray: '#8d8d8d', blue: '#7580ff',
  }, 'the five shown lighter');
  assert.ok(Object.isFrozen(NAME_COLOURS) && Object.isFrozen(NAME_COLOURS[0]));
  for (let i = 0; i < NAME_COLOURS.length; i++) {
    for (let j = i + 1; j < NAME_COLOURS.length; j++) {
      assert.ok(deltaE2000(hexRgb(NAME_COLOURS[i].hex), hexRgb(NAME_COLOURS[j].hex)) > 3, `${NAME_COLOURS[i].id}/${NAME_COLOURS[j].id}`);
    }
  }
});

test('colour conversions round-trip and CIEDE2000 matches the published pairs', () => {
  assert.deepEqual(hexRgb('#ff5500'), [255, 85, 0]);
  assert.equal(rgbHex([255, 85, 0]), '#ff5500');
  for (const rgb of [[0, 0, 0], [255, 255, 255], [10, 9, 19], [255, 85, 85], [74, 137, 255]]) {
    assert.deepEqual(fromOklab(toOklab(rgb)), rgb);
  }
  assert.deepEqual(fromOklab([1.5, 0, 0]), [255, 255, 255], 'out of gamut clips');
  assert.deepEqual(fromOklab([-0.1, 0, 0]), [0, 0, 0]);
  // Sharma, Wu and Dalal (2005), table 1: pairs 1, 7, 13, 17 and 25.
  for (const [a, b, expected] of [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.4900, -0.0010], [50, -2.4900, 0.0011], 7.2195],
    [[50, 2.5, 0], [56, -27, -3], 31.9030],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
  ]) assert.ok(Math.abs(labDeltaE2000(a, b) - expected) < 1e-4, `${a} / ${b}`);
  assert.equal(deltaE2000([10, 20, 30], [10, 20, 30]), 0);
  assert.equal(labDeltaE2000([0, 0, 0], [50, 0, 0]) > 0, true, 'greys differ by lightness alone');
});

test('a member shows their chosen colour, else their lobby\'s automatic one', () => {
  assert.deepEqual(PROTOCOL_COLORS, PLAYER_COLORS, 'the protocol shares the automatic colours');
  assert.deepEqual(memberColour({ color: 2, tint: '#ff5555' }), [255, 85, 85]);
  assert.deepEqual(memberColour({ color: 2, tint: null }), PLAYER_COLORS[2]);
  assert.deepEqual(memberColour({ color: 10 }), PLAYER_COLORS[2], 'the slot wraps');
  assert.deepEqual(autoColour(9), PLAYER_COLORS[1]);
});

test('players may share a colour, but never a name and a look-alike colour', () => {
  const ash = (color, tint, name = 'Ash') => ({ name, color, tint });
  assert.deepEqual(resolveTints([ash(0, '#ff5555'), ash(1, '#ff5555', 'Bryn')]), ['#ff5555', '#ff5555'], 'different names');
  assert.deepEqual(resolveTints([ash(0, '#ff5555'), ash(1, '#55ffff')]), ['#ff5555', '#55ffff'], 'different colours');
  const [first, second] = resolveTints([ash(0, '#ff5555'), ash(1, '#ff5555', 'ASH')]);
  assert.equal(first, '#ff5555', 'the first keeps theirs');
  assert.equal(second, rgbHex(PLAYER_COLORS[0]), 'the second, in any case, shows the first automatic colour far enough away');
  // Close, not equal: Red and a slightly different red.
  assert.notEqual(resolveTints([ash(0, '#ff5555'), ash(1, '#ff5a58')])[1], '#ff5a58');
  // A custom colour equal to the earlier Ash's automatic colour.
  assert.deepEqual(resolveTints([ash(1, '#92c6eb'), ash(0, null)]), ['#92c6eb', null], 'the second Ash keeps Auto');
  const [, auto] = resolveTints([ash(0, '#92c6eb'), ash(1, null)]);
  assert.equal(auto, '#a9d4ae', 'an Auto that looks like the first Ash\'s choice moves on');
  const three = resolveTints([ash(0, '#ff5555'), ash(1, '#ff5555'), ash(2, '#ff5555')]);
  const shown = three.map((tint, i) => tint ? hexRgb(tint) : PLAYER_COLORS[i]);
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(deltaE2000(shown[i], shown[j]) >= MIN_DELTA_E);
  assert.deepEqual(resolveTints([ash(1, '#ff5555')]), ['#ff5555'], 'once the first Ash leaves, the second gets theirs back');
});

// Every pair of colours a crowd is shown in.
const apart = (colours) => colours.flatMap((a, i) => colours.slice(i + 1).map((b) => deltaE2000(a, b)));
const shownIn = (players, tints) => tints.map((tint, i) => tint ? hexRgb(tint) : memberColour(players[i]));

test('no two automatic colours look alike, so a lobby of one name on Auto keeps them all', () => {
  assert.equal(PLAYER_COLORS.length, 8);
  assert.ok(Math.min(...apart(PLAYER_COLORS)) >= MIN_DELTA_E, 'every pair at least ΔE 10 apart');
  const ashes = PLAYER_COLORS.map((_, color) => ({ name: 'Ash', color, tint: null }));
  assert.deepEqual(resolveTints(ashes), Array(8).fill(null));
  // In any join order.
  const reversed = [...ashes].reverse();
  assert.deepEqual(resolveTints(reversed), Array(8).fill(null));
});

test('eight of one name are told apart by colour, whatever they choose', () => {
  const crowds = [
    PLAYER_COLORS.map((_, color) => ({ name: 'Ash', color, tint: '#ff5555' })),
    PLAYER_COLORS.map((_, color) => ({ name: 'Ash', color, tint: rgbHex(PLAYER_COLORS[(color + 3) % 8]) })),
    PLAYER_COLORS.map((_, color) => ({ name: 'Ash', color, tint: color % 2 ? null : '#efcf97' })),
    PLAYER_COLORS.map((_, color) => ({ name: 'Ash', color, tint: NAME_COLOURS[color].hex })),
  ];
  for (const players of crowds) {
    assert.ok(Math.min(...apart(shownIn(players, resolveTints(players)))) >= MIN_DELTA_E, JSON.stringify(players));
  }
});

test('a crowd past every spare colour gets the one least like the rest, and its tag tells it apart', () => {
  // More same-named players than the lobby holds, each choosing a spare
  // colour: the automatic ones and the named ones.
  const spares = [...PLAYER_COLORS, ...NAME_COLOURS.map((c) => hexRgb(c.hex))];
  const players = [...spares.map((c, i) => ({ name: 'Ash', color: i % 8, tint: rgbHex(c) })), { name: 'Ash', color: 3, tint: null }];
  const shown = shownIn(players, resolveTints(players));
  const last = shown.at(-1);
  const nearest = (colour) => Math.min(...shown.slice(0, -1).map((other) => deltaE2000(colour, other)));
  assert.ok(nearest(last) < MIN_DELTA_E, 'no colour is far enough from them all');
  assert.ok(spares.some((c) => rgbHex(c) === rgbHex(last)), 'a spare colour');
  assert.equal(nearest(last), Math.max(...spares.map(nearest)), 'the one least like any of them');
  assert.notEqual(rgbHex(last), rgbHex(PLAYER_COLORS[3]), 'never its own look-alike colour');
});
