// Tracks which keys are held, by physical key code so WASD works on any layout.
const held = new Set();
// Keys pressed since the game last asked, so a quick tap is never missed.
const tapped = new Set();

window.addEventListener('keydown', (e) => {
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  if (!e.repeat) tapped.add(e.code);
  held.add(e.code);
});
window.addEventListener('keyup', (e) => held.delete(e.code));
window.addEventListener('blur', () => held.clear());

// True once for each press of any of the keys.
export function wasTapped(...codes) {
  let hit = false;
  for (const c of codes) hit = tapped.delete(c) || hit;
  return hit;
}

export function isDown(...codes) {
  return codes.some((c) => held.has(c));
}

// Returns the requested movement as a vector with components in -1..1.
export function moveAxis() {
  let x = 0;
  let y = 0;
  if (isDown('KeyA', 'ArrowLeft')) x -= 1;
  if (isDown('KeyD', 'ArrowRight')) x += 1;
  if (isDown('KeyW', 'ArrowUp')) y -= 1;
  if (isDown('KeyS', 'ArrowDown')) y += 1;
  return { x, y };
}
