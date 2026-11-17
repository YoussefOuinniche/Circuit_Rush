// Browser network API. Connect to the same host that serves this page over WebSocket.
// The gateway forwards messages to the game server over real TCP / UDP sockets.
if (!window.net && location.protocol.startsWith('http')) {
  let ws = null, handler = null;
  const out = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
  window.net = {
    connect() {
      if (ws) { ws.onclose = null; ws.close(); }
      ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
      ws.onmessage = (e) => handler && handler(JSON.parse(e.data));
      ws.onclose = () => handler && handler({ t: 'disconnected' });
    },
    send: (m) => out({ k: 'tcp', m }),
    sendUdp: (m) => out({ k: 'udp', m }),
    on: (fn) => { handler = fn; },
  };
}
