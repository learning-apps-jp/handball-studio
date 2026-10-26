/** User-confirmed acceptance checks are deliberately separate from browser diagnostics. */
export const READINESS_CHECKS = Object.freeze([
  { id: 'homeScreen', label: 'iPadのホーム画面に追加して起動できた', detail: 'Safariの共有から「ホーム画面に追加」し、そのアイコンから開いて確認します。' },
  { id: 'offlineRestart', label: '機内モードで再起動し、試合を開けた', detail: '先にオンラインで準備完了を確認し、アプリを閉じてから機内モードで起動します。YouTube再生は対象外です。' },
  { id: 'recordUndo', label: '得点・失敗の記録と取消を確認した', detail: '練習用の試合で記録し、取消後にスコアとシュート数が戻ることを確かめます。' },
  { id: 'goalkeeperChange', label: 'GK交代前後の記録が正しく分かれた', detail: 'GKを切り替えてセーブ・失点を記録し、GKごとの集計を確認します。' },
  { id: 'backupRestore', label: 'バックアップの保存と復元を確認した', detail: '現在のデータを先に保管します。練習用データでファイル出力と復元を試し、試合数・内容を確認します。' },
  { id: 'videoExport', label: '作戦動画を書き出し、iPadで再生できた', detail: '作戦盤で短い動画を出力し、ファイルに保存して再生します。端末ごとの対応形式を確認します。' }
]);

export function normalizeReadiness(value) {
  return { dismissed: value?.dismissed === true, checks: Object.fromEntries(READINESS_CHECKS.map(item => [item.id, value?.checks?.[item.id] === true])) };
}

export function setReadinessCheck(value, id, checked, { source = 'manual' } = {}) {
  if (source !== 'manual') throw new Error('実機の確認項目は手動でのみ更新できます');
  if (!READINESS_CHECKS.some(item => item.id === id) || typeof checked !== 'boolean') throw new Error('確認項目が不正です');
  const next = normalizeReadiness(value); next.checks[id] = checked; return next;
}

// Mirrors the files required to launch the PWA. Cache checks never mark the manual list.
export const OFFLINE_ASSETS = Object.freeze(['./', './index.html', './styles.css', './icon.svg', './icon-180.png', './icon-192.png', './icon-512.png', './manifest.webmanifest', './js/app.mjs', './js/core.mjs', './js/storage.mjs', './js/tactics.mjs', './js/video.mjs', './js/export.mjs', './js/sync.mjs', './js/advanced-analysis.mjs', './js/readiness.mjs', './js/dashboard.mjs', './js/personal-report.mjs','./js/record-flow.mjs','./js/event-details.mjs','./js/record-feedback.mjs']);

/** Inspect actual Service Worker and CacheStorage handles; does not infer from user-agent. */
export async function inspectOfflineAssets({ navigatorObject = globalThis.navigator, cacheStorage = globalThis.caches, baseURL = globalThis.location?.href, timeoutMs = 3000 } = {}) {
  if (!navigatorObject?.serviceWorker || !cacheStorage?.keys || !cacheStorage?.open || !baseURL) return { status: 'unsupported', reason: 'この環境ではService WorkerまたはCacheStorageを利用できません' };
  let timer;
  try {
    const registration = await Promise.race([navigatorObject.serviceWorker.ready, new Promise(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); })]);
    clearTimeout(timer);
    const expectedScope = new URL('./', baseURL).href;
    if (!registration?.active || registration.active.state !== 'activated' || registration.scope !== expectedScope) return { status: 'incomplete', reason: 'このアプリのService Workerがまだ準備されていません' };
    const expectedWorker = new URL('sw.js', expectedScope).href;
    if (navigatorObject.serviceWorker.controller?.scriptURL !== expectedWorker) return { status: 'incomplete', reason: 'この画面へのオフライン制御がまだ有効ではありません。準備後に再読み込みしてください' };
    const names = (await cacheStorage.keys()).filter(name => name.startsWith('handball-studio-'));
    if (names.length !== 1) return { status: 'incomplete', reason: names.length ? 'アプリの更新準備中です。少し待って再確認してください' : 'オフライン資産がまだ保存されていません' };
    const release = names[0], cache = await cacheStorage.open(release), requests = await cache.keys();
    const saved = new Set(requests.filter(request => { const url = new URL(request.url); return url.searchParams.get('release') === release; }).map(request => { const url = new URL(request.url); return `${url.origin}${url.pathname}`; }));
    const missing = OFFLINE_ASSETS.filter(asset => !saved.has(new URL(asset, expectedScope).href));
    if (missing.length) return { status: 'incomplete', reason: `必要なファイルが${missing.length}件未保存です。オンラインで更新を読み込んでください`, missing, release };
    // A request key alone is insufficient: verify each cached response still exists.
    for (const asset of OFFLINE_ASSETS) {
      const url = new URL(asset, expectedScope); url.searchParams.set('release', release);
      const response = await cache.match(url.href);
      if (!response?.ok) return { status: 'incomplete', reason: '保存ファイルの一部を読み出せません。オンラインで再確認してください', missing: [asset], release };
    }
    return { status: 'ready', reason: 'このブラウザ内に起動用ファイルが揃っています。iPad実機での動作確認は下の手動チェックで行ってください', release };
  } catch { clearTimeout(timer); return { status: 'incomplete', reason: 'オフライン資産を確認できませんでした。ブラウザの保存設定と通信状態を確認してください' }; }
}

function element(tag, text, className) { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; }
function action(label, callback) { const node = element('button', label, 'btn'); node.type = 'button'; node.addEventListener('click', callback); return node; }

export function mountReadiness(container, { state, save, toast = () => {}, onNavigate = () => {}, onSample = () => {}, readonly = false, detailed = false }) {
  let disposed = false, checking = false, generation = 0;
  const initial = normalizeReadiness(state.preferences?.readiness);
  if (readonly || (initial.dismissed && !detailed)) { container.replaceChildren(); container.hidden = true; return () => { disposed = true; }; }
  container.hidden = false;
  state.preferences ??= {}; state.preferences.readiness = initial;
  const panel = element('section', null, 'panel'); panel.setAttribute('aria-label', 'iPadで使う準備'); panel.style.marginBlock = '16px'; container.replaceChildren(panel);
  const heading = element('div', null, 'toolbar'); heading.append(element('h2', detailed ? 'iPadの準備と実機確認' : 'まずは練習用の試合で、操作を確かめましょう'));
  if (!detailed) heading.append(action('この案内を閉じる', async event => {
    const old = state.preferences.readiness, next = { ...normalizeReadiness(old), dismissed: true }; event.currentTarget.disabled = true; state.preferences.readiness = next;
    try { await save(); if (!disposed) { container.replaceChildren(); container.hidden = true; } } catch (error) { if (state.preferences.readiness === next) state.preferences.readiness = old; if (!disposed) event.target.disabled = false; toast(`案内を保存できませんでした：${error.message}`); }
  }));
  panel.append(heading, element('p', '初回は架空のデータで練習します。データはこのブラウザに保存されるため、試合後のバックアップも確認してください。'));
  const steps = element('div', null, 'toolbar');
  steps.append(action('1. 名簿を登録', () => onNavigate('roster')), action('2. 架空サンプルで試す', () => onSample()), action('試合を作成する', () => onNavigate('new-match')), action('3. 試合を記録', () => onNavigate('record')), action('4. バックアップ', () => onNavigate('settings'))); panel.append(steps);
  const auto = element('section', null, 'notice'); auto.style.marginBlock = '16px'; const autoTitle = element('strong', 'オフライン資産を確認中…'), autoText = element('p'); autoText.style.marginBottom = '0'; auto.append(autoTitle, autoText);
  const retry = action('準備状態を再確認', () => void checkOffline()); auto.append(retry); panel.append(auto);
  async function checkOffline() {
    if (checking || disposed) return; checking = true; retry.disabled = true; const token = ++generation;
    const result = await inspectOfflineAssets();
    if (!disposed && token === generation) { autoTitle.textContent = result.status === 'ready' ? 'オフライン資産準備完了' : result.status === 'unsupported' ? 'オフライン資産の自動確認は非対応' : 'オフライン資産準備未完了'; autoText.textContent = result.reason; retry.disabled = false; }
    checking = false;
  }
  const manual = detailed ? element('section') : element('details');
  if (!detailed) { const summary = element('summary', 'iPadでの実機確認チェックリスト'); summary.style.cssText = 'cursor:pointer;font-weight:700;padding-block:10px'; manual.append(summary); }
  manual.append(element('h3', 'このiPadで、自分で確認した項目だけチェック'), element('p', '以下は手動の確認記録です。上の資産準備状態・自動テスト・端末の種類から、自動でチェックを付けることはありません。機内モードや復元の確認は、練習用データと保存済みバックアップを使って行ってください。'));
  const count = element('p'); count.setAttribute('aria-live', 'polite');
  function updateCount() { count.textContent = `自分で確認済み：${Object.values(normalizeReadiness(state.preferences.readiness).checks).filter(Boolean).length} / ${READINESS_CHECKS.length}項目`; }
  const list = element('div'); list.style.cssText = 'display:grid;gap:14px';
  for (const item of READINESS_CHECKS) {
    const label = element('label'); label.style.cssText = 'display:flex;align-items:flex-start;gap:12px;cursor:pointer';
    const input = element('input'); input.type = 'checkbox'; input.checked = initial.checks[item.id]; input.dataset.readinessCheck = item.id; input.style.flexShrink = '0';
    const words = element('span'); words.append(element('strong', item.label)); const detail = element('small', item.detail); detail.style.cssText = 'display:block;line-height:1.6;margin-top:4px'; words.append(detail); label.append(input, words); list.append(label);
    input.addEventListener('change', async () => {
      const old = state.preferences.readiness, next = setReadinessCheck(old, item.id, input.checked); input.disabled = true; state.preferences.readiness = next;
      try { await save(); if (!disposed) updateCount(); } catch (error) { if (state.preferences.readiness === next) state.preferences.readiness = old; if (!disposed) input.checked = normalizeReadiness(old).checks[item.id]; toast(`確認記録を保存できませんでした：${error.message}`); } finally { if (!disposed) input.disabled = false; }
    });
  }
  manual.append(list, count); panel.append(manual); updateCount();
  const worker = globalThis.navigator?.serviceWorker;
  const onController = () => void checkOffline(); worker?.addEventListener?.('controllerchange', onController); globalThis.addEventListener?.('online', onController);
  void checkOffline();
  return () => { disposed = true; generation++; worker?.removeEventListener?.('controllerchange', onController); globalThis.removeEventListener?.('online', onController); };
}
