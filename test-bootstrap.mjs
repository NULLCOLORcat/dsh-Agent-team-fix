// 入口烟测：不启动用户 profile；依赖未安装时只替换 Schemastery，Electron 可复用 rc.5 的真实包。
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

const schemaName = '@deepseek-ai/schemastery';
const installedPackage = (name, file = 'index.js') =>
  pathToFileURL(join(process.env.DSH_INSTALL_DIR, 'node_modules', '@deepseek-ai', name, 'lib', file)).href;
const installedSchema = process.versions.electron && process.env.DSH_INSTALL_DIR
  ? installedPackage('schemastery', 'index.mjs') : undefined;
const fakeSchema = 'data:text/javascript,' + encodeURIComponent(`
  const fluent = new Proxy({}, { get: () => () => fluent });
  export default { object: dict => ({ dict }), string: () => fluent, array: () => fluent };
`);

async function loadEntry() {
  let schemaUrl = installedSchema;
  if (schemaUrl === undefined) {
    try { schemaUrl = import.meta.resolve(schemaName); }
    catch { schemaUrl = fakeSchema; }
  }
  const hook = registerHooks({ resolve(specifier, context, next) {
    if (specifier === schemaName) return { shortCircuit: true, url: schemaUrl };
    if (specifier.startsWith('@deepseek-ai/') && context.parentURL?.startsWith(new URL('./', import.meta.url).href)) {
      assert.fail(`unexpected Host import from extension: ${specifier}`);
    }
    return next(specifier, context);
  } });
  try { return await import('./index.js'); }
  finally { hook.deregister(); }
}

const entry = await loadEntry();
const adviceServices = ['systemPrompt', 'sessionProjections', 'tools'];
const fail = () => { throw new Error('fixture private diagnostic'); };

function host() {
  const waiting = [];
  let setting;
  let fact;
  const fiber = Object.freeze({});
  const ctx = Object.freeze({ fiber, inject(keys, mount) { waiting.push({ keys, mount }); } });
  const settingsScope = Object.freeze({
    settings: Object.freeze({ configure(options, owner) { assert.equal(owner, fiber); setting = options; return () => { setting = undefined; }; } }),
    effect(make) { return make(); },
  });
  const adviceScope = Object.freeze({ systemPrompt: Object.freeze({ context(value) { fact = value; } }) });
  return { ctx, waiting, settingsScope, adviceScope, setting: () => setting, fact: () => fact };
}

test('Host entry exports one setting and mounts settings/advice independently without routing actions', () => {
  assert.equal(entry.name, 'team-terra-ultra');
  assert.deepEqual(Object.keys(entry.Config.dict), ['smartModels']);
  const f = host();
  assert.doesNotThrow(() => entry.apply(f.ctx, Object.freeze({ smartModels: [] })));
  assert.deepEqual(f.waiting.map(({ keys }) => keys), [['settings'], adviceServices]);
  assert.equal(f.setting(), undefined);
  assert.equal(f.fact(), undefined);

  f.waiting[1].mount(f.adviceScope);
  assert.equal(f.fact().name, 'team-terra-ultra:difficulty-candidates');
  assert.equal(f.fact().text({}), '');
  assert.equal(f.setting(), undefined);
  f.waiting[0].mount(f.settingsScope);
  assert.deepEqual(f.setting(), { auto: false });
});

test('Host entry tolerates missing injection, missing services and failing context/settings registration', () => {
  assert.doesNotThrow(() => entry.apply(Object.freeze({}), {}));
  assert.doesNotThrow(() => entry.apply(Object.freeze({ inject: fail }), {}));
  const f = host();
  entry.apply(f.ctx, {});
  assert.doesNotThrow(() => f.waiting[0].mount({ effect(make) { make(); }, settings: { configure: fail } }));
  assert.doesNotThrow(() => f.waiting[1].mount({ systemPrompt: { context: fail } }));
  assert.doesNotThrow(() => f.waiting[1].mount({}));
  assert.equal(f.setting(), undefined);
  assert.equal(f.fact(), undefined);
  f.waiting[1].mount(f.adviceScope);
  assert.equal(f.fact().name, 'team-terra-ultra:difficulty-candidates');
});

test('real Schemastery normalizes new, existing and old configs without writing legacy keys', {
  skip: entry.Config['~standard'] === undefined ? 'Schemastery not installed' : false,
}, () => {
  const route = Object.freeze({ provider: 'p', model: 'm' });
  const oldConfig = Object.freeze({
    allowedModels: 'obsolete even if invalid', defaultModel: null, defaultReasoningEffort: 314,
    fallbackToCurrentModel: true, smartModels: Object.freeze([route]),
  });
  const { validate } = entry.Config['~standard'];
  const legacy = validate(oldConfig);
  assert.equal(legacy.issues, undefined);
  assert.deepEqual(legacy.value.smartModels.get(), [route]);
  assert.deepEqual(oldConfig.smartModels, [route]);
  assert.equal(oldConfig.allowedModels, 'obsolete even if invalid');
  assert.deepEqual(validate({ fallbackToCurrentModel: true }).value.smartModels.get(), []);
  assert.deepEqual(validate({}).value.smartModels.get(), []);
  assert.ok(validate({ smartModels: [{ provider: 'p' }] }).issues?.length);
});

test('installed rc.5 Host: native projection and tools coexist with one disposable advice contribution', {
  skip: installedSchema === undefined ? 'installed Electron runtime not in use' : false,
}, async t => {
  const [{ Context }, projection, prompt, tools, { Session }, native, executor, { assembleContextFor }] = await Promise.all([
    'cordis', 'dsh-session-projection', 'dsh-system-prompt', 'dsh-tools', 'dsh-session', 'dsh-tool-subagent', 'dsh-tool-executor-native', 'dsh-agent',
  ].map(name => import(installedPackage(name))));
  const host = new Context();
  const fibers = [];
  t.after(async () => {
    for (const fiber of fibers.reverse()) await fiber.dispose();
  });
  async function mount(plugin, config) {
    const fiber = host.plugin(plugin, config);
    fibers.push(fiber);
    await fiber;
    return fiber;
  }

  const advisory = await mount(entry, { smartModels: [{ provider: 'p', model: 'strong' }, { provider: 'p', model: 'unlisted' }] });
  await mount(projection.default);
  await mount(prompt.default, {});
  await mount(tools.default);
  await mount(executor);
  // Only the backend is a fixture; the official plugin owns the real tool and projection registration.
  await mount(scope => {
    const provider = { name: 'fixture', capabilities: { agentOptions: true } };
    scope.provide('subagents', { getProvider: name => name === provider.name ? provider : undefined, resolveMaxDepth: () => undefined });
  });
  const nativeFiber = await mount(native, { provider: 'fixture', modelSelection: true, modelDiscovery: true });
  const token = 'team-terra-ultra:difficulty-candidates';
  const fresh = { session: Session.create('fixture-fresh') };
  const old = { session: Session.create('fixture-old') };
  fresh.session.append('subagent/model-selection-policy', { allowedModels: [
    { provider: 'p', model: 'strong' }, { provider: 'q', model: 'strong' },
  ] });
  async function assembly(a) {
    const context = assembleContextFor(a, new AbortController().signal);
    assert.equal(context.scope, a);
    const toolSet = await host.tools.resolve(context);
    try { return await host.systemPrompt.assemble({ ...context, toolSet }); }
    finally { toolSet.dispose(); }
  }
  const text = result => prompt.renderContextSections(result).find(section => section.name === token)?.text;
  const freshAssembly = await assembly(fresh);
  const advice = text(freshAssembly);
  assert.match(advice, /user-designated candidates: \[{"provider":"p","model":"strong"}\]/);
  assert.match(advice, /remaining authorized candidates: \[{"provider":"q","model":"strong"}\]/);
  assert.ok(!advice.includes('unlisted'));
  assert.equal(text(await assembly(old)), undefined);
  assert.equal(text(host.systemPrompt.refreshContext(freshAssembly, assembleContextFor(fresh))), advice);
  const nativeBefore = host.tools.executable('subagent', fresh);
  assert.equal(typeof nativeBefore?.execute, 'function');
  assert.ok(host.tools.executable('list_subagent_models', fresh));
  assert.equal(fresh.session.seq, 1);
  assert.equal(old.session.seq, 0);

  await nativeFiber.dispose();
  assert.equal(text(await assembly(fresh)), undefined);
  await mount(native, { provider: 'fixture', modelSelection: true, modelDiscovery: true });
  assert.match(text(await assembly(fresh)), /user-designated candidates/);
  const nativeAfter = host.tools.executable('subagent', fresh);
  await advisory.dispose();
  assert.equal(text(await assembly(fresh)), undefined);
  assert.equal(host.tools.executable('subagent', fresh), nativeAfter);
  assert.equal(fresh.session.seq, 1);
});
