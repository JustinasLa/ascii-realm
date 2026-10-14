import { ASPECT } from '../world/world.js';

// Search at most this many row units from either local origin. Keeping the
// search finite matters when a test scene is entirely water or blocked props.
const SEARCH_RADIUS = 48;
const PLAYER_HALF_WIDTH = 1.2;

function validPoint(point) {
  // Leave enough integer precision for every cell in the search. At enormous
  // numeric coordinates, incrementing a column by one can otherwise stall.
  const limit = Number.MAX_SAFE_INTEGER - 128;
  return point && Number.isFinite(point.x) && Number.isFinite(point.y)
    && Math.abs(point.x) <= limit && Math.abs(point.y) <= limit;
}

function canStand(world, point) {
  return validPoint(point)
    && world.isWalkable(point.x, point.y)
    && world.isWalkable(point.x - PLAYER_HALF_WIDTH, point.y)
    && world.isWalkable(point.x + PLAYER_HALF_WIDTH, point.y);
}

function nearbyPosition(world, origin) {
  if (!validPoint(origin)) return null;
  const radiusSquared = SEARCH_RADIUS ** 2;
  const candidates = [];
  const minX = Math.ceil(origin.x - SEARCH_RADIUS / ASPECT - 0.5);
  const maxX = Math.floor(origin.x + SEARCH_RADIUS / ASPECT - 0.5);
  const minY = Math.ceil(origin.y - SEARCH_RADIUS - 0.5);
  const maxY = Math.floor(origin.y + SEARCH_RADIUS - 0.5);
  for (let cy = minY; cy <= maxY; cy++) {
    for (let cx = minX; cx <= maxX; cx++) {
      const x = cx + 0.5;
      const y = cy + 0.5;
      const distance = ((x - origin.x) * ASPECT) ** 2 + (y - origin.y) ** 2;
      if (distance <= radiusSquared) candidates.push({ x, y, distance });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance);
  for (const candidate of candidates) {
    if (canStand(world, candidate)) return { x: candidate.x, y: candidate.y };
  }
  return null;
}

// Terrain brushes and newly placed props can cover the warrior while editing.
// Find a playable position without removing scenery or changing game state.
// The footprint matches Player.tryMove, including its two lateral samples.
export function findPlayPosition(world, player, camera) {
  if (canStand(world, player)) return { x: player.x, y: player.y };
  const nearPlayer = nearbyPosition(world, player);
  if (nearPlayer) return nearPlayer;
  const nearCamera = nearbyPosition(world, camera);
  if (nearCamera) return nearCamera;
  if (canStand(world, world.spawn)) return { x: world.spawn.x, y: world.spawn.y };
  return null;
}
