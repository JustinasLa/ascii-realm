import { valueNoise } from '../core/noise.js';
import { ASPECT, WATER, SHORE, GRASS, DIRT, STONE } from '../world/world.js';

const WATER_RADIUS = 40;
const WATER_SAMPLE_INTERVAL = 0.4;
const WATER_RESAMPLE_DISTANCE = 4;
const WATER_GRID_Y = 4;
const WATER_GRID_X = Math.round(WATER_GRID_Y / ASPECT);
const DAY_LENGTH = 240;

/** The same moving noise field used to sway the rendered grass. */
export function grassGust(world, x, y, time) {
  return valueNoise(
    x * ASPECT * 0.035 - time * 0.55,
    y * 0.035 + time * 0.12,
    world.seed + 900,
  );
}

/** A gentle day/night cycle, beginning in the game's moonlit setting. */
export function nightAmount(time) {
  if (!Number.isFinite(time)) return 1;
  return (1 + Math.cos((time / DAY_LENGTH) * Math.PI * 2)) / 2;
}

/** Classify a footstep without changing terrain or collision rules. */
export function surfaceAt(world, x, y) {
  x = Math.floor(x);
  y = Math.floor(y);
  switch (world.typeAt(x, y)) {
    case WATER: return 'water';
    case SHORE:
      // Walkable shore touching a lake is wave-washed, shallow sand.
      return world.typeAt(x - 1, y) === WATER
        || world.typeAt(x + 1, y) === WATER
        || world.typeAt(x, y - 1) === WATER
        || world.typeAt(x, y + 1) === WATER ? 'water' : 'sand';
    case DIRT: return 'dirt';
    case STONE: return 'rock';
    case GRASS:
    default: return 'grass';
  }
}

/** Spatial environmental signals; no browser or audio context is required. */
export class EnvironmentSampler {
  constructor(world) {
    this.world = world;
    this.waterSource = null;
    this.sampleX = Infinity;
    this.sampleY = Infinity;
    this.elapsed = WATER_SAMPLE_INTERVAL;
  }

  sampleWater(x, y) {
    let nearestSquared = WATER_RADIUS * WATER_RADIUS;
    let nearest = null;
    const consider = (cx, cy) => {
      const dy = cy + 0.5 - y;
      const dx = (cx + 0.5 - x) * ASPECT;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared >= nearestSquared) return;
      if (this.world.typeAt(cx, cy) !== WATER) return;
      nearestSquared = distanceSquared;
      nearest = { x: cx + 0.5, y: cy + 0.5 };
    };
    const cellX = Math.floor(x);
    const cellY = Math.floor(y);
    consider(cellX, cellY);
    if (this.waterSource) {
      consider(Math.floor(this.waterSource.x), Math.floor(this.waterSource.y));
    }
    // A coarse grid finds the game's broad lakes with fewer than 400
    // terrain reads on dry land. Refine locally to position the shoreline
    // source on an actual water cell, without scanning the whole disk.
    const xRadius = Math.floor(WATER_RADIUS / ASPECT / WATER_GRID_X) * WATER_GRID_X;
    for (let cy = cellY - WATER_RADIUS; cy <= cellY + WATER_RADIUS; cy += WATER_GRID_Y) {
      for (let cx = cellX - xRadius; cx <= cellX + xRadius; cx += WATER_GRID_X) {
        consider(cx, cy);
      }
    }
    if (nearest) {
      const sourceCellX = Math.floor(nearest.x);
      const sourceCellY = Math.floor(nearest.y);
      for (let cy = sourceCellY - WATER_GRID_Y; cy <= sourceCellY + WATER_GRID_Y; cy++) {
        for (let cx = sourceCellX - WATER_GRID_X; cx <= sourceCellX + WATER_GRID_X; cx++) {
          consider(cx, cy);
        }
      }
    }
    this.waterSource = nearest;
    this.sampleX = x;
    this.sampleY = y;
    this.elapsed = 0;
  }

  /** Water is { x, y, strength } or null; all signal levels lie in [0, 1]. */
  update(dt, x, y, time) {
    this.elapsed += Number.isFinite(dt) ? Math.max(0, dt) : 0;
    const movement = Math.hypot((x - this.sampleX) * ASPECT, y - this.sampleY);
    if (this.elapsed >= WATER_SAMPLE_INTERVAL || movement >= WATER_RESAMPLE_DISTANCE) {
      this.sampleWater(x, y);
    }
    let water = null;
    if (this.waterSource) {
      const { x: sourceX, y: sourceY } = this.waterSource;
      const distance = Math.hypot((sourceX - x) * ASPECT, sourceY - y);
      if (distance < WATER_RADIUS) {
        water = { x: sourceX, y: sourceY, strength: 1 - distance / WATER_RADIUS };
      }
    }
    return { gust: grassGust(this.world, x, y, time), night: nightAmount(time), water };
  }
}
