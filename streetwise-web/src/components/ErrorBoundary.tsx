import { Component, type ReactNode } from 'react';
export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <main className="screen screen--scroll setup" data-theme="night"><div className="setup__body"><h1 className="t-display">This view could not be opened.</h1><p>Your connected session is saved by the gateway. Reload to recover it.</p><button className="btn btn--primary" onClick={() => location.reload()}>Reload Streetwise</button><a href="/">Go to the home screen</a></div></main>;
    return this.props.children;
  }
}
