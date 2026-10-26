import { cleanCode, cleanName } from './protocol.js';
import { memberColour } from './tint.js';

export function bindMultiplayerControls(client, { name, seed, onName, onDone = () => {}, document: doc = document,
  location: loc = location, history: navigation = history } = {}) {
  const panel = doc.getElementById('multiplayer-controls');
  const summary = doc.getElementById('multiplayer-summary');
  const form = doc.getElementById('lobby-form');
  const nameInput = doc.getElementById('lobby-name');
  const codeInput = doc.getElementById('lobby-code');
  const serverInput = doc.getElementById('lobby-server');
  const create = doc.getElementById('lobby-create');
  const join = doc.getElementById('lobby-join');
  const leave = doc.getElementById('lobby-leave');
  const status = doc.getElementById('multiplayer-status');
  const session = doc.getElementById('lobby-session');
  const roomCode = doc.getElementById('lobby-room-code');
  const party = doc.getElementById('lobby-players');
  const copy = doc.getElementById('lobby-copy-code');
  const invite = doc.getElementById('lobby-copy-invite');
  const share = doc.getElementById('lobby-share');
  const params = new URLSearchParams(loc.search);
  let wasInLobby = false;
  let storedName;
  try { storedName = localStorage.getItem('ascii-realm-name'); } catch {}
  nameInput.value = cleanName(params.get('name') || storedName || name);
  codeInput.value = cleanCode(params.get('room'));
  serverInput.value = params.get('server') || '';
  if (codeInput.value) panel.open = true;

  function connect(mode) {
    const chosenName = cleanName(nameInput.value);
    nameInput.value = chosenName;
    onName(chosenName);
    try { localStorage.setItem('ascii-realm-name', chosenName); } catch {}
    client.connect({ mode, name: chosenName, seed: seed(), code: codeInput.value, server: serverInput.value });
    create.blur();
    join.blur();
    onDone();
  }
  create.addEventListener('click', () => connect('create'));
  form.addEventListener('submit', (event) => { event.preventDefault(); connect('join'); });
  codeInput.addEventListener('input', () => { codeInput.value = codeInput.value.toUpperCase(); });
  leave.addEventListener('click', () => { client.leave(); leave.blur(); onDone(); });

  async function copyText(text, button) {
    share.hidden = true;
    try {
      await navigator.clipboard.writeText(text);
      button.blur();
      onDone();
      button.textContent = 'Copied';
      setTimeout(() => { button.textContent = button === copy ? 'Copy code' : 'Copy invite'; }, 1500);
    } catch {
      share.hidden = false;
      share.value = text;
      share.focus();
      share.select();
    }
  }
  copy.addEventListener('click', () => { if (client.room) void copyText(client.room.code, copy); });
  invite.addEventListener('click', () => {
    if (!client.room) return;
    const url = new URL(loc.href);
    for (const key of ['name', 'tint', 'debug', 'seed']) url.searchParams.delete(key);
    url.searchParams.set('room', client.room.code);
    if (serverInput.value.trim()) url.searchParams.set('server', client.options.server);
    else url.searchParams.delete('server');
    void copyText(url.href, invite);
  });

  function render() {
    const busy = ['online', 'connecting', 'reconnecting'].includes(client.status);
    form.hidden = !!client.room;
    session.hidden = !client.room;
    for (const input of [nameInput, codeInput, serverInput, create, join]) input.disabled = busy;
    leave.hidden = !busy;
    leave.textContent = client.room ? 'Leave lobby' : 'Cancel';
    status.textContent = client.message;
    status.dataset.state = client.status;
    summary.textContent = client.room ? `Lobby ${client.room.code} · ${client.players.length}/${client.room.maxPlayers}` : 'Multiplayer · Solo';
    roomCode.textContent = client.room?.code || '';
    if (client.room) codeInput.value = client.room.code;
    party.replaceChildren();
    for (const member of client.players) {
      const item = doc.createElement('li');
      // The tag that tells same-named players apart is its own element, so
      // it never breaks or wraps away from the name.
      const colour = `rgb(${memberColour(member).join(', ')})`;
      const label = doc.createElement('span');
      label.className = 'lobby-player-name';
      label.textContent = member.name;
      label.style.color = colour;
      item.append(label);
      if (member.tag) {
        const tag = doc.createElement('span');
        tag.className = 'lobby-player-tag';
        tag.textContent = ` (${member.tag})`;
        tag.style.color = colour;
        item.append(tag);
      }
      if (member.id === client.id) item.append(' (you)');
      party.append(item);
    }
    // Refreshing keeps the code; resume tokens never appear in URLs or rosters.
    const url = new URL(loc.href);
    if (client.room) {
      wasInLobby = true;
      url.searchParams.set('room', client.room.code);
      if (serverInput.value.trim()) url.searchParams.set('server', client.options.server);
    } else if (wasInLobby && ['offline', 'error'].includes(client.status)) {
      url.searchParams.delete('room');
      share.hidden = true;
      wasInLobby = false;
    }
    navigation.replaceState(null, '', url);
  }
  client.onChange = render;
  render();
  onName(nameInput.value);
  // An invite joins straight away, but not one naming its own lobby server:
  // a link should not connect the page to an unknown host until the player
  // has seen the address and pressed Join.
  // Reloading into the lobby's world after joining it rejoins at once.
  let rejoin = null;
  try {
    rejoin = sessionStorage.getItem('ascii-realm-rejoin');
    sessionStorage.removeItem('ascii-realm-rejoin');
  } catch {}
  if (codeInput.value && (!serverInput.value || rejoin === codeInput.value)) connect('join');
  else if (codeInput.value) status.textContent = 'This invite uses another lobby server. Check its address, then press Join.';
  return render;
}
