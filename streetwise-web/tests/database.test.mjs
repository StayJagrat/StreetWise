import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { updateHistory } from '../relay/history.mjs';

const migration = await readFile(new URL('../../supabase/migrations/20261024200000_walk_persistence.sql', import.meta.url), 'utf8');
const seed = await readFile(new URL('../../supabase/seed.sql', import.meta.url), 'utf8');

test('Supabase migration: atomic state, permissions, recovery and retention', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await db.exec(migration);
  await db.exec(seed);
  let nextId = 0;
  const envelope = (msg, from = 'engine', walk = 'test-walk') => ({ id: `event-${++nextId}`, walkId: walk, ts: 1792872000000 + nextId, from, msg });
  const record = async e => (await db.query('select public.record_walk_event($1::jsonb) as result', [JSON.stringify(e)])).rows[0].result;
  const scalar = async sql => Object.values((await db.query(sql)).rows[0])[0];

  await t.test('all six tables enable RLS and anonymous users cannot read or execute', async () => {
    const rows = (await db.query("select relname, relrowsecurity from pg_class join pg_namespace n on n.oid = relnamespace where n.nspname = 'public' and relkind = 'r'")).rows;
    assert.equal(rows.length, 6);
    assert.ok(rows.every(r => r.relrowsecurity));
    await db.exec('set role anon');
    await assert.rejects(db.query('select * from public.walk_sessions'), /permission denied/);
    await assert.rejects(db.query("select public.record_walk_event('{}'::jsonb)"), /permission denied/);
    await db.exec('reset role; set role authenticated');
    await assert.rejects(db.query('select * from public.walk_events'), /permission denied/);
    await db.exec('reset role');
    assert.equal(await scalar('select count(*)::integer from public.place_catalog where simulated'), 4);
    // RLS also denies rows if a later migration accidentally grants SELECT.
    await db.exec('grant select on public.place_catalog to authenticated; set role authenticated');
    assert.equal(await scalar('select count(*)::integer from public.place_catalog'), 0);
    await db.exec('reset role; revoke select on public.place_catalog from authenticated; set role service_role');
  });

  let history = [];
  const send = async (msg, from = 'engine') => {
    const e = envelope(msg, from);
    const result = await record(e);
    history = updateHistory(history, e);
    return { e, result };
  };

  await t.test('service events are ordered, idempotent and transactional', async () => {
    const { e, result } = await send({ type: 'walk.reset' }, 'walker');
    assert.equal(result.generation, 1);
    assert.equal(result.sequence, 1);
    assert.equal((await record(e)).inserted, false);
    await assert.rejects(record({ ...e, msg: { type: 'audit.run' } }), /collision/);
    assert.equal(await scalar("select last_sequence::integer from public.walk_sessions where id = 'test-walk'"), 1);
    await assert.rejects(record(envelope({ type: 'place.update', place: { id: 'missing-fields' } })), /null value/);
    assert.equal(await scalar("select last_sequence::integer from public.walk_sessions where id = 'test-walk'"), 1);
    assert.equal(await scalar('select count(*)::integer from public.walk_events'), 1);
  });

  await t.test('live GPS is refused even through the service RPC', async () => {
    await assert.rejects(record(envelope({ type: 'walk.start', replay: false })), /does not accept live GPS/);
    await assert.rejects(record(envelope({ type: 'walk.position', replay: false, lngLat: [-122.4, 37.78] })), /does not accept live GPS/);
  });

  await t.test('plan, route choice, latest position and shop state survive reconnection', async () => {
    await send({ type: 'guardian.join', name: 'Demo guardian' }, 'guardian');
    await send({ type: 'walk.plan', plan: { routeId: 'route-1', thresholds: { stopSeconds: 90, replySeconds: 45, escalateSeconds: 90 } } });
    await send({ type: 'walk.accept', choice: 'usual' });
    await send({ type: 'walk.start', replay: true });
    await send({ type: 'walk.position', replay: true, lngLat: [-122.4, 37.78], progress: 0.1 });
    await send({ type: 'walk.position', replay: true, lngLat: [-122.401, 37.781], progress: 0.2 });
    await send({ type: 'place.update', place: { id: 'cafe-mia', openUntil: '01:00', safeHaven: true, frontLight: true } }, 'shop');
    const row = (await db.query("select * from public.walk_sessions where id = 'test-walk'")).rows[0];
    assert.equal(row.status, 'walking');
    assert.equal(row.route_id, 'route-1');
    assert.deepEqual(row.history, history);
    assert.equal(row.history.filter(e => e.msg.type === 'walk.position').length, 1);
    assert.ok(row.history.some(e => e.msg.choice === 'usual'));
    assert.equal(await scalar("select open_until from public.walk_place_status where walk_id = 'test-walk'"), '01:00');
  });

  await t.test('guardian acknowledgement leaves an incident unresolved', async () => {
    await send({ type: 'checkin.ask', reason: 'Demo stop', deadline: 1792872045000 });
    await send({ type: 'guardian.alert', reason: 'No reply', lngLat: [-122.401, 37.781], where: 'Demo block' });
    await send({ type: 'guardian.ack', by: 'Demo guardian' }, 'guardian');
    const incident = (await db.query('select * from public.walk_incidents')).rows[0];
    assert.equal(incident.status, 'acknowledged');
    assert.equal(incident.resolved_at, null);
    await send({ type: 'checkin.reply', reply: 'fine', via: 'tap' }, 'walker');
    assert.equal(await scalar('select status from public.walk_incidents'), 'resolved');
  });

  await t.test('end redacts reconnect location and creates draft-only reports', async () => {
    await send({ type: 'walk.end', outcome: 'arrived', summary: 'Demo observation, unverified.' });
    await send({ type: 'audit.result', ranking: [], draft311: 'DRAFT: simulated exposure, not submitted.' });
    const row = (await db.query("select * from public.walk_sessions where id = 'test-walk'")).rows[0];
    assert.equal(row.status, 'ended');
    assert.equal(row.last_position, null);
    assert.deepEqual(row.history, history);
    assert.ok(!row.history.some(e => ['walk.position', 'guardian.alert', 'escalate', 'checkin.ask'].includes(e.msg.type)));
    assert.equal(await scalar("select count(*)::integer from public.report_drafts where status = 'draft'"), 2);
    await assert.rejects(db.exec("update public.report_drafts set status = 'submitted'"), /check constraint/);
    await assert.rejects(record(envelope({ type: 'walk.position', replay: true, lngLat: [-122.4, 37.78] })), /Walk ended/);
  });

  await t.test('reset creates a generation and only carries shop/guardian context', async () => {
    await send({ type: 'walk.reset' }, 'walker');
    const row = (await db.query("select * from public.walk_sessions where id = 'test-walk'")).rows[0];
    assert.equal(row.generation, 2);
    assert.equal(row.status, 'preview');
    assert.deepEqual(row.history, history);
    assert.ok(row.history.every(e => ['place.update', 'guardian.join', 'walk.reset'].includes(e.msg.type)));
    assert.equal(await scalar('select count(*)::integer from public.report_drafts'), 2);
  });

  await t.test('retention deletes only expired demo sessions and their dependent data', async () => {
    await record(envelope({ type: 'audit.run' }, 'room', 'not-expired'));
    await record(envelope({ type: 'audit.run' }, 'room', 'live-record'));
    await db.exec("update public.walk_sessions set expires_at = now() - interval '1 hour' where id in ('test-walk', 'live-record'); update public.walk_sessions set mode = 'live' where id = 'live-record';");
    assert.equal(await scalar('select public.purge_expired_demo_walks()'), 1);
    assert.equal(await scalar("select count(*)::integer from public.walk_events where walk_id = 'test-walk'"), 0);
    assert.equal(await scalar('select count(*)::integer from public.report_drafts'), 0);
    assert.equal(await scalar('select count(*)::integer from public.walk_sessions'), 2);
  });
});
