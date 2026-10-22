import { Spellcasting } from './casting.js';
import { loadSpells } from './catalog.js';
import { practiceSpells } from './practice.js';
import { Player } from '../entities/player.js';
import { Monster, Monsters, toCells, toMetres } from '../entities/monsters.js';
import { GameAudio } from '../audio/audio.js';
import { prepareSpellSounds } from '../audio/spells.js';
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const library = [...practiceSpells, ...await loadSpells()];
const player = new Player(0, 0), ally = new Player(...toCells(3, 6));
const monsters = new Monsters({ counts: {} });
const world = { isWalkable: (x, y) => { const [mx, mz] = toMetres(x, y); return !$('wall').checked || Math.abs(mz - 3) > 0.3 || Math.abs(mx) > 2; } };
const log = message => { $('log').textContent = message; };
const sound = new GameAudio(world);
const casting = new Spellcasting({ player, world, monsters, spells: library, peers: () => [ally], notify: log,
  onSound: event => sound.play(event) });
window.simulation = { casting, player, ally, monsters, world, sound };
for (const s of library) { const option = document.createElement('option'); option.value = s.id; option.textContent = s.name; $('spell').append(option); }
$('spell').firstElementChild.remove();
$('spell').value = library.some(s => s.id === params.get('spell')) ? params.get('spell') : library[0].id;
let paused = false;
let castGeneration = 0;
function reset() {
  castGeneration++;
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
  $('description').textContent = `${spell.name} · ${spell.element} · ${p.mana ?? 0} mana`
    + (p.damage ? ` · ${p.damage} damage` : '') + (p.heal ? ` · ${p.heal} heal` : '')
    + (p.burnt_damage ? ` · ${p.burnt_damage} damage each second for ${p.burnt_duration}s` : '');
  if (spell.description) $('description').textContent += ` · ${spell.description}`;
  const url = new URL(location.href); url.searchParams.set('spell', spell.id); history.replaceState(null, '', url);
  reset();
}
async function cast() {
  const generation = castGeneration;
  // Resume synchronously from this click/key gesture before the cue is emitted.
  await sound.engine.unlock();
  await prepareSpellSounds(sound.engine, casting.spells.get(casting.selected));
  if (paused || generation !== castGeneration) return;
  const spell = casting.spells.get(casting.selected);
  const target = $('ally-target').checked || spell.supportive ? ally : monsters.list[0];
  const [x, z] = toMetres(target.x - player.x, target.y - player.y);
  const result = casting.cast(casting.selected, { target, aim: target, heading: Math.atan2(x, z) });
  log(result.ok ? `${spell.name} cast.` : result.reason); render();
}
function render() {
  const cells = Array.from({ length: 24 }, () => Array(52).fill('·'));
  const colors = Array.from({ length: 24 }, () => Array(52).fill(null));
  const put = (entity, char, color = null) => { const [x, z] = toMetres(entity.x, entity.y); const col = Math.round(26 + x * 3), row = Math.round(20 - z * 2); if (cells[row]?.[col]) { cells[row][col] = char; colors[row][col] = color; } };
  if ($('wall').checked) for (let x = -2; x <= 2; x += 0.33) { const [cx, cy] = toCells(x, 3); put({ x: cx, y: cy }, '#'); }
  for (const z of casting.zones) put(z, 'o');
  casting.effects.paint((x, y, char, color, brightness) =>
    put({ x, y }, char, color.map(c => Math.round(c * brightness))), casting.projectiles);
  put(player, '@'); put(ally, '+');
  for (const foe of monsters.list) put(foe, foe.alive ? 'X' : '%');
  const rows = cells.map((row, y) => {
    const line = document.createElement('span');
    for (let x = 0; x < row.length;) {
      const key = colors[y][x]?.join(','), run = document.createElement('span');
      let end = x + 1;
      while (end < row.length && colors[y][end]?.join(',') === key) end++;
      run.textContent = row.slice(x, end).join('');
      if (key) run.style.color = `rgb(${key})`;
      line.append(run); x = end;
    }
    line.append('\n'); return line;
  });
  $('arena').replaceChildren(...rows);
  $('sound-status').textContent = sound.engine.muted ? 'Muted' : sound.engine.context?.state === 'running' ? 'Sound enabled' : 'Cast to enable sound';
  const state = e => { const s = casting.state(e); return `${Math.ceil(e.vitals?.health ?? e.health)} HP · ${Math.floor(s.mana)} MP · ${Math.ceil(s.shield)} shield · ${[...s.auras.keys(), ...s.potions.keys()].join(', ') || 'clear'}`; };
  $('stats').replaceChildren(...[['Caster', player], ['Enemy', monsters.list[0]], ['Ally', ally]].map(([label, entity]) => {
    const item = document.createElement('div'); const title = document.createElement('strong'); title.textContent = label;
    const value = document.createElement('output'); value.textContent = ` ${state(entity)}`; item.append(title, document.createElement('br'), value); return item;
  }));
}
$('cast').addEventListener('click', cast); $('reset').addEventListener('click', reset);
$('hurt').addEventListener('click', () => { player.takeDamage(12); render(); });
$('advance').addEventListener('click', () => { casting.update(1); render(); });
$('pause').addEventListener('click', () => { paused = !paused; castGeneration++; casting.setPresentationPaused(paused); if (paused) sound.pause(); $('pause').textContent = paused ? 'Resume' : 'Pause'; });
$('mute').addEventListener('click', () => { sound.engine.toggleMute(); $('mute').textContent = sound.engine.muted ? 'Unmute' : 'Mute'; render(); });
$('sfx-volume').value = sound.engine.volumes.sfx;
$('sfx-volume').addEventListener('input', () => sound.engine.setVolume('sfx', Number($('sfx-volume').value)));
$('mute').textContent = sound.engine.muted ? 'Unmute' : 'Mute';
$('spell').addEventListener('change', choose); $('near').addEventListener('change', reset);
window.addEventListener('keydown', e => { if (e.code === 'KeyR' && !e.repeat && !['SELECT', 'INPUT'].includes(e.target.tagName)) cast(); });
document.addEventListener('visibilitychange', () => { castGeneration++; casting.setPresentationPaused(paused || document.hidden); if (document.hidden) sound.pause(); });
window.addEventListener('pagehide', () => { castGeneration++; casting.clearPresentation(); void sound.dispose(); });
let previous = performance.now();
function frame(now) { const dt = Math.min(0.1, (now - previous) / 1000); previous = now; if (!paused && !document.hidden) casting.update(dt); for (const handle of sound.effects) if (handle.ended) sound.effects.delete(handle); render(); requestAnimationFrame(frame); }
choose(); requestAnimationFrame(frame);
