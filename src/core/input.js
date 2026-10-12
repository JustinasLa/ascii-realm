// Tracks which keys are held, by physical key code so WASD works on any layout.
const held = new Set();

window.addEventListener('keydown', (e) => {
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  held.add(e.code);
});
window.addEventListener('keyup', (e) => held.delete(e.code));
window.addEventListener('blur', () => held.clear());

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
