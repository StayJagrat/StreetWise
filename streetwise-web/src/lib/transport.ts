import type { Envelope, Msg } from './types';
import { tokenFor } from './session';

export type Role = Envelope['from'];
export type LinkStatus = 'connecting' | 'online' | 'local' | 'blocked';
type Listener = (e: Envelope) => void;
const uid = () => crypto.randomUUID();

export class Room {
  readonly walkId: string;
  readonly role: Role;
  status: LinkStatus = 'connecting';
  error = '';
  private ws?: WebSocket;
  private bc?: BroadcastChannel;
  private seen = new Set<string>();
  private listeners = new Set<Listener>();
  private resets = new Set<() => void>();
  private statusListeners = new Set<(s: LinkStatus) => void>();
  private retry = 0;
  private closed = false;
  private outbox: string[] = [];
  private local = new URLSearchParams(location.search).get('engine') === 'local';

  constructor(walkId: string, role: Role) {
    this.walkId = walkId;
    this.role = role;
    if (this.local) {
      if ('BroadcastChannel' in window) {
        this.bc = new BroadcastChannel(`streetwise:${walkId}`);
        this.bc.onmessage = ev => this.receive(ev.data as Envelope);
      }
      this.status = 'local';
    } else this.connect();
  }

  private setStatus(s: LinkStatus) {
    this.status = s;
    this.statusListeners.forEach(f => f(s));
  }

  private connect() {
    if (this.closed) return;
    const token = tokenFor(this.walkId, this.role);
    if (!token) {
      this.error = 'This walk link is missing or expired. Start a new walk or ask the walker for a fresh link.';
      this.setStatus('blocked');
      return;
    }
    const base = import.meta.env.VITE_GATEWAY_URL || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    const query = new URLSearchParams({ walk: this.walkId, role: this.role, token });
    const ws = new WebSocket(`${base}${base.includes('?') ? '&' : '?'}${query}`);
    this.ws = ws;
    ws.onmessage = ev => {
      try {
        const data = JSON.parse(ev.data);
        if (data.kind === 'history') {
          this.seen.clear();
          this.resets.forEach(f => f());
          if (data.profile) this.receive({ id: uid(), walkId: this.walkId, ts: Date.now(), from: 'gateway', msg: { type: 'session.info', mode: data.mode, profile: data.profile } });
          data.envelopes.forEach((e: Envelope) => this.receive(e));
          this.error = '';
          this.retry = 0;
          this.setStatus('online');
          this.outbox.splice(0).forEach(m => ws.send(m));
        } else if (data.kind === 'error') {
          this.error = data.message;
          this.receive({ id: uid(), walkId: this.walkId, ts: Date.now(), from: 'gateway', msg: { type: 'gateway.error', message: data.message } });
          this.statusListeners.forEach(f => f(this.status));
        } else this.receive(data as Envelope);
      } catch { /* malformed server message is ignored */ }
    };
    ws.onclose = ev => {
      if (this.closed) return;
      if (ev.code === 4403) {
        this.error = 'This walk link is invalid or expired. Ask for a new link.';
        this.setStatus('blocked');
        return;
      }
      this.error = 'Connection lost. Guardian updates cannot be delivered until the connection returns.';
      this.setStatus('local');
      window.setTimeout(() => this.connect(), Math.min(15000, 1000 * 2 ** this.retry++));
    };
    ws.onerror = () => ws.close();
  }

  private receive(e: Envelope) {
    if (!e?.id || e.walkId !== this.walkId || this.seen.has(e.id)) return;
    this.seen.add(e.id);
    if (this.seen.size > 4000) this.seen = new Set([e.id]);
    this.listeners.forEach(f => f(e));
  }

  send<M extends Msg>(msg: M, from: Role = this.role): Envelope<M> {
    const env: Envelope<M> = { id: uid(), walkId: this.walkId, ts: Date.now(), from, msg };
    if (this.local) {
      this.receive(env);
      this.bc?.postMessage(env);
      return env;
    }
    const raw = JSON.stringify(env);
    if (this.ws?.readyState === WebSocket.OPEN && this.status === 'online') this.ws.send(raw);
    else if (this.status !== 'blocked' && msg.type !== 'walk.position') {
      this.outbox = [...this.outbox.slice(-19), raw];
    }
    return env;
  }
  onReset(f: () => void) { this.resets.add(f); return () => { this.resets.delete(f); }; }
  subscribe(f: Listener) { this.listeners.add(f); return () => { this.listeners.delete(f); }; }
  onStatus(f: (s: LinkStatus) => void) { this.statusListeners.add(f); return () => { this.statusListeners.delete(f); }; }
  close() { this.closed = true; this.ws?.close(); this.bc?.close(); }
}
