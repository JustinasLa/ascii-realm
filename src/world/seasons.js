import { hash2 } from '../core/rng.js';

// The world's seasons follow one another with the clock's day (see
// clock.js): SEASON_DAYS days each, summer from day 0. Nothing about them is
// stored, so a saved day, a lobby's shared day and a debug jump all give
// their season. A season begins at sunrise, when the day count moves on;
// through the night before it, each tree turns at its own moment.
//
// Changing these constants moves every saved world and every lobby to
// another season, so change them on purpose.

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
export const SEASON_DAYS = 28;
export const START_SEASON = 'summer';
// The limits of ?seasondays=.
const LONGEST = 112;
// A season's last night, in ticks: from sunset to the next sunrise.
const SUNSET = 12000;
const NIGHT = 12000;

// The page's own seasons: ?season=<name> pins one (it never rolls), and
// ?seasondays=<n> sets their length. A lobby shares the realm's instead
// (see Seasons), so these are only the solo plan.
export function seasonOptions(params) {
  const days = Math.floor(Number(params.get('seasondays')));
  const pinned = params.get('season');
  return { length: days >= 1 ? Math.min(LONGEST, days) : SEASON_DAYS,
    pinned: SEASONS.includes(pinned) ? pinned : null };
}

export const seasonIndexAt = (day, length = SEASON_DAYS) =>
  (SEASONS.indexOf(START_SEASON) + Math.floor(day / length)) % SEASONS.length;

export const seasonAt = (day, { length = SEASON_DAYS, pinned = null } = {}) =>
  pinned ?? SEASONS[seasonIndexAt(day, length)];

// The day of the season, 1 to its length.
export const dayOfSeason = (day, length = SEASON_DAYS) => day % length + 1;

export const nextSeason = (name) => SEASONS[(SEASONS.indexOf(name) + 1) % SEASONS.length];

// A tree's own moment in its season's last night, as a share of the night,
// seeded by its sprite seed, which is the same in every season. None turns
// as the sun sets or waits for it to rise.
export const turnPoint = (prop) => 0.05 + 0.9 * hash2(prop.textureSeed, 0, 7331);

// The season a tree shows at a moment: the day's, or on a season's last
// night, once its turning point has passed, the next one.
export function treeSeasonAt(prop, day, tick, plan = {}) {
  const name = seasonAt(day, plan);
  const length = plan.length ?? SEASON_DAYS;
  if (plan.pinned || tick < SUNSET || dayOfSeason(day, length) !== length) return name;
  return (tick - SUNSET) / NIGHT >= turnPoint(prop) ? nextSeason(name) : name;
}
