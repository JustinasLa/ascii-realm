// World-space metres: x is right, y is up and z is towards the camera.
// Return the shortest flight at the requested speed. A target outside the
// ballistic envelope gets only the speed increase needed to reach it.
export function solveBallisticShot(origin, target, speed, gravity) {
  if (!Array.isArray(origin) || !Array.isArray(target) || origin.length !== 3 || target.length !== 3 ||
    ![...origin, ...target, speed, gravity].every(Number.isFinite) || speed <= 0 || gravity < 0) return null;

  const delta = target.map((value, i) => value - origin[i]);
  if (!delta.every(Number.isFinite)) return null;
  const [dx, dy, dz] = delta;
  const horizontal = Math.hypot(dx, dz);
  const distance = Math.hypot(horizontal, dy);
  if (!Number.isFinite(distance)) return null;
  // At the origin, the downward limit is defined even though no flight is
  // required. This keeps a cursor exactly under the arrow finite as well.
  if (distance === 0) {
    return { velocity: [0, -speed, 0], direction: [0, -1, 0], duration: 0, distance, speed };
  }
  if (gravity === 0) {
    const duration = distance / speed;
    const direction = delta.map((value) => value / distance);
    const velocity = direction.map((value) => value * speed);
    if (!Number.isFinite(duration) || !velocity.every(Number.isFinite)) return null;
    return { velocity, direction, duration, distance, speed };
  }

  // The minimum speed squared is g * (distance + dy). Rationalize that
  // sum for targets below us, where nearly vertical shots would otherwise
  // lose their small horizontal component to subtractive cancellation.
  const envelope = dy < 0 ? horizontal * (horizontal / (distance - dy)) : distance + dy;
  const required = Math.sqrt(gravity) * Math.sqrt(envelope);
  const launchSpeed = Math.max(speed, required);
  if (!Number.isFinite(launchSpeed)) return null;

  // Solving for t² rather than the launch angle handles vertical targets.
  // The rationalized low root avoids subtracting nearly equal numbers;
  // dividing by speed first also avoids squaring very large velocities.
  const a = 1 - (gravity / launchSpeed) * (dy / launchSpeed);
  const b = (gravity / launchSpeed) * (distance / launchSpeed);
  const root = Math.sqrt(Math.max(0, a - b)) * Math.sqrt(Math.max(0, a + b));
  const duration = Math.SQRT2 * (distance / launchSpeed) / Math.sqrt(a + root);
  const velocity = [dx / duration, dy / duration + gravity * duration / 2, dz / duration];
  const magnitude = Math.hypot(...velocity);
  if (!(duration > 0) || !Number.isFinite(duration) || !velocity.every(Number.isFinite) ||
    !Number.isFinite(magnitude) || magnitude === 0) return null;
  return {
    velocity,
    direction: velocity.map((value) => value / magnitude),
    duration, distance, speed: launchSpeed,
  };
}
