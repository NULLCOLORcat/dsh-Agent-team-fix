import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_POLICY, readPolicy, selectRoute, resolveRoute } from './routing.js';
import { installRouting } from './runtime.js';

const terra = { provider: 'openai-codex', model: 'gpt-6.1-terra' };
const luna = { provider: 'openai-codex', model: 'gpt-6-luna' };
const plain = { provider: 'other', model: 'plain' };
const multi = () => ({ allowedModels: [terra, luna, plain], defaultModel: terra, defaultReasoningEffort: 'ultra' });
const args = (name, extra = {}) => ({ name, description: 'test', prompt: 'test only', ...extra });
const selection = (model, effort) => ({ ...model, ...(effort === undefined ? {} : { reasoningEffort: effort }) });
const metadata = (provider, model) => {
  if (model === 'missing') throw new Error('Provider model unavailable');
  return { provider, id: model, name: model, ...(model === 'plain' ? {} : { reasoning: {
    efforts: (model === terra.model ? ['low', 'ultra'] : ['low', 'high']).map((id) => ({ id, name: id })),
    defaultEffort: 'low',
  } }) };
};
function harness(initial = multi()) {
  let current = initial;
  const events = new Map(); const tools = new Map(); const selections = new WeakMap();
  const roots = new WeakMap(); const enabled = new WeakSet(); const agents = new Map();
  const addRoot = (id, on) => {
    const agent = { id, session: { header: { id, origin: 'user' } } };
    agents.set(id, agent); roots.set(agent, agent);
    if (on) enabled.add(agent);
    return agent;
  };
  const lead = addRoot('lead', true);
  const otherLead = addRoot('other-lead', true);
  const regular = addRoot('regular', false);
  const calls = []; const created = []; const prepared = []; const warnings = [];
  let nextId = 0;
  const llm = {
    resolveModelInfo: async (provider, model) => metadata(provider, model),
    resolveCallConfig: async (route) => {
      const info = metadata(route.provider, route.model);
      const effort = route.reasoningEffort ?? info.reasoning?.defaultEffort;
      if (effort && !info.reasoning?.efforts.some((item) => item.id === effort)) throw new Error('Unsupported effort');
      return selection(route, effort);
    },
  };
  async function create(parent, name, context = 'fresh', history = false, signal) {
    const id = `child-${++nextId}`;
    const agent = { id, name, session: { header: { id, origin: 'subagent', parentSession: parent.id },
      inheritedEventCount: context === 'fork' ? 100 : 0 }, model: { select: (route) => selections.set(agent, route) } };
    // 原生子代理偏好可能不同于主窗口；记录其初值以区分主动绑定和偶然继承。
    if (native.preference && !history) selections.set(agent, { ...native.preference });
    // 模拟 rc.5 顺序：钩子执行时子 Agent 尚未加入 subagent 运行注册表。
    await Promise.resolve(); await Promise.resolve();
    await events.get('agent/created')({ agent, source: history ? 'resume' : 'startup', signal });
    roots.set(agent, roots.get(parent)); agents.set(id, agent); created.push(agent);
    return agent;
  }
  const native = { execute: async (request, exec) => {
    calls.push({ name: exec.name, args: request });
    if (!/^[a-z][a-z0-9-]*$/.test(request.name)) throw new Error('Invalid native teammate name');
    await create(exec.agent, request.name, exec.name === 'subagent_fork' ? 'fork' : 'fresh', false, exec.signal);
    return { kind: 'activation', name: request.name };
  } };
  const ctx = { llm, agents: { get: (id) => agents.get(id) },
    agentTeams: { isEnabled: (agent) => enabled.has(agent) }, subagents: { rootOf(agent) {
      if (!roots.has(agent)) throw Object.assign(new Error('agent has no active runtime owner'), { code: 'UNAUTHORIZED' });
      return roots.get(agent);
    } },
    logger: { warn: (message) => warnings.push(message) }, on: (event, fn) => events.set(event, fn),
    tools: {
      register: (definition, options) => tools.set(definition.name, { ...definition, when: options.when }),
      executable: (name, _agent, set) => ['subagent', 'subagent_fork'].includes(name) && (!set || set.has(name)) ? native : undefined,
    },
  };
  class MockPipeline {
    prepare(exec) {
      prepared.push(exec);
      return exec.toolSet?.deny ? { kind: 'final-result', exec, result: { isError: true, error: { message: 'denied by native guard' } } }
        : { kind: 'dispatch', exec };
    }
    async dispatch(exec) {
      const tool = ctx.tools.executable(exec.name, exec.agent, exec.toolSet);
      return { result: { value: await tool.execute(exec.arguments, exec) } };
    }
    complete(_exec, outcome) { return outcome.result; }
  }
  const config = Object.fromEntries(Object.keys(DEFAULT_POLICY).map((key) => [key, { get: () => current[key] }]));
  installRouting(ctx, config, MockPipeline);
  return { ctx, llm, events, tools, lead, otherLead, regular, enabled, selections, calls, created, create, native, prepared, warnings,
    setPolicy: (value) => { current = value; },
    invoke: (name, request, agent = lead, signal = new AbortController().signal, toolSet) => tools.get(name).execute(request,
      { agent, signal, toolSet, callId: 'outer', rootCallId: 'root', token: 'outer-token', deferContext() {} }),
    request: (agent, route) => events.get('agent/request')({ agent }, async () => route),
  };
}
const spawn = 'spawn_teammate_with_model';
const list = 'list_teammate_models';

test('policy defaults, volatile snapshots and malformed/duplicate/default rejection', () => {
  assert.deepEqual(readPolicy(), DEFAULT_POLICY);
  const original = multi(); const snapshot = readPolicy(original); original.allowedModels.length = 0;
  assert.equal(snapshot.allowedModels.length, 3);
  assert.throws(() => readPolicy({ ...multi(), allowedModels: [] }), /at least one/);
  assert.throws(() => readPolicy({ ...multi(), allowedModels: [terra, terra] }), /Duplicate/);
  assert.throws(() => readPolicy({ ...multi(), defaultModel: { provider: 'x', model: 'y' } }), /Default/);
  assert.throws(() => readPolicy({ ...multi(), allowedModels: [{ provider: '', model: 'x' }] }), /non-empty/);
});

test('single model exposes no selection tools; native fresh and fork fixed to Terra/Ultra', async () => {
  const h = harness(readPolicy());
  assert.equal(h.tools.get(spawn).when({ agent: h.lead }), false);
  assert.equal(h.tools.get(list).when({ agent: h.lead }), false);
  for (const context of ['fresh', 'fork']) {
    const agent = await h.create(h.lead, context, context);
    assert.deepEqual(h.selections.get(agent), selection(terra, 'ultra'));
  }
  await assert.rejects(h.invoke(spawn, args('blocked', luna)), /multiple/);
  assert.throws(() => selectRoute(readPolicy(), { reasoning_effort: 'low' }), /Single-model/);
});

test('new and reopened root sessions, ordinary subagents, and restored members are untouched', async () => {
  const h = harness();
  const created = h.events.get('agent/created');
  const resumed = await h.create(h.lead, 'resumed', 'fresh', true);
  const ordinary = await h.create(h.regular, 'ordinary');
  h.ctx.agents.get = () => assert.fail('root or resumed session must not query Team membership');
  await created({ agent: h.regular, source: 'startup' });
  await created({ agent: h.regular, source: 'resume' });
  await created({ agent: { session: { header: { origin: 'user', parentSession: h.lead.id } } }, source: 'startup' });
  await created({ agent: resumed, source: 'resume' });
  for (const agent of [h.lead, h.regular, resumed, ordinary]) assert.equal(h.selections.has(agent), false);
  await h.request(resumed, selection(luna, 'high'));
});

test('unsupported Host APIs leave the global conversation lifecycle unmodified', () => {
  let warning;
  installRouting({ agentTeams: {}, logger: { warn: (message) => { warning = message; } },
    on: () => assert.fail('must not install global hooks') }, undefined, undefined);
  assert.match(warning, /unsupported Team routing API/);
});

test('multi discovery returns whitelist/default and exact model effort metadata', async () => {
  const h = harness();
  assert.equal(h.tools.get(list).when({ agent: h.lead }), true);
  assert.deepEqual(JSON.parse(await h.invoke(list, {})).allowedModels, multi().allowedModels);
  const info = JSON.parse(await h.invoke(list, luna));
  assert.deepEqual(info.reasoningEfforts.map((item) => item.id), ['low', 'high']);
  await assert.rejects(h.invoke(list, { provider: 'other', model: 'forbidden' }), /not allowed/);
  await assert.rejects(h.invoke(list, { model: luna.model }), /together/);
});

test('multi explicit effort and configurable omitted default; native arguments/output preserved', async () => {
  const h = harness();
  const result = await h.invoke(spawn, args('chosen', { ...luna, context: 'fork', reasoning_effort: 'high' }));
  assert.deepEqual(h.selections.get(h.created[0]), selection(luna, 'high'));
  assert.deepEqual(result.selected_route, selection(luna, 'high'));
  assert.equal(result.kind, 'activation');
  assert.equal(result.name, 'chosen');
  assert.deepEqual(h.calls[0], { name: 'subagent_fork', args: args('chosen') });
  assert.equal(h.prepared[0].parent, 'outer-token');
  assert.equal(h.prepared[0].rootCallId, 'root');
  assert.equal(h.prepared[0].agent, h.lead);
  await h.invoke(spawn, args('default'));
  assert.deepEqual(h.selections.get(h.created[1]), selection(terra, 'ultra'));
  h.setPolicy({ ...multi(), defaultModel: luna, defaultReasoningEffort: 'high' });
  const direct = await h.create(h.lead, 'direct');
  assert.deepEqual(h.selections.get(direct), selection(luna, 'high'));
});

test('different model gets its own advertised default, non-reasoning model clears inherited effort', async () => {
  const h = harness();
  await h.invoke(spawn, args('different', luna));
  assert.deepEqual(h.selections.get(h.created[0]), selection(luna, 'low'));
  await h.invoke(spawn, args('plain', plain));
  assert.deepEqual(h.selections.get(h.created[1]), plain);
  h.setPolicy({ ...multi(), defaultReasoningEffort: '' });
  await h.invoke(spawn, args('empty-default'));
  assert.deepEqual(h.selections.get(h.created[2]), selection(terra, 'low'));
});

test('forbidden model, invalid effort, unavailable model and cancellation fail before native creation', async () => {
  const h = harness();
  await assert.rejects(h.invoke(spawn, args('forbidden', { provider: 'x', model: 'y' })), /not allowed/);
  await assert.rejects(h.invoke(spawn, args('bad-effort', { ...luna, reasoning_effort: 'ultra' })), /does not support/);
  await assert.rejects(h.invoke(spawn, args('empty-effort', { ...luna, reasoning_effort: '' })), /non-empty/);
  await assert.rejects(h.invoke(spawn, args('bad-plain', { ...plain, reasoning_effort: 'low' })), /does not support/);
  h.setPolicy({ ...multi(), allowedModels: [...multi().allowedModels, { provider: 'other', model: 'missing' }] });
  await assert.rejects(h.invoke(spawn, args('unavailable', { provider: 'other', model: 'missing' })), /unavailable/);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(h.invoke(spawn, args('cancelled'), h.lead, abort.signal), /abort/i);
  assert.equal(h.calls.length, 0);
});

test('non-lead cannot inspect/create even when calling stale tool directly', async () => {
  const h = harness(); const agent = await h.create(h.lead, 'member');
  assert.equal(h.tools.get(spawn).when({ agent }), false);
  assert.equal(h.tools.get(spawn).when({ agent: h.regular }), false);
  await assert.rejects(h.invoke(list, {}, agent), /Only the Lead/);
  await assert.rejects(h.invoke(spawn, args('bad'), agent), /Only the Lead/);
  await assert.rejects(h.invoke(spawn, args('not-team'), h.regular), /Only the Lead/);
  assert.equal(h.calls.length, 0);
});

test('concurrent fresh/fork creates and different Team roots never share routes', async () => {
  const h = harness();
  const results = await Promise.all([
    h.invoke(spawn, args('same-name', { ...luna, reasoning_effort: 'high' })),
    h.invoke(spawn, args('same-name', { ...plain, context: 'fork' }), h.otherLead),
    h.invoke(spawn, args('default')),
  ]);
  assert.deepEqual(results.map((result) => result.selected_route), [selection(luna, 'high'), plain, selection(terra, 'ultra')]);
  assert.deepEqual(h.created.map((agent) => h.selections.get(agent)), results.map((result) => result.selected_route));
});

test('request guard rejects later override and settings changes do not reroute existing members', async () => {
  const h = harness(); await h.invoke(spawn, args('stable', { ...luna, reasoning_effort: 'high' }));
  const agent = h.created[0]; const expected = selection(luna, 'high');
  h.setPolicy(readPolicy());
  assert.deepEqual(await h.request(agent, expected), expected);
  await assert.rejects(h.request(agent, selection(terra, 'ultra')), /overridden/);
  await assert.rejects(h.request(agent, selection(luna, 'low')), /overridden/);
  assert.equal(h.tools.get(spawn).when({ agent: h.lead }), false);
});

test('native validation remains authoritative; missing native tool and missing route binding refuse', async () => {
  const h = harness();
  await assert.rejects(h.invoke(spawn, args('invalid name')), /Invalid native/);
  await assert.rejects(h.invoke(spawn, args('invalid-context', { context: 'other' })), /Native delegation tool is not admitted/);
  await assert.rejects(h.invoke(spawn, args('no-native'), h.lead, undefined, new Set()), /Native subagent tool is not admitted/);
  h.native.execute = async () => ({ kind: 'activation', name: 'no-binding' });
  await assert.rejects(h.invoke(spawn, args('no-binding')), /did not bind/);
});

test('native pipeline denial is propagated without delegation', async () => {
  const h = harness();
  const toolSet = Object.assign(new Set(['subagent']), { deny: true });
  await assert.rejects(h.invoke(spawn, args('guarded'), h.lead, undefined, toolSet), /denied by native guard/);
  assert.equal(h.prepared[0].toolSet, toolSet);
  assert.equal(h.calls.length, 0);
  assert.equal(h.created.length, 0);
});

const hard = 'spawn_hard_teammate';

test('migration keeps daily settings; hard policy copies, validates and defaults to opt-out', () => {
  const old = multi(); const policy = readPolicy(old);
  assert.deepEqual(policy, { ...old, smartModels: [], fallbackToCurrentModel: false });
  const source = { ...old, smartModels: [{ ...luna }] };
  const snapshot = readPolicy(source); source.smartModels[0].model = 'changed';
  assert.deepEqual(snapshot.smartModels, [luna]);
  for (const invalid of [null, {}, [luna, luna], [{ model: 'orphan' }]]) assert.throws(() => readPolicy({ ...old, smartModels: invalid }));
  for (const invalid of ['false', 1, null]) assert.throws(() => readPolicy({ ...old, fallbackToCurrentModel: invalid }), /boolean/);
});

test('one daily model: discovery and explicit smart choice work without widening daily policy', async () => {
  const h = harness({ ...readPolicy(), smartModels: [luna, plain] });
  assert.equal(h.tools.get(hard).when({ agent: h.lead }), true);
  assert.equal(h.tools.get(list).when({ agent: h.lead }), true);
  assert.equal(h.tools.get(spawn).when({ agent: h.lead }), false);
  const guide = JSON.parse(await h.invoke(list, {}));
  assert.deepEqual(guide.smartModels, [luna, plain]);
  assert.match(guide.hardTaskGuidance, /unresolved.*quota/);
  assert.deepEqual(JSON.parse(await h.invoke(list, luna)).reasoningEfforts.map(e => e.id), ['low', 'high']);
  await assert.rejects(h.invoke(hard, args('unspecified')), /provider and model/);
  await assert.rejects(h.invoke(hard, args('daily', terra)), /not in smartModels/);
  await assert.rejects(h.invoke(hard, args('effort', { ...plain, reasoning_effort: 'high' })), /does not support/);
  assert.equal(h.created.length, 0);
  const jobs = await Promise.all([h.invoke(hard, args('smart', { ...luna, reasoning_effort: 'high' })),
    h.invoke(hard, args('fork', { ...plain, context: 'fork' })), h.invoke(hard, args('default-effort', luna))]);
  assert.deepEqual(jobs.map(job => job.selected_route), [selection(luna, 'high'), plain, selection(luna, 'low')]);
  for (const job of jobs) assert.deepEqual(h.selections.get(h.created.find(a => a.name === job.name)), job.selected_route);
  const member = await h.create(h.lead, 'native');
  assert.deepEqual(h.selections.get(member), selection(terra, 'ultra'));
  assert.equal(h.tools.get(hard).when({ agent: member }), false);
  await assert.rejects(h.invoke(hard, args('stale', luna), member), /Only the Lead/);
  h.setPolicy(multi());
  assert.equal(h.tools.get(hard).when({ agent: h.lead }), false);
  await assert.rejects(h.invoke(hard, args('disabled', luna)), /disabled/);
});

test('fallback outranks smart and native preferences; binds each root snapshot for fresh/fork', async () => {
  const h = harness({ ...readPolicy(), smartModels: [terra], fallbackToCurrentModel: true });
  h.native.preference = selection(terra, 'ultra');
  const current = selection(luna, 'high');
  h.lead.model = { current: () => current }; h.otherLead.model = { current: () => plain };
  const jobs = [h.invoke(hard, args('fresh', { ...terra, reasoning_effort: 'ultra' })),
    h.invoke(hard, args('fork', { context: 'fork' }), h.otherLead)];
  current.reasoningEffort = 'low';
  assert.deepEqual((await Promise.all(jobs)).map(job => job.selected_route), [selection(luna, 'high'), plain]);
  for (const child of h.created) {
    const expected = child.name === 'fresh' ? selection(luna, 'high') : plain;
    assert.deepEqual(h.selections.get(child), expected);
    await assert.rejects(h.request(child, h.native.preference), /overridden/);
  }
  assert.deepEqual(h.calls.map(call => call.args), [args('fresh'), args('fork')]);
  assert.equal(h.selections.has(await h.create(h.lead, 'resume', 'fork', true)), false);
  h.setPolicy({ ...readPolicy(), fallbackToCurrentModel: true });
  assert.equal(h.tools.get(hard).when({ agent: h.lead }), true);
  assert.deepEqual((await h.invoke(hard, args('fallback-only'))).selected_route, selection(luna, 'low'));
  h.lead.model = { current: () => undefined };
  await assert.rejects(h.invoke(hard, args('no-current')), /Current main-window model/);
});

test('hard route obeys native admission, guard denial, cancellation and binding checks', async () => {
  const h = harness({ ...multi(), smartModels: [plain] });
  await assert.rejects(h.invoke(hard, args('no-fork', { ...plain, context: 'fork' }), h.lead, undefined, new Set(['subagent'])), /not admitted/);
  await assert.rejects(h.invoke(hard, args('denied', plain), h.lead, undefined, Object.assign(new Set(['subagent']), { deny: true })), /denied by native guard/);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(h.invoke(hard, args('abort', plain), h.lead, abort.signal), /abort/i);
  assert.equal(h.calls.length, 0);
  h.native.execute = async () => ({ name: 'missing' });
  await assert.rejects(h.invoke(hard, args('missing', plain)), /did not bind/);
});

test('resolved-route mismatch refuses silent provider/model or effort fallback', async () => {
  await assert.rejects(resolveRoute({ resolveModelInfo: async () => ({ id: 'wrong' }) }, terra), /different/);
  const info = async () => metadata(terra.provider, terra.model);
  await assert.rejects(resolveRoute({ resolveModelInfo: info, resolveCallConfig: async () => luna }, terra), /changed.*route/);
  await assert.rejects(resolveRoute({ resolveModelInfo: info, resolveCallConfig: async () => selection(terra, 'low') }, selection(terra, 'ultra')), /changed.*effort/);
});
