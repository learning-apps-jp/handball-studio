/** Stable stored keys; labels are presentation only. */
export const TURNOVER_TYPES = Object.freeze([
  ['pass', 'パスミス'], ['catch', 'キャッチミス'], ['charge', 'チャージ'],
  ['steps', 'オーバーステップ'], ['dribble', 'ダブルドリブル'], ['passive', 'パッシブ'], ['other', 'その他']
].map(entry => Object.freeze(entry)));
const aliases = new Map(TURNOVER_TYPES.flatMap(([key, label]) => [[key, key], [label, key]]));
for (const [label, key] of [['チャージング', 'charge'], ['ステップ', 'steps'], ['パッシブプレー', 'passive']]) aliases.set(label, key);

export function normalizeTurnoverType(value) {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > 200) throw new Error('ミス種別は200文字以内の文字列です');
  return aliases.get(value) ?? value;
}

/** Read both generations of data, preserving unknown user-defined labels verbatim. */
export function eventDetailLabel(event) {
  if (!event || event.type !== 'turnover') return '';
  const raw = event.missType || event.subtype || '';
  const key = normalizeTurnoverType(raw);
  return TURNOVER_TYPES.find(([value]) => value === key)?.[1] ?? key;
}

/** A classification answer cannot replace the ID, timestamp, owner team or player. */
export function prepareTurnoverEvent(base, value) {
  if (!base || typeof base.id !== 'string' || !base.id || typeof base.teamId !== 'string' || !base.teamId || !Number.isInteger(base.period) || base.period < 1 || !Number.isFinite(base.clockMs) || base.clockMs < 0 || (base.type != null && base.type !== 'turnover')) throw new Error('ミス記録のID・チーム・時刻が不正です');
  const selected = normalizeTurnoverType(value);
  return { ...structuredClone(base), type: 'turnover', missType: selected, subtype: selected };
}

const eventTypes = new Set(['shot','turnover','warning','suspension','disqualification','timeout','substitution','seven_meter_awarded','interception','loose_ball','free_throw_won','free_throw_conceded','score_adjustment']);
const shotFields = ['result','shotType','ballType','rebound','emptyNet','defense','pattern','goalkeeperId','phase','zone','sevenMeter','position','missLocation','tacticId'];
const editFields = new Set(['type','playerId','period','clockMs','result','shotType','ballType','rebound','emptyNet','defense','pattern','goalkeeperId','phase','zone','sevenMeter','missType','delta','outPlayerId']);
const textOrNull = (value, label, max = 200) => { if (value == null || value === '') return null; if (typeof value !== 'string' || value.length > max) throw new Error(`${label}が不正です`); return value; };

/** Build a revision patch. Explicit nulls remove stale fields under merge-based revision. */
export function prepareRecordEdit(event, values) {
  if (!event || !values || typeof values !== 'object' || Array.isArray(values)) throw new Error('編集内容が不正です');
  if (Object.keys(values).some(key => !editFields.has(key))) throw new Error('ID・チームなど固定された属性は編集できません');
  const type = values.type ?? event.type;
  if (!eventTypes.has(type)) throw new Error('イベント種類が不正です');
  const period = values.period ?? event.period, clockMs = values.clockMs ?? event.clockMs;
  if (!Number.isInteger(period) || period < 1 || !Number.isFinite(clockMs) || clockMs < 0) throw new Error('ピリオド・試合時刻が不正です');
  const patch = { type, playerId: textOrNull(Object.hasOwn(values, 'playerId') ? values.playerId : event.playerId, '選手'), period, clockMs };
  if (type === 'shot') {
    if (!Object.hasOwn(values, 'result') || !['goal','saved','miss','post','blocked'].includes(values.result)) throw new Error('シュートへの編集には結果の明示が必要です');
    const previous = event.type === 'shot' ? event : {};
    for (const key of shotFields) patch[key] = key === 'position' ? structuredClone(previous.position ?? null) : Object.hasOwn(values, key) ? values[key] : previous[key] ?? null;
    patch.result = values.result;
    for (const key of ['shotType','ballType','defense','pattern','goalkeeperId','phase','missLocation','tacticId']) patch[key] = textOrNull(patch[key], key, key === 'ballType' ? 100 : 200);
    if (patch.shotType != null && !['wing','backcourt','pivot','breakthrough','unmarked','fast','other'].includes(patch.shotType)) throw new Error('シュート種類が不正です');
    if (patch.phase != null && !['set','fast','quick'].includes(patch.phase)) throw new Error('攻撃形態が不正です');
    if (patch.zone != null && (!Number.isInteger(patch.zone) || patch.zone < 1 || patch.zone > 9)) throw new Error('ゴールコースが不正です');
    for (const key of ['rebound','emptyNet','sevenMeter']) { if (patch[key] == null) patch[key] = false; if (typeof patch[key] !== 'boolean') throw new Error('シュートの指定が不正です'); }
    if (patch.result === 'saved' && patch.emptyNet) throw new Error('セーブはエンプティーと同時に記録できません。GKまたはシュート結果を確認してください');
    if (patch.emptyNet) patch.goalkeeperId = null;
  } else for (const key of shotFields) patch[key] = null;
  if (type === 'turnover') { const selected = normalizeTurnoverType(Object.hasOwn(values, 'missType') ? values.missType : event.type === 'turnover' ? event.missType || event.subtype : ''); patch.missType = selected; patch.subtype = selected; }
  else { patch.missType = null; patch.subtype = null; }
  if (type === 'score_adjustment') { const delta = Object.hasOwn(values, 'delta') ? values.delta : event.type === 'score_adjustment' ? event.delta : null; if (!Number.isInteger(delta)) throw new Error('得点補正の増減を整数で指定してください'); patch.delta = delta; }
  else patch.delta = null;
  if (type === 'substitution') { patch.outPlayerId = textOrNull(Object.hasOwn(values, 'outPlayerId') ? values.outPlayerId : event.type === 'substitution' ? event.outPlayerId : null, '退く選手'); if (!patch.playerId || patch.playerId === patch.outPlayerId) throw new Error('入る選手と退く選手を確認してください'); }
  else patch.outPlayerId = null;
  return patch;
}
