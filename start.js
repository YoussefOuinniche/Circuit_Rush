// Browser-only hosting: npm start shares a public link; npm run local uses HTTP only.
// Players open the link in their browser and install nothing.
const { execSync, execFileSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts });
const client = path.join(__dirname, 'client');
const localOnly = process.argv.includes('--local');
const webPort = +process.env.WEB_PORT || 8080;
const adminPort = +process.env.ADMIN_PORT || webPort + 1;

if (!fs.existsSync(path.join(client, 'node_modules', 'three'))) {
  console.log('Installing game files (one time)...');
  // npmmirror: works on networks that block registry.npmjs.org
  run('npm ci --registry=https://registry.npmmirror.com', { cwd: client });
}

function findCloudflared() {
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'cloudflared.exe'),
    'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
    'C:\\Program Files\\cloudflared\\cloudflared.exe',
  ];
  try { execFileSync('cloudflared', ['--version'], { stdio: 'ignore' }); return 'cloudflared'; } catch { /* not on PATH */ }
  return candidates.find((p) => fs.existsSync(p));
}
let cloudflared = localOnly ? null : findCloudflared();
if (!localOnly && !cloudflared && process.platform === 'win32') {
  console.log('Installing Cloudflare tunnel tool (one time)...');
  try { run('winget install --id Cloudflare.cloudflared -e --silent --accept-source-agreements --accept-package-agreements'); } catch { /* reported below */ }
  cloudflared = findCloudflared();
}

const gameServer = require('./server/server.js'); // referee + player gateway + server controls

const lan = Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => `http://${a.address}:${webPort}`);
const banner = (lines) => console.log('\n' + '='.repeat(64) + '\n' + lines.join('\n') + '\n' + '='.repeat(64) + '\n');
banner(['SERVER - create rooms and start races (no playing):', `   http://localhost:${adminPort}`, '',
  'CLIENTS - open one of these links to join a room:', ...lan.map((u) => '   ' + u), '',
  'Keep this terminal open while playing. Press Ctrl+C to stop.']);

if (localOnly) {
  console.log('Local mode. Run npm start to also create a public sharing link.');
} else if (!cloudflared) {
  console.log('Public link unavailable: install cloudflared, then run npm start again. Local HTTP is ready.');
} else {
  // http2 instead of QUIC: QUIC needs outgoing UDP, which school/campus networks often block
  const tunnel = spawn(cloudflared, ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', `http://127.0.0.1:${webPort}`], { windowsHide: true });
  console.log('Opening public link (takes ~10-30 s)...');
  let url = null, connected = false, shown = false;
  const resolver = new (require('dns').promises.Resolver)();
  resolver.setServers(['1.1.1.1', '8.8.8.8']);
  const showWhenLive = async () => {
    if (shown || !url || !connected) return;
    shown = true;
    gameServer.setPublicUrl(url);
    // wait until the new name exists in public DNS, so players don't get "site can't be reached"
    for (let i = 0; i < 30; i++) {
      try { await resolver.resolve4(new URL(url).hostname); break; } catch { await new Promise((r) => setTimeout(r, 2000)); }
    }
    await new Promise((r) => setTimeout(r, 3000));
    banner(['PLAYERS: open this link in Chrome/Edge, from any network:', '', '   ' + url, '',
      'If it says "site can\'t be reached" on THIS PC: run  ipconfig /flushdns  and reload.',
      'Keep this terminal and computer running while others play.',
      'The public link changes when you restart.',
      'Same network also works: ' + lan.join('  ')]);
  };
  const watch = (d) => {
    const text = d.toString();
    const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m) url = m[0];
    if (/Registered tunnel connection/i.test(text)) connected = true;
    for (const line of text.split('\n')) if (/\bERR\b/.test(line)) console.log('[tunnel] ' + line.trim());
    showWhenLive();
  };
  tunnel.stdout.on('data', watch);
  tunnel.stderr.on('data', watch);
  tunnel.on('error', (e) => console.log(`Public tunnel could not start: ${e.message}. Local HTTP is still available.`));
  tunnel.on('exit', () => { gameServer.setPublicUrl(null); console.log('Public tunnel stopped. Local HTTP is still available. Restart npm start to share again.'); });
  process.on('exit', () => tunnel.kill());
  process.on('SIGINT', () => process.exit());
}
