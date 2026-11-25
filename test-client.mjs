// 离线契约测试：通过 ModuleLoader/槽位创建扩展，不连接 Host 或写入实际配置。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';

let api;
let activeComposer;
const browserEvents = new Map();
const react = {
  Fragment: 'fragment',
  useId: () => 'fixture',
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
  useMemo: (make, deps) => {
    const entry = composerHook();
    if (!sameDeps(entry.deps, deps)) Object.assign(entry, { deps, value: make() });
    return entry.value;
  },
  useCallback: (callback, deps) => react.useMemo(() => callback, deps),
  useRef: (initial) => composerHook().ref ??= { current: initial },
  useState: (initial) => {
    const entry = composerHook();
    entry.value ??= initial;
    return [entry.value, (value) => { entry.value = value; }];
  },
  useSyncExternalStore: (subscribe, read) => read(),
  useEffect: (start, deps) => queueEffect('effects', start, deps),
  useLayoutEffect: (start, deps) => queueEffect('layout', start, deps),
};
function composerHook() {
  const hooks = activeComposer.hooks ??= [];
  return hooks[activeComposer.hookIndex++] ??= {};
}
function sameDeps(previous, next) {
  return !!previous && next.every((value, index) => previous[index] === value);
}
function queueEffect(phase, start, deps) {
  const entry = composerHook();
  if (sameDeps(entry.deps, deps)) return;
  activeComposer[phase].push(() => {
    entry.stop?.();
    Object.assign(entry, { deps, stop: start() });
  });
}
function attachComposerRefs(view) {
  const { buttons, document } = activeComposer;
  const next = new Map(nodes(view, 'button').filter(({ props }) => props.ref).map(({ props }) => [props['data-team-mode'], props]));
  const bind = (ref, element) => typeof ref === 'function' ? ref(element) : (ref.current = element);
  for (const [key, entry] of buttons) {
    if (next.has(key)) continue;
    bind(entry.props.ref, null);
    if (document.activeElement === entry.element) document.activeElement = document.body;
    buttons.delete(key);
  }
  for (const [key, props] of next) {
    const entry = buttons.get(key) ?? { element: { ownerDocument: document, focus() {
      if (this.disabled) return;
      const previous = [...buttons.values()].find(({ element }) => element === document.activeElement);
      document.activeElement = this;
      previous?.props.onBlur?.();
      entry.props.onFocus?.();
    } } };
    if (entry.props && entry.props.ref !== props.ref) bind(entry.props.ref, null);
    entry.props = props;
    entry.element.disabled = props.disabled;
    buttons.set(key, entry);
    bind(props.ref, entry.element);
  }
}
function renderComposer(node) {
  Object.assign(activeComposer, { hookIndex: 0, layout: [], effects: [] });
  activeComposer.buttons ??= new Map();
  if (!activeComposer.document) {
    const body = {};
    activeComposer.document = { activeElement: body, body };
  }
  const view = node.type(node.props);
  attachComposerRefs(view);
  activeComposer.layout.forEach((run) => run());
  activeComposer.effects.forEach((run) => run());
  return view;
}
function unmountComposer() {
  attachComposerRefs(null);
  activeComposer.hooks?.forEach(({ stop }) => stop?.());
  activeComposer = undefined;
}
vm.runInNewContext(readFileSync(new URL('./client.js', import.meta.url), 'utf8'), {
  window: {
    __ModuleLoader__: { load: ({ id, factory }) => {
      assert.equal(id, 'dsh-agent-team-fix');
      api = factory((id) => { assert.equal(id, 'react'); return react; });
    } },
    addEventListener: (name, fn) => { browserEvents.set(name, fn); },
    removeEventListener: (name, fn) => { if (browserEvents.get(name) === fn) browserEvents.delete(name); },
  },
  document: { createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild() {} } },
  AbortController,
  fetch: (url, options) => activeComposer.fetch(url, options),
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
      const value = { ...snapshot.value };
      for (const op of ops) {
        assert.equal(op.op, 'set');
        assert.equal(op.path.length, 1);
        assert.ok(['smartModels', 'strictDifficulty', 'prayerEnabled', 'riceEnabled'].includes(op.path[0]));
        value[op.path[0]] = op.value;
      }
      update({ value, revision: snapshot.revision + 1 });
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
    on: (name, fn) => {
      if (!events.has(name)) events.set(name, new Set());
      const listeners = events.get(name);
      listeners.add(fn);
      return () => { listeners.delete(fn); if (!listeners.size) events.delete(name); };
    },
    configForms: {
      get: (ns) => { assert.ok([ownNS, officialNS].includes(ns)); return ns === ownNS ? own : official; },
      whileServed: (names, fn) => { assert.deepEqual(plain(names), [ownNS]); return fn(); },
    },
    locale: { register: (namespace, copy) => { dictionaries.set(namespace, copy); return () => dictionaries.delete(namespace); } },
    slots: {
      inject: (name, fn) => { assert.ok(['plugins.detail.section', 'conversation.input.left'].includes(name)); return missingSlot ? () => {} : fn(); },
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
  assert.deepEqual(mount.registrations.map(({ options }) => options.name), ['plugins.detail.section', 'conversation.input.left']);
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
  for (const view of [zh, en]) assert.match(text(view()), /delegate_by_difficulty/);
  assert.match(text(zh()), /困难委派必须先点亮祈求，不会自动改用日常模型/);
  assert.match(text(en()), /difficult requests outside Rice require active Prayer and do not silently fall back/);
  assert.equal(nodes(zh(), 'select').length, 0);
  assert.deepEqual(nodes(zh(), 'li').map(text), ['p1 / shared', 'p2 / shared']);
  const button = () => nodes(zh(), 'button').find((item) => item.props.type === 'submit');
  assert.equal(button().props.disabled, true);
  const firstModel = () => nodes(nodes(zh(), 'fieldset')[0], 'input')[0];
  assert.equal(firstModel().props.type, 'checkbox');
  firstModel().props.onChange();
  assert.equal(firstModel().props.checked, true);
  assert.deepEqual(nodes(zh(), 'li').map(text), ['p2 / shared']);
  assert.equal(button().props.disabled, false);
  await nodes(zh(), 'form')[0].props.onSubmit({ preventDefault() {} });
  assert.match(text(zh()), /设置已保存/);
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

test('Frugal mode defaults on and saves only its own setting', async () => {
  const { controller, own, official } = fixture();
  controller.dispose();
  const mount = mounted(own.handle, official.handle);
  try {
    const view = () => render(mount, officialSubject, 'zh');
    const flag = () => nodes(view(), 'input').find(el => el.props['aria-describedby'] === 'fixture-riceEnabled');
    assert.equal(flag().props.checked, true);
    assert.match(text(view()), /节俭功能/);
    flag().props.onChange();
    assert.equal(flag().props.checked, false);
    assert.deepEqual(own.calls, []);
    await nodes(view(), 'form')[0].props.onSubmit({ preventDefault() {} });
    assert.deepEqual(own.calls, [{ revision: 1, ops: [{ op: 'set', path: ['riceEnabled'], value: false }] }]);
    assert.deepEqual(official.calls, []);
  } finally { mount.dispose(); }
});

test('the existing difficulty and Prayer flags share the existing draft and label the same hard candidates when Prayer is on', async () => {
  const { controller, own, official } = fixture();
  controller.dispose();
  const mount = mounted(own.handle, official.handle);
  const view = (lang) => render(mount, officialSubject, lang);
  const flag = (name) => nodes(view('zh'), 'input').find((el) => el.props['aria-describedby'] === `fixture-${name}`);
  assert.equal(flag('strictDifficulty').props.checked, false);
  assert.equal(flag('prayerEnabled').props.checked, false);
  assert.equal(nodes(view('zh'), 'blockquote').length, 0);
  flag('strictDifficulty').props.onChange();
  flag('prayerEnabled').props.onChange();
  nodes(nodes(view('zh'), 'fieldset')[0], 'input')[0].props.onChange();
  for (const lang of ['zh', 'en']) {
    assert.deepEqual(nodes(view(lang), 'legend').map((legend) => text(legend).trim()), ['万机之神']);
  }
  const prayer = nodes(view('zh'), 'blockquote')[0];
  assert.equal(prayer.props.lang, 'zh');
  assert.equal(text(prayer).split('\n').length, 14);
  assert.match(text(prayer), /^不朽的机械之神，聆听我们的祈祷\n/);
  assert.match(text(prayer), /鸣大钟三次\n齐声歌唱，赞美万机之神$/);
  const legendGlint = () => nodes(nodes(view('zh'), 'legend')[0], 'span')[0].props['data-confirmed'];
  assert.equal(legendGlint(), undefined); // 草稿的标题预览不播放已保存效果。
  assert.equal(nodes(view('zh'), 'select').length, 0);
  assert.equal(own.calls.length, 0);
  await nodes(view('zh'), 'form')[0].props.onSubmit({ preventDefault() {} });
  assert.deepEqual(own.calls, [{ revision: 1, ops: [
    { op: 'set', path: ['smartModels'], value: [a] },
    { op: 'set', path: ['strictDifficulty'], value: true },
    { op: 'set', path: ['prayerEnabled'], value: true },
  ] }]);
  assert.deepEqual(official.calls, []);
  assert.equal(flag('prayerEnabled').props.checked, true);
  assert.equal(legendGlint(), true);
  flag('prayerEnabled').props.onChange();
  assert.equal(nodes(view('zh'), 'blockquote').length, 0);
  mount.dispose();
});

test('flags merge independently of concurrent routing and can be changed without rewriting stale models', async () => {
  const { controller: ui, own, official } = fixture({ stored: [a, stale] });
  ui.toggleFlag('strictDifficulty');
  own.update({ revision: 2, value: { smartModels: [b, stale], prayerEnabled: true } });
  assert.equal(ui.projection().conflicted, true);
  await ui.save();
  assert.equal(own.calls.length, 0);
  ui.rebase();
  assert.equal(ui.projection().desiredSettings.prayerEnabled, true);
  assert.equal(ui.projection().invalid, true);
  official.update({ status: 'unavailable' });
  await ui.save();
  assert.deepEqual(own.calls, [{ revision: 2, ops: [{ op: 'set', path: ['strictDifficulty'], value: true }] }]);
  assert.deepEqual(plain(own.handle.getSnapshot().value.smartModels), [b, stale]);
  assert.equal(own.handle.getSnapshot().value.prayerEnabled, true);
  ui.dispose();
});

const endpoint = 'api/team-terra-ultra/session-mode';
const state = (mode = 'normal', revision = 1, features = {}) => ({ mode, revision, prayerEnabled: true, riceEnabled: true, writable: true, ...features });
const response = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const requestLog = (reply) => {
  const calls = [];
  return {
    calls,
    fetch: async (url, options) => {
      assert.equal(options.credentials, 'same-origin');
      assert.equal(options.mode, 'same-origin');
      assert.equal(options.cache, 'no-store');
      const body = options.body && JSON.parse(options.body);
      const call = { url, method: options.method, body };
      calls.push(call);
      return reply(call, options);
    },
  };
};

test('composer uses the session slot, suppresses child controls, and uses authoritative Rice/Prayer state', async () => {
  const { controller, own, official } = fixture();
  controller.dispose();
  const mount = mounted(own.handle, official.handle);
  const { options, component } = mount.registrations.find(({ options }) => options.name === 'conversation.input.left');
  assert.equal(options.id, 'team-terra-ultra.session-modes');
  const sessionId = 'session/id + x';
  let host = state('prayer', 6);
  let settleRice;
  const requests = requestLog(({ url, method, body }, init) => {
    if (method === 'GET') {
      assert.equal(url, `${endpoint}?sessionId=session%2Fid%20%2B%20x`);
      return response(200, host);
    }
    assert.equal(url, endpoint);
    assert.equal(init.headers['Content-Type'], 'application/json');
    assert.equal(body.revision, host.revision);
    assert.equal(body.sessionId, sessionId);
    if (body.mode === 'rice') return new Promise((resolve) => {
      settleRice = () => {
        host = state('rice', 7);
        resolve(response(200, { ...host, result: { updated: 2, skipped: 1 } }));
      };
    });
    host = state(body.mode, host.revision + 1);
    return response(200, host);
  });
  activeComposer = { fetch: requests.fetch };
  const outer = (snapshot) => component({ sessionId, useSession: (select) => select(snapshot),
    t: (key) => mount.dictionaries.get(options.locale).zh[key], ...options.inject() });
  try {
    assert.equal(outer({ subagent: { address: {} } }), null);
    assert.equal(outer({ removed: true }), null);
    assert.deepEqual(requests.calls, []);
    const view = () => renderComposer(outer({ subagent: null }));
    const button = (name) => nodes(view(), 'button').find(({ props }) => props['aria-label'] === name);
    const selected = (name) => button(name).props['aria-pressed'];
    const celebration = (name) => nodes(button(name), 'span').find(({ props }) => props['data-celebrate'])?.props['data-celebrate'];
    view();
    await new Promise(setImmediate);
    assert.deepEqual(requests.calls.map(({ method }) => method), ['GET']);
    assert.equal(selected('祈求'), true);
    assert.equal(button('饭碗').props.title, '饭碗 · 月底了没有大白饭了');
    assert.equal(text(button('饭碗')).trim(), '');
    assert.equal(text(button('祈求')).trim(), '祈求');
    assert.match(text(view()), /困难本地委派改用已授权的日常模型，没有可用日常模型就拒绝/);
    assert.match(text(view()), /尝试恢复原选项，不覆盖后来手动做出的选择/);
    assert.equal(celebration('祈求'), undefined); // 打开已点亮的会话不重播。
    const pending = button('饭碗').props.onClick();
    assert.equal(celebration('饭碗'), undefined);
    assert.equal(selected('祈求'), true);
    assert.equal(selected('饭碗'), false);
    assert.equal(button('饭碗').props['aria-disabled'], true);
    assert.equal(button('饭碗').props.disabled, false); // 等待时不夺走键盘焦点
    await button('饭碗').props.onClick();
    assert.equal(requests.calls.length, 2);
    settleRice();
    await pending;
    assert.equal(selected('饭碗'), true);
    assert.equal(selected('祈求'), false);
    assert.equal(button('祈求').props.disabled, false); // 仍可用键盘读出被饭碗挡住的原因。
    assert.equal(button('祈求').props['aria-disabled'], true);
    assert.match(text(view()), /token来token来 · 已更新成员 2 · 跳过 1/);
    assert.equal(celebration('饭碗'), 'rice');
    assert.equal(celebration('祈求'), undefined);
    await button('祈求').props.onClick();
    assert.equal(requests.calls.length, 2);
    await button('饭碗').props.onClick();
    assert.equal(selected('祈求'), false);
    assert.equal(selected('饭碗'), false);
    assert.deepEqual(requests.calls.filter(({ method }) => method === 'POST').map(({ body }) => body.mode), ['rice', 'normal']);
    assert.match(text(view()), /GPT6\.2ASTRAUltra，帮我算个99乘法表/);
    assert.equal(celebration('饭碗'), 'rice');
    host = state('normal', 9, { prayerEnabled: false, writable: false });
    const previousPrayerAction = button('祈求').props.onClick;
    browserEvents.get('focus')();
    assert.equal(button('祈求'), undefined);
    assert.ok(button('饭碗'));
    await previousPrayerAction();
    assert.deepEqual(requests.calls.map(({ method }) => method), ['GET', 'POST', 'POST', 'GET']);
    await new Promise(setImmediate);
    assert.equal(button('祈求'), undefined);
    assert.equal(button('饭碗').props.disabled, true);
    assert.equal(requests.calls.at(-1).method, 'GET');
  } finally {
    unmountComposer();
    mount.dispose();
  }
  assert.equal(own.listeners.size, 0);
  assert.equal(browserEvents.size, 0);
  assert.equal(mount.events.size, 0);
});

test('composer refreshes only saved plugin routing/flags and can discover capability when an inactive root starts running', async () => {
  const { controller, own, official } = fixture({ ownInitial: { value: { smartModels: [a], prayerEnabled: true } } });
  controller.dispose();
  const mount = mounted(own.handle, official.handle);
  const { options, component } = mount.registrations.find(({ options }) => options.name === 'conversation.input.left');
  const draft = mount.registrations[0].options.inject().controller;
  let running = false;
  const requests = requestLog(({ method }) => {
    assert.equal(method, 'GET');
    const { smartModels, prayerEnabled, riceEnabled = true } = own.handle.getSnapshot().value;
    return response(200, state('normal', 1, { prayerEnabled: running && prayerEnabled && smartModels.length > 0, riceEnabled }));
  });
  activeComposer = { fetch: requests.fetch };
  const view = () => renderComposer(component({ sessionId: 'resident', useSession: (select) => select({ running }),
    t: (key) => mount.dictionaries.get(options.locale).en[key], ...options.inject() }));
  const button = (mode) => nodes(view(), 'button').find(({ props }) => props['data-team-mode'] === mode);
  const settled = () => new Promise(setImmediate);
  try {
    assert.equal(button('prayer'), undefined);
    await settled();
    assert.ok(button('rice'));
    assert.equal(button('prayer'), undefined);
    assert.equal(requests.calls.length, 1);

    running = true;
    assert.equal(button('prayer'), undefined);
    await settled();
    assert.ok(button('prayer'));
    assert.equal(requests.calls.length, 2);

    draft.toggleModel(api.routeKey(a));
    draft.toggleFlag('strictDifficulty');
    draft.toggleFlag('prayerEnabled');
    assert.ok(button('prayer'));
    assert.equal(requests.calls.length, 2); // 不因为设置草稿拆除按钮。
    draft.discard();
    official.update({ value: { enabled: false, allowedModels: [] }, revision: 2 });
    assert.ok(button('prayer'));
    assert.equal(requests.calls.length, 2); // 已打开会话的 rc.5 官方授权仍按旧快照生效。
    official.update({ value: { enabled: true, allowedModels: [a, b] }, revision: 3 });

    draft.toggleModel(api.routeKey(a));
    const saving = draft.save();
    assert.equal(button('prayer'), undefined);
    assert.ok(button('rice'));
    await saving;
    await settled();
    assert.equal(button('prayer'), undefined);
    assert.equal(requests.calls.length, 3);

    own.update({ revision: 3, value: { smartModels: [a], prayerEnabled: true } });
    await settled();
    assert.ok(button('prayer'));
    assert.equal(requests.calls.length, 4);
    own.update({ revision: 4, value: { smartModels: [a], prayerEnabled: true, strictDifficulty: true } });
    assert.equal(button('prayer'), undefined);
    await settled();
    assert.ok(button('prayer'));
    own.update({ revision: 5, value: { smartModels: [a], prayerEnabled: false, strictDifficulty: true } });
    await settled();
    assert.equal(button('prayer'), undefined);
    assert.equal(requests.calls.length, 6);
    draft.toggleFlag('riceEnabled');
    assert.ok(button('rice')); // 草稿不会隐藏入口。
    await draft.save();
    await settled();
    assert.equal(button('rice'), undefined);
    own.update({ revision: 7, value: { smartModels: [a], prayerEnabled: false, strictDifficulty: true, riceEnabled: true } });
    await settled();
    assert.equal(button('rice').props['aria-pressed'], false);
    assert.equal(requests.calls.length, 8); // 关和开只刷新，不发会话模式写入。
  } finally {
    unmountComposer();
    mount.dispose();
  }
});

test('focused Prayer stays non-operable during recheck and transfers focus to Rice only if removed', async () => {
  const { controller, own, official } = fixture();
  controller.dispose();
  const mount = mounted(own.handle, official.handle);
  const { options, component } = mount.registrations.find(({ options }) => options.name === 'conversation.input.left');
  const gates = [];
  const requests = requestLog(() => new Promise((resolve) => gates.push(resolve)));
  activeComposer = { fetch: requests.fetch };
  const view = () => renderComposer(component({ sessionId: 'focus', useSession: (select) => select({}),
    t: (key) => mount.dictionaries.get(options.locale).en[key], ...options.inject() }));
  const button = (mode) => nodes(view(), 'button').find(({ props }) => props['data-team-mode'] === mode);
  const settle = async (body) => { gates.shift()(response(200, body)); await new Promise(setImmediate); };
  try {
    assert.equal(button('prayer'), undefined);
    await settle(state());
    assert.ok(button('prayer'));
    const { buttons, document } = activeComposer;
    const prayer = buttons.get('prayer').element;
    const rice = buttons.get('rice').element;
    prayer.focus();
    browserEvents.get('focus')();
    assert.equal(button('prayer').props['aria-disabled'], true);
    assert.equal(button('prayer').props.disabled, false);
    assert.equal(document.activeElement, prayer);
    await button('prayer').props.onClick();
    assert.equal(requests.calls.length, 2);
    await settle(state());
    assert.equal(button('prayer').props['aria-disabled'], undefined);
    assert.equal(document.activeElement, prayer);

    browserEvents.get('focus')();
    assert.ok(button('prayer'));
    await settle(state('normal', 1, { prayerEnabled: false }));
    assert.equal(button('prayer'), undefined);
    assert.equal(document.activeElement, rice);
    assert.equal(requests.calls.every(({ method }) => method === 'GET'), true);

    browserEvents.get('focus')();
    await settle(state());
    button('prayer');
    buttons.get('prayer').element.focus();
    browserEvents.get('focus')();
    assert.ok(button('prayer'));
    const other = {};
    document.activeElement = other; // 焦点切到插件之外；迟到的响应不将它抢回。
    await settle(state('normal', 1, { prayerEnabled: false }));
    assert.equal(button('prayer'), undefined);
    assert.equal(document.activeElement, other);
  } finally {
    unmountComposer();
    mount.dispose();
  }
});

test('confirmed Rice feedback survives a queued read but clears after another window changes the mode', async () => {
  let host = state();
  let completeWrite;
  const controller = new api.SessionModeController('confirmation', async (_url, { method }) => {
    if (method === 'GET') return response(200, host);
    return new Promise(resolve => { completeWrite = () => { host = state('rice', 1); resolve(response(200, host)); }; });
  });
  try {
    await controller.start();
    const write = controller.toggle('rice');
    controller.refresh(true);
    completeWrite();
    await write;
    await new Promise(setImmediate);
    assert.deepEqual(plain(controller.store.getSnapshot().confirmation), { target: 'rice', active: true });
    host = state('normal', 2);
    await controller.refresh(true);
    assert.equal(controller.store.getSnapshot().confirmation, undefined);
    assert.equal(controller.store.getSnapshot().celebration, undefined);
  } finally { controller.stop(); }
});

for (const outcome of ['same', 'different revision', 'ineligible']) {
  test(`queued Prayer feedback waits for authoritative confirmation (${outcome})`, async () => {
    const gates = [];
    const requests = requestLog(({ method }) => {
      if (method === 'GET' && requests.calls.length === 1) return response(200, state());
      return new Promise((resolve) => gates.push(resolve));
    });
    const controller = new api.SessionModeController('queued-prayer', requests.fetch);
    const snapshot = controller.store.getSnapshot;
    try {
      await controller.start();
      const pending = controller.toggle('prayer');
      void controller.refresh(true);
      gates.shift()(response(200, { ...state('prayer', 2), result: { updated: 2, skipped: 0 } }));
      await pending;
      assert.equal(snapshot().phase, 'loading');
      assert.equal(snapshot().prayerFeedbackPending, true);
      assert.equal(snapshot().celebration, undefined);
      assert.notEqual(snapshot().prayerCurrent, true);
      gates.shift()(response(200, outcome === 'same' ? state('prayer', 2) : outcome === 'different revision'
        ? state('prayer', 3) : state('normal', 2, { prayerEnabled: false })));
      await new Promise(setImmediate);
      if (outcome === 'same') {
        assert.deepEqual(plain(snapshot().confirmation), { target: 'prayer', active: true });
        assert.deepEqual(plain(snapshot().result), { updated: 2, skipped: 0 });
        assert.equal(snapshot().celebration.target, 'prayer');
        const ordinaryRefresh = controller.refresh(true);
        gates.shift()(response(200, state('prayer', 2)));
        await ordinaryRefresh;
        assert.equal(snapshot().confirmation.target, 'prayer');
        assert.equal(snapshot().celebration, undefined);
      } else {
        assert.equal(snapshot().confirmation, undefined);
        assert.equal(snapshot().result, undefined);
        assert.equal(snapshot().celebration, undefined);
      }
      assert.equal(requests.calls.filter(({ method }) => method === 'POST').length, 1);
    } finally { controller.stop(); }
  });
}

test('409 preserves another writer’s mode and refreshes revision; only a manual action issues another POST', async () => {
  let host = state();
  const requests = requestLog(({ method, body }) => {
    if (method === 'GET') return response(200, host);
    if (body.revision !== host.revision) return response(409, { shouldNotUse: true });
    host = state(body.mode, host.revision + 1);
    return response(200, host);
  });
  const controller = new api.SessionModeController('race', requests.fetch);
  await controller.start();
  host = state('rice', 2);
  await controller.toggle('prayer');
  assert.equal(controller.store.getSnapshot().feedback, 'conflict');
  assert.equal(controller.store.getSnapshot().celebration, undefined);
  assert.deepEqual(plain(controller.store.getSnapshot().value), host);
  assert.deepEqual(requests.calls.map(({ method }) => method), ['GET', 'POST', 'GET']);
  await controller.toggle('prayer');
  assert.equal(requests.calls.length, 3);
  await controller.toggle('rice');
  assert.deepEqual(requests.calls.at(-1).body, { sessionId: 'race', mode: 'normal', revision: 2 });
  assert.equal(controller.store.getSnapshot().feedback, undefined);
  controller.stop();
});

for (const status of [409, 403]) {
  test(`POST ${status} checks current capability without replaying the write or disabling Rice`, async () => {
    let persisted = 'normal';
    let revision = 1;
    let authorized = true;
    const requests = requestLog(({ method, body }) => {
      const view = () => state(!authorized && persisted === 'prayer' ? 'normal' : persisted, revision, { prayerEnabled: authorized });
      if (method === 'GET') return response(200, view());
      if (body.mode === 'prayer') {
        // Another window saved Prayer, then the route briefly became unusable.
        persisted = 'prayer';
        revision++;
        authorized = false;
        return response(status, { error: 'prayer_unavailable' });
      }
      assert.equal(body.revision, revision);
      persisted = body.mode;
      revision++;
      return response(200, view());
    });
    const controller = new api.SessionModeController('capability-race', requests.fetch);
    const snapshot = controller.store.getSnapshot;
    try {
      await controller.start();
      await controller.toggle('prayer');
      assert.equal(snapshot().phase, 'ready');
      assert.equal(snapshot().value.prayerEnabled, false);
      assert.equal(snapshot().value.writable, true);
      assert.equal(snapshot().feedback, 'conflict');
      assert.equal(snapshot().celebration, undefined);
      await controller.toggle('prayer');
      assert.deepEqual(requests.calls.map(({ method }) => method), ['GET', 'POST', 'GET']);

      authorized = true;
      await controller.refresh(true);
      assert.equal(snapshot().value.mode, 'prayer');
      assert.equal(snapshot().celebration, undefined);
      authorized = false;
      await controller.refresh(true);
      await controller.toggle('rice'); // while the saved Prayer mode is hidden
      assert.equal(persisted, 'rice');
      await controller.toggle('rice');
      authorized = true;
      await controller.refresh(true);
      assert.equal(snapshot().value.mode, 'normal');
      assert.deepEqual(requests.calls.filter(({ method }) => method === 'POST').map(({ body }) => body.mode), ['prayer', 'rice', 'normal']);
    } finally { controller.stop(); }
  });
}

test('an obsolete GET cannot surface Prayer before a queued GET, and restoration does not replay the rite', async () => {
  const gates = [];
  let getCount = 0;
  const calls = requestLog(({ method }) => {
    if (method === 'POST') return response(200, state('prayer', 2));
    if (getCount++ === 0) return response(200, state());
    return new Promise((resolve) => gates.push(resolve));
  });
  const controller = new api.SessionModeController('queued', calls.fetch);
  const snapshot = controller.store.getSnapshot;
  try {
    await controller.start();
    await controller.toggle('prayer');
    assert.equal(snapshot().celebration.target, 'prayer');
    const observed = [];
    controller.store.subscribe(() => observed.push(snapshot()));
    const obsolete = controller.refresh(true);
    void controller.refresh(true);
    gates.shift()(response(200, state('prayer', 2)));
    await obsolete;
    assert.equal(gates.length, 1);
    assert.ok(observed.every(({ prayerCurrent }) => !prayerCurrent));
    assert.equal(snapshot().value.writable, true); // Rice is still shown during the read.
    await controller.toggle('prayer');
    assert.equal(calls.calls.filter(({ method }) => method === 'POST').length, 1);

    gates.shift()(response(200, state('prayer', 2)));
    await new Promise(setImmediate);
    assert.equal(snapshot().prayerCurrent, true);
    assert.equal(snapshot().value.mode, 'prayer');
    assert.deepEqual(plain(snapshot().confirmation), { target: 'prayer', active: true });
    assert.equal(snapshot().celebration, undefined);
    const failed = controller.refresh(true);
    gates.shift()(response(503));
    await failed;
    assert.equal(snapshot().phase, 'unavailable');
    assert.notEqual(snapshot().prayerCurrent, true);
    assert.equal(snapshot().confirmation, undefined);
    const restored = controller.refresh(true);
    gates.shift()(response(200, state('prayer', 2)));
    await restored;
    assert.equal(snapshot().value.mode, 'prayer');
    assert.equal(snapshot().confirmation, undefined);
    assert.equal(snapshot().celebration, undefined);
  } finally { controller.stop(); }
});

test('unsupported and uncertain transport remains non-writable until a verified GET', async () => {
  const responses = [response(404), response(200, { mode: 'normal', revision: 1 }), response(200, state()),
    new Error('offline'), new Error('offline'), response(200, state('rice', 2, { writable: false }))];
  const requests = requestLog(() => {
    const next = responses.shift();
    if (next instanceof Error) throw next;
    assert.ok(next, 'unexpected network request');
    return next;
  });
  const controller = new api.SessionModeController('unavailable', requests.fetch);
  await controller.start();
  await controller.toggle('rice');
  assert.equal(controller.store.getSnapshot().phase, 'unavailable');
  await controller.refresh();
  await controller.toggle('rice');
  assert.equal(controller.store.getSnapshot().phase, 'unavailable');
  assert.equal(requests.calls.length, 2);
  await controller.refresh();
  await controller.toggle('rice');
  assert.equal(controller.store.getSnapshot().phase, 'unavailable');
  assert.equal(controller.store.getSnapshot().feedback, 'failed');
  await controller.toggle('rice');
  assert.equal(requests.calls.filter(({ method }) => method === 'POST').length, 1);
  await controller.refresh();
  assert.equal(controller.store.getSnapshot().value.mode, 'rice');
  await controller.toggle('rice');
  assert.equal(requests.calls.filter(({ method }) => method === 'POST').length, 1);
  controller.stop();
});

test('a detached composer aborts requests and ignores even a late settled response', async () => {
  let settle;
  let oldSignal;
  let calls = 0;
  const controller = new api.SessionModeController('remount', async (_url, { signal }) => {
    if (++calls === 1) {
      oldSignal = signal;
      return new Promise((resolve) => { settle = resolve; });
    }
    return response(200, state('rice', 2));
  });
  const old = controller.start();
  controller.stop();
  assert.equal(oldSignal.aborted, true);
  await controller.start();
  settle(response(200, state('prayer', 1)));
  await old;
  assert.equal(controller.store.getSnapshot().value.mode, 'rice');
  controller.stop();
});

test('deferred and failed member synchronization never turn into claimed counts', async () => {
  let host = state();
  const reports = [{ deferred: true, updated: 0, skipped: 0 }, { failed: true, updated: 4, skipped: 0 }];
  const controller = new api.SessionModeController('dormant', async (_url, { method, body }) => {
    if (method === 'GET') return response(200, host);
    host = state(JSON.parse(body).mode, host.revision + 1);
    return response(200, { ...host, result: reports.shift() });
  });
  await controller.start();
  await controller.toggle('prayer');
  assert.equal(controller.store.getSnapshot().value.mode, 'prayer');
  assert.equal(controller.store.getSnapshot().feedback, 'deferred');
  assert.equal(controller.store.getSnapshot().result, undefined);
  await controller.toggle('rice');
  assert.equal(controller.store.getSnapshot().value.mode, 'rice');
  assert.equal(controller.store.getSnapshot().feedback, 'reconcileFailed');
  assert.equal(controller.store.getSnapshot().celebration, undefined);
  assert.equal(controller.store.getSnapshot().result, undefined);
  controller.stop();
});
