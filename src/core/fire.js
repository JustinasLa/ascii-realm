// Shared flicker keeps a fire's sound and light in phase.
export function firePulse(fire, time) {
  return (fire.intensity ?? 1) * (1 + (fire.flare ?? 0) * 0.35) * (0.87 + 0.06 * Math.sin(time * 10.7 + fire.seed)
    + 0.07 * Math.sin(time * 17.3 + fire.seed * 0.17));
}
