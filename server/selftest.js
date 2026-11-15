// Smoke test: starts the server, connects two fake clients over real TCP/UDP and checks the main flows.
// Run: node selftest.js
const { spawn } = require('child_process');
const net = require('net');
const dgram = require('dgram');
const assert = require('assert');

const srv = spawn(process.execPath, [__dirname + '/server.js'], { env: { ...process.env, TCP_PORT: 5100, UDP_PORT: 5101, WEB_PORT: 5102 } });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function client() {
  const c = { msgs: [], udpMsgs: [], sock: net.connect(5100, '127.0.0.1'), udp: dgram.createSocket('udp4') };
  let buf = '';
  c.sock.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { c.msgs.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  c.udp.on('message', (m) => c.udpMsgs.push(JSON.parse(m)));
  c.send = (m) => c.sock.write(JSON.stringify(m) + '\n');
  c.sendUdp = (m) => c.udp.send(JSON.stringify({ ...m, id: c.id }), 5101, '127.0.0.1');
  c.last = (t) => [...c.msgs].reverse().find((m) => m.t === t);
  c.count = (t) => c.msgs.filter((m) => m.t === t).length;
  return c;
}

(async () => {
  await wait(400);
  const a = client(), b = client(), dup = client();
  await wait(100);
  a.send({ t: 'login', name: 'Alice' }); await wait(50);
  b.send({ t: 'login', name: 'Bob' });
  dup.send({ t: 'login', name: 'alice' }); await wait(100);
  assert.equal(dup.last('error').msg, 'Name already taken');
  a.id = a.last('login_ok').id; b.id = b.last('login_ok').id;
  const heartbeat = setInterval(() => { a.send({ t: 'ping', ts: 1 }); b.send({ t: 'ping', ts: 1 }); }, 500);
  a.sendUdp({ t: 'ping', ts: 1 }); b.sendUdp({ t: 'ping', ts: 1 }); await wait(100);
  assert.ok(a.udpMsgs.some((m) => m.t === 'pong'), 'pong over UDP');

  a.send({ t: 'create', name: 'Room <1>' }); await wait(100);
  const roomId = a.last('room').id;
  assert.equal(a.last('room').name, 'Room 1', 'name sanitized');
  b.send({ t: 'join', room: roomId }); await wait(100);
  assert.equal(a.last('room').players.length, 2);

  b.send({ t: 'start' }); await wait(100); // not host: ignored
  assert.equal(b.count('race_start'), 0);
  a.send({ t: 'start', laps: 1 }); await wait(100);
  const grid = a.last('race_start').grid;
  const raceId = a.last('race_start').raceId;
  assert.equal(grid.length, 8);
  a.send({ t: 'loaded' }); b.send({ t: 'loaded' }); await wait(100);
  assert.equal(b.count('go'), 1);

  const ka = grid.findIndex((g) => g.owner === a.id), kb = grid.findIndex((g) => g.owner === b.id);
  const state = (seq, kart = ka) => ({ t: 's', raceId, measure: true, seq, k: [[kart, 1, 2, 3, 0, 10, 0.5, 1, 0]] });
  a.sendUdp(state(1)); await wait(100);
  assert.ok(b.udpMsgs.some((m) => m.t === 's' && m.k[0][0] === ka), 'state relayed over UDP');
  assert.ok(a.udpMsgs.some((m) => m.t === 'state_ack' && m.seq === 1 && m.protocol === 'udp'), 'UDP update acknowledged over UDP');

  b.send({ t: 'transport', protocol: 'tcp' });
  a.send({ t: 'transport', protocol: 'tcp' }); await wait(100);
  a.send(state(2)); await wait(100);
  assert.equal(b.last('s').seq, 2, 'TCP update relayed over TCP');
  assert.equal(a.last('state_ack').protocol, 'tcp', 'TCP ACK');
  a.sendUdp(state(3)); await wait(100);
  assert.equal(b.last('s').seq, 3, 'UDP sender can reach TCP receiver');
  b.send({ t: 'transport', protocol: 'udp' }); await wait(100);
  a.send(state(4)); await wait(100);
  assert.ok(b.udpMsgs.some((m) => m.t === 's' && m.seq === 4), 'TCP sender can reach UDP receiver');
  const received = () => b.msgs.concat(b.udpMsgs).filter((m) => m.t === 's').length;
  const beforeInvalid = received();
  a.sendUdp(state(2)); // old UDP packet after a TCP update
  a.send({ ...state(5), raceId: -1 }); // previous/invalid race
  a.send(state(6, kb)); // another player's kart
  await wait(100);
  assert.equal(received(), beforeInvalid, 'stale, wrong-race and unauthorized updates not relayed');

  a.send({ t: 'box', box: 3, kart: ka }); b.send({ t: 'box', box: 3, kart: kb }); await wait(100);
  assert.equal(a.count('box'), 1, 'only one box claim wins');
  b.send({ t: 'box', box: 4, kart: ka }); await wait(100);
  assert.equal(a.count('box'), 1, 'cannot claim for a kart you do not own');

  a.send({ t: 'hit', useId: 'x1', kart: ka, kind: 'spin' }); b.send({ t: 'hit', useId: 'x1', kart: kb, kind: 'spin' }); await wait(100);
  assert.equal(a.count('hit'), 1, 'one hit per projectile');

  a.send({ t: 'finish', kart: ka }); await wait(100);
  assert.equal(a.count('finish'), 0, 'finish within 10 s of GO is rejected');

  // TCP heartbeats alone keep the experiment alive even with no UDP traffic.
  await wait(14000);
  assert.equal(a.count('error'), 0, 'TCP-only traffic prevents UDP timeout');
  a.send({ t: 'finish', kart: ka }); b.send({ t: 'finish', kart: kb });
  await wait(4300);
  assert.equal(a.count('race_end'), 1, 'mixed-transport race completes');
  assert.equal(a.last('race_end').results.length, 8);
  a.send({ t: 'start', laps: 1 }); await wait(100);
  assert.notEqual(a.last('race_start').raceId, raceId, 'next race has an isolated measurement ID');

  b.sock.destroy(); await wait(200);
  assert.ok(a.last('left'), 'disconnect broadcast');
  assert.equal(a.last('room').players.length, 1);

  clearInterval(heartbeat);
  await wait(4200); // no traffic on either transport -> heartbeat timeout
  assert.equal(a.last('error').msg, 'Timed out (no network heartbeat)');
  console.log('selftest OK');
  srv.kill(); process.exit(0);
})().catch((e) => { console.error('selftest FAILED', e); srv.kill(); process.exit(1); });
