import type { Role } from './transport';

export interface WalkAccess {
  id: string;
  mode: 'demo' | 'live';
  expires: number;
  tokens: Partial<Record<Role, string>>;
}

export function currentSession(): WalkAccess | null {
  try {
    const s = JSON.parse(localStorage.getItem('streetwise:session') ?? 'null') as WalkAccess | null;
    return s && s.expires > Date.now() ? s : null;
  } catch { return null; }
}

export async function createSession(profile: { walkerName: string; guardianName: string; walkerPhone?: string; mode: 'demo' | 'live'; consent: boolean; origin?: string; destination?: string }): Promise<WalkAccess> {
  const response = await fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) });
  if (!response.ok) throw new Error('Could not create the walk. Check your connection and try again.');
  const access = await response.json() as WalkAccess;
  localStorage.setItem('streetwise:session', JSON.stringify(access));
  return access;
}

export function tokenFor(walkId: string, role: Role): string {
  const urlToken = new URLSearchParams(location.search).get('token');
  if (urlToken) return urlToken;
  const session = currentSession();
  return session?.id === walkId ? session.tokens[role] ?? '' : '';
}

const invitationCache = new Map<string, Partial<Record<Role, string>>>();
export async function loadInvitations(walkId: string, role: 'walker' | 'room') {
  const response = await fetch(`/api/rooms/${encodeURIComponent(walkId)}/invites?role=${role}`, { headers: { Authorization: `Bearer ${tokenFor(walkId, role)}` } });
  if (!response.ok) return;
  const data = await response.json() as { tokens: Partial<Record<Role, string>> };
  invitationCache.set(walkId, data.tokens);
}

export function sessionLink(walkId: string, role: 'walker' | 'guardian' | 'shop' | 'room') {
  const current = currentSession();
  const ownRole = location.pathname.startsWith('/guardian') ? 'guardian' : location.pathname.startsWith('/shop') ? 'shop' : location.pathname.startsWith('/room') ? 'room' : 'walker';
  const token = invitationCache.get(walkId)?.[role] ?? (current?.id === walkId ? current.tokens[role] : undefined) ?? (role === ownRole ? new URLSearchParams(location.search).get('token') : undefined);
  const path = role === 'guardian' ? `/guardian/${encodeURIComponent(walkId)}` : `/${role === 'walker' ? 'walk' : role}`;
  const query = new URLSearchParams({ walk: walkId });
  if (token) query.set('token', token);
  return `${location.origin}${path}?${query}`;
}

export async function roomRequest<T>(walkId: string, path: string, body: unknown): Promise<T> {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenFor(walkId, 'walker')}` }, body: JSON.stringify(body) });
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { detail?: string };
    throw new Error(error.detail ?? 'The request could not be completed.');
  }
  return response.json() as Promise<T>;
}

export interface AppConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  googleLogin: boolean;
  voice: 'browser';
  reasoning: 'claude' | 'deterministic';
}
export const getConfig = (): Promise<AppConfig> => fetch('/api/config').then(r => {
  if (!r.ok) throw new Error('Connection unavailable');
  return r.json() as Promise<AppConfig>;
});
