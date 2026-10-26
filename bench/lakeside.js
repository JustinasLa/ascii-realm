// A lakeside night scene that every run draws the same: on seed 1, a
// mature cherry on the meadow just north of a pond that runs east into a
// lake, and the wanderer on the grass south of the pond, so the tree's
// shadow on the grass, the trunk and the water are all in one desktop view. Open the game with
// LAKESIDE_QUERY, then run placeAtLakeside in the page (see bench/night.cjs).
export const SEED = 1;
export const TREE = { x: -388.5, y: -511.5 };
export const PLAYER = { x: -345.5, y: -484.5 };
// The world's clock is held here, so every frame does the same work.
export const PINTIME = 20;
export const LAKESIDE_QUERY = `seed=${SEED}&debug&nogate&pintime=${PINTIME}`;

// Stands the wanderer at `at` with the camera on them, in the given weather,
// with no monster about, and holds the grid: the quality scaler and phone
// pacing would otherwise follow the machine's load. Self-contained, so it
// can be sent to a page as source: `(${placeAtLakeside})(game, at)`.
export function placeAtLakeside(game, at, { preset = 'clear', intensity = 0 } = {}) {
  const { player, camera, quality } = game;
  quality.sample = () => false;
  if (game.native?.pacer) game.native.pacer.sample = () => ({});
  player.x = at.x;
  player.y = at.y;
  camera.x = at.x;
  camera.y = at.y - 11;
  game.monsters?.clear();
  game.sound.weather.preset = preset;
  game.sound.weather.intensity = intensity;
}
