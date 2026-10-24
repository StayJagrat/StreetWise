import { createPersistence, loadLocalEnv } from '../relay/supabase.mjs';
loadLocalEnv();
try {
  const store = createPersistence();
  if (!store) throw new Error('Supabase is not configured. Copy root .env.server.example to .env.server.local.');
  await store.health();
  console.log('Supabase connection and walk schema are ready. No keys or user records were printed.');
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
