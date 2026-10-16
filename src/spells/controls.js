// The rune library and a compact always-visible mana/cast control.
export class SpellControls {
  constructor(casting, { root, dock, onCast, onFocus = () => {}, initial = '' }) {
    this.casting = casting;
    this.root = root;
    this.root.innerHTML = '<div class="spell-mana"><label for="spell-mana">Mana</label><meter id="spell-mana" min="0" max="100" value="100"></meter><output id="spell-mana-value">100 / 100</output></div>'
      + '<button type="button" id="spell-cast">Cast <kbd>R</kbd></button><span id="spell-ready" role="status"></span>';
    this.meter = root.querySelector('meter');
    this.manaText = root.querySelector('output');
    this.castButton = root.querySelector('button');
    this.ready = root.querySelector('#spell-ready');
    this.panel = document.createElement('details');
    this.panel.id = 'spell-library'; this.panel.dataset.gameUi = '';
    this.panel.innerHTML = '<summary>Rune spells <kbd>R</kbd></summary><div class="spell-library-panel">'
      + '<label for="spell-element">Element</label><select id="spell-element"><option value="all">All elements</option>'
      + '<option value="oseni">Oseni · fire</option><option value="seithr">Seithr · ice</option>'
      + '<option value="cerrith">Cerrith · life</option><option value="mitlan">Mitlan · water</option></select>'
      + '<label for="spell-select">Rune</label><select id="spell-select"></select><p id="spell-description"></p>'
      + '<p id="spell-stats"></p><p>Aim with the pointer, then press R or Cast. On touch, spells follow your facing. Support spells need a player in range.</p>'
      + '<a href="docs/casting-simulation.html">Practice in the casting arena</a></div>';
    dock.prepend(this.panel);
    this.select = this.panel.querySelector('#spell-select');
    this.element = this.panel.querySelector('#spell-element');
    this.description = this.panel.querySelector('#spell-description');
    this.stats = this.panel.querySelector('#spell-stats');
    if (casting.spells.has(initial)) casting.selected = initial;
    this.element.addEventListener('change', () => this.populate());
    this.select.addEventListener('change', () => { casting.selected = this.select.value; this.describe(); onFocus(); });
    this.castButton.addEventListener('click', () => { onCast(); onFocus(); });
    this.populate();
  }
  populate() {
    const spells = this.casting.available.filter(s => this.element.value === 'all' || s.element === this.element.value);
    this.select.replaceChildren(...spells.map(s => { const option = document.createElement('option'); option.value = s.id; option.textContent = s.name; return option; }));
    this.select.value = spells.some(s => s.id === this.casting.selected) ? this.casting.selected : spells[0]?.id ?? '';
    this.casting.selected = this.select.value;
    this.describe();
  }
  describe() {
    const spell = this.casting.spells.get(this.casting.selected);
    this.description.textContent = spell?.description ?? (spell ? `${spell.name} · ${spell.element[0].toUpperCase() + spell.element.slice(1)}` : 'Rune spells are added individually.');
    const v = this.casting.variant(spell), p = v ? this.casting.modifiers(v) : {};
    this.stats.textContent = spell ? `${p.mana ?? 0} mana · ${p.cooldown ?? 0}s cooldown`
      + (p.damage ? ` · ${p.damage} damage` : '') + (p.heal ? ` · ${p.heal} healing` : '')
      + (p.shield_power ? ` · ${p.shield_power} shield` : '') + (p.duration ? ` · ${p.duration}s duration` : '') : '';
    this.castButton.textContent = spell ? `${spell.name} · R` : 'Cast · R';
  }
  update(blocked = false) {
    const casting = this.casting, spell = casting.spells.get(casting.selected), v = casting.variant(spell);
    const state = casting.state(), p = v ? casting.modifiers(v) : {};
    const remaining = v ? Math.max(0, (state.cooldowns.get(`${spell.id}:${v.id}`) ?? 0) - casting.time) : 0;
    this.meter.value = state.mana; this.meter.max = state.maxMana;
    this.manaText.textContent = `${Math.floor(state.mana)} / ${state.maxMana}`;
    const text = remaining ? `${remaining.toFixed(1)}s` : state.mana < (p.mana ?? 0) ? 'Low mana' : 'Ready';
    if (this.ready.textContent !== text) this.ready.textContent = text;
    this.castButton.disabled = blocked || !spell || remaining > 0 || state.mana < (p.mana ?? 0);
  }
}
