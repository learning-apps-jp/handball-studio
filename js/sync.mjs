import {validateState} from './core.mjs';
/** Bearer-code sync. Use the same HTTPS origin as the app on an iPad. */
async function api(method,route,body,{server=globalThis.location?.origin||'',rev,fetcher=globalThis.fetch,timeoutMs=15000}={}) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);try {
  const response=await fetcher(server.replace(/\/$/,'')+'/api/rooms'+route,{method,signal:controller.signal,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(rev!=null?{'If-Match':String(rev)}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  let value;try{value=await response.json();}catch{throw new Error('同期サーバーを起動し、同じURLからアプリを開いてください');}
  if(!response.ok)throw Object.assign(new Error(value.error||'同期に失敗しました'),{status:response.status});return value;
  }finally{clearTimeout(timer);}
}
function checked(code){const c=String(code).trim().toUpperCase();if(!/^[A-Z2-9]{8}$/.test(c))throw new Error('共有コードは8文字です');return c;}
export const createRoom=(scope,payload,options)=>api('POST','',{scope,payload},options);
export const joinRoom=(code,options)=>api('GET','/'+checked(code),undefined,options);
export const pushRoom=(code,payload,rev,options={})=>api('PUT','/'+checked(code),{payload},{...options,rev});
export const rotateRoom=(code,rev,options={})=>api('POST','/'+checked(code)+'/rotate',{},{...options,rev});
export const stopRoom=(code,rev,options={})=>api('DELETE','/'+checked(code),undefined,{...options,rev});
function syncState(state){state.sync??={rooms:[],queue:[]};state.sync.rooms??=[];state.sync.queue??=[];return state.sync;}
function entity(state,scope,id){if(scope==='match'){const match=state.matches.find(x=>x.id===id);if(!match)return undefined;return {match,teams:state.teams.filter(t=>[match.homeTeamId,match.awayTeamId].includes(t.id))};}if(scope==='roster')return state.teams.find(x=>x.id===id);if(scope==='inventory')return state.inventory;throw new Error('不明な共有対象です');}
function validPayload(scope,payload){if(scope==='inventory')return Array.isArray(payload);if(scope==='match')return payload?.match&&typeof payload.match.id==='string'&&Array.isArray(payload.match.events)&&Array.isArray(payload.teams);return payload&&typeof payload==='object'&&typeof payload.id==='string'&&(typeof payload.name==='string'&&Array.isArray(payload.players));}
function cleanPayload(value){const result=structuredClone(value);if(result&&typeof result==='object'&&!Array.isArray(result)){delete result.sync;delete result.sharedCode;}return result;}
export function applyRemote(state,room) {
  if(!['match','roster','inventory'].includes(room.scope)||!validPayload(room.scope,room.payload))throw new Error('共有データ形式が不正です');
  const payload=cleanPayload(room.payload),candidate=structuredClone(state);
  if(room.scope==='inventory')candidate.inventory=payload;
  else if(room.scope==='match') {
    const participantIds=[payload.match.homeTeamId,payload.match.awayTeamId];
    for(const incoming of payload.teams){
      if(!participantIds.includes(incoming?.id))throw new Error('試合に無関係な名簿が含まれています');
      if(!incoming||typeof incoming.id!=='string'||!Array.isArray(incoming.players))throw new Error('試合の名簿データが不正です');
      const existing=candidate.teams.find(t=>t.id===incoming.id);
      if(!existing)candidate.teams.push(incoming);else {const known=new Set(existing.players.map(p=>p.id));existing.players.push(...incoming.players.filter(p=>!known.has(p.id)));}
    }
    candidate.matches=candidate.matches.filter(m=>m.id!==payload.match.id);candidate.matches.push(payload.match);
  } else {candidate.teams=candidate.teams.filter(t=>t.id!==payload.id);candidate.teams.push(payload);}
  if(candidate.schemaVersion===1)validateState(candidate);
  state.matches=candidate.matches;state.teams=candidate.teams;state.inventory=candidate.inventory;
  return payload;
}
function sameTarget(remote,room){if(remote.scope!==room.scope||payloadId(remote.payload,remote.scope)!==room.id)throw new Error('共有対象のIDが変更されています。自動取込を停止しました');}
function payloadId(payload,scope){return scope==='match'?payload.match.id:scope==='roster'?payload.id:'inventory';}
export function queueRoom(state,room,payload) {
  const sync=syncState(state);const previous=sync.queue.find(q=>q.code===room.code);
  if(previous){previous.payload=cleanPayload(payload);return previous;}
  const item={code:room.code,rev:room.rev,scope:room.scope,payload:cleanPayload(payload),createdAt:Date.now(),status:'pending'};sync.queue.push(item);return item;
}
const flushLocks=new WeakMap();
export function flushQueue(state,options={}) {const previous=flushLocks.get(state)||Promise.resolve();const operation=previous.catch(()=>{}).then(()=>performFlush(state,options));flushLocks.set(state,operation);return operation;}
async function performFlush(state,{save=async()=>{},...options}={}) {
  const sync=syncState(state);const result={sent:0,conflicts:0,pending:0};
  for(const item of [...sync.queue]) {
    if(item.status==='conflict'){result.conflicts++;continue;}
    try {const sentPayload=structuredClone(item.payload);const sentRev=item.rev;const remote=await pushRoom(item.code,sentPayload,sentRev,options);const room=sync.rooms.find(r=>r.code===item.code);if(room){room.rev=remote.rev;room.fingerprint=JSON.stringify(sentPayload);room.expiresAt=remote.expiresAt;room.status='synced';}if(JSON.stringify(item.payload)===JSON.stringify(sentPayload))sync.queue=sync.queue.filter(q=>q!==item);else {item.rev=remote.rev;item.status='pending';}result.sent++;await save();}
    catch(e){item.status=e.status===409?'conflict':'pending';item.error=e.message;if(e.status===409)result.conflicts++;await save();}
  }
  result.pending=sync.queue.length;return result;
}
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/** Manual upload/download plus periodic change detection. Cleanup stops polling; no hidden destructive merge. */
export function mountSync(container,{state,save,toast=()=>{},server=globalThis.location?.origin||''}) {
  const sync=syncState(state);let disposed=false,busy=false;const opts={server};
  function draw(){if(disposed)return;container.innerHTML=`<h2>端末間の共有・同期</h2><p class="muted">共有コードを知る人は閲覧・編集できます。このアプリと同じ同期サーバーへの接続が必要です。オフラインの変更は端末に待機します。</p><div class="toolbar"><select data-scope aria-label="共有の種類"><option value="match">試合</option><option value="roster">名簿</option><option value="inventory">備品</option></select><select data-entity aria-label="共有するデータ"></select><button class="btn" data-create>共有を開始</button></div><div class="toolbar"><input data-code maxlength="8" placeholder="8文字の共有コード" aria-label="共有コード"><button class="btn" data-join>コードで取り込む</button><button class="btn" data-flush>未送信を再送 (${sync.queue.length})</button></div><div data-rooms>${sync.rooms.map((r,i)=>`<div class="panel section-gap"><strong>${esc(r.scope)} · ${esc(r.code)}</strong><p>版 ${r.rev} · ${esc(sync.queue.find(q=>q.code===r.code)?.status||r.status||'synced')} · 保存期限 ${new Date(r.expiresAt).toLocaleDateString('ja-JP')}</p><div class="toolbar"><button class="btn" data-upload="${i}">変更を送信</button><button class="btn" data-download="${i}">最新を取り込む</button><button class="btn" data-local="${i}">競合：端末の内容を優先</button><button class="btn" data-rotate="${i}">コード再発行</button><button class="btn" data-detach="${i}">この端末の同期を解除</button><button class="btn danger" data-delete="${i}">サーバーから削除</button></div></div>`).join('')}</div><p class="notice">競合時は自動上書きしません。端末データをバックアップし、「最新を取り込む」で確認するか、別コードで端末の内容を共有してください。サーバーは最終書込から180日で期限切れです。</p>`;
    const scope=container.querySelector('[data-scope]'),choice=container.querySelector('[data-entity]');const choices=()=>{const list=scope.value==='match'?state.matches:scope.value==='roster'?state.teams:[];choice.innerHTML=list.map(x=>`<option value="${esc(x.id)}">${esc(x.name||x.opponent||x.id)}</option>`).join('');choice.hidden=scope.value==='inventory';};scope.onchange=choices;choices();
    function run(fn){return async()=>{if(busy)return;busy=true;try{await fn();await save();toast('同期処理を完了しました');}catch(e){toast(e.message);}finally{busy=false;draw();}};}
    container.querySelector('[data-create]').onclick=run(async()=>{const payload=entity(state,scope.value,choice.value);if(!payload)throw new Error('共有するデータがありません');const r=await createRoom(scope.value,cleanPayload(payload),opts);sync.rooms.push({code:r.code,scope:r.scope,id:payloadId(payload,r.scope),rev:r.rev,expiresAt:r.expiresAt,fingerprint:JSON.stringify(cleanPayload(payload))});});
    container.querySelector('[data-join]').onclick=run(async()=>{const r=await joinRoom(container.querySelector('[data-code]').value,opts);if(!globalThis.confirm('同じIDのデータがある場合は置き換わります。先にバックアップしてください。取り込みますか？'))return;applyRemote(state,r);sync.rooms=sync.rooms.filter(x=>x.code!==r.code);sync.rooms.push({code:r.code,scope:r.scope,id:payloadId(r.payload,r.scope),rev:r.rev,expiresAt:r.expiresAt,fingerprint:JSON.stringify(cleanPayload(entity(state,r.scope,payloadId(r.payload,r.scope))))});});
    container.querySelector('[data-flush]').onclick=run(async()=>{const result=await flushQueue(state,{save,...opts});if(result.conflicts)throw new Error('競合があります。端末側の変更を保持しました');if(result.pending)throw new Error('未送信が残っています。接続を確認してください');});
    for(const action of ['upload','download','local','rotate','detach','delete'])for(const button of container.querySelectorAll(`[data-${action}]`))button.onclick=run(async()=>{const r=sync.rooms[Number(button.dataset[action])];if(action==='upload'){const payload=entity(state,r.scope,r.id);if(!payload)throw new Error('対象データがありません');queueRoom(state,r,payload);await save();const result=await flushQueue(state,{save,...opts});if(result.conflicts)throw new Error('他端末と競合しています。変更は端末に保持しました');if(result.pending)throw new Error('オフラインのため送信待ちです');}else if(action==='download'){const remote=await joinRoom(r.code,opts);sameTarget(remote,r);if(!globalThis.confirm('端末側の対象データと未送信変更を置き換えます。先にバックアップしてください。取り込みますか？'))return;applyRemote(state,remote);sync.queue=sync.queue.filter(x=>x.code!==r.code);Object.assign(r,{rev:remote.rev,expiresAt:remote.expiresAt,fingerprint:JSON.stringify(cleanPayload(entity(state,r.scope,r.id))),status:'synced'});}else if(action==='local'){if(!globalThis.confirm('他端末の変更を、この端末の現在の内容で置き換えます。双方のバックアップ後に続けてください。送信しますか？'))return;const remote=await joinRoom(r.code,opts);const payload=entity(state,r.scope,r.id);const item=queueRoom(state,r,payload);item.rev=remote.rev;item.status='pending';await save();const result=await flushQueue(state,{save,...opts});if(result.conflicts)throw new Error('再び競合しました。変更は保持しています');if(result.pending)throw new Error('未送信が残っています');}else if(action==='rotate'){if(sync.queue.some(q=>q.code===r.code))throw new Error('未送信を解決してから再発行してください');const remote=await rotateRoom(r.code,r.rev,opts);Object.assign(r,{code:remote.code,rev:remote.rev,expiresAt:remote.expiresAt});}else {if(!globalThis.confirm(action==='delete'?'この共有データをサーバーから削除しますか？他端末も接続できなくなります。':'この端末の同期と未送信キューを解除しますか？試合・名簿・備品自体は残ります。'))return;if(action==='delete')await stopRoom(r.code,r.rev,opts);sync.rooms=sync.rooms.filter(x=>x!==r);sync.queue=sync.queue.filter(x=>x.code!==r.code);}});
  }
  draw();return ()=>{disposed=true;};
}

/** App-wide serial two-way synchronization. Local edits win only with an explicit CAS success. */
export function startSync({state,save=async()=>{},toast=()=>{},onRemote=()=>{},server=globalThis.location?.origin||'',intervalMs=5000}) {
  let disposed=false,busy=false;const sync=syncState(state),options={server};
  async function tick(){
    if(disposed||busy||!sync.rooms.length)return;busy=true;let remoteChanged=false;
    try {
      for(const room of [...sync.rooms]) {
        if(disposed)break;
        const local=entity(state,room.scope,room.id);if(!local)continue;
        const fingerprint=JSON.stringify(cleanPayload(local));
        if(fingerprint!==room.fingerprint){queueRoom(state,room,local);await save();}
        const pending=sync.queue.find(q=>q.code===room.code);
        if(pending?.status==='conflict')continue;
        if(pending){
          await flushQueue(state,{save,...options});
          const after=sync.queue.find(q=>q.code===room.code);if(after){if(after.status==='conflict'&&room.status!=='conflict'){room.status='conflict';toast('別端末と変更が競合しました。端末の記録は保持しています。保存・共有画面で解決してください');await save();}continue;}
        }
        const remote=await joinRoom(room.code,options);if(disposed)break;sameTarget(remote,room);
        if(remote.rev!==room.rev) {
          // User edits may have arrived while the GET request was pending.
          const current=entity(state,room.scope,room.id);
          if(JSON.stringify(cleanPayload(current))!==room.fingerprint){queueRoom(state,room,current);await save();continue;}
          applyRemote(state,remote);Object.assign(room,{rev:remote.rev,expiresAt:remote.expiresAt,fingerprint:JSON.stringify(cleanPayload(entity(state,room.scope,room.id))),status:'synced'});await save();remoteChanged=true;
        }
      }
      if(remoteChanged&&!disposed)onRemote();
    }catch(e){if(e.status===404){toast('共有コードが無効か期限切れです。保存・共有画面を確認してください');}/* Network failure leaves local records/outbox intact. */}
    finally{busy=false;}
  }
  const timer=setInterval(tick,Math.max(1000,intervalMs));const online=()=>tick();globalThis.addEventListener?.('online',online);void tick();
  return ()=>{disposed=true;clearInterval(timer);globalThis.removeEventListener?.('online',online);};
}






