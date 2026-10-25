// The phone's "Tap to play" card. It is up at load and again whenever the
// page comes back from being hidden, and the world waits behind it. Its tap
// is the gesture the browser needs before it allows sound and full screen,
// so `onStart` runs inside the click itself, before anything asynchronous.

const LABELS = {
  start: { action: 'TAP TO PLAY', aria: 'Tap to play' },
  resume: { action: 'TAP TO RESUME', aria: 'Tap to resume' },
};

export class PlayGate {
  constructor({ button, doc, onStart = () => {}, onShow = () => {} }) {
    Object.assign(this, { button, doc, onStart, onShow });
    this.kind = null;
    this.action = button.querySelector('.play-gate-action');
    button.addEventListener('click', () => this.start());
  }

  get waiting() { return this.kind !== null; }

  // A card already up keeps its label: a start that was never tapped is
  // still a start.
  show(kind = 'start') {
    if (this.waiting) return;
    this.kind = Object.hasOwn(LABELS, kind) ? kind : 'start';
    const label = LABELS[this.kind];
    if (this.action) this.action.textContent = label.action;
    this.button.setAttribute('aria-label', label.aria);
    this.button.hidden = false;
    this.doc.body.classList.add('play-gated');
    this.button.focus?.({ preventScroll: true });
    this.onShow(this.kind);
  }

  start() {
    if (!this.waiting) return;
    const kind = this.kind;
    this.kind = null;
    this.button.hidden = true;
    this.doc.body.classList.remove('play-gated');
    this.onStart(kind);
  }
}
