import test from 'node:test';
import assert from 'node:assert/strict';
import { READINESS_CHECKS, OFFLINE_ASSETS, normalizeReadiness, setReadinessCheck, inspectOfflineAssets } from '../js/readiness.mjs';

test('manual checks default to false regardless of device or automated readiness flags', () => {
  const value = normalizeReadiness({ device: 'iPad', automatedPassed: true, offlineReady: true, checks: { homeScreen: 'yes', recordUndo: 1, unknown: true } });
  assert.equal(Object.values(value.checks).filter(Boolean).length, 0); assert.equal(value.dismissed, false); assert.equal(Object.keys(value.checks).length, 6);
  assert.throws(() => setReadinessCheck(value, 'homeScreen', true, { source: 'automatic' }), /手動/);
  assert.throws(() => setReadinessCheck(value, 'unknown', true), /不正/);
});
test('user changes only the selected check and persisted choices survive normalization', () => {
  const value = normalizeReadiness(); const next = setReadinessCheck(value, 'recordUndo', true);
  assert.equal(value.checks.recordUndo, false); assert.equal(next.checks.recordUndo, true); assert.equal(Object.values(next.checks).filter(Boolean).length, 1);
  assert.deepEqual(normalizeReadiness(JSON.parse(JSON.stringify({ ...next, dismissed: true }))), { ...next, dismissed: true });
  assert.equal(setReadinessCheck(next, 'recordUndo', false).checks.recordUndo, false);
});
function environment({ missing = [], release = 'handball-studio-test-release', names, wrongScope = false, wrongController = false, responseOK = true } = {}) {
  const baseURL = 'https://learning-apps-jp.github.io/handball-studio/', requests = OFFLINE_ASSETS.filter(asset => !missing.includes(asset)).map(asset => { const url = new URL(asset, baseURL); url.searchParams.set('release', release); return { url: url.href }; });
  return { baseURL, navigatorObject: { serviceWorker: { ready: Promise.resolve({ scope: wrongScope ? 'https://learning-apps-jp.github.io/' : baseURL, active: { state: 'activated' } }), controller: { scriptURL: new URL(wrongController ? 'other-sw.js' : 'sw.js', baseURL).href } } }, cacheStorage: { keys: async () => names ?? [release], open: async () => ({ keys: async () => requests, match: async () => ({ ok: responseOK }) }) } };
}
test('offline diagnostics inspect real API handles, scope, cache release keys and readable responses', async () => {
  assert.equal((await inspectOfflineAssets({ navigatorObject: {}, cacheStorage: {}, baseURL: 'https://example.org/' })).status, 'unsupported');
  assert.equal((await inspectOfflineAssets(environment())).status, 'ready');
  assert.equal((await inspectOfflineAssets(environment({ missing: ['./js/core.mjs'] }))).status, 'incomplete');
  assert.equal((await inspectOfflineAssets(environment({ wrongScope: true }))).status, 'incomplete');
  assert.equal((await inspectOfflineAssets(environment({ wrongController: true }))).status, 'incomplete');
  assert.equal((await inspectOfflineAssets(environment({ names: ['handball-studio-old', 'handball-studio-new'] }))).status, 'incomplete');
  assert.equal((await inspectOfflineAssets(environment({ responseOK: false }))).status, 'incomplete');
});
test('automated assets-ready never changes any manual acceptance checkbox', async () => {
  const checks = normalizeReadiness(); await inspectOfflineAssets(environment());
  assert.equal(READINESS_CHECKS.every(item => checks.checks[item.id] === false), true);
});
test('worker readiness timeout and storage errors report incomplete without hanging', async () => {
  const env = environment(); env.navigatorObject.serviceWorker.ready = new Promise(() => {}); env.timeoutMs = 5;
  assert.equal((await inspectOfflineAssets(env)).status, 'incomplete');
  const broken = environment(); broken.cacheStorage.keys = async () => { throw new Error('Denied'); };
  assert.equal((await inspectOfflineAssets(broken)).status, 'incomplete');
});
