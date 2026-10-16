import { Spellcasting } from './casting.js';
import { loadSpells } from './catalog.js';
import { practiceSpells } from './practice.js';
import { Player } from '../entities/player.js';
import { Monster, Monsters, toCells, toMetres } from '../entities/monsters.js';
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const library = [...practiceSpells, ...await loadSpells()];
const player = new Player(0, 0), ally = new Player(...toCells(3, 6));
const monsters = new Monsters({ counts: {} });
const world = { isWalkable: (x, y) => { const [mx, mz] = toMetres(x, y); return !$('wall').checked || Math.abs(mz - 3) > 0.3 || Math.abs(mx) > 2; } };
const log = message => { $('log').textContent = message; };
const casting = new Spellcasting({ player, world, monsters, spells: library, peers: () => [ally], notify: log });
window.simulation = { casting, player, ally, monsters, world };
for (const s of library) { const option = document.createElement('option'); option.value = s.id; option.textContent = s.name; $('spell').append(option); }
$('spell').firstElementChild.remove();
$('spell').value = library.some(s => s.id === params.get('spell')) ? params.get('spell') : library[0].id;
let paused = false;
function reset() {
  casting.reset(); player.respawn(0, 0); player.vitals.health = 60;
  ally.respawn(...toCells(3, $('near').checked ? 1.5 : 6)); ally.vitals.health = 30;
  if ($('near').checked) ally.x = toCells(0.7, 0)[0];
  const foe = new Monster(...toCells(0, $('near').checked ? 1.5 : 6), { risen: true });
  foe.health = foe.maxHealth = 100; monsters.list = [foe]; monsters.kills = 0; monsters.events.length = 0;
  casting.sync(); casting.state(ally).mana = 20; log('Ready.'); render();
}
function choose() {
  casting.selected = $('spell').value;
  const spell = casting.spells.get(casting.selected), p = casting.modifiers(casting.variant(spell));
  $('description').textContent = `${spell.name} · ${spell.element} · ${p.mana ?? 0} mana · ${p.cooldown ?? 0}s cooldown`
    + (p.damage ? ` · ${p.damage} damage` : '') + (p.heal ? ` · ${p.heal} heal` : '')
    + (p.burnt_damage ? ` · ${p.burnt_damage} damage each second for ${p.burnt_duration}s` : '');
  const url = new URL(location.href); url.searchParams.set('spell', spell.id); history.replaceState(null, '', url);
  reset();
}
function cast() {
  const spell = casting.spells.get(casting.selected);
  const target = $('ally-target').checked || spell.supportive ? ally : monsters.list[0];
  const [x, z] = toMetres(target.x - player.x, target.y - player.y);
  const result = casting.cast(casting.selected, { target, aim: target, heading: Math.atan2(x, z) });
  log(result.ok ? `${spell.name} cast.` : result.reason); render();
}
function render() {
  const cells = Array.from({ length: 24 }, () => Array(52).fill('·'));
  const put = (entity, char) => { const [x, z] = toMetres(entity.x, entity.y); const col = Math.round(26 + x * 3), row = Math.round(20 - z * 2); if (cells[row]?.[col]) cells[row][col] = char; };
  if ($('wall').checked) for (let x = -2; x <= 2; x += 0.33) { const [cx, cy] = toCells(x, 3); put({ x: cx, y: cy }, '#'); }
  for (const z of casting.zones) put(z, 'o');
  for (const p of casting.projectiles) put(p, '*');
  for (const e of casting.effects.list) put(e, '+');
  put(player, '@'); put(ally, '+');
  for (const foe of monsters.list) put(foe, foe.alive ? 'X' : '%');
  $('arena').textContent = cells.map(row => row.join('')).join('\n');
  const state = e => { const s = casting.state(e); return `${Math.ceil(e.vitals?.health ?? e.health)} HP · ${Math.floor(s.mana)} MP · ${Math.ceil(s.shield)} shield · ${[...s.auras.keys(), ...s.potions.keys()].join(', ') || 'clear'}`; };
  $('stats').replaceChildren(...[['Caster', player], ['Enemy', monsters.list[0]], ['Ally', ally]].map(([label, entity]) => {
    const item = document.createElement('div'); const title = document.createElement('strong'); title.textContent = label;
    const value = document.createElement('output'); value.textContent = ` ${state(entity)}`; item.append(title, document.createElement('br'), value); return item;
  }));
}
$('cast').addEventListener('click', cast); $('reset').addEventListener('click', reset);
$('hurt').addEventListener('click', () => { player.takeDamage(12); render(); });
$('advance').addEventListener('click', () => { casting.update(1); render(); });
$('pause').addEventListener('click', () => { paused = !paused; $('pause').textContent = paused ? 'Resume' : 'Pause'; });
$('spell').addEventListener('change', choose); $('near').addEventListener('change', reset);
window.addEventListener('keydown', e => { if (e.code === 'KeyR' && !e.repeat && !['SELECT', 'INPUT'].includes(e.target.tagName)) cast(); });
let previous = performance.now();
function frame(now) { const dt = Math.min(0.1, (now - previous) / 1000); previous = now; if (!paused && !document.hidden) casting.update(dt); render(); requestAnimationFrame(frame); }
choose(); requestAnimationFrame(frame);
