import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRelay } from './app.mjs';
import { createPersistence, loadLocalEnv } from './supabase.mjs';

export { createRelay } from './app.mjs';

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  loadLocalEnv();
  try {
    const store = createPersistence();
    const relay = await createRelay({ store, port: Number(process.env.PORT || 8787) });
    console.log(`[relay] Demo only, ${store ? 'Supabase' : 'in-memory'} storage, listening on ${relay.url}`);
    const shutdown = async () => { await relay.close(); process.exit(0); };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch (e) {
    console.error(`[relay] Startup failed: ${e.message}`);
    process.exitCode = 1;
  }
}
