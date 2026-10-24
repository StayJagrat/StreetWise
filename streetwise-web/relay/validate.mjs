const object = v => !!v && typeof v === 'object' && !Array.isArray(v);
const text = v => typeof v === 'string' && v.length > 0 && v.length <= 8000;
const number = v => typeof v === 'number' && Number.isFinite(v);
const coordinate = v => Array.isArray(v) && v.length === 2 && number(v[0]) && number(v[1]) && Math.abs(v[0]) <= 180 && Math.abs(v[1]) <= 90;
const boolean = v => typeof v === 'boolean';
const agent = v => ['scout', 'watcher', 'rescuer', 'reporter', 'auditor'].includes(v);
const stats = v => object(v) && number(v.score) && v.score >= 0 && v.score <= 100 && number(v.longestEmptyM) && v.longestEmptyM >= 0 && number(v.minutes) && v.minutes >= 0;
const thresholds = v => object(v) && ['stopSeconds', 'replySeconds', 'escalateSeconds'].every(k => number(v[k]) && v[k] > 0 && v[k] <= 3600);
const ranking = v => Array.isArray(v) && v.length <= 100 && v.every(x => object(x) && text(x.street) && number(x.minutes) && x.minutes >= 0);
export const validWalkId = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(v);
export const clientRoles = ['walker', 'guardian', 'shop', 'room'];

const checks = {
  'walk.reset': () => true,
  'walk.plan': m => object(m.plan) && text(m.plan.routeId) && text(m.plan.reason) && text(m.plan.guardian) && thresholds(m.plan.thresholds) && object(m.plan.stats) && stats(m.plan.stats.streetwise) && stats(m.plan.stats.shortest),
  'walk.accept': m => ['streetwise', 'usual'].includes(m.choice),
  'walk.start': m => m.replay === true,
  'walk.position': m => m.replay === true && coordinate(m.lngLat) && number(m.heading) && number(m.speed) && number(m.progress) && m.progress >= 0 && m.progress <= 1,
  'voice.say': m => agent(m.agent) && text(m.text),
  'checkin.ask': m => m.agent === 'watcher' && text(m.text) && text(m.reason) && number(m.windowSec) && m.windowSec > 0 && number(m.deadline) && m.deadline > 0,
  'checkin.reply': m => ['fine', 'help'].includes(m.reply) && ['voice', 'tap'].includes(m.via),
  'escalate': m => text(m.reason) && coordinate(m.lngLat),
  'guardian.alert': m => text(m.reason) && coordinate(m.lngLat) && text(m.where),
  'guardian.ack': m => text(m.by),
  'guardian.join': m => text(m.name),
  'place.update': m => object(m.place) && validWalkId(m.place.id) && text(m.place.openUntil) && /^(closed|24h|lobby|([01][0-9]|2[0-3]):[0-5][0-9])$/.test(m.place.openUntil) && boolean(m.place.safeHaven) && (m.place.frontLight === undefined || boolean(m.place.frontLight)),
  'agent.log': m => agent(m.agent) && text(m.text) && text(m.reason) && (m.to === undefined || text(m.to)) && (m.at === undefined || number(m.at)),
  'walk.end': m => ['arrived', 'ended', 'incident'].includes(m.outcome) && text(m.summary),
  'audit.run': () => true,
  'audit.result': m => ranking(m.ranking) && text(m.draft311),
};
const permissions = {
  walker: ['walk.reset', 'walk.accept', 'walk.start', 'walk.position', 'checkin.reply'],
  guardian: ['guardian.join', 'guardian.ack'],
  shop: ['place.update'],
  room: ['walk.reset', 'audit.run'],
};

// This is a demo relay, not authentication. Production needs scoped user/role tokens.
export function validateEnvelope(e, walkId, role) {
  if (!object(e) || !validWalkId(walkId) || !clientRoles.includes(role) || e.walkId !== walkId) return false;
  if (typeof e.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(e.id) || !number(e.ts) || e.ts < 0 || e.ts > 32503680000000) return false;
  if (!object(e.msg) || !Object.hasOwn(checks, e.msg.type) || !checks[e.msg.type](e.msg)) return false;
  if (e.from === 'engine') return role === 'walker' || role === 'room';
  return e.from === role && permissions[role].includes(e.msg.type);
}
