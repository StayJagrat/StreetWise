import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import MapView from '../components/MapView';
import { AgentRow, DemoTape, Icon, LinkBadge, Mascot } from '../components/ui';
import { DemoEngine } from '../lib/engine';
import { timeOf } from '../lib/format';
import { loadSettings, mergedPlaces, useDemoData, useWalk, walkIdFromUrl, type LogEntry } from '../lib/store';
import type { MascotState } from '../lib/types';
import './room.css';

// The laptop on stage: map with scores, agent trace, replay timeline, city ranking.

export default function Room() {
  const walkId = walkIdFromUrl();
  const data = useDemoData();
  const settings = useMemo(loadSettings, []);
  const { state, send, status, room } = useWalk(walkId, 'room');
  const [qr, setQr] = useState('');
  const [stretch, setStretch] = useState<string | null>(null);
  const [draft, setDraft] = useState(false);
  const [now, setNow] = useState(Date.now());
  const engine = useRef<DemoEngine | null>(null);
  const feedEnd = useRef<HTMLDivElement>(null);
  const guardianUrl = `${location.origin}/guardian/${walkId}`;

  useEffect(() => {
    QRCode.toDataURL(guardianUrl, { margin: 1, width: 360, color: { dark: '#10141C', light: '#ECE7DC' } }).then(setQr).catch(() => setQr(''));
  }, [guardianUrl]);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearInterval(t);
      engine.current?.dispose();
    };
  }, []);
  useEffect(() => {
    feedEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [state.log.length]);
  // open the "why this street" card on the walker's stretch when a check-in starts
  useEffect(() => {
    if (state.phase === 'checkin' || state.phase === 'escalated') setStretch(data?.dimStretches.find((d) => d.onRoute)?.id ?? null);
  }, [state.phase, data]);

  if (!data) return <div className="screen" data-theme="night" />;

  const walkRunning = state.phase === 'walking' || state.phase === 'checkin' || state.phase === 'escalated';
  // The room only runs the demo itself if no walker phone has planned/started a walk.
  const ensureEngine = () => {
    if (!engine.current) engine.current = new DemoEngine(room, data, settings);
    return engine.current;
  };
  const startDemo = () => {
    const e = ensureEngine();
    const fresh = state.phase !== 'preview' || !state.plan;
    if (state.phase !== 'preview') send({ type: 'walk.reset' });
    if (fresh) e.plan();
    window.setTimeout(() => e.start('streetwise'), fresh ? 700 : 0);
  };
  const runAudit = () => {
    if (!state.plan && !engine.current) ensureEngine();
    send({ type: 'audit.run' });
  };

  const places = mergedPlaces(data, state);
  const sel = data.dimStretches.find((d) => d.id === stretch);
  const ranking = state.audit?.ranking ?? data.darknessDebt;
  const maxMin = Math.max(...ranking.map((r) => r.minutes));
  const puck = state.position && state.phase !== 'preview'
    ? { lngLat: state.position.lngLat, heading: state.position.heading, variant: (state.phase === 'escalated' ? 'alert' : state.phase === 'checkin' ? 'checkin' : 'normal') as 'alert' | 'checkin' | 'normal' }
    : null;

  return (
    <div className="screen room" data-theme="night">
      {/* ---------- sidebar ---------- */}
      <aside className="room__side">
        <div>
          <div className="wordmark" style={{ fontSize: 24 }}>streetwise</div>
          <div className="t-mono">control room</div>
        </div>
        <nav className="room__nav">
          <span className="room__nav-item room__nav-item--on">Live walk {state.alert && !state.alert.ackBy && <b className="room__badge">1 alert</b>}</span>
          <span className="room__nav-item">Agents</span>
          <span className="room__nav-item">City ranking</span>
          <span className="room__nav-item">Overnight audit</span>
        </nav>
        <div className="room__qr card">
          {qr ? <img src={qr} alt={`QR code for ${guardianUrl}`} /> : <div style={{ height: 160 }} />}
          <div>
            <div className="t-headline" style={{ fontSize: 14 }}>Scan to be the guardian</div>
            <div className="t-mono" style={{ wordBreak: 'break-all' }}>{guardianUrl.replace(/^https?:\/\//, '')}</div>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <button type="button" className="room__action" onClick={startDemo} disabled={walkRunning}>
          <Icon name="play" size={16} /> {walkRunning ? 'Walk in progress' : 'Start demo walk here'}
        </button>
        <button type="button" className="room__action" onClick={runAudit}>
          <Icon name="moon" size={16} /> Run overnight audit
        </button>
        <div className="room__det card">
          <div>
            <div className="t-headline" style={{ fontSize: 13 }}>Deterministic mode</div>
            <div className="t-caption" style={{ fontSize: 11 }}>cached data · no Wi-Fi needed</div>
          </div>
          <LinkBadge status={status} />
        </div>
        <DemoTape />
        <div className="t-mono" style={{ fontSize: 10 }}>OSM · SF 311 streetlights · place hours</div>
      </aside>

      {/* ---------- map ---------- */}
      <main className="room__map">
        <MapView
          theme="night"
          data={data}
          choice={state.choice}
          places={places}
          showSegments
          brightened={Object.keys(state.brightened)}
          puck={puck}
          progress={state.position?.progress ?? 0}
          camera="fit"
          padding={{ top: 120, bottom: 110, left: 60, right: 380 }}
          onStretchClick={(id) => setStretch(id)}
        />
        <header className="room__header">
          <div>
            <h1 className="t-title" style={{ fontSize: 20 }}>{data.scenario.label} scenario</h1>
            <div className="t-caption" style={{ fontSize: 12 }}>{data.scenario.area} · {data.scenario.segmentsScored.toLocaleString()} street segments scored</div>
          </div>
          <div className="room__pills">
            <span className="chip t-mono"><span className="dot" /> Elastic</span>
            <span className="chip t-mono"><span className="dot" /> Apify · {data.places.length} places</span>
            <span className="chip t-mono"><span className="dot" style={{ background: 'var(--route)' }} /> 5 agents</span>
          </div>
        </header>

        <div className="room__cards">
          {sel ? (
            <section className="card why" aria-label="Why this street">
              <div className="why__head">
                <div>
                  <div className="t-number muted" style={{ fontSize: 12, letterSpacing: 1.2 }}>WHY THIS STREET</div>
                  <div className="t-headline">{sel.name}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="t-number" style={{ fontSize: 28, lineHeight: '28px' }}>{sel.score}</div>
                  <Confidence level={sel.confidence} />
                </div>
              </div>
              <div className="why__sect"><span>Lamp evidence</span><p>{sel.lampEvidence}</p><em className="t-mono">{sel.lampSource}</em></div>
              <div className="why__sect"><span>Open places after 11 PM</span><p>{sel.openPlaces}</p><em className="t-mono">{sel.openSource}</em> <span className="tag-sim">Simulated</span></div>
              <div className="why__say"><Mascot agent="reporter" state="talking" size={28} /><p>{sel.why}</p></div>
              <button type="button" className="why__close" onClick={() => setStretch(null)} aria-label="Close">×</button>
            </section>
          ) : (
            <section className="card why why--hint">
              <Icon name="moon" size={16} /> Tap a dashed stretch to see why it scores low.
            </section>
          )}
          <section className="card debt" aria-label="Darkness debt">
            <div className="debt__head">
              <Mascot agent="auditor" state={state.audit ? 'done' : 'idle'} size={34} />
              <div>
                <div className="t-headline" style={{ fontSize: 14 }}>Darkness debt · {state.audit ? 'just now' : 'last night'}</div>
                <div className="t-caption" style={{ fontSize: 11 }}>walker-minutes spent on streets with fewer lights</div>
              </div>
            </div>
            {ranking.map((r) => (
              <div key={r.street} className="debt__row">
                <div><span>{r.street}</span><span className="t-mono">{r.minutes} min</span></div>
                <i><b style={{ width: `${(r.minutes / maxMin) * 100}%` }} /></i>
              </div>
            ))}
            <button type="button" className="debt__btn" onClick={() => setDraft(true)}>Draft 311 report (not sent)</button>
          </section>
        </div>
        <div className="room__legend card">
          <div>Brighter + wider = more light &amp; open places</div>
          <div className="muted">Dashed = low confidence · never a crime heatmap</div>
        </div>

        <Timeline state={state} now={now} />
      </main>

      {/* ---------- feed ---------- */}
      <aside className="room__feed">
        <header className="room__feed-head">
          <h2 className="t-title" style={{ fontSize: 20 }}>Agent feed</h2>
          <span className="dot dot--live" />
          <span className="t-mono" style={{ marginLeft: 'auto' }}>Agentverse · Chat Protocol</span>
        </header>
        <div className="room__feed-list">
          {state.log.length === 0 && (
            <div className="room__empty">
              <Mascot agent="watcher" state="idle" size={72} />
              <p className="t-caption">Waiting for the night shift. Open <b>/walk</b> on the walker phone, or press <b>Start demo walk here</b>.</p>
            </div>
          )}
          {state.log.map((e, i) => (
            <AgentRow key={e.id} agent={e.agent} state={moodOf(e, i === state.log.length - 1)} to={e.to} ts={e.ts} text={e.text} reason={e.reason} />
          ))}
          <div ref={feedEnd} />
        </div>
      </aside>

      {draft && (
        <div className="g-modal" onClick={() => setDraft(false)} role="dialog" aria-label="Draft 311 report">
          <div className="g-modal__card" onClick={(e) => e.stopPropagation()} style={{ borderRadius: 24, marginBottom: 40 }}>
            <h2 className="t-title">Draft 311 report</h2>
            <p style={{ margin: 0 }}>{state.audit?.draft311 ?? `DRAFT — not submitted. Streetlight outages along ${ranking[0].street}; ${ranking[0].minutes} walker-minutes in the dark last night. Cites the open SF 311 streetlight reports on this block (case IDs from DataSF).`}</p>
            <p className="t-caption" style={{ margin: 0 }}>Reports stay drafts for human review. Streetwise never files with the city on its own.</p>
            <button type="button" className="btn btn--secondary" onClick={() => setDraft(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

function moodOf(e: LogEntry, latest: boolean): MascotState {
  if (e.text.trim().endsWith('?')) return 'thinking';
  if (/^(Re-scored|Ranked|Evidence filed|Check-in cleared)/.test(e.text)) return 'done';
  return latest ? 'talking' : 'idle';
}

function Confidence({ level }: { level: 'low' | 'medium' | 'high' }) {
  const n = level === 'high' ? 3 : level === 'medium' ? 2 : 1;
  return (
    <span className="conf" aria-label={`${level} confidence`}>
      {[0, 1, 2].map((i) => <i key={i} className={i < n ? 'on' : ''} />)} {level} conf.
    </span>
  );
}

function Timeline({ state, now }: { state: ReturnType<typeof useWalk>['state']; now: number }) {
  const start = state.startedAt;
  const end = state.phase === 'arrived' ? state.events[state.events.length - 1]?.ts ?? now : now;
  const span = start ? Math.max(1, end - start) : 1;
  const pos = (ts: number) => (start ? Math.min(1, Math.max(0, (ts - start) / span)) : 0);
  const colorOf = (k: string) => (k === 'alert' ? 'var(--alert)' : k === 'checkin' ? 'var(--checkin)' : k === 'place' || k === 'fine' || k === 'ack' ? 'var(--open)' : 'var(--route)');
  return (
    <footer className="timeline">
      <div className="timeline__play"><Icon name={state.phase === 'walking' ? 'pause' : 'play'} size={16} /></div>
      <div className="timeline__label">
        <div className="t-number" style={{ fontSize: 15, letterSpacing: 1 }}>{state.replay ? 'REPLAY' : 'LIVE'} · {timeOf(now, true)}</div>
        <div className="t-caption" style={{ fontSize: 11 }}>{state.replay ? 'Demo walk · GPS replay with an injected stop' : 'Live GPS from the walker phone'}</div>
      </div>
      <div className="timeline__track">
        <div className="timeline__base" />
        <div className="timeline__done" style={{ transform: `scaleX(${start ? 1 : 0})` }} />
        {state.events.map((ev, i) => {
          const x = pos(ev.ts) * 100;
          const up = i % 2 === 1;
          return (
            <div key={`${ev.ts}-${i}`} className="timeline__stop" style={{ left: `${x}%` }}>
              <span className="timeline__dot" style={{ background: colorOf(ev.kind) }} />
              <span className={`timeline__txt${up ? ' timeline__txt--up' : ''}`}><b>{ev.label}</b><em className="t-mono">{timeOf(ev.ts, true).slice(0, 5)}</em></span>
            </div>
          );
        })}
      </div>
      <div className="timeline__foot t-caption">Agent messages, voice turns and guardian events are logged with a reason (agent_log).</div>
    </footer>
  );
}
