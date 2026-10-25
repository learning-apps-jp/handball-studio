import {activeEvents,uid} from './core.mjs';
import {eventDetailLabel} from './event-details.mjs';

const shotTypes={wing:'サイド',backcourt:'ミドル',pivot:'ポスト',breakthrough:'カットイン',unmarked:'ノーマーク',fast:'速攻',other:'その他'};
const percent=(a,b,complete=true)=>complete&&b>0?a/b*100:null;
const rate=value=>value==null?'—':`${value.toFixed(1)}%`;

export function selectAnalysisMatches(matches,teamId,filters={}) {
  const ids=filters.matchIds==null?null:new Set(filters.matchIds);
  return matches.filter(m=>(m.homeTeamId===teamId||m.awayTeamId===teamId)&&(!ids||ids.has(m.id))&&(!filters.tournament||m.tournament===filters.tournament));
}

function eventMatches(event,teamId,filters) {
  if(event.type==='score_adjustment')return false;
  if(filters.period==='extra'){if(event.period<3)return false;}
  else if(filters.period&&Number(filters.period)!==event.period)return false;
  const players=filters.playerIds?.length?new Set(filters.playerIds):null;
  if(players){const player=event.teamId===teamId?event.playerId:event.type==='shot'?event.goalkeeperId:null;if(!players.has(player))return false;}
  if(filters.shotType){if(event.type!=='shot'||(filters.shotType==='unknown'?Boolean(event.shotType):event.shotType!==filters.shotType))return false;}
  if(filters.goalkeeperId){if(event.type!=='shot'||(filters.goalkeeperId==='unknown'?Boolean(event.goalkeeperId):event.goalkeeperId!==filters.goalkeeperId))return false;}
  if(filters.sevenMeter&&filters.sevenMeter!=='all'){if(event.type!=='shot'||Boolean(event.sevenMeter)!==(filters.sevenMeter==='only'))return false;}
  if(filters.emptyNet&&filters.emptyNet!=='all'){if(event.type!=='shot'||Boolean(event.emptyNet)!==(filters.emptyNet==='only'))return false;}
  return true;
}

export function filterAdvancedEvents(matches,teamId,filters={}) {
  const selected=selectAnalysisMatches(matches,teamId,filters);
  const own=[],opponent=[];
  for(const match of selected)for(const event of activeEvents(match))if(eventMatches(event,teamId,filters)){
    const row={matchId:match.id,event};
    if(event.teamId===teamId)own.push(row);else if(event.teamId===match.homeTeamId||event.teamId===match.awayTeamId)opponent.push(row);
  }
  return {matches:selected,own,opponent,complete:{shots:selected.length>0&&selected.every(m=>m.coverage.shots),goalkeeping:selected.length>0&&selected.every(m=>m.coverage.goalkeeping)}};
}

export function summarizeAdvanced(matches,teamId,filters={}) {
  const filtered=filterAdvancedEvents(matches,teamId,filters);
  const own=filtered.own.map(r=>r.event),against=filtered.opponent.map(r=>r.event);
  const shots=own.filter(e=>e.type==='shot'),goals=shots.filter(e=>e.result==='goal').length,turnovers=own.filter(e=>e.type==='turnover');
  const gkShots=against.filter(e=>e.type==='shot'&&!e.emptyNet),saves=gkShots.filter(e=>e.result==='saved').length,conceded=gkShots.filter(e=>e.result==='goal').length;
  const missTypes=new Map();for(const e of turnovers){const name=eventDetailLabel(e)||'未指定';missTypes.set(name,(missTypes.get(name)||0)+1);}
  const zones=[false,true].map(sevenMeter=>{
    const relevant=gkShots.filter(e=>Boolean(e.sevenMeter)===sevenMeter);
    const cells=Array.from({length:9},(_,i)=>{
      const events=relevant.filter(e=>e.zone===i+1),saved=events.filter(e=>e.result==='saved').length,goals=events.filter(e=>e.result==='goal').length;
      return {zone:i+1,saves:saved,conceded:goals,shots:events.length,rate:percent(saved,saved+goals,filtered.complete.goalkeeping)};
    });
    const saved=relevant.filter(e=>e.result==='saved').length,goals=relevant.filter(e=>e.result==='goal').length;
    return {sevenMeter,saves:saved,conceded:goals,shots:relevant.length,rate:percent(saved,saved+goals,filtered.complete.goalkeeping),unknownZone:relevant.filter(e=>!e.zone).length,cells};
  });
  return {...filtered,goals,shots:shots.length,turnovers:turnovers.length,sevenMeterAwarded:own.filter(e=>e.type==='seven_meter_awarded').length,
    shotRate:percent(goals,shots.length,filtered.complete.shots),estimatedEfficiency:percent(goals,shots.length+turnovers.length,filtered.complete.shots),
    saves,conceded,saveRate:percent(saves,saves+conceded,filtered.complete.goalkeeping),gkZones:zones,missTypes:[...missTypes].map(([name,count])=>({name,count})),
    shotResults:['saved','miss','post','blocked'].map(result=>({result,count:shots.filter(e=>e.result===result).length})),
    emptyNetShots:against.filter(e=>e.type==='shot'&&e.emptyNet).length};
}

export function combinePlayerIds(groups,groupIds) {
  const selected=new Set(groupIds);
  return [...new Set(groups.filter(g=>selected.has(g.id)).flatMap(g=>g.playerIds))];
}

export function setTournamentForMatches(matches,matchIds,name) {
  if(typeof name!=='string'||name.length>100)throw new Error('大会名は100文字以内です。');
  const ids=new Set(matchIds);
  return matches.map(m=>ids.has(m.id)?{...m,tournament:name.trim()}:m);
}

function node(tag,text,attrs={}) {
  const element=document.createElement(tag);if(text!=null)element.textContent=String(text);
  for(const [key,value] of Object.entries(attrs)){if(key==='class')element.className=value;else if(key==='checked'||key==='disabled')element[key]=Boolean(value);else element.setAttribute(key,String(value));}
  return element;
}
function select(label,entries,value,change) {
  const wrapper=node('label',null,{class:'field'}),title=node('span',label),input=node('select');
  for(const [id,text] of entries){const option=node('option',text,{value:id});option.selected=String(value??'')===String(id);input.append(option);}
  input.addEventListener('change',()=>change(input.value));wrapper.append(title,input);return wrapper;
}
function button(label,callback,attrs={}){const b=node('button',label,{type:'button',class:'btn',...attrs});b.addEventListener('click',callback);return b;}
function table(head,rows){const wrap=node('div',null,{class:'table-wrap'}),t=node('table'),thead=node('thead'),h=node('tr'),body=node('tbody');head.forEach(x=>h.append(node('th',x)));thead.append(h);for(const row of rows){const tr=node('tr');for(const value of row)tr.append(node('td',value));body.append(tr);}t.append(thead,body);wrap.append(t);return wrap;}

export function mountAdvancedAnalysis(container,{state,matches,teamId,save,toast=()=>{},readonly=false}) {
  const source=matches||state.matches;
  const applicable=source.filter(m=>m.homeTeamId===teamId||m.awayTeamId===teamId);
  const filters={matchIds:applicable.map(m=>m.id),period:'',playerIds:[],shotType:'',goalkeeperId:'',sevenMeter:'all',emptyNet:'all',tournament:''};
  let chosenGroup='',chosenPlayer='',disposed=false;
  const groups=()=>Array.isArray(state.preferences?.playerGroups)?state.preferences.playerGroups.filter(g=>g&&g.teamId===teamId&&typeof g.name==='string'&&Array.isArray(g.playerIds)):[];
  const players=()=>{
    const combined=[...(state.teams.find(t=>t.id===teamId)?.players||[]),...applicable.flatMap(m=>(m.rosterSnapshots||m.snapshots)?.[teamId]||[])];
    return [...new Map(combined.map(p=>[p.id,p])).values()];
  };
  const playerName=id=>{for(const t of state.teams){const p=t.players.find(p=>p.id===id);if(p)return `#${p.number??'—'} ${p.name}（${t.name}）`;}return id;};
  function section(title){const s=node('section',null,{class:'panel section-gap'});s.append(node('h2',title));container.append(s);return s;}
  async function persistChange(change,revert){try{change();await save();if(!disposed)render();toast('この端末に保存しました');}catch(error){revert?.();toast(error.message);}}
  function render() {
    if(disposed)return;container.replaceChildren();const style=node('style');style.textContent='.advanced-filter-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(185px,1fr));gap:12px}.advanced-match-list{display:flex;flex-wrap:wrap;gap:10px;max-height:200px;overflow:auto}.advanced-match-list label{min-height:44px;display:flex;align-items:center;gap:8px}.advanced-goal-maps{display:grid;grid-template-columns:repeat(auto-fit,minmax(235px,1fr));gap:20px}.advanced-goal-map{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.advanced-goal-map>div{border:1px solid #d6e1d1;border-radius:9px;padding:12px 5px;text-align:center;background:#f6faf4}.advanced-goal-map strong,.advanced-goal-map small{display:block}.advanced-groups{display:flex;flex-wrap:wrap;gap:10px}.advanced-groups label{display:flex;align-items:center;gap:6px;min-height:44px}.advanced-analysis button,.advanced-analysis select,.advanced-analysis input:not([type=checkbox]){min-height:44px}.advanced-analysis select{max-width:100%}.advanced-analysis .toolbar{flex-wrap:wrap}.advanced-analysis h3{margin-top:20px}';container.append(style);container.classList.add('advanced-analysis');
    const controls=section('詳細フィルター・GK分析');controls.append(node('p','この分析は上で選んだチーム・集計範囲を対象にします。任意試合と前後半、選手、シュート条件を組み合わせられます。',{class:'muted'}));
    const grid=node('div',null,{class:'advanced-filter-grid'});controls.append(grid);
    const update=(key,value)=>{filters[key]=value;render();};
    grid.append(select('前後半',[['','すべて'],['1','前半'],['2','後半'],['extra','延長（3P以降）']],filters.period,v=>update('period',v)));
    grid.append(select('選手',[['','すべて'],...players().map(p=>[p.id,`#${p.number??'—'} ${p.name}`])],chosenPlayer,v=>{chosenPlayer=v;chosenGroup='';filters.playerIds=v?[v]:[];render();}));
    grid.append(select('別名合算グループ',[['','選択なし'],...groups().map(g=>[g.id,g.name])],chosenGroup,v=>{chosenGroup=v;chosenPlayer='';filters.playerIds=combinePlayerIds(groups(),v?[v]:[]);render();}));
    grid.append(select('シュート種類',[['','すべて'],...Object.entries(shotTypes),['unknown','種類未指定']],filters.shotType,v=>update('shotType',v)));
    const keeperIds=[...new Set(applicable.flatMap(m=>activeEvents(m).filter(e=>e.type==='shot'&&e.goalkeeperId).map(e=>e.goalkeeperId)))];
    grid.append(select('GK（シュートを受ける側）',[['','すべて'],...keeperIds.map(id=>[id,playerName(id)]),['unknown','GK未指定']],filters.goalkeeperId,v=>update('goalkeeperId',v)));
    grid.append(select('7mスロー',[['all','すべて'],['normal','通常シュートのみ'],['only','7mのみ']],filters.sevenMeter,v=>update('sevenMeter',v)));
    grid.append(select('エンプティー',[['all','すべて'],['exclude','無人ゴールを除外'],['only','無人ゴールのみ']],filters.emptyNet,v=>update('emptyNet',v)));
    grid.append(select('大会・リーグ',[['','すべて'],...[...new Set(applicable.map(m=>m.tournament).filter(Boolean))].map(name=>[name,name])],filters.tournament,v=>update('tournament',v)));
    controls.append(node('p','シュート種類・GK・7m・エンプティーを絞ると、その属性を持つシュートだけが対象になります。ミスや7m獲得イベントは対象外になります。選手フィルターは自チームのプレーと、その選手がGKとして受けたシュートに適用します。',{class:'muted'}));
    const details=node('details'),summary=node('summary',`任意試合を選択（${filters.matchIds.length} / ${applicable.length}試合）`),list=node('div',null,{class:'advanced-match-list'}),actions=node('div',null,{class:'toolbar section-gap'});
    actions.append(button('すべて選択',()=>{filters.matchIds=applicable.map(m=>m.id);render();}),button('選択を解除',()=>{filters.matchIds=[];render();}));
    for(const match of applicable){const label=node('label'),input=node('input',null,{type:'checkbox',value:match.id,checked:filters.matchIds.includes(match.id)});input.addEventListener('change',()=>{filters.matchIds=input.checked?[...new Set([...filters.matchIds,match.id])]:filters.matchIds.filter(id=>id!==match.id);render();});label.append(input,node('span',`${match.date} ${match.name||match.opponent||'試合'}${match.tournament?' / '+match.tournament:''}`));list.append(label);}
    details.append(summary,actions,list);controls.append(details);
    const result=summarizeAdvanced(source,teamId,filters),stats=section('絞り込み結果');
    stats.append(table(['対象試合','得点 / シュート','成功率','ミス','7m獲得','推定得点効率'],[[result.matches.length,`${result.goals} / ${result.shots}`,rate(result.shotRate),result.turnovers,result.sevenMeterAwarded,rate(result.estimatedEfficiency)]]));
    stats.append(node('p','推定得点効率＝記録された得点 ÷（シュート数＋ミス数）。スコア補正は除外します。実際の攻撃回数ではなく、未記録のミスや攻撃継続を反映しない参考値です。公式サービスと同じ計算方式であるとは確認していません。全シュート未確認の試合を含むと率は表示しません。',{class:'notice'}));
    const keeper=section('GKコース別セーブ率');keeper.append(node('p',`セーブ率＝セーブ÷（セーブ＋失点）。枠外・ポスト・ブロック・無人ゴールは母数から除外します。無人ゴールへの被シュート：${result.emptyNetShots}本。全GK記録の確認前は率を表示しません。コース番号は記録画面の9分割と同じです。`,{class:'muted'}));
    const maps=node('div',null,{class:'advanced-goal-maps'});keeper.append(maps);
    for(const zone of result.gkZones){const card=node('div');card.append(node('h3',zone.sevenMeter?'7mスロー':'通常シュート'),node('p',`${zone.saves}セーブ / ${zone.conceded}失点 · ${rate(zone.rate)} · コース未指定 ${zone.unknownZone}本`,{class:'muted'}));const map=node('div',null,{class:'advanced-goal-map'});for(const cell of zone.cells){const c=node('div');c.append(node('small',`コース${cell.zone}`),node('strong',rate(cell.rate)),node('small',`${cell.saves}セーブ / ${cell.conceded}失点`));map.append(c);}card.append(map);maps.append(card);}
    const mistakes=section('ミスの内訳・7m獲得');mistakes.append(table(['ミス種別','件数'],result.missTypes.map(m=>[m.name,m.count])));if(!result.missTypes.length)mistakes.append(node('p','対象条件のミス記録はありません。未記録を0件と断定するものではありません。',{class:'muted'}));mistakes.append(node('p',`記録された7m獲得：${result.sevenMeterAwarded}回。7mシュートの本数とは別に集計します。`,{class:'muted'}));
    renderGroups();if(!readonly)renderTournament();
  }
  function renderGroups(){
    const panel=section('同一選手の別名・IDを合算');panel.append(node('p','複数の選手IDを同じ人として集計する設定です。元の名簿・試合記録・IDは変更しません。重なるグループ同士の数値は足し合わせないでください。',{class:'muted'}));
    const existing=groups();for(const group of existing){const row=node('div',null,{class:'toolbar section-gap'}),r=summarizeAdvanced(source,teamId,{...filters,playerIds:group.playerIds});row.append(node('strong',group.name),node('span',`${group.playerIds.length}ID · ${r.goals}得点 / ${r.shots}本 · ${rate(r.shotRate)}`));if(!readonly)row.append(button('グループ解除',()=>{const before=state.preferences?.playerGroups;persistChange(()=>{state.preferences.playerGroups=before.filter(g=>g.id!==group.id);if(chosenGroup===group.id){chosenGroup='';filters.playerIds=[];}},()=>{state.preferences.playerGroups=before;});}));panel.append(row);}
    if(readonly)return;
    const form=node('form'),name=node('input',null,{type:'text',maxlength:'80',placeholder:'例：山田選手（旧名・新名を合算）','aria-label':'合算グループ名',required:'true'}),choices=node('div',null,{class:'advanced-groups'});
    for(const player of players()){const label=node('label'),input=node('input',null,{type:'checkbox',value:player.id});label.append(input,node('span',`#${player.number??'—'} ${player.name}`));choices.append(label);}
    form.append(node('h3','新しい合算グループ'),name,choices);const submit=node('button','選択したIDを合算グループに保存',{type:'submit',class:'btn primary'});form.append(submit);form.addEventListener('submit',async e=>{e.preventDefault();const ids=[...choices.querySelectorAll('input:checked')].map(i=>i.value),text=name.value.trim();if(ids.length<2||!text)return toast('グループ名と2つ以上の選手IDを選択してください');const before=state.preferences;const next={...(before||{}),playerGroups:[...(Array.isArray(before?.playerGroups)?before.playerGroups:[]),{id:uid(),teamId,name:text,playerIds:[...new Set(ids)]}]};submit.disabled=true;await persistChange(()=>{state.preferences=next;},()=>{if(before===undefined)delete state.preferences;else state.preferences=before;});if(submit.isConnected)submit.disabled=false;});panel.append(form);
  }
  function renderTournament(){
    const panel=section('選択試合の大会・リーグを一括設定');panel.append(node('p','任意試合チェックと大会フィルターに合う試合へ適用します。全選手・全イベントの記録はそのまま残ります。空欄で適用すると大会の所属を解除します。',{class:'muted'}));
    const form=node('form'),label=node('label','大会・リーグ名',{class:'field'}),input=node('input',null,{type:'text',maxlength:'100',placeholder:'大会名（空欄で解除）'});label.append(input);const submit=node('button','選択試合に適用',{type:'submit',class:'btn'});form.append(label,submit);form.addEventListener('submit',async e=>{e.preventDefault();const ids=selectAnalysisMatches(source,teamId,filters).map(m=>m.id);if(!ids.length)return toast('適用する試合を選択してください');const before=state.matches,sourceNames=new Map(source.map(m=>[m.id,m.tournament]));submit.disabled=true;await persistChange(()=>{state.matches=setTournamentForMatches(state.matches,ids,input.value);const names=new Map(state.matches.map(m=>[m.id,m.tournament]));for(const m of source)if(names.has(m.id))m.tournament=names.get(m.id);filters.tournament='';},()=>{state.matches=before;for(const m of source)m.tournament=sourceNames.get(m.id);});if(submit.isConnected)submit.disabled=false;});panel.append(form);
  }
  render();return ()=>{disposed=true;};
}
