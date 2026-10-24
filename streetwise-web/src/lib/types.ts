// Message contract between the PWA screens, the gateway and the agents.
// Every message travels in an Envelope inside one room per walk.
// The gateway (FastAPI) and the dev relay both just forward envelopes;
// the Brain's agents produce the same types the local demo engine produces.

export type LngLat = [number, number];
export type AgentName = 'scout' | 'watcher' | 'rescuer' | 'reporter' | 'auditor';
export type MascotState = 'idle' | 'talking' | 'thinking' | 'done';

export interface Place {
  id: string;
  name: string;
  kind: 'cafe' | 'market' | 'pharmacy' | 'hotel';
  lngLat: LngLat;
  openUntil: string; // "01:00", "24h", "lobby", or "closed"
  safeHaven: boolean;
  frontLight?: boolean;
  simulated: boolean;
  address?: string;
}

export interface DimStretch {
  id: string;
  name: string;
  onRoute: boolean;
  meters: number;
  score: number;
  confidence: 'low' | 'medium' | 'high';
  line: LngLat[];
  lampEvidence: string;
  lampSource: string;
  openPlaces: string;
  openSource: string;
  why: string;
}

export interface RouteStats {
  score: number;
  longestEmptyM: number;
  minutes: number;
}

export interface DemoData {
  scenario: { label: string; area: string; segmentsScored: number };
  walker: { id: string; name: string };
  guardian: { name: string; initials: string; channel: string };
  start: { name: string; lngLat: LngLat };
  end: { name: string; lngLat: LngLat };
  route: LngLat[];
  shortest: LngLat[];
  dimStretches: DimStretch[];
  stopAt: LngLat;
  places: Place[];
  stats: { streetwise: RouteStats; shortest: RouteStats };
  darknessDebt: { street: string; minutes: number }[];
}

export interface Thresholds {
  stopSeconds: number; // stop on a dim stretch before the Watcher asks (default 90)
  replySeconds: number; // check-in reply window (default 45)
  escalateSeconds: number; // guardian has this long to clear before the ladder continues (default 90)
}

// ---------------------------------------------------------------- messages
export type Msg =
  | { type: 'walk.plan'; plan: { routeId: string; stats: DemoData['stats']; reason: string; thresholds: Thresholds; guardian: string } }
  | { type: 'walk.reset' }
  | { type: 'walk.accept'; choice: 'streetwise' | 'usual' }
  | { type: 'walk.start'; replay: boolean }
  | { type: 'walk.position'; lngLat: LngLat; heading: number; speed: number; progress: number; replay: boolean }
  | { type: 'voice.say'; agent: AgentName; text: string }
  | { type: 'checkin.ask'; agent: 'watcher'; text: string; reason: string; windowSec: number; deadline: number }
  | { type: 'checkin.reply'; reply: 'fine' | 'help'; via: 'voice' | 'tap' }
  | { type: 'escalate'; reason: string; lngLat: LngLat }
  | { type: 'guardian.alert'; reason: string; lngLat: LngLat; where: string }
  | { type: 'guardian.ack'; by: string }
  | { type: 'guardian.join'; name: string }
  | { type: 'place.update'; place: Pick<Place, 'id' | 'openUntil' | 'safeHaven' | 'frontLight'> }
  | { type: 'agent.log'; agent: AgentName; to?: string; text: string; reason: string; at?: number }
  | { type: 'walk.end'; outcome: 'arrived' | 'ended' | 'incident'; summary: string }
  | { type: 'audit.run' }
  | { type: 'audit.result'; ranking: { street: string; minutes: number }[]; draft311: string };

export interface Envelope<M extends Msg = Msg> {
  id: string;
  walkId: string;
  ts: number; // ms epoch
  from: 'walker' | 'guardian' | 'shop' | 'room' | 'engine' | 'gateway';
  msg: M;
}
