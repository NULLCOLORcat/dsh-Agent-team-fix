// 离线入口烟测：仅替换外部包解析；配置、插件入口、运行时、熔断回调均来自交付源码。
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const fixture = source => 'data:text/javascript,' + encodeURIComponent(source);
const schema = fixture('const z = new Proxy({}, { get: () => () => z }); export default z;');
const pipeline = fixture('export class ToolExecutionPipeline { prepare() {} dispatch() {} complete() {} }');
const secret = 'fixture-private-path-or-credential';

function host() {
  const warnings = [], pending = [], undo = [], events = {}, tools = [];
  let route;
  const ctx = { settings: { configure(options) { assert.deepEqual(options, { auto: false }); return () => {}; } },
    agentTeams: { isEnabled: () => true }, agents: { get() {} }, subagents: { rootOf: a => a },
    llm: { resolveModelInfo() {}, resolveCallConfig() {} }, logger: { warn: text => warnings.push(text) },
    tools: { register: (tool, opts) => tools.push({ tool, opts }), executable() {} },
    connection: { fetch: { register(spec) { route = spec; return () => { route = undefined; }; } } },
    effect(fn) { undo.push(fn()); }, on(name, fn) { events[name] = fn; },
    inject(keys, fn) { pending.push({ keys, start: () => fn(ctx) }); },
  };
  return { ctx, pending, tools, warnings, events, route: () => route, dispose: () => undo.reverse().forEach(fn => fn()) };
}

test('Host entry: missing import, delayed services, runtime fault, stale scope and fresh activation', async t => {
  let attempts = 0;
  const hook = registerHooks({ resolve(specifier, context, next) {
    if (specifier === '@deepseek-ai/schemastery') return { shortCircuit: true, url: schema };
    if (specifier === '@deepseek-ai/dsh-tools/pipeline') {
      attempts++;
      if (context.parentURL.endsWith('?missing')) throw new Error(secret);
      return { shortCircuit: true, url: pipeline };
    }
    return next(specifier, context);
  } });
  t.after(() => hook.deregister());
  for (const mode of ['missing', 'healthy', 'reloaded']) {
    const before = attempts;
    const entry = await import('./index.js?' + mode);
    assert.ok(entry.Config); assert.equal(attempts, before, 'Config discovery must not import pipeline');
    if (mode === 'missing') {
      const broken = host(); broken.ctx.settings.configure = () => { throw new Error(secret); };
      assert.throws(() => entry.apply(broken.ctx, {}), e => /settings API unavailable/.test(e.message) && !e.message.includes(secret));
    }
    const f = host(); entry.apply(f.ctx, {});
    await f.pending.find(p => p.keys.includes('connection')).start();
    const resource = f.route();
    assert.equal(resource.path, '/api/team-terra-ultra/status'); assert.deepEqual(resource.methods, ['GET']);
    const status = async () => { const res = await resource.fetch(); assert.equal(res.headers.get('cache-control'), 'no-store'); return (await res.json()).status; };
    assert.equal(await status(), 'waiting');
    const routing = f.pending.find(p => p.keys.includes('agentTeams'));
    await routing.start();
    if (mode === 'missing') { assert.equal(f.tools.length, 0); assert.deepEqual(Object.keys(f.events), []); }
    else {
      assert.equal(await status(), 'ready'); assert.equal(f.tools.length, 3);
      if (mode === 'healthy') {
        f.ctx.subagents.rootOf = () => { throw new Error(secret); };
        assert.equal(f.tools[0].opts.when({ agent: {} }), false);
      }
    }
    if (mode !== 'reloaded') {
      assert.equal(await status(), 'disabled'); assert.equal(f.warnings.length, 1); assert.ok(!f.warnings[0].includes(secret));
      const count = f.tools.length; await routing.start(); assert.equal(f.tools.length, count); assert.equal(f.warnings.length, 1);
    }
    f.dispose(); assert.equal(f.route(), undefined);
  }
});

test('native settings card reads the scoped status endpoint and renders a sanitized accessible warning', async () => {
  let api, Component, cleanup, effect, result, finish;
  let status = 'loading';
  const react = { createElement(type, props, ...children) { if (typeof type === 'function') Component = type; return { type, props, children }; },
    useId: () => 'fixture', useState: () => [status, v => { status = v; finish(); }], useReducer: () => [0, () => {}], useEffect: fn => { effect = fn; } };
  const calls = [];
  const window = { __ModuleLoader__: { load: ({ factory }) => { api = factory(() => react); } },
    __DSH_TRANSPORT__: { fetch: async (path, opts) => { calls.push({ path, opts }); return Response.json({ status: 'disabled', private: secret }); } } };
  const scope = { getSnapshot: () => ({ value: {}, status: 'ready', writable: false }), subscribe: () => () => {} };
  const ctx = { configForms: { get: () => scope, whileServed: (_, fn) => fn() },
    remote: { session: { modelCatalog: async () => ({ ok: true, value: { groups: [] } }) }, $on: () => () => {} },
    effect: fn => fn(), on: () => () => {}, slots: { inject: (_, fn) => fn(), register: (opts, card) => {
      const props = opts.inject(); card({ view: 'page', ...props, useTeamModelCard: fn => fn(props.hooks.teamModelCard.getSnapshot()) });
      return () => {};
    } } };
  // 原生卡片安装时有独立 CSS effect；仅为其提供最小 DOM。
  const sandbox = { window, AbortController, document: { createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild() {} } } };
  vm.runInNewContext(readFileSync(new URL('./client.js', import.meta.url), 'utf8'), sandbox);
  api.apply(ctx); assert.equal(typeof Component, 'function');
  const updated = new Promise(resolve => { finish = resolve; });
  Component(); cleanup = effect(); await updated; result = Component();
  assert.equal(calls[0].path, 'api/team-terra-ultra/status'); assert.equal(calls[0].opts.method, 'GET');
  assert.equal(result.children[0].props.role, 'alert'); assert.match(result.children[0].children[0], /队友模型路由已停用/);
  assert.ok(!JSON.stringify(result).includes(secret)); cleanup(); assert.equal(calls[0].opts.signal.aborted, true);
});
