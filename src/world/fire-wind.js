// Weather preferences affect fires before sound unlock and independently of mute.
const WIND = {
  drizzle: 0.08, rain: 0.18, 'heavy-rain': 0.35, thunderstorm: 0.85,
  'distant-thunder': 0.16, hail: 0.35, sleet: 0.5, 'light-snow': 0.08,
  snowstorm: 0.55, blizzard: 1, 'wind-gusts': 0.5, gale: 1, sandstorm: 1,
  'ocean-storm': 1, 'ice-storm': 0.45, 'forest-squall': 0.9,
};

export function fireWeatherWind(settings, time) {
  const intensity = Number.isFinite(settings.intensity) ? Math.max(0, Math.min(1, settings.intensity)) : 0;
  const clock = Number.isFinite(time) ? time : 0;
  const gust = 0.7 + Math.sin(clock * 0.8) * 0.2 + Math.sin(clock * 2.1) * 0.1;
  return (WIND[settings.preset] ?? 0) * intensity * gust;
}
