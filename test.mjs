import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifiedGroups, effortIds, groupRoutes } from './routing.js';
import { installAdvice, installModeRuntime } from './runtime.js';

const hard = Object.freeze({ provider: 'p-one', model: 'hard-route' });
const routine = Object.freeze({ provider: 'p-two', model: 'routine-route' });
const secondRoutine = Object.freeze({ provider: 'p-one', model: 'second-routine-route' });
const hidden = Object.freeze({ provider: 'p-one', model: 'private-unapproved-model' });
const unavailable = Object.freeze({ provider: 'p-one', model: 'uncatalogued-route' });
const policyKey = 'subagentModelSelectionPolicy';
const routerName = 'delegate_by_difficulty';
const nativePolicy = Object.freeze([unavailable, routine, secondRoutine, hard]);
const hardMax = { ...hard, reasoningEffort: 'adapter-specific-max' };
const baseline = { ...routine, reasoningEffort: 'small' };
const context = Object.freeze({ role: 'user', source: 'unit-native', content: [{ type: 'text', text: 'Native context' }] });
const standardTask = { description: 'Do a focused task', prompt: 'A specific task' };

function nativeDefinition(name, dispatches, local = true, modelCapable = true) {
  return Object.freeze({
    name,
    description: local ? 'Native. Use `send_message` to steer it while running or continue its conversation after it finishes.' : 'This backend does not accept follow-up messages.',
    parameters: {
      required: ['description', 'prompt'],
      properties: Object.fromEntries(['name', 'cwd', 'description', 'prompt', ...(modelCapable ? ['provider', 'model', 'reasoning_effort'] : [])].map(key => [key, { type: 'string' }])),
    },
    output: { schema: { properties: { kind: { const: 'activation' } } },
      render: () => [{ type: 'text', text: 'native activation' }] },
    async execute(args, exec) {
      dispatches.push([args, exec]);
      if (exec.parent) { exec.deferContext(context); exec.concludeTurn(); }
      return { kind: 'activation', name: args.name ?? 'agent-1' };
    },
  });
}

function fixture({ mode = 'normal', prayerEnabled = true, strictDifficulty = false, approvals = 'allowed-once' } = {}) {
  const listeners = new Map();
  const guards = [];
  const registrations = new Map();
  const approvalsSeen = [];
  const selections = [];
  const writes = [];
  const reads = [];
  const records = new Map();
  const agents = new Map();
  const owners = new Map();
  const policy = new Map();
  const dispatches = [];
  const observed = [];
  const hooks = {};
  const visible = new Map([['subagent', nativeDefinition('subagent', dispatches)],
    ['subagent_fork', nativeDefinition('subagent_fork', dispatches)], ['wait_agent', {}]]);
  const config = { prayerEnabled, strictDifficulty, smartModels: [hidden, unavailable, hard] };
  const catalog = new Map([
    [hard.model, { provider: hard.provider, id: hard.model, reasoning: { efforts: [{ id: 'high' }, { id: hardMax.reasoningEffort }] } }],
    [routine.model, { provider: routine.provider, id: routine.model, reasoning: { efforts: [{ id: 'small' }] } }],
    [secondRoutine.model, { provider: secondRoutine.provider, id: secondRoutine.model }],
    [hidden.model, { provider: hidden.provider, id: hidden.model }],
  ]);
  let state = { mode, revision: 0 };
  let approvalOutcome = approvals;
  let dispose;
  const modes = {
    available: true,
    peek: () => state,
    read: async () => state,
    readMark: async id => { reads.push(id); return records.get(id) ?? null; },
    writeMark: async (id, data) => {
      writes.push([id, data]);
      if (data === null) records.delete(id); else records.set(id, structuredClone(data));
    },
  };
  const ctx = {
    on(name, callback) { listeners.set(name, callback); },
    effect(callback) { dispose = callback(); },
    get(name) {
      assert.equal(name, 'approval');
      return approvalOutcome === null ? undefined : { async request(req) {
        approvalsSeen.push(req);
        return typeof approvalOutcome === 'function' ? approvalOutcome(req) : approvalOutcome;
      } };
    },
    tools: {
      get: name => visible.get(name),
      executable: (name, agent, admitted) => admitted?.get(name) === visible.get(name) ? admitted?.get(name) : undefined,
      register(definition, options) { visible.set(definition.name, definition); registrations.set(definition.name, options); },
      guard: callback => guards.push(callback),
    },
    agents: { list: () => [...agents.values()], get: id => agents.get(id) },
    subagents: { rootOf: agent => owners.get(agent) },
    sessionProjections: { stateOf(session, key) {
      if (key === policyKey) return policy.get(session);
      assert.equal(key, 'subagent');
      return session.descriptor;
    } },
    llm: {
      listProviders: () => [{ id: 'p-one' }, { id: 'p-two' }],
      listModels: async provider => [...catalog.values()].filter(entry => entry.provider === provider),
      resolveModelInfo: async (_provider, model) => catalog.get(model),
    },
  };
  function makeAgent(id, seed = baseline, { child = false, own = true, ownPolicy = nativePolicy, root } = {}) {
    let selected = seed;
    const session = {
      header: { id, ...(child ? { origin: 'subagent' } : {}) },
      descriptor: child ? { mode: 'continuable', seq: 2 } : null,
      isOwnSeq: seq => own && seq === 2,
    };
    const agent = {
      id, session,
      model: { current: () => ({ ...selected }), select: next => { selections.push([id, next]); selected = { ...next }; } },
      manual: next => { selected = { ...next }; },
    };
    policy.set(session, ownPolicy);
    agents.set(id, agent);
    owners.set(agent, root ?? agent);
    return agent;
  }
  const root = makeAgent('root');
  const deny = exec => guards.map(guard => guard(exec)).find(Boolean);
  const failure = (message, info) => ({ isError: true, error: { message, ...(info && { info }) }, content: [{ type: 'text', text: `Error: ${message}` }] });
  // Local fixture models stage order, identity, and body resolution. The separate
  // installed-host fixture tests the same flow with the actual Cordis pipeline.
  class Pipeline {
    constructor(ctx, source) { this.get = source?.get ?? ctx.tools.executable; }
    async prepare(input) {
      const additionalContexts = [];
      const exec = { ...input, token: Symbol(input.name), arguments: Object.freeze(structuredClone(input.arguments)),
        deferContext: message => additionalContexts.push(message), concludeTurn: () => { exec.concluded = true; } };
      const tool = this.get(exec.name, exec.agent, exec.toolSet);
      exec.project = tool?.projectContent;
      exec.contexts = additionalContexts;
      observed.push(['pre', exec]);
      const rule = await hooks.pre?.(exec);
      const reason = rule ? undefined : deny(exec);
      if (rule || reason) return { kind: 'post-result', exec, result: rule ?? failure(reason) };
      return { kind: 'dispatch', exec };
    }
    async dispatch(exec) {
      const result = await listeners.get('tools/execute')(exec, async () => {
        try {
          await hooks.beforeBody?.(exec);
          const tool = this.get(exec.name, exec.agent, exec.toolSet);
          if (!tool) return failure('unknown tool');
          const value = await tool.execute(exec.arguments, exec);
          return { isError: false, value, content: tool.output.render(exec.arguments, value),
            ...(exec.concluded && { concludesTurn: true }) };
        } catch (error) { return failure(error.message); }
      });
      return { kind: 'post-result', result: { ...result, additionalContexts: [...exec.contexts, ...result.additionalContexts ?? []] } };
    }
    async complete(exec, outcome) {
      observed.push(['post', exec]);
      const result = outcome.result;
      const projected = exec.project?.(exec, result);
      const presentation = projected ? { ...result, content: projected } : result;
      return await hooks.post?.(exec, presentation) ?? presentation;
    }
  }
  installAdvice(ctx, config, modes);
  const runtime = installModeRuntime(ctx, config, modes, Pipeline);
  return {
    root, modes, ctx, config, runtime, catalog, visible, policy, records, writes, reads, approvalsSeen, selections, makeAgent, listeners, dispatches, observed, hooks, agents, deny, failure, dispose,
    setMode(next) { state = { mode: next, revision: state.revision + 1 }; },
    setApproval(next) { approvalOutcome = next; },
    external(name, local = false, modelCapable = true) { visible.set(name, nativeDefinition(name, dispatches, local, modelCapable)); },
    async step(agent = root, options = {}) {
      const toolSet = options.toolSet ?? new Map([...visible].filter(([name]) => registrations.get(name)?.when({ agent }) ?? true));
      const assembly = { sections: options.sections ?? ['subagent', 'subagent_fork'].map(name => ({ name: `tool:${name}`, text: `Start independent delegations with \`${name}\` together in one assistant message and continue useful work while they run.` })), contexts: [] };
      const result = await listeners.get('system-prompt/assemble')(assembly, { scope: options.scope ?? agent, agent, toolSet }, async () => assembly);
      assert.equal(result.contexts, assembly.contexts, 'never create an extra user-role context');
      return { toolSet, text: result.sections.find(section => section.name === 'team-terra-ultra:difficulty-candidates')?.text ?? '' };
    },
    async call(toolSet, args, { name = routerName, agent = root, signal = new AbortController().signal, callId = 'call-1', rootCallId = 'root-call', parent } = {}) {
      const pipeline = new Pipeline(ctx);
      try {
        const input = { ...standardTask, ...args };
        const ready = await pipeline.prepare({ name, agent, toolSet, arguments: input, callId, rootCallId, parent, signal });
        const outcome = ready.kind === 'dispatch' ? await pipeline.dispatch(ready.exec) : ready;
        return await pipeline.complete(ready.exec, outcome);
      } catch (error) { return failure(error.message); }
    },
    async around(exec, next) { return listeners.get('tools/execute')(exec, next); },
  };
}

test('groups exact pairs in native order; malformed or duplicate records confer no authority', () => {
  const sameModelOtherProvider = { ...hard, provider: routine.provider };
  assert.deepEqual(classifiedGroups([routine, sameModelOtherProvider, hard], [hard, hidden, hard]), { difficult: [hard], routine: [routine, sameModelOtherProvider] });
  assert.equal(classifiedGroups([routine], []), undefined);
  assert.deepEqual(classifiedGroups([routine], [hard]), { difficult: [], routine: [routine] });
  for (const bad of [undefined, null, [], [hard, hard], [{}]]) assert.equal(groupRoutes(bad, [hard]), undefined);
  assert.deepEqual(effortIds({ reasoning: { efforts: [{ id: 'z' }, { id: 'b' }] } }), ['z', 'b']);
  assert.deepEqual(effortIds({ reasoning: { efforts: [{ id: 'z' }, { id: 'z' }] } }), []);
});

test('advice requires the exact admitted wrapper and native target; never exposes available or private model IDs', async () => {
  const f = fixture({ mode: 'prayer' });
  const { toolSet, text } = await f.step();
  assert.match(text, /mode: prayer/);
  assert.match(text, /`subagent` or `subagent_fork`/);
  assert.match(text, /use `delegate_by_difficulty`/);
  assert.match(text, /simple or hard/);
  assert.match(text, /Do not choose, guess, or supply any provider, model ID, or reasoning effort/);
  for (const route of nativePolicy.concat(hidden)) assert.equal(text.includes(route.model), false);
  assert.match(text, /`wait_agent`/);
  f.visible.delete('wait_agent');
  assert.doesNotMatch((await f.step()).text, /wait_agent/);
  f.config.prayerEnabled = false;
  assert.match((await f.step()).text, /mode: normal/);
  toolSet.delete(routerName);
  assert.equal((await f.step(f.root, { toolSet })).text, '');
});

test('every mode and the tool field share the same routine-first classification criteria', async () => {
  for (const options of [
    { mode: 'normal', prayerEnabled: false },
    { mode: 'normal', prayerEnabled: true },
    { mode: 'rice', prayerEnabled: true },
    { mode: 'prayer', prayerEnabled: true },
  ]) {
    const f = fixture(options);
    const { text, toolSet } = await f.step();
    const { description } = toolSet.get(routerName).parameters.properties.difficulty;
    assert.ok(text.split('\n').includes(description), options.mode);
    assert.match(description, /each delegated subtask independently/);
    assert.match(description, /Default to simple, including when unsure/);
    assert.match(description, /hard only.*concrete blocker.*substantial rework/);
    assert.match(description, /Prayer only opens access.*does not lower the threshold for hard/);
  }
});

test('Agent-scoped native tool needs no global registration but still needs a native step witness', async () => {
  const f = fixture();
  f.ctx.tools.get = (name, scope) => scope === f.root ? f.visible.get(name) : undefined;
  assert.equal(f.ctx.tools.get('subagent'), undefined);
  const observed = await f.step();
  assert.match(observed.text, /delegate_by_difficulty/);
  assert.equal((await f.call(observed.toolSet, { target: 'subagent', difficulty: 'simple' })).isError, false);
  assert.deepEqual(f.dispatches.at(-1)[0].model, routine.model);

  // 同名、同签名工具在没有原生提示见证时仍不受路由器管制。
  const unknown = await f.step(f.root, { sections: [] });
  assert.equal(unknown.text, '');
  assert.match((await f.call(unknown.toolSet, { target: 'subagent', difficulty: 'simple' })).error.message, /No verified/);
  assert.equal((await f.call(unknown.toolSet, {}, { name: 'subagent' })).isError, false);
});

test('blocks all direct proven local delegation, with explicit or implicit options and either native tool', async () => {
  const f = fixture();
  const { toolSet } = await f.step();
  for (const name of ['subagent', 'subagent_fork']) {
    for (const args of [{}, hard, routine, { provider: hard.provider }]) {
      const result = await f.call(toolSet, args, { name });
      assert.match(result.error.message, /Use delegate_by_difficulty/);
    }
  }
  assert.equal(f.dispatches.length, 0);
  assert.equal(f.approvalsSeen.length, 0);
});

test('unobserved, unsupported, external-shaped, absent-policy and hidden/shadowed wrapper calls remain native', async () => {
  const f = fixture({ mode: 'rice' });
  const direct = async step => assert.equal((await f.call(step.toolSet, hard, { name: 'subagent' })).isError, false);
  const unobserved = await f.step(f.root, { sections: [] });
  assert.equal(unobserved.text, '');
  await direct(unobserved);
  await direct(await f.step(f.root, { scope: {} }));
  const hiddenWrapper = await f.step();
  hiddenWrapper.toolSet.delete(routerName);
  assert.equal((await f.step(f.root, { toolSet: hiddenWrapper.toolSet })).text, '');
  await direct(hiddenWrapper);
  const shadowed = f.visible.get(routerName);
  f.visible.set(routerName, { ...shadowed });
  await direct(await f.step());
  f.visible.set(routerName, shadowed);
  f.policy.delete(f.root.session);
  await direct(await f.step());
  f.policy.set(f.root.session, nativePolicy);
  f.config.smartModels = [];
  await direct(await f.step());
  f.config.smartModels = [hard];
  f.external('subagent');
  const external = await f.step();
  assert.doesNotMatch(external.text, /`subagent`/);
  await direct(external);
  assert.match((await f.call(external.toolSet, { target: 'subagent', difficulty: 'simple' })).error.message, /No verified/);
  f.external('subagent_fork');
  const externalOnly = await f.step();
  assert.equal(externalOnly.toolSet.has(routerName), false);
  await direct(externalOnly);
  f.external('subagent', true, false);
  f.external('subagent_fork', true, false);
  const unsupportedFork = await f.step();
  assert.equal(unsupportedFork.toolSet.has(routerName), false);
  await direct(unsupportedFork);
  assert.equal((await f.call(unsupportedFork.toolSet, {}, { name: 'subagent_fork' })).isError, false);
  f.external('subagent', true);
  const withSupportedSpawn = await f.step();
  assert.equal(withSupportedSpawn.toolSet.has(routerName), true);
  assert.match((await f.call(withSupportedSpawn.toolSet, { target: 'subagent_fork', difficulty: 'simple' })).error.message, /No verified/);
});

test('wrapper dispatches native fork once through all stages, preserving correlation, payload, output, and context', async () => {
  const f = fixture();
  const signal = new AbortController().signal;
  const { toolSet: admitted } = await f.step();
  f.hooks.post = (exec, result) => exec.name === 'subagent_fork' ? { ...result, content: [{ type: 'text', text: 'native post-policy content' }] } : undefined;
  const args = { difficulty: 'simple', target: 'subagent_fork', cwd: 'test cwd', name: 'unit-fork' };
  const parent = Symbol('enclosing PTC call');
  const result = await f.call(admitted, args, { signal, parent });
  assert.deepEqual(result, { isError: false, value: { kind: 'activation', name: 'unit-fork' },
    content: [{ type: 'text', text: 'native post-policy content' }], additionalContexts: [context], concludesTurn: true });
  assert.deepEqual(f.observed.map(([stage, exec]) => [stage, exec.name]), [
    ['pre', routerName], ['pre', 'subagent_fork'], ['post', 'subagent_fork'], ['post', routerName],
  ]);
  const [, outer] = f.observed[0];
  assert.equal(outer.parent, parent);
  assert.deepEqual(outer.arguments, { ...standardTask, ...args });
  assert.equal(Object.isFrozen(outer.arguments), true);
  assert.equal(f.dispatches.length, 1);
  const [nativeArgs, native] = f.dispatches[0];
  assert.deepEqual(nativeArgs, { ...standardTask, ...routine, cwd: 'test cwd', name: 'unit-fork' });
  assert.equal(Object.isFrozen(nativeArgs), true);
  assert.equal(native.parent, outer.token);
  assert.notEqual(native.token, outer.token);
  assert.notEqual(native.callId, outer.callId);
  assert.equal(native.rootCallId, outer.rootCallId);
  assert.equal(native.signal, signal);
  assert.equal(native.agent, f.root);
  assert.equal(native.toolSet, admitted);
  await assert.rejects(f.around(native, () => assert.fail('completed authorization must not be replayed')), /Use delegate_by_difficulty/);
});

test('wrapper preserves native denials, never retries an activation, and fails closed on unrecognized input', async () => {
  const f = fixture();
  const { toolSet } = await f.step();
  const nativeFailure = { ...f.failure('Denied by native pre-policy', { name: 'PolicyError', code: 'NATIVE_DENY' }),
    content: [{ type: 'text', text: 'native denial content' }], additionalContexts: [context] };
  f.hooks.pre = exec => exec.name === 'subagent' ? nativeFailure : undefined;
  const task = { target: 'subagent', difficulty: 'simple' };
  assert.deepEqual(await f.call(toolSet, task), nativeFailure);
  for (const invalid of [{}, { target: 'subagent' }, { ...task, difficulty: 'easy' }, { ...task, ...routine }, { ...task, target: 'subagent_oar' }]) {
    assert.match((await f.call(toolSet, invalid)).error.message, /Specify target, difficulty/);
  }
  assert.equal(f.dispatches.length, 0);
  assert.equal(f.observed.filter(([stage, exec]) => stage === 'pre' && exec.name === 'subagent').length, 1);
});

test('hard first verifies mode and availability; rice stays routine and active Prayer uses maximum advertised effort', async () => {
  const f = fixture({ strictDifficulty: true, approvals: null });
  const { toolSet } = await f.step();
  const task = { target: 'subagent', difficulty: 'hard' };
  assert.match((await f.call(toolSet, task)).error.message, /requires active Prayer/);
  assert.equal(f.dispatches.length, 0);
  f.setMode('rice');
  assert.equal((await f.call(toolSet, task)).isError, false);
  assert.deepEqual(f.dispatches.at(-1)[0], { ...standardTask, ...routine });
  f.catalog.delete(routine.model);
  assert.equal((await f.call(toolSet, task)).isError, false);
  assert.deepEqual(f.dispatches.at(-1)[0], { ...standardTask, ...secondRoutine });
  f.catalog.delete(secondRoutine.model);
  assert.match((await f.call(toolSet, task)).error.message, /No authorized routine route/);
  f.setMode('prayer');
  assert.equal((await f.call(toolSet, task)).isError, false);
  assert.deepEqual(f.dispatches.at(-1)[0], { ...standardTask, ...hard, reasoning_effort: hardMax.reasoningEffort });
  assert.equal(f.approvalsSeen.length, 0);
  f.catalog.delete(hard.model);
  assert.match((await f.call(toolSet, task)).error.message, /No authorized hard route/);
  assert.equal(f.dispatches.length, 3);
});

test('normal hard without global Prayer keeps one-shot opt-in and revalidates authorization after waiting', async () => {
  const f = fixture({ prayerEnabled: false, strictDifficulty: true });
  const { toolSet } = await f.step();
  const task = { target: 'subagent', difficulty: 'hard' };
  assert.equal((await f.call(toolSet, task)).isError, false);
  const [[args, exec]] = f.dispatches;
  assert.deepEqual(args, { ...standardTask, ...hard });
  assert.deepEqual(f.approvalsSeen.map(({ agent, toolName, callId, signal }) => [agent, toolName, callId, signal]), [[f.root, 'subagent', exec.callId, exec.signal]]);
  for (const outcome of ['rejected', 'unavailable', 'cancelled', null]) {
    f.setApproval(outcome);
    assert.match((await f.call(toolSet, task)).error.message, /approval/);
  }
  f.setApproval(() => { f.setMode('rice'); return 'allowed-once'; });
  assert.match((await f.call(toolSet, task)).error.message, /state changed/);
  assert.equal(f.dispatches.length, 1);
});

test('mode, policy, catalog and exact registration races fail without native retry or fallback', async () => {
  const cases = [
    (f) => f.hooks.pre = async exec => { if (exec.name === 'subagent') f.setMode('rice'); },
    (f) => f.hooks.pre = async exec => { if (exec.name === 'subagent') f.catalog.delete(routine.model); },
    (f) => f.hooks.beforeBody = async exec => { if (exec.name === 'subagent') f.policy.set(f.root.session, [hard]); },
    (f) => f.hooks.beforeBody = async exec => { if (exec.name === 'subagent') f.external('subagent', true); },
    (f) => f.hooks.beforeBody = async exec => { if (exec.name === 'subagent') f.visible.delete(routerName); },
    (f) => f.hooks.beforeBody = async exec => { if (exec.name === 'subagent') f.dispose(); },
  ];
  for (const change of cases) {
    const f = fixture();
    const { toolSet } = await f.step();
    change(f);
    const result = await f.call(toolSet, { target: 'subagent', difficulty: 'simple' });
    assert.equal(result.isError, true);
    assert.match(result.error.message, /state changed|unknown tool/);
    assert.equal(f.dispatches.length, 0);
    assert.equal(f.observed.filter(([stage, exec]) => stage === 'pre' && exec.name === 'subagent').length, 1);
  }
});

test('authorization cannot be replayed by exact-value lookalikes or altered native payloads', async () => {
  const f = fixture();
  const { toolSet } = await f.step();
  f.hooks.pre = async exec => {
    if (exec.name !== 'subagent') return;
    const forged = { ...exec, token: Symbol('lookalike') };
    await assert.rejects(f.around(forged, () => assert.fail('lookalike must not dispatch')), /state changed/);
    assert.match(f.deny({ ...exec, arguments: { ...exec.arguments, model: hard.model } }), /state changed/);
  };
  f.hooks.beforeBody = async exec => {
    if (exec.name === 'subagent') await assert.rejects(f.around(exec, () => assert.fail('already authorized once')), /state changed/);
  };
  assert.equal((await f.call(toolSet, { target: 'subagent', difficulty: 'simple' })).isError, false);
  assert.equal(f.dispatches.length, 1);
});

test('Prayer availability requires exact loaded root and a current recorded smart/catalog intersection', async () => {
  const f = fixture();
  const available = () => f.runtime.prayerAvailable(f.root.id);
  assert.equal(await available(), true);
  assert.equal(await f.runtime.prayerAvailable('cold-root'), false);
  const child = f.makeAgent('child', baseline, { child: true, root: f.root });
  assert.equal(await f.runtime.prayerAvailable(child.id), false);
  assert.equal(await f.runtime.prayerAvailable(f.root.id, AbortSignal.abort()), false);
  f.config.prayerEnabled = false;
  assert.equal(await available(), false);
  f.config.prayerEnabled = true;
  f.policy.set(f.root.session, [hidden]);
  assert.equal(await available(), true);
  f.policy.set(f.root.session, [routine, unavailable]);
  assert.equal(await available(), false);
  f.policy.set(f.root.session, [hard]);
  f.ctx.llm.resolveModelInfo = async () => { f.policy.set(f.root.session, [routine]); return f.catalog.get(hard.model); };
  assert.equal(await available(), false);
  f.root.session.header.id = 'other-session';
  assert.equal(await available(), false);
  assert.equal(f.dispatches.length, 0);
  assert.equal(f.selections.length, 0);
});

test('reconcile selects for exact verified local children and restores original complete selection', async () => {
  const f = fixture({ mode: 'prayer' });
  const child = f.makeAgent('child', baseline, { child: true, root: f.root });
  const fork = f.makeAgent('ordinary-fork', baseline, { root: f.root });
  const external = f.makeAgent('external', baseline);
  const nearbyRoot = f.makeAgent('other-root');
  f.makeAgent('other-child', baseline, { child: true, root: nearbyRoot });
  assert.equal(f.runtime.available, true);
  assert.deepEqual(await f.runtime.reconcile(f.root.id), { updated: 1, skipped: 1 });
  assert.deepEqual(child.model.current(), hardMax);
  assert.deepEqual(f.writes, [[child.id, { rootId: f.root.id, original: baseline, applied: hardMax, pending: true }], [child.id, { rootId: f.root.id, original: baseline, applied: hardMax }]]);
  assert.deepEqual(fork.model.current(), baseline);
  assert.deepEqual(external.model.current(), baseline);
  f.setMode('normal');
  assert.deepEqual(await f.runtime.reconcile(f.root.id), { updated: 1, skipped: 1 });
  assert.deepEqual(child.model.current(), baseline);
  assert.equal(f.records.has(child.id), false);
});

test('rice replaces original hard with first allowed routine, then normal restores the original', async () => {
  const f = fixture({ mode: 'rice' });
  const oldHard = { ...hard, reasoningEffort: 'high' };
  const child = f.makeAgent('hard-child', oldHard, { child: true, root: f.root });
  assert.deepEqual(await f.runtime.reconcile(f.root.id), { updated: 1, skipped: 0 });
  assert.deepEqual(child.model.current(), routine);
  f.setMode('normal');
  assert.deepEqual(await f.runtime.reconcile(f.root.id), { updated: 1, skipped: 0 });
  assert.deepEqual(child.model.current(), oldHard);
});

test('exiting rice retains the current route if the original is unavailable or no longer authorized', async () => {
  for (const invalidate of [f => f.catalog.delete(hard.model), f => f.policy.set(f.root.session, [routine])]) {
    const f = fixture({ mode: 'rice' });
    const child = f.makeAgent('hard-child', hardMax, { child: true, root: f.root });
    await f.runtime.reconcile(f.root.id);
    assert.deepEqual(child.model.current(), routine);
    invalidate(f);
    f.setMode('normal');
    assert.deepEqual(await f.runtime.reconcile(f.root.id), { updated: 0, skipped: 1 });
    assert.deepEqual(child.model.current(), routine);
  }
});

test('rice with no safe routine, unverified authorization, and stale/manual marks never select another model', async () => {
  const f = fixture({ mode: 'rice' });
  const a = f.makeAgent('no-routine', hard, { child: true, root: f.root, ownPolicy: [hard] });
  const b = f.makeAgent('bad-auth', hard, { child: true, root: f.root, ownPolicy: null });
  const c = f.makeAgent('wrong-root-mark', hard, { child: true, root: f.root });
  f.records.set(c.id, { rootId: 'other-root', original: baseline, applied: hard });
  assert.deepEqual(await f.runtime.reconcile(f.root.id), { updated: 0, skipped: 3 });
  assert.equal(f.writes.length, 0);
  assert.equal(f.selections.length, 0);
  f.setMode('prayer');
  const d = f.makeAgent('manual', baseline, { child: true, root: f.root });
  await f.runtime.reconcile(f.root.id);
  d.manual({ ...hard, reasoningEffort: 'high' });
  f.setMode('normal');
  const writesBefore = f.writes.length;
  await f.runtime.reconcile(f.root.id);
  assert.deepEqual(d.model.current(), { ...hard, reasoningEffort: 'high' });
  assert.equal(f.writes.slice(writesBefore).some(([id]) => id === d.id), false);
  assert.equal(f.writes.some(([id]) => id === b.id), false);
  assert.deepEqual(a.model.current(), hard);
});

test('cold resumed lifecycle reconciles only published local children; fresh delegates retain native choice', async () => {
  const f = fixture({ mode: 'prayer' });
  const good = f.makeAgent('resumed', baseline, { child: true, root: f.root });
  const fresh = f.makeAgent('fresh', baseline, { child: true, root: f.root });
  const foreign = f.makeAgent('external');
  const signal = ['agent/created', 'subagent/start'].map(event => f.listeners.get(event));
  signal[0]({ agent: good, source: 'resume' });
  signal[0]({ agent: fresh, source: 'startup' });
  signal[0]({ agent: foreign, source: 'resume' });
  signal[1]({ id: good.id, local: true });
  signal[1]({ id: fresh.id, local: true });
  signal[1]({ id: foreign.id, local: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(good.model.current(), hardMax);
  assert.deepEqual(fresh.model.current(), baseline);
  assert.deepEqual(foreign.model.current(), baseline);
});

test('nonresident and unexpected root operations do not inflate skipped members', async () => {
  const f = fixture({ mode: 'prayer' });
  assert.deepEqual(await f.runtime.reconcile('cold-root'), { updated: 0, skipped: 0, deferred: true });
  assert.deepEqual(await f.runtime.reconcile(f.root.id), { updated: 0, skipped: 0 });
  f.ctx.subagents.rootOf = () => { throw new Error('host lifecycle unavailable'); };
  assert.deepEqual(await f.runtime.reconcile(f.root.id), { updated: 0, skipped: 0, failed: true });
});

test('pending durable mark after interrupted write does not become a restoration authority', async () => {
  const f = fixture();
  const child = f.makeAgent('pending', hardMax, { child: true, root: f.root });
  f.records.set(child.id, { rootId: f.root.id, original: baseline, applied: hardMax, pending: true });
  assert.deepEqual(await f.runtime.reconcile(f.root.id), { updated: 0, skipped: 1 });
  assert.deepEqual(child.model.current(), hardMax);
  assert.equal(f.writes.length, 0);
});
