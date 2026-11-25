// 入口烟测：Node 不要求已安装依赖；Electron 子进程复用已安装的 rc.5 Host 包。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { setImmediate as nextTick } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const schemaName = '@deepseek-ai/schemastery';
const storageName = '@deepseek-ai/dsh-storage-domain';
const installDir = process.versions.electron && process.env.DSH_INSTALL_DIR;
const installedRequire = installDir ? createRequire(join(installDir, 'package.json')) : undefined;
const installedPackage = (name, file = 'index.js') =>
  pathToFileURL(join(installDir, 'node_modules', '@deepseek-ai', name, 'lib', file)).href;
const entryUrl = new URL('./index.js', import.meta.url).href;
const fakeSchema = 'data:text/javascript,' + encodeURIComponent(`
  const fluent = new Proxy({}, { get: () => () => fluent });
  export default { object: dict => ({ dict }), string: () => fluent, array: () => fluent, boolean: () => fluent };
`);

/** 仅重定向工作区入口的依赖；归档内的官方插件仍使用自身原生模块解析。 */
function entryResolver() {
  const installed = specifier => {
    if (specifier === schemaName) return installedPackage('schemastery', 'index.mjs');
    if (specifier === storageName || specifier === '@deepseek-ai/dsh-tools/pipeline') {
      return pathToFileURL(installedRequire.resolve(specifier)).href;
    }
    if (specifier === 'zod') {
      const packagePath = installedRequire.resolve('zod/package.json');
      const manifest = JSON.parse(readFileSync(packagePath, 'utf8'));
      return pathToFileURL(join(dirname(packagePath), manifest.exports['.'].import)).href;
    }
  };
  return registerHooks({ resolve(specifier, context, next) {
    if (context.parentURL !== entryUrl) return next(specifier, context);
    const url = installedRequire && installed(specifier);
    if (url) return { shortCircuit: true, url };
    if (specifier === schemaName) {
      try { return next(specifier, context); }
      catch (error) {
        if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
        return { shortCircuit: true, url: fakeSchema };
      }
    }
    if (specifier.startsWith('@deepseek-ai/') && specifier !== storageName) {
      assert.fail(`unexpected Host import from extension: ${specifier}`);
    }
    return next(specifier, context);
  } });
}

const entry = await (async () => {
  const hook = entryResolver();
  try { return await import(entryUrl); }
  finally { hook.deregister(); }
})();
const { SESSION_MODE_PATH } = await import('./session-modes.js');
const fail = () => { throw new Error('fixture private diagnostic'); };
const adviceToken = 'team-terra-ultra:difficulty-candidates';
const hard = Object.freeze({ provider: 'p', model: 'strong' });
const routine = Object.freeze({ provider: 'q', model: 'strong' }); // 同名模型，不同供应商
const unlisted = Object.freeze({ provider: 'p', model: 'unlisted' });

function portableHost() {
  const waiting = [];
  let setting;
  let advice;
  const fiber = Object.freeze({});
  const ctx = Object.freeze({ fiber, inject(keys, mount) { waiting.push({ keys, mount }); } });
  const settingsScope = Object.freeze({
    settings: Object.freeze({ configure(options, owner) { assert.equal(owner, fiber); setting = options; return () => { setting = undefined; }; } }),
    effect(make) { return make(); },
  });
  const adviceScope = Object.freeze({ on(event, handler) {
    assert.equal(event, 'system-prompt/assemble');
    advice = handler;
    return () => { advice = undefined; };
  } });
  return { ctx, waiting, settingsScope, adviceScope, setting: () => setting, advice: () => advice };
}

test('Host entry declares independent settings, prompt and mode lifecycles', async () => {
  assert.equal(entry.name, 'team-terra-ultra');
  assert.deepEqual(Object.keys(entry.Config.dict), ['smartModels', 'strictDifficulty', 'prayerEnabled', 'riceEnabled']);
  const f = portableHost();
  assert.doesNotThrow(() => entry.apply(f.ctx, Object.freeze({ smartModels: [] })));
  assert.deepEqual(f.waiting.map(({ keys }) => keys), [
    ['settings'],
    ['systemPrompt', 'sessionProjections', 'tools', 'agents', 'subagents', 'llm'],
    ['storageDomain', 'tools', 'subagents', 'sessionProjections', 'llm', 'agents'],
  ]);
  assert.equal(f.setting(), undefined);
  assert.equal(f.advice(), undefined);

  f.waiting[1].mount(f.adviceScope);
  const original = Object.freeze({ sections: Object.freeze([]) });
  assert.equal(await f.advice()(original, {}, () => original), original);
  assert.equal(f.setting(), undefined);
  f.waiting[0].mount(f.settingsScope);
  assert.deepEqual(f.setting(), { auto: false });
});

test('Host entry contains missing or failing dependencies independently', () => {
  assert.doesNotThrow(() => entry.apply(Object.freeze({}), {}));
  assert.doesNotThrow(() => entry.apply(Object.freeze({ inject: fail }), {}));
  const f = portableHost();
  entry.apply(f.ctx, {});
  assert.doesNotThrow(() => f.waiting[0].mount({ effect(make) { make(); }, settings: { configure: fail } }));
  assert.doesNotThrow(() => f.waiting[1].mount({ on: fail }));
  assert.doesNotThrow(() => f.waiting[1].mount({}));
  assert.equal(f.setting(), undefined);
  assert.equal(f.advice(), undefined);
  f.waiting[1].mount(f.adviceScope);
  assert.equal(typeof f.advice(), 'function');
});

test('real Schemastery defaults new settings and ignores obsolete keys without mutating input', {
  skip: entry.Config['~standard'] === undefined ? 'Schemastery not installed' : false,
}, () => {
  const oldConfig = Object.freeze({
    allowedModels: 'obsolete even if invalid', defaultModel: null, defaultReasoningEffort: 314,
    fallbackToCurrentModel: true, smartModels: Object.freeze([hard]),
  });
  const { validate } = entry.Config['~standard'];
  const legacy = validate(oldConfig);
  assert.equal(legacy.issues, undefined);
  assert.deepEqual(legacy.value.smartModels.get(), [hard]);
  assert.deepEqual(oldConfig.smartModels, [hard]);
  assert.equal(oldConfig.allowedModels, 'obsolete even if invalid');
  assert.equal(legacy.value.strictDifficulty.get(), false);
  assert.equal(legacy.value.prayerEnabled.get(), false);
  assert.equal(legacy.value.riceEnabled.get(), true);
  assert.equal(validate({ riceEnabled: false }).value.riceEnabled.get(), false);
  assert.deepEqual(validate({ fallbackToCurrentModel: true }).value.smartModels.get(), []);
  assert.equal(validate({ strictDifficulty: true, prayerEnabled: true }).value.prayerEnabled.get(), true);
  assert.ok(validate({ smartModels: [{ provider: 'p' }] }).issues?.length);
});

/** 真正的 Storage Hub / Domain 持有生命周期；只替换写入介质，不触碰 profile。 */
function memoryBackend() {
  const tables = { modes: {}, marks: {} };
  const opens = [];
  const writes = [];
  let closes = 0;
  return { tables, opens, writes, get closes() { return closes; }, kv: {
    async open(descriptor) {
      opens.push(descriptor);
      return {
        async loadAll() { return { tables: structuredClone(tables), global: null }; },
        async putRecord(table, key, record) { writes.push({ table, key, record }); tables[table][key] = structuredClone(record); },
        async deleteRecord(table, key) { delete tables[table][key]; },
        async close() { closes++; },
      };
    },
  } };
}

async function eventually(check, diagnostic) {
  // Extension injects its Connection only after asynchronous domain open.
  const end = Date.now() + 2500;
  do {
    if (await check()) return;
    await nextTick();
  } while (Date.now() < end);
  assert.fail(diagnostic);
}

test('installed rc.5 Host: preset-scoped native provenance, authorization, owner-only modes and cleanup', {
  skip: !installedRequire ? 'installed Electron runtime not in use' : false,
}, async t => {
  const hook = entryResolver();
  const fibers = new Set();
  t.after(async () => {
    try { for (const fiber of [...fibers].reverse()) await fiber.dispose(); }
    finally { hook.deregister(); }
  });
  const manifest = JSON.parse(readFileSync(join(installDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8'));
  assert.equal(manifest.version, '0.2.2-rc.5');
  const [{ Context }, projection, prompt, tools, { Session }, native, executor, agents, storage, storageDomain, connection, { createScope, bindScopeParent }] = await Promise.all([
    'cordis', 'dsh-session-projection', 'dsh-system-prompt', 'dsh-tools', 'dsh-session', 'dsh-tool-subagent',
    'dsh-tool-executor-native', 'dsh-agent', 'dsh-storage', 'dsh-storage-domain', 'dsh-client-connection', 'dsh-scope',
  ].map(name => import(installedPackage(name))));
  const host = new Context();
  async function mount(plugin, config, parent = host) {
    const fiber = parent.plugin(plugin, config);
    fibers.add(fiber);
    await fiber;
    return fiber;
  }
  async function unmount(fiber) {
    await fiber.dispose();
    fibers.delete(fiber);
  }

  const backend = memoryBackend();
  const starts = [];
  const approvals = [];
  const nativeChecks = [];
  const settingsCalls = new Map();
  const stats = [];
  let approvalReply = 'allowed-once';
  let hostDenies = false;
  const config = { smartModels: [hard, unlisted], strictDifficulty: true };
  const extension = await mount(entry, config);
  const settings = await mount(scope => scope.provide('settings', {
    configure(options, owner) {
      settingsCalls.set(owner, options);
      return () => settingsCalls.delete(owner);
    },
  }));
  assert.deepEqual(settingsCalls.get(extension), { auto: false });
  assert.equal(backend.opens.length, 0);
  assert.equal(host.tools, undefined);

  await mount(projection.default);
  await mount(prompt.default, {});
  await mount(tools.default);
  await mount(executor);
  await mount(agents.default);
  await mount(storage.default);
  await mount({ inject: ['storage'], apply(scope) {
    scope.effect(() => scope.storage.backend.register('fixture', backend));
    scope.provide(storage.storageBackendServiceKey('fixture'), true);
  } });
  await mount(storageDomain, { backend: 'fixture' });
  class FixtureConnection extends connection.HostConnectionService {
    constructor(ctx) { super(ctx, [], {}); }
  }
  await mount(FixtureConnection);

  const fresh = { id: 'fixture-fresh', session: Session.create('fixture-fresh'), options: hard };
  const old = { id: 'fixture-old', session: Session.create('fixture-old'), options: routine };
  const shadow = { id: 'fixture-shadow', session: Session.create('fixture-shadow'), options: hard };
  // 复用真实 AgentLoop + AgentPresetRegistry 的作用域拓扑；不启动 Agent 循环或改写 profile。
  const presetKey = {};
  const preset = createScope(host, presetKey);
  t.after(() => preset.dispose());
  for (const agent of [fresh, old, shadow]) {
    const agentScope = createScope(host, agent);
    bindScopeParent(agent, presetKey);
    agent.ctx = agentScope.ctx;
    t.after(() => agentScope.dispose());
  }
  fresh.session.append('subagent/model-selection-policy', { allowedModels: [hard, routine] });
  shadow.session.append('subagent/model-selection-policy', { allowedModels: [hard, routine] });
  await mount({
    inject: ['agents'],
    apply(scope) {
      scope.effect(() => scope.agents.enter(fresh));
      scope.effect(() => scope.agents.enter(old));
      scope.effect(() => scope.agents.enter(shadow));
      // 走原生工具、提示与执行管线，只在真正启动成员前截断。
      const local = { name: 'fixture-local', capabilities: { agentOptions: true }, prepareContinuable: fail };
      const external = { name: 'fixture-external', capabilities: { agentOptions: true } };
      const fork = { ...local, name: 'fixture-fork', inheritsParentContext: true };
      scope.provide('subagents', {
        getProvider: name => [local, external, fork].find(provider => provider.name === name),
        resolveMaxDepth: () => undefined,
        rootOf: agent => agent,
        async startActivation(spec) { starts.push(spec); return { name: 'fixture-delegate' }; },
      });
      scope.provide('llm', {
        listProviders: () => [{ id: 'p' }, { id: 'q' }],
        listModels: async provider => [hard, routine, unlisted].filter(route => route.provider === provider)
          .map(route => ({ provider, id: route.model })),
        resolveModelInfo: async (provider, id) => ({ provider, id, reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] } }),
        async resolveCallConfig(selection) { nativeChecks.push(selection); return selection; },
      });
      scope.provide('approval', { async request(request) { approvals.push(request); return approvalReply; } });
      scope.on('tools/pre-execute', (exec, next) => {
        if (hostDenies && exec.name === 'subagent') return { kind: 'deny', reason: 'Fixture Host policy denied delegation' };
        return next();
      });
      scope.provide('sessionPersistence', { stat(id) {
        stats.push(id);
        if (id === fresh.id || id === old.id) return { header: { id } };
        if (id === 'fixture-child') return { header: { id, origin: 'subagent' } };
      } });
    },
  });
  const toolConfig = { modelSelection: true, modelDiscovery: true, maxDepth: 'provider-managed' };
  const mountNative = config => mount(native, config, preset.ctx);
  const nativeFiber = await mountNative({ provider: 'fixture-local', ...toolConfig });
  const shared = host.connection.createSharedFetchHandler('/api');
  const owner = { principal: { kind: 'owner' } };
  const remote = { principal: { kind: 'api' } };
  const modeURL = `https://fixture.invalid${SESSION_MODE_PATH}`;
  const get = (id = fresh.id, peer = owner) => shared.fetch(new Request(`${modeURL}?sessionId=${id}`), peer);
  const post = (mode, revision, peer = owner) => shared.fetch(new Request(modeURL, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: fresh.id, mode, revision }),
  }), peer);
  const domainName = 'smarter_subagent_modes';
  try {
    await eventually(async () => (await get()).status === 200, 'owner-only Fetch route did not activate after domain open');
  } catch (error) {
    const response = await get();
    assert.fail(`${error.message}; storage opens=${backend.opens.length}, router=${!!host.tools.get('delegate_by_difficulty')}, response=${response.status} ${await response.text()}`);
  }
  assert.equal(backend.opens.length, 1);
  assert.equal(backend.opens[0].name, domainName);
  const domain = host.storageDomain.get(domainName);
  assert.ok(domain);
  assert.deepEqual(await (await get()).json(), { mode: 'normal', revision: 0, prayerEnabled: false, riceEnabled: true, writable: true });
  assert.equal((await get('fixture-child')).status, 403);
  const statsBeforeRemote = stats.length;
  assert.equal((await get(fresh.id, remote)).status, 403);
  assert.equal((await post('rice', 0, remote)).status, 403);
  assert.equal(stats.length, statsBeforeRemote);
  assert.deepEqual(backend.writes, []);
  await unmount(settings);
  assert.equal(settingsCalls.size, 0);

  async function step(agent, observe = true) {
    const context = agents.assembleContextFor(agent, new AbortController().signal);
    const toolSet = await host.tools.resolve(context);
    t.after(() => toolSet.dispose());
    const assembly = observe ? await host.systemPrompt.assemble({ ...context, toolSet }) : undefined;
    return { ...context, toolSet, assembly };
  }
  const advice = ({ assembly }) => assembly.sections.find(section => section.name === adviceToken)?.text;
  let call = 0;
  async function execute(context, selection, name = 'subagent') {
    const id = `fixture-tool-${++call}`;
    const result = await host.tools.execute({
      agent: context.agent, signal: context.signal, toolSet: context.toolSet,
      calls: [{ id, name, arguments: JSON.stringify({ description: 'Fixture authorized local delegation', prompt: 'No model or child runs.', ...selection }) }],
    });
    return { id, result: result.results[0].result };
  }

  const routerName = 'delegate_by_difficulty';
  const observed = await step(fresh);
  const routed = (step, difficulty, extra = {}) => execute(step, { difficulty, target: 'subagent', ...extra }, routerName);
  assert.match(observed.assembly.sections.find(section => section.name === 'tool:subagent')?.text,
    /^Start independent delegations with `subagent` together/);
  const nativeTool = host.tools.executable('subagent', fresh, observed.toolSet);
  assert.equal(host.tools.get('subagent'), undefined, 'native registration must not leak out of the preset');
  assert.equal(host.tools.get('subagent', presetKey), nativeTool);
  assert.equal(host.tools.get('subagent', fresh), nativeTool);
  assert.equal(nativeTool.output.schema.properties.kind.const, 'activation');
  assert.ok(host.tools.executable(routerName, fresh, observed.toolSet));
  assert.match(advice(observed), /delegate_by_difficulty/);
  assert.ok(!advice(observed).includes('unlisted'));
  assert.ok(prompt.renderPrompt(observed.assembly).includes(advice(observed)));

  // 内容相同不等于原生注册：真实原生指令必须拒绝为同名的 Agent 层覆盖提供证明。
  const lookalike = { ...nativeTool, async execute() { return { kind: 'activation', name: 'fixture-lookalike' }; } };
  await mount({ inject: ['tools'], apply: scope => { scope.tools.register(lookalike); } }, undefined, shadow.ctx);
  const shadowStep = await step(shadow);
  assert.equal(host.tools.executable('subagent', shadow, shadowStep.toolSet), lookalike);
  assert.equal(host.tools.executable('subagent', fresh, shadowStep.toolSet), undefined);
  assert.equal(shadowStep.assembly.sections.find(section => section.name === 'tool:subagent')?.text ?? '', '');
  assert.equal(advice(shadowStep), undefined);
  assert.match((await routed(shadowStep, 'hard')).result.error?.message, /No verified, authorized native local delegation target/);
  const shadowCall = await execute(shadowStep, hard);
  assert.equal(shadowCall.result.isError, false);
  assert.match(shadowCall.result.content[0].text, /fixture-lookalike/);
  assert.deepEqual(approvals, []);
  assert.deepEqual(nativeChecks, []);
  assert.deepEqual(starts, []);

  const legacy = await step(old);
  assert.equal(advice(legacy), undefined);
  assert.equal(host.tools.executable(routerName, old, legacy.toolSet), undefined);
  assert.equal((await execute(legacy, {})).result.isError, false);
  starts.length = 0;

  // 真实原生提示证明工具归属后，省略或显式传入路线均不能绕过分类。
  for (const args of [{}, hard, routine]) assert.match((await execute(observed, args)).result.error?.message, /delegate_by_difficulty/);
  assert.deepEqual(starts, []);
  assert.equal((await execute(observed, { target: 'subagent' }, routerName)).result.isError, true);
  hostDenies = true;
  assert.match((await routed(observed, 'simple')).result.error?.message, /Fixture Host policy denied delegation/);
  assert.deepEqual(approvals, []);
  assert.deepEqual(nativeChecks, []);
  assert.deepEqual(starts, []);
  hostDenies = false;
  const simple = await routed(observed, 'simple');
  assert.equal(simple.result.isError, false, JSON.stringify(simple.result));
  assert.deepEqual(nativeChecks.at(-1), routine);
  assert.deepEqual(starts.at(-1).agentOptions, { ...routine, reasoningEffort: undefined });
  const first = await routed(observed, 'hard');
  assert.equal(first.result.isError, false, JSON.stringify(first.result));
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].agent, fresh);
  assert.deepEqual(starts.at(-1).agentOptions, { ...hard, reasoningEffort: undefined });

  approvalReply = 'denied';
  const denied = await routed(observed, 'hard');
  assert.match(denied.result.error?.message, /approval did not grant permission/i);
  assert.equal(approvals.length, 2);
  assert.equal(starts.length, 2);

  assert.equal((await post('prayer', 0)).status, 409);
  assert.equal((await post('rice', 0)).status, 200);
  assert.deepEqual(domain.table('modes').get(fresh.id), { mode: 'rice', revision: 1 });
  assert.deepEqual(backend.writes, [{ table: 'modes', key: fresh.id, record: { mode: 'rice', revision: 1 } }]);
  assert.equal((await post('normal', 0)).status, 409);
  const rice = await step(fresh);
  const riceHard = await routed(rice, 'hard');
  assert.equal(riceHard.result.isError, false, JSON.stringify(riceHard.result));
  assert.deepEqual(starts.at(-1).agentOptions, { ...routine, reasoningEffort: undefined });
  assert.equal(approvals.length, 2);
  assert.equal(starts.length, 3);

  await unmount(nativeFiber);
  assert.equal(advice(await step(fresh)), undefined);
  assert.equal(host.tools.executable('subagent', fresh, rice.toolSet), undefined);
  const externalFiber = await mountNative({ provider: 'fixture-external', ...toolConfig });
  const externalStep = await step(fresh);
  assert.match(externalStep.assembly.sections.find(section => section.name === 'tool:subagent')?.text,
    /^Start independent delegations with `subagent` together/);
  assert.equal(advice(externalStep), undefined);
  assert.equal(host.tools.executable(routerName, fresh, externalStep.toolSet), undefined);
  assert.equal((await execute(externalStep, hard)).result.isError, false);
  assert.equal(starts.at(-1).provider, 'fixture-external');
  assert.equal(approvals.length, 2);
  await unmount(externalFiber);
  await mountNative({ provider: 'fixture-local', ...toolConfig });
  const beforeDispose = await step(fresh);
  assert.ok(host.tools.executable(routerName, fresh, beforeDispose.toolSet));
  const ownerNative = host.tools.executable('subagent', fresh, beforeDispose.toolSet);
  await unmount(extension);
  assert.equal((await get()).status, 404);
  assert.equal(host.storageDomain.get(domainName), undefined);
  assert.equal(backend.closes, 1);
  assert.equal(advice(await step(fresh)), undefined);
  assert.equal(host.tools.executable('subagent', fresh, beforeDispose.toolSet), ownerNative);
  assert.equal((await execute(beforeDispose, hard)).result.isError, false);
  assert.equal(approvals.length, 2);

  const restored = await mount(entry, { ...config, prayerEnabled: true });
  await eventually(async () => (await get()).status === 200, 'Fetch route did not re-register after reload');
  assert.deepEqual(await (await get()).json(), { mode: 'rice', revision: 1, prayerEnabled: true, riceEnabled: true, writable: true });
  assert.equal((await (await get(old.id)).json()).prayerEnabled, false);
  assert.equal(backend.opens.length, 2);
  assert.equal(backend.writes.length, 1);
  const blockedByRice = await post('prayer', 1);
  assert.equal(blockedByRice.status, 409);
  assert.deepEqual(await blockedByRice.json(), { error: 'prayer_unavailable' });
  assert.equal((await post('normal', 1)).status, 200);
  const quiet = await step(fresh);
  assert.equal((await routed(quiet, 'hard')).result.isError, true);
  assert.equal((await post('prayer', 2)).status, 200);
  assert.deepEqual(backend.writes.at(-1), { table: 'modes', key: fresh.id, record: { mode: 'prayer', revision: 3 } });
  const prayer = await step(fresh);
  assert.match(advice(prayer), /delegate_by_difficulty/);
  assert.doesNotMatch(advice(prayer), /`wait_agent`/); // 本步骤未准入此工具。
  hostDenies = true;
  assert.match((await routed(prayer, 'hard')).result.error?.message, /Fixture Host policy denied delegation/);
  hostDenies = false;
  assert.match((await execute(prayer, unlisted)).result.error?.message, /delegate_by_difficulty/);
  const prayed = await routed(prayer, 'hard');
  assert.equal(prayed.result.isError, false, JSON.stringify(prayed.result));
  assert.deepEqual(starts.at(-1).agentOptions, { ...hard, reasoningEffort: 'high' });
  assert.equal(approvals.length, 2); // 只免扩展的一次附加授权，不能绕过 Host 策略或原生准入。
  const fork = await mountNative({ ...toolConfig, provider: 'fixture-fork', toolName: 'subagent_fork', modelDiscovery: false });
  const forkStep = await step(fresh);
  assert.match((await execute(forkStep, {}, 'subagent_fork')).result.error?.message, /delegate_by_difficulty/);
  const forked = await routed(forkStep, 'simple', { target: 'subagent_fork', name: 'fork-probe', cwd: 'relative' });
  assert.equal(forked.result.isError, false, JSON.stringify(forked.result));
  assert.equal(starts.at(-1).provider, 'fixture-fork');
  assert.equal(starts.at(-1).name, 'fork-probe');
  assert.equal(starts.at(-1).cwd, 'relative');
  assert.deepEqual(starts.at(-1).agentOptions, { ...routine, reasoningEffort: undefined });
  await unmount(fork);
  const defaultFork = await mountNative({ provider: 'fixture-fork', toolName: 'subagent_fork', maxDepth: 'provider-managed' });
  const defaultForkStep = await step(fresh);
  const unsupportedFork = await routed(defaultForkStep, 'simple', { target: 'subagent_fork' });
  assert.match(unsupportedFork.result.error?.message, /No verified, authorized native local delegation target/);
  assert.equal((await execute(defaultForkStep, {}, 'subagent_fork')).result.isError, false);
  assert.equal(starts.at(-1).provider, 'fixture-fork');
  assert.equal(starts.at(-1).agentOptions, undefined);
  await unmount(defaultFork);

  // 裸 Cordis 会重建作用域；按新的域句柄断言，不能误读已关闭的旧实例。
  assert.equal((await post('rice', 3)).status, 200);
  const modesTable = () => host.storageDomain.get(domainName)?.table('modes');
  await modesTable().put('archived-root', { mode: 'rice', revision: 8 });
  await modesTable().put('praying-root', { mode: 'prayer', revision: 5 });
  await restored.update({ ...config, prayerEnabled: true, riceEnabled: false }, true);
  host.emit('settings/document-updated', entry.name, 1);
  await eventually(() => modesTable()?.get('archived-root')?.mode === 'normal', 'disabling Frugal did not clear saved Rice');
  await eventually(async () => (await get()).status === 200, 'owner route unavailable after Frugal setting change');
  assert.deepEqual(modesTable().get('archived-root'), { mode: 'normal', revision: 9 });
  assert.deepEqual(modesTable().get('praying-root'), { mode: 'prayer', revision: 5 });
  assert.deepEqual(await (await get()).json(), { mode: 'normal', revision: 5, prayerEnabled: true, riceEnabled: false, writable: true });
  assert.deepEqual(await (await post('rice', 5)).json(), { error: 'rice_unavailable' });
  const disabled = await step(fresh);
  assert.match(advice(disabled), /Delegation mode: normal/);
  assert.equal((await routed(disabled, 'hard')).result.isError, true);
  await restored.update({ ...config, prayerEnabled: true, riceEnabled: true }, true);
  host.emit('settings/document-updated', entry.name, 2);
  await eventually(async () => (await get()).status === 200, 'owner route unavailable after Frugal re-enable');
  assert.deepEqual(await (await get()).json(), { mode: 'normal', revision: 5, prayerEnabled: true, riceEnabled: true, writable: true });
  assert.equal(fresh.session.seq, 1);
  assert.equal(old.session.seq, 0);
  await unmount(restored);
  assert.equal(backend.closes, backend.opens.length);
});
