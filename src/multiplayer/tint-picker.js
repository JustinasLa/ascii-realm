// The "Name colour" group in the Multiplayer panel: Auto, the named colours
// and a custom one, each shown as letters in that colour on the dark, the
// way a name is seen. The choice is kept in this browser and sent to the
// lobby. Everything is built from elements and text, never markup.
import { hexRgb, NAME_COLOURS, normalHex, parseTint, SOLO_COLOR, tintFromAlias } from './tint.js';

export const TINT_KEY = 'ascii-realm-tint';

const rgb = (colour) => `rgb(${colour.join(', ')})`;

export function bindTintPicker(client, { doc = document, params = new URLSearchParams(),
  getStorage = () => globalThis.localStorage, getName = () => '', autoColour = () => SOLO_COLOR,
  onTint = () => {} } = {}) {
  const $ = (id) => doc.getElementById(id);
  const group = $('lobby-tint-swatches');
  const custom = $('lobby-tint-custom');
  const preview = $('lobby-tint-preview');
  const status = $('lobby-tint-status');
  const chosenLabel = $('lobby-tint-label');
  // Blocked storage (private windows, sandboxed frames) may throw on any of
  // these; the colour then lasts only as long as the page.
  const storage = {
    get() { try { return getStorage()?.getItem(TINT_KEY) ?? null; } catch { return null; } },
    set(value) {
      try {
        const store = getStorage();
        if (value) store?.setItem(TINT_KEY, value);
        else store?.removeItem(TINT_KEY);
      } catch {}
    },
  };

  const options = [{ id: 'auto', label: 'Auto', hex: null }, ...NAME_COLOURS, { id: 'custom', label: 'Custom…' }];
  const swatches = options.map((option) => {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'lobby-tint-swatch';
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-label', option.id === 'custom' ? 'Custom colour' : option.label);
    button.title = option.label;
    button.dataset.tint = option.id;
    const sample = doc.createElement('span');
    sample.className = 'lobby-tint-sample';
    button.append(sample);
    group.append(button);
    button.addEventListener('click', () => (option.id === 'custom' ? openCustom() : choose(option.hex)));
    button.addEventListener('keydown', (event) => key(event, options.indexOf(option)));
    return { option, button, sample };
  });

  // A ?tint= in the address (a hex or a colour's id) wins for this visit and
  // isn't kept; otherwise the colour kept from last time. Hex typed loosely
  // (no #, capitals, spaces) is tidied here: the lobby takes only '#rrggbb'.
  const asked = params.get('tint');
  const typed = (raw) => parseTint(normalHex(raw));
  let tint = (asked === null ? null : typed(asked) ?? tintFromAlias(asked)) ?? typed(storage.get());
  let customTint = selectedId() === 'custom' ? tint : null;

  function selectedId() {
    if (!tint) return 'auto';
    return NAME_COLOURS.find((colour) => colour.hex === tint)?.id ?? 'custom';
  }

  function render() {
    const selected = selectedId();
    const auto = autoColour();
    for (const { option, button, sample } of swatches) {
      const checked = option.id === selected;
      button.setAttribute('aria-checked', String(checked));
      button.tabIndex = checked ? 0 : -1;
      const colour = option.id === 'auto' ? auto : option.id === 'custom' ? customTint && hexRgb(customTint) : hexRgb(option.hex);
      sample.textContent = colour ? 'Aa' : '#';
      sample.style.color = colour ? rgb(colour) : '';
    }
    chosenLabel.textContent = ` · ${selected === 'custom' ? tint : swatches.find((s) => s.option.id === selected).option.label}`;
    preview.textContent = getName();
    preview.style.color = rgb(tint ? hexRgb(tint) : auto);
  }

  // `send` is false while the custom picker is still being dragged: the
  // colour shows here at once and goes to the lobby when it is let go.
  function choose(next, { raw = next, send = true } = {}) {
    tint = typed(next);
    if (selectedId() === 'custom') customTint = tint;
    onTint(tint);
    render();
    if (!send) return;
    client.setTint(tint);
    storage.set(tint);
    const notes = [tint ? 'Name colour updated.' : 'Name colour cleared.'];
    if (tint && normalHex(raw) !== tint) notes.push('Lightened to stay readable.');
    if (!client.room) notes.push('Friends see it when you join a lobby.');
    status.textContent = notes.join(' ');
  }

  function openCustom() {
    custom.value = customTint ?? tint ?? '#ffaa00';
    try { custom.showPicker(); } catch { custom.click(); }
  }
  custom.addEventListener('input', () => choose(custom.value, { send: false }));
  custom.addEventListener('change', () => choose(custom.value));

  // Arrow keys move through the colours, as in any radio group. Moving onto
  // Custom only focuses it until a custom colour has been picked.
  function key(event, index) {
    const steps = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    let next;
    if (event.key in steps) next = (index + steps[event.key] + options.length) % options.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    else return;
    event.preventDefault();
    const { option, button } = swatches[next];
    if (option.id !== 'custom') choose(option.hex);
    else if (customTint) choose(customTint);
    button.focus();
  }

  client.setTint(tint);
  onTint(tint);
  render();
  return { render, choose, get tint() { return tint; } };
}
