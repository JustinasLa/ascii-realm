import { input } from './input.js';

export function installTouchControls(zoomBy) {
  const root = document.getElementById('touch-controls');
  const pad = document.getElementById('move-pad');
  const stick = document.getElementById('move-stick');
  let pointer = null;
  let centerX = 0;
  let centerY = 0;
  let radius = 1;

  function resetStick() {
    pointer = null;
    input.setMove(0, 0);
    stick.style.transform = 'translate(0px, 0px)';
    pad.classList.remove('running');
  }

  function move(e) {
    if (e.pointerId !== pointer) return;
    const dx = (e.clientX - centerX) / radius;
    const dy = (e.clientY - centerY) / radius;
    const distance = Math.hypot(dx, dy);
    const scale = Math.max(1, distance);
    const x = dx / scale;
    const y = dy / scale;
    const running = distance > 0.82;
    input.setMove(distance < 0.16 ? 0 : x, distance < 0.16 ? 0 : y, running);
    stick.style.transform = `translate(${x * radius}px, ${y * radius}px)`;
    pad.classList.toggle('running', running);
  }

  pad.addEventListener('pointerdown', (e) => {
    if (pointer !== null || e.button !== 0) return;
    e.preventDefault();
    pointer = e.pointerId;
    const rect = pad.getBoundingClientRect();
    centerX = rect.left + rect.width / 2;
    centerY = rect.top + rect.height / 2;
    radius = rect.width * 0.34;
    pad.setPointerCapture(pointer);
    move(e);
  });
  pad.addEventListener('pointermove', move);
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    pad.addEventListener(type, (e) => { if (e.pointerId === pointer) resetStick(); });
  }

  for (const button of root.querySelectorAll('[data-key]')) {
    const pointers = new Set();
    const release = (e) => {
      pointers.delete(e.pointerId);
      input.releasePointer(e.pointerId);
      button.classList.toggle('pressed', pointers.size > 0);
    };
    button.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      pointers.add(e.pointerId);
      input.pressPointer(e.pointerId, button.dataset.key);
      button.classList.add('pressed');
      button.setPointerCapture(e.pointerId);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, release);
    button.addEventListener('click', (e) => { if (e.detail === 0) input.tapped.add(button.dataset.key); });
    const clear = () => { pointers.clear(); button.classList.remove('pressed'); };
    window.addEventListener('blur', clear);
    window.addEventListener('resize', clear);
    document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });
  }
  for (const button of root.querySelectorAll('[data-zoom]')) {
    button.addEventListener('click', () => zoomBy(Number(button.dataset.zoom)));
  }
  const reset = () => { resetStick(); input.clear(); };
  window.addEventListener('blur', reset);
  window.addEventListener('resize', reset);
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });
  root.addEventListener('contextmenu', (e) => e.preventDefault());
}
