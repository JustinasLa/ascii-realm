import rain from './rain.js';
import heavyRain from './heavy-rain.js';
import thunderstorm from './thunderstorm.js';
import distantThunder from './distant-thunder.js';
import drizzle from './drizzle.js';
import hail from './hail.js';
import sleet from './sleet.js';
import lightSnow from './light-snow.js';
import snowstorm from './snowstorm.js';
import blizzard from './blizzard.js';
import windGusts from './wind-gusts.js';
import gale from './gale.js';
import sandstorm from './sandstorm.js';
import oceanStorm from './ocean-storm.js';
import fog from './fog.js';
import iceStorm from './ice-storm.js';
import forestSquall from './forest-squall.js';

export const WEATHER_PRESETS = Object.freeze([
  rain, drizzle, heavyRain, thunderstorm, distantThunder,
  hail, sleet, lightSnow, snowstorm, blizzard,
  windGusts, gale, sandstorm, oceanStorm, fog, iceStorm, forestSquall,
]);
