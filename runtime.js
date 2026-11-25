import { randomUUID } from 'node:crypto';
import { riceEnabled } from './session-modes.js';
import { classifiedGroups, effortIds, groupRoutes, routeKey, sameSelection, selectionOf } from './routing.js';

const ROUTER = 'delegate_by_difficulty';
const POLICY_KEY = 'subagentModelSelectionPolicy';
const ADVICE_SECTION = 'team-terra-ultra:difficulty-candidates';
const DELEGATION_NAMES = ['subagent', 'subagent_fork'];
const LOCAL_WORDING = ' Use `send_message` to steer it while running or continue its conversation after it finishes.';
const GUIDE = /^Start independent delegations with (`[^`]+`(?: or `[^`]+`)*) together in one assistant message and continue useful work while they run\./;
// Per-admitted-step provenance, never persisted and never transferred to another Agent/request.
const nativeByStep = new WeakMap();
const routerDefinitions = new WeakSet();
const ROUTER_REQUIRED = 'Use delegate_by_difficulty for this local delegation and choose simple or hard without supplying model IDs.';
const STALE = 'Delegation state changed before native dispatch; classify and submit a new wrapper call.';
// 提示段和工具字段共用判定标准；模式只改变路线是否开放，不改变难度门槛。
const DIFFICULTY_GUIDANCE = [
  'Classify each delegated subtask independently as simple or hard; do not inherit the overall project’s difficulty.',
  'Default to simple, including when unsure. Routine lookup, summarization, well-defined edits, and routine verification are simple.',
  'Choose hard only if you can identify a concrete blocker or explain what substantial rework a difficult route would avoid.',
  'Prayer only opens access to authorized difficult routes; it does not lower the threshold for hard.',
].join(' ');
const sameRoute = (a, b) => routeKey(a) === routeKey(b);

function value(config, name) {
  const field = config?.[name];
  return typeof field?.get === 'function' ? field.get() : field;
}

function effectiveMode(state, config) {
  if (!Number.isSafeInteger(state?.revision) || state.revision < 0) return undefined;
  if (state.mode === 'rice') return riceEnabled(config) ? 'rice' : 'normal';
  if (state.mode === 'normal') return 'normal';
  // The global feature switch suspends a stored prayer, not the Session choice.
  if (state.mode === 'prayer') return value(config, 'prayerEnabled') === true ? 'prayer' : 'normal';
  return undefined;
}

function rootOf(ctx, agent) {
  if (!agent?.session || ctx.agents.get(agent.id) !== agent) return;
  const root = ctx.subagents.rootOf(agent);
  if (root?.session && ctx.agents.get(root.id) === root) return root;
}

function groupsOf(ctx, agent, config) {
  return groupRoutes(ctx.sessionProjections.stateOf(agent.session, POLICY_KEY), value(config, 'smartModels') ?? []);
}

function automaticGroups(ctx, agent, config) {
  return classifiedGroups(ctx.sessionProjections.stateOf(agent.session, POLICY_KEY), value(config, 'smartModels'));
}

const sameGroups = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const executable = (ctx, name, agent, step) => step && ctx.tools.executable(name, agent, step);

function provenNative(ctx, name, agent, step) {
  const admission = step && nativeByStep.get(step);
  const tool = admission?.tools.get(name);
  if (tool && admission.agent === agent && executable(ctx, name, agent, step) === tool) return tool;
}

function admittedRouter(ctx, agent, step) {
  const router = executable(ctx, ROUTER, agent, step);
  if (router && routerDefinitions.has(router)) return router;
}

/** 预准入只检查 Agent 可见的定义形状，原生身份仍须由该步的原生提示证明。 */
function visibleCompatible(ctx, name, agent) {
  // 原生委派可随 Agent 预设挂载，不一定存在同名的全局注册。
  const tool = ctx.tools.get(name, agent);
  const params = tool?.parameters?.properties;
  if (tool?.name === name
      && typeof tool.description === 'string' && tool.description.includes(LOCAL_WORDING)
      && tool.output?.schema?.properties?.kind?.const === 'activation'
      && ['provider', 'model', 'reasoning_effort', 'prompt', 'description'].every(key => params?.[key]?.type === 'string')) return tool;
}

/**
 * rc.5 has no public ToolDefinition provenance field. The native section's
 * private registration Set supplies a witness: its directive only names the
 * exact registrations visible to this scope. Confirm the current admitted
 * object, the canonical activation schema and the native continue wording.
 * The native tool emits that wording iff its backend supplies prepareContinuable,
 * which is exactly the Subagent service's in-process branch. No name/schema-only
 * fallback, scoped shadow, other backend, or unobserved tool set is handled.
 */
function observeNativeTools(ctx, assembly, { scope, agent, toolSet }) {
  if (!toolSet || !agent || scope !== agent) return [];
  const unique = new Set();
  for (const section of assembly.sections) {
    if (!DELEGATION_NAMES.some(name => section.name === `tool:${name}`)) continue;
    const names = GUIDE.exec(section.text)?.[1];
    for (const [, name] of names?.matchAll(/`([^`]+)`/g) ?? []) unique.add(name);
  }
  const tools = new Map();
  for (const name of DELEGATION_NAMES) {
    if (!unique.has(name)) continue;
    const tool = visibleCompatible(ctx, name, agent);
    if (tool && ctx.tools.executable(name, agent, toolSet) === tool) tools.set(name, tool);
  }
  nativeByStep.set(toolSet, { agent, tools });
  return [...tools.keys()];
}

/** A catalog sample belongs to one operation. Only exact listed adapter routes are resolved. */
function catalogReader(ctx, signal) {
  const lists = new Map();
  const info = new Map();
  const providers = new Set(ctx.llm.listProviders().map(provider => provider.id));
  return (route) => {
    const { provider, model } = route;
    const key = routeKey(route);
    if (!providers.has(provider)) return Promise.resolve(undefined);
    if (!lists.has(provider)) {
      lists.set(provider, Promise.resolve().then(() => ctx.llm.listModels(provider)).catch(() => []));
    }
    if (!info.has(key)) {
      info.set(key, lists.get(provider).then(async models => {
        if (signal?.aborted || !models.some(item => item?.provider === provider && item.id === model)) return;
        const resolved = await ctx.llm.resolveModelInfo(provider, model, signal);
        if (!signal?.aborted && resolved?.provider === provider && resolved.id === model) return resolved;
      }).catch(() => undefined));
    }
    return info.get(key);
  };
}

/** 指令只说明分类与调用方式，不暴露模型 ID，也不生成用户消息。 */
export function installAdvice(ctx, config, modes) {
  return ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    let names = [];
    try { names = observeNativeTools(ctx, assembly, context); } catch { /* unknown version or composition */ }
    const base = await next();
    if (!names.length) return base;
    try {
      const { agent, signal, toolSet } = context;
      const root = rootOf(ctx, agent);
      if (!root || signal?.aborted || !admittedRouter(ctx, agent, toolSet) || !automaticGroups(ctx, agent, config)) return base;
      names = names.filter(name => provenNative(ctx, name, agent, toolSet));
      if (!names.length) return base;
      const state = modes.peek(root.id);
      const mode = effectiveMode(state, config);
      const prayerEnabled = value(config, 'prayerEnabled') === true;
      const text = [
        `Delegation mode: ${mode ?? 'unverified'}. For ${names.map(name => `\`${name}\``).join(' or ')}, use \`delegate_by_difficulty\` instead of calling the native tool directly.`,
        'Set target to the native tool name. Do not choose, guess, or supply any provider, model ID, or reasoning effort.',
        DIFFICULTY_GUIDANCE,
        ...(mode === 'rice' ? ['Rice mode permits only authorized routine routes, including for work classified hard.']
          : mode === 'prayer' ? ['Delegate only when it helps the existing task.']
            : prayerEnabled ? ['Hard delegation is unavailable until Prayer is active for this session.'] : []),
        ...(mode === 'prayer' && executable(ctx, 'wait_agent', agent, toolSet)
          ? ['Continue useful work while delegates run; use native `wait_agent` when only required results remain.'] : []),
      ].join('\n');
      return { ...base, sections: [...base.sections, { name: ADVICE_SECTION, text, interpolate: false }] };
    } catch { return base; }
  });
}

function ownLocalChild(ctx, agent, root) {
  if (agent === root || rootOf(ctx, agent) !== root || agent.session.header?.origin !== 'subagent') return false;
  const descriptor = ctx.sessionProjections.stateOf(agent.session, 'subagent');
  return (descriptor?.mode === 'continuable' || descriptor?.mode === 'one-shot') && agent.session.isOwnSeq(descriptor.seq);
}

function commonGroups(ctx, child, root, config) {
  const childGroups = groupsOf(ctx, child, config);
  const rootGroups = groupsOf(ctx, root, config);
  if (!childGroups || !rootGroups) return;
  return Object.fromEntries(['routine', 'difficult'].map(kind => [kind, childGroups[kind].filter(route => rootGroups[kind].some(other => sameRoute(route, other)))]));
}

/**
 * Model selections use only Agent.model.select: they affect future preparation;
 * no new turn, inbox item or cancellation. The before/after durable mark fences
 * a crash gap: a pending or malformed record is never used to restore a route.
 */
async function reconcileMember(ctx, config, modes, root, child, state, mode, readCatalog, active) {
  try {
    if (!ownLocalChild(ctx, child, root)) return 'skipped';
    const mark = await modes.readMark(child.id);
    const current = selectionOf(child.model.current());
    if (!current) return 'skipped';
    const groups = commonGroups(ctx, child, root, config);
    if (!groups) return 'skipped';
    const allowed = route => [...groups.routine, ...groups.difficult].some(other => sameRoute(route, other));
    const original = mark == null ? current : selectionOf(mark.original);
    const applied = mark == null ? undefined : selectionOf(mark.applied);
    if (mark != null && (mark.rootId !== root.id || mark.pending !== undefined || !original || !applied)) return 'skipped';
    if (!allowed(current) || !allowed(original)) return 'skipped';
    if (mark != null && !sameSelection(applied, current)) return 'skipped'; // a later operator pick wins
    if (mode === 'normal' && mark == null) return 'unchanged';
    const originalIsHard = groups.difficult.some(route => sameRoute(route, original));
    if (mode === 'rice' && mark == null && !originalIsHard) return 'unchanged';
    const valid = async (selection) => {
      const info = await readCatalog(selection);
      return !!info && (selection.reasoningEffort === undefined || effortIds(info).includes(selection.reasoningEffort));
    };
    let target;
    if (mode === 'prayer') {
      // Use current authorized hard route when possible, otherwise recorded allowlist order.
      const preferred = groups.difficult.find(route => sameRoute(route, current));
      for (const route of preferred ? [preferred, ...groups.difficult.filter(other => other !== preferred)] : groups.difficult) {
        const info = await readCatalog(route);
        if (!info) continue;
        const effort = effortIds(info).at(-1);
        target = { ...route, ...(effort === undefined ? {} : { reasoningEffort: effort }) };
        break;
      }
    } else if (mode === 'rice' && originalIsHard) {
      for (const route of groups.routine) {
        if (await valid(route)) { target = route; break; }
      }
    } else if (await valid(original)) target = original;
    if (!target) return 'skipped';
    const finished = mode === 'normal' || (mode === 'rice' && !originalIsHard);
    const verified = () => active() && ownLocalChild(ctx, child, root)
      && JSON.stringify(commonGroups(ctx, child, root, config)) === JSON.stringify(groups);
    const recheck = () => {
      const now = modes.peek(root.id);
      return now?.revision === state.revision && effectiveMode(now, config) === mode
        && verified() && sameSelection(current, selectionOf(child.model.current()));
    };
    if (!recheck()) return 'skipped';
    if (sameSelection(current, target)) {
      if (finished && mark != null) await modes.writeMark(child.id, null);
      return 'unchanged';
    }
    const record = { rootId: root.id, original, applied: target };
    await modes.writeMark(child.id, { ...record, pending: true });
    if (!recheck()) {
      // If the Agent or its authorization disappeared, do not write again.
      // A leftover pending record explicitly fences any uncertain restore.
      if (verified()) await modes.writeMark(child.id, mark ?? null);
      return 'skipped';
    }
    child.model.select(target);
    if (!verified() || !sameSelection(target, selectionOf(child.model.current()))) return 'skipped';
    await modes.writeMark(child.id, finished ? null : record);
    return 'updated';
  } catch { return 'skipped'; }
}

const ROUTER_PROPERTIES = {
  difficulty: { type: 'string', enum: ['simple', 'hard'], description: DIFFICULTY_GUIDANCE },
  target: { type: 'string', enum: DELEGATION_NAMES, description: 'Use subagent for a self-contained prompt or subagent_fork to inherit this conversation.' },
  description: { type: 'string', description: 'A short (3–5 word) display label in the user’s language.' },
  prompt: { type: 'string', description: 'The task to delegate, with the instructions the child needs.' },
  name: { type: 'string', description: 'Optional short agent name, with the same rules as the native tool.' },
  cwd: { type: 'string', description: 'Optional working directory, resolved as by the native tool.' },
};
const ROUTER_REQUIRED_FIELDS = ['difficulty', 'target', 'description', 'prompt'];
const NESTED_FAILURE = 'The nested native delegation failed.';

function validatedRequest(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)
      || !ROUTER_REQUIRED_FIELDS.every(key => Object.hasOwn(args, key))
      || Object.entries(args).some(([key, arg]) => {
        const field = Object.hasOwn(ROUTER_PROPERTIES, key) && ROUTER_PROPERTIES[key];
        return !field || typeof arg !== 'string' || (field.enum && !field.enum.includes(arg));
      })) throw new Error('Specify target, difficulty (simple or hard), description, and prompt; do not supply provider, model, or reasoning_effort.');
  return args;
}

/** First current catalog match in recorded order; a route never falls back to native defaults. */
async function pickRoute(ctx, routes, signal, strongest) {
  const readCatalog = catalogReader(ctx, signal);
  for (const route of routes) {
    signal?.throwIfAborted();
    const info = await readCatalog(route);
    signal?.throwIfAborted();
    if (!info) continue;
    const reasoningEffort = strongest ? effortIds(info).at(-1) : undefined;
    return { ...route, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) };
  }
}

/** Own the wrapper, and give only this invocation's one staged dispatch a private exception to the direct-call guard. */
function installDifficultyRouter(ctx, config, modes, Pipeline, active) {
  const pending = new Map(); // outer token → temporary authorization; erased before returning the outer result
  const completed = new WeakMap(); // outer execution → native result for output projection
  const invoked = new WeakSet();

  function eligibility(agent, step, target) {
    try {
      if (!active() || admittedRouter(ctx, agent, step) !== definition) return;
      const tool = provenNative(ctx, target, agent, step);
      const root = tool && rootOf(ctx, agent);
      const groups = root && automaticGroups(ctx, agent, config);
      if (groups) return { tool, root, groups, callerSession: agent.session, rootSession: root.session };
    } catch { /* no independently verified admission or recorded authorization */ }
  }

  function snapshot(agent, step, target) {
    const scope = eligibility(agent, step, target);
    if (!scope) return;
    const state = modes.peek(scope.root.id);
    return {
      ...scope, state,
      prayerEnabled: value(config, 'prayerEnabled') === true,
      strict: value(config, 'strictDifficulty') === true,
      mode: effectiveMode(state, config),
    };
  }

  function current(auth) {
    const { before, target, outer, signal } = auth;
    if (signal.aborted) return false;
    const now = snapshot(outer.agent, outer.toolSet, target);
    return now && now.tool === before.tool && now.root === before.root
      && now.callerSession === before.callerSession && now.rootSession === before.rootSession
      && now.state?.revision === before.state?.revision && now.mode === before.mode
      && now.prayerEnabled === before.prayerEnabled && now.strict === before.strict && sameGroups(now.groups, before.groups);
  }

  function sameCall(auth, exec) {
    return exec.parent === auth.outer.token && exec.callId === auth.callId && exec.rootCallId === auth.outer.rootCallId
      && exec.agent === auth.outer.agent && exec.toolSet === auth.outer.toolSet && exec.name === auth.target
      && typeof exec.token === 'symbol' && exec.token !== auth.outer.token
      && exec.arguments && Object.keys(exec.arguments).length === Object.keys(auth.args).length
      && Object.entries(auth.args).every(([key, arg]) => Object.hasOwn(exec.arguments, key) && exec.arguments[key] === arg);
  }

  const definition = {
    name: ROUTER,
    description: 'Classify and start an admitted native local delegation. Choose simple or hard, not a provider, model, or reasoning effort.',
    parameters: { type: 'object', properties: ROUTER_PROPERTIES, required: ROUTER_REQUIRED_FIELDS, additionalProperties: false },
    output: {
      schema: { type: 'object', required: ['kind', 'name'], additionalProperties: false, properties: {
        kind: { type: 'string', const: 'activation' }, name: { type: 'string' },
      } },
      render: (_args, result) => [{ type: 'text', text: `started subagent ${result.name}` }],
      presentationMeta: (_args, result) => ({ kind: result.kind, name: result.name }),
    },
    projectContent(exec, result) {
      const nested = completed.get(exec);
      if (!result.isError && nested && !nested.isError && result.value.kind === nested.value.kind
          && result.value.name === nested.value.name) return nested.content;
    },
    async execute(input, outer) {
      const { difficulty, target, ...task } = validatedRequest(input);
      const { agent, toolSet, signal, token, rootCallId } = outer;
      signal.throwIfAborted();
      if (outer.name !== ROUTER || typeof token !== 'symbol' || typeof rootCallId !== 'string' || !rootCallId
          || invoked.has(outer) || pending.has(token)) throw new Error('This wrapper invocation is not eligible for native dispatch.');
      const before = snapshot(agent, toolSet, target);
      if (!before?.mode) throw new Error('No verified, authorized native local delegation target is available for this step.');
      invoked.add(outer);
      const hard = difficulty === 'hard' && before.mode !== 'rice';
      if (hard && before.prayerEnabled && before.mode !== 'prayer') throw new Error('Hard delegation requires active Prayer in this session.');
      const routes = before.groups[hard ? 'difficult' : 'routine'];
      const strongest = hard && before.mode === 'prayer';
      const route = await pickRoute(ctx, routes, signal, strongest);
      const auth = { outer, signal, target, before, routes, strongest, route, hard };
      if (!current(auth)) throw new Error(STALE);
      if (!route) throw new Error(`No authorized ${hard ? 'hard' : 'routine'} route is currently available; no child was started.`);
      const args = Object.freeze({ ...task, provider: route.provider, model: route.model,
        ...(route.reasoningEffort === undefined ? {} : { reasoning_effort: route.reasoningEffort }) });
      Object.assign(auth, { args, callId: `delegate-${randomUUID()}`, phase: 'prepare' });
      pending.set(token, auth);
      try {
        // Pin registry lookup, not a private copy of the tool. A mode/policy/tool
        // change while an around policy awaited can still stop the native body.
        const pipeline = new Pipeline(ctx, { get(name, scope, admitted) {
          if (name !== target || scope !== agent || admitted !== toolSet || !current(auth)) return;
          if (auth.phase === 'prepare') return before.tool;
          if (auth.phase === 'armed' && auth.execution.token === auth.nestedToken
              && auth.execution.arguments === auth.nestedArgs && sameCall(auth, auth.execution)) {
            auth.phase = 'used';
            return before.tool;
          }
        } });
        const ready = await pipeline.prepare({ name: target, arguments: args, callId: auth.callId,
          rootCallId, agent, toolSet, parent: token, signal });
        let outcome = ready;
        if (ready.kind === 'dispatch') {
          // The Pipeline assigns the only accepted nested token and execution.
          const execution = ready.exec;
          if (execution.signal !== signal || !sameCall(auth, execution)) throw new Error(STALE);
          Object.assign(auth, { execution, nestedToken: execution.token, nestedArgs: execution.arguments, phase: 'prepared' });
          outcome = await pipeline.dispatch(execution);
        }
        const nested = await pipeline.complete(ready.exec, outcome);
        completed.set(outer, nested);
        if (nested.isError) throw new Error(NESTED_FAILURE);
        for (const context of nested.additionalContexts ?? []) outer.deferContext(context);
        if (nested.concludesTurn) outer.concludeTurn();
        return nested.value;
      } finally {
        pending.delete(token);
      }
    },
  };

  if (typeof Pipeline !== 'function') throw new Error('The native tool execution pipeline is unavailable.');
  ctx.tools.register(definition, { when({ agent }) {
    // This runs before the request has an admitted tool set or native prompt witness.
    try {
      return !!(active() && rootOf(ctx, agent) && automaticGroups(ctx, agent, config)
        && DELEGATION_NAMES.some(name => visibleCompatible(ctx, name, agent)));
    } catch { return false; }
  } });
  routerDefinitions.add(definition);

  ctx.tools.guard(exec => {
    const auth = pending.get(exec.parent);
    if (auth && DELEGATION_NAMES.includes(exec.name)) {
      if (auth.phase === 'prepare' && exec.signal === auth.signal && sameCall(auth, exec) && current(auth)) return;
      return STALE;
    }
    if (eligibility(exec.agent, exec.toolSet, exec.name)) return ROUTER_REQUIRED;
  });

  ctx.on('tools/execute', async (exec, next) => {
    if (exec.name === ROUTER && admittedRouter(ctx, exec.agent, exec.toolSet) === definition) {
      const result = await next();
      const nested = completed.get(exec);
      // Ferry native denial reasons, post-policy results, and contexts without a
      // lossy error-text round trip. Outer policies still run normally.
      return result?.isError && result.error?.message === NESTED_FAILURE && nested?.isError ? nested : result;
    }
    const auth = pending.get(exec.parent);
    if (!auth || !DELEGATION_NAMES.includes(exec.name)) {
      if (eligibility(exec.agent, exec.toolSet, exec.name)) throw new Error(ROUTER_REQUIRED);
      return next();
    }
    auth.signal.throwIfAborted();
    if (auth.phase !== 'prepared' || exec !== auth.execution || exec.token !== auth.nestedToken
        || exec.arguments !== auth.nestedArgs || !sameCall(auth, exec) || !current(auth)) throw new Error(STALE);
    auth.phase = 'checking';
    // Only normal mode without global Prayer uses this additional, one-shot
    // approval. The nested Pipeline has already run the Host's own pre-gates.
    if (auth.hard && auth.before.mode === 'normal' && auth.before.strict) {
      const approval = ctx.get('approval');
      if (typeof approval?.request !== 'function') throw new Error('Difficult-route approval is unavailable.');
      const outcome = await approval.request({ agent: exec.agent, toolName: exec.name, callId: exec.callId,
        signal: exec.signal, reason: 'Allow this exact native local delegation to use the selected difficult route once?' });
      exec.signal.throwIfAborted();
      if (outcome !== 'allowed-once') throw new Error(`Difficult-route approval did not grant permission (${outcome}).`);
      if (!current(auth)) throw new Error(STALE);
    }
    const available = await pickRoute(ctx, auth.routes, exec.signal, auth.strongest);
    if (!sameSelection(available, auth.route) || !current(auth)) throw new Error(STALE);
    auth.phase = 'armed';
    return next();
  });
}

/** Install exact native-tool gates and non-waking reconciliation for resident members. */
export function installModeRuntime(ctx, config, modes, Pipeline) {
  const running = new Map();
  const resuming = new WeakSet();
  let active = true;
  ctx.effect(() => () => { active = false; });
  async function reconcileNow(rootSessionId, only) {
    try {
      if (!active) return { updated: 0, skipped: 0, failed: true };
      const root = ctx.agents.get(rootSessionId);
      if (!root) return { updated: 0, skipped: 0, deferred: true };
      if (rootOf(ctx, root) !== root) return { updated: 0, skipped: 0, failed: true };
      const state = await modes.read(rootSessionId);
      const mode = effectiveMode(state, config);
      if (!mode) return { updated: 0, skipped: 0, failed: true };
      const readCatalog = catalogReader(ctx);
      const counts = { updated: 0, skipped: 0 };
      for (const child of only ? [only] : ctx.agents.list()) {
        if (child === root || ctx.agents.get(child.id) !== child) continue;
        try { if (rootOf(ctx, child) !== root) continue; } catch { continue; }
        const outcome = await reconcileMember(ctx, config, modes, root, child, state, mode, readCatalog, () => active);
        if (outcome !== 'unchanged') counts[outcome]++;
      }
      return counts;
    } catch { return { updated: 0, skipped: 0, failed: true }; }
  }
  function enqueue(rootSessionId, member) {
    const previous = running.get(rootSessionId);
    const pending = (previous ?? Promise.resolve()).then(() => reconcileNow(rootSessionId, member));
    running.set(rootSessionId, pending);
    void pending.then(() => { if (running.get(rootSessionId) === pending) running.delete(rootSessionId); });
    return pending;
  }

  // `agent/created` happens before Subagent installs its ownership; record only
  // the lifecycle source there. `subagent/start` follows exact local publication.
  ctx.on('agent/created', ({ agent, source }) => { if (source === 'resume') resuming.add(agent); });
  ctx.on('subagent/start', (info) => {
    if (info.local !== true) return;
    try {
      const agent = ctx.agents.get(info.id);
      if (!agent || !resuming.delete(agent)) return; // never auto-pick a new delegation's route
      const root = rootOf(ctx, agent);
      if (root && root !== agent) void enqueue(root.id, agent);
    } catch { /* unknown ownership */ }
  });

  installDifficultyRouter(ctx, config, modes, Pipeline, () => active);

  // Check catalog metadata only for the exact resident root; never wake an
  // archived session or sample a model by running inference.
  async function prayerAvailable(rootSessionId, signal) {
    try {
      const enabled = () => active && !signal?.aborted && value(config, 'prayerEnabled') === true;
      if (!enabled()) return false;
      const root = ctx.agents.get(rootSessionId);
      const session = root?.session;
      const exactRoot = () => session?.header?.id === rootSessionId && session.header.origin === undefined
        && root.session === session && rootOf(ctx, root) === root;
      if (!exactRoot()) return false;
      const groups = automaticGroups(ctx, root, config);
      if (!groups?.difficult.length) return false;
      const available = await pickRoute(ctx, groups.difficult, signal, false);
      return !!available && enabled() && exactRoot() && sameGroups(groups, automaticGroups(ctx, root, config));
    } catch { return false; }
  }

  return { available: true, reconcile: rootSessionId => enqueue(rootSessionId), prayerAvailable };
}
