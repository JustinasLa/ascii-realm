// Automatic audio seasons follow the world's season (see world/seasons.js).
// Without a world they follow simulation time, with four day/night cycles
// per season, and pausing the game also pauses the year. A manual season is
// stored by Music.
export const SEASON_LENGTH = 240 * 4;
export const SEASONS = Object.freeze(['spring', 'summer', 'autumn', 'winter']);
export const SEASON_OPTIONS = Object.freeze([
  Object.freeze({ id: 'auto', label: 'Automatic seasons' }),
  ...SEASONS.map(id => Object.freeze({ id, label: id[0].toUpperCase() + id.slice(1) })),
]);

export function seasonAt(time = 0) {
  const index = Math.floor((Number.isFinite(time) ? Math.max(0, time) : 0) / SEASON_LENGTH);
  return SEASONS[index % SEASONS.length];
}

const weatherGroups = new Map([
  ...['rain', 'drizzle', 'heavy-rain'].map(id => [id, 'rain']),
  ...['thunderstorm', 'distant-thunder', 'hail', 'ocean-storm', 'forest-squall'].map(id => [id, 'storm']),
  ...['sleet', 'light-snow', 'snowstorm', 'blizzard', 'ice-storm'].map(id => [id, 'snow']),
  ...['wind-gusts', 'gale', 'sandstorm'].map(id => [id, 'wind']),
  ['fog', 'fog'],
]);

export function weatherMood(preset = 'clear', intensity = 0.6) {
  return Number.isFinite(intensity) && intensity > 0 ? weatherGroups.get(preset) ?? 'clear' : 'clear';
}

const wildlife = Object.freeze({
  spring: { birds: 1, insects: 0.7, frogs: 1, leaves: 0.85, water: 1 },
  summer: { birds: 0.8, insects: 1, frogs: 0.8, leaves: 1, water: 1 },
  autumn: { birds: 0.5, insects: 0.25, frogs: 0.35, leaves: 1.65, water: 0.9 },
  winter: { birds: 0.2, insects: 0, frogs: 0, leaves: 0.3, water: 0.65 },
});

export function climateAmbience(season = 'spring', preset = 'clear', intensity = 0.6) {
  const base = wildlife[season] ?? wildlife.spring;
  const mood = weatherMood(preset, intensity);
  const shelter = mood === 'storm' || mood === 'snow' ? 1 - Math.min(1, intensity) * 0.85
    : mood === 'rain' || mood === 'wind' ? 1 - Math.min(1, intensity) * 0.4 : 1;
  return { ...base, birds: base.birds * shelter, insects: base.insects * shelter,
    frogs: base.frogs * shelter, shelter };
}
