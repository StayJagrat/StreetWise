import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import WalkTools from '../components/WalkTools';
import MapView from '../components/MapView';
import { Button, DemoTape, HoldButton, Icon, Initials, LinkBadge, Mascot, Sheet, StreetSign } from '../components/ui';
import { DemoEngine } from '../lib/engine';
import { cumulative, lineLength, project, turnsFromSteps } from '../lib/geo';
import { AGENT_LABEL, meters, timeOf } from '../lib/format';
import { getRoomStore, isGatewayMode, loadSettings, mergedPlaces, useDemoData, useWalk, walkIdFromUrl } from '../lib/store';
import { isMuted, setMuted, speak, unlockAudio } from '../lib/voice';
import { keepAwake, vibrate, watchLocation } from '../lib/device';
import './walk.css';

const engineEnabled = () => !isGatewayMode();

export default function Walk() {
  const walkId = walkIdFromUrl();
  const { data: cachedData, error } = useDemoData();
  const settings = useMemo(loadSettings, []);
  const { state, send, status, room } = useWalk(walkId, 'walker');
  const data = state.plan?.data ?? cachedData;
  const prepared = useRef(false);
  const engine = useRef<DemoEngine | null>(null);
  const [muted, setMutedState] = useState(isMuted());
  const [now, setNow] = useState(Date.now());
  const [gpsError, setGpsError] = useState<string | null>(null);
  const nav = useNavigate();
  const guardianFirst = settings.guardianName.split(' ')[0];

  // demo engine: plays the agents from cached data unless ?engine=off (gateway drives)
  useEffect(() => {
    if (!data || !engineEnabled()) return;
    const e = new DemoEngine(room, data, settings);
    engine.current = e;
    // In demo mode the walker phone owns the walk: every load starts a fresh one.
    // Wait for the room link to settle first so relay history can't overwrite the reset.
    // (Also keeps React StrictMode's mount/unmount/mount from planning twice.)
    let cancelled = false;
    const store = getRoomStore(walkId, 'walker');
    (async () => {
      const t0 = Date.now();
      while (store.status === 'connecting' && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 250));
      if (cancelled) return;
      room.send({ type: 'walk.reset' });
      e.plan();
    })();
    return () => {
      cancelled = true;
      e.dispose();
      engine.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => {
    if (engineEnabled() || !cachedData || status !== 'online' || state.plan || prepared.current || state.phase !== 'preview') return;
    prepared.current = true;
    send({ type: 'walk.accept', choice: settings.preferredChoice ?? 'streetwise', guardian: settings.guardianName,
      thresholds: settings.thresholds,
      origin: { lat: cachedData.start.lngLat[1], lon: cachedData.start.lngLat[0] },
      dest: { lat: cachedData.end.lngLat[1], lon: cachedData.end.lngLat[0] },
      day: cachedData.scenario.day ?? 4, minute: cachedData.scenario.departureMinute });
  }, [cachedData, status, state.plan, state.phase, send, settings]);

  // speak every new line
  const lastSaid = useRef(0);
  useEffect(() => {
    if (state.say && state.say.ts > lastSaid.current && state.phase !== 'preview') {
      lastSaid.current = state.say.ts;
      void speak(state.say.text);
    }
  }, [state.say, state.phase]);

  // buzz on check-in
  useEffect(() => {
    if (state.phase === 'checkin') vibrate([80, 60, 80]);
  }, [state.phase]);

  // tick for countdowns and "x s ago"
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, []);

  // live mode: real GPS fixes go to the gateway
  useEffect(() => {
    if (engineEnabled() || !data || state.replay || state.phase === 'preview' || state.phase === 'arrived' || state.phase === 'ended') return;
    const line = state.choice === 'usual' ? data.shortest : data.route;
    const cum = cumulative(line);
    const total = lineLength(line);
    return watchLocation(
      (f) => {
        const pr = project(line, f.lngLat, cum);
        send({ type: 'walk.position', lngLat: f.lngLat, heading: f.heading, speed: f.speed, progress: pr.meters / total, replay: false, fixTime: f.timestamp, accuracy: f.accuracy });
      },
      (msg) => setGpsError(msg),
    );
  }, [data, state.phase, state.choice, state.replay, send]);

  useEffect(() => {
    if (state.replay || state.phase === 'preview' || state.phase === 'arrived' || state.phase === 'ended') return;
    const visibility = () => send({ type: 'tracking.visibility', visible: document.visibilityState === 'visible' });
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  }, [state.replay, state.phase, send]);

  // stop listening/awake when the walk ends
  useEffect(() => {
    if (state.phase === 'arrived' || state.phase === 'ended') {
      void keepAwake(false);
    }
  }, [state.phase]);
  useEffect(() => () => {
    void keepAwake(false);
  }, []);

  const go = (choice: 'streetwise' | 'usual') => {
    if (!data) return;
    unlockAudio(); // the "Walk with me" tap doubles as the audio unlock
    void keepAwake(true);
    if (engine.current) engine.current.start(choice);
    else {
      if (state.choice !== choice) send({
        type: 'walk.accept', choice, guardian: settings.guardianName, thresholds: settings.thresholds,
        origin: { lat: data.start.lngLat[1], lon: data.start.lngLat[0] },
        dest: { lat: data.end.lngLat[1], lon: data.end.lngLat[0] },
        day: data.scenario.day ?? 4, minute: data.scenario.departureMinute,
      });
      send({ type: 'walk.start', replay: state.replay, timeScale: settings.timeScale });
    }
  };

  const reply = (r: 'fine' | 'help') => send({ type: 'checkin.reply', reply: r, via: 'tap' });

  const toggleMute = () => {
    setMuted(!muted);
    setMutedState(!muted);
  };

  const line = data ? (state.choice === 'usual' ? data.shortest : data.route) : [];
  const total = useMemo(() => (line.length ? lineLength(line) : 0), [line]);
  const turnList = useMemo(() => (line.length && data ? turnsFromSteps(data.routeSteps[state.choice === 'usual' ? 'shortest' : 'streetwise'], lineLength(line)) : []), [line, data, state.choice]);

  if (!data) return <div className="screen" data-theme="night" role={error ? 'alert' : undefined} style={{ padding: 24 }}>{error ?? 'Loading route…'}</div>;

  const places = mergedPlaces(data, state);
  const progress = state.position?.progress ?? 0;
  const walked = progress * total;
  const next = turnList.find((t) => t.meters > walked + 3) ?? turnList[turnList.length - 1];
  const toNext = next ? next.meters - walked : 0;
  const remaining = Math.max(0, total - walked);
  const etaMin = remaining / 1.35 / 60;
  const phase = state.phase;
  const plan = state.plan;
  const stats = plan?.stats ?? data.stats;
  const demoClock = new Date(now);
  demoClock.setHours(Math.floor(data.scenario.departureMinute / 60), data.scenario.departureMinute % 60, 0, 0);
  const arrive = state.replay
    ? demoClock.getTime() + (state.choice === 'usual' ? stats.shortest.minutes : stats.streetwise.minutes) * 60000
    : now + etaMin * 60000;
  const brightened = Object.keys(state.brightened);

  const puck = state.position && phase !== 'preview'
    ? { lngLat: state.position.lngLat, heading: state.position.heading, variant: (phase === 'escalated' ? 'alert' : phase === 'checkin' ? 'checkin' : 'normal') as 'alert' | 'checkin' | 'normal' }
    : null;

  return (
    <main id="main-content" className="screen walk" data-theme="night">
      <MapView
        theme="night"
        data={data}
        choice={state.choice}
        places={places}
        showLamps={false}
        showShortest={phase === 'preview'}
        showDimLabel={phase === 'preview'}
        brightened={brightened}
        puck={puck}
        progress={phase === 'preview' ? 0 : progress}
        camera={phase === 'preview' || phase === 'arrived' || phase === 'ended' ? 'overview' : 'follow'}
        padding={phase === 'preview' ? { top: 90, bottom: 430, left: 30, right: 30 } : phase === 'checkin' ? { top: 140, bottom: 470 } : { top: 170, bottom: 380 }}
        bouncePlace={brightened[brightened.length - 1] ?? null}
      />
      {phase === 'checkin' && <div className="walk__scrim" />}

      {/* ---------- top ---------- */}
      <div className="walk__top">
        {phase === 'preview' ? (
          <div className="chip">
            <span className="dot" />
            {data.scenario.label} · leaving {data.start.name}
          </div>
        ) : phase !== 'arrived' && phase !== 'ended' && next ? (
          <StreetSign
            street={next.direction === 'arrive' ? data.end.name : next.street}
            direction={next.direction === 'arrive' ? 'arrive' : toNext > 160 ? 'straight' : next.direction}
            instruction={next.direction === 'arrive' ? `Arrive · ${meters(toNext)}` : `${toNext > 160 ? 'Then turn' : 'Turn'} ${next.direction} · ${meters(toNext)}`}
          />
        ) : null}
        <div className="walk__top-right">
          {phase !== 'preview' && (
            <button type="button" className="round-btn" onClick={toggleMute} aria-label={muted ? 'Unmute voice' : 'Mute voice'}>
              <Icon name={muted ? 'volumeOff' : 'volume'} size={20} />
            </button>
          )}
        </div>
      </div>
      {state.replay && phase !== 'preview' && (
        <div className="walk__tape">
          <DemoTape label={`DEMO · GPS REPLAY · ×${settings.timeScale}`} />
        </div>
      )}
      {gpsError && <div className="walk__toast">{gpsError}</div>}

      {/* ---------- sheets ---------- */}
      {phase === 'preview' && (
        <Sheet label="Route offer from Scout">
          <div className="speaker">
            <Mascot agent="scout" state={plan ? 'talking' : 'thinking'} />
            <div>
              <div className="t-headline">Scout</div>
              <div className="t-caption">{plan ? 'Planned before you left · just now' : 'Asking who is open nearby…'}</div>
            </div>
            <span style={{ marginLeft: 'auto' }}>
              <LinkBadge status={status} />
            </span>
          </div>
          <p className="t-spoken">{plan?.reason ?? 'Checking lights and open places along the route…'}</p>
          <div className="ticket">
            <div>
              <div className="t-number ticket__v">{Math.round(stats.streetwise.minutes)} MIN</div>
              <div className="ticket__k">arrive by {timeOf(arrive)}</div>
            </div>
            <div>
              <div className="t-number ticket__v" style={{ color: 'var(--route)' }}>
                {stats.streetwise.score} vs {stats.shortest.score}
              </div>
              <div className="ticket__k">street score</div>
            </div>
            <div>
              <div className="t-number ticket__v">+{(stats.streetwise.minutes - stats.shortest.minutes).toFixed(1)} MIN</div>
              <div className="ticket__k">extra walking</div>
            </div>
          </div>
          <div className="legend">
            <span><i className="legend__solid" /> Streetwise route</span>
            <span><i className="legend__dots" /> Shortest path on our map</span>
          </div>
          <div className="btn-row">
            <Button kind="secondary" disabled={(isGatewayMode() && status !== 'online') || !plan} onClick={() => go('usual')}>Keep usual</Button>
            <Button kind="primary" disabled={(isGatewayMode() && status !== 'online') || !plan} onClick={() => go('streetwise')}>Go this way</Button>
          </div>
          <WalkTools walkId={walkId} state={state} data={data} send={send} status={status} />
        </Sheet>
      )}

      {phase === 'walking' && (
        <Sheet label="Walk">
          <div className="walk__eta">
            <div>
              <div className="t-number" style={{ fontSize: 22 }}>ARRIVE {timeOf(arrive).replace(' PM', '').replace(' AM', '')}</div>
              <div className="t-caption">{Math.max(1, Math.round(etaMin))} min · {meters(remaining)}</div>
            </div>
            <div className="guardian-chip">
              <Initials text={settings.guardianName[0]} />
              {!isGatewayMode() ? 'Demo guardian · this device' : `${guardianFirst} ${state.guardianJoined ? 'is watching' : 'gets a live link if needed'}`}
            </div>
          </div>
          <hr className="divider" />
          {state.say && (
            <>
              <div className="speaker">
                <Mascot agent={state.say.agent} state={now - state.say.ts < 4000 ? 'talking' : 'idle'} />
                <div>
                  <div className="t-headline">{AGENT_LABEL[state.say.agent]}</div>
                  <div className="t-caption">{now - state.say.ts < 4000 ? 'speaking now' : `${Math.round((now - state.say.ts) / 1000)} s ago`}</div>
                </div>
              </div>
              <p className="t-spoken" aria-live="polite">{state.say.text}</p>
            </>
          )}
          <div className="btn-row">
            <Button kind="fine" icon="check" onClick={() => reply('fine')}>I'm fine</Button>
            <HoldButton onConfirm={() => reply('help')}>Hold for help</HoldButton>
          </div>
          <WalkTools walkId={walkId} state={state} data={data} send={send} status={status} />
        </Sheet>
      )}

      {phase === 'checkin' && state.checkin && (
        <CheckIn
          checkin={state.checkin}
          now={now}
          guardian={guardianFirst}
          onFine={() => reply('fine')}
          onHelp={() => reply('help')}
        />
      )}

      {phase === 'escalated' && (
        <Sheet label="Guardian alerted">
          <div className="speaker">
            <Mascot agent="rescuer" state="talking" size={56} />
            <div>
              <div className="t-caption">Rescuer</div>
              <h2 className="t-display" style={{ fontSize: 26, lineHeight: '30px' }}>Your guardian link has an alert</h2>
            </div>
          </div>
          <div className={`ack ${state.alert?.ackBy ? 'ack--on' : ''}`}>
            <Icon name={state.alert?.ackBy ? 'check' : 'ring'} size={18} />
            {state.alert?.ackBy ? `${state.alert?.ackBy} acknowledged the alert` : `Waiting for ${guardianFirst} to respond…`}
          </div>
          <Button kind="fine" icon="check" tall block onClick={() => reply('fine')}>I'm okay now</Button>
          <p className="t-caption center">Streetwise doesn't call 911. If you need emergency help, call 911 yourself.</p>
        </Sheet>
      )}

      {(phase === 'arrived' || phase === 'ended') && (
        <Sheet label="Arrived">
          <div className="speaker">
            <Mascot agent="reporter" state="done" size={56} />
            <div>
              <div className="t-caption">Reporter</div>
              <h2 className="t-display" style={{ fontSize: 28 }}>{phase === 'arrived' ? 'You have arrived.' : 'Your walk has ended.'}</h2>
            </div>
          </div>
          <p className="t-caption" style={{ fontSize: 15, lineHeight: '21px' }}>{state.summary}</p>
          {state.report && <p className="status-note">{state.report}</p>}
          {state.observations.length > 0 && <p className="t-caption">{state.observations.length} street observation(s) saved for review.</p>}
          <div className="btn-row">
            <Button kind="secondary" onClick={() => nav(`/room?walk=${walkId}`)}>Control room</Button>
            <Button kind="primary" onClick={() => nav('/plan')}>New walk</Button>
          </div>
        </Sheet>
      )}
    </main>
  );
}

function CheckIn({ checkin, now, guardian, onFine, onHelp }: { checkin: NonNullable<ReturnType<typeof useWalk>['state']['checkin']>; now: number; guardian: string; onFine: () => void; onHelp: () => void }) {
  const span = Math.max(1, checkin.deadline - checkin.ts);
  const left = Math.max(0, checkin.deadline - now);
  const frac = left / span;
  const secs = Math.ceil(frac * checkin.windowSec);
  return (
    <Sheet label="Check-in" className="checkin">
      <div className="countdown">
        <div className="countdown__row">
          <span className="t-number" style={{ color: 'var(--checkin)', letterSpacing: 1 }}>CHECKING IN</span>
          <span className="t-number">{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')} left</span>
        </div>
        <div className="countdown__track">
          <div className="countdown__fill" style={{ transform: `scaleX(${frac})` }} />
        </div>
      </div>
      <div className="speaker">
        <Mascot agent="watcher" state="talking" size={64} />
        <div>
          <div className="t-caption">Watcher</div>
          <h2 className="t-display">{checkin.text}</h2>
        </div>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 15 }}>Why I'm asking: {checkin.reason.charAt(0).toLowerCase() + checkin.reason.slice(1)}</p>
      <Button kind="fine" icon="check" tall block onClick={onFine}>I'm fine</Button>
      <HoldButton block onConfirm={onHelp}>Hold for help</HoldButton>
      <p className="t-caption center">No answer in {secs} s → {guardian} gets your live location. Streetwise never calls 911 for you.</p>
    </Sheet>
  );
}
