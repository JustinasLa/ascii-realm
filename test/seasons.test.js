import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WorldClock, realmDay } from '../src/world/clock.js';
import { SEASON_DAYS, SEASONS, dayOfSeason, nextSeason, seasonAt, seasonIndexAt, seasonOptions, treeSeasonAt,
  turnPoint } from '../src/world/seasons.js';

const tree = (textureSeed) => ({ textureSeed });
const params = (query) => new URLSearchParams(query);

test('seasons follow one another every 28 days from summer on day 0', () => {
  assert.equal(SEASON_DAYS, 28);
  const days = [0, 27, 28, 55, 56, 83, 84, 111, 112];
  assert.deepEqual(days.map((day) => seasonAt(day)),
    ['summer', 'summer', 'autumn', 'autumn', 'winter', 'winter', 'spring', 'spring', 'summer']);
  assert.deepEqual([0, 1, 27, 28, 29].map((day) => dayOfSeason(day)), [1, 2, 28, 1, 2]);
  assert.equal(seasonIndexAt(28), SEASONS.indexOf('autumn'));
  assert.equal(seasonAt(3, { length: 3 }), 'autumn');
  assert.equal(seasonAt(3, { length: 3, pinned: 'spring' }), 'spring', 'a pin wins');
  assert.equal(nextSeason('winter'), 'spring');
  assert.equal(nextSeason('summer'), 'autumn');
});

test('the URL can pin a season or shorten them, and junk is ignored', () => {
  assert.deepEqual(seasonOptions(params('')), { length: 28, pinned: null });
  assert.deepEqual(seasonOptions(params('season=winter&seasondays=3')), { length: 3, pinned: 'winter' });
  assert.deepEqual(seasonOptions(params('season=monsoon&seasondays=junk')), { length: 28, pinned: null });
  assert.equal(seasonOptions(params('seasondays=0')).length, 28);
  assert.equal(seasonOptions(params('seasondays=-4')).length, 28);
  assert.equal(seasonOptions(params('seasondays=2.7')).length, 2);
  assert.equal(seasonOptions(params('seasondays=999')).length, 112);
});

test('each tree turns once, at its own moment of the season\'s last night', () => {
  const trees = Array.from({ length: 500 }, (_, i) => tree(i * 7919 + 13));
  const bins = new Array(10).fill(0);
  for (const t of trees) {
    const point = turnPoint(t);
    assert.ok(point >= 0.05 && point <= 0.95);
    bins[Math.min(9, Math.floor(point * 10))]++;
    assert.equal(treeSeasonAt(t, 26, 20000), 'summer', 'not the night before the last');
    assert.equal(treeSeasonAt(t, 27, 11999), 'summer', 'not before sunset');
    assert.equal(treeSeasonAt(t, 27, 23999), 'autumn', 'every tree by sunrise');
    assert.equal(treeSeasonAt(t, 28, 0), 'autumn');
    let turned = false;
    for (let tick = 12000; tick < 24000; tick += 50) {
      const now = treeSeasonAt(t, 27, tick) === 'autumn';
      assert.ok(now || !turned, 'never back');
      turned = now;
    }
    assert.equal(treeSeasonAt(t, 27, 23999, { pinned: 'summer' }), 'summer', 'a pinned season never turns');
    assert.equal(treeSeasonAt(t, 2, 23999, { length: 3 }), 'autumn');
  }
  assert.ok(Math.max(...bins) <= 100, `spread over the night: ${bins}`);
  assert.equal(turnPoint({ textureSeed: 5, season: 'winter' }), turnPoint({ textureSeed: 5, season: 'summer' }));
});

test('every clock in a realm agrees on the season, and a restored day gives its own', () => {
  const now = Date.UTC(2026, 9, 30, 4, 12);
  const a = new WorldClock();
  const b = new WorldClock({ start: 3000 });
  a.share(now);
  b.share(now);
  assert.equal(realmDay(now), a.day);
  assert.equal(seasonAt(a.day), seasonAt(b.day));
  const t = tree(99);
  assert.equal(treeSeasonAt(t, a.day, a.tick), treeSeasonAt(t, b.day, b.tick));
  const restored = new WorldClock();
  restored.days = 30;
  assert.equal(seasonAt(restored.day), 'autumn');
});
