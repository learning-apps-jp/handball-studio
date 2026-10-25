import { uid, activeEvents, formatClock,clockMs } from './core.mjs';
import { durationOf, timelineFrame, validateTactic } from './tactics.mjs';

export function parseYouTubeId(input) {
  if (typeof input !== 'string') return null;
  if (/^[\w-]{11}$/.test(input)) return input;
  try {
    const url = new URL(input);
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    const host = url.hostname.toLowerCase();
    let id;
    if (host === 'youtu.be') id = url.pathname.split('/')[1];
    else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(host)) {
      id = url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(embed|shorts|live)\//.test(url.pathname) ? url.pathname.split('/')[2] : null;
    }
    return /^[\w-]{11}$/.test(id ?? '') ? id : null;
  } catch { return null; }
}

export async function fetchYouTubeMetadata(input,{fetcher=globalThis.fetch,timeoutMs=6000,signal}={}) {
  const id=parseYouTubeId(input);if(!id)throw new Error('有効なYouTube動画を指定してください');
  const controller=new AbortController();let timer;const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort();
  try{
    const endpoint=`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`;
    const request=Promise.resolve(fetcher(endpoint,{signal:controller.signal,credentials:'omit',redirect:'error',referrerPolicy:'no-referrer'})).then(async response=>{if(!response.ok)throw new Error(`動画情報の取得に失敗しました（HTTP ${response.status}）`);const data=await response.json();if(typeof data.title!=='string'||typeof data.author_name!=='string'||data.title.length>1000||data.author_name.length>1000)throw new Error('動画情報の形式が不正です');return {id,title:data.title,channel:data.author_name};});
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('動画情報の取得がタイムアウトしました'));},timeoutMs);});
    return await Promise.race([request,timeout]);
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}

/** Dedicated gesture surface; coordinates never overlay the embedded player's controls. */
export function gestureAction({dx=0,dy=0,durationMs=0,ratio=.5,clipMode=false,doubleTap=false}={}) {
  if(clipMode&&Math.abs(dy)>=55&&Math.abs(dy)>Math.abs(dx)*1.3)return {type:dy<0?'next':'previous'};
  if(Math.abs(dx)>40||Math.abs(dy)>40)return {type:'none'};
  const side=ratio<.35?'left':ratio>.65?'right':'center';
  if(durationMs>=450)return side==='center'?{type:'speed',rate:2}:{type:'hold-seek',seconds:side==='left'?-2:2};
  if(doubleTap&&side!=='center')return {type:'seek',seconds:(side==='left'?-1:1)*(clipMode?5:10)};
  return {type:'toggle'};
}

export function memoTimestamp({anchors=[],period=1,videoSeconds=null,matchClockMs=0}={}) {
  const at=Number.isFinite(videoSeconds)&&videoSeconds>=0?videoSeconds:null;
  const mapped=at==null?null:mapVideoToClock(anchors,period,at);
  return {videoSeconds:at,clockMs:mapped??(Number.isFinite(matchClockMs)?Math.max(0,matchClockMs):0),synchronized:mapped!=null};
}

export function floatingMemoBottom({innerHeight,viewportHeight,offsetTop=0,mobile=false}={}) {
  const keyboard=Number.isFinite(innerHeight)&&Number.isFinite(viewportHeight)?Math.max(0,innerHeight-viewportHeight-(Number.isFinite(offsetTop)?offsetTop:0)):0;
  return (mobile?92:22)+keyboard;
}

function validAnchors(anchors, period) {
  return anchors.filter(a => a.period === period && Number.isFinite(a.clockMs) && a.clockMs >= 0 && Number.isFinite(a.videoSeconds) && a.videoSeconds >= 0);
}

/** Piecewise offsets preserve pauses. A later-added anchor wins tied clock values. */
export function mapClockToVideo(anchors, period, clockMs) {
  const sorted = validAnchors(anchors, period).map((a, index) => ({ ...a, index })).sort((a, b) => a.clockMs - b.clockMs || a.index - b.index);
  if (!sorted.length) return null;
  let anchor = sorted[0];
  for (const candidate of sorted) if (candidate.clockMs <= clockMs) anchor = candidate;
  return Math.max(0, anchor.videoSeconds + (clockMs - anchor.clockMs) / 1000);
}

export function mapVideoToClock(anchors, period, videoSeconds) {
  const sorted = validAnchors(anchors, period).map((a, index) => ({ ...a, index })).sort((a, b) => a.videoSeconds - b.videoSeconds || a.index - b.index);
  if (!sorted.length) return null;
  let anchor = sorted[0];
  for (const candidate of sorted) if (candidate.videoSeconds <= videoSeconds) anchor = candidate;
  const next = sorted.find(candidate => candidate.videoSeconds > videoSeconds);
  return Math.max(0, Math.min(next?.clockMs ?? Infinity, anchor.clockMs + (videoSeconds - anchor.videoSeconds) * 1000));
}

export function matchesTags(comment, query) { const required = String(query).split(/[,、]/).map(s => s.trim()).filter(Boolean); return required.every(value => (comment.tags ?? []).some(tag => tag.includes(value))); }
export function attachableTactic(tactic) { try { validateTactic(tactic); return durationOf(tactic.frames) <= 30000; } catch { return false; } }
export function allowedText(text, blockedWords = []) { return !blockedWords.some(word => word && String(text).toLocaleLowerCase().includes(String(word).toLocaleLowerCase())); }

export function clipRange(comment, padding = 5) {
  const center = Number(comment.videoSeconds) || 0;
  const explicitStart = Number(comment.startSeconds);
  const explicitEnd = Number(comment.endSeconds);
  const start = Math.max(0, comment.startSeconds !== '' && comment.startSeconds != null && Number.isFinite(explicitStart) ? explicitStart : center - padding);
  return { start, end: comment.endSeconds !== '' && comment.endSeconds != null && Number.isFinite(explicitEnd) && explicitEnd > start ? explicitEnd : Math.max(start + 1, center + padding) };
}

let apiPromise;
function youtubeAPI() {
  if (globalThis.YT?.Player) return Promise.resolve(globalThis.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const previous = globalThis.onYouTubeIframeAPIReady;
    const timer = setTimeout(() => { apiPromise = null; reject(new Error('YouTube APIに接続できません。インターネット接続を確認してください。')); }, 15000);
    globalThis.onYouTubeIframeAPIReady = () => { clearTimeout(timer); if (typeof previous === 'function') previous(); resolve(globalThis.YT); };
    let script = document.querySelector('script[data-handball-youtube]');
    if (!script) { script = document.createElement('script'); script.src = 'https://www.youtube.com/iframe_api'; script.dataset.handballYoutube = 'true'; document.head.append(script); }
    script.onerror = () => { clearTimeout(timer); script.remove(); apiPromise = null; reject(new Error('YouTube APIの読み込みに失敗しました')); };
  });
  return apiPromise;
}

function el(tag, text, className) { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; }
function button(text, handler) { const node = el('button', text, 'btn'); node.type = 'button'; node.addEventListener('click', handler); return node; }
function field(label, type = 'text', value = '') { const wrap = el('label', null, 'field'); wrap.append(el('span', label)); const input = el('input'); input.type = type; input.value = value; wrap.append(input); return { wrap, input }; }

export function mountVideo(container, { state, match, save: saveState, toast = () => {},compact=false }) {
  const save = () => Promise.resolve().then(saveState).catch(error => { toast(`動画分析を保存できませんでした：${error.message}`); });
  match.video ??= { url: '', anchors: [], comments: [] };
  const data = match.video; data.urls ??= {}; data.anchors ??= []; data.comments ??= [];
  state.preferences ??= {};
  let period = match.period || 1, player = null, localVideo = null, destroyed = false, generation = 0, timer = null, editing = null, resumeAfterInput = false, annotationClock = null, tacticRaf = 0, metadataController=null, activeClipId=null;
  const localFiles = new Map(),localNames=new Map(),metadataCache=new Map();
  const root = el('section', null,compact?'panel video-compact':'panel'); container.replaceChildren(root);
  root.append(el('h2', '動画分析'));
  root.append(el('p', 'YouTubeはインターネット接続が必要です。端末の動画は外部送信しません。選択したファイルはこの画面を閉じるまで有効です。'));
  const toolbar = el('div', null, 'toolbar');
  const periodSelect = el('select'); periodSelect.setAttribute('aria-label', '動画のピリオド');
  for (let i = 1; i <= Math.max(4, period); i++) { const option = el('option', i === 1 ? '前半' : i === 2 ? '後半' : `延長 ${i - 2}`); option.value = i; periodSelect.append(option); } periodSelect.value = period;
  const url = field('このピリオドのYouTube URL', 'url', data.urls[period] ?? (period === 1 ? data.url : '') ?? '');
  const file = field('端末の動画を選ぶ（保存対象外）', 'file'); file.input.accept = 'video/*';
  toolbar.append(periodSelect, url.wrap, button('YouTubeを読み込む', () => {
    const id = parseYouTubeId(url.input.value.trim()); if (!id) return toast('有効なYouTube URLを入力してください');
    data.urls[period] = `https://www.youtube.com/watch?v=${id}`; if (period === 1) data.url = data.urls[period];
    if (localFiles.has(period)) URL.revokeObjectURL(localFiles.get(period)); localFiles.delete(period);localNames.delete(period); save(); load();
  }), file.wrap); root.append(toolbar);
  const frame = el('div', null, 'video-frame'); root.append(frame);
  const metadata=el('div',null,'video-metadata');metadata.setAttribute('aria-live','polite');root.append(metadata);
  const playback = el('div', null, 'toolbar');
  const pause = () => { localVideo?.pause(); player?.pauseVideo?.(); };
  const playing = () => localVideo ? !localVideo.paused : player?.getPlayerState?.() === 1;
  const resume = () => { if (localVideo) localVideo.play().catch(() => {}); else player?.playVideo?.(); };
  const speed = value => { if (localVideo) localVideo.playbackRate = value; else player?.setPlaybackRate?.(value); };
  const fast = button('押している間2倍速', () => {}); fast.style.touchAction = 'none';
  fast.addEventListener('pointerdown', e => { fast.setPointerCapture(e.pointerId); speed(2); });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) fast.addEventListener(type, () => speed(1));
  playback.append(button('−10秒', () => seek(currentTime() - 10, playing())), button('再生／停止', () => playing() ? pause() : resume()), button('＋10秒', () => seek(currentTime() + 10, playing())), fast, button('動画を拡大／戻す', () => { const expanded = frame.dataset.expanded !== 'true'; frame.dataset.expanded = String(expanded); frame.style.cssText = expanded ? 'position:fixed;inset:5vh 3vw;z-index:1000;background:#142c35;padding:20px;box-shadow:0 0 0 100vmax #000b;overflow:auto' : ''; if (expanded) { const close = button('拡大を閉じる', () => { frame.style.cssText = ''; frame.dataset.expanded = 'false'; close.remove(); }); frame.append(close); } }), button('この動画位置から試合を記録', () => { const clock = mapVideoToClock(data.anchors, period, currentTime()); if (clock == null) return toast('先に同期点を追加してください'); pause(); container.dispatchEvent(new CustomEvent('video-record', { bubbles: true, detail: { period, clockMs: clock } })); })); root.append(playback);
  const clipMode=field('切り抜きジェスチャーモード','checkbox');
  const gestureSurface=el('div','左：−10秒　中央：再生／停止　右：＋10秒','video-gesture-surface');gestureSurface.setAttribute('role','group');gestureSurface.setAttribute('tabindex','0');gestureSurface.setAttribute('aria-label','動画ジェスチャー操作エリア');gestureSurface.style.cssText='min-height:90px;display:flex;align-items:center;justify-content:center;border:2px dashed #7da996;border-radius:12px;background:#edf5ed;padding:15px;text-align:center;touch-action:none;user-select:none;-webkit-user-select:none';
  const gestureHelp=el('p','動画の下にある専用操作エリアです。タップで再生／停止、左右をダブルタップで±10秒。左右を長押しすると繰り返し送り／戻し、中央を長押しすると2倍速。YouTube標準の操作は動画内で使えます。','muted');
  const clipControls=el('div',null,'toolbar');clipControls.append(clipMode.wrap,button('前の切り抜き',()=>navigateClip(-1)),button('次の切り抜き',()=>navigateClip(1)));root.append(clipControls,gestureSurface,gestureHelp);
  let pointer=null,holdTimer=null,holdInterval=null,tapTimer=null,lastTap=null;
  const hasVideo=()=>Boolean(localVideo||player?.seekTo);
  function stopHold(){clearTimeout(holdTimer);clearInterval(holdInterval);holdTimer=holdInterval=null;speed(1);}
  function performGesture(action){if(!hasVideo())return toast('先に動画を読み込んでください');if(action.type==='toggle')playing()?pause():resume();else if(action.type==='seek'||action.type==='hold-seek')seek(currentTime()+action.seconds,playing());else if(action.type==='speed'){speed(action.rate);resume();}else if(action.type==='next')navigateClip(1);else if(action.type==='previous')navigateClip(-1);}
  gestureSurface.addEventListener('pointerdown',event=>{if(event.button>0||pointer)return;event.preventDefault();const bounds=gestureSurface.getBoundingClientRect();pointer={id:event.pointerId,x:event.clientX,y:event.clientY,at:performance.now(),ratio:(event.clientX-bounds.left)/bounds.width,held:false};gestureSurface.setPointerCapture(event.pointerId);holdTimer=setTimeout(()=>{if(!pointer)return;pointer.held=true;clearTimeout(tapTimer);const action=gestureAction({durationMs:450,ratio:pointer.ratio,clipMode:clipMode.input.checked});performGesture(action);if(action.type==='hold-seek')holdInterval=setInterval(()=>performGesture(action),220);},450);});
  gestureSurface.addEventListener('pointermove',event=>{if(!pointer||pointer.id!==event.pointerId)return;if(Math.abs(event.clientX-pointer.x)>35||Math.abs(event.clientY-pointer.y)>35)stopHold();});
  gestureSurface.addEventListener('pointerup',event=>{if(!pointer||pointer.id!==event.pointerId)return;const previous=pointer;pointer=null;stopHold();if(previous.held)return;const now=performance.now(),dx=event.clientX-previous.x,dy=event.clientY-previous.y,side=previous.ratio<.35?'left':previous.ratio>.65?'right':'center';const doubleTap=Boolean(lastTap&&now-lastTap.at<300&&lastTap.side===side);const action=gestureAction({dx,dy,durationMs:now-previous.at,ratio:previous.ratio,clipMode:clipMode.input.checked,doubleTap});if(action.type==='next'||action.type==='previous'){clearTimeout(tapTimer);lastTap=null;performGesture(action);}else if(action.type==='none'){clearTimeout(tapTimer);lastTap=null;}else if(doubleTap){clearTimeout(tapTimer);lastTap=null;performGesture(action);}else{lastTap={at:now,side};clearTimeout(tapTimer);tapTimer=setTimeout(()=>{lastTap=null;performGesture({type:'toggle'});},300);}});
  for(const event of ['pointercancel','lostpointercapture','blur'])gestureSurface.addEventListener(event,()=>{pointer=null;stopHold();});
  gestureSurface.addEventListener('contextmenu',event=>event.preventDefault());
  gestureSurface.addEventListener('keydown',event=>{if(event.key===' '||event.key==='Enter'){event.preventDefault();performGesture({type:'toggle'});}else if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();performGesture({type:'seek',seconds:(event.key==='ArrowLeft'?-1:1)*(clipMode.input.checked?5:10)});}else if(clipMode.input.checked&&['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();navigateClip(event.key==='ArrowUp'?1:-1);}});
  clipMode.input.addEventListener('change',()=>{stopSequence();gestureSurface.textContent=clipMode.input.checked?'左：−5秒　中央：再生／停止　右：＋5秒　上下スワイプ：切り抜きを切り替え':'左：−10秒　中央：再生／停止　右：＋10秒';gestureHelp.textContent=clipMode.input.checked?'切り抜きモード：左右ダブルタップは±5秒。上スワイプで次、下スワイプで前の場面へ。コメント時刻の5秒前から20秒後まで繰り返します（明示した範囲があれば優先）。':'動画下の専用操作エリアをタップで再生／停止、左右ダブルタップで±10秒。左右長押しで送り／戻し、中央長押しで2倍速。';});
  function navigateClip(direction){
    const clips=visibleComments().map(mappedComment).filter(c=>c.videoSeconds!=null);if(!clips.length)return toast('再生できる場面コメントがありません');if(!hasVideo())return toast('先に動画を読み込んでください');
    const current=clips.findIndex(c=>c.id===activeClipId);const next=current<0?(direction>0?0:clips.length-1):(current+direction+clips.length)%clips.length;const comment=clips[next];activeClipId=comment.id;clipMode.input.checked=true;gestureSurface.textContent='左：−5秒　中央：再生／停止　右：＋5秒　上下スワイプ：切り抜きを切り替え';
    stopSequence();const range=clipRange({...comment,endSeconds:comment.endSeconds??comment.videoSeconds+20});let since=Date.now();seek(range.start);sequenceStatus.textContent=`切り抜き ${next+1}/${clips.length}：${comment.text}（繰り返し）`;
    timer=setInterval(()=>{if(Date.now()-since>=1200&&currentTime()>=range.end){seek(range.start);since=Date.now();}},200);
  }
  function stopSequence() { if (timer) clearInterval(timer); timer = null; }
  function currentTime() { return localVideo ? localVideo.currentTime : Number(player?.getCurrentTime?.() ?? 0); }
  function seek(seconds, play = true) {
    if (localVideo) { localVideo.currentTime = Math.max(0, seconds); if (play) localVideo.play().catch(() => toast('動画の再生ボタンを押してください')); }
    else if (player?.seekTo) { player.seekTo(Math.max(0, seconds), true); if (play) player.playVideo(); }
    else toast('先に動画を読み込んでください');
  }
  async function load() {
    const token = ++generation; stopSequence();activeClipId=null;stopHold();clearTimeout(tapTimer);metadataController?.abort();metadataController=null;player?.destroy?.(); player = null; localVideo = null; frame.replaceChildren();metadata.replaceChildren();
    url.input.value = data.urls[period] ?? (period === 1 ? data.url : '') ?? '';
    if (localFiles.has(period)) { localVideo = el('video'); localVideo.controls = true; localVideo.playsInline = true; localVideo.src = localFiles.get(period); localVideo.style.cssText = 'width:100%;max-height:55vh'; frame.append(localVideo);metadata.append(el('strong',localNames.get(period)||'端末の動画'),el('p','この端末で選択した動画です。チャンネル情報はありません。外部に送信しません。','muted'));return; }
    const id = parseYouTubeId(url.input.value);
    if (!id) { frame.append(el('p', 'このピリオドの動画を指定してください。')); return; }
    metadata.append(el('p','動画タイトル・チャンネルを取得中…','muted'));metadataController=new AbortController();
    Promise.resolve(metadataCache.get(id)||fetchYouTubeMetadata(id,{signal:metadataController.signal})).then(value=>{if(destroyed||token!==generation)return;metadataCache.set(id,value);metadata.replaceChildren(el('strong',value.title),el('p',`チャンネル：${value.channel}`,'muted'));}).catch(error=>{if(destroyed||token!==generation)return;metadata.replaceChildren(el('p',`動画情報を取得できませんでした：${error.name==='AbortError'?'通信が中断されました':error.message}。動画の再生操作は引き続き利用できます。`,'muted'));});
    frame.append(el('p', 'YouTubeを読み込み中…'));
    try {
      const YT = await youtubeAPI(); if (destroyed || token !== generation) return;
      frame.replaceChildren(); const host = el('div'); frame.append(host);
      await new Promise(resolve => { player = new YT.Player(host, { width: '100%', height: '360', videoId: id, host: 'https://www.youtube-nocookie.com', playerVars: { playsinline: 1, rel: 0 }, events: { onReady: resolve, onError: () => { toast('動画を再生できません。公開範囲や埋め込み許可を確認してください'); resolve(); } } }); });
    } catch (error) { if (!destroyed && token === generation) frame.replaceChildren(el('p', error.message)); }
  }
  file.input.addEventListener('change', () => { const selected = file.input.files?.[0]; if (!selected) return; if (localFiles.has(period)) URL.revokeObjectURL(localFiles.get(period)); localFiles.set(period, URL.createObjectURL(selected));localNames.set(period,selected.name); load(); });
  periodSelect.addEventListener('change', () => { period = Number(periodSelect.value); load(); renderAnchors(); renderComments(); renderEvents(); });

  const sync = el('section', null, 'panel'); sync.append(el('h3', '試合時計との同期'));
  const clock = field('試合時計（分:秒）', 'text', '00:00'); clock.input.pattern = '\\d+:\\d{2}';
  const videoTime = field('動画の秒（空欄なら現在位置）', 'number'); videoTime.input.min = '0'; videoTime.input.step = '0.1';
  sync.append(clock.wrap, videoTime.wrap, button('同期点を追加', () => {
    const parsed = /^(\d+):([0-5]\d)$/.exec(clock.input.value.trim()); if (!parsed) return toast('時計を「10:12」の形式で入力してください');
    const seconds = videoTime.input.value === '' ? currentTime() : Number(videoTime.input.value);
    if (!Number.isFinite(seconds) || seconds < 0) return toast('動画の秒を確認してください');
    data.anchors.push({ id: uid(), period, clockMs: (Number(parsed[1]) * 60 + Number(parsed[2])) * 1000, videoSeconds: seconds }); save(); renderAnchors();
  }));
  sync.append(el('p', '時計停止の前後に同期点を追加すると、以降の場面を補正できます。同じ試合時計では後から追加した同期点を使います。'));
  const anchorList = el('div'); sync.append(anchorList); root.append(sync);
  function renderAnchors() { anchorList.replaceChildren(); data.anchors.forEach((anchor, index) => { if (anchor.period !== period) return; const row = el('div', null, 'toolbar'); row.append(el('span', `${formatClock(anchor.clockMs)} → 動画 ${Number(anchor.videoSeconds).toFixed(1)}秒`), button('削除', () => { data.anchors.splice(index, 1); save(); renderAnchors(); })); anchorList.append(row); }); }

  const eventSection = el('section', null, 'panel');eventSection.hidden=compact; eventSection.append(el('h3', '試合イベントへジャンプ')); const eventList = el('div', null, 'toolbar'); eventSection.append(eventList); root.append(eventSection);
  const eventFilter = el('select'); eventFilter.setAttribute('aria-label', '連続再生するイベント種類');
  for (const [value, label] of [['', '全イベント'], ['shot', 'シュート'], ['goal', '得点'], ['saved', 'セーブ'], ['turnover', 'ミス'], ['suspension', '2分退場']]) { const option = el('option', label); option.value = value; eventFilter.append(option); }
  eventSection.insertBefore(eventFilter, eventList);
  function filteredEvents() { return activeEvents(match).filter(e => e.period === period && (!eventFilter.value || e.type === eventFilter.value || e.result === eventFilter.value)); }
  eventFilter.addEventListener('change', renderEvents);
  eventSection.append(button('表示中のイベントを連続再生', () => { const clips = filteredEvents().map(event => ({ period, clockMs: event.clockMs, videoSeconds: mapClockToVideo(data.anchors, period, event.clockMs), text: `${formatClock(event.clockMs)} ${event.type}` })).filter(c => c.videoSeconds != null); runClips(clips); }));
  function renderEvents() { eventList.replaceChildren();if(compact)return; for (const event of filteredEvents()) { const row = el('div', null, 'toolbar'); row.append(button(`${formatClock(event.clockMs)} ${event.type} ${event.result ?? ''}`, () => { stopSequence(); const seconds = mapClockToVideo(data.anchors, period, event.clockMs); if (seconds == null) return toast('このピリオドの同期点を追加してください'); seek(seconds); }), button('メモを作成', () => { annotationClock = event.clockMs; commentClock.input.value = formatClock(event.clockMs); const at = mapClockToVideo(data.anchors, period, event.clockMs); seconds.input.value = at ?? ''; if (at != null) seek(at, false); pauseForInput(); text.input.value = `${event.type} ${event.result ?? ''}：`; text.input.focus(); })); eventList.append(row); } }

  const comments = el('section', null, 'panel');comments.hidden=compact; comments.append(el('h3', '場面コメント・クリップ'));
  const text = field('コメント'); const tags = field('タグ（カンマ区切り）'); const seconds = field('動画の秒（空欄なら現在位置）', 'number'); seconds.input.min = '0'; seconds.input.step = '.1';
  const author = field('作者名（この端末に保存）', 'text', state.preferences.author ?? ''); author.input.maxLength = '100';
  const commentClock = field('試合時計（動画なしのメモでも利用可）', 'text', formatClock(match.clock.elapsed));
  commentClock.input.addEventListener('input', () => { annotationClock = null; });
  const blocked = () => state.preferences.blockedWords ?? [];
  function pauseForInput() { if (playing()) resumeAfterInput = true; pause(); }
  const floatingMemo=button('＋ 動画メモを追加',()=>{
    if(editing)resetForm();
    const timestamp=memoTimestamp({anchors:data.anchors,period,videoSeconds:hasVideo()?currentTime():null,matchClockMs:clockMs(match)});
    annotationClock=timestamp.clockMs;seconds.input.value=timestamp.videoSeconds??'';commentClock.input.value=formatClock(timestamp.clockMs);pauseForInput();
    comments.scrollIntoView({behavior:'smooth',block:'start'});
    try{text.input.focus({preventScroll:true});}catch{text.input.focus();}
    if(timestamp.videoSeconds!=null&&!timestamp.synchronized)toast('動画位置をメモに入れました。同期点がないため試合時計は記録時計を使います。');
  });
  floatingMemo.classList.add('video-floating-memo');floatingMemo.setAttribute('aria-label','現在の動画位置でメモを追加');floatingMemo.style.cssText='position:fixed;right:22px;z-index:90;min-height:48px;padding:13px 20px;background:#123d39;color:white;border:1px solid #90bda4;border-radius:28px;box-shadow:0 6px 24px #183d3940;font-weight:700;max-width:calc(100vw - 32px)';
  let keyboardTimer=null;
  const viewport=globalThis.visualViewport;
  function placeFloatingMemo(){if(compact||destroyed)return;const mobile=globalThis.matchMedia?.('(max-width:600px)').matches??innerWidth<=600;const bottom=floatingMemoBottom({innerHeight,viewportHeight:viewport?.height??innerHeight,offsetTop:viewport?.offsetTop??0,mobile});floatingMemo.style.bottom=`calc(${bottom}px + env(safe-area-inset-bottom, 0px))`;const right=Math.max(18,innerWidth-((viewport?.width??innerWidth)+(viewport?.offsetLeft??0))+18);floatingMemo.style.right=`${right}px`;}
  function onKeyboardResize(){placeFloatingMemo();clearTimeout(keyboardTimer);keyboardTimer=setTimeout(()=>{if(!destroyed&&document.activeElement===text.input)text.input.scrollIntoView({behavior:'smooth',block:'center'});},100);}
  if(!compact){root.append(floatingMemo);placeFloatingMemo();viewport?.addEventListener('resize',onKeyboardResize);viewport?.addEventListener('scroll',placeFloatingMemo);globalThis.addEventListener('resize',placeFloatingMemo);}
  for (const input of [text.input, tags.input, author.input, seconds.input, commentClock.input]) input.addEventListener('focus', pauseForInput);
  const start = field('範囲開始秒（省略可）', 'number'), end = field('範囲終了秒（省略可）', 'number'); start.input.min = end.input.min = '0';
  const tactic = el('select'); tactic.setAttribute('aria-label', '関連する作戦'); const blank = el('option', '作戦との関連なし'); blank.value = ''; tactic.append(blank);
  for (const item of state.tactics) { const option = el('option', item.name ?? item.title ?? '作戦'); option.value = item.id; tactic.append(option); }
  const submit = button('コメントを保存', () => {
    if (!text.input.value.trim()) return toast('コメントを入力してください');
    if (![text.input.value, tags.input.value, author.input.value].every(value => allowedText(value, blocked()))) return toast('設定された禁止語を含んでいます');
    const hasVideo = Boolean(localVideo || player?.seekTo);
    const at = seconds.input.value === '' ? (hasVideo ? currentTime() : null) : Number(seconds.input.value);
    if (at != null && (!Number.isFinite(at) || at < 0)) return toast('動画の秒を確認してください');
    const parsedClock = /^(\d+):([0-5]\d)$/.exec(commentClock.input.value.trim()); if (!parsedClock) return toast('試合時計は「10:12」の形式です');
    const matchClock = annotationClock ?? (Number(parsedClock[1]) * 60 + Number(parsedClock[2])) * 1000;
    const from = start.input.value === '' ? null : Number(start.input.value), to = end.input.value === '' ? null : Number(end.input.value);
    if ((from != null && (!Number.isFinite(from) || from < 0)) || (to != null && (!Number.isFinite(to) || to <= (from ?? Math.max(0, at - 5))))) return toast('クリップの開始・終了秒を確認してください');
    const selectedTactic = state.tactics.find(t => t.id === tactic.value); if (selectedTactic && !attachableTactic(selectedTactic)) return toast('コメント添付の作戦は30秒以内にしてください');
    const previous = data.comments.find(c => c.id === editing);
    const entry = { ...(previous ?? {}), id: editing ?? uid(), period, videoSeconds: at, clockMs: matchClock, author: author.input.value.trim() || '記録者', text: text.input.value.trim(), tags: tags.input.value.split(/[,、]/).map(s => s.trim()).filter(Boolean), tacticId: tactic.value || null, tacticSnapshot: selectedTactic ? structuredClone(selectedTactic) : tactic.value === previous?.tacticId ? previous?.tacticSnapshot ?? null : null, startSeconds: from, endSeconds: to, likes: previous?.likes ?? [], replies: previous?.replies ?? [] };
    state.preferences.author = author.input.value.trim();
    if (editing) data.comments = data.comments.map(c => c.id === editing ? entry : c); else data.comments.push(entry);
    resetForm(); save(); renderComments(); if (resumeAfterInput) { resumeAfterInput = false; resume(); }
  });
  function resetForm() { editing = null; annotationClock = null; for (const input of [text.input, tags.input, seconds.input, start.input, end.input]) input.value = ''; tactic.value = ''; submit.textContent = 'コメントを保存'; }
  const filter = field('タグで絞り込み（カンマで複数・すべて一致）'); filter.input.addEventListener('input', renderComments);
  comments.append(author.wrap, text.wrap, tags.wrap, commentClock.wrap, seconds.wrap, start.wrap, end.wrap, tactic, submit, button('編集を取り消す', () => { resetForm(); if (resumeAfterInput) { resumeAfterInput = false; resume(); } }), filter.wrap);
  const sequenceStatus = el('p');
  const loop = field('連続再生を繰り返す', 'checkbox');
  function visibleComments() { return data.comments.filter(c => c.period === period && matchesTags(c, filter.input.value)).sort((a, b) => (a.clockMs ?? a.videoSeconds * 1000) - (b.clockMs ?? b.videoSeconds * 1000)); }
  function mappedComment(comment) { return { ...comment, videoSeconds: comment.videoSeconds ?? mapClockToVideo(data.anchors, comment.period, comment.clockMs ?? 0) }; }
  function runClips(clips) {
    stopSequence(); clips = clips.map(mappedComment).filter(c => c.videoSeconds != null).map(c => ({ ...c, endSeconds: c.endSeconds ?? c.videoSeconds + 20 })); if (!clips.length) return toast('再生可能な場面がありません。動画と同期点を確認してください');
    if (!localVideo && !player?.seekTo) return toast('先に動画を読み込んでください');
    let index = 0, since = Date.now();
    function next() { const range = clipRange(clips[index]); seek(range.start); sequenceStatus.textContent = `連続再生 ${index + 1}/${clips.length}：${clips[index].text}`; since = Date.now(); }
    next(); timer = setInterval(() => { if (Date.now() - since < 1200) return; if (currentTime() >= clipRange(clips[index]).end) { index++; if (index >= clips.length && loop.input.checked) index = 0; if (index >= clips.length) { stopSequence(); pause(); sequenceStatus.textContent = '連続再生が完了しました'; } else next(); } }, 200);
  }
  comments.append(loop.wrap, button('絞り込んだ場面を連続再生', () => runClips(visibleComments())), button('連続再生を停止', () => { stopSequence(); pause(); sequenceStatus.textContent = ''; }), sequenceStatus);
  const commentList = el('div'); comments.append(commentList); root.append(comments);
  function renderComments() {
    commentList.replaceChildren();
    if(compact)return;
    for (const comment of visibleComments()) {
      const card = el('article', null, 'comment-card'); card.append(el('strong', `${comment.author ?? '記録者'} · ${comment.videoSeconds == null ? `試合 ${formatClock(comment.clockMs ?? 0)}` : `${Number(comment.videoSeconds).toFixed(1)}秒`}　${(comment.tags ?? []).join(' / ')}`), el('p', comment.text));
      card.append(button('この場面を再生', () => { stopSequence(); const mapped = mappedComment(comment); if (mapped.videoSeconds == null) return toast('動画と同期点を登録してください'); seek(clipRange(mapped).start); }), button('この場面をループ', () => { loop.input.checked = true; runClips([comment]); }));
      if (comment.tacticId) { const selected = state.tactics.find(t => t.id === comment.tacticId); card.append(button(`関連作戦：${selected?.name ?? selected?.title ?? '削除済み'}`, () => { if (!selected) return toast('関連作戦は削除されています'); const detail = el('div', null, 'panel'); detail.append(el('h4', selected.name ?? selected.title ?? '関連作戦'), el('p', selected.description ?? selected.notes ?? '作戦盤タブでこの作戦を開いて確認できます。')); card.append(detail); container.dispatchEvent(new CustomEvent('open-tactic', { bubbles: true, detail: { tacticId: selected.id } })); })); }
      card.append(button(`いいね ${(comment.likes ?? []).length}`, () => { const name = author.input.value.trim() || state.preferences.author; if (!name) return toast('作者名を入力してください'); if (!allowedText(name, blocked())) return toast('設定された禁止語を含んでいます'); comment.likes ??= []; comment.likes = comment.likes.includes(name) ? comment.likes.filter(n => n !== name) : [...comment.likes, name]; save(); renderComments(); }), el('small', (comment.likes ?? []).join('、')));
      const replyText = field('返信'); replyText.input.addEventListener('focus', pauseForInput); card.append(replyText.wrap, button('返信を追加', () => { const value = replyText.input.value.trim(), name = author.input.value.trim() || '記録者'; if (!value) return; if (!allowedText(value + name, blocked())) return toast('設定された禁止語を含んでいます'); (comment.replies ??= []).push({ id: uid(), text: value, author: name, videoSeconds: currentTime(), period }); save(); renderComments(); if (resumeAfterInput) { resumeAfterInput = false; resume(); } }));
      for (const reply of comment.replies ?? []) { const row = el('div', null, 'panel'); row.append(el('p', `${reply.author ?? '記録者'}：${reply.text}`), button('返信の時刻へ', () => { if (reply.videoSeconds != null) seek(reply.videoSeconds); }), button('元の場面へ', () => { const mapped = mappedComment(comment); if (mapped.videoSeconds != null) seek(mapped.videoSeconds); }), button('返信を編集', () => { pauseForInput(); const value = prompt('返信を編集', reply.text); if (value?.trim() && allowedText(value, blocked())) { reply.text = value.trim(); save(); renderComments(); } }), button('返信を削除', () => { comment.replies = comment.replies.filter(r => r.id !== reply.id); save(); renderComments(); })); card.append(row); }
      if (comment.tacticSnapshot) card.append(button('添付した作戦を繰り返し表示', () => previewTactic(card, comment.tacticSnapshot)));
      card.append(button('編集', () => { editing = comment.id; text.input.value = comment.text; tags.input.value = (comment.tags ?? []).join(', '); seconds.input.value = comment.videoSeconds ?? ''; commentClock.input.value = formatClock(comment.clockMs ?? 0); author.input.value = comment.author ?? author.input.value; start.input.value = comment.startSeconds ?? ''; end.input.value = comment.endSeconds ?? ''; tactic.value = comment.tacticId ?? ''; submit.textContent = 'コメントを更新'; text.input.focus(); }), button('削除', () => { data.comments = data.comments.filter(c => c.id !== comment.id); if (editing === comment.id) resetForm(); save(); renderComments(); }));
      commentList.append(card);
    }
    if (!commentList.children.length) commentList.append(el('p', 'この条件のコメントはありません。'));
  }
  function previewTactic(card, tactic) {
    if (!attachableTactic(tactic)) return toast('添付作戦のデータが不正、または30秒を超えています');
    cancelAnimationFrame(tacticRaf); root.querySelector('[data-tactic-preview]')?.remove();
    const box = el('div', null, 'panel'); box.dataset.tacticPreview = 'true'; const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 1000 750'); svg.style.cssText = 'width:100%;max-height:45vh;background:#f3dcb6'; box.append(svg, button('作戦の再生を閉じる', () => { cancelAnimationFrame(tacticRaf); box.remove(); })); card.append(box);
    const start = performance.now(), total = durationOf(tactic.frames);
    function tick(now) { if (!box.isConnected || destroyed) return; const frame = timelineFrame(tactic.frames, total ? (now - start) % total : 0); svg.replaceChildren(); for (const piece of [...frame.players, { ...frame.ball, id: 'ball' }]) { const circle = document.createElementNS(svg.namespaceURI, 'circle'); circle.setAttribute('cx', piece.x * 1000); circle.setAttribute('cy', piece.y * 750); circle.setAttribute('r', piece.id === 'ball' ? 12 : 25); circle.setAttribute('fill', piece.id === 'ball' ? '#ffd747' : piece.team === 'home' ? '#087f8c' : '#e78a48'); svg.append(circle); if (piece.number != null) { const number = document.createElementNS(svg.namespaceURI, 'text'); number.setAttribute('x', piece.x * 1000); number.setAttribute('y', piece.y * 750 + 8); number.setAttribute('text-anchor', 'middle'); number.setAttribute('fill', '#fff'); number.textContent = piece.number; svg.append(number); } } tacticRaf = requestAnimationFrame(tick); } tacticRaf = requestAnimationFrame(tick);
  }
  load(); renderAnchors(); renderEvents(); renderComments();
  const cleanup = () => { destroyed = true; generation++; stopSequence();stopHold();clearTimeout(tapTimer);clearTimeout(keyboardTimer);viewport?.removeEventListener('resize',onKeyboardResize);viewport?.removeEventListener('scroll',placeFloatingMemo);globalThis.removeEventListener('resize',placeFloatingMemo);floatingMemo.remove();metadataController?.abort(); cancelAnimationFrame(tacticRaf); player?.destroy?.(); localVideo?.pause(); for (const url of localFiles.values()) URL.revokeObjectURL(url); };
  cleanup.getClock=()=>({period,clockMs:!destroyed&&(localVideo||player?.seekTo)?mapVideoToClock(data.anchors,period,currentTime()):null});
  cleanup.getPlaybackState=()=>({playing:!destroyed&&playing(),videoSeconds:currentTime(),period});
  cleanup.resume=()=>{if(!destroyed)resume();};cleanup.pause=()=>{if(!destroyed)pause();};
  return cleanup;
}
