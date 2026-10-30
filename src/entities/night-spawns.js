import { WEATHER_EFFECTS } from '../world/weather.js';
import { ASPECT } from '../world/world.js';
import { SCALE, TILT } from './rig.js';

// When night creatures may come. They keep to the night's own hours, then
// to the dark: the darker the open sky, the likelier a timed spawn goes
// ahead, and a fuller moon brings a few more. No spawn lands where a fire
// or a thrown torch lights the ground. Creatures that aren't night ones
// come at any hour.

// The night's own hours: night creatures come only between these ticks.
export const NIGHT_HOURS = [13000, 23000];
// How bright a fire and a torch in flight are where they stand, losing a
// level a metre (counted along the ground's two axes).
export const FIRE_LIGHT = 15;
export const TORCH_LIGHT = 14;
// Rain and thunder darken the sky by up to this share each.
const STORM_DARK = 5 / 16;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const profileOf = (weather) => (weather ? WEATHER_EFFECTS[weather.preset] ?? {} : {});
const WET = new Set(['rain', 'hail', 'sleet', 'snow']);

// How hard it is raining (or hailing, sleeting or snowing), 0..1.
export function rainOf(weather) {
  return WET.has(profileOf(weather).kind) ? weather.intensity ?? 0 : 0;
}

// How hard it is thundering: only a storm that rains has thunder overhead.
export function thunderOf(weather) {
  return profileOf(weather).lightning ? rainOf(weather) : 0;
}

// How many of the sky's 15 levels of light the hour and the weather take
// away: none on a clear day, 11 at night.
export function skyDarken(daylight, rain, thunder) {
  return Math.floor((1 - daylight * (1 - rain * STORM_DARK) * (1 - thunder * STORM_DARK)) * 11);
}

// The sky's light on open ground, 0..15.
export function skyLight(sky, weather) {
  return 15 - skyDarken(sky.daylight, rainOf(weather), thunderOf(weather));
}

// The chance that ground lit this brightly is dark enough: its light must
// be no more than a random level from 0 to 7.
export function darkChance(light) {
  return clamp01((8 - light) / 8);
}

// A clear night's open ground, the rate the spawn timers were set for.
const NIGHT_CHANCE = darkChance(4);

// The chance a kind's timed spawn goes ahead: 1 for one that isn't a night
// creature, 0 outside the night's hours, exactly 1 on a clear night under
// a full moon, and 0.8 of that under a new moon.
export function spawnChance(kind, sky, weather) {
  if (!kind.night) return 1;
  if (sky.tick < NIGHT_HOURS[0] || sky.tick >= NIGHT_HOURS[1]) return 0;
  return darkChance(skyLight(sky, weather)) / NIGHT_CHANCE * (1 + 0.25 * sky.moonBrightness) / 1.25;
}

// Every light that keeps night creatures away, as { x, y, level }: each
// fire (a campfire, a wildfire or one a torch lit) and each torch still in
// flight. A torch that lands leaves the list, its light carried on by any
// fire it starts.
export function lightSources(fires = [], thrown = []) {
  const out = [];
  for (const f of fires) out.push({ x: f.x, y: f.y, level: FIRE_LIGHT });
  for (const t of thrown) out.push({ x: t.x, y: t.y, level: TORCH_LIGHT });
  return out;
}

// How much light those sources give at world cell (x, y): the brightest,
// less a level for every metre to it.
export function lightLevel(x, y, sources) {
  let best = 0;
  for (const s of sources) {
    const metres = Math.abs(x - s.x) * ASPECT / SCALE + Math.abs(y - s.y) / (SCALE * TILT);
    best = Math.max(best, Math.floor(s.level - metres + 1e-9));
  }
  return best;
}
