import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Welcome from './screens/Welcome';
import ErrorBoundary from './components/ErrorBoundary';
import AppStatus from './components/AppStatus';
const Home = lazy(() => import('./screens/Home'));
const Account = lazy(() => import('./screens/Account'));
const Privacy = lazy(() => import('./screens/Privacy'));
const Setup = lazy(() => import('./screens/Setup'));
const Plan = lazy(() => import('./screens/Plan'));
const Walk = lazy(() => import('./screens/Walk'));
const Guardian = lazy(() => import('./screens/Guardian'));
const Shop = lazy(() => import('./screens/Shop'));
const Room = lazy(() => import('./screens/Room'));
export default function App() {
  return <ErrorBoundary><a className="skip-link" href="#main-content">Skip to content</a>
    <Suspense fallback={<main className="screen app-loading" id="main-content" role="status"><div className="wordmark">streetwise</div><p>Preparing your companion...</p></main>}>
      <Routes>
        <Route path="/" element={<Welcome />} />
        <Route path="/hub" element={<Home />} />
        <Route path="/account" element={<Account />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/setup" element={<Setup />} />
        <Route path="/plan" element={<Plan />} />
        <Route path="/walk" element={<Walk />} />
        <Route path="/guardian/:walk" element={<Guardian />} />
        <Route path="/guardian" element={<Navigate to="/guardian/demo" replace />} />
        <Route path="/shop/:place" element={<Shop />} />
        <Route path="/shop" element={<Shop />} />
        <Route path="/room" element={<Room />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense><AppStatus />
  </ErrorBoundary>;
}
