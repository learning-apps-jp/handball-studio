import {formatClock} from './core.mjs';

const results={goal:'ゴール',saved:'セーブ',miss:'枠外',post:'ポスト',blocked:'ブロック'};
const phases=[['fast','速攻'],['quick','クイックスタート'],['set','セットOF']];
const shotTypes=[['wing','サイド'],['breakthrough','カットイン'],['backcourt','ミドル'],['pivot','ポスト'],['unmarked','ノーマーク']];
const legacyShotTypes=[['fast','速攻（従来分類）'],['other','その他（従来分類）']];
const ballTypes=[['loop','ループ'],['spin','スピン'],['bounce','バウンド'],['feint','スカシ'],['fast','速球']];
const zones=['左上','上','右上','左','中央','右','左下','下','右下'];
const missDirections=[['left','左'],['high','上'],['right','右'],['left_post','左ポスト'],['bar','バー'],['right_post','右ポスト']];
const clone=value=>structuredClone(value);
const clamp=value=>Math.max(0,Math.min(1,value));

export function createRecordFlowDraft(event,{editing=false}={}){
  if(!event||typeof event.id!=='string'||!event.id||typeof event.teamId!=='string'||!event.teamId||event.type!=='shot')throw new Error('記録のID・チーム・種類を確認してください');
  if(!Number.isInteger(event.period)||event.period<1||!Number.isFinite(event.clockMs)||event.clockMs<0)throw new Error('記録開始時の時計が不正です');
  if(event.result!=null&&!Object.hasOwn(results,event.result))throw new Error('シュート結果が不正です');
  const details=editing?{phase:event.phase??null,shotType:event.shotType??null,ballType:event.ballType??'',zone:event.zone??null,position:clone(event.position??null),missLocation:event.missLocation??null,emptyNet:event.emptyNet??false,rebound:event.rebound??false}:{phase:null,shotType:null,ballType:'',zone:null,position:null,missLocation:null,emptyNet:false,rebound:false};
  const draft={step:1,status:'draft',editing:Boolean(editing),initialEmptyNet:Boolean(event.emptyNet),initialSavedEmpty:Boolean(editing&&event.result==='saved'&&event.emptyNet===true),event:{...clone(event),result:event.result??null,...details}};
  return editing?answerRecordFlow(draft,{}):draft;
}

/** Immutable answers cannot change the original clock, ID, team or shooter. */
export function answerRecordFlow(draft,patch){
  if(draft.status!=='draft')throw new Error('確定中または終了した記録は変更できません');
  const allowed=new Set(['phase','shotType','ballType','zone','position','missLocation','emptyNet','rebound','result']);
  if(Object.keys(patch).some(key=>!allowed.has(key)))throw new Error('固定された記録情報は変更できません');
  const event={...clone(draft.event),...clone(patch)};
  if(Object.hasOwn(patch,'result')&&patch.result==='saved')event.emptyNet=false;
  if(event.result!=null&&!Object.hasOwn(results,event.result))throw new Error('シュート結果を選択してください');
  if(event.phase!=null&&event.phase!==''&&!phases.some(([value])=>value===event.phase))throw new Error('攻撃形態が不正です');
  if(event.shotType!=null&&event.shotType!==''&&![...shotTypes,...(draft.editing?legacyShotTypes:[])].some(([value])=>value===event.shotType))throw new Error('シュート種類が不正です');
  if(typeof event.ballType!=='string'||event.ballType.length>100)throw new Error('球種は100文字以内です');
  if(event.zone!=null&&(!Number.isInteger(event.zone)||event.zone<1||event.zone>9))throw new Error('コースが不正です');
  if(event.position!=null&&(!Number.isFinite(event.position.x)||!Number.isFinite(event.position.y)||event.position.x<0||event.position.x>1||event.position.y<0||event.position.y>1))throw new Error('シュート位置が不正です');
  if(event.missLocation!=null&&!missDirections.some(([value])=>value===event.missLocation))throw new Error('枠外方向が不正です');
  if(typeof event.emptyNet!=='boolean'||typeof event.rebound!=='boolean')throw new Error('シュート詳細が不正です');
  const unchangedLegacySavedEmpty=draft.initialSavedEmpty&&draft.event.result==='saved'&&draft.event.emptyNet===true&&!Object.hasOwn(patch,'result')&&!Object.hasOwn(patch,'emptyNet');
  if(event.result==='saved'&&event.emptyNet&&!unchangedLegacySavedEmpty)throw new Error('GKセーブとエンプティーは同時に指定できません');
  return {...draft,event};
}

export function changeRecordFlowParticipant(draft,field,id,participants={}){
  if(draft.status!=='draft')throw new Error('確定中または終了した記録は変更できません');
  if(!['playerId','goalkeeperId'].includes(field))throw new Error('選手またはGKだけを変更できます');
  const value=id==null||id===''?null:id,list=field==='playerId'?participants.shooters:participants.goalkeepers;
  if(value!=null&&(typeof value!=='string'||!Array.isArray(list)||!list.some(item=>item&&item.id===value)))throw new Error('選択した選手・GKが対象の名簿にありません');
  const event={...clone(draft.event),[field]:value};if(field==='goalkeeperId')event.emptyNet=false;
  return {...draft,event};
}

export function missDirectionAnswer(direction){
  if(!missDirections.some(([value])=>value===direction))throw new Error('枠外方向が不正です');
  return {result:['left_post','bar','right_post'].includes(direction)?'post':'miss',missLocation:direction,zone:null};
}

/** Result changes only clear details that cannot describe the newly selected outcome. */
export function recordFlowResultChangePatch(draft,result){
  if(draft.status!=='draft')throw new Error('確定中または終了した記録は変更できません');
  if(!Object.hasOwn(results,result))throw new Error('シュート結果が不正です');
  const patch={result},previous=draft.event.result;
  if(result==='saved')patch.emptyNet=false;
  if(result===previous)return patch;
  const outside=value=>['miss','post'].includes(value);
  if(outside(result)||outside(previous))patch.zone=null;
  const direction=draft.event.missLocation;
  const compatible=outside(result)&&direction&&missDirectionAnswer(direction).result===result;
  if(!compatible)patch.missLocation=null;
  return patch;
}

export function recordFlowResultLabel(result,{defensive=false,sevenMeter=false,fallback='シュート'}={}){
  const names=defensive?{goal:'失点',saved:'セーブ',miss:'枠外',post:'ポスト',blocked:'ブロック'}:{goal:'ゴール',saved:'シュート失敗',miss:'枠外',post:'ポスト',blocked:'ブロックされた'};
  return result&&names[result]?`${sevenMeter?'7m ':''}${names[result]}`:fallback;
}

export function prepareRecordFlowEvent(draft,{withoutCourse=false,withoutPosition=false}={}){
  if(draft.status!=='draft'||!draft.event.result||!Object.hasOwn(results,draft.event.result))throw new Error('シュート結果を選んでください');
  const event=clone(draft.event);
  if(event.result==='saved'&&event.emptyNet&&!draft.initialSavedEmpty)throw new Error('GKセーブとエンプティーは同時に指定できません');
  if(withoutCourse){event.zone=null;event.missLocation=null;}
  if(withoutPosition)event.position=null;
  if(event.emptyNet&&(!draft.editing||!draft.initialEmptyNet))event.goalkeeperId=null;
  return event;
}

export function isRecordPositionTap(start,end,threshold=10){return Boolean(start&&end&&start.pointerId===end.pointerId&&Math.hypot(end.x-start.x,end.y-start.y)<=threshold);}

export function recordFlowCoursePrompt(labels,result,{dynamic=false}={}){
  if(labels.defensive===true)return result==='goal'?'どこに決められましたか？':result==='saved'?'どこを止めましたか？':'ゴールコース・外れた方向';
  if(dynamic)return result==='goal'?'どこに決めましたか？':result==='saved'?'どこを止められましたか？':result==='blocked'?'どこでブロックされましたか？':'ゴールコース・外れた方向';
  return labels.coursePrompt||'ゴールコース';
}

function element(tag,text,attrs={}){
  const node=document.createElement(tag);if(text!=null)node.textContent=String(text);
  for(const [key,value] of Object.entries(attrs)){if(key==='class')node.className=value;else if(key==='disabled'||key==='checked')node[key]=Boolean(value);else node.setAttribute(key,String(value));}
  return node;
}
function button(label,action,attrs={}){const node=element('button',label,{type:'button',class:'rf-button',...attrs});node.addEventListener('click',action);return node;}
let instance=0;

/** Owns one modal session; onCommit receives the frozen-start event exactly once per attempt. */
export function mountRecordFlow(dialog,{event,labels={},onCommit,onCancel=()=>{},allowResults,editing=false,participants}={}){
  if(typeof onCommit!=='function')throw new Error('記録の確定処理が必要です');
  let draft=createRecordFlowDraft(event,{editing}),disposed=false,finished=false,pointer=null,failedEvent=null,optionalOpen=true;
  const originalFocus=document.activeElement,originalLabel=dialog.getAttribute('aria-labelledby'),originalModal=dialog.getAttribute('aria-modal');
  const name=`record-flow-${++instance}`;
  const choices=allowResults?.length?[...new Set(allowResults)]:editing?Object.keys(results):event.result==null?['miss','saved','blocked']:[];
  if(choices.some(value=>!Object.hasOwn(results,value)))throw new Error('選択できる結果が不正です');
  const separateOutcome=Boolean(!editing&&event.sevenMeter&&event.result==null&&choices.includes('goal'));
  const initialPosition=clone(event.position??null);
  if(separateOutcome)draft.step=0;
  let restoreRaf=0;
  dialog.setAttribute('data-record-flow','true');dialog.setAttribute('aria-labelledby',`${name}-title`);dialog.setAttribute('aria-modal','true');
  const root=element('div',null,{class:'record-flow'}),style=element('style');
  style.textContent=`
    .record-flow{--rf-accent:#c1ff4d}
    dialog[data-record-flow]{width:min(960px,calc(100vw - 24px));max-width:960px;padding:0;max-height:calc(100dvh - 24px);overflow:hidden;border-radius:18px;border:1px solid #bfd4c8;color:#193b37}
    .record-flow{display:flex;flex-direction:column;max-height:calc(100dvh - 28px);font-family:inherit;background:#f6f8f3}
    .record-flow *{box-sizing:border-box}.rf-header{padding:16px 20px 12px;background:#123d39;color:white;flex:none}.rf-header h2{font-size:19px;line-height:1.45;margin:0 0 5px;overflow-wrap:anywhere}.rf-header p{margin:0;font-size:12px;line-height:1.5;color:#d5e8db}.rf-body{padding:14px 18px;overflow-y:auto;overscroll-behavior:contain;min-height:0}.rf-columns{display:grid;grid-template-columns:1fr 1fr;gap:14px}.rf-card{border:1px solid #d5dfd3;border-radius:12px;background:white;padding:12px;min-width:0}.rf-card h3,.rf-group-label{font-size:13px;font-weight:700;line-height:1.4;margin:0 0 7px;display:block}.rf-group{margin-bottom:11px}.rf-chips{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.rf-button{border:1px solid #c4d4c9;border-radius:9px;background:white;color:#193b37;padding:8px;font:inherit;font-size:12px;line-height:1.3;min-height:44px;cursor:pointer;touch-action:manipulation;overflow-wrap:anywhere}.rf-button[aria-pressed=true]{background:#d3ebda;border-color:#287051;box-shadow:inset 0 0 0 1px #287051}.rf-button:focus-visible,.rf-court:focus-visible,.rf-ball-input:focus-visible{outline:3px solid #e99e42;outline-offset:2px}.rf-button:disabled{opacity:.4;cursor:default}.rf-primary{background:#123d39;color:white;border-color:#123d39}.rf-danger{color:#a23835}.rf-zone{min-height:55px;font-size:15px}.rf-checks{display:flex;gap:10px;flex-wrap:wrap}.rf-checks label{display:flex;align-items:center;gap:7px;font-size:12px;min-height:44px}.rf-checks input{width:23px;height:23px;min-height:23px;accent-color:#245a43}.rf-ball-input{width:100%;min-height:44px;border:1px solid #becdc0;border-radius:9px;padding:8px;font:inherit;font-size:13px;margin-top:6px;background:white;color:#193b37}.rf-footer{padding:10px 18px;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;border-top:1px solid #d5dfd3;background:white;flex:none}.rf-footer-actions{display:flex;gap:8px;flex-wrap:wrap}.rf-muted{font-size:11px;line-height:1.5;color:#657a6c;margin:7px 0 0}.rf-error{color:#a3322c;background:#fff0e9;border-radius:8px;padding:9px;font-size:13px;line-height:1.5;margin:0 0 10px}.rf-result-label{padding:7px;border-radius:8px;background:#edf5e9;font-size:12px;margin:0 0 8px}.rf-position-layout{display:grid;grid-template-columns:minmax(0,1fr) 220px;gap:14px;align-items:start}.rf-court{display:block;width:100%;max-height:440px;background:#efd8b1;border-radius:12px;touch-action:pan-y;user-select:none;-webkit-user-select:none}.rf-review{font-size:13px;line-height:1.8;overflow-wrap:anywhere}.rf-outcome{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;padding:18px 0}.rf-outcome .rf-button{font-size:18px;min-height:80px}.rf-progress{font-variant-numeric:tabular-nums}.rf-participants{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;padding:10px 18px;background:#e8f0e6;border-bottom:1px solid #d1ddce;flex:none}.rf-participant-field{display:grid;gap:4px;min-width:0;font-size:11px;line-height:1.35;font-weight:650}.rf-participant-field select{width:100%;min-width:0;min-height:44px;background:white;border:1px solid #a9bead;border-radius:8px;padding:7px 10px;color:#193b37;font:inherit;font-size:14px}.rf-goal-frame{width:100%;max-width:360px;margin:8px auto;padding:6px;border:8px solid #fff;border-bottom-width:3px;border-radius:2px;box-shadow:0 0 0 2px #597c6c,0 4px 9px #244c3c1a;background-color:#bdd7c5;background-image:repeating-linear-gradient(0deg,transparent,transparent 15px,#ffffff66 16px,#ffffff66 17px),repeating-linear-gradient(90deg,transparent,transparent 15px,#ffffff66 16px,#ffffff66 17px)}.rf-goal-frame .rf-zone{background:#fffffff0;min-height:55px;box-shadow:0 1px 3px #3b604522}.rf-goal-frame .rf-zone[aria-pressed=true]{background:#bde0c9}.rf-participant-field select:focus-visible{outline:3px solid #e99e42;outline-offset:2px}.record-flow [hidden]{display:none!important}
    dialog[data-record-flow]{border:1px solid #1e3954;box-shadow:0 24px 90px #07172988}.record-flow{background:#eaf0f4;color:#142d45}.rf-header{background:#081d34;border-bottom:4px solid var(--rf-accent);display:grid;grid-template-columns:minmax(0,1fr) auto;gap:0 15px;align-items:center}.rf-header h2{color:#f5f9ff;grid-column:1}.rf-header .rf-progress{color:#b9cada;grid-column:1}.rf-action-badge{grid-column:2;grid-row:1/3;background:var(--rf-accent);color:#081d34;font-size:14px;font-weight:900;letter-spacing:1px;padding:11px 13px;border-radius:10px;white-space:nowrap}.rf-columns{grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr)}.rf-course-card{border:1px solid #b5c7d7;box-shadow:0 3px 14px #13334b0d}.rf-card h3,.rf-group-label{color:#15324c}.rf-button{color:#17344f;border-color:#b9cbd9;font-weight:650}.rf-button[aria-pressed=true]{background:#e2eff4;border-color:#244e6e;box-shadow:inset 0 0 0 1px #244e6e}.rf-primary{background:var(--rf-accent);color:#081d34;border-color:var(--rf-accent);font-weight:800}.rf-participants{background:#dfe9f0;border-color:#bbcbd8}.rf-participant-field select{border-color:#9eb5c8;color:#122f49;font-weight:650}.rf-result-pills .rf-button{border-radius:24px;min-height:46px;font-weight:800}.rf-result-pills [data-flow-result=goal]{border-color:#77a924}.rf-result-pills [data-flow-result=saved]{border-color:#299caf}.rf-result-pills [data-flow-result=miss],.rf-result-pills [data-flow-result=post],.rf-result-pills [data-flow-result=blocked]{border-color:#d07966}.rf-result-pills [data-flow-result=goal][aria-pressed=true]{background:#c1ff4d;color:#081d34;border-color:#9bd132;box-shadow:none}.rf-result-pills [data-flow-result=saved][aria-pressed=true]{background:#58e5f3;color:#081d34;border-color:#34b8c5;box-shadow:none}.rf-result-pills [data-flow-result=miss][aria-pressed=true],.rf-result-pills [data-flow-result=post][aria-pressed=true],.rf-result-pills [data-flow-result=blocked][aria-pressed=true]{background:#ffad8c;color:#50291f;box-shadow:none}.rf-goal-frame{background-color:#112c45;border-color:#f7fbff;box-shadow:0 0 0 3px #224c6c,0 7px 18px #061e3433;background-image:repeating-linear-gradient(0deg,transparent,transparent 15px,#ffffff33 16px,#ffffff33 17px),repeating-linear-gradient(90deg,transparent,transparent 15px,#ffffff33 16px,#ffffff33 17px)}.rf-goal-frame .rf-zone{background:#163a59f0;color:#f4fbff;border:1px solid #6490ad;min-height:62px;font-size:16px;font-weight:800}.rf-goal-frame .rf-zone:hover,.rf-goal-frame .rf-zone:focus-visible{background:#275575;border-color:var(--rf-accent)}.rf-goal-frame .rf-zone[aria-pressed=true]{background:var(--rf-accent);color:#081d34;border-color:var(--rf-accent);box-shadow:none}.rf-optional-card{background:#f5f8fb;border:1px solid #c8d5df}.rf-optional-card summary{font-size:13px;font-weight:750;color:#2a4c65;min-height:44px;display:flex;align-items:center;cursor:pointer;list-style:revert}.rf-optional-card summary:before{content:'＋';font-size:18px;margin-right:7px}.rf-optional-card[open] summary:before{content:'−'}.rf-footer{border-color:#bccfdd}.rf-muted{color:#566f82}.rf-review{background:#eff5f9}.rf-header .rf-action-badge{font-variant-numeric:tabular-nums}
    @media(max-width:600px){.rf-columns{grid-template-columns:1fr}.rf-position-layout{grid-template-columns:1fr}.rf-review{display:none}.rf-header{padding:13px 15px}.rf-header h2{font-size:17px}.rf-body{padding:12px}.rf-footer{padding:9px 12px}.rf-footer-actions{margin-left:auto}.rf-outcome{gap:6px}.rf-outcome .rf-button{font-size:15px}.rf-court{max-height:52vh}}
    @media(max-height:700px) and (min-width:601px){.rf-header{padding:10px 16px}.rf-header h2{font-size:17px}.rf-body{padding:10px 14px}.rf-group{margin-bottom:7px}.rf-card{padding:9px}.rf-court{max-height:390px}}
  `;
  dialog.replaceChildren(style,root);
  const header=element('header',null,{class:'rf-header'}),title=element('h2',null,{id:`${name}-title`}),progress=element('p',null,{class:'rf-progress','aria-live':'polite'}),actionBadge=element('span',null,{class:'rf-action-badge','aria-hidden':'true'});
  header.append(title,progress,actionBadge);const participantBar=element('div',null,{class:'rf-participants'}),body=element('div',null,{class:'rf-body'}),footer=element('footer',null,{class:'rf-footer'});root.append(header,participantBar,body,footer);
  const periodLabel=period=>period===1?'前半':period===2?'後半':`延長${period-2} `;
  function participantLabel(field){if(field==='goalkeeperId'&&draft.event.emptyNet)return 'GK不在（エンプティー）';const id=draft.event[field];if(!id)return field==='playerId'?'選手未指定':'GK未指定';const list=field==='playerId'?participants?.shooters:participants?.goalkeepers;const found=Array.isArray(list)?list.find(item=>item?.id===id):null;if(found)return String(found.label??id);if(id===event[field])return field==='playerId'?(labels.player||'選手未指定'):(labels.gk||'GK未指定');return field==='playerId'?'選手未指定':'GK未指定';}
  function keeperTitleLabel(){if(draft.event.emptyNet)return 'GK不在';if(!draft.event.goalkeeperId)return 'GK未指定';const label=participantLabel('goalkeeperId');return label==='GK未指定'||/^GK(?:\s|#)/.test(label)?label:`GK ${label}`;}
  function titleText(){const dynamic=choices.length>0||editing;const resultLabel=dynamic?recordFlowResultLabel(draft.event.result,{defensive:labels.defensive,sevenMeter:draft.event.sevenMeter,fallback:labels.action||labels.actionLabel||(separateOutcome?'相手の7m':'シュート✕')}):labels.action||labels.actionLabel||results[draft.event.result]||'シュート✕';const who=labels.defensive?keeperTitleLabel():participants?participantLabel('playerId'):(labels.player||'選手未指定');return `${editing?'修正中 · ':''}${resultLabel}：${who} / ${periodLabel(draft.event.period)}${formatClock(draft.event.clockMs)} の記録`;}
  function renderParticipants(){
    participantBar.replaceChildren();participantBar.hidden=!participants||draft.step!==1;if(participantBar.hidden)return;
    const order=labels.defensive?['goalkeeperId','playerId']:['playerId','goalkeeperId'];
    for(const field of order){const shooter=field==='playerId',team=shooter?(participants.shootingTeamLabel||labels.team||'攻撃側'):(participants.goalkeepingTeamLabel||'守備側');const label=element('label',null,{class:'rf-participant-field'}),caption=element('span',`${team}の${shooter?(labels.defensive?'相手選手（任意）':'選手（任意）'):'GK（任意）'}`),select=element('select',null,{'data-flow-participant':field});
      const isEmpty=!shooter&&draft.event.emptyNet,blank=element('option',isEmpty?'GK不在（エンプティー）':shooter?'選手未指定':'GK未指定',{value:''});select.append(blank);
      const list=shooter?participants.shooters:participants.goalkeepers,seen=new Set();for(const item of Array.isArray(list)?list:[]){if(!item||typeof item.id!=='string'||seen.has(item.id))continue;seen.add(item.id);select.append(element('option',String(item.label??item.id),{value:item.id}));}
      const current=draft.event[field];if(current&&!seen.has(current)&&!isEmpty){const prior=element('option',`${participantLabel(field)}（過去の記録）`,{value:current,disabled:true});select.append(prior);}select.value=isEmpty?'':current||'';
      select.addEventListener('change',()=>{try{draft=changeRecordFlowParticipant(draft,field,select.value,participants);failedEvent=null;render();root.querySelector(`[data-flow-participant="${field}"]`)?.focus({preventScroll:true});}catch(e){error(e.message);}});label.append(caption,select);participantBar.append(label);
    }
  }
  function update(patch){draft=answerRecordFlow(draft,patch);failedEvent=null;}
  function appendGroup(target,label,entries,key){
    const group=element('div',null,{class:'rf-group'}),heading=element('span',label,{class:'rf-group-label'}),chips=element('div',null,{class:'rf-chips',role:'group','aria-label':label});
    for(const [value,text] of entries){const b=button(text,()=>{update({[key]:draft.event[key]===value?(key==='ballType'?'':null):value});render();},{'aria-pressed':draft.event[key]===value,'data-flow-option':key,'data-value':value});chips.append(b);}
    group.append(heading,chips);target.append(group);return group;
  }
  function render(){
    if(disposed)return;const result=draft.event.result,accent=result==='goal'?(labels.defensive?'#ff8977':'#c1ff4d'):result==='saved'?'#58e5f3':['miss','post','blocked'].includes(result)?'#ffad8c':'#c1ff4d';root.style.setProperty('--rf-accent',accent);actionBadge.textContent=result==='goal'?(labels.defensive?'LOSS':'GOAL'):result==='saved'?'SAVE':result==='blocked'?'BLOCK':result?'MISS':'SHOT';title.textContent=titleText();progress.textContent=draft.step===0?'7mの結果を選択':`STEP ${draft.step} / 2 · ${draft.step===1?'コース・シュートの詳細':'シュート位置を選択'}`;
    body.replaceChildren();footer.replaceChildren();renderParticipants();
    if(draft.step===0)renderOutcome();else if(draft.step===1)renderCourse();else renderPosition();
    footer.prepend(button(editing?'変更せず戻る':'記録しない',cancel,{class:'rf-button rf-danger','data-flow-cancel':'true'}));
  }
  function renderOutcome(){
    body.append(element('h3',labels.defensive?'相手の7mどうなりましたか？':'この7mどうなりましたか？'));const list=element('div',null,{class:'rf-outcome'});
    for(const value of choices){list.append(button(value==='goal'?(labels.defensive?'ゴール（失点）':'ゴール'):value==='saved'&&!labels.defensive?'セーブされた':results[value],()=>{update(recordFlowResultChangePatch(draft,value));draft.step=1;render();},{'data-flow-result':value}));}body.append(list,element('p','結果を選んだ後、コースと位置を記録できます。',{class:'rf-muted'}));
  }
  function renderCourse(){
    const columns=element('div',null,{class:'rf-columns'}),details=element('details',null,{class:'rf-card rf-optional-card'}),course=element('section',null,{class:'rf-card rf-course-card'});details.open=optionalOpen;details.append(element('summary','シュートの詳細（任意）'));details.addEventListener('toggle',()=>{if(details.isConnected)optionalOpen=details.open;});columns.append(course,details);body.append(columns);
    appendGroup(details,'形態（任意）',phases,'phase');
    const checks=element('div',null,{class:'rf-checks rf-group'});for(const [key,label] of [['emptyNet','エンプティー'],['rebound','リバウンド']]){const wrap=element('label'),input=element('input',null,{type:'checkbox',checked:draft.event[key],disabled:key==='emptyNet'&&draft.event.result==='saved'&&(!draft.initialSavedEmpty||!draft.event.emptyNet),'data-flow-check':key});input.addEventListener('change',()=>{update({[key]:input.checked});if(key==='emptyNet')render();});wrap.append(input,element('span',label));checks.append(wrap);}details.append(checks);
    appendGroup(details,'種類（任意）',editing?[...shotTypes,...legacyShotTypes]:shotTypes,'shotType');appendGroup(details,'球種（任意）',ballTypes,'ballType');
    const custom=element('input',null,{type:'text',maxlength:'100',placeholder:'球種を自由入力','aria-label':'球種を自由入力',class:'rf-ball-input'});custom.value=ballTypes.some(([key])=>key===draft.event.ballType)?'':draft.event.ballType;custom.addEventListener('input',()=>{update({ballType:custom.value});details.querySelectorAll('[data-flow-option="ballType"]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.value===custom.value)));});details.append(custom);
    if(!separateOutcome&&choices.length){course.append(element('h3','結果を選択'));const list=element('div',null,{class:'rf-chips rf-group rf-result-pills',role:'group','aria-label':'シュート結果'});for(const value of choices)list.append(button(value==='goal'&&labels.defensive?'失点':value==='saved'&&!labels.defensive?'相手GKセーブ':results[value],()=>{update(recordFlowResultChangePatch(draft,value));render();},{'aria-pressed':draft.event.result===value,'data-flow-result':value}));course.append(list);}
    course.append(element('h3',recordFlowCoursePrompt(labels,draft.event.result,{dynamic:choices.length>0})),element('p','シューターから見た向き。選ぶと位置入力へ進みます。',{class:'rf-muted'}));
    const grid=element('div',null,{class:'rf-chips rf-goal-frame',role:'group','aria-label':'ゴールの9分割コース'});zones.forEach((label,index)=>grid.append(button(label,()=>{update({zone:index+1,missLocation:null});draft.step=2;render();focusCourt();},{class:'rf-button rf-zone','data-flow-zone':index+1,disabled:!draft.event.result,'aria-pressed':draft.event.zone===index+1})));course.append(grid);
    const canMiss=['miss','post'].includes(draft.event.result)||(!draft.event.result&&choices.includes('miss'));if(canMiss){course.append(element('h3','枠外・ポスト',{class:'section-gap'}));const directions=element('div',null,{class:'rf-chips',role:'group','aria-label':'枠外・ポストの方向'});for(const [value,label] of missDirections)directions.append(button(label,()=>{update(missDirectionAnswer(value));draft.step=2;render();focusCourt();},{'data-flow-miss':value,'aria-pressed':draft.event.missLocation===value}));course.append(directions);}
    if(!draft.event.result)course.append(element('p','先に枠外・セーブ・ブロックなどの結果を選んでください。',{class:'rf-muted',role:'status'}));
    course.append(element('p','任意項目は未選択のままで進めます。',{class:'rf-muted'}));
    const actions=element('div',null,{class:'rf-footer-actions'});
    if(separateOutcome)actions.append(button('結果へ戻る',()=>{draft.step=0;render();}));
    if(editing)actions.append(button('現在のコースで位置へ',()=>{draft.step=2;render();focusCourt();},{disabled:!draft.event.result,'data-flow-keep-course':'true'}));
    actions.append(button(editing?'コース・位置を消して保存':'コース・位置を省略して保存',()=>commit({withoutCourse:true,withoutPosition:true}),{disabled:!draft.event.result,'data-flow-fast':'true','aria-label':editing?'コース・位置を消して保存':'コース・位置を省略して保存','aria-description':editing?'既存のコース・枠外方向・位置を未指定へ変更して保存します。任意項目は保持します。':'コースと位置を省略します。選択した任意項目は保持します。'}),button(editing?'コースを消して位置へ':'コースなしで次へ',()=>{update({zone:null,missLocation:null});draft.step=2;render();focusCourt();},{class:'rf-button rf-primary',disabled:!draft.event.result,'data-flow-next':'true'}));footer.append(actions);
  }
  function renderPosition(){
    const layout=element('div',null,{class:'rf-position-layout'}),courtArea=element('div'),review=element('aside',null,{class:'rf-card rf-review'});body.append(layout);layout.append(courtArea,review);
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 600 450');svg.setAttribute('class','rf-court');svg.setAttribute('tabindex','0');svg.setAttribute('role','group');svg.setAttribute('aria-label','シュート位置。タップして記録。矢印キーで移動しEnterで記録');svg.setAttribute('aria-describedby',`${name}-position-help`);svg.dataset.flowCourt='true';
    const shape=(tag,attrs)=>{const n=document.createElementNS(svg.namespaceURI,tag);for(const [key,value] of Object.entries(attrs))n.setAttribute(key,String(value));svg.append(n);return n;};
    shape('rect',{x:20,y:20,width:560,height:410,fill:'none',stroke:'#fff','stroke-width':4});shape('path',{d:'M132 20 A168 145 0 0 0 468 20',fill:'none',stroke:'#fff','stroke-width':4});shape('path',{d:'M48 20 A252 218 0 0 0 552 20',fill:'none',stroke:'#fff','stroke-width':4,'stroke-dasharray':'12 10'});shape('rect',{x:258,y:9,width:84,height:12,fill:'#1e4c45'});shape('path',{d:'M280 128 H320',stroke:'#fff','stroke-width':4});
    const marker=shape('circle',{cx:-20,cy:-20,r:11,fill:'#d56b35',stroke:'#fff','stroke-width':3});const markerText=shape('text',{x:300,y:398,'text-anchor':'middle',fill:'#244c3c','font-size':16});markerText.textContent=labels.positionPrompt||'シュートを打った位置をタップ';
    function updateMarker(){const p=draft.event.position;marker.setAttribute('cx',p?20+p.x*560:-20);marker.setAttribute('cy',p?20+p.y*410:-20);const keep=root.querySelector('[data-flow-keep-position]');if(keep)keep.textContent=positionSaveLabel();}
    updateMarker();courtArea.append(svg,element('p',editing?'既存の位置はマーカーで表示します。別の位置をタップすると修正を保存します。10pxを超えるドラッグでは保存しません。矢印で位置を調整しEnterでも保存できます。':'位置をタップすると、そのまま記録します。スクロールや10pxを超えるドラッグでは記録しません。キーボード：矢印で移動、EnterまたはSpaceで記録。',{id:`${name}-position-help`,class:'rf-muted'}));
    svg.addEventListener('pointerdown',e=>{if(draft.status!=='draft'||e.button>0)return;if(pointer){pointer.moved=true;return;}pointer={pointerId:e.pointerId,x:e.clientX,y:e.clientY,moved:false};try{svg.setPointerCapture(e.pointerId);}catch{}});
    svg.addEventListener('pointermove',e=>{if(pointer&&pointer.pointerId===e.pointerId&&Math.hypot(e.clientX-pointer.x,e.clientY-pointer.y)>10)pointer.moved=true;});
    svg.addEventListener('pointerup',e=>{if(!pointer||pointer.pointerId!==e.pointerId)return;const start=pointer;pointer=null;if(start.moved||draft.status!=='draft'||!isRecordPositionTap(start,{pointerId:e.pointerId,x:e.clientX,y:e.clientY}))return;const matrix=svg.getScreenCTM();if(!matrix)return;const point=new DOMPoint(e.clientX,e.clientY).matrixTransform(matrix.inverse());update({position:{x:clamp((point.x-20)/560),y:clamp((point.y-20)/410)}});updateMarker();e.preventDefault();commit();});
    for(const type of ['pointercancel','lostpointercapture'])svg.addEventListener(type,()=>{pointer=null;});
    svg.addEventListener('keydown',e=>{if(draft.status!=='draft')return;const changes={ArrowLeft:[-.02,0],ArrowRight:[.02,0],ArrowUp:[0,-.02],ArrowDown:[0,.02]};if(changes[e.key]){e.preventDefault();const p=draft.event.position||{x:.5,y:.6},[dx,dy]=changes[e.key];update({position:{x:clamp(p.x+dx),y:clamp(p.y+dy)}});updateMarker();}else if(e.key==='Enter'||e.key===' '){e.preventDefault();if(draft.event.position)commit();else error('矢印キーで位置を選ぶか「位置なしで記録」を使ってください。');}});
    review.append(element('strong','今回の記録'),element('p',participants?.shootingTeamLabel||labels.team||''),element('p',`選手：${participantLabel('playerId')}`),element('p',`${results[draft.event.result]}${draft.event.sevenMeter?' / 7m':''}`),element('p',draft.event.zone?`コース：${zones[draft.event.zone-1]}`:draft.event.missLocation?`方向：${missDirections.find(([key])=>key===draft.event.missLocation)?.[1]}`:'コース：未指定'),element('p',`形態：${phases.find(([key])=>key===draft.event.phase)?.[1]||'未指定'}`),element('p',`種類：${[...shotTypes,...legacyShotTypes].find(([key])=>key===draft.event.shotType)?.[1]||'未指定'}`),element('p',`球種：${ballTypes.find(([key])=>key===draft.event.ballType)?.[1]||draft.event.ballType||'未指定'}`));if(labels.gk||participants)review.append(element('p',`${participants?.goalkeepingTeamLabel||'守備側'}のGK：${participantLabel('goalkeeperId')}`));
    const actions=element('div',null,{class:'rf-footer-actions'});actions.append(button('戻る',()=>{draft.step=1;pointer=null;render();},{'data-flow-back':'true'}));if(editing)actions.append(button(positionSaveLabel(),()=>commit(),{class:'rf-button rf-primary','data-flow-keep-position':'true'}));actions.append(button(editing?'位置なしに変更して保存':'位置なしで記録',()=>commit({withoutPosition:true}),{class:'rf-button rf-primary','data-flow-no-position':'true'}));footer.append(actions);
    if(failedEvent)renderRetry();
  }
  function positionSaveLabel(){const p=draft.event.position;if(!p)return '位置未指定のまま保存';return initialPosition&&Math.abs(p.x-initialPosition.x)<1e-9&&Math.abs(p.y-initialPosition.y)<1e-9?'現在の位置で保存':'この位置で保存';}
  function error(message){body.querySelector('[data-flow-error]')?.remove();const alert=element('p',message,{class:'rf-error',role:'alert','data-flow-error':'true'});body.prepend(alert);}
  function renderRetry(){const actions=footer.querySelector('.rf-footer-actions');if(actions&&!actions.querySelector('[data-flow-retry]'))actions.prepend(button('同じ内容で再試行',()=>commit({},failedEvent),{class:'rf-button rf-primary','data-flow-retry':'true'}));}
  function busy(value){root.querySelectorAll('button,input,select').forEach(n=>{if(value){n.dataset.previousDisabled=String(n.disabled);n.disabled=true;}else{n.disabled=n.dataset.previousDisabled==='true';delete n.dataset.previousDisabled;}});root.setAttribute('aria-busy',String(value));const svg=root.querySelector('[data-flow-court]');svg?.setAttribute('aria-disabled',String(value));}
  async function commit(options={},retry=null){
    if(disposed||finished||draft.status!=='draft')return;
    let prepared;try{prepared=retry?clone(retry):prepareRecordFlowEvent(draft,options);}catch(e){error(e.message);return;}
    draft={...draft,status:'committing'};pointer=null;busy(true);error('この端末に記録を保存しています…');
    try{await onCommit(clone(prepared));draft={...draft,status:'committed'};finished=true;teardown();}
    catch(e){draft={...draft,status:'draft'};failedEvent=clone(prepared);if(!disposed){busy(false);error(`保存できませんでした：${e?.message||'不明なエラー'}。同じ内容で再試行できます。`);renderRetry();}}
  }
  function restoreFocus(){cancelAnimationFrame(restoreRaf);restoreRaf=requestAnimationFrame(()=>{if(originalFocus?.isConnected&&typeof originalFocus.focus==='function')originalFocus.focus({preventScroll:true});else document.body?.focus({preventScroll:true});});}
  function teardown(){if(disposed)return;disposed=true;pointer=null;dialog.removeEventListener('cancel',onNativeCancel);dialog.removeEventListener('close',onClose);dialog.removeEventListener('keydown',onKeys);dialog.removeAttribute('data-record-flow');if(originalLabel==null)dialog.removeAttribute('aria-labelledby');else dialog.setAttribute('aria-labelledby',originalLabel);if(originalModal==null)dialog.removeAttribute('aria-modal');else dialog.setAttribute('aria-modal',originalModal);if(dialog.open)dialog.close();restoreFocus();}
  function cancel(){if(disposed||finished||draft.status==='committing')return;finished=true;draft={...draft,status:'cancelled'};teardown();try{onCancel();}catch(e){console.error('記録キャンセル処理',e);}}
  function onNativeCancel(e){e.preventDefault();cancel();}
  function onClose(){if(dialog.open)return;if(!finished&&draft.status!=='committing')cancel();}
  function onKeys(e){if(e.key==='Escape'){e.preventDefault();cancel();}}
  function focusCourt(){requestAnimationFrame(()=>{if(!disposed)root.querySelector('[data-flow-court]')?.focus({preventScroll:true});});}
  dialog.addEventListener('cancel',onNativeCancel);dialog.addEventListener('close',onClose);dialog.addEventListener('keydown',onKeys);
  render();if(!dialog.open){if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');}
  const cleanup=()=>{if(disposed)return;if(!finished&&draft.status!=='committing')cancel();else teardown();};
  cleanup.getDraft=()=>clone(draft);return cleanup;
}
