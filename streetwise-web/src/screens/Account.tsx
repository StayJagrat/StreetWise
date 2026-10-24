import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Mascot } from '../components/ui';
import { getConfig } from '../lib/session';
import type { SupabaseClient } from '@supabase/supabase-js';
import './setup.css';

export default function Account() {
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [name, setName] = useState('');
  const [ready, setReady] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    let unsubscribe: (() => void) | undefined;
    void getConfig().then(async c => {
      if (!c.googleLogin || !c.supabaseAnonKey) return;
      const { createClient } = await import('@supabase/supabase-js');
      if (!alive) return;
      const auth = createClient(c.supabaseUrl, c.supabaseAnonKey);
      setClient(auth); setEnabled(c.googleLogin);
      const { data } = await auth.auth.getSession();
      if (alive) setName(data.session?.user.user_metadata.full_name ?? data.session?.user.email ?? '');
      const listener = auth.auth.onAuthStateChange((_event, session) => setName(session?.user.user_metadata.full_name ?? session?.user.email ?? ''));
      unsubscribe = () => listener.data.subscription.unsubscribe();
    }).catch(() => setError('Account services are unavailable. You can continue as a guest.')).finally(() => { if (alive) setReady(true); });
    return () => { alive = false; unsubscribe?.(); };
  }, []);
  const signIn = async () => {
    if (!client) return;
    setBusy(true);
    const { error: failure } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}/account` } });
    if (failure) { setError(failure.message); setBusy(false); }
  };
  return <div className="screen screen--scroll setup" data-theme="night"><main className="setup__body" id="main-content">
    <Link to="/">← Streetwise</Link><Mascot agent="scout" size={80} /><h1 className="t-display">Your walking companion.</h1>
    <p className="muted">{name ? `Signed in as ${name}.` : enabled ? 'Use Google for your account, or continue as a guest.' : 'Continue without an account. Your private walk links connect your companion and guardian.'}</p>
    {error && <p role="alert">{error}</p>}
    {name ? <button className="btn btn--secondary" onClick={() => void client?.auth.signOut().then(() => setName(''))}>Sign out</button> : enabled ? <button className="btn btn--secondary" disabled={!ready || busy} onClick={() => void signIn()}>{busy ? 'Opening Google…' : 'Continue with Google'}</button> : null}

    <Link className="btn btn--primary" to="/setup">{name ? 'Set up your walk' : 'Continue as guest'}</Link>
    <Link to="/privacy">How your walk data is used</Link>
  </main></div>;
}
