import { useRegisterSW } from 'virtual:pwa-register/react';
export default function AppStatus() {
  const { needRefresh: [refresh, setRefresh], updateServiceWorker } = useRegisterSW();
  if (!refresh) return null;
  return <aside className="app-update" role="status"><span>An update is ready. Finish your walk before reloading.</span><button onClick={() => void updateServiceWorker(true)}>Reload app</button><button onClick={() => setRefresh(false)}>Later</button></aside>;
}
