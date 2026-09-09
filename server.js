const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

let WebSocket, WebSocketServer;
try {
  WebSocket = require('ws');
  WebSocketServer = WebSocket.Server;
} catch (e) {
  console.error('\n[ERRO] Biblioteca "ws" nao instalada.');
  console.error('Execute: npm install\n');
  process.exit(1);
}

const PORT = process.env.PORT || 3000;
const STATIC_DIR = __dirname;

function loadUpstreamConfig() {
  const configPath = path.join(__dirname, 'config.js');
  const content = fs.readFileSync(configPath, 'utf8');
  const fn = new Function(content + '\nreturn CONFIG;');
  return fn();
}

const UPSTREAM = loadUpstreamConfig();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const parsed = new URL(req.url, `http://${req.headers.host}`);
  let pathname = parsed.pathname;
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/status') {
    const status = {
      uptime: Math.round(process.uptime()),
      wheel: {
        upstream: !!(upstream.ws && upstream.ws.readyState === WebSocket.OPEN),
        clients: clients.wheel.size,
      },
      double: {
        upstream: !!(downstream.ws && downstream.ws.readyState === WebSocket.OPEN),
        clients: clients.double.size,
      },
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status, null, 2));
    return;
  }
  pathname = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(STATIC_DIR, pathname);
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500);
      res.end(err.code === 'ENOENT' ? '404' : '500');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
const clients = { wheel: new Set(), double: new Set() };
const upstream = { wheel: { ws: null }, double: { ws: null } };

function getUpstreamUrl(game) {
  return game === 'wheel' ? UPSTREAM.wheel.wsUrl : UPSTREAM.double.wsUrl;
}

function connectUpstream(game) {
  const u = upstream[game];
  if (u.ws && (u.ws.readyState === WebSocket.OPEN || u.ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  const url = getUpstreamUrl(game);
  if (!url || url.includes('your-')) {
    console.log(`[Relay] URL do upstream ${game} nao configurada`);
    return;
  }
  console.log(`[Relay] Conectando ao upstream ${game}...`);
  const ws = new WebSocket(url);
  ws.on('open', () => {
    console.log(`[Relay] Upstream ${game} conectado`);
    ws.send('40');
  });
  ws.on('message', (data) => {
    const msg = typeof data === 'string' ? data : data.toString();
    if (!msg) return;
    if (msg === '2') { ws.send('3'); return; }
    if (msg === '3' || msg.startsWith('0')) return;
    for (const c of clients[game]) {
      if (c.readyState === WebSocket.OPEN) {
        try { c.send(msg); } catch (_) {}
      }
    }
  });
  ws.on('close', () => {
    console.log(`[Relay] Upstream ${game} desconectado`);
    u.ws = null;
    if (clients[game].size > 0) {
      setTimeout(() => connectUpstream(game), 3000);
    }
  });
  ws.on('error', (err) => {
    console.error(`[Relay] Erro upstream ${game}:`, err.message);
  });
  u.ws = ws;
}

function disconnectUpstream(game) {
  const u = upstream[game];
  if (u.ws) {
    try { u.ws.close(); } catch (_) {}
    u.ws = null;
  }
}

wss.on('connection', (ws, req) => {
  const parsed = new URL(req.url, `http://${req.headers.host}`);
  const match = parsed.pathname.match(/^\/ws\/(wheel|double)$/);
  if (!match) { ws.close(1008); return; }
  const game = match[1];
  const ip = req.socket.remoteAddress;
  console.log(`[Relay] Cliente conectou em ${game} (${ip})`);
  clients[game].add(ws);
  connectUpstream(game);
  ws.on('close', () => {
    console.log(`[Relay] Cliente desconectou de ${game}`);
    clients[game].delete(ws);
    if (clients[game].size === 0) {
      disconnectUpstream(game);
    }
  });
  ws.on('error', () => {
    clients[game].delete(ws);
    if (clients[game].size === 0) disconnectUpstream(game);
  });
});

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('');
  console.log('================================================');
  console.log('  SERVIDOR RELAY - ROBOTELEGRAM');
  console.log('================================================');
  console.log(`  PC:      http://localhost:${PORT}`);
  console.log(`  Celular: http://${ip}:${PORT}`);
  console.log('------------------------------------------------');
  console.log('  1. Abra no celular: http://' + ip + ':' + PORT);
  console.log('  2. Adicione na tela inicial (PWA)');
  console.log('  3. Ambos na mesma rede WiFi');
  console.log('================================================');
  console.log('');
});

process.on('SIGINT', () => {
  console.log('\n[Relay] Encerrando...');
  for (const g of ['wheel', 'double']) {
    disconnectUpstream(g);
    for (const c of clients[g]) { try { c.close(); } catch (_) {} }
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000);
});
