import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('private PWA snapshots enforce RLS and never overwrite a newer sequence', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    await db.exec(await readFile(new URL('../../supabase/migrations/20261025010000_private_pwa_rooms.sql', import.meta.url), 'utf8'));
    const row = { id:'pwa-database-test-room', sequence:2, expires:Date.now()/1000+3600, capabilities:{ walker:'hash-only' }, history:[] };
    await db.query('select public.save_pwa_room($1::jsonb)',[JSON.stringify(row)]);
    await db.query('select public.save_pwa_room($1::jsonb)',[JSON.stringify({...row, sequence:1})]);
    assert.equal((await db.query('select sequence from public.pwa_rooms')).rows[0].sequence,2);
    const result = await db.query("select relrowsecurity as rls, has_table_privilege('anon','public.pwa_rooms','select') as anon_read, has_function_privilege('anon','public.save_pwa_room(jsonb)','execute') as anon_write from pg_class where oid='public.pwa_rooms'::regclass");
    assert.deepEqual(result.rows[0],{rls:true,anon_read:false,anon_write:false});
  } finally { await db.close(); }
});
