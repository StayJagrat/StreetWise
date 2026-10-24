import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { DemoData, Msg } from '../lib/types';
import type { WalkState } from '../lib/store';
import { loadInvitations, roomRequest, sessionLink } from '../lib/session';
import { canListen, listen, parseIntent, unlockAudio, type ListenerHandle } from '../lib/voice';
import { Button, LinkBadge } from './ui';
import type { LinkStatus } from '../lib/transport';

export function Modal({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="walk-dialog" aria-label={title} onCancel={close}>
    <div className="dialog-head"><h2 className="t-title">{title}</h2><button type="button" aria-label="Close dialog" autoFocus onClick={close}>×</button></div>{children}
  </dialog>;
}

export default function WalkTools({ walkId, state, data, send, status }: { walkId: string; state: WalkState; data: DemoData; send: (m: Msg) => unknown; status: LinkStatus }) {
  const [dialog, setDialog] = useState<'share' | 'evidence' | 'report' | 'end' | null>(null);
  const [qr, setQr] = useState('');
  const [, refreshInvitations] = useState(0);
  const [command, setCommand] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [listening, setListening] = useState(false);
  const [kind, setKind] = useState<'lighting' | 'blocked_path' | 'closed_place'>('lighting');
  const [note, setNote] = useState('');
  const listener = useRef<ListenerHandle | null>(null);
  const offline = new URLSearchParams(location.search).get('engine') === 'local';
  const active = ['walking', 'checkin', 'escalated'].includes(state.phase);
  const guardianUrl = sessionLink(walkId, 'guardian');
  useEffect(() => {
    if (offline || status !== 'online') return;
    void loadInvitations(walkId, 'walker').then(() => refreshInvitations(n => n + 1)).catch(() => {});
  }, [walkId, status, offline]);
  useEffect(() => {
    if (dialog !== 'share') return;
    let mounted = true;
    void import('qrcode').then(m => m.default.toDataURL(guardianUrl, { margin: 2, width: 240 })).then(url => { if (mounted) setQr(url); });
    return () => { mounted = false; };
  }, [dialog, guardianUrl]);
  useEffect(() => {
    if (!active) { listener.current?.stop(); listener.current = null; setListening(false); }
    return () => { listener.current?.stop(); listener.current = null; };
  }, [active]);

  const run = async (text: string) => {
    const intent = parseIntent(text);
    if (intent === 'fine' || intent === 'help') send({ type: 'checkin.reply', reply: intent, via: 'voice' });
    else if (intent === 'wait') offline ? setNotice('Place requests need a connected walk.') : send({ type: 'help.request' });
    else if (intent === 'replan') offline ? setNotice('Replanning needs the connected gateway.') : send({ type: 'walk.replan' });
    else if (intent === 'end') setDialog('end');
    else if (offline) setNotice('Cached replay supports check-in commands. Questions need a connected walk.');
    else {
      setBusy(true);
      try {
        const answer = await roomRequest<{ text: string; provider: string }>(walkId, '/api/voice/ask', { walkId, text });
        setNotice(answer.provider === 'claude' ? 'Answered with Claude using route evidence.' : 'Answered from route facts. Claude is unavailable.');
      } catch (e) { setNotice((e as Error).message); }
      finally { setBusy(false); }
    }
  };
  const toggleVoice = () => {
    if (listening) { listener.current?.stop(); listener.current = null; setListening(false); return; }
    unlockAudio();
    listener.current = listen((_intent, transcript) => void run(transcript), message => { setNotice(message); setListening(false); }, transcript => void run(transcript));
    setListening(!!listener.current);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(guardianUrl); setNotice('Guardian link copied. Share it only with someone you trust.'); }
    catch { setNotice('Copy the guardian link from the field below.'); }
  };
  return <>
    {state.notice && <p className="status-note status-note--warning" role="alert">{state.notice}</p>}
    {offline && <p className="t-caption">Cached demonstration · this device only. Shared guardian, place requests and Claude need a connected walk.</p>}
    {!offline && status !== 'online' && <div className="status-note status-note--warning" role="status"><LinkBadge status={status} /> {status === 'blocked' ? 'This link is invalid or expired. Start a new walk.' : 'Guardian updates need a connection. On-screen changes are not delivered while disconnected.'} <Link to="/setup">Walk settings</Link></div>}
    {state.tracking && !['replay', 'tracking'].includes(state.tracking.status) && <div className="status-note status-note--warning" role="status">{state.tracking.message}</div>}
    {state.help && <div className="status-note" role="status"><strong>{state.help.status === 'accepted' ? 'Place confirmed · demo' : state.help.status === 'waiting' ? 'Checking a place to wait…' : state.help.status === 'resumed' ? 'Original destination restored' : 'No place confirmed'}</strong><br />{state.help.message}{state.help.status === 'accepted' && active && <button type="button" disabled={status !== 'online'} onClick={() => send({ type: 'walk.replan', resumeDestination: true })}>Continue to original destination</button>}</div>}
    <div className="walk-tools">
      {!offline && <button type="button" onClick={() => setDialog('share')}>Invite guardian</button>}
      <button type="button" onClick={() => setDialog('evidence')}>Why this route?</button>
      {active && <><button type="button" disabled={status !== 'online' || state.help?.status === 'waiting'} onClick={() => send({ type: 'help.request' })}>Find a place to wait</button><button type="button" disabled={!canListen()} onClick={toggleVoice}>{listening ? 'Turn off microphone' : 'Turn on microphone'}</button><button type="button" disabled={offline || status !== 'online'} onClick={() => setDialog('report')}>Add observation</button><button type="button" onClick={() => setDialog('end')}>End walk</button></>}
    </div>
    {active && <form className="walk-form" onSubmit={e => { e.preventDefault(); if (command.trim()) { void run(command.trim()); setCommand(''); } }}><input aria-label="Ask your companion" maxLength={600} placeholder={listening ? 'Listening · or type a question' : 'Ask about open places or the route'} value={command} onChange={e => setCommand(e.target.value)} /><button type="submit" disabled={busy || !command.trim() || status !== 'online'}>{busy ? 'Asking…' : 'Ask'}</button></form>}
    {notice && <div className="t-caption" role="status">{notice}</div>}
    {dialog === 'share' && <Modal title="Invite your guardian" close={() => setDialog(null)}><p className="muted">Share this private link with someone you trust. It expires after two hours. They can acknowledge alerts; acknowledgment does not confirm your wellbeing.</p>{qr && <img src={qr} alt="QR code for your private guardian invitation" />}<label className="t-caption">Private guardian link<input className="share-url" readOnly value={guardianUrl} onFocus={e => e.currentTarget.select()} /></label><Button kind="primary" onClick={() => void copy()}>Copy guardian link</Button><a href={guardianUrl} target="_blank" rel="noreferrer">Open guardian view</a><a href={sessionLink(walkId, 'room')} target="_blank" rel="noreferrer">Open control room</a>{notice && <p role="status">{notice}</p>}</Modal>}
    {dialog === 'evidence' && <Modal title="What informs this route" close={() => setDialog(null)}><p>{state.plan?.reason ?? data.dataNote}</p><p className="t-caption">The score compares this walk with typical walks nearby at this hour. It is not a probability of personal safety.</p><dl className="evidence-facts"><dt>Listed open places</dt><dd>Opening hours are evaluated at your estimated arrival time. An open business has not necessarily agreed to provide assistance.</dd><dt>Lighting evidence</dt><dd>Mapped lamps and historical SF 311 reports. Current lighting may differ.</dd><dt>Help and transit</dt><dd>Mapped facilities and scheduled transit. Public access and live arrivals are not verified.</dd></dl>{data.dimStretches.filter(s => s.onRoute).map(s => <section key={s.id}><h3>{s.name}</h3><p>{s.lampEvidence}</p><p>{s.openPlaces}</p><p className="t-caption">{s.lampSource} · {s.openSource} · confidence: {s.confidence}</p></section>)}</Modal>}
    {dialog === 'report' && <Modal title="Add a street observation" close={() => setDialog(null)}><p className="t-caption">Saved with this walk for review. One report does not change a route score.</p><label>What did you notice?<select value={kind} onChange={e => setKind(e.target.value as typeof kind)}><option value="lighting">Lighting issue</option><option value="blocked_path">Blocked walkway</option><option value="closed_place">Place appears closed</option></select></label><label>Details<textarea maxLength={300} value={note} onChange={e => setNote(e.target.value)} placeholder="Describe the street condition, not the people nearby." /></label><Button kind="primary" disabled={status !== 'online'} onClick={() => { send({ type: 'observation.add', kind, note }); setDialog(null); setNotice('Observation sent for review. It remains unverified.'); setNote(''); }}>Save observation</Button></Modal>}
    {dialog === 'end' && <Modal title="Finish your walk?" close={() => setDialog(null)}><p>Location collection and sharing stop when the walk ends.</p><Button kind="primary" onClick={() => { send({ type: 'walk.end', outcome: 'arrived', summary: 'Walker confirmed arrival.' }); setDialog(null); }}>I have arrived</Button><Button kind="secondary" onClick={() => { send({ type: 'walk.end', outcome: 'ended', summary: 'Walker ended the walk.' }); setDialog(null); }}>End before arrival</Button></Modal>}
  </>;
}
