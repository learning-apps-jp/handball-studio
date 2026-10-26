/** Text-only, side-effect-free feedback for one canonical shot event. */
export function shotRecordFeedback(event,{attackingTeam,defendingTeam,shooter,goalkeeper,defensive=false}={}) {
  if(event?.type!=='shot')return null;
  const text=(value,fallback)=>typeof value==='string'&&value.trim()?value.trim():fallback;
  const attack=text(attackingTeam,'攻撃側チーム'),defense=text(defendingTeam,'守備側チーム');
  const player=text(shooter,'選手未指定'),keeper=text(goalkeeper,'未指定');
  const penalty=event.sevenMeter?'（7m）':'',prefix=event.sevenMeter?'7mスロー。':'';
  if(event.result==='goal') {
    const title=defensive?`失点 · GK ${event.emptyNet?'不在':keeper}${penalty}`:`得点 · ${player}${penalty}`;
    const detail=event.emptyNet?`${prefix}${attack}の${player}が得点。${defense}はGK不在（エンプティー）。個人GKの失点には計上しません。`:`${prefix}${attack}の${player}が得点。${defense}のGK ${keeper}側の失点として記録しました。`;
    return {title,detail,kind:defensive?'conceded':'goal'};
  }
  if(event.result==='saved')return {title:`セーブ · GK ${keeper}${penalty}`,detail:`${prefix}${defense}のGK ${keeper}が、${attack}の${player}のシュートを止めました。得点は変わりません。`,kind:'save'};
  const result=event.result==='post'?'ポスト・バー':event.result==='blocked'?'ブロック':'枠外';
  return {title:`${result} · ${player}${penalty}`,detail:`${prefix}${attack}の${player}のシュートは${result}。${defense}のGKセーブには計上しません。得点は変わりません。`,kind:'miss'};
}
