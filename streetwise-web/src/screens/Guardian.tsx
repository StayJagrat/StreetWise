import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import MapView from '../components/MapView';
import { Button, Icon, LinkBadge, Sheet } from '../components/ui';
import { lineLength } from '../lib/geo';
import { loadSettings, mergedPlaces, useDemoData, useWalk } from '../lib/store';
import { getAudioContext, unlockAudio } from '../lib/voice';
import { vibrate } from '../lib/device';
import { timeOf } from '../lib/format';
import './guardian.css';

// Opened from a QR code on the judge's own phone. No install, no login.
// Sees the walker only during an active walk; the link stops showing location when the walk ends.

function beep() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  for (let i = 0; i < 3; i++) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = i % 2 ? 660 : 880;
    g.gain.setValueAtTime(0.0001, t0 + i * 0.28);
    g.gain.exponentialRampToValueAtTime(0.25, t0 + i * 0.28 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.28 + 0.24);
    o.connect(g).connect(ctx.destination);
    o.start(t0 + i * 0.28);
    o.stop(t0 + i * 0.28 + 0.26);
  }
}

export default function Guardian() {
  const { walk = 'demo' } = useParams();
  const data = useDemoData();
  const settings = useMemo(loadSettings, []);
  const { state, send, status } = useWalk(walk, 'guardian');
  const [sound, setSound] = useState(false);
  const [details, setDetails] = useState(false);
  const [now, setNow] = useState(Date.now());
  const me = settings.guardianName.split(' ')[0];
  const walker = settings.walkerName;

  useEffect(() => {
    send({ type: 'guardian.join', name: me });
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const alerting = !!state.alert && !state.alert.ackBy;
  const lastAlert = useRef(0);
  useEffect(() => {
    if (state.alert && state.alert.ts !== lastAlert.current && !state.alert.ackBy) {
      lastAlert.current = state.alert.ts;
      vibrate([400, 200, 400, 200, 400]);
      beep();
    }
  }, [state.alert]);

  if (!data) return <div className="screen" data-theme="day" />;
  const places = mergedPlaces(data, state);
  const active = state.phase !== 'preview' && state.phase !== 'arrived';
  const lastCheck = state.lastReply?.reply === 'fine' ? state.lastReply.ts : state.startedAt;
  const routeLen = lineLength(state.choice === 'usual' ? data.shortest : data.route);
  const remaining = state.position ? Math.max(1, Math.round(((1 - state.position.progress) * routeLen) / 1.35 / 60)) : null;

  return (
    <div className="screen guardian" data-theme="day">
      <MapView
        theme="day"
        data={data}
        choice={state.choice}
        places={places}
        showLamps={false}
        brightened={Object.keys(state.brightened)}
        puck={active && state.position ? { lngLat: state.position.lngLat, heading: state.position.heading, variant: state.phase === 'escalated' ? 'alert' : 'normal' } : null}
        progress={state.position?.progress ?? 0}
        camera="overview"
        padding={{ top: 120, bottom: 380, left: 30, right: 30 }}
      />

      <header className="g-top">
        <div>
          <div className="wordmark">streetwise</div>
          <div className="t-caption" style={{ fontSize: 12 }}>Shared by {walker} · ends when the walk ends</div>
        </div>
        {active ? (
          <span className="live-pill"><span className="dot dot--live" /> LIVE</span>
        ) : (
          <LinkBadge status={status} />
        )}
      </header>

      {!sound && (
        <button type="button" className="g-sound" onClick={() => { unlockAudio(); setSound(true); }}>
          <Icon name="volume" size={18} /> Tap to turn on alert sounds
        </button>
      )}

      <Sheet label="Walk status">
        {state.phase === 'preview' && (
          <>
            <h1 className="t-display">Waiting for {walker} to start walking</h1>
            <p className="muted" style={{ margin: 0 }}>You'll see {walker}'s live position here once the walk begins. Nothing is shared before or after.</p>
          </>
        )}
        {active && (
          <>
            <h1 className="t-display">{state.phase === 'escalated' ? `${walker} isn't answering` : `${walker} is walking home`}</h1>
            <p className="muted" style={{ margin: 0 }}>
              {remaining ? `${remaining} min away` : 'On the way'} · {lastCheck ? `checked in ${Math.max(0, Math.round((now - lastCheck) / 60000))} min ago` : 'just left'}
            </p>
            {state.alert?.ackBy && (
              <div className="g-ack"><Icon name="check" size={18} /> {state.lastReply?.reply === 'fine' && state.lastReply.ts > state.alert.ts ? `${walker} said they're fine.` : `You're on it. ${walker} can see that.`}</div>
            )}
            <div className="facts">
              <div><span>Route</span><strong>{state.choice === 'usual' ? 'Usual way (Howard St)' : 'Via Mission & 4th St'}</strong></div>
              <div><span>Last check-in</span><strong>{state.lastReply?.reply === 'fine' ? `${timeOf(state.lastReply.ts)} · "I'm fine"` : 'None needed yet'}</strong></div>
              <div><span>Arrives</span><strong>{data.end.name}{remaining ? ` · ${timeOf(now + remaining * 60000)}` : ''}</strong></div>
            </div>
            <p className="t-caption" style={{ margin: 0 }}>If {walker} stops answering, you'll get a full-screen alert here first. Location sharing stops when the walk ends.</p>
            <a className="btn btn--secondary btn--block" href="tel:" style={{ textDecoration: 'none' }}>Call {walker}</a>
          </>
        )}
        {state.phase === 'arrived' && (
          <>
            <h1 className="t-display">{walker} is home</h1>
            <p className="muted" style={{ margin: 0 }}>The walk ended and location sharing stopped. Thanks for being there.</p>
          </>
        )}
      </Sheet>

      {alerting && state.alert && (
        <div className="g-alert" role="alertdialog" aria-labelledby="g-alert-title">
          <div className="g-alert__label t-number"><span className="g-alert__dot" /> STREETWISE ALERT · {timeOf(state.alert.ts)}</div>
          <h1 id="g-alert-title" className="g-alert__title">{walker.toUpperCase()} ISN'T ANSWERING</h1>
          <p className="g-alert__body">{state.alert.reason}. Last seen on {state.alert.where}.</p>
          <div className="g-alert__map">
            <MapView theme="day" data={data} choice={state.choice} places={places} showLamps={false}
              puck={{ lngLat: state.alert.lngLat, heading: state.position?.heading ?? 0, variant: 'alert' }}
              progress={state.position?.progress ?? 0} camera="follow" interactive={false} />
          </div>
          <div style={{ flex: 1 }} />
          <a className="g-alert__call" href="tel:"><Icon name="phone" size={22} /> Call {walker}</a>
          <button type="button" className="g-alert__ack" onClick={() => send({ type: 'guardian.ack', by: me })}>I'm on it — clear the alert</button>
          <button type="button" className="g-alert__link" onClick={() => setDetails(true)}>See details (position, route, time, reason)</button>
          <p className="g-alert__foot">Streetwise does not call 911. If you think {walker} is in danger, call 911 yourself.</p>
        </div>
      )}

      {details && state.alert && (
        <div className="g-modal" role="dialog" aria-label="Handoff packet" onClick={() => setDetails(false)}>
          <div className="g-modal__card" onClick={(e) => e.stopPropagation()}>
            <h2 className="t-title">Handoff packet</h2>
            <dl>
              <dt>Position</dt><dd className="t-mono" style={{ fontSize: 13 }}>{state.alert.lngLat[1].toFixed(5)}, {state.alert.lngLat[0].toFixed(5)}</dd>
              <dt>Where</dt><dd>{state.alert.where}</dd>
              <dt>Route</dt><dd>{data.start.name} → {data.end.name}, {state.choice === 'usual' ? 'usual way' : 'Streetwise route'}</dd>
              <dt>Time</dt><dd>{timeOf(state.alert.ts)}</dd>
              <dt>Reason</dt><dd>{state.alert.reason}</dd>
            </dl>
            <Button kind="secondary" block onClick={() => setDetails(false)}>Close</Button>
          </div>
        </div>
      )}
    </div>
  );
}
