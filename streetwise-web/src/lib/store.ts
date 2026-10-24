import { useEffect, useState, useSyncExternalStore } from 'react';
import { Room, type LinkStatus, type Role } from './transport';
import type { AgentName, DemoData, Envelope, LngLat, Msg, Place, Thresholds } from './types';

// Every screen rebuilds the same WalkState from the message stream,
// so the walker, guardian, shop and control room always agree.

export type Phase = 'preview' | 'walking' | 'checkin' | 'escalated' | 'arrived';

export interface LogEntry {
  id: string;
  ts: number;
  agent: AgentName;
  to?: string;
  text: string;
  reason: string;
}

export interface TimelineEvent {
  ts: number;
  kind: 'start' | 'place' | 'stop' | 'checkin' | 'fine' | 'alert' | 'ack' | 'arrive';
  label: string;
}

export interface WalkState {
  phase: Phase;
  plan?: Extract<Msg, { type: 'walk.plan' }>['plan'];
  choice?: 'streetwise' | 'usual';
  replay: boolean;
  startedAt?: number;
  position?: { lngLat: LngLat; heading: number; progress: number; ts: number };
  trail: LngLat[];
  say?: { agent: AgentName; text: string; ts: number };
  checkin?: { text: string; reason: string; deadline: number; windowSec: number; ts: number };
  lastReply?: { reply: 'fine' | 'help'; via: 'voice' | 'tap'; ts: number };
  alert?: { reason: string; lngLat: LngLat; where: string; ts: number; ackBy?: string; ackTs?: number };
  places: Record<string, Partial<Place>>;
  brightened: Record<string, number>;
  log: LogEntry[];
  events: TimelineEvent[];
  guardianJoined?: string;
  audit?: { ranking: { street: string; minutes: number }[]; draft311: string; ts: number };
  summary?: string;
  engineFrom?: Role;
}

export const initialState = (): WalkState => ({
  phase: 'preview',
  replay: true,
  trail: [],
  places: {},
  brightened: {},
  log: [],
  events: [],
});

function push<T>(arr: T[], item: T, max = 400): T[] {
  const next = arr.length >= max ? arr.slice(arr.length - max + 1) : arr.slice();
  next.push(item);
  return next;
}

export function reduce(s: WalkState, e: Envelope): WalkState {
  const m = e.msg;
  const ts = e.ts;
  switch (m.type) {
    case 'walk.reset':
      return { ...initialState(), places: s.places, brightened: s.brightened, log: s.log, guardianJoined: s.guardianJoined };
    case 'walk.plan':
      return { ...s, plan: m.plan };
    case 'walk.accept':
      return { ...s, choice: m.choice };
    case 'walk.start':
      return { ...initialState(), plan: s.plan, choice: s.choice ?? 'streetwise', places: s.places, brightened: s.brightened, log: s.log, guardianJoined: s.guardianJoined, phase: 'walking', replay: m.replay, startedAt: ts, engineFrom: e.from, events: [{ ts, kind: 'start', label: 'Left BART' }] };
    case 'walk.position': {
      const last = s.trail[s.trail.length - 1];
      const moved = !last || Math.abs(last[0] - m.lngLat[0]) + Math.abs(last[1] - m.lngLat[1]) > 0.00003;
      return { ...s, position: { lngLat: m.lngLat, heading: m.heading, progress: m.progress, ts }, trail: moved ? push(s.trail, m.lngLat, 800) : s.trail, replay: m.replay };
    }
    case 'voice.say':
      return { ...s, say: { agent: m.agent, text: m.text, ts } };
    case 'checkin.ask':
      return { ...s, phase: 'checkin', checkin: { text: m.text, reason: m.reason, deadline: m.deadline, windowSec: m.windowSec, ts }, events: push(s.events, { ts, kind: 'checkin', label: 'Check-in' }) };
    case 'checkin.reply': {
      const back = m.reply === 'fine';
      return {
        ...s,
        lastReply: { reply: m.reply, via: m.via, ts },
        checkin: back ? undefined : s.checkin,
        phase: back && (s.phase === 'checkin' || s.phase === 'escalated') ? 'walking' : s.phase,
        alert: back && s.alert ? { ...s.alert, ackBy: s.alert.ackBy ?? 'walker', ackTs: s.alert.ackTs ?? ts } : s.alert,
        events: push(s.events, { ts, kind: back ? 'fine' : 'alert', label: back ? "I'm fine" : 'Help' }),
      };
    }
    case 'escalate':
      return { ...s, phase: 'escalated', checkin: undefined };
    case 'guardian.alert':
      return { ...s, phase: 'escalated', alert: { reason: m.reason, lngLat: m.lngLat, where: m.where, ts }, events: push(s.events, { ts, kind: 'alert', label: 'Alert' }) };
    case 'guardian.ack':
      return s.alert ? { ...s, alert: { ...s.alert, ackBy: m.by, ackTs: ts }, events: push(s.events, { ts, kind: 'ack', label: 'Guardian on it' }) } : s;
    case 'guardian.join':
      return { ...s, guardianJoined: m.name };
    case 'place.update': {
      const open = m.place.openUntil !== 'closed';
      return {
        ...s,
        places: { ...s.places, [m.place.id]: { ...s.places[m.place.id], ...m.place } },
        brightened: open ? { ...s.brightened, [m.place.id]: ts } : Object.fromEntries(Object.entries(s.brightened).filter(([k]) => k !== m.place.id)),
        events: s.phase === 'preview' ? s.events : push(s.events, { ts, kind: 'place', label: open ? 'Shop stays open' : 'Shop closed' }),
      };
    }
    case 'agent.log':
      return { ...s, log: push(s.log, { id: e.id, ts: m.at ?? ts, agent: m.agent, to: m.to, text: m.text, reason: m.reason }, 200) };
    case 'walk.end':
      return { ...s, phase: 'arrived', summary: m.summary, checkin: undefined, events: push(s.events, { ts, kind: 'arrive', label: 'Home' }) };
    case 'audit.result':
      return { ...s, audit: { ranking: m.ranking, draft311: m.draft311, ts } };
    default:
      return s;
  }
}

// ---------------------------------------------------------------- room store
interface RoomStore {
  room: Room;
  state: WalkState;
  status: LinkStatus;
  listeners: Set<() => void>;
}
const stores = new Map<string, RoomStore>();

export function getRoomStore(walkId: string, role: Role): RoomStore {
  const key = `${walkId}:${role}`;
  let st = stores.get(key);
  if (st) return st;
  const room = new Room(walkId, role);
  const store: RoomStore = { room, state: initialState(), status: room.status, listeners: new Set() };
  room.subscribe((e) => {
    store.state = reduce(store.state, e);
    store.listeners.forEach((f) => f());
  });
  room.onStatus((s) => {
    store.status = s;
    store.listeners.forEach((f) => f());
  });
  stores.set(key, store);
  return store;
}

export function useWalk(walkId: string, role: Role) {
  const store = getRoomStore(walkId, role);
  const subscribe = (f: () => void) => {
    store.listeners.add(f);
    return () => store.listeners.delete(f);
  };
  const state = useSyncExternalStore(subscribe, () => store.state);
  const status = useSyncExternalStore(subscribe, () => store.status);
  return { state, status, room: store.room, send: (m: Msg) => store.room.send(m) };
}

// ---------------------------------------------------------------- demo data
let dataPromise: Promise<DemoData> | null = null;
export function loadDemoData(): Promise<DemoData> {
  if (!dataPromise) dataPromise = fetch('/data/demo-route.json').then((r) => r.json());
  return dataPromise;
}
export function useDemoData(): DemoData | null {
  const [d, setD] = useState<DemoData | null>(null);
  useEffect(() => {
    let alive = true;
    loadDemoData().then((x) => alive && setD(x));
    return () => {
      alive = false;
    };
  }, []);
  return d;
}

export function mergedPlaces(data: DemoData, s: WalkState): Place[] {
  return data.places.map((p) => ({ ...p, ...(s.places[p.id] ?? {}) }) as Place);
}

// ---------------------------------------------------------------- settings
export interface Settings {
  guardianName: string;
  thresholds: Thresholds;
  timeScale: number; // demo replay speed (1 = real time)
  walkerName: string;
}
const DEFAULTS: Settings = {
  guardianName: 'Maya Chen',
  walkerName: 'Arya',
  thresholds: { stopSeconds: 90, replySeconds: 45, escalateSeconds: 90 },
  timeScale: 6,
};
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem('streetwise:settings');
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw), thresholds: { ...DEFAULTS.thresholds, ...(JSON.parse(raw).thresholds ?? {}) } };
  } catch {
    /* storage blocked */
  }
  return DEFAULTS;
}
export function saveSettings(s: Settings) {
  try {
    localStorage.setItem('streetwise:settings', JSON.stringify(s));
  } catch {
    /* storage blocked */
  }
}

export const walkIdFromUrl = (fallback = 'demo') => new URLSearchParams(location.search).get('walk') || fallback;
