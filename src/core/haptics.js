// Short vibrations on touch devices: one when a blow lands and a longer one
// when the outlaw is hurt. They are rate-limited so a spin through a crowd
// or a swarm of arrows never buzzes on and on, and silent wherever the
// browser has no `navigator.vibrate` or refuses it.
export const HIT_MS = 12;
export const HURT_MS = 30;
export const MIN_GAP_MS = 90;

export function createHaptics({ nav = globalThis.navigator, enabled = () => true, now = () => performance.now() } = {}) {
  let last = -Infinity;
  let lastKind = null;
  const pulse = (kind, ms) => {
    if (!enabled() || typeof nav?.vibrate !== 'function') return false;
    const at = now();
    // Inside the gap only a hurt may cut a hit short.
    if (at - last < MIN_GAP_MS && !(kind === 'hurt' && lastKind === 'hit')) return false;
    last = at;
    lastKind = kind;
    try { return nav.vibrate(ms) !== false; } catch { return false; }
  };
  return { hit: () => pulse('hit', HIT_MS), hurt: () => pulse('hurt', HURT_MS) };
}
