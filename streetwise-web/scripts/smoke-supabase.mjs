// Explicit cloud smoke test: writes one labeled synthetic walk, no personal data.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { createRelay } from '../relay/app.mjs';
import { createPersistence, loadLocalEnv } from '../relay/supabase.mjs';

loadLocalEnv();
let relay;
try {
  const store = createPersistence();
  if (!store) throw new Error('Configure the server-only Supabase connection first.');
  const walk = `jp-smoke-${randomUUID()}`;
  const until = async predicate => {
    const end = Date.now() + 20000;
    while (!await predicate()) {
      if (Date.now() > end) throw new Error('Timed out waiting for the hosted persistence check.');
      await delay(50);
    }
  };
  const connect = async role => {
    const socket = new WebSocket(`${relay.url}?walk=${walk}&role=${role}`);
    const received = [];
    socket.on('message', raw => received.push(JSON.parse(raw.toString())));
    await once(socket, 'open');
    await until(() => received.some(e => e.kind === 'history'));
    return { socket, received };
  };
  relay = await createRelay({ store, port: 0 });
  const walker = await connect('walker');
  const guardian = await connect('guardian');
  let sent = 0;
  const send = async (msg, from = 'engine') => {
    const e = { id: `${walk}-${++sent}`, walkId: walk, ts: Date.now(), from, msg };
    walker.socket.send(JSON.stringify(e));
    await until(() => guardian.received.some(x => x.id === e.id));
    return e;
  };
  await send({ type: 'walk.reset' }, 'walker');
  await send({ type: 'walk.accept', choice: 'streetwise' }, 'walker');
  await send({ type: 'walk.start', replay: true });
  await send({ type: 'walk.position', replay: true, lngLat: [-122.40322, 37.78541], heading: 0, speed: 0, progress: 0.5 });
  await send({ type: 'checkin.ask', agent: 'watcher', text: 'Synthetic check-in', reason: 'JP smoke fixture', windowSec: 45, deadline: Date.now() + 45000 });
  const alert = await send({ type: 'guardian.alert', reason: 'Synthetic missed check-in', lngLat: [-122.40322, 37.78541], where: 'Public demo fixture' });
  await until(() => relay.queue.pending.length === 0 && !relay.queue.running);
  assert.equal((await store.append(alert)).inserted, false);
  guardian.socket.send(JSON.stringify({ id: `${walk}-ack`, walkId: walk, ts: Date.now(), from: 'guardian', msg: { type: 'guardian.ack', by: 'Synthetic guardian' } }));
  await until(() => walker.received.some(e => e.id === `${walk}-ack`));
  await until(() => relay.queue.pending.length === 0 && !relay.queue.running);
  let incident = await store.client.from('walk_incidents').select('status,resolved_at').eq('walk_id', walk).single();
  if (incident.error) throw new Error('Could not verify the hosted incident projection.');
  assert.equal(incident.data.status, 'acknowledged');
  assert.equal(incident.data.resolved_at, null);
  await send({ type: 'checkin.reply', reply: 'fine', via: 'tap' }, 'walker');
  await send({ type: 'walk.end', outcome: 'ended', summary: 'JP synthetic smoke test. No real walker or city report.' });
  await until(() => relay.queue.pending.length === 0 && !relay.queue.running);
  await relay.close();
  relay = await createRelay({ store, port: 0 });
  const recovered = await connect('guardian');
  const history = recovered.received[0].envelopes;
  assert.ok(history.some(e => e.msg.type === 'walk.end'));
  assert.ok(!history.some(e => ['walk.position', 'guardian.alert', 'checkin.ask'].includes(e.msg.type)));
  incident = await store.client.from('walk_incidents').select('status').eq('walk_id', walk).single();
  assert.equal(incident.data?.status, 'resolved');
  const drafts = await store.client.from('report_drafts').select('status').eq('walk_id', walk);
  assert.equal(drafts.data?.length, 1);
  assert.equal(drafts.data[0].status, 'draft');
  console.log('PASS: hosted API, ordered writes, duplicate protection, guardian delivery, separate resolution, draft report and restart recovery.');
  console.log(`Synthetic test session: ${walk} (24-hour demo retention).`);
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await relay?.close();
}
