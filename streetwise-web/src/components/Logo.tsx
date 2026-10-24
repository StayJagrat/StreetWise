import type { CSSProperties } from 'react';
import './logo.css';

// The Streetwise mark, from the "Streetwise Logo" canvas: San Francisco's green
// street-sign plate, the walk home as an S, three streetlights and the walker's puck.
// Detail drops away as it shrinks: lamps and heading wedge below 72 px, keyline below 40.
const S = 'M84 33 H47 Q38 33 38 42 V51 Q38 60 47 60 H73 Q82 60 82 69 V78 Q82 87 73 87 H40';

export function LogoMark({ size = 40, label }: { size?: number; label?: string }) {
  const full = size >= 72;
  const keyline = size >= 40;
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 120 120" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <rect x="6" y="6" width="108" height="108" rx="26" fill="var(--sign)" />
      {keyline && <rect x="12" y="12" width="96" height="96" rx="20" fill="none" stroke="#FFFFFF" strokeWidth="3" />}
      {full && (
        <>
          <circle cx="62" cy="22.5" r="2.6" fill="#ECE7DC" />
          <circle cx="27.5" cy="47" r="2.6" fill="#ECE7DC" />
          <circle cx="92.5" cy="74" r="2.6" fill="#ECE7DC" />
        </>
      )}
      <path d={S} fill="none" stroke="#FFFFFF" strokeWidth={keyline ? 10 : 13} strokeLinecap="round" strokeLinejoin="round" />
      {full && <path d="M38 87 L22 79.5 Q19 87 22 94.5 Z" fill="var(--route)" fillOpacity="0.5" />}
      {keyline && <circle cx="86" cy="33" r="7" fill="var(--sign)" stroke="#FFFFFF" strokeWidth="4" />}
      <circle cx="38" cy="87" r={keyline ? 9.5 : 11} fill="var(--route)" stroke="#FFFFFF" strokeWidth={keyline ? 4 : 5} />
    </svg>
  );
}

// "streetwıse" with the walker's dot over the i. Set --logo-ring to the background
// behind it so the dot's cut-out ring matches.
export function Wordmark({ size = 20, style }: { size?: number; style?: CSSProperties }) {
  return (
    <span className="wordmark" style={{ fontSize: size, ...style }} aria-label="streetwise" role="img">
      streetw<span className="wordmark__i" aria-hidden>ı<span className="wordmark__dot" /></span>se
    </span>
  );
}

export function Logo({ size = 20, mark, style }: { size?: number; mark?: number; style?: CSSProperties }) {
  return (
    <span className="logo" style={{ gap: Math.round(size * 0.35), ...style }}>
      <LogoMark size={mark ?? Math.round(size * 1.6)} />
      <Wordmark size={size} />
    </span>
  );
}
