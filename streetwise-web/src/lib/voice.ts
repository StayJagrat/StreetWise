// Voice I/O for the walker.
// Speech uses optional browser APIs. The user chose no Cartesia integration.
// setSpeaker() / setListenerFactory() preserve a provider-independent boundary.

export type Intent = 'fine' | 'help' | 'wait' | 'replan' | 'end';
export type Speaker = { speak: (text: string) => Promise<void>; stop: () => void };
export type ListenerHandle = { stop: () => void };
export type ListenerFactory = (onIntent: (i: Intent, transcript: string) => void, onSpeech: () => void, onError?: (message: string) => void, onUtterance?: (text: string) => void) => ListenerHandle | null;

let audioCtx: AudioContext | null = null;

/** Call inside the first user tap ("Walk with me"): browsers block audio until then. */
export function unlockAudio() {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AC && !audioCtx) audioCtx = new AC();
    void audioCtx?.resume();
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
    }
  } catch {
    /* no audio */
  }
}

export function getAudioContext() {
  return audioCtx;
}

function pickVoice(): SpeechSynthesisVoice | undefined {
  const voices = speechSynthesis.getVoices();
  const pref = ['Samantha', 'Google US English', 'Microsoft Aria', 'Karen', 'Daniel'];
  return voices.find((v) => pref.some((p) => v.name.includes(p))) ?? voices.find((v) => v.lang.startsWith('en'));
}

const browserSpeaker: Speaker = {
  speak(text) {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) return resolve();
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const v = pickVoice();
      if (v) u.voice = v;
      u.rate = 1.02;
      u.pitch = 1;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      speechSynthesis.speak(u);
    });
  },
  stop() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  },
};

let speaker: Speaker = browserSpeaker;
let muted = false;

export function setSpeaker(s: Speaker) {
  speaker = s;
}
export function setMuted(m: boolean) {
  muted = m;
  if (m) speaker.stop();
}
export function isMuted() {
  return muted;
}
export function speak(text: string) {
  if (muted) return Promise.resolve();
  return speaker.speak(text);
}
export function stopSpeaking() {
  speaker.stop();
}

// ---------------------------------------------------------------- listening
// Resolve incidents only from an explicit all-clear.
export function parseIntent(text: string): Intent | null {
  const t = text.toLowerCase().trim().replace(/[.!?,]/g, '').replace(/\u2019/g, "'");
  if (/\b(not (fine|okay|ok|safe)|need help|emergency|i am scared|i'm scared)\b/.test(t) || /^(please )?help( me)?( please)?$/.test(t)) return 'help';
  if (/\b(place to wait|somewhere to wait|somewhere staffed|find a place|wait inside)\b/.test(t)) return 'wait';
  if (/^(replan|update (my |the )?route|reroute me)$/.test(t)) return 'replan';
  if (/^(end (my |the )?walk|finish (my |the )?walk|i have arrived|i'm home)$/.test(t)) return 'end';
  if (/^(i'?m (fine|ok|okay|good|alright)|i am (fine|okay|ok)|all good|fine|okay|ok)$/.test(t)) return 'fine';
  return null;
}

type SR = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onspeechstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
};

const browserListener: ListenerFactory = (onIntent, onSpeech, onError, onUtterance) => {
  const Ctor = (window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }).SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition;
  if (!Ctor) return null;
  let active = true;
  const rec = new Ctor();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = 'en-US';
  rec.onspeechstart = () => onSpeech();
  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      const t = r[0].transcript;
      onSpeech();
      const intent = parseIntent(t);
      if (intent && r.isFinal) onIntent(intent, t);
      else if (r.isFinal && t.trim()) onUtterance?.(t);
    }
  };
  rec.onend = () => {
    if (active) {
      try {
        rec.start();
      } catch {
        /* already started */
      }
    }
  };
  rec.onerror = e => { if (['not-allowed','service-not-allowed','audio-capture'].includes(e.error ?? '')) { active = false; onError?.('Microphone unavailable. Use the text field or buttons.'); } };
  try {
    rec.start();
  } catch {
    return null;
  }
  return {
    stop() {
      active = false;
      try {
        rec.stop();
      } catch {
        /* noop */
      }
    },
  };
};

let listenerFactory: ListenerFactory = browserListener;
export function setListenerFactory(f: ListenerFactory) {
  listenerFactory = f;
}

/** Start listening for "I'm fine" / "help". Speaking over the app stops playback (barge-in). */
export function listen(onIntent: (i: Intent, transcript: string) => void, onError?: (message: string) => void, onUtterance?: (text: string) => void): ListenerHandle | null {
  return listenerFactory(onIntent, () => stopSpeaking(), onError, onUtterance);
}

export const canListen = () =>
  typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
