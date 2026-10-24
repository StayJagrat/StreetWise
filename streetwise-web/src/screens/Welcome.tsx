import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Mascot } from '../components/ui';
import { currentSession, sessionLink } from '../lib/session';
import './welcome.css';

export default function Welcome() {
  const session = currentSession();
  const [installed, setInstalled] = useState(window.matchMedia('(display-mode: standalone)').matches);
  const [install, setInstall] = useState<(Event & { prompt: () => Promise<void> }) | null>(null);
  useEffect(() => {
    const capture = (e: Event) => { e.preventDefault(); setInstall(e as Event & { prompt: () => Promise<void> }); };
    const done = () => { setInstalled(true); setInstall(null); };
    window.addEventListener('beforeinstallprompt', capture);
    window.addEventListener('appinstalled', done);
    return () => { window.removeEventListener('beforeinstallprompt', capture); window.removeEventListener('appinstalled', done); };
  }, []);
  return (
    <div className="screen screen--scroll welcome" data-theme="night">
      <header className="welcome__nav">
        <Link className="welcome__brand" to="/" aria-label="Streetwise home">streetwise<span aria-hidden="true">.</span></Link>
        <Link className="welcome__account" to="/account">Your account <span aria-hidden="true">↗</span></Link>
      </header>
      <main id="main-content" className="welcome__main">
        <section className="welcome__hero">
          <div className="welcome__copy">
            <div className="welcome__eyebrow"><span className="dot dot--live" /> SAN FRANCISCO PILOT</div>
            <h1>A little company.<br />A clearer way <em>home.</em></h1>
            <p>Meet your walking companion. Find a route with more open places, hear the next turn, and keep someone you trust connected.</p>
            <Link className="btn btn--primary welcome__cta" to="/setup">Ready for a smarter walk <span aria-hidden="true">↗</span></Link>
            <Link className="welcome__preview" to="/plan">Explore a route first</Link>
            <Link className="welcome__preview" to="/walk?engine=local&walk=offline-demo">Try the cached replay</Link>
            {session && <a className="welcome__resume" href={sessionLink(session.id, 'walker')}>Return to your current walk →</a>}
            <div className="welcome__footnote">For everyone on foot. Day or night.<br />Street conditions inform your choices; no route is guaranteed safe.</div>
          </div>
          <div className="welcome__scene" aria-label="Example of the Streetwise walking companion">
            <div className="welcome__orbit welcome__orbit--one" /><div className="welcome__orbit welcome__orbit--two" />
            <div className="welcome__lantern"><Mascot agent="watcher" state="idle" size={142} /></div>
            <div className="welcome__speech"><span className="t-caption">WATCHER · EXAMPLE</span><p>I'll keep the next turn simple.<br />You keep your eyes on the street.</p><span className="welcome__wave" aria-hidden="true"><i /><i /><i /><i /><i /></span></div>
            <div className="welcome__route-line" aria-hidden="true"><span /><i /><i /><i /><span /></div>
            <div className="welcome__scene-label"><span>YOUR WALK</span><span>YOUR PACE</span></div>
          </div>
        </section>
        <section className="welcome__acts" aria-label="How your companion works">
          <article><span className="welcome__number">01 / BEFORE</span><Mascot agent="scout" size={42} /><h2>Know the route.</h2><p>Compare walking time, lighting evidence, and gaps between listed open places.</p></article>
          <article><span className="welcome__number">02 / DURING</span><Mascot agent="watcher" size={42} /><h2>Walk with company.</h2><p>Listen to turns, request a place to wait, and check in with your guardian.</p></article>
          <article><span className="welcome__number">03 / AFTER</span><Mascot agent="reporter" size={42} /><h2>Leave a useful note.</h2><p>Save street observations for review. Reports stay drafts until a person submits them.</p></article>
        </section>
        <div className="welcome__install">
          <div><strong>Keep Streetwise close.</strong><p>{installed ? 'Streetwise is running as an installed app.' : 'Install it on your home screen. On iPhone, use Share → Add to Home Screen.'}</p></div>
          {install && <button type="button" className="btn btn--secondary" onClick={() => void install.prompt()}>Install app</button>}
        </div>
      </main>
      <footer className="welcome__footer"><span>Built for the walk ahead.</span><nav aria-label="Footer"><Link to="/privacy">Privacy & limits</Link><Link to="/hub">Demo tools</Link></nav></footer>
    </div>
  );
}
