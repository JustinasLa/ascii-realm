// One definition of "phone" drives the stripped-down touch layout: a coarse
// primary pointer with no hover, and a short side of 600 CSS px or less.
// Tablets, touchscreen laptops and narrow desktop windows never match.
// style.css carries the same query; a test keeps the two strings identical.
// The comma list means OR and is understood by older Safari too.
export const PHONE_QUERY = '(pointer: coarse) and (hover: none) and (max-width: 600px), '
  + '(pointer: coarse) and (hover: none) and (max-height: 600px)';

export const PHONE_SHORT_SIDE = 600;

export function isPhone({ coarse, hover, width, height }) {
  return Boolean(coarse) && !hover && Math.min(width, height) <= PHONE_SHORT_SIDE;
}

// Follows the media query and reports flips, for example when a phone gains a
// mouse or a stylus with hover. CSS does not depend on the `is-phone` class;
// it only gives script-built nodes and checks a hook.
export function watchPhone(win, onChange = () => {}) {
  const query = win.matchMedia?.(PHONE_QUERY) ?? null;
  let phone = Boolean(query?.matches);
  const root = win.document?.documentElement;
  const mark = () => root?.classList?.toggle('is-phone', phone);
  mark();
  const changed = (event) => {
    const next = Boolean(event?.matches ?? query.matches);
    if (next === phone) return;
    phone = next;
    mark();
    onChange(phone);
  };
  query?.addEventListener?.('change', changed);
  return {
    get phone() { return phone; },
    dispose() { query?.removeEventListener?.('change', changed); },
  };
}
