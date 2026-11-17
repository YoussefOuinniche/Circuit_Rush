// Local operator HTTP server. This port is never exposed by the public game gateway.
const http = require('http');
const fs = require('fs');
const path = require('path');

module.exports = function startAdmin({ port, log, snapshot, create, start, remove }) {
  const assets = { '/': ['index.html', 'text/html'], '/admin.css': ['admin.css', 'text/css'], '/admin.js': ['admin.js', 'text/javascript'] };
  const json = (res, status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  };
  const server = http.createServer(async (req, res) => {
    // Bind to loopback and check Host/Origin so a public page cannot act as the operator.
    const allowed = [`localhost:${port}`, `127.0.0.1:${port}`];
    if (!allowed.includes(req.headers.host) || (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)) {
      return json(res, 403, { error: 'Server controls are available only on this computer' });
    }
    const url = req.url.split('?')[0];
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    if (req.method === 'GET' && assets[url]) {
      const [file, type] = assets[url];
      return fs.readFile(path.join(__dirname, 'admin', file), (err, content) => {
        if (err) return json(res, 500, { error: 'Could not load server controls' });
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' }); res.end(content);
      });
    }
    if (req.method === 'GET' && url === '/api/state') return json(res, 200, snapshot());
    if (!['POST', 'DELETE'].includes(req.method)) return json(res, 404, { error: 'Not found' });
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') return json(res, 415, { error: 'Expected JSON' });
    try {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 16384) return json(res, 413, { error: 'Request too large' });
      }
      let input;
      try { input = JSON.parse(body || '{}'); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
      if (!input || typeof input !== 'object' || Array.isArray(input)) return json(res, 400, { error: 'Expected an object' });
      if (req.method === 'POST' && url === '/api/rooms') return json(res, 201, create(input));
      const match = url.match(/^\/api\/rooms\/(\d+)(\/start)?$/);
      if (match && req.method === 'POST' && match[2]) return json(res, 200, start(Number(match[1])));
      if (match && req.method === 'DELETE' && !match[2]) return json(res, 200, remove(Number(match[1])));
      return json(res, 404, { error: 'Not found' });
    } catch (error) {
      json(res, error.status || 500, { error: error.status ? error.message : 'The server could not complete that action' });
      if (!error.status) log('admin error', error);
    }
  });
  server.listen(port, '127.0.0.1', () => log(`Server controls: http://localhost:${port}/ (this computer only)`));
};
