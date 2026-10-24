import type { DemoData, LngLat, Thresholds } from './types';

// Two independent switches (URL first, then build env, then the production default):
//   ?agents=live|demo  live = the gateway's agents drive the walk; demo = the local DemoEngine plays them from cached data
//   ?gps=real|replay   real = the phone's GPS; replay = positions replayed along the route (badged "DEMO · GPS REPLAY")
// The stage demo indoors is ?gps=replay with live agents: real agents answering a replayed walk.

const query = () => new URLSearchParams(location.search);

export type AgentsMode = 'live' | 'demo';
export type GpsMode = 'real' | 'replay';

export function agentsMode(): AgentsMode {
  const q = query();
  const v = q.get('agents') ?? (q.get('engine') === 'off' ? 'live' : q.get('engine') === 'on' ? 'demo' : null) ?? (import.meta.env.VITE_AGENTS as string | undefined);
  return v === 'demo' ? 'demo' : 'live';
}

export function gpsMode(): GpsMode {
  const v = query().get('gps') ?? (import.meta.env.VITE_GPS as string | undefined);
  return v === 'replay' ? 'replay' : 'real';
}

export const isLive = () => agentsMode() === 'live';

/** Carry ?agents / ?gps / ?admin to the next screen. */
export function withFlags(path: string): string {
  const keep = new URLSearchParams();
  for (const k of ['agents', 'gps', 'engine']) { const v = query().get(k); if (v) keep.set(k, v); }
  if (![...keep.keys()].length) return path;
  return `${path}${path.includes('?') ? '&' : '?'}${keep}`;
}

// ---------------------------------------------------------------- credentials
// The walker's phone holds the walk's walker token; the control room may hold an admin token.
interface WalkCreds { token: string; guardianUrl: string; created: number }

export function saveWalkCreds(walkId: string, creds: WalkCreds) {
  try {
    localStorage.setItem(`streetwise:walk:${walkId}`, JSON.stringify(creds));
    localStorage.setItem('streetwise:lastWalk', walkId);
  } catch {
    /* storage blocked */
  }
}
export function walkCreds(walkId: string): WalkCreds | null {
  try {
    const raw = localStorage.getItem(`streetwise:walk:${walkId}`);
    return raw ? (JSON.parse(raw) as WalkCreds) : null;
  } catch {
    return null;
  }
}
export function lastWalkId(): string | null {
  try {
    return localStorage.getItem('streetwise:lastWalk');
  } catch {
    return null;
  }
}
export function adminToken(): string {
  const q = query().get('admin');
  try {
    if (q) localStorage.setItem('streetwise:admin', q);
    return q ?? localStorage.getItem('streetwise:admin') ?? '';
  } catch {
    return q ?? '';
  }
}

// ---------------------------------------------------------------- REST
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(adminToken() ? { 'X-Admin-Token': adminToken() } : {}), ...(init?.headers ?? {}) } });
  } catch {
    throw new Error('Cannot reach Streetwise. Check your connection and try again.');
  }
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { detail?: string | { msg: string }[] };
    const detail = Array.isArray(body.detail) ? body.detail.map((d) => d.msg).join(' ') : body.detail;
    throw new Error(detail ?? `Streetwise answered ${r.status}.`);
  }
  return r.json() as Promise<T>;
}

export interface Spot { name: string; lngLat: LngLat }
const point = (s: Spot) => ({ lat: s.lngLat[1], lon: s.lngLat[0], name: s.name });

export type Plan = DemoData & { planId: string };

export function createPlan(from: Spot, to: Spot, when: { day: number; minute: number } | null, signal?: AbortSignal) {
  return call<Plan>('/api/plans', { method: 'POST', signal, body: JSON.stringify({ origin: point(from), destination: point(to), day: when?.day ?? null, minute: when?.minute ?? null }) });
}

export interface NewWalk { walkId: string; walkerToken: string; guardianUrl: string; walkPath: string; sms: boolean }

export async function createWalk(p: {
  planId?: string; from: Spot; to: Spot; when: { day: number; minute: number } | null; choice: 'streetwise' | 'usual';
  walker: string; guardian: string; guardianPhone?: string; thresholds: Thresholds; replay: boolean; timeScale: number;
}): Promise<NewWalk> {
  const w = await call<NewWalk>('/api/walks', {
    method: 'POST',
    body: JSON.stringify({
      planId: p.planId, origin: point(p.from), destination: point(p.to), day: p.when?.day ?? null, minute: p.when?.minute ?? null, choice: p.choice,
      walker: p.walker || 'Walker', guardian: p.guardian || 'Guardian', guardianPhone: p.guardianPhone || null, thresholds: p.thresholds, replay: p.replay, timeScale: p.timeScale,
    }),
  });
  saveWalkCreds(w.walkId, { token: w.walkerToken, guardianUrl: w.guardianUrl, created: Date.now() });
  return w;
}

export interface WalkSummary { id: string; status: string; walker_name: string; guardian_name: string; created_at: number; replay: boolean }
export const listWalks = (active = true) => call<WalkSummary[]>(`/api/walks?active=${active}&limit=10`);

export interface PlaceInfo {
  id: string; name: string; cat: string; lngLat: LngLat; listedHours: string | null; hoursSource: string | null;
  declaration: { openUntil: string; safeHaven: boolean; frontLight: boolean; updatedAt: number } | null; walksNearby: number;
}
export const placeInfo = (id: string) => call<PlaceInfo>(`/api/places/${encodeURIComponent(id)}`);
export const declareHours = (id: string, d: { openUntil: string; safeHaven: boolean; frontLight: boolean }) =>
  call<{ ok: boolean; walksNotified: number }>(`/api/places/${encodeURIComponent(id)}/declaration`, { method: 'POST', body: JSON.stringify(d) });

export interface Health { ok: boolean; tts: 'cartesia' | 'device'; sms: boolean; runtime: string }
export const health = () => call<Health>('/api/health');
