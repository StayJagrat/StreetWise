import { Logo } from '../components/Logo';
import { Link } from 'react-router-dom';
import { Mascot } from '../components/ui';
import { walkIdFromUrl } from '../lib/store';

// Hub for the demo crew: one walk id, four screens.
export default function Home() {
  const w = walkIdFromUrl();
  const q = `?walk=${encodeURIComponent(w)}`;
  const links: [string, string, string, 'scout' | 'watcher' | 'rescuer' | 'reporter' | 'auditor'][] = [
    [`/plan`, 'Plan a walk', 'Any start and destination in San Francisco', 'scout'],
    [`/setup`, 'Setup', 'Guardian and standing orders', 'scout'],
    [`/walk${q}`, 'Walker', 'The demo phone with earbuds', 'watcher'],
    [`/guardian/${w}`, 'Guardian', "Opened from the QR on a judge's phone", 'rescuer'],
    [`/shop${q}`, 'Shopkeeper', 'Simulated hours update for a place on the route', 'reporter'],
    [`/room${q}`, 'Control room', 'The laptop on stage', 'auditor'],
  ];
  return (
    <div className="screen screen--scroll" data-theme="night">
      <main style={{ maxWidth: 520, margin: '0 auto', padding: 'calc(40px + var(--safe-top)) 20px 40px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h1 style={{ margin: 0 }}><Logo size={34} /></h1>
        <p className="muted" style={{ margin: '0 0 8px' }}>A walking companion for the route ahead. Walk id <code>{w}</code> — every screen below joins the same room.</p>
        {links.map(([to, title, sub, a]) => (
          <Link key={to} to={to} className="card" style={{ display: 'flex', gap: 14, alignItems: 'center', padding: 14, textDecoration: 'none', color: 'var(--text)' }}>
            <Mascot agent={a} size={48} />
            <div>
              <div className="t-headline">{title}</div>
              <div className="t-caption">{sub}</div>
            </div>
          </Link>
        ))}
      </main>
    </div>
  );
}
