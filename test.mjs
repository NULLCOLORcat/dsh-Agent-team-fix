import assert from 'node:assert/strict';
import { test } from 'node:test';
import { difficultyCandidates } from './routing.js';
import { installAdvice } from './runtime.js';

const strong = Object.freeze({ provider: 'p-one', model: 'shared-model' });
const weak = Object.freeze({ provider: 'p-two', model: 'shared-model' });
const inactive = Object.freeze({ provider: 'other', model: 'private-unapproved-model' });
const nativePolicy = Object.freeze([weak, strong]);
const policyKey = 'subagentModelSelectionPolicy';
const routeAware = Object.freeze({ parameters: { properties: { provider: { type: 'string' }, model: { type: 'string' } } } });
const nativeList = Object.freeze({});

function agent(session = {}) {
  return Object.freeze({ session: Object.freeze(session) });
}

/** Fake the three read-only runtime surfaces. An extra/mutating call must throw or fail the captured assertions. */
function fixture({ config = { smartModels: [inactive, strong] }, policy = new Map() } = {}) {
  const tools = new Map([['subagent', routeAware], ['list_subagent_models', nativeList]]);
  const reads = [];
  let fact;
  const ctx = Object.freeze({
    tools: Object.freeze({ executable(name, scope, toolSet) {
      reads.push(['tool', name, scope, toolSet]);
      const registry = toolSet === undefined ? tools : toolSet;
      return registry.get(name);
    } }),
    sessionProjections: Object.freeze({ stateOf(session, key) {
      reads.push(['projection', session, key]);
      return policy.get(session);
    } }),
    systemPrompt: Object.freeze({ context(value) {
      assert.equal(fact, undefined, 'only one contribution must be registered');
      fact = value;
    } }),
  });
  installAdvice(ctx, config);
  return { fact, reads, tools, policy, render: (a, extra) => fact.text({ agent: a, scope: a, ...extra }) };
}

function renderedGroups(text) {
  return text.trim().split('\n').slice(1, 3).map(line => JSON.parse(line.match(/\[.*\](?=\.$)/)[0]));
}

test('groups exact native pairs, preserve native order, and expose only detached route ids', () => {
  const otherStrong = Object.freeze({ provider: 'p-three', model: 'another' });
  const withExtras = Object.freeze({ ...strong, reasoningEffort: 'not-a-route-field' });
  const allow = Object.freeze([weak, withExtras, otherStrong]);
  const smart = Object.freeze([otherStrong, inactive, strong, strong]);
  const out = difficultyCandidates(allow, smart);
  assert.deepEqual(out, { difficult: [strong, otherStrong], routine: [weak] });
  out.difficult[0].model = 'different';
  assert.equal(withExtras.model, 'shared-model');
  assert.equal(difficultyCandidates(nativePolicy, []), undefined);
  assert.equal(difficultyCandidates(nativePolicy, [inactive]), undefined);
  assert.deepEqual(difficultyCandidates([strong], [strong]), { difficult: [strong], routine: [] });
});

test('empty, malformed and duplicate native policy shapes are not authority', () => {
  for (const policy of [undefined, null, {}, [], [strong, {}], [strong, strong], [{ ...strong, model: '' }]]) {
    assert.equal(difficultyCandidates(policy, [strong]), undefined);
  }
  assert.equal(difficultyCandidates(nativePolicy, null), undefined);
  assert.equal(difficultyCandidates(nativePolicy, [strong, { ...weak, provider: '' }]), undefined);
});

test('one optional dynamic context reads only the owning session projection and scoped tool definitions', () => {
  const a = agent({ id: 'valid' });
  const f = fixture({ policy: new Map([[a.session, nativePolicy]]) });
  assert.equal(f.fact.name, 'team-terra-ultra:difficulty-candidates');
  assert.equal(f.fact.interpolate, false);
  assert.notEqual(f.fact.required, true);
  assert.equal(f.fact.text({}), '');
  assert.equal(f.render(a, { scope: agent() }), '');
  assert.deepEqual(f.reads, []);

  const result = f.render(a);
  assert.deepEqual(renderedGroups(result), [[strong], [weak]]);
  assert.match(result, /advisory/);
  assert.match(result, /native list_subagent_models/);
  assert.match(result, /native delegation tools make the final admission decision/i);
  assert.match(result, /may not be available in the live catalog/);
  assert.ok(!result.includes(inactive.model));
  assert.deepEqual(f.reads, [['tool', 'subagent', a, undefined], ['projection', a.session, policyKey], ['tool', 'list_subagent_models', a, undefined]]);
});

test('older sessions without a snapshot and neighboring sessions do not inherit or guess authority', () => {
  const current = agent({ id: 'new' });
  const old = agent({ id: 'legacy' });
  const unregistered = agent({ id: 'projection-missing' });
  const nested = agent({ id: 'nested-subagent' });
  const f = fixture({ policy: new Map([[current.session, nativePolicy], [old.session, null], [nested.session, [weak]]]) });
  assert.deepEqual(renderedGroups(f.render(current)), [[strong], [weak]]);
  assert.equal(f.render(old, { modelSelection: strong }), '');
  assert.equal(f.render(unregistered, { modelSelection: strong }), '');
  assert.equal(f.render(nested), '', 'the only user-designated route belongs to the other session');
  f.policy.set(nested.session, [strong]);
  assert.deepEqual(renderedGroups(f.render(nested)), [[strong], []]);
  assert.deepEqual(renderedGroups(f.render(current)), [[strong], [weak]]);
});

test('scope admission controls visibility; do not assume support from names, tool catalog or Team state', () => {
  const a = agent();
  const f = fixture({ policy: new Map([[a.session, nativePolicy]]) });
  const noStepRoutes = new Map([['list_subagent_models', nativeList]]);
  assert.equal(f.render(a, { toolSet: noStepRoutes }), '');
  assert.ok(f.reads.every(([, , scope, toolSet]) => scope === a && toolSet === noStepRoutes));

  f.tools.set('subagent', { parameters: { properties: { model: { type: 'string' } } } });
  assert.equal(f.render(a), '');
  f.tools.set('subagent_fork', routeAware);
  f.tools.delete('list_subagent_models');
  const result = f.render(a);
  assert.deepEqual(renderedGroups(result), [[strong], [weak]]);
  assert.ok(!result.includes('list_subagent_models'));
  assert.match(result, /Native delegation tools make the final admission decision/);
});

test('volatile values are reread, and old fields cannot influence the result', () => {
  const a = agent();
  let smart = [strong];
  const config = Object.freeze({
    smartModels: Object.freeze({ get() { return smart; } }),
    get allowedModels() { assert.fail('old allowlist must not be read'); },
    get defaultModel() { assert.fail('old default route must not be read'); },
    get defaultReasoningEffort() { assert.fail('old default effort must not be read'); },
    get fallbackToCurrentModel() { assert.fail('old fallback must not be read'); },
  });
  const f = fixture({ config, policy: new Map([[a.session, nativePolicy]]) });
  assert.deepEqual(renderedGroups(f.render(a)), [[strong], [weak]]);
  smart = [weak, inactive];
  assert.deepEqual(renderedGroups(f.render(a)), [[weak], [strong]]);
  smart = null;
  assert.equal(f.render(a), '');
  smart = [inactive];
  assert.equal(f.render(a), '');
  smart = [];
  assert.equal(f.render(a), '');
});

test('read failures, malformed snapshots and absent runtime APIs fail inert without caching a permission', () => {
  const a = agent();
  const secret = 'private-diagnostic-must-not-leak';
  const badPolicy = { get() { throw new Error(secret); } };
  assert.equal(fixture({ policy: badPolicy }).render(a), '');
  const throwing = fixture({ config: { smartModels: { get() { throw new Error(secret); } } }, policy: new Map([[a.session, nativePolicy]]) });
  assert.equal(throwing.render(a), '');

  const f = fixture({ policy: new Map([[a.session, nativePolicy]]) });
  assert.deepEqual(renderedGroups(f.render(a)), [[strong], [weak]]);
  f.policy.set(a.session, [strong, null]);
  assert.equal(f.render(a), '');
  f.policy.delete(a.session);
  assert.equal(f.render(a), '');
  assert.equal(f.render(a, { toolSet: { get() { throw new Error(secret); } } }), '');

  let fact;
  installAdvice({ systemPrompt: { context(value) { fact = value; } } }, {});
  assert.equal(fact.text({ agent: a, scope: a }), '');
});
