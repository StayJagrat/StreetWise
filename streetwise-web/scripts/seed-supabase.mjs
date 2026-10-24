import { readFile } from 'node:fs/promises';
import { createPersistence, loadLocalEnv } from '../relay/supabase.mjs';
loadLocalEnv();
try {
  const store = createPersistence();
  if (!store) throw new Error('Configure the server-only Supabase environment first.');
  const fixture = JSON.parse(await readFile(new URL('../public/data/demo-route.json', import.meta.url), 'utf8'));
  const rows = fixture.places.map(p => ({
    id: p.id, name: p.name, kind: p.kind, longitude: p.lngLat[0], latitude: p.lngLat[1],
    simulated: true, source: 'demo-route.json',
    evidence: { fixture: true, note: 'Unverified demo role; hours, haven and lighting are not live observations.' },
  }));
  const { error } = await store.client.from('place_catalog').upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
  if (error) throw new Error(`Fixture seed failed (${error.code || 'network'}).`);
  console.log(`Ensured ${rows.length} labeled demo places exist. No walks or personal data were uploaded.`);
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
