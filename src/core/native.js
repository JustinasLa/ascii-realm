// What makes the game feel like an app on a phone rather than a web page:
// no browser zoom over the scene, full screen where the browser offers it,
// and the screen kept awake while playing. Every call is feature-checked and
// none can block play; a refusal only leaves the browser's own behaviour.

const EDITABLE = 'input, textarea, select, [contenteditable]';

// WebKit pinches the page with its own gesture events, which ignore the
// viewport's user-scalable=no; cancelling them leaves pinching to the game's
// camera zoom (pinch.js works on pointer events). A double tap or double
// click outside a text field never zooms the page either.
export function blockPageGestures(doc) {
  const cancel = event => event.preventDefault();
  const doubleTap = (event) => {
    if (!event.target?.closest?.(EDITABLE)) event.preventDefault();
  };
  const listeners = [['gesturestart', cancel], ['gesturechange', cancel], ['gestureend', cancel], ['dblclick', doubleTap]];
  for (const [type, listener] of listeners) doc.addEventListener(type, listener, { passive: false });
  return () => {
    for (const [type, listener] of listeners) doc.removeEventListener(type, listener, { passive: false });
  };
}

// Launched from the home screen, the game already fills the screen. (The
// display-mode "fullscreen" query is not asked: it also matches while the
// page is merely in element full screen, where the menu must still offer
// to leave it.)
export function isStandalone(win) {
  return Boolean(win.matchMedia?.('(display-mode: standalone)')?.matches || win.navigator?.standalone === true);
}

// The Fullscreen API, prefixed or not, or null where there is none (iPhone
// Safari, where installing to the home screen is the way to full screen).
export function fullscreenApi(doc) {
  const root = doc.documentElement;
  const request = root?.requestFullscreen ? 'requestFullscreen' : root?.webkitRequestFullscreen ? 'webkitRequestFullscreen' : null;
  if (!request) return null;
  const exit = doc.exitFullscreen ? 'exitFullscreen' : 'webkitExitFullscreen';
  return {
    request: async (el = root, options) => el[request](options),
    exit: async () => doc[exit]?.(),
    get active() { return Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement); },
  };
}

// Asks for full screen inside a tap (the browser requires one), and reports
// whether the page is now full screen. A refusal is not an error.
export async function enterFullscreen(doc, el) {
  const api = fullscreenApi(doc);
  if (!api) return false;
  if (api.active) return true;
  try {
    await api.request(el, { navigationUI: 'hide' });
  } catch {
    return false;
  }
  return api.active;
}

// The menu's Full screen row: leaves full screen, or enters it.
export async function toggleFullscreen(doc) {
  const api = fullscreenApi(doc);
  if (!api) return false;
  try {
    if (api.active) await api.exit();
    else await api.request(doc.documentElement, { navigationUI: 'hide' });
  } catch {
    // The browser keeps whatever state it chose.
  }
  return api.active;
}

function release(sentinel) {
  try {
    Promise.resolve(sentinel.release()).catch(() => {});
  } catch {
    // Already released.
  }
}

// Holds the Screen Wake Lock while the game wants it and the page is
// visible. The browser drops the lock whenever the page is hidden, so it is
// asked for again on return. A request that resolves after the wish changed
// is released at once. A refused request (some browsers want a tap, or the
// battery is low) is retried on the next tap, not on every frame's wish.
export class WakeLock {
  constructor({ nav, doc }) {
    this.nav = nav;
    this.doc = doc;
    this.supported = Boolean(nav?.wakeLock?.request);
    this.wanted = false;
    this.sentinel = null;
    this.pending = false;
    this.retryOnGesture = false;
    this.visibility = () => this.sync();
    if (this.supported) doc.addEventListener('visibilitychange', this.visibility);
  }

  get held() { return this.sentinel !== null; }

  get allowed() { return this.wanted && this.doc.visibilityState === 'visible'; }

  want(on) {
    this.wanted = Boolean(on);
    this.sync();
  }

  sync() {
    if (!this.supported) return;
    if (!this.allowed) {
      const held = this.sentinel;
      this.sentinel = null;
      if (held) release(held);
      return;
    }
    if (this.sentinel || this.pending || this.retryOnGesture) return;
    this.pending = true;
    let request;
    try {
      request = Promise.resolve(this.nav.wakeLock.request('screen'));
    } catch (error) {
      request = Promise.reject(error);
    }
    request.then((sentinel) => {
      this.pending = false;
      if (!this.allowed) {
        release(sentinel);
        return;
      }
      this.sentinel = sentinel;
      this.retryOnGesture = false;
      sentinel.addEventListener?.('release', () => {
        if (this.sentinel === sentinel) this.sentinel = null;
      });
    }, () => {
      this.pending = false;
      this.retryOnGesture = true;
    });
  }

  // Called on every tap: retries a refused request.
  gesture() {
    if (!this.retryOnGesture) return;
    this.retryOnGesture = false;
    this.sync();
  }

  dispose() {
    this.want(false);
    if (this.supported) this.doc.removeEventListener('visibilitychange', this.visibility);
  }
}
