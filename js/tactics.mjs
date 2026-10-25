const ns = 'http://www.w3.org/2000/svg';
const clone = value => structuredClone(value);
const key = () => globalThis.crypto?.randomUUID?.() || `tactic-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const clamp = n => Math.min(1, Math.max(0, n));
const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function defaultFrame(defense = '6-0') {
  const attackers = [[.12,.54],[.27,.72],[.5,.8],[.73,.72],[.88,.54],[.55,.36],[.5,.94]];
  const formations = {
    '6-0': [[.19,.29],[.31,.36],[.44,.39],[.56,.39],[.69,.36],[.81,.29]],
    '5-1': [[.19,.29],[.34,.37],[.5,.39],[.66,.37],[.81,.29],[.5,.57]],
    '3-2-1': [[.3,.32],[.5,.37],[.7,.32],[.34,.49],[.66,.49],[.5,.63]]
  };
  return {duration: 1000, players:[
    ...attackers.map(([x,y], i) => ({id:`home-${i+1}`,team:'home',number:i===6?1:i+2,x,y})),
    ...(formations[defense] || formations['6-0']).map(([x,y],i)=>({id:`away-${i+1}`,team:'away',number:i+2,x,y}))
  ],ball:{x:.51,y:.76,ownerId:null},lines:[]};
}

export function validateTactic(value) {
  if (!value || typeof value !== 'object' || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100) throw new Error('作戦名を1〜100文字で入力してください。');
  if (!Array.isArray(value.frames) || value.frames.length < 1 || value.frames.length > 120) throw new Error('フレームは1〜120枚にしてください。');
  if(value.court != null && !['half','full'].includes(value.court))throw new Error('コート表示が不正です。');
  if(value.showOpponent != null && typeof value.showOpponent!=='boolean')throw new Error('相手表示の設定が不正です。');
  const coord = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x>=0 && p.x<=1 && p.y>=0 && p.y<=1;
  let ids;
  for (const frame of value.frames) {
    if (!Number.isFinite(frame.duration) || frame.duration < 100 || frame.duration > 30000 || !coord(frame.ball)) throw new Error('移動時間またはボール位置が不正です。');
    if (!Array.isArray(frame.players) || frame.players.length < 8 || frame.players.length > 13) throw new Error('攻撃4〜7人、守備4〜6人にしてください。');
    const currentIds = frame.players.map(p=>p.id);
    if (new Set(currentIds).size !== frame.players.length || frame.players.some(p=>typeof p.id!=='string'||p.id.length>100||!['home','away'].includes(p.team)||!Number.isInteger(p.number)||p.number<0||p.number>99||!coord(p))) throw new Error('選手の位置・番号・IDが不正です。');
    const homeCount=frame.players.filter(p=>p.team==='home').length,awayCount=frame.players.length-homeCount;
    if (homeCount<4||homeCount>7||awayCount<4||awayCount>6) throw new Error('攻撃4〜7人、守備4〜6人にしてください。');
    if (ids && (ids.length!==currentIds.length||ids.some(id=>!currentIds.includes(id)))) throw new Error('フレーム間の選手IDが一致しません。');
    if (frame.ball.ownerId != null && !currentIds.includes(frame.ball.ownerId)) throw new Error('ボール所持者が見つかりません。');
    if (frame.lines != null && (!Array.isArray(frame.lines)||frame.lines.length>100||frame.lines.some(line=>!['pass','move','draw'].includes(line.kind)||!Array.isArray(line.points)||line.points.length<2||line.points.length>2000||line.points.some(p=>!coord(p))))) throw new Error('線のデータが不正です。');
    ids = currentIds;
  }
  return value;
}

export function interpolateFrames(a, b, progress) {
  const t = clamp(progress);
  const mix = (x,y) => x+(y-x)*t;
  const targets = new Map(b.players.map(p=>[p.id,p]));
  return {duration:a.duration,players:a.players.map(p=>{const q=targets.get(p.id)||p;return {...p,x:mix(p.x,q.x),y:mix(p.y,q.y)};}),ball:{...a.ball,x:mix(a.ball.x,b.ball.x),y:mix(a.ball.y,b.ball.y)},lines:clone(a.lines||[])};
}

export function followBall(frame) {
  const owner=frame.players.find(p=>p.id===frame.ball.ownerId);
  if(owner){frame.ball.x=clamp(owner.x+.025);frame.ball.y=clamp(owner.y-.035);}
  return frame;
}

export function resizeRoster(frames, team, count) {
  const max=team==='home'?7:6;
  if(!Number.isInteger(count)||count<4||count>max)throw new Error('人数の指定が不正です。');
  const base=defaultFrame().players.filter(p=>p.team===team).slice(0,count);
  return frames.map(frame=>{
    const result=clone(frame),old=new Map(result.players.map(p=>[p.id,p]));result.players=result.players.filter(p=>p.team!==team).concat(base.map(p=>old.get(p.id)||p));
    if(result.ball.ownerId&&!result.players.some(p=>p.id===result.ball.ownerId))result.ball.ownerId=null;
    return followBall(result);
  });
}

export const durationOf = frames => frames.slice(0,-1).reduce((sum,f)=>sum+f.duration,0);
export function timelineFrame(frames, elapsed) {
  if (!frames.length) throw new Error('フレームがありません。');
  let rest = Math.max(0, elapsed);
  for (let i=0;i<frames.length-1;i++) {
    if(rest<frames[i].duration) return interpolateFrames(frames[i],frames[i+1],rest/frames[i].duration);
    rest-=frames[i].duration;
  }
  return clone(frames.at(-1));
}

export function motionSamplesToFrames(samples) {
  if(!Array.isArray(samples)||samples.length<2)throw new Error('動作の記録がありません。');
  const frames=[];let last=0,previous=-1;
  for(let i=0;i<samples.length;i++){
    const sample=samples[i];if(!Number.isFinite(sample.at)||sample.at<previous||sample.at<0||sample.at>30000)throw new Error('録画時刻が不正です。');previous=sample.at;
    const frame=clone(sample.frame);frame.duration=1000;
    if(frames.length){const delta=sample.at-last;if(delta<100){frames[frames.length-1]=frame;continue;}frames.at(-1).duration=delta;}
    frames.push(frame);last=sample.at;
  }
  if(frames.length<2)throw new Error('録画は0.1秒以上にしてください。');
  if(frames.length>120)throw new Error('録画フレームが多すぎます。');
  return frames;
}

function download(blob, name) {
  const url=URL.createObjectURL(blob), a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}

function paintCanvas(ctx, frame, name, {court='half',showOpponent=true} = {}) {
  const w=1000,h=court==='full'?1450:750,ih=h-50;
  ctx.fillStyle='#f3dcb6';ctx.fillRect(0,0,w,h);
  ctx.strokeStyle='#fff';ctx.lineWidth=5;ctx.strokeRect(30,25,940,ih);
  ctx.beginPath();ctx.moveTo(30,25);ctx.lineTo(970,25);ctx.stroke();
  for(const [rx,ry,dash] of [[282,225,[]],[423,338,[18,12]]]){
    ctx.setLineDash(dash);ctx.beginPath();ctx.ellipse(500,25,rx,ry,0,0,Math.PI);ctx.stroke();
    if(court==='full'){ctx.beginPath();ctx.ellipse(500,h-25,rx,ry,0,Math.PI,Math.PI*2);ctx.stroke();}
  }
  ctx.setLineDash([]);ctx.fillStyle='#204a53';ctx.fillRect(429,8,142,18);
  if(court==='full'){ctx.fillRect(429,h-26,142,18);ctx.beginPath();ctx.moveTo(30,h/2);ctx.lineTo(970,h/2);ctx.stroke();ctx.beginPath();ctx.arc(500,h/2,140,0,Math.PI*2);ctx.stroke();}
  for(const line of frame.lines||[]){ctx.strokeStyle=line.kind==='pass'?'#ab5128':'#344e62';ctx.lineWidth=4;ctx.setLineDash(line.kind==='pass'?[12,8]:[]);ctx.beginPath();line.points.forEach((p,i)=>{const x=30+p.x*940,y=25+p.y*ih;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();ctx.setLineDash([]);if(line.kind!=='draw'){const last=line.points.at(-1),prev=line.points.at(-2),x=30+last.x*940,y=25+last.y*ih,a=Math.atan2((last.y-prev.y)*ih,(last.x-prev.x)*940);ctx.beginPath();ctx.moveTo(x-18*Math.cos(a-.5),y-18*Math.sin(a-.5));ctx.lineTo(x,y);ctx.lineTo(x-18*Math.cos(a+.5),y-18*Math.sin(a+.5));ctx.stroke();}}
  for(const p of frame.players.filter(p=>showOpponent||p.team!=='away')){const x=30+p.x*940,y=25+p.y*ih;ctx.fillStyle=p.team==='home'?'#087f8c':'#e78a48';ctx.beginPath();ctx.arc(x,y,23,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.stroke();ctx.fillStyle='#fff';ctx.font='bold 22px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(p.number),x,y);}
  ctx.fillStyle='#ffe047';ctx.strokeStyle='#283c47';ctx.lineWidth=3;ctx.beginPath();ctx.arc(30+frame.ball.x*940,25+frame.ball.y*ih,12,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.textAlign='left';
  ctx.fillStyle='rgba(17,42,54,.85)';ctx.fillRect(30,h-80,940,55);ctx.fillStyle='#fff';ctx.textAlign='left';ctx.font='bold 24px sans-serif';ctx.fillText(name.slice(0,50),48,h-51);
}

export function mountTactics(container, {state,save,toast = ()=>{}}) {
  state.tactics ||= [];
  let selected = state.tactics[0]?.id, index=0, speed=1, raf=0, playing=false, recorder=null, disposed=false;
  let draft = selected ? clone(state.tactics[0]) : {id:key(),name:'新しい作戦',frames:[defaultFrame()]};
  let dirty=false,editMode='pieces',motion=null,motionTimer=0,motionUndo=null,lastVideo=null;
  const courtHeight=()=>draft.court==='full'?1450:750;
  const setStatus=message=>{const el=container.querySelector('[data-status]');if(el)el.textContent=message;};
  const stop = () => {cancelAnimationFrame(raf);playing=false;container.querySelector('[data-play]')?.setAttribute('aria-pressed','false');const b=container.querySelector('[data-play]');if(b)b.textContent='▶ 再生';};
  const persist = async () => {
    try {validateTactic(draft);const found=state.tactics.findIndex(t=>t.id===draft.id);if(found<0)state.tactics.push(clone(draft));else state.tactics[found]=clone(draft);selected=draft.id;await save();dirty=false;setStatus('この端末に保存しました');return true;}catch(error){toast(error.message);setStatus(`保存できませんでした：${error.message}`);return false;}
  };
  function draw(frame) {
    const svg=container.querySelector('[data-court]');if(!svg)return;const ih=courtHeight()-50;
    svg.querySelector('[data-pieces]').replaceChildren();
    svg.querySelector('[data-lines]').replaceChildren();
    for(const line of frame.lines||[]){const path=document.createElementNS(ns,'polyline');path.setAttribute('points',line.points.map(p=>`${30+p.x*940},${25+p.y*ih}`).join(' '));path.setAttribute('fill','none');path.setAttribute('stroke',line.kind==='pass'?'#ab5128':'#344e62');path.setAttribute('stroke-width','4');path.setAttribute('stroke-linecap','round');if(line.kind==='pass')path.setAttribute('stroke-dasharray','12 8');if(line.kind!=='draw')path.setAttribute('marker-end','url(#tactics-arrow)');svg.querySelector('[data-lines]').append(path);}
    for(const p of [...frame.players.filter(p=>draft.showOpponent!==false||p.team!=='away'),{id:'ball',...frame.ball}]){
      const g=document.createElementNS(ns,'g');g.dataset.piece=p.id;g.setAttribute('transform',`translate(${30+p.x*940} ${25+p.y*ih})`);g.setAttribute('tabindex','0');g.setAttribute('role','button');g.setAttribute('aria-label',p.id==='ball'?'ボール':`${p.team==='home'?'攻撃':'守備'} ${p.number}番。矢印キーで移動`);
      const hit=document.createElementNS(ns,'circle');hit.setAttribute('r',draft.court==='full'?'60':'34');hit.setAttribute('fill','transparent');hit.setAttribute('pointer-events','all');g.append(hit);const circle=document.createElementNS(ns,'circle');circle.setAttribute('r',p.id==='ball'?13:24);circle.setAttribute('fill',p.id==='ball'?'#ffe047':p.team==='home'?'#087f8c':'#e78a48');circle.setAttribute('stroke',p.id==='ball'?'#283c47':'#fff');circle.setAttribute('stroke-width','3');g.append(circle);
      if(p.id!=='ball'){const text=document.createElementNS(ns,'text');text.setAttribute('text-anchor','middle');text.setAttribute('dy','.35em');text.setAttribute('fill','#fff');text.setAttribute('font-size','22');text.setAttribute('font-weight','700');text.setAttribute('pointer-events','none');text.textContent=p.number;g.append(text);}
      svg.querySelector('[data-pieces]').append(g);
    }
  }
  function render() {
    stop();
    container.innerHTML=`<style>
      .tactics-court{display:block;width:100%;max-height:65vh;min-height:280px;touch-action:none;background:#f3dcb6;border-radius:16px;user-select:none}.tactics-court [data-piece]{cursor:grab;outline:none}.tactics-court [data-piece]:focus circle:last-of-type{stroke:#172c3c;stroke-width:6}.tactics-layout{display:grid;grid-template-columns:minmax(0,1fr) 230px;gap:18px}.tactics-controls{display:flex;flex-direction:column;gap:12px}.tactics-controls label{display:grid;gap:5px}.tactics-controls input,.tactics-controls select{width:100%;box-sizing:border-box;min-height:44px}.tactics-frames{display:flex;gap:8px;overflow-x:auto;padding:12px 0}.tactics-frames button{flex:none;min-width:64px;min-height:48px}.tactics-frames .is-active{background:#087f8c;color:white}.tactics-toolbar{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.tactics-toolbar button{min-height:44px}.tactics-help{font-size:.85rem;line-height:1.6}@media(max-width:760px){.tactics-layout{grid-template-columns:1fr}.tactics-controls{display:grid;grid-template-columns:1fr 1fr}.tactics-court{max-height:none}.tactics-controls .tactics-help{grid-column:1/-1}}
    </style><section class="panel"><div class="toolbar"><h2>動く作戦盤</h2><span class="muted">攻撃＝青緑 ／ 守備＝オレンジ</span></div>
    <div class="tactics-toolbar"><button class="btn" data-court-toggle>${draft.court==='full'?'半面に切り替え':'全面に切り替え'}</button><button class="btn" data-opponent-toggle aria-pressed="${draft.showOpponent!==false}">${draft.showOpponent===false?'相手を表示':'相手を隠す'}</button></div><div class="tactics-toolbar"><select class="field" data-select aria-label="保存した作戦"><option value="">未保存の作戦</option>${state.tactics.map(t=>`<option value="${escape(t.id)}" ${t.id===selected?'selected':''}>${escape(t.name)}</option>`).join('')}</select><button class="btn" data-new>＋ 新しい作戦</button><button class="btn primary" data-save>保存</button><button class="btn" data-delete>作戦を削除</button></div>
    <div class="tactics-layout"><div><svg class="tactics-court" data-court viewBox="0 0 1000 ${courtHeight()}" aria-label="ハンドボール作戦盤。選手とボールをドラッグして移動"><rect x="30" y="25" width="940" height="${courtHeight()-50}" fill="none" stroke="white" stroke-width="5"/><path d="M218 25 A282 225 0 0 0 782 25" fill="none" stroke="white" stroke-width="5"/><path d="M77 25 A423 338 0 0 0 923 25" fill="none" stroke="white" stroke-width="5" stroke-dasharray="18 12"/><rect x="429" y="8" width="142" height="18" fill="#204a53"/><path d="M460 175h80" stroke="white" stroke-width="5"/>${draft.court==='full'?`<path d="M218 ${courtHeight()-25} A282 225 0 0 1 782 ${courtHeight()-25}" fill="none" stroke="white" stroke-width="5"/><path d="M77 ${courtHeight()-25} A423 338 0 0 1 923 ${courtHeight()-25}" fill="none" stroke="white" stroke-width="5" stroke-dasharray="18 12"/><rect x="429" y="${courtHeight()-26}" width="142" height="18" fill="#204a53"/><path d="M30 ${courtHeight()/2} H970" stroke="white" stroke-width="5"/><circle cx="500" cy="${courtHeight()/2}" r="140" fill="none" stroke="white" stroke-width="5"/>`:''}<defs><marker id="tactics-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0 0 L8 3 L0 6" fill="none" stroke="#344e62" stroke-width="1.5"/></marker></defs><g data-lines pointer-events="none"></g><g data-pieces></g></svg><div class="tactics-frames">${draft.frames.map((f,i)=>`<button class="btn ${index===i?'is-active':''}" data-frame="${i}" aria-label="フレーム ${i+1}" aria-pressed="${index===i}">${i+1}</button>`).join('')}</div><div class="tactics-toolbar"><button class="btn" data-add>＋ フレーム追加</button><button class="btn" data-remove>フレーム削除</button><button class="btn primary" data-play aria-pressed="false">▶ 再生</button><button class="btn" data-reset>最初へ</button><button class="btn" data-record-motion>● 実時間で動きを録画</button><button class="btn" data-undo-motion ${motionUndo?'':'disabled'}>録画前に戻す</button></div></div>
    <div class="tactics-controls"><label>作戦名<input class="field" data-name maxlength="100" value="${escape(draft.name)}"></label><label>攻撃人数（全フレーム）<select class="field" data-count-home>${[4,5,6,7].map(n=>`<option value="${n}" ${draft.frames[index].players.filter(p=>p.team==='home').length===n?'selected':''}>${n}人</option>`).join('')}</select></label><label>守備人数（全フレーム）<select class="field" data-count-away>${[4,5,6].map(n=>`<option value="${n}" ${draft.frames[index].players.filter(p=>p.team==='away').length===n?'selected':''}>${n}人</option>`).join('')}</select></label><label>守備隊形<select class="field" data-formation><option>6-0</option><option>5-1</option><option>3-2-1</option></select></label><button class="btn" data-preset>このフレームに隊形を配置</button><label>次の位置までの移動時間（秒）<input class="field" data-duration type="number" min="0.1" max="30" step="0.1" value="${draft.frames[index].duration/1000}"></label><label>ボール所持者<select class="field" data-owner><option value="">ボール単独</option>${draft.frames[index].players.map(p=>`<option value="${escape(p.id)}" ${draft.frames[index].ball.ownerId===p.id?'selected':''}>${p.team==='home'?'攻撃':'守備'} ${p.number}番</option>`).join('')}</select></label><label>操作モード<select class="field" data-mode>${[['pieces','選手・ボール移動'],['pass','パス矢印（破線）'],['move','移動矢印'],['draw','手書き線']].map(([value,label])=>`<option value="${value}" ${editMode===value?'selected':''}>${label}</option>`).join('')}</select></label><button class="btn" data-clear-lines>このフレームの線を消す</button><label>再生速度<select class="field" data-speed>${[.5,1,1.5,2].map(n=>`<option value="${n}" ${n===speed?'selected':''}>${n}倍</option>`).join('')}</select></label><div class="tactics-help muted">選手やボールを動かし、フレームを追加すると動きを作れます。各フレームの移動時間で次の位置まで補間します。最終フレームの時間は使いません。ドラッグ後は自動保存します。<br>実時間録画では指で動かす様子を最大30秒記録できます（約0.3秒ごと）。既存の動きは「録画前に戻す」で戻せます。全面/半面は座標を画面全体に合わせて表示します。<br>キーボード：選手にフォーカスし矢印キー。</div></div></div>
    <div class="tactics-toolbar"><button class="btn" data-export>作戦JSONを書き出す</button><button class="btn" data-import>作戦JSONを読み込む</button><label>動画の用途<select class="field" data-video-purpose><option value="normal">通常（最大3分）</option><option value="comment">コメント添付用（最大30秒）</option></select></label><button class="btn" data-video>動画を書き出す</button><button class="btn" data-share-video ${lastVideo?'':'disabled'}>作成した動画を共有</button><input data-file type="file" accept="application/json,.json" hidden></div><p class="muted" data-status role="status">フレーム ${index+1} / ${draft.frames.length} ・再生時間 ${(durationOf(draft.frames)/1000).toFixed(1)}秒</p></section>`;
    draw(draft.frames[index]);
    const on=(selector,type,fn)=>container.querySelector(selector)?.addEventListener(type,fn);
    on('[data-court-toggle]','click',()=>{draft.court=draft.court==='full'?'half':'full';dirty=true;persist();render();});
    on('[data-opponent-toggle]','click',()=>{draft.showOpponent=draft.showOpponent===false;dirty=true;persist();draw(draft.frames[index]);const b=container.querySelector('[data-opponent-toggle]');b.textContent=draft.showOpponent?'相手を隠す':'相手を表示';b.setAttribute('aria-pressed',String(draft.showOpponent));});
    on('[data-record-motion]','click',()=>{if(motion)stopMotion();else startMotion();});
    on('[data-undo-motion]','click',()=>{if(!motionUndo)return;draft.frames=clone(motionUndo);motionUndo=null;index=0;dirty=true;persist();render();});
    on('[data-share-video]','click',shareVideo);
    on('[data-name]','change',e=>{draft.name=e.target.value;dirty=true;});
    on('[data-duration]','change',e=>{const n=Number(e.target.value)*1000;if(!Number.isFinite(n)||n<100||n>30000){toast('移動時間は0.1〜30秒です');e.target.value=draft.frames[index].duration/1000;return;}draft.frames[index].duration=n;dirty=true;persist();});
    on('[data-save]','click',async()=>{draft.name=container.querySelector('[data-name]').value;if(await persist())render();});
    on('[data-new]','click',async()=>{if(dirty&&!await persist())return;draft={id:key(),name:'新しい作戦',frames:[defaultFrame()]};selected='';index=0;motionUndo=null;lastVideo=null;dirty=true;render();});
    on('[data-select]','change',async e=>{const id=e.target.value;if(!id)return;if(dirty&&!await persist())return;draft=clone(state.tactics.find(t=>t.id===id));selected=id;index=0;motionUndo=null;lastVideo=null;render();});
    on('[data-delete]','click',async()=>{if(!state.tactics.some(t=>t.id===draft.id))return toast('この作戦はまだ保存されていません');if(!confirm(`「${draft.name}」を削除しますか？`))return;state.tactics=state.tactics.filter(t=>t.id!==draft.id);try{await save();selected=state.tactics[0]?.id;draft=selected?clone(state.tactics[0]):{id:key(),name:'新しい作戦',frames:[defaultFrame()]};index=0;motionUndo=null;lastVideo=null;dirty=false;render();}catch(e){toast(e.message);}});
    container.querySelectorAll('[data-frame]').forEach(b=>b.addEventListener('click',()=>{index=Number(b.dataset.frame);render();}));
    on('[data-add]','click',()=>{if(draft.frames.length>=120)return toast('フレームは最大120枚です');draft.frames.splice(index+1,0,clone(draft.frames[index]));index++;dirty=true;persist();render();});
    on('[data-remove]','click',()=>{if(draft.frames.length===1)return toast('最初のフレームは残してください');draft.frames.splice(index,1);index=Math.min(index,draft.frames.length-1);dirty=true;persist();render();});
    on('[data-preset]','click',()=>{const current=draft.frames[index],preset=defaultFrame(container.querySelector('[data-formation]').value),positions=new Map(preset.players.map(p=>[p.id,p]));current.players=current.players.map(p=>({...p,x:positions.get(p.id)?.x??p.x,y:positions.get(p.id)?.y??p.y}));followBall(current);dirty=true;persist();draw(current);});
    for(const team of ['home','away'])on(`[data-count-${team}]`,'change',e=>{draft.frames=resizeRoster(draft.frames,team,Number(e.target.value));dirty=true;persist();render();});
    on('[data-owner]','change',e=>{draft.frames[index].ball.ownerId=e.target.value||null;followBall(draft.frames[index]);dirty=true;persist();draw(draft.frames[index]);});
    on('[data-mode]','change',e=>{editMode=e.target.value;});
    on('[data-clear-lines]','click',()=>{draft.frames[index].lines=[];dirty=true;persist();draw(draft.frames[index]);});
    on('[data-speed]','change',e=>{speed=Number(e.target.value);});
    on('[data-reset]','click',()=>{index=0;render();});
    on('[data-play]','click',()=>{
      if(playing){stop();draw(draft.frames[index]);return;}
      if(draft.frames.length<2)return toast('2枚以上のフレームを作成してください');
      playing=true;const start=performance.now();const total=durationOf(draft.frames);const button=container.querySelector('[data-play]');button.textContent='■ 停止';button.setAttribute('aria-pressed','true');
      const tick=now=>{if(!playing||disposed)return;const elapsed=(now-start)*speed;draw(timelineFrame(draft.frames,elapsed));setStatus(`再生 ${(Math.min(elapsed,total)/1000).toFixed(1)} / ${(total/1000).toFixed(1)}秒`);if(elapsed>=total){stop();return;}raf=requestAnimationFrame(tick);};raf=requestAnimationFrame(tick);
    });
    on('[data-export]','click',()=>{try{validateTactic(draft);download(new Blob([JSON.stringify({format:'handball-tactic',version:1,tactic:draft},null,2)],{type:'application/json'}),`${draft.name.replace(/[\\/:*?"<>|]/g,'_')}.json`);}catch(e){toast(e.message);}});
    on('[data-import]','click',()=>container.querySelector('[data-file]').click());
    on('[data-file]','change',async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>2_000_000)throw new Error('作戦ファイルは2MB以下にしてください');const data=JSON.parse(await file.text());if(data.format!=='handball-tactic'||data.version!==1)throw new Error('対応する作戦JSONではありません');validateTactic(data.tactic);draft=clone(data.tactic);draft.id=key();selected='';index=0;motionUndo=null;lastVideo=null;dirty=true;if(await persist())render();}catch(error){toast(`読み込めません：${error.message}`);}});
    on('[data-video]','click',exportVideo);
    const svg=container.querySelector('[data-court]');let drag=null,stroke=null;
    const point = e => {const m=svg.getScreenCTM();if(!m)return null;const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(m.inverse());return {x:clamp((p.x-30)/940),y:clamp((p.y-25)/(courtHeight()-50))};};
    svg.addEventListener('pointerdown',e=>{if(playing||recorder)return;if(editMode!=='pieces'){const p=point(e);if(!p)return;const frame=draft.frames[index];frame.lines||=[];if(frame.lines.length>=100)return toast('線は最大100本です');stroke={id:key(),kind:editMode,points:[p,{...p}]};frame.lines.push(stroke);dirty=true;e.preventDefault();svg.setPointerCapture(e.pointerId);return;}const piece=e.target.closest('[data-piece]');if(!piece)return;e.preventDefault();drag=piece.dataset.piece;if(drag==='ball'){draft.frames[index].ball.ownerId=null;container.querySelector('[data-owner]').value='';}svg.setPointerCapture(e.pointerId);});
    svg.addEventListener('pointermove',e=>{if(!drag&&!stroke)return;const p=point(e);if(!p)return;if(stroke){if(stroke.kind==='draw'){if(stroke.points.length<2000)stroke.points.push(p);}else stroke.points[1]=p;}else{const object=drag==='ball'?draft.frames[index].ball:draft.frames[index].players.find(p=>p.id===drag);Object.assign(object,p);followBall(draft.frames[index]);}dirty=true;draw(draft.frames[index]);});
    const end=()=>{if(drag||stroke){drag=null;stroke=null;if(!motion)persist();}};svg.addEventListener('pointerup',end);svg.addEventListener('pointercancel',end);svg.addEventListener('lostpointercapture',end);
    svg.addEventListener('keydown',e=>{const offsets={ArrowLeft:[-.01,0],ArrowRight:[.01,0],ArrowUp:[0,-.01],ArrowDown:[0,.01]};const offset=offsets[e.key],piece=e.target.closest('[data-piece]');if(!offset||!piece||playing||recorder)return;e.preventDefault();const id=piece.dataset.piece;const p=id==='ball'?draft.frames[index].ball:draft.frames[index].players.find(p=>p.id===id);p.x=clamp(p.x+offset[0]);p.y=clamp(p.y+offset[1]);if(id==='ball'){p.ownerId=null;container.querySelector('[data-owner]').value='';}else followBall(draft.frames[index]);dirty=true;draw(draft.frames[index]);Array.from(svg.querySelectorAll('[data-piece]')).find(g=>g.dataset.piece===id)?.focus();if(!motion)persist();});
  }
  function captureMotion(at) {
    if(!motion)return;
    const elapsed=Math.min(30000,Math.max(0,at-motion.started));
    motion.samples.push({at:elapsed,frame:clone(draft.frames[0])});
    setStatus(`● 動作録画中 ${(elapsed/1000).toFixed(1)} / 30.0秒。選手やボールを指で動かしてください。`);
    if(elapsed>=30000)stopMotion();
  }
  function startMotion() {
    stop();
    motionUndo=clone(draft.frames);const initial=clone(draft.frames[index]);draft.frames=[clone(initial)];index=0;editMode='pieces';dirty=true;
    motion={started:performance.now(),samples:[{at:0,frame:initial}]};
    container.querySelectorAll('button,input,select').forEach(el=>el.disabled=true);
    const button=container.querySelector('[data-record-motion]');button.disabled=false;button.textContent='■ 動作録画を停止';button.setAttribute('aria-pressed','true');
    container.querySelector('[data-mode]').value='pieces';
    setStatus('● 動作録画中 0.0 / 30.0秒。選手やボールを指で動かしてください。');
    motionTimer=setInterval(()=>captureMotion(performance.now()),300);
  }
  function stopMotion(update=true) {
    if(!motion)return;
    clearInterval(motionTimer);const recording=motion;motion=null;
    recording.samples.push({at:Math.min(30000,Math.max(0,performance.now()-recording.started)),frame:clone(draft.frames[0])});
    try{draft.frames=motionSamplesToFrames(recording.samples);index=draft.frames.length-1;dirty=true;persist();if(update&&!disposed){render();setStatus(`動きを記録しました（${(durationOf(draft.frames)/1000).toFixed(1)}秒）。動画を書き出すか再生できます。`);}}catch(error){draft.frames=clone(motionUndo);index=0;if(update&&!disposed){render();toast(error.message);}}
  }
  async function shareVideo() {
    if(!lastVideo)return toast('先に動画を書き出してください。');
    const file=new File([lastVideo.blob],lastVideo.name,{type:lastVideo.blob.type});
    if(!navigator.share||!navigator.canShare?.({files:[file]}))return toast('このブラウザではファイルの直接共有に対応していません。ダウンロードした動画を「ファイル」から共有してください。');
    try{await navigator.share({files:[file],title:draft.name});}catch(error){if(error.name!=='AbortError')toast(`共有できません：${error.message}`);}
  }
  async function exportVideo() {
    stop();
    if(!globalThis.MediaRecorder || !HTMLCanvasElement.prototype.captureStream)return toast('このブラウザは動画書き出しに対応していません。作戦JSONをご利用ください。');
    const comment=container.querySelector('[data-video-purpose]').value==='comment';const limit=comment?30000:180000;const total=durationOf(draft.frames)/speed;if(total<=0)return toast('動画には2枚以上のフレームが必要です');if(total>limit)return toast(comment?'コメント添付用の動画は30秒以内です。速度を上げるかフレームを減らしてください。':'動画は3分以内にしてください。速度を上げるかフレームを減らしてください。');
    const type=['video/webm;codecs=vp8','video/webm;codecs=vp9','video/webm','video/mp4'].find(t=>MediaRecorder.isTypeSupported(t));if(!type)return toast('対応する動画形式がありません。作戦JSONをご利用ください。');
    try{
      validateTactic(draft);const frames=clone(draft.frames),name=draft.name;const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=courtHeight();const ctx=canvas.getContext('2d');paintCanvas(ctx,frames[0],name,draft);const stream=canvas.captureStream(30);const chunks=[];recorder=new MediaRecorder(stream,{mimeType:type,videoBitsPerSecond:2500000});const controls=Array.from(container.querySelectorAll('button,input,select'));controls.forEach(el=>el.disabled=true);let failed=false;
      const watchdog=setTimeout(()=>{failed=true;stream.getTracks().forEach(t=>t.stop());if(recorder?.state==='recording')recorder.stop();recorder=null;controls.forEach(el=>{if(el.isConnected)el.disabled=false;});if(!disposed){toast('動画形式の処理が完了しませんでした。作戦JSONを書き出してご利用ください。');setStatus('動画を書き出せませんでした。ブラウザを変えるか作戦JSONをご利用ください。');}},total+15000);
      recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
      recorder.onstop=()=>{clearTimeout(watchdog);stream.getTracks().forEach(t=>t.stop());if(!disposed&&!failed&&chunks.length){lastVideo={blob:new Blob(chunks,{type}),name:`${name.replace(/[\\/:*?"<>|]/g,'_')}.${type.includes('mp4')?'mp4':'webm'}`};download(lastVideo.blob,lastVideo.name);setStatus('動画を書き出しました。「作成した動画を共有」から共有できます。');}recorder=null;controls.forEach(el=>{if(el.isConnected)el.disabled=false;});const share=container.querySelector('[data-share-video]');if(share)share.disabled=!lastVideo;};
      recorder.onerror=()=>{failed=true;toast('動画の記録に失敗しました');setStatus('動画の記録に失敗しました');if(recorder?.state==='recording')recorder.stop();};recorder.start(250);const start=performance.now();
      const tick=now=>{if(disposed||!recorder||recorder.state!=='recording')return;const elapsed=now-start;const frame=timelineFrame(frames,elapsed*speed);paintCanvas(ctx,frame,name,draft);draw(frame);setStatus(`動画作成中 ${(Math.min(elapsed,total)/1000).toFixed(1)} / ${(total/1000).toFixed(1)}秒。この画面を開いたままにしてください。`);if(elapsed>=total){recorder.stop();return;}raf=requestAnimationFrame(tick);};raf=requestAnimationFrame(tick);
    }catch(e){recorder=null;container.querySelectorAll('button,input,select').forEach(el=>el.disabled=false);toast(`動画を書き出せません：${e.message}`);}
  }
  const onVisibility=()=>{if(document.visibilityState==='hidden'&&motion)stopMotion();};
  document.addEventListener('visibilitychange',onVisibility);
  render();
  return ()=>{document.removeEventListener('visibilitychange',onVisibility);disposed=true;if(motion)stopMotion(false);stop();if(recorder?.state==='recording')recorder.stop();if(dirty)persist();};
}
