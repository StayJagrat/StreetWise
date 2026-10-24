// Match the database projection and preserve the existing PWA wire contract.
export function updateHistory(history, envelope, limit = 400) {
  const type = envelope.msg.type;
  let next = history;
  if (type === 'walk.reset') next = next.filter(e => ['place.update', 'guardian.join'].includes(e.msg.type));
  if (type === 'walk.start') next = next.filter(e => ['agent.log', 'walk.plan', 'walk.accept', 'place.update', 'guardian.join'].includes(e.msg.type));
  if (type === 'walk.position') next = next.filter(e => e.msg.type !== 'walk.position');
  if (type === 'walk.end') next = next.filter(e => !['walk.position', 'guardian.alert', 'escalate', 'checkin.ask'].includes(e.msg.type));
  return [...next, envelope].slice(-limit);
}
