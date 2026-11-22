// 离线契约测试：通过 ModuleLoader/槽位创建扩展，不连接 Host 或写入实际配置。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';

let api;
vm.runInNewContext(readFileSync(new URL('./client.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load: ({ id, factory }) => {
    assert.equal(id, 'dsh-agent-team-fix');
    api = factory((id) => {
      assert.equal(id, 'react');
      return { useId: () => 'fixture', createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }) };
    });
  } } },
  document: { createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild() {} } },
});
const plain = (value) => JSON.parse(JSON.stringify(value));
const a = { provider: 'p1', model: 'shared' };
const b = { provider: 'p2', model: 'shared' };
const c = { provider: 'p2', model: 'another' };
const stale = { provider: 'removed', model: 'old' };
const ownNS = 'team-terra-ultra';
const officialNS = 'subagent-model-selection-settings';
const officialSubject = { kind: 'item', id: 'subagent' };

function form(value, initial = {}) {
  let snapshot = { status: 'ready', writable: true, revision: 1, value, ...initial };
  const calls = [];
  const listeners = new Set();
  const update = (patch) => { snapshot = { ...snapshot, ...patch }; for (const listener of listeners) listener(); };
  const handle = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    mutate: async (ops, revision) => {
      calls.push({ ops: plain(ops), revision });
      assert.equal(revision, snapshot.revision);
      assert.equal(ops.length, 1);
      const [op] = ops;
      assert.deepEqual(plain(op.path), ['smartModels']);
      update({ value: { ...snapshot.value, smartModels: op.value }, revision: snapshot.revision + 1 });
      return true;
    },
  };
  return { handle, update, calls, listeners };
}
function fixture({ stored = [], allowed = [a, b], enabled = true, ownInitial, officialInitial } = {}) {
  const own = form({ smartModels: stored, defaultModel: 'preserve-legacy' }, ownInitial);
  const official = form({ enabled, allowedModels: allowed }, officialInitial);
  // 不提供任何官方写入能力，以便意外的越权调用立即暴露。
  delete official.handle.mutate;
  const controller = new api.TeamModelController(own.handle, official.handle);
  return { controller, own, official };
}

// 模拟宿主注册与编译后的 hook/locale 注入；只判断离线结构和回调，不伪造浏览器视觉验收。
function mounted(own, official, missingSlot = false) {
  const registrations = [];
  const cleanup = [];
  const events = new Map();
  const dictionaries = new Map();
  api.apply({
    effect: (fn) => cleanup.push(fn()),
    on: (name, fn) => { events.set(name, fn); return () => events.delete(name); },
    configForms: {
      get: (ns) => { assert.ok([ownNS, officialNS].includes(ns)); return ns === ownNS ? own : official; },
      whileServed: (names, fn) => { assert.deepEqual(plain(names), [ownNS]); return fn(); },
    },
    locale: { register: (namespace, copy) => { dictionaries.set(namespace, copy); return () => dictionaries.delete(namespace); } },
    slots: {
      inject: (name, fn) => { assert.equal(name, 'plugins.detail.section'); return missingSlot ? () => {} : fn(); },
      register: (options, component) => { registrations.push({ options, component }); return () => registrations.pop(); },
    },
  });
  return { registrations, events, dictionaries, dispose: () => cleanup.reverse().forEach((fn) => fn()) };
}
function render(mount, subject, lang = 'zh') {
  const { options, component } = mount.registrations[0];
  const { hooks, controller } = options.inject();
  const root = component({ subject, controller, useDifficultyModels: (fn) => fn(hooks.difficultyModels.getSnapshot()),
    t: (key) => mount.dictionaries.get(options.locale)[lang][key] });
  return root ? root.type(root.props) : null;
}
function nodes(root, type) {
  if (!root || typeof root !== 'object') return [];
  return [...(root.type === type ? [root] : []), ...root.children.flatMap((child) => nodes(child, type))];
}
function text(root) {
  if (typeof root === 'string') return root;
  if (!root || typeof root !== 'object') return '';
  return root.children.map(text).join(' ');
}

test('registers a separate bilingual form on only the official Subagent detail subject', async () => {
  assert.deepEqual(plain(api.inject), ['slots', 'locale', 'configForms']);
  assert.equal(api.default.apply, api.apply);
  const { controller, own, official } = fixture();
  controller.dispose();
  const mount = mounted(own.handle, official.handle);
  assert.equal(mount.registrations.length, 1);
  assert.equal(mount.registrations[0].options.name, 'plugins.detail.section');
  assert.equal('key' in mount.registrations[0].options, false);
  assert.equal(render(mount, { kind: 'item', id: 'wrong' }), null);
  assert.equal(render(mount, { kind: 'bundle', id: 'subagent' }), null);
  assert.equal(render(mount, { kind: 'row', id: 'subagent' }), null);
  assert.equal(render(mount, undefined), null);
  const zh = () => render(mount, officialSubject);
  const en = () => render(mount, officialSubject, 'en');
  assert.deepEqual(nodes(zh(), 'h3').map(text), ['任务难度模型']);
  assert.deepEqual(nodes(zh(), 'legend').map(text), ['困难任务模型']);
  assert.deepEqual(nodes(zh(), 'h4').map(text), ['其他已授权模型']);
  assert.deepEqual(nodes(en(), 'h3').map(text), ['Difficulty Models']);
  assert.match(text(en()), /snapshot.*at session start/);
  assert.match(text(zh()), /上方「模型选择」中开启模型选择、勾选允许使用的模型并保存/);
  assert.match(text(zh()), /不修改官方白名单，也不设置默认模型/);
  assert.equal(nodes(zh(), 'select').length, 0);
  assert.deepEqual(nodes(zh(), 'li').map(text), ['p1 / shared', 'p2 / shared']);
  const button = () => nodes(zh(), 'button').find((item) => item.props.type === 'submit');
  assert.equal(button().props.disabled, true);
  const input = nodes(zh(), 'input')[0];
  assert.equal(input.props.type, 'checkbox');
  input.props.onChange();
  assert.equal(nodes(zh(), 'input')[0].props.checked, true);
  assert.deepEqual(nodes(zh(), 'li').map(text), ['p2 / shared']);
  assert.equal(button().props.disabled, false);
  await nodes(zh(), 'form')[0].props.onSubmit({ preventDefault() {} });
  assert.match(text(zh()), /困难任务模型已保存/);
  assert.deepEqual(own.calls, [{ ops: [{ op: 'set', path: ['smartModels'], value: [a] }], revision: 1 }]);
  assert.equal(own.handle.getSnapshot().value.defaultModel, 'preserve-legacy');
  assert.deepEqual(official.calls, []);
  mount.dispose();
  assert.equal(own.listeners.size, 0);
  assert.equal(official.listeners.size, 0);
  assert.equal(mount.events.size, 0);
});

test('missing registration capabilities and an undeclared slot do not create a fallback form', () => {
  assert.doesNotThrow(() => api.apply({ slots: {}, configForms: { get: () => assert.fail('unexpected capability use') } }));
  const { controller, own, official } = fixture();
  controller.dispose();
  const mount = mounted(own.handle, official.handle, true);
  assert.deepEqual(mount.registrations, []);
  assert.deepEqual(own.calls, []);
  mount.dispose();
});

test('live official snapshot adds choices and retains invalid selections only for cleanup', async () => {
  const { controller: ui, own, official } = fixture({ stored: [a, stale], allowed: [a, b, b] });
  assert.deepEqual(plain(ui.projection().weak), [b]);
  assert.equal(ui.projection().rows.find((row) => row.key === api.routeKey(stale)).authorized, false);
  ui.toggleModel(api.routeKey(c));
  assert.equal(ui.projection().hasDraft, false);
  ui.toggleModel(api.routeKey(b));
  await ui.save();
  assert.equal(own.calls.length, 0);
  official.update({ value: { enabled: true, allowedModels: [b, c] }, revision: 2 });
  assert.deepEqual(plain(ui.projection().weak), [c]);
  ui.toggleModel(api.routeKey(stale));
  ui.toggleModel(api.routeKey(a));
  ui.toggleModel(api.routeKey(stale)); // 不允许重新添加已不在白名单的项。
  assert.deepEqual(plain(ui.projection().desired), [b]);
  await ui.save();
  assert.deepEqual(own.calls, [{ ops: [{ op: 'set', path: ['smartModels'], value: [b] }], revision: 1 }]);
  ui.dispose();
});

test('official choice disabled blocks additions but permits removing prior choices', async () => {
  const { controller: ui, own, official } = fixture({ stored: [a], enabled: false });
  assert.equal(ui.projection().officialEnabled, false);
  assert.deepEqual(plain(ui.projection().weak), []);
  ui.toggleModel(api.routeKey(b));
  assert.equal(ui.projection().hasDraft, false);
  official.update({ value: { enabled: true, allowedModels: [a, b] } });
  ui.toggleModel(api.routeKey(b));
  official.update({ value: { enabled: false, allowedModels: [a, b] } });
  assert.equal(ui.projection().offDraft, true);
  await ui.save();
  assert.equal(own.calls.length, 0);
  ui.toggleModel(api.routeKey(b));
  ui.toggleModel(api.routeKey(a));
  await ui.save();
  assert.deepEqual(plain(own.handle.getSnapshot().value.smartModels), []);
  ui.dispose();
});

test('loading, read-only, unsupported and stale official snapshots fail inert', async () => {
  const { controller: ui, own, official } = fixture({ officialInitial: { status: 'loading' } });
  assert.equal(ui.projection().loading, true);
  ui.toggleModel(api.routeKey(a));
  assert.equal(ui.projection().hasDraft, false);
  official.update({ status: 'ready' });
  own.update({ writable: false });
  ui.toggleModel(api.routeKey(a));
  assert.equal(ui.projection().hasDraft, false);
  own.update({ writable: true });
  ui.toggleModel(api.routeKey(a));
  official.update({ status: 'unavailable' }); // last accepted value remains present in real configForms
  assert.deepEqual(plain(ui.projection().desired), [a]);
  assert.deepEqual(plain(ui.projection().weak), []);
  await ui.save();
  official.update({ status: 'ready', value: { allowedModels: [a], enabled: 1 } });
  assert.equal(ui.projection().officialAvailable, false);
  await ui.save();
  assert.equal(own.calls.length, 0);
  ui.dispose();
});

test('external own revision retains the draft; rebase is explicit and does not bypass authorization', async () => {
  const { controller: ui, own, official } = fixture();
  ui.toggleModel(api.routeKey(a));
  const draft = ui.draft;
  own.update({ revision: 2 });
  assert.equal(ui.projection().conflicted, true);
  assert.equal(ui.draft, draft);
  await ui.save();
  assert.equal(own.calls.length, 0);
  official.update({ value: { enabled: true, allowedModels: [b] } });
  ui.rebase();
  assert.equal(ui.projection().invalid, true);
  await ui.save();
  assert.equal(own.calls.length, 0);
  ui.toggleModel(api.routeKey(a));
  ui.toggleModel(api.routeKey(b));
  await ui.save();
  assert.equal(own.calls[0].revision, 2);
  ui.dispose();
});

test('conflict merge preserves another window’s unrelated additions and removals', async () => {
  const { controller: ui, own } = fixture({ stored: [a, b], allowed: [a, b, c, stale] });
  ui.toggleModel(api.routeKey(a));
  ui.toggleModel(api.routeKey(c));
  own.update({ revision: 2, value: { smartModels: [a, stale] } });
  assert.equal(ui.projection().conflicted, true);
  ui.rebase();
  assert.deepEqual(plain(ui.projection().desired), [stale, c]);
  assert.equal(own.calls.length, 0);
  await ui.save();
  assert.deepEqual(own.calls, [{ ops: [{ op: 'set', path: ['smartModels'], value: [stale, c] }], revision: 2 }]);
  ui.dispose();
});

test('refusal and transport error retain the draft without retries; discard restores accepted values', async () => {
  const { controller: ui, own } = fixture();
  const failCases = [() => false, () => { throw Error('offline'); }];
  ui.toggleModel(api.routeKey(a));
  let attempts = 0;
  for (const failure of failCases) {
    own.handle.mutate = async () => { attempts++; return failure(); };
    await ui.save();
    assert.equal(ui.projection().failed, true);
    assert.equal(ui.projection().dirty, true);
    assert.equal(ui.projection().saving, false);
  }
  assert.equal(attempts, 2);
  ui.discard();
  assert.equal(ui.projection().hasDraft, false);
  assert.equal(ui.projection().failed, false);
  assert.deepEqual(plain(ui.projection().desired), []);
  ui.dispose();
});

test('a simultaneous official edit may make an accepted selection stale, but cannot authorize it again', async () => {
  const { controller, own, official } = fixture();
  controller.dispose();
  const mount = mounted(own.handle, official.handle);
  const ui = mount.registrations[0].options.inject().controller;
  const card = () => render(mount, officialSubject);
  const commit = own.handle.mutate;
  let finish;
  own.handle.mutate = (ops, revision) => new Promise((resolve) => { finish = () => resolve(commit(ops, revision)); });
  ui.toggleModel(api.routeKey(a));
  const saving = ui.save();
  const status = () => nodes(card(), 'span').find(el => el.props.role === 'status');
  assert.match(text(status()), /保存中/);
  // Namespace fences are independent; a concurrent official update never joins the add-on write.
  official.update({ value: { enabled: true, allowedModels: [b] } });
  finish();
  await saving;
  assert.equal(ui.projection().saved, true);
  assert.equal(ui.projection().invalid, true);
  assert.equal(ui.projection().rows.find((row) => row.key === api.routeKey(a)).authorized, false);
  assert.deepEqual(plain(ui.projection().weak), [b]);
  assert.match(text(status()), /已保存，但官方白名单已变更/);
  assert.doesNotMatch(text(card()), /请先移除已不在上方白名单/);
  mount.dispose();
});

test('reattachment invalidates stale save settlement and does not submit twice', async () => {
  const { controller: ui, own } = fixture();
  let finish;
  let attempts = 0;
  own.handle.mutate = () => { attempts++; return new Promise((resolve) => { finish = resolve; }); };
  ui.toggleModel(api.routeKey(a));
  const save = ui.save();
  await ui.save();
  ui.toggleModel(api.routeKey(b));
  ui.resetConnection();
  finish(true);
  await save;
  assert.equal(attempts, 1);
  assert.equal(ui.projection().conflicted, true);
  assert.equal(ui.projection().saved, false);
  assert.deepEqual(plain(ui.projection().desired), [a]);
  ui.dispose();
});
