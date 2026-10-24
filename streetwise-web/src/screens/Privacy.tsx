import { Link } from 'react-router-dom';
export default function Privacy() {
  return <div className="screen screen--scroll setup" data-theme="night"><main className="setup__body" id="main-content">
    <Link to="/">← Streetwise</Link><h1 className="t-display">Your walk, your choices.</h1>
    <h2 className="t-title">During a walk</h2><p>Device GPS starts only when you choose it and start a walk. Your selected guardian can view your position through a private link. Keep that link private. Links expire after two hours.</p>
    <h2 className="t-title">When a walk ends</h2><p>Location collection stops. Reconnecting guardians do not receive the last live position. Walk state is stored by the gateway so a refresh can recover the session, with a private Supabase mirror when connected. Expired sessions are removed by the service’s retention process.</p>
    <h2 className="t-title">Voice</h2><p>Voice is optional. Browser speech recognition may send audio to your browser’s speech service. Questions and limited route facts may go to Claude when configured. Streetwise does not save audio recordings.</p>
    <h2 className="t-title">What the score means</h2><p>The score describes mapped conditions and listed opening hours. It is not a prediction of personal safety. Missing hours, outdated imagery and lamp records do not establish current street conditions. Demo businesses and replayed GPS are labelled.</p>
    <h2 className="t-title">Prototype limits</h2><p>Keep the app visible while walking. Background GPS, audio, guardian alerts and emergency response are not guaranteed. Streetwise never calls emergency services or submits city reports automatically. Observations remain unverified until reviewed.</p>
    <Link className="btn btn--primary" to="/setup">Choose your walk settings</Link>
  </main></div>;
}
