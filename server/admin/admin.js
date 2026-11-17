const form = document.querySelector('#create-room');
const roomsEl = document.querySelector('#rooms');
const emptyMarkup = roomsEl.innerHTML;
const feedback = document.querySelector('#feedback');
const connection = document.querySelector('#connection');
const linkSelect = document.querySelector('#player-link');
const copyButton = document.querySelector('#copy-link');
const classes = { easy: '50cc · Easy', normal: '100cc · Normal', hard: '150cc · Hard' };
let lastRooms = '', lastLinks = '', connected = false;
const busyRooms = new Set();

function message(text, error = false) {
  feedback.textContent = text;
  feedback.classList.toggle('error', error);
}
async function api(url, method = 'GET', data) {
  const response = await fetch(url, { method, cache: 'no-store', ...(method === 'GET' ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data || {}) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'That action could not be completed');
  return result;
}
function renderRooms(rooms) {
  const key = JSON.stringify([rooms, [...busyRooms], connected]);
  if (key === lastRooms) return;
  lastRooms = key;
  const focus = roomsEl.contains(document.activeElement) ? document.activeElement.id : null;
  roomsEl.replaceChildren();
  if (!rooms.length) { roomsEl.innerHTML = emptyMarkup; return; }
  for (const room of rooms) {
    const el = document.createElement('article');
    el.className = 'room';
    el.dataset.roomId = room.id;
    el.innerHTML = `<div class="room-top"><div><p class="room-code"></p><h3></h3></div><span class="badge"></span></div><p class="room-meta"></p><ul class="players" aria-label="Connected racers"></ul><div class="room-actions"><button type="button" class="button primary start-race">Start race <span aria-hidden="true">→</span></button><button type="button" class="button close-room">Close room</button></div>`;
    el.querySelector('.room-code').textContent = `ROOM ${String(room.id).padStart(2, '0')}`;
    el.querySelector('h3').textContent = room.name;
    const badge = el.querySelector('.badge');
    const status = room.state === 'lobby' ? (room.count ? 'ready' : 'waiting') : room.state;
    badge.classList.add(status);
    badge.textContent = { ready: 'Ready to start', waiting: 'Waiting for players', loading: 'Loading race', racing: 'Race in progress' }[status];
    el.querySelector('.room-meta').textContent = `${room.laps} ${room.laps === 1 ? 'lap' : 'laps'} · ${classes[room.difficulty]} · ${room.count}/${room.max} players`;
    const list = el.querySelector('.players');
    for (let i = 0; i < room.max; i++) {
      const player = document.createElement('li');
      player.textContent = room.players[i]?.name || 'Open slot';
      if (!room.players[i]) player.className = 'empty-slot';
      list.append(player);
    }
    const start = el.querySelector('.start-race'), close = el.querySelector('.close-room');
    start.id = `start-${room.id}`; close.id = `close-${room.id}`;
    start.disabled = !connected || busyRooms.has(room.id) || !room.count || room.state !== 'lobby';
    close.disabled = !connected || busyRooms.has(room.id) || room.state !== 'lobby';
    start.setAttribute('aria-label', `Start race in ${room.name}`);
    close.setAttribute('aria-label', `Close ${room.name}`);
    start.addEventListener('click', () => roomAction(room, 'start'));
    close.addEventListener('click', () => roomAction(room, 'close'));
    roomsEl.append(el);
  }
  if (focus) document.getElementById(focus)?.focus({ preventScroll: true });
}
let latestRooms = [];
async function refresh() {
  try {
    const state = await api('/api/state');
    connected = true;
    connection.textContent = 'Server online'; connection.classList.remove('offline');
    document.querySelector('#room-total').textContent = state.rooms.length;
    document.querySelector('#player-total').textContent = state.connectedPlayers;
    latestRooms = state.rooms; renderRooms(state.rooms);
    const linksKey = JSON.stringify(state.playerLinks);
    if (linksKey !== lastLinks) {
      const selected = linkSelect.value; lastLinks = linksKey; linkSelect.replaceChildren();
      for (const link of state.playerLinks) linkSelect.add(new Option(link, link));
      if (state.playerLinks.includes(selected)) linkSelect.value = selected;
      if (!state.playerLinks.length) linkSelect.add(new Option('No player link available', ''));
    }
    linkSelect.disabled = !state.playerLinks.length; copyButton.disabled = !state.playerLinks.length;
    document.querySelector('#share-help').textContent = state.public ? 'Share this link. Players join from any network.' : 'Same network only. Choose this computer’s LAN address, or run npm start for a public link.';
  } catch (error) {
    connected = false; connection.textContent = 'Server unavailable'; connection.classList.add('offline');
    copyButton.disabled = true; renderRooms(latestRooms);
  }
}
async function roomAction(room, action) {
  busyRooms.add(room.id); renderRooms(latestRooms);
  try {
    await api(`/api/rooms/${room.id}${action === 'start' ? '/start' : ''}`, action === 'start' ? 'POST' : 'DELETE');
    message(action === 'start' ? `Starting ${room.name}. Connected players are loading the track.` : `${room.name} closed. Players return to the lobby.`);
  } catch (error) { message(error.message, true); }
  finally { busyRooms.delete(room.id); await refresh(); }
}
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = document.querySelector('#create-button');
  button.disabled = true; button.textContent = 'Creating…';
  try {
    const name = form.elements.name.value.trim();
    await api('/api/rooms', 'POST', { name, laps: Number(form.elements.laps.value), difficulty: form.elements.difficulty.value });
    message(`${name} is open. Players can now see it in their lobby.`);
    form.elements.name.value = ''; form.elements.name.focus();
    await refresh();
  } catch (error) { message(error.message, true); }
  finally { button.disabled = false; button.innerHTML = 'Create room <span aria-hidden="true">↗</span>'; }
});
copyButton.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(linkSelect.value); message('Player link copied. Send it to your racers.'); }
  catch { message(`Copy this player link: ${linkSelect.value}`); }
});
async function poll() { await refresh(); setTimeout(poll, 1000); }
poll();
