import { Link } from 'react-router-dom';
import { Mascot } from '../components/ui';
import { walkIdFromUrl } from '../lib/store';

// Hub for the demo crew: one walk id, four screens.
export default function Home() {
  const w = walkIdFromUrl();
  const q = `?walk=${encodeURIComponent(w)}`;
  const links: [string, string, string, 'scout' | 'watcher' | 'rescuer' | 'reporter' | 'auditor'][] = [
    [`/setup`, 'Setup', 'Guardian and standing orders', 'scout'],
    [`/walk${q}`, 'Walker', 'The demo phone with earbuds', 'watcher'],
    [`/guardian/${w}`, 'Guardian', "Opened from the QR on a judge's phone", 'rescuer'],
    [`/shop/cafe-mia${q}`, 'Shopkeeper', 'Café Mia — drives the place agent', 'reporter'],
    [`/room${q}`, 'Control room', 'The laptop on stage', 'auditor'],
  ];
  return (
    <div className="screen screen--scroll" data-theme="night">
      <main style={{ maxWidth: 520, margin: '0 auto', padding: 'calc(40px + var(--safe-top)) 20px 40px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="wordmark" style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 34 }}>streetwise</div>
        <p className="muted" style={{ margin: '0 0 8px' }}>A walking companion for the walk home at night. Walk id <code>{w}</code> — every screen below joins the same room.</p>
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
