import assert from 'node:assert/strict';
import { test } from 'node:test';
import { modeStore, sessionModeHandler } from './session-modes.js';

function fixture({ enabled = true, rice, available = true, prayerAvailable = () => true, reconcile, beforePut } = {}) {
  const tables = new Map();
  const domain = { table(name) {
    if (!tables.has(name)) tables.set(name, new Map());
    const data = tables.get(name);
    return { get: key => data.get(key), entries: () => [...data], async put(key, value) {
      await beforePut?.(name, key, value);
      data.set(key, structuredClone(value));
    }, delete: async key => data.delete(key) };
  } };
  const store = modeStore(domain);
  const calls = [];
  const config = { prayerEnabled: { get: () => enabled }, riceEnabled: { get: () => rice } };
  const runtime = { available, prayerAvailable, async reconcile(id) { calls.push(id); return reconcile ? reconcile(id) : { updated: 1, skipped: 0 }; } };
  const persistence = { async stat(id) {
    if (id === 'private-fault') throw new Error('fixture local diagnostic');
    if (id === 'removed') return undefined;
    return { header: id === 'child' ? { id, origin: 'subagent' } : { id, parentSession: 'lineage-root' } };
  } };
  const handler = sessionModeHandler({ config, store, runtime, persistence });
  const url = 'http://fixture.invalid/api/team-terra-ultra/session-mode';
  const get = (id = 'lead') => handler(new Request(`${url}?sessionId=${encodeURIComponent(id)}`));
  const post = (mode, revision, sessionId = 'lead') => handler(new Request(url, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, mode, revision }),
  }));
  return { store, domain, handler, url, get, post, calls };
}

test('mode is session-specific, persisted, and rice cancels prayer without auto-resume', async () => {
  const f = fixture();
  assert.deepEqual(await (await f.get()).json(), { mode: 'normal', revision: 0, prayerEnabled: true, riceEnabled: true, writable: true });
  assert.equal((await f.post('prayer', 0)).status, 200);
  assert.equal((await f.post('rice', 1)).status, 200);
  assert.equal((await f.post('prayer', 2)).status, 409);
  assert.equal((await f.post('normal', 2)).status, 200);
  assert.deepEqual(await modeStore(f.domain).read('lead'), { mode: 'normal', revision: 3 });
  assert.equal((await (await f.get('other')).json()).mode, 'normal');
  assert.deepEqual(f.calls, ['lead', 'lead', 'lead']);
});

test('disabled Rice is hidden, rejects stale activation, and clears all saved Rice without resuming Prayer', async () => {
  const f = fixture({ rice: false });
  await f.store.write('lead', { mode: 'rice', revision: 3 });
  await f.store.write('archived', { mode: 'rice', revision: 7 });
  await f.store.write('praying', { mode: 'prayer', revision: 4 });
  assert.deepEqual(await (await f.get()).json(), { mode: 'normal', revision: 3, prayerEnabled: true, riceEnabled: false, writable: true });
  const rejected = await f.post('rice', 3);
  assert.equal(rejected.status, 409);
  assert.deepEqual(await rejected.json(), { error: 'rice_unavailable' });
  assert.deepEqual(await f.store.clearRice(), { roots: ['lead', 'archived'], failed: 0 });
  const reopened = modeStore(f.domain);
  assert.deepEqual(reopened.peek('lead'), { mode: 'normal', revision: 4 });
  assert.deepEqual(reopened.peek('archived'), { mode: 'normal', revision: 8 });
  assert.deepEqual(reopened.peek('praying'), { mode: 'prayer', revision: 4 });
  assert.deepEqual(f.calls, []);
});

test('clear waits for a racing Rice write and invalidates its stale revision', async () => {
  let settled, started;
  const began = new Promise(resolve => { started = resolve; });
  const f = fixture({ beforePut: (_, __, value) => {
    if (value.mode === 'rice') return new Promise(resolve => { settled = resolve; started(); });
  } });
  const pending = f.store.write('lead', { mode: 'rice', revision: 1 });
  await began;
  const clear = f.store.clearRice();
  const stale = f.store.write('lead', { mode: 'rice', revision: 2 }, current => current.revision === 1);
  settled();
  await pending;
  assert.deepEqual(await clear, { roots: ['lead'], failed: 0 });
  assert.equal(await stale, false);
  assert.deepEqual(f.store.peek('lead'), { mode: 'normal', revision: 2 });
});

test('concurrent requests with the same revision never silently overwrite one another', async () => {
  const f = fixture();
  const statuses = (await Promise.all([f.post('prayer', 0), f.post('rice', 0)])).map(response => response.status).sort();
  assert.deepEqual(statuses, [200, 409]);
  assert.deepEqual(f.calls, ['lead']);
  assert.equal(f.store.peek('lead').revision, 1);
});

test('only a valid existing ordinary Session can change mode; missing runtime is read-only', async () => {
  const f = fixture({ available: false });
  assert.equal((await f.get('child')).status, 403);
  assert.equal((await f.post('rice', 0, 'child')).status, 403);
  assert.equal((await f.get('removed')).status, 404);
  assert.equal((await f.get('../invalid')).status, 400);
  assert.equal((await (await f.get()).json()).writable, false);
  assert.equal((await f.post('rice', 0)).status, 503);
  const response = await f.get('private-fault');
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'unavailable' });
  assert.deepEqual(f.calls, []);
});

test('unconfigured prayer does not take effect; reads never write old preferences', async () => {
  const f = fixture({ enabled: false });
  assert.equal((await f.post('prayer', 0)).status, 409);
  await f.store.write('lead', { mode: 'prayer', revision: 4 });
  assert.deepEqual(await (await f.get()).json(), { mode: 'normal', revision: 4, prayerEnabled: false, riceEnabled: true, writable: true });
  assert.equal(f.store.peek('lead').mode, 'prayer');
  assert.equal((await f.post('normal', 4)).status, 200);
  assert.deepEqual(f.store.peek('lead'), { mode: 'normal', revision: 5 });
});

test('prayer capability belongs to the current root and is checked again before POST', async () => {
  let eligible = true;
  const f = fixture({ prayerAvailable(id, signal) {
    assert.equal(signal.aborted, false);
    return eligible && id === 'lead';
  } });
  assert.equal((await (await f.get()).json()).prayerEnabled, true);
  assert.equal((await (await f.get('other')).json()).prayerEnabled, false);
  eligible = false;
  const response = await f.post('prayer', 0);
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'prayer_unavailable' });
  assert.deepEqual(f.store.peek('lead'), { mode: 'normal', revision: 0 });
  assert.deepEqual(f.calls, []);
  assert.deepEqual(await (await f.post('rice', 0)).json(), {
    mode: 'rice', revision: 1, prayerEnabled: false, riceEnabled: true, writable: true, result: { updated: 1, skipped: 0 },
  });
});

test('missing or failed prayer capability only hides prayer, leaving saved mode and rice independent', async () => {
  for (const prayerAvailable of [null, async () => { throw new Error('fixture local diagnostics'); }]) {
    const f = fixture({ prayerAvailable });
    await f.store.write('lead', { mode: 'prayer', revision: 2 });
    assert.deepEqual(await (await f.get()).json(), { mode: 'normal', revision: 2, prayerEnabled: false, riceEnabled: true, writable: true });
    assert.equal(f.store.peek('lead').mode, 'prayer');
    assert.equal((await f.post('prayer', 2)).status, 409);
    assert.equal((await f.post('rice', 2)).status, 200);
    assert.deepEqual(f.store.peek('lead'), { mode: 'rice', revision: 3 });
  }
});

test('member reconciliation failure does not undo the committed mode or leak diagnostics', async () => {
  const f = fixture({ reconcile: () => { throw Error('fixture local diagnostic'); } });
  const response = await f.post('rice', 0);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { mode: 'rice', revision: 1, prayerEnabled: true, riceEnabled: true, writable: true, reconcileFailed: true });
  assert.equal(f.store.peek('lead').mode, 'rice');
});

test('rejects malformed and cross-origin-form-shaped writes; stores member markers independently', async () => {
  const f = fixture();
  for (const [contentType, body, status] of [
    ['text/plain', '{"sessionId":"lead","mode":"rice","revision":0}', 415],
    ['application/json', '{', 400], ['application/json', ' '.repeat(2049), 413],
    ['application/json', '{"sessionId":"lead","mode":"rice","revision":0,"extra":true}', 400],
  ]) assert.equal((await f.handler(new Request(f.url, { method: 'POST', headers: { 'content-type': contentType }, body }))).status, status);
  const mark = { rootId: 'lead', original: { provider: 'p', model: 'a' }, applied: { provider: 'p', model: 'b' } };
  await f.store.writeMark('child', mark);
  assert.deepEqual(await modeStore(f.domain).readMark('child'), mark);
  await f.store.writeMark('child', null);
  assert.equal(await f.store.readMark('child'), undefined);
  assert.deepEqual(f.calls, []);
});
