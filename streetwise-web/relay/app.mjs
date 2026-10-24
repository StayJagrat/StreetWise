// Development demo relay. Real walks require the authenticated gateway.
// Supabase storage is optional; the existing Envelope/history wire format stays.
import { WebSocketServer } from 'ws';
import http from 'node:http';
import { updateHistory } from './history.mjs';
import { clientRoles, validWalkId, validateEnvelope } from './validate.mjs';
import { PersistenceQueue } from './supabase.mjs';

export async function createRelay({ store = null, port = 8787, host = '127.0.0.1', logger = console } = {}) {
  if (store) await store.health();
  const rooms = new Map();
  const queue = store ? new PersistenceQueue(store) : null;
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      const persistence = queue ? queue.state : 'unconfigured';
      res.writeHead(persistence === 'overflow' || persistence === 'degraded' ? 503 : 200, {
        'content-type': 'application/json', 'cache-control': 'no-store',
      });
      res.end(JSON.stringify({
        ok: !queue || persistence === 'ready', mode: 'demo',
        storage: store ? 'supabase' : 'memory', persistence,
        pendingWrites: queue?.pending.length ?? 0, rooms: rooms.size,
      }));
      return;
    }
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

  function getRoom(walk) {
    let room = rooms.get(walk);
    if (room) return room;
    room = { clients: new Set(), history: [], seen: new Set(), chain: Promise.resolve(), recoveryFailed: false, ended: false };
    room.ready = (store ? store.history(walk) : Promise.resolve([])).then(history => {
      room.history = history;
      room.ended = history.some(e => e.msg.type === 'walk.end');
      for (const e of history) room.seen.add(e.id);
    }).catch(() => {
      room.recoveryFailed = true;
      logger.warn('[relay] History recovery unavailable; this room was not opened.');
    });
    rooms.set(walk, room);
    return room;
  }

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const walk = url.searchParams.get('walk') || 'demo';
    const role = url.searchParams.get('role');
    if (!validWalkId(walk) || !clientRoles.includes(role)) { ws.close(1008, 'Invalid demo room or role'); return; }
    const room = getRoom(walk);
    room.chain = room.chain.then(async () => {
      await room.ready;
      if (room.recoveryFailed) { rooms.delete(walk); ws.close(1013, 'History recovery unavailable'); return; }
      if (ws.readyState !== 1) return;
      room.clients.add(ws);
      ws.send(JSON.stringify({ kind: 'history', envelopes: room.history }));
    });

    ws.on('message', buf => {
      let env;
      try { env = JSON.parse(buf.toString()); } catch { ws.close(1008, 'Invalid envelope'); return; }
      if (!validateEnvelope(env, walk, role)) { ws.close(1008, 'Invalid demo envelope'); return; }
      room.chain = room.chain.then(async () => {
        await room.ready;
        if (room.recoveryFailed || ws.readyState !== 1 || room.seen.has(env.id)) return;
        if (room.ended && ['walk.start', 'walk.position', 'checkin.ask', 'escalate', 'guardian.alert'].includes(env.msg.type)) {
          ws.close(1008, 'Walk ended; reset before starting another demo');
          return;
        }
        if (env.msg.type === 'walk.reset') room.ended = false;
        if (env.msg.type === 'walk.end') room.ended = true;
        room.seen.add(env.id);
        if (room.seen.size > 10000) room.seen.delete(room.seen.values().next().value);
        room.history = updateHistory(room.history, env);
        const raw = JSON.stringify(env);
        // A database timeout must never block an alert to an already joined phone.
        for (const peer of room.clients) if (peer !== ws && peer.readyState === 1) peer.send(raw);
        if (queue && !queue.enqueue(env)) logger.warn('[relay] Persistence queue full; delivery continues, storage is degraded.');
      }).catch(() => logger.warn('[relay] A demo message could not be processed.'));
    });
    ws.on('close', () => room.clients.delete(ws));
    ws.on('error', () => room.clients.delete(ws));
  });

  const cleanup = store ? setInterval(() => {
    void store.cleanup().catch(() => logger.warn('[relay] Demo retention cleanup will retry later.'));
  }, 60 * 60 * 1000) : null;
  cleanup?.unref();
  await new Promise((done, fail) => { server.once('error', fail); server.listen(port, host, done); });
  return {
    server, queue, rooms,
    url: `ws://${host}:${server.address().port}/ws`,
    async close() {
      if (cleanup) clearInterval(cleanup);
      queue?.close();
      for (const client of wss.clients) client.terminate();
      await new Promise(done => wss.close(done));
      await new Promise(done => server.close(done));
    },
  };
}
