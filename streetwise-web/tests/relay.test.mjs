import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { createRelay } from '../relay/app.mjs';
import { PersistenceQueue, createPersistence } from '../relay/supabase.mjs';
import { validateEnvelope } from '../relay/validate.mjs';

let id = 0;
const envelope = (msg, from = 'engine', walkId = 'demo') => ({ id: `test-${++id}`, walkId, ts: Date.now(), from, msg });
const position = replay => ({ type: 'walk.position', lngLat: [-122.4, 37.78], heading: 0, speed: 1, progress: 0.5, replay });
async function connect(relay, role, walk = 'demo') {
  const ws = new WebSocket(`${relay.url}?walk=${walk}&role=${role}`);
  const messages = [];
  ws.on('message', raw => messages.push(JSON.parse(raw.toString())));
  await once(ws, 'open');
  await until(() => messages.some(m => m.kind === 'history'));
  return { ws, messages };
}
async function until(predicate, timeout = 2500) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for expected relay state');
    await delay(10);
  }
}
const quiet = { warn() {} };

test('demo relay delivers once across sockets, isolates rooms and redacts ended history', async t => {
  const relay = await createRelay({ port: 0, logger: quiet });
  t.after(() => relay.close());
  const walker = await connect(relay, 'walker');
  const guardian = await connect(relay, 'guardian');
  const other = await connect(relay, 'guardian', 'other-walk');
  const e = envelope(position(true));
  walker.ws.send(JSON.stringify(e));
  walker.ws.send(JSON.stringify(e));
  await until(() => guardian.messages.some(m => m.id === e.id));
  await delay(20);
  assert.equal(guardian.messages.filter(m => m.id === e.id).length, 1);
  assert.equal(other.messages.length, 1);
  walker.ws.send(JSON.stringify(envelope({ type: 'walk.end', outcome: 'arrived', summary: 'Demo ended.' })));
  const endedId = id;
  await until(() => guardian.messages.some(m => m.id === `test-${endedId}`));
  const late = await connect(relay, 'guardian');
  const history = late.messages.find(m => m.kind === 'history').envelopes;
  assert.ok(!history.some(m => m.msg.type === 'walk.position'));
  assert.ok(history.some(m => m.msg.type === 'walk.end'));
  const closed = once(walker.ws, 'close');
  walker.ws.send(JSON.stringify(envelope(position(true))));
  assert.equal((await closed)[0], 1008);
});

test('recovered history is delivered before new messages and writes do not hold alerts', async t => {
  let finishRecovery;
  let finishWrite;
  const old = envelope({ type: 'walk.start', replay: true });
  const store = {
    async health() {},
    history: () => new Promise(resolve => { finishRecovery = resolve; }),
    append: () => new Promise(resolve => { finishWrite = resolve; }),
    async cleanup() {},
  };
  const relay = await createRelay({ store, port: 0, logger: quiet });
  t.after(() => { finishWrite?.(); return relay.close(); });
  const walker = new WebSocket(`${relay.url}?walk=demo&role=walker`);
  await once(walker, 'open');
  const next = envelope({ type: 'guardian.alert', reason: 'Demo silence', lngLat: [-122.4, 37.78], where: 'Demo block' });
  walker.send(JSON.stringify(next));
  finishRecovery([old]);
  const guardian = await connect(relay, 'guardian');
  const history = guardian.messages[0].envelopes;
  assert.deepEqual(history.map(m => m.id), [old.id, next.id]);
  assert.equal(relay.queue.pending.length, 1);
  assert.ok(finishWrite, 'database write is still pending while guardian already has alert');
});

test('invalid payloads, forged roles and real GPS are refused', async t => {
  assert.equal(validateEnvelope(envelope(position(false), 'walker'), 'demo', 'walker'), false);
  assert.equal(validateEnvelope(envelope({ type: 'guardian.ack', by: 'Demo' }, 'guardian'), 'demo', 'shop'), false);
  assert.equal(validateEnvelope(envelope({ type: 'guardian.alert', reason: 'x', where: 'x', lngLat: [999, 1] }), 'demo', 'walker'), false);
  const relay = await createRelay({ port: 0, logger: quiet });
  t.after(() => relay.close());
  const guardian = await connect(relay, 'guardian');
  const closed = once(guardian.ws, 'close');
  guardian.ws.send(JSON.stringify(envelope({ type: 'walk.reset' }, 'guardian')));
  assert.equal((await closed)[0], 1008);
});

test('history recovery failure closes the connection instead of fabricating empty state', async t => {
  const relay = await createRelay({ port: 0, logger: quiet, store: {
    async health() {}, async history() { throw new Error('offline'); }, async append() {}, async cleanup() {},
  } });
  t.after(() => relay.close());
  const ws = new WebSocket(`${relay.url}?walk=demo&role=guardian`);
  const closed = once(ws, 'close');
  assert.equal((await closed)[0], 1013);
});

test('failed persistence retries in order and bounds its backlog', async t => {
  let failures = 1;
  const saved = [];
  const queue = new PersistenceQueue({ async append(e) {
    if (failures-- > 0) throw new Error('offline');
    saved.push(e.id);
  } }, { retryMs: 10, maxPending: 2 });
  t.after(() => queue.close());
  assert.equal(queue.enqueue({ id: 'one' }), true);
  assert.equal(queue.enqueue({ id: 'two' }), true);
  assert.equal(queue.enqueue({ id: 'three' }), false);
  await until(() => saved.length === 2);
  assert.deepEqual(saved, ['one', 'two']);
  assert.equal(queue.state, 'overflow');
});

test('server configuration rejects incomplete/public/browser-exposed credentials', () => {
  assert.equal(createPersistence({}), null);
  assert.throws(() => createPersistence({ SUPABASE_URL: 'https://example.supabase.co' }), /both/);
  assert.throws(() => createPersistence({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'sb_publishable_example' }), /server secret/);
  assert.throws(() => createPersistence({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_example', VITE_SUPABASE_SECRET_KEY: 'should-not-exist' }), /VITE_/);
});
