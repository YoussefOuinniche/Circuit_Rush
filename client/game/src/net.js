// Client networking through window.net, supplied by net-shim.js over WebSocket.
// TCP/UDP selection controls the gateway-to-game-server connection.
import { NetworkStats } from './network-stats.mjs';
const handlers = {};
const encoder = new TextEncoder();
const lastSeq = new Map(); // sender id -> newest sequence across both transports

export const net = {
  available: !!window.net,
  id: null,
  name: null,
  room: null,       // last 'room' message
  ping: 0,
  loss: false,      // demo switch: skip 20% of outgoing UDP position updates
  seq: 0,
  _use: 0,
  protocol: 'udp',
  raceId: null,
  stats: new NetworkStats(),

  prepareRace(raceId) {
    this.raceId = raceId; this.seq = 0; this.loss = false; lastSeq.clear();
    this.stats.reset(); this.setProtocol('udp');
  },
  setProtocol(protocol) {
    if (!['tcp', 'udp'].includes(protocol)) return;
    this.stats.switch(protocol); this.protocol = protocol; this.ping = null;
    this.send({ t: 'transport', protocol });
    // Register the UDP endpoint immediately when switching back from TCP.
    if (protocol === 'udp') window.net.sendUdp({ t: 'ping', id: this.id, ts: performance.now() });
  },
  state(msg) {
    const packet = { ...msg, id: this.id, raceId: this.raceId, measure: this.stats.active };
    const dropped = this.protocol === 'udp' && this.loss && Math.random() < 0.2;
    const bytes = encoder.encode(JSON.stringify(packet)).length + (this.protocol === 'tcp' ? 1 : 0);
    this.stats.sent(msg.seq, bytes, dropped);
    if (!dropped) {
      if (this.protocol === 'tcp') this.send(packet); else window.net.sendUdp(packet);
    }
  },

  connect() { window.net.connect(); },
  send(msg) { window.net.send(msg); },
  udp(msg) {
    window.net.sendUdp({ ...msg, id: this.id });
  },
  on(type, fn) { handlers[type] = fn; },
  get isHost() { return !!this.room && this.room.host === this.id; },
  newUseId() { return `${this.id}-${++this._use}`; },
};

if (net.available) {
  window.net.on((m) => {
    if (m.t === 'pong') {
      if (m.protocol === net.protocol) net.ping = Math.round(performance.now() - m.ts);
      return;
    }
    if (m.t === 'state_ack') {
      if (m.raceId === net.raceId) net.stats.acknowledge(m.seq, m.protocol);
      return;
    }
    if (m.t === 's') {
      if (m.raceId !== net.raceId) return;
      const stale = m.seq <= (lastSeq.get(m.id) ?? -1);
      net.stats.receive(m._transport, stale);
      if (stale) return; // also protects against old UDP packets arriving after a switch
      lastSeq.set(m.id, m.seq);
    }
    if (m.t === 'room') net.room = m;
    if (m.t === 'login_ok') { net.id = m.id; net.name = m.name; lastSeq.clear(); }
    try { handlers[m.t] && handlers[m.t](m); } catch (e) { console.error('[net]', m.t, e); }
  });
  // Reliable liveness is independent of UDP loss or UDP being blocked.
  setInterval(() => {
    if (!net.id) return;
    net.send({ t: 'ping', ts: performance.now() });
    if (net.protocol === 'udp') net.udp({ t: 'ping', ts: performance.now() });
  }, 1000);
}

const r2 = (v) => Math.round(v * 100) / 100;

/** Position state: [index, x, y, z, heading, speed, trackT, lap, flags]. */
export function sendKartStates(karts) {
  const k = [];
  for (const kart of karts) {
    if (!kart.local) continue;
    const flags = (kart.drifting ? 1 : 0) | (kart.driftDir > 0 ? 2 : 0) | (kart.boostTimer > 0 ? 4 : 0) | (kart.airborne ? 8 : 0);
    k.push([kart.index, r2(kart.position.x), r2(kart.position.y), r2(kart.position.z), r2(kart.heading), r2(kart.speed), Math.round(kart.trackT * 1e4) / 1e4, kart._lapCount | 0, flags]);
  }
  if (k.length) net.state({ t: 's', seq: net.seq++, k });
}

/** Store a received state on the kart; driveRemote() moves the kart toward it every frame. */
export function applyKartState(kart, s) {
  kart.net = { x: s[1], y: s[2], z: s[3], h: s[4], speed: s[5], t: s[6], flags: s[8] };
}

/** Remote karts: no physics here — dead-reckon the last state forward and smooth toward it. */
export function driveRemote(k, dt) {
  const s = k.net;
  if (!s) return;
  s.x += Math.sin(s.h) * s.speed * dt; // predict where it is now (hides UDP gaps / lost packets)
  s.z += Math.cos(s.h) * s.speed * dt;
  const a = 1 - Math.exp(-dt * 10);
  k.position.x += (s.x - k.position.x) * a;
  k.position.y += (s.y - k.position.y) * a;
  k.position.z += (s.z - k.position.z) * a;
  let d = s.h - k.heading;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  k.heading += d * a;
  k.speed = s.speed;
  k.velocity.set(Math.sin(k.heading) * s.speed, 0, Math.cos(k.heading) * s.speed);
  k.trackT = s.t;
  k.drifting = !!(s.flags & 1);
  k.driftDir = s.flags & 2 ? 1 : -1;
  k.airborne = !!(s.flags & 8);
  if (s.flags & 4) k.boostTimer = Math.max(k.boostTimer, 0.1);
  // timers normally ticked by Kart physics (item effects shown on remote karts)
  k.time += dt;
  for (const n of ['boostTimer', 'starTimer', 'invulnTimer', 'spinTimer']) k[n] = Math.max(0, k[n] - dt);
  if (k.shrinkTimer > 0 && (k.shrinkTimer -= dt) <= 0) k._endShrink();
  k._animate(dt, 0, 1);
}
