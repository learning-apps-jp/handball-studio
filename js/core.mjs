/** Pure match/event model. Percentages are 0–100; null means unknown. */
export function uid() {
  return globalThis.crypto?.randomUUID?.() ?? `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

export function createState() {
  return { schemaVersion: 1, teams: [], matches: [], tactics: [], inventory: [] };
}

export function createMatch({ name = '', opponent = '', date = new Date().toISOString().slice(0, 10), tournament = '', periodMinutes = 30, homeTeamId = '', awayTeamId = '' } = {}) {
  const match = { id: uid(), name, opponent, date, tournament, homeTeamId, awayTeamId, periodMinutes, period: 1,
    clock: { elapsed: 0, runningSince: null }, coverage: { shots: false, goalkeeping: false },
    events: [], revisions: [], video: { url: '', anchors: [], comments: [] } };
  validateMatch(match);
  return match;
}

const TYPES = new Set(['shot', 'turnover', 'warning', 'suspension', 'disqualification', 'timeout', 'substitution', 'seven_meter_awarded', 'interception', 'loose_ball', 'free_throw_won', 'free_throw_conceded', 'score_adjustment']);
const RESULTS = new Set(['goal', 'saved', 'miss', 'post', 'blocked']);
function check(condition, message) { if (!condition) throw new Error(message); }
function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
function nonnegative(value) { return finite(value) && value >= 0; }
function string(value, label, max = 1000, required = false) { check(typeof value === 'string' && value.length <= max && (!required || value.trim().length > 0), `${label}が不正です`); }
function optionalString(object, key, max = 1000) { if (object[key] != null) string(object[key], key, max); }
function id(value, label = 'ID') { string(value, label, 200, true); }
function unique(items, key, label) { const ids = new Set(); for (const item of items) { id(item[key], label); check(!ids.has(item[key]), `${label}が重複しています`); ids.add(item[key]); } }
function coord(value) { return value && nonnegative(value.x) && value.x <= 1 && nonnegative(value.y) && value.y <= 1; }
function safeTree(value, depth = 0) {
  check(depth < 30, 'データの階層が深すぎます');
  if (value == null || typeof value === 'boolean' || typeof value === 'string') return;
  if (typeof value === 'number') { check(finite(value), '数値が不正です'); return; }
  check(value && typeof value === 'object', 'JSONデータが不正です');
  for (const [key, item] of Object.entries(value)) { check(!['__proto__', 'prototype', 'constructor'].includes(key), '危険なプロパティ名です'); safeTree(item, depth + 1); }
}
function validateEvent(event) {
  check(event && typeof event === 'object', 'イベントが不正です');
  check(typeof event.id === 'string' && event.id.length > 0, 'イベントIDが必要です');
  check(TYPES.has(event.type), 'イベント種類が不正です');
  check(Number.isInteger(event.period) && event.period >= 1, 'ピリオドが不正です');
  check(nonnegative(event.clockMs), '試合時刻が不正です');
  check(typeof event.teamId === 'string' && event.teamId.length > 0, 'チームIDが必要です');
  if (event.type === 'shot') check(RESULTS.has(event.result), 'シュート結果が不正です');
  if (event.zone != null) check(Number.isInteger(event.zone) && event.zone >= 1 && event.zone <= 9, 'コースは1〜9です');
  if (event.position != null) check(nonnegative(event.position.x) && event.position.x <= 1 && nonnegative(event.position.y) && event.position.y <= 1, 'シュート位置が不正です');
  if (event.phase != null && event.phase !== '') check(['set', 'fast', 'quick'].includes(event.phase), '攻撃形態が不正です');
  if (event.sevenMeter != null) check(typeof event.sevenMeter === 'boolean', '7m指定が不正です');
  if (event.deleted != null) check(typeof event.deleted === 'boolean', '削除状態が不正です');
  if (event.emptyNet != null) check(typeof event.emptyNet === 'boolean', 'エンプティー指定が不正です');
  if (event.rebound != null) check(typeof event.rebound === 'boolean', 'リバウンド指定が不正です');
  if (event.ballType != null) string(event.ballType, 'ボールの種類', 100);
  if (event.shotType != null && event.shotType !== '') check(['wing', 'backcourt', 'pivot', 'breakthrough', 'unmarked', 'fast', 'other'].includes(event.shotType), 'シュート種類が不正です');
  for (const key of ['playerId', 'goalkeeperId', 'outPlayerId', 'defense', 'pattern', 'tacticId', 'subtype', 'missType', 'missLocation', 'createdAt']) optionalString(event, key, 200);
  if (event.type === 'score_adjustment') check(Number.isInteger(event.delta), 'スコア補正は整数です');
}
function validateMatch(match) {
  check(match && typeof match === 'object' && typeof match.id === 'string' && match.id, '試合IDが必要です');
  check(finite(match.periodMinutes) && match.periodMinutes > 0 && match.periodMinutes <= 120, '試合時間が不正です');
  check(Number.isInteger(match.period) && match.period >= 1, 'ピリオドが不正です');
  check(match.clock && nonnegative(match.clock.elapsed) && (match.clock.runningSince === null || nonnegative(match.clock.runningSince)), '時計が不正です');
  check(match.coverage && typeof match.coverage.shots === 'boolean' && typeof match.coverage.goalkeeping === 'boolean', '記録範囲が不正です');
  check(Array.isArray(match.events) && Array.isArray(match.revisions), 'イベント一覧が不正です');
  const ids = new Set();
  for (const event of match.events) { validateEvent(event); check(!ids.has(event.id), 'イベントIDが重複しています'); ids.add(event.id); }
  check(match.video && typeof match.video.url === 'string' && Array.isArray(match.video.anchors) && Array.isArray(match.video.comments), '動画データが不正です');
  for (const key of ['name', 'opponent', 'date', 'tournament', 'homeTeamId', 'awayTeamId']) string(match[key], key, key === 'date' ? 30 : 1000);
  if (match.finished != null) check(typeof match.finished === 'boolean', '試合終了状態が不正です');
  unique(match.revisions, 'id', '修正履歴ID');
  for (const revision of match.revisions) {
    id(revision.eventId); check(ids.has(revision.eventId), '修正対象イベントがありません');
    string(revision.createdAt, '修正日時', 100, true);
    validateEvent(revision.before); validateEvent(revision.after);
    check(revision.before.id === revision.eventId && revision.after.id === revision.eventId, '修正履歴IDが一致しません');
  }
  validateVideo(match.video);
}

function validateVideo(video) {
  string(video.url, '動画URL', 3000);
  if (video.urls != null) { check(!Array.isArray(video.urls) && typeof video.urls === 'object', '動画URL一覧が不正です'); for (const [period, url] of Object.entries(video.urls)) { check(/^[1-9]\d*$/.test(period), '動画ピリオドが不正です'); string(url, '動画URL', 3000); } }
  for (const anchor of video.anchors) { check(anchor && Number.isInteger(anchor.period) && anchor.period > 0 && nonnegative(anchor.clockMs) && nonnegative(anchor.videoSeconds), '動画同期点が不正です'); optionalString(anchor, 'id', 200); }
  unique(video.comments, 'id', 'コメントID');
  function comment(value, reply = false) {
    id(value.id); string(value.text, 'コメント本文', 20000); optionalString(value, 'author', 200); optionalString(value, 'authorName', 200); optionalString(value, 'tacticId', 200);
    if (!reply || value.period != null) check(Number.isInteger(value.period) && value.period > 0, 'コメントピリオドが不正です');
    if (value.videoSeconds != null) check(nonnegative(value.videoSeconds), 'コメント動画時刻が不正です');
    if (value.clockMs != null) check(nonnegative(value.clockMs), 'コメント試合時刻が不正です');
    if (value.tags != null) { check(Array.isArray(value.tags), 'タグが不正です'); for (const tag of value.tags) string(tag, 'タグ', 200); }
    for (const key of ['startSeconds', 'endSeconds']) if (value[key] != null) check(nonnegative(value[key]), '切抜き範囲が不正です');
    if (value.startSeconds != null && value.endSeconds != null) check(value.endSeconds > value.startSeconds, '切抜き終了は開始より後です');
    if (value.likes != null) { check(Array.isArray(value.likes), 'いいねが不正です'); for (const name of value.likes) if (typeof name === 'string') string(name, 'いいね名', 200); else { check(name && typeof name === 'object', 'いいねが不正です'); optionalString(name, 'name', 200); optionalString(name, 'id', 200); } }
    if (value.replies != null) { check(Array.isArray(value.replies), '返信が不正です'); unique(value.replies, 'id', '返信ID'); for (const item of value.replies) { check(item.replies == null || item.replies.length === 0, '返信の入れ子は未対応です'); comment(item, true); } }
  }
  for (const value of video.comments) comment(value);
}

function validateTactics(tactics) {
  unique(tactics, 'id', '作戦ID');
  for (const tactic of tactics) {
    string(tactic.name, '作戦名', 100, true); optionalString(tactic, 'description', 20000); optionalString(tactic, 'notes', 20000);
    check(Array.isArray(tactic.frames) && tactic.frames.length > 0 && tactic.frames.length <= 120, '作戦フレームが不正です');
    let initial;
    for (const frame of tactic.frames) {
      check(finite(frame.duration) && frame.duration >= 100 && frame.duration <= 30000 && coord(frame.ball), '作戦時間・ボール位置が不正です');
      check(Array.isArray(frame.players) && frame.players.length >= 8 && frame.players.length <= 13, '作戦選手人数が不正です'); unique(frame.players, 'id', '作戦選手ID');
      for (const player of frame.players) check(['home', 'away'].includes(player.team) && Number.isInteger(player.number) && player.number >= 0 && player.number <= 99 && coord(player), '作戦選手が不正です');
      const home = frame.players.filter(p => p.team === 'home').length; check(home >= 4 && home <= 7 && frame.players.length - home >= 4 && frame.players.length - home <= 6, '作戦チーム人数が不正です');
      const frameIds = frame.players.map(p => p.id); if (initial) check(frameIds.length === initial.length && initial.every(value => frameIds.includes(value)), 'フレーム間の選手IDが不一致です'); initial = frameIds;
      check(frame.ball.ownerId == null || frameIds.includes(frame.ball.ownerId), 'ボール所持者が存在しません');
      if (frame.lines != null) { check(Array.isArray(frame.lines) && frame.lines.length <= 100, '作戦線が不正です'); for (const line of frame.lines) check(['pass', 'move', 'draw'].includes(line.kind) && Array.isArray(line.points) && line.points.length >= 2 && line.points.length <= 2000 && line.points.every(coord), '作戦線が不正です'); }
    }
  }
}

export function validateState(state) {
  check(state && typeof state === 'object' && state.schemaVersion === 1, '未対応のデータ形式です');
  safeTree(state);
  for (const key of ['teams', 'matches', 'tactics', 'inventory']) check(Array.isArray(state[key]), `${key}は配列である必要があります`);
  const teamIds = new Set();
  const playerIds = new Set();
  for (const team of state.teams) {
    check(team && typeof team.id === 'string' && team.id && typeof team.name === 'string' && Array.isArray(team.players), 'チームが不正です');
    id(team.id); string(team.name, 'チーム名', 1000, true); optionalString(team, 'category', 200);
    check(!teamIds.has(team.id), 'チームIDが重複しています'); teamIds.add(team.id);
    for (const player of team.players) {
      check(player && typeof player.id === 'string' && player.id && typeof player.name === 'string', '選手が不正です');
      id(player.id); string(player.name, '選手名', 1000, true); optionalString(player, 'position', 200);
      if (player.number != null) check((typeof player.number === 'number' || typeof player.number === 'string') && Number.isInteger(Number(player.number)) && Number(player.number) >= 0 && Number(player.number) <= 999, '背番号が不正です');
      check(!playerIds.has(player.id), '選手IDが重複しています'); playerIds.add(player.id);
    }
  }
  const matchIds = new Set();
  for (const match of state.matches) {
    validateMatch(match); check(!matchIds.has(match.id), '試合IDが重複しています'); matchIds.add(match.id);
    check(teamIds.has(match.homeTeamId) && teamIds.has(match.awayTeamId) && match.homeTeamId !== match.awayTeamId, '試合チームの参照が不正です');
    const ownPlayers = tid => [...(state.teams.find(t => t.id === tid)?.players.map(p => p.id) ?? []), ...((match.rosterSnapshots ?? match.snapshots)?.[tid] ?? []).map(p => p.id)];
    for (const event of match.events) {
      check([match.homeTeamId, match.awayTeamId].includes(event.teamId), '試合に参加しないチームの記録です');
      if (event.playerId) check(ownPlayers(event.teamId).includes(event.playerId), '記録選手の所属が一致しません');
      if (event.outPlayerId) check(ownPlayers(event.teamId).includes(event.outPlayerId), '交代選手の所属が一致しません');
      if (event.goalkeeperId) check(ownPlayers(event.teamId === match.homeTeamId ? match.awayTeamId : match.homeTeamId).includes(event.goalkeeperId), 'GKの所属が一致しません');
    }
    if (match.rosters != null) { check(typeof match.rosters === 'object' && !Array.isArray(match.rosters), '出場名簿が不正です'); for (const [tid, ids] of Object.entries(match.rosters)) check([match.homeTeamId, match.awayTeamId].includes(tid) && Array.isArray(ids) && new Set(ids).size === ids.length && ids.every(value => ownPlayers(tid).includes(value)), '出場名簿の参照が不正です'); }
    for (const snapshots of [match.rosterSnapshots, match.snapshots]) if (snapshots != null) { check(typeof snapshots === 'object' && !Array.isArray(snapshots), '名簿スナップショットが不正です'); for (const [tid, players] of Object.entries(snapshots)) { check([match.homeTeamId, match.awayTeamId].includes(tid) && Array.isArray(players), '名簿スナップショットが不正です'); unique(players, 'id', '名簿スナップショット選手ID'); for (const p of players) { string(p.name, '保存選手名', 1000, true); optionalString(p, 'position', 200); if (p.number != null) check(Number.isInteger(Number(p.number)) && Number(p.number) >= 0 && Number(p.number) <= 999, '保存背番号が不正です'); } } }
  }
  validateTactics(state.tactics);
  unique(state.inventory, 'id', '備品ID');
  for (const item of state.inventory) {
    string(item.name, '備品名', 1000, true); optionalString(item, 'category', 200); optionalString(item, 'unit', 200);
    check(Number.isInteger(item.quantity) && item.quantity >= 0 && Number.isInteger(item.minimum) && item.minimum >= 0, '在庫数が不正です');
    if (item.history != null) { check(Array.isArray(item.history), '入出庫履歴が不正です'); for (const entry of item.history) { string(entry.at, '入出庫日時', 100, true); check(Number.isInteger(entry.delta), '入出庫数が不正です'); } }
  }
  return true;
}

export function activeEvents(match) { return match.events.filter(event => !event.deleted); }

export function addEvent(match, event) {
  const next = { id: uid(), period: match.period, clockMs: clockMs(match), playerId: null, goalkeeperId: null, sevenMeter: false, deleted: false, createdAt: new Date().toISOString(), ...event };
  validateEvent(next);
  check(!match.events.some(existing => existing.id === next.id), 'イベントIDが重複しています');
  return { ...match, events: [...match.events, structuredClone(next)] };
}

export function reviseEvent(match, id, patch) {
  const index = match.events.findIndex(event => event.id === id);
  check(index !== -1, '修正するイベントが見つかりません');
  check(!Object.hasOwn(patch, 'id') || patch.id === id, 'イベントIDは変更できません');
  const before = match.events[index];
  const after = { ...before, ...structuredClone(patch), id };
  validateEvent(after);
  const revision = { id: uid(), eventId: id, createdAt: new Date().toISOString(), before: structuredClone(before), after: structuredClone(after) };
  return { ...match, events: match.events.map((event, i) => i === index ? after : event), revisions: [...match.revisions, revision] };
}

export function removeEvent(match, id) { return reviseEvent(match, id, { deleted: true }); }

export function summarize(matches, teamId, playerId) {
  const relevant = matches.filter(match => match.homeTeamId === teamId || match.awayTeamId === teamId || match.events.some(event => event.teamId === teamId));
  const complete = { shots: relevant.length > 0 && relevant.every(match => match.coverage.shots), goalkeeping: relevant.length > 0 && relevant.every(match => match.coverage.goalkeeping) };
  const totals = { goals: 0, shotGoals: 0, scoreAdjustment: 0, shots: 0, saves: 0, conceded: 0, misses: 0, turnovers: 0, warnings: 0, suspensions: 0, disqualifications: 0, timeouts: 0, sevenMeterGoals: 0, sevenMeterShots: 0, sevenMeterSaves: 0, sevenMeterConceded: 0, normalGoals: 0, normalShots: 0, normalSaves: 0, normalConceded: 0, interceptions: 0, looseBalls: 0, freeThrowsWon: 0, freeThrowsConceded: 0, sevenMeterAwarded: 0, shotRate: null, saveRate: null, shotRate7m: null, saveRate7m: null, shotRateNormal: null, saveRateNormal: null, complete };
  const counters = { turnover: 'turnovers', warning: 'warnings', suspension: 'suspensions', disqualification: 'disqualifications', timeout: 'timeouts', interception: 'interceptions', loose_ball: 'looseBalls', free_throw_won: 'freeThrowsWon', free_throw_conceded: 'freeThrowsConceded', seven_meter_awarded: 'sevenMeterAwarded' };
  for (const match of relevant) {
    for (const event of activeEvents(match)) {
      const own = event.teamId === teamId;
      if (own && (playerId == null || event.playerId === playerId)) {
        if (event.type === 'shot') {
          totals.shots++;
          const prefix = event.sevenMeter ? 'sevenMeter' : 'normal'; totals[`${prefix}Shots`]++;
          if (event.result === 'goal') { totals.goals++; totals.shotGoals++; totals[`${prefix}Goals`]++; } else totals.misses++;
        } else if (event.type === 'score_adjustment') { totals.goals += event.delta; totals.scoreAdjustment += event.delta; }
        else if (counters[event.type]) totals[counters[event.type]]++;
      }
      if (!own && event.type === 'shot' && !event.emptyNet && (playerId == null || event.goalkeeperId === playerId)) {
        const prefix = event.sevenMeter ? 'sevenMeter' : 'normal';
        if (event.result === 'saved') { totals.saves++; totals[`${prefix}Saves`]++; }
        if (event.result === 'goal') { totals.conceded++; totals[`${prefix}Conceded`]++; }
      }
    }
  }
  if (complete.shots && totals.shots > 0) totals.shotRate = totals.shotGoals / totals.shots * 100;
  if (complete.goalkeeping && totals.saves + totals.conceded > 0) totals.saveRate = totals.saves / (totals.saves + totals.conceded) * 100;
  if (complete.shots && totals.sevenMeterShots > 0) totals.shotRate7m = totals.sevenMeterGoals / totals.sevenMeterShots * 100;
  if (complete.shots && totals.normalShots > 0) totals.shotRateNormal = totals.normalGoals / totals.normalShots * 100;
  if (complete.goalkeeping && totals.sevenMeterSaves + totals.sevenMeterConceded > 0) totals.saveRate7m = totals.sevenMeterSaves / (totals.sevenMeterSaves + totals.sevenMeterConceded) * 100;
  if (complete.goalkeeping && totals.normalSaves + totals.normalConceded > 0) totals.saveRateNormal = totals.normalSaves / (totals.normalSaves + totals.normalConceded) * 100;
  return totals;
}

export function clockMs(match, now = Date.now()) {
  return match.clock.elapsed + (match.clock.runningSince == null ? 0 : Math.max(0, now - match.clock.runningSince));
}

export function formatClock(ms) {
  const seconds = Math.floor(Math.max(0, Number.isFinite(ms) ? ms : 0) / 1000);
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}
