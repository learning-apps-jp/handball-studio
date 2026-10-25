import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, createMatch, addEvent, reviseEvent, removeEvent, activeEvents, summarize, validateState, clockMs, formatClock } from '../js/core.mjs';
import { defaultFrame } from '../js/tactics.mjs';

function match() { return createMatch({ homeTeamId: 'a', awayTeamId: 'b' }); }
function shot(m, fields = {}) { return addEvent(m, { teamId: 'a', playerId: 'p7', type: 'shot', result: 'goal', ...fields }); }

test('empty-net goals affect the score and shooting rate but never goalkeeper rates',()=>{let m=match();m.coverage={shots:true,goalkeeping:true};m=shot(m,{emptyNet:true,goalkeeperId:'g1'});m=shot(m,{result:'saved',goalkeeperId:'g1'});const a=summarize([m],'a'),g=summarize([m],'b','g1');assert.equal(a.goals,1);assert.equal(a.shotRate,50);assert.equal(g.conceded,0);assert.equal(g.saves,1);assert.equal(g.saveRate,100);});

test('one shot drives own goal and opponent conceded without double counting', () => {
  const m = shot(match(), { goalkeeperId: 'g1' });
  assert.equal(summarize([m], 'a').goals, 1);
  assert.equal(summarize([m], 'b').conceded, 1);
  assert.equal(summarize([m], 'b', 'g1').conceded, 1);
  assert.equal(summarize([m], 'b', 'g2').conceded, 0);
  assert.equal(m.events.length, 1);
});

test('unknown keeper does not accrue to any player and non-target shots do not count as saves', () => {
  let m = shot(match(), { teamId: 'b', result: 'saved' });
  m = shot(m, { teamId: 'b', result: 'post', goalkeeperId: 'g1' });
  assert.equal(summarize([m], 'a').saves, 1);
  assert.equal(summarize([m], 'a', 'g1').saves, 0);
});

test('coverage must be complete across all relevant matches before rates appear', () => {
  let m = shot(match()); m = shot(m, { result: 'saved' });
  assert.equal(summarize([m], 'a').shotRate, null);
  m = { ...m, coverage: { shots: true, goalkeeping: true } };
  assert.equal(summarize([m], 'a').shotRate, 50);
  assert.equal(summarize([m, match()], 'a').shotRate, null);
  const unrelated = createMatch({ homeTeamId: 'c', awayTeamId: 'd' });
  assert.equal(summarize([m, unrelated], 'a').shotRate, 50);
  assert.equal(summarize([], 'a').shotRate, null);
});

test('keeper change and 7m shots are independently attributed', () => {
  let m = shot(match(), { teamId: 'b', goalkeeperId: 'g1', result: 'saved', sevenMeter: true });
  m = shot(m, { teamId: 'b', goalkeeperId: 'g2', result: 'goal', period: 2 });
  m.coverage.goalkeeping = true;
  assert.equal(summarize([m], 'a', 'g1').saveRate, 100);
  assert.equal(summarize([m], 'a', 'g2').saveRate, 0);
  assert.equal(summarize([m], 'a').saveRate, 50);
});

test('revision and tombstone update derived totals while preserving source and history', () => {
  const source = shot(match(), { id: 'e1' });
  const revised = reviseEvent(source, 'e1', { result: 'miss' });
  assert.equal(summarize([source], 'a').goals, 1);
  assert.equal(summarize([revised], 'a').goals, 0);
  assert.equal(revised.revisions[0].before.result, 'goal');
  const removed = removeEvent(revised, 'e1');
  assert.equal(removed.events.length, 1);
  assert.equal(activeEvents(removed).length, 0);
  assert.equal(summarize([removed], 'a').shots, 0);
  assert.equal(removed.revisions.length, 2);
});

test('duplicate IDs and malformed imports are rejected', () => {
  const m = shot(match(), { id: 'e1' });
  assert.throws(() => shot(m, { id: 'e1' }), /重複/);
  assert.throws(() => reviseEvent(m, 'e1', { id: 'other' }), /変更/);
  assert.throws(() => shot(m, { zone: 10 }), /コース/);
  assert.throws(() => shot(m, { position: { x: 1.1, y: .5 } }), /位置/);
  const state = { ...createState(), teams: [{ id: 'a', name: 'A', players: [{ id: 'p7', name: '選手7' }] }, { id: 'b', name: 'B', players: [] }], matches: [m] };
  assert.equal(validateState(JSON.parse(JSON.stringify(state))), true);
  assert.throws(() => validateState({ ...state, schemaVersion: 99 }), /未対応/);
  assert.throws(() => validateState({ ...state, matches: [{ ...m, events: [...m.events, ...m.events] }] }), /重複/);
});

test('extended match actions stay separate from shots and score correction never inflates shooting rates', () => {
  let m = shot(match(), { sevenMeter: true, emptyNet: true, shotType: 'wing' });
  m = shot(m, { result: 'miss', shotType: 'backcourt', missLocation: 'upper', subtype: 'bar' });
  for (const type of ['seven_meter_awarded', 'interception', 'loose_ball', 'free_throw_won', 'free_throw_conceded']) m = addEvent(m, { teamId: 'a', playerId: 'p7', type });
  m = addEvent(m, { teamId: 'a', type: 'score_adjustment', delta: 3 });
  m.coverage.shots = true;
  const s = summarize([m], 'a');
  assert.equal(s.goals, 4); assert.equal(s.shotGoals, 1); assert.equal(s.shots, 2); assert.equal(s.shotRate, 50);
  assert.equal(s.sevenMeterGoals, 1); assert.equal(s.sevenMeterShots, 1); assert.equal(s.shotRate7m, 100); assert.equal(s.shotRateNormal, 0);
  for (const key of ['sevenMeterAwarded', 'interceptions', 'looseBalls', 'freeThrowsWon', 'freeThrowsConceded']) assert.equal(s[key], 1);
  assert.equal(summarize([m], 'a', 'p7').goals, 1);
  assert.throws(() => addEvent(m, { teamId: 'a', type: 'score_adjustment', delta: 1.5 }), /整数/);
  assert.throws(() => shot(m, { shotType: 'unknown' }), /種類/);
});

test('7m and ordinary goalkeeper rates exclude post, block and miss', () => {
  let m = match();
  for (const [sevenMeter, result] of [[true, 'saved'], [true, 'goal'], [false, 'saved'], [false, 'saved'], [false, 'goal'], [true, 'post'], [false, 'miss'], [false, 'blocked']]) m = shot(m, { teamId: 'b', goalkeeperId: 'g1', sevenMeter, result });
  m.coverage.goalkeeping = true;
  const s = summarize([m], 'a', 'g1');
  assert.equal(s.saveRate7m, 50); assert.ok(Math.abs(s.saveRateNormal - 200 / 3) < 1e-10); assert.equal(s.saves, 3); assert.equal(s.conceded, 2);
});

function validFixture() {
  const state = createState();
  state.teams = [{ id: 'a', name: 'A', players: [{ id: 'p7', number: 7, name: 'P', position: 'CB' }] }, { id: 'b', name: 'B', players: [{ id: 'g1', number: 1, name: 'G', position: 'GK' }] }];
  state.matches = [shot(match(), { id: 'e1', goalkeeperId: 'g1' })];
  return state;
}

test('import validates team/player/GK references and permits archived roster snapshots', () => {
  const state = validFixture(); assert.equal(validateState(state), true);
  const wrongTeam = structuredClone(state); wrongTeam.matches[0].events[0].teamId = 'other'; assert.throws(() => validateState(wrongTeam), /チーム/);
  const wrongKeeper = structuredClone(state); wrongKeeper.matches[0].events[0].goalkeeperId = 'p7'; assert.throws(() => validateState(wrongKeeper), /GK/);
  state.matches[0].rosterSnapshots = { a: structuredClone(state.teams[0].players) }; state.matches[0].rosters = { a: ['p7'] }; state.teams[0].players = [];
  assert.equal(validateState(state), true);
  const badRoster = structuredClone(state); badRoster.matches[0].rosters.a = ['missing']; assert.throws(() => validateState(badRoster), /名簿/);
  delete state.matches[0].events[0].playerId; assert.equal(validateState(state), true);
});

test('nested corruption in backup is rejected before replacement', () => {
  const cases = [
    state => { state.matches[0].name = {}; },
    state => { state.matches[0].video.anchors = [{ period: 1, clockMs: -1, videoSeconds: 3 }]; },
    state => { state.matches[0].video.comments = [{ id: 'c', period: 1, text: 'ok', tags: [42] }]; },
    state => { state.matches[0].revisions = [{ id: 'r', eventId: 'missing', createdAt: 'now', before: {}, after: {} }]; },
    state => { state.inventory = [{ id: 'stock', name: 'ball', quantity: -1, minimum: 1 }]; },
    state => { state.tactics = [{ id: 't', name: '作戦', frames: [{ duration: 1000, ball: { x: 2, y: 0 }, players: [] }] }]; },
    state => { state.teams[0].players[0].number = -1; },
    state => { state.metadata = JSON.parse('{"__proto__":{"bad":true}}'); }
  ];
  for (const change of cases) { const state = validFixture(); change(state); assert.throws(() => validateState(state)); }
});

test('complete nested modules roundtrip through a validated backup', () => {
  const state = validFixture();
  state.tactics = [{ id: 't', name: 'クロス', frames: [defaultFrame(), defaultFrame('5-1')] }];
  state.inventory = [{ id: 'i', name: 'ボール', quantity: 5, minimum: 2, category: '備品', unit: '個', history: [{ at: '2026-10-25T12:00:00Z', delta: 5 }] }];
  state.matches[0] = reviseEvent(state.matches[0], 'e1', { zone: 9 });
  state.matches[0].video = { url: '', urls: { 1: 'https://youtu.be/dQw4w9WgXcQ' }, anchors: [{ period: 1, clockMs: 0, videoSeconds: 5 }], comments: [{ id: 'c', period: 1, videoSeconds: 10, text: '場面', tags: ['攻撃'], tacticId: 't', likes: ['指導者'], replies: [{ id: 'r', text: '確認', author: '選手' }] }] };
  assert.equal(validateState(JSON.parse(JSON.stringify(state))), true);
});

test('events survive serialized backup and clocks preserve paused time and period-local time', () => {
  const m = shot(match(), { period: 2, clockMs: 612000 });
  const restored = JSON.parse(JSON.stringify(m));
  assert.equal(restored.events[0].clockMs, 612000);
  assert.equal(restored.events[0].period, 2);
  assert.equal(clockMs({ clock: { elapsed: 10000, runningSince: 50000 } }, 53500), 13500);
  assert.equal(clockMs({ clock: { elapsed: 13500, runningSince: null } }, 99999), 13500);
  assert.equal(formatClock(612000), '10:12');
  assert.equal(formatClock(-1000), '00:00');
});
