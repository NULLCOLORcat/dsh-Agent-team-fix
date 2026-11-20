// 离线契约测试：仅在 VM 中加载浏览器模块；不连接 Host、不改实际配置。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';

let api;
vm.runInNewContext(readFileSync(new URL('./client.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load: ({ id, factory }) => {
    assert.equal(id, 'dsh-agent-team-fix');
    api = factory((id) => { assert.equal(id, 'react'); return {
      useId: () => 'fixture', createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) })
    }; });
  } } },
  document: { createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild() {} } }
});
const plain = (value) => JSON.parse(JSON.stringify(value));
const terra = { provider: 'openai-codex', model: 'gpt-6.1-terra' };
const other = { provider: 'second', model: 'model' };
const initial = () => ({ allowedModels: [terra], defaultModel: terra, defaultReasoningEffort: 'ultra' });
const catalog = { ok: true, value: { groups: [
  { id: terra.provider, name: 'Codex', models: [{ id: terra.model, name: 'Terra', reasoning: { efforts: [{ id: 'ultra', name: 'Ultra' }, { id: 'low', name: 'Low' }], defaultEffort: 'low' } }] },
  { id: other.provider, name: 'Second', models: [{ id: other.model, name: 'Other', reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' } }] }
], failures: [] } };
function fixture(load = async () => catalog) {
  let snapshot = { status: 'ready', writable: true, revision: 1, value: initial() };
  const listeners = new Set(); const calls = [];
  const scope = { getSnapshot: () => snapshot, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    mutate: async (ops, revision) => {
      calls.push({ ops, revision });
      assert.equal(revision, snapshot.revision);
      const value = { ...snapshot.value };
      for (const op of ops) value[op.path[0]] = op.value;
      update({ value, revision: snapshot.revision + 1 });
    }
  };
  const update = (patch) => { snapshot = { ...snapshot, ...patch }; for (const fn of listeners) fn(); };
  const c = new api.TeamModelController(scope, { remote: { session: { modelCatalog: load } } });
  return { c, scope, calls, update };
}
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

// 走宿主注册入口而非直接调用内部组件，检查实际挂载位置和原生控件回调。
function mounted(scope, load) {
  const registrations = []; const cleanup = [];
  api.apply({
    effect: (fn) => cleanup.push(fn()), on: () => () => {},
    remote: { $on: () => () => {}, session: { modelCatalog: load } },
    configForms: { get: (ns) => { assert.equal(ns, 'team-terra-ultra'); return scope; },
      whileServed: (names, fn) => { assert.deepEqual(plain(names), ['team-terra-ultra']); return fn(); } },
    slots: { inject: (name, fn) => { assert.equal(name, 'plugins.bundle.config'); return fn(); },
      register: (options, component) => { registrations.push({ options, component }); return () => {}; } }
  });
  assert.equal(registrations.length, 1);
  const { options, component } = registrations[0];
  assert.equal(options.name, 'plugins.bundle.config'); assert.equal(options.key, 'dsh-agent-team-fix');
  const { hooks, controller } = options.inject();
  return { render: (view = 'page') => component({ view, controller, useTeamModelCard: fn => fn(hooks.teamModelCard.getSnapshot()) }),
    dispose: () => cleanup.reverse().forEach(fn => fn()) };
}
function nodes(root, type) {
  if (!root || typeof root !== 'object') return [];
  return [...(root.type === type ? [root] : []), ...root.children.flatMap(child => nodes(child, type))];
}
test('own bundle shows native controls; one shared catalog; fallback locks only smart choices and persists them', async () => {
  const { scope, calls, c } = fixture(); c.dispose(); let loads = 0;
  const ui = mounted(scope, async () => { loads++; return catalog; }); await tick();
  assert.equal(ui.render('summary'), null);
  const form = () => ui.render();
  const sets = () => nodes(form(), 'fieldset');
  assert.deepEqual(nodes(form(), 'h3').map(n => n.children[0]), ['日常任务模型', '更聪明的模型']);
  const fallback = () => nodes(form(), 'label').find(n => n.children.includes('高复杂度回退至当前模型')).children[0];
  const smart = () => nodes(sets()[1], 'input');
  assert.equal(fallback().props.type, 'checkbox'); assert.equal(fallback().props.checked, false);
  assert.equal(smart().length, 2); assert.equal(sets()[1].props.disabled, false);
  assert.ok(nodes(form(), 'span').some(n => n.children.includes('未启用高复杂度回退')));
  smart()[1].props.onChange(); smart()[0].props.onChange();
  fallback().props.onChange({ target: { checked: true } });
  assert.equal(sets()[1].props.disabled, true); assert.equal(sets()[0].props.disabled, false);
  smart()[1].props.onChange(); // 即使绕过 fieldset 的浏览器禁用，控制器也拒绝修改。
  assert.equal(smart()[1].props.checked, true);
  form().props.onSubmit({ preventDefault() {} }); await tick();
  assert.equal(calls.length, 1); assert.deepEqual(plain(scope.getSnapshot().value.smartModels), [other, terra]);
  assert.deepEqual(plain(scope.getSnapshot().value.allowedModels), [terra]); assert.equal(scope.getSnapshot().value.fallbackToCurrentModel, true);
  fallback().props.onChange({ target: { checked: false } }); assert.equal(sets()[1].props.disabled, false);
  assert.equal(smart()[1].props.checked, true); smart()[0].props.onChange(); smart()[1].props.onChange();
  form().props.onSubmit({ preventDefault() {} }); await tick();
  assert.equal(scope.getSnapshot().value.fallbackToCurrentModel, false); assert.deepEqual(plain(scope.getSnapshot().value.smartModels), []);
  assert.equal(loads, 1); ui.dispose();
});

test('native exports and candidate metadata retain unavailable routes', () => {
  assert.equal(typeof api.apply, 'function'); assert.equal(api.default.apply, api.apply);
  const rows = api.candidates([], [terra], new Set([api.routeKey(terra)]));
  assert.equal(rows[0].available, false); assert.equal(rows[0].selected, true);
});
test('one fenced atomic write includes exactly five top-level fields', async () => {
  const { c, calls } = fixture(); await tick();
  c.toggleModel(api.routeKey(other));
  assert.equal(c.projection().multi, true);
  c.selectDefault(api.routeKey(other));
  assert.equal(c.desired().defaultReasoningEffort, '');
  c.selectEffort('ultra'); assert.equal(c.desired().defaultReasoningEffort, '');
  c.selectEffort('high'); await c.save();
  assert.equal(calls.length, 1); assert.equal(calls[0].revision, 1);
  assert.deepEqual(plain(calls[0].ops.map((op) => op.path)), [['allowedModels'], ['defaultModel'], ['defaultReasoningEffort'], ['smartModels'], ['fallbackToCurrentModel']]);
  assert.deepEqual(plain(calls[0].ops.slice(-2).map(op => op.value)), [[], false]);
  assert.equal(c.draft, undefined); assert.equal(c.failed, false); c.dispose();
});
test('zero selections and default outside selection block save', async () => {
  const { c, calls } = fixture(); await tick();
  c.toggleModel(api.routeKey(terra)); await c.save();
  assert.equal(c.projection().empty, true); assert.equal(calls.length, 0);
  c.toggleModel(api.routeKey(other)); await c.save();
  assert.equal(c.projection().missingDefault, true); assert.equal(calls.length, 0); c.dispose();
});
test('external revision cannot erase even identical draft; explicit review rebases', async () => {
  const { c, calls, update } = fixture(); await tick();
  c.selectEffort('low'); const draft = c.draft;
  update({ revision: 2, value: initial() });
  assert.equal(c.conflicted, true); assert.equal(c.draft, draft);
  await c.save(); assert.equal(calls.length, 0);
  c.rebase(); await c.save(); assert.equal(calls[0].revision, 2); c.dispose();
});
test('rejected and thrown mutations keep draft without automatic retry', async () => {
  const { c, scope } = fixture(); await tick(); c.selectEffort('low');
  scope.mutate = async () => ({ ok: false }); await c.save();
  assert.ok(c.draft); assert.equal(c.failed, true);
  scope.mutate = async () => { throw Error('offline'); }; await c.save();
  assert.ok(c.draft); assert.equal(c.saving, false); c.dispose();
});
test('connection reset keeps draft and ignores late catalog/save settlements', async () => {
  let resolveCatalog; let resolveSave;
  const { c, scope } = fixture(() => new Promise((resolve) => { resolveCatalog = resolve; }));
  const oldCatalog = resolveCatalog;
  c.toggleModel(api.routeKey(terra)); c.toggleModel(api.routeKey(terra));
  c.beginDraft().defaultReasoningEffort = '';
  scope.mutate = () => new Promise((resolve) => { resolveSave = resolve; });
  const saving = c.save(); const draft = c.draft;
  c.resetConnection(); oldCatalog(catalog); resolveSave({ ok: true }); await saving; await tick();
  assert.equal(c.draft, draft); assert.equal(c.conflicted, true);
  assert.equal(c.groups.length, 0); assert.equal(c.saving, false);
  resolveCatalog(catalog); await tick(); assert.equal(c.groups.length, 2); c.dispose();
});
test('read-only does not create draft; partial catalogs keep unavailable removable', async () => {
  const partial = { ok: true, value: { groups: [], failures: [{ provider: 'offline' }] } };
  const { c, update } = fixture(async () => partial); await tick();
  assert.equal(c.projection().catalogPartial, true); assert.equal(c.rows()[0].available, false);
  update({ writable: false }); c.toggleModel(api.routeKey(terra)); assert.equal(c.draft, undefined);
  update({ writable: true }); c.toggleModel(api.routeKey(terra)); assert.equal(c.desired().allowedModels.length, 0); c.dispose();
});
test('catalog failures are caught and retry/disposal suppress stale responses', async () => {
  const { c } = fixture(async () => { throw Error('catalog offline'); }); await tick();
  assert.equal(c.catalogStatus, 'error');
  c.ctx.remote.session.modelCatalog = async () => catalog; await c.loadCatalog();
  assert.equal(c.catalogStatus, 'ready'); c.dispose();
  assert.equal(c.disposed, true);
});
