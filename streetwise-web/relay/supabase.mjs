import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'node:url';

export function loadLocalEnv() {
  // Keep server secrets outside Vite's root and env loading directory.
  for (const file of [fileURLToPath(new URL('../../.env.server.local', import.meta.url))]) {
    try { process.loadEnvFile(file); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
}

export function createPersistence(env = process.env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url && !key) return null;
  if (!url || !key) throw new Error('Set both SUPABASE_URL and a server-only Supabase secret key.');
  if (Object.keys(env).some(k => /^VITE_.*SUPABASE.*(SECRET|SERVICE_ROLE)/.test(k))) throw new Error('Remove server secrets from VITE_ variables.');
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))) {
    throw new Error('Use an HTTPS Supabase project URL, or a local development URL.');
  }
  let validKey = key.startsWith('sb_secret_');
  if (!validKey) {
    try { validKey = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'service_role'; } catch { /* invalid/anon key */ }
  }
  if (!validKey) throw new Error('Use a server secret key or legacy service_role key, never a publishable/anon key.');
  const client = createClient(parsed.origin, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(4000) }) },
  });
  const check = async result => {
    const { data, error } = await result;
    if (error) throw new Error(`Supabase request failed (${error.code || 'network'}).`);
    return data;
  };
  return {
    client,
    async health() { await check(client.from('walk_sessions').select('id').limit(0)); },
    async history(walkId) {
      const row = await check(client.from('walk_sessions').select('history').eq('id', walkId).gt('expires_at', new Date().toISOString()).maybeSingle());
      return row?.history ?? [];
    },
    async append(envelope) { return check(client.rpc('record_walk_event', { p_envelope: envelope })); },
    async cleanup() { return check(client.rpc('purge_expired_demo_walks')); },
  };
}

// Writes run independently of socket delivery. Failed writes retry in order;
// the bounded queue and health state make an outage visible without holding an alert.
export class PersistenceQueue {
  pending = [];
  state = 'ready';
  running = false;
  closed = false;
  timer;
  constructor(store, { retryMs = 3000, maxPending = 2000 } = {}) {
    this.store = store;
    this.retryMs = retryMs;
    this.maxPending = maxPending;
  }
  enqueue(envelope) {
    if (this.closed || this.pending.length >= this.maxPending) {
      this.state = 'overflow';
      return false;
    }
    this.pending.push(envelope);
    void this.drain();
    return true;
  }
  async drain() {
    if (this.running || this.closed || this.timer) return;
    this.running = true;
    while (this.pending.length && !this.closed) {
      try {
        await this.store.append(this.pending[0]);
        this.pending.shift();
        if (this.state !== 'overflow') this.state = 'ready';
      } catch {
        if (this.state !== 'overflow') this.state = 'degraded';
        this.timer = setTimeout(() => { this.timer = undefined; void this.drain(); }, this.retryMs);
        this.timer.unref?.();
        break;
      }
    }
    this.running = false;
  }
  close() {
    this.closed = true;
    clearTimeout(this.timer);
  }
}
