// Locomotion clips are aligned so the left heel touches at cycle 0 and
// the right at 0.5. Count crossings before wrapping the shared phase.
export function footPlants(before, after) {
  if (!Number.isFinite(before) || !Number.isFinite(after) || after <= before) return [];
  const plants = [];
  for (let half = Math.floor(before * 2) + 1; half <= Math.floor(after * 2); half++) {
    plants.push(half % 2 === 0 ? 0 : 1);
  }
  return plants;
}
