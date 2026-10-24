import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Icon, Initials, Mascot } from '../components/ui';
import { loadSettings, saveSettings } from '../lib/store';
import type { AgentName } from '../lib/types';
import './setup.css';

const CREW: [AgentName, string, string][] = [
  ['scout', 'Scout', 'plans the route before you leave'],
  ['watcher', 'Watcher', 'walks with you and checks in'],
  ['rescuer', 'Rescuer', 'tells your guardian if you go quiet'],
  ['reporter', 'Reporter', 'logs broken lamps after the walk'],
  ['auditor', 'Auditor', 're-checks every street overnight'],
];

export default function Setup() {
  const nav = useNavigate();
  const [s, setS] = useState(loadSettings);
  const [picked, setPicked] = useState<AgentName>('scout');
  const set = (patch: Partial<typeof s>) => setS({ ...s, ...patch });
  const setT = (k: keyof typeof s.thresholds, v: number) => setS({ ...s, thresholds: { ...s.thresholds, [k]: v } });

  return (
    <div className="screen screen--scroll setup" data-theme="night">
      <main className="setup__body" id="main-content">
        <Link to="/">Back to Streetwise</Link>
        <h1 className="t-display" style={{ fontSize: 32, lineHeight: '36px' }}>Before your first walk</h1>

        <section className="card setup__crew">
          <div className="t-caption">Meet the night shift — five agents that walk with you</div>
          <div className="setup__crew-row">
            {CREW.map(([a, name]) => (
              <button type="button" key={a} className={`setup__crew-item${picked === a ? ' on' : ''}`} onClick={() => setPicked(a)} aria-pressed={picked === a}>
                <Mascot agent={a} state={picked === a ? 'talking' : 'idle'} size={54} />
                <span>{name}</span>
              </button>
            ))}
          </div>
          <p className="setup__crew-line">{CREW.find((c) => c[0] === picked)?.[1]} {CREW.find((c) => c[0] === picked)?.[2]}.</p>
        </section>

        <label className="setup__field">Your name<input className="setup__input" maxLength={80} value={s.walkerName} onChange={e => set({ walkerName: e.target.value })} /></label>
        <label className="setup__field">Phone number <span className="t-caption">Optional; shared with your guardian</span><input type="tel" className="setup__input" maxLength={30} value={s.walkerPhone ?? ''} onChange={e => set({ walkerPhone: e.target.value })} placeholder="+1 ..." /></label>
        <section className="card setup__guardian">
          <Initials text={s.guardianName[0] ?? 'G'} size={42} />
          <div style={{ flex: 1 }}>
            <div className="t-caption" style={{ fontSize: 12 }}>Guardian</div>
            <input className="setup__input" value={s.guardianName} onChange={(e) => set({ guardianName: e.target.value })} aria-label="Guardian name" />
            <div className="t-caption" style={{ fontSize: 12 }}>Gets a live link only during a walk</div>
          </div>
        </section>

        <section className="card setup__orders">
          <div className="t-number muted" style={{ fontSize: 13, letterSpacing: 1.2 }}>STANDING ORDERS</div>
          <p className="setup__sentence">
            If I stop on a dim stretch for{' '}
            <Pick value={s.thresholds.stopSeconds} options={[60, 90, 120]} suffix=" s" tone="checkin" onChange={(v) => setT('stopSeconds', v)} /> and don't answer in{' '}
            <Pick value={s.thresholds.replySeconds} options={[30, 45, 60]} suffix=" s" tone="checkin" onChange={(v) => setT('replySeconds', v)} />, send{' '}
            <span className="pick pick--route">{s.guardianName.split(' ')[0] || 'my guardian'}</span> my live location.
          </p>
        </section>

        <section className="setup__note">
          <Icon name="phoneOff" size={24} />
          <div>
            <div className="t-headline" style={{ fontSize: 15 }}>Streetwise never calls 911 for you.</div>
            <div className="t-caption" style={{ fontSize: 12 }}>Voice is optional. Keep the app visible. Streetwise does not save recordings.</div>
          </div>
        </section>

        <fieldset className="setup__modes"><legend>Choose how to try Streetwise</legend>
          <label><input type="radio" name="mode" checked={(s.mode ?? 'demo') === 'demo'} onChange={() => set({ mode: 'demo' })} /><span>Demo replay<small>A cached SF walk. No device location needed.</small></span></label>
          <label><input type="radio" name="mode" checked={s.mode === 'live'} onChange={() => set({ mode: 'live' })} /><span>Device GPS<small>SF only. Requires location permission and a visible app.</small></span></label>
        </fieldset>
        <label className="setup__consent"><input type="checkbox" checked={s.consent ?? false} onChange={e => set({ consent: e.target.checked })} /><span>I agree to share my position with the guardian I invite during this walk. My link expires after two hours. <Link to="/privacy">Privacy and limits</Link></span></label>
        <label className="setup__demo t-caption">
          Demo replay speed
          <select value={s.timeScale} onChange={(e) => set({ timeScale: Number(e.target.value) })}>
            {[1, 3, 6, 10].map((v) => <option key={v} value={v}>×{v}</option>)}
          </select>
        </label>

        <Button kind="primary" block disabled={!s.walkerName.trim() || !s.guardianName.trim() || !s.consent} onClick={() => {
          saveSettings(s);
          nav('/plan');
        }}>Save · plan a walk</Button>
      </main>
    </div>
  );
}

function Pick({ value, options, suffix, tone, onChange }: { value: number; options: number[]; suffix: string; tone: 'checkin' | 'route'; onChange: (v: number) => void }) {
  return (
    <label className={`pick pick--${tone}`}>
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {options.map((o) => <option key={o} value={o}>{o}{suffix}</option>)}
      </select>
      {value}{suffix}
      <Icon name="chevronDown" size={12} />
    </label>
  );
}
