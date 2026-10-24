import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIntent } from '../src/lib/voice.ts';
import { initialState, reduce } from '../src/lib/store.ts';

test('voice never treats negation or incidental words as an all-clear', () => {
  for (const phrase of ["I'm not fine", 'not okay', 'I need help']) assert.equal(parseIntent(phrase), 'help');
  for (const phrase of ['fine weather today', 'yes', 'the shop is okay']) assert.equal(parseIntent(phrase), null);
  assert.equal(parseIntent("I'm fine"), 'fine');
  assert.equal(parseIntent('Find somewhere to wait'), 'wait');
  assert.equal(parseIntent('end my walk'), 'end');
});

const event = msg => ({ id: crypto.randomUUID(), ts: Date.now(), walkId: 'test', from: 'engine', msg });
test('guardian acknowledgment does not resolve the incident; walk end removes location', () => {
  let state = initialState();
  state = reduce(state, event({ type: 'guardian.alert', incidentId: 'one', reason: 'No response', lngLat: [-122.4,37.78], where: 'Market Street' }));
  state = reduce(state, event({ type: 'guardian.ack', by: 'Maya', incidentId: 'one' }));
  assert.equal(state.phase, 'escalated');
  assert.equal(state.alert.ackBy, 'Maya');
  state = reduce(state, event({ type: 'walk.position', lngLat: [-122.4,37.78], heading:0, progress:.3, speed:1, replay:true }));
  state = reduce(state, event({ type: 'walk.end', outcome:'ended', summary:'Ended before arrival' }));
  assert.equal(state.phase, 'ended');
  assert.equal(state.position, undefined);
  assert.deepEqual(state.trail, []);
});
