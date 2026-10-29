// The number keys of an instrument in the off hand. While one is held, keys
// 1-8 (and the numpad's 1-8) play notes the moment they go down instead of
// doing anything else; Shift at the press plays the second layer. The
// listener runs in the capture phase and claims the key, so the game's
// input never sees it and no other shortcut fires on it. Keys 9 and 0, and
// every key while no instrument is held, are left alone.

/** The slot (1-8) a key plays, or null. */
export function noteSlot(event) {
  const match = /^(?:Digit|Numpad)([1-8])$/.exec(event?.code ?? '');
  return match ? Number(match[1]) : null;
}

export class InstrumentKeys {
  /**
   * `instrument()` is the held instrument's id or null, and null whenever the
   * keys must stay plain keys (a phone, gameplay blocked by a panel or
   * chat). `canPlay()` is the shared check for every way of playing; a
   * claimed key that fails it is swallowed. `isControl(target)` marks form
   * fields and panels, whose keys are their own.
   */
  constructor(target, { instrument, canPlay, isControl = () => false, onNote }) {
    this.target = target;
    this.instrument = instrument;
    this.canPlay = canPlay;
    this.isControl = isControl;
    this.onNote = onNote;
    this.listener = event => this.handle(event);
    target.addEventListener('keydown', this.listener, { capture: true });
  }

  /** Returns true when the key was claimed for the instrument. */
  handle(event) {
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return false;
    const slot = noteSlot(event);
    if (slot === null) return false;
    if (this.isControl(event.target) || event.composedPath?.().some(this.isControl)) return false;
    if (!this.instrument()) return false;
    event.preventDefault();
    event.stopPropagation();
    // Holding a key down never replays its note.
    if (!event.repeat && this.canPlay()) this.onNote(slot, Boolean(event.shiftKey));
    return true;
  }

  dispose() {
    this.target.removeEventListener('keydown', this.listener, { capture: true });
  }
}
