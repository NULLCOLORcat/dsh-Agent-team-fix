import { AsyncLocalStorage } from 'node:async_hooks';
import { readPolicy, selectRoute, selectHardRoute, resolveRoute, routeKey } from './routing.js';

const ROUTE_KEYS = ['provider', 'model', 'reasoningEffort'];
const NATIVE_TOOLS = { fresh: 'subagent', fork: 'subagent_fork' };
const LEAD_ONLY = 'Only the Lead of an enabled Team can use teammate model selection';

const WARNING = 'team-terra-ultra: unsupported Team routing API；队友模型路由已停用，等待更新。';
const record = (value) => value !== null && typeof value === 'object';

/** 每次激活独享熔断状态；部分注册留下的回调不能在安装完成前或熔断后开始路由。 */
export function installRouting(ctx, config, Pipeline, onDisable) {
  let ready = false;
  let disabled = false;
  const fault = new Error(WARNING);
  function disable() {
    if (disabled) return;
    disabled = true;
    // 状态发布和日志互不依赖；包括异步观察者失败也不能拖垮普通会话。
    for (const notify of [() => ctx.logger?.warn?.(WARNING), () => onDisable?.(WARNING)]) {
      try { Promise.resolve(notify()).catch(() => {}); } catch { /* 诊断通道可能已经卸载 */ }
    }
  }
  // 仅由明确不满足的接口契约触发，不匹配 Host 异常的类型、消息或数据内容。
  function requireShape(ok) {
    if (!ok) { disable(); throw fault; }
  }
  function method(owner, key) {
    const fn = owner?.[key];
    requireShape(typeof fn === 'function');
    return fn.bind(owner);
  }
  function active() { if (!ready || disabled) throw fault; }
  function services() {
    method(ctx.agentTeams, 'isEnabled'); method(ctx.subagents, 'rootOf'); method(ctx.agents, 'get');
    method(ctx.tools, 'executable'); method(ctx.llm, 'resolveModelInfo'); method(ctx.llm, 'resolveCallConfig');
    for (const key of ['prepare', 'dispatch', 'complete']) method(pipeline, key);
  }
  function checkSignal(signal) { if (signal != null) method(signal, 'throwIfAborted')(); }
  const llm = {
    async resolveModelInfo(...args) {
      const info = await method(ctx.llm, 'resolveModelInfo')(...args);
      requireShape(typeof info?.id === 'string' && (info.reasoning == null || (Array.isArray(info.reasoning.efforts)
        && info.reasoning.efforts.every(effort => typeof effort?.id === 'string'))));
      return info;
    },
    async resolveCallConfig(...args) {
      active();
      const result = await method(ctx.llm, 'resolveCallConfig')(...args);
      requireShape(typeof result?.provider === 'string' && typeof result.model === 'string');
      return result;
    },
  };
  // 成员查询协议必须同步；不能把 Promise 当作 root 或 true，亦不遗留未处理的拒绝。
  function synchronous(value) {
    if (typeof value?.then === 'function') {
      Promise.resolve(value).catch(() => {});
      requireShape(false);
    }
    return value;
  }
  function activeTeamRoot(caller) {
    try {
      const root = synchronous(method(ctx.subagents, 'rootOf')(caller));
      if (root == null) return undefined;
      requireShape(record(root));
      const enabled = synchronous(method(ctx.agentTeams, 'isEnabled')(root));
      requireShape(typeof enabled === 'boolean');
      return enabled ? root : undefined;
    } catch (error) {
      // 查询权限不足表示此处无 Team 权限；取消并非协议变化，只终止本次操作。
      if (['UNAUTHORIZED', 'FORBIDDEN', 'PERMISSION_DENIED', 'EACCES', 'EPERM'].includes(error?.code)
          || error?.name === 'NotAllowedError') return undefined;
      if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') throw error;
      disable(); throw fault;
    }
  }
  // 每一步最多调用一次；准备和派发之间发现故障时不得继续启动原生委派。
  async function invokeNative(name, args, exec) {
    active();
    const prepared = await method(pipeline, 'prepare')({
      name, arguments: args, agent: exec.agent, signal: exec.signal,
      toolSet: exec.toolSet, callId: `${exec.callId}:team-model`, rootCallId: exec.rootCallId, parent: exec.token,
    });
    requireShape(typeof prepared?.kind === 'string' && record(prepared.exec));
    if (prepared.kind === 'dispatch') active();
    const outcome = prepared.kind === 'dispatch' ? await method(pipeline, 'dispatch')(prepared.exec) : prepared;
    const result = await method(pipeline, 'complete')(prepared.exec, outcome);
    requireShape(record(result) && (result.additionalContexts == null || Array.isArray(result.additionalContexts)));
    for (const context of result.additionalContexts ?? []) method(exec, 'deferContext')(context);
    if (result.isError) {
      requireShape(typeof result.error?.message === 'string');
      throw new Error(result.error.message);
    }
    active();
    return result.value;
  }
  let pipeline;
  try {
    method(ctx, 'on'); method(ctx.tools, 'register');
    for (const key of ['prepare', 'dispatch', 'complete']) method(Pipeline?.prototype, key);
    pipeline = new Pipeline(ctx);
    services();
  } catch { disable(); return; }
  const pending = new AsyncLocalStorage(); // 一次原生委派独享路由快照，不共享队长的并发状态。
  const bound = new WeakMap(); // 仅本次注册后新建的成员 → 已确认路由。
  function isLead(agent) {
    active(); requireShape(record(agent)); services();
    return activeTeamRoot(agent) === agent;
  }
  const hardEnabled = (policy) => policy.fallbackToCurrentModel || policy.smartModels.length > 0;
  const dailyEnabled = (policy) => policy.allowedModels.length > 1;
  const canList = (policy) => dailyEnabled(policy) || hardEnabled(policy);
  const when = (enabled) => (event) => {
    try { return isLead(event?.agent) && enabled(readPolicy(config)); }
    catch (error) { if (error === fault) return false; throw error; }
  };
  const hardGuidance = 'User-designated smarter models are best for unresolved or hard tasks and may consume more quota. Use daily teammates for routine work.';

  async function created(event) {
    const token = pending.getStore();
    if (!ready || disabled) { if (token) throw fault; return; }
    try { await bindCreated(event, token); }
    catch (error) { if (error !== fault || token) throw error; }
  }
  async function bindCreated(event, token) {
    requireShape(typeof event?.source === 'string');
    // 恢复流程不需要完整 header，也不查询 Team 或模型目录。
    if (event.source !== 'startup') return;
    const { agent, signal } = event;
    const header = agent?.session?.header;
    requireShape(typeof header?.origin === 'string');
    if (header.origin !== 'subagent') return;
    requireShape(typeof header.parentSession === 'string' && !!header.parentSession && typeof header.id === 'string' && !!header.id);
    const parent = synchronous(method(ctx.agents, 'get')(header.parentSession));
    requireShape(parent == null || record(parent));
    if (token && token.parent !== parent) throw new Error('Teammate route token does not match this creation');
    if (!parent) return;
    const matches = !!token;
    const root = activeTeamRoot(parent);
    if (!root) {
      if (matches) throw new Error('Team mode changed before teammate creation; request refused');
      return;
    }
    if (matches && (token.parent !== root || token.memberId !== undefined)) {
      throw new Error('Teammate route token does not match this creation');
    }
    checkSignal(signal);
    services();
    const route = matches ? token.route : await resolveRoute(llm, selectRoute(readPolicy(config)), signal);
    active(); checkSignal(signal);
    synchronous(method(agent.model, 'select')({ ...route }));
    bound.set(agent, Object.freeze({ ...route }));
    if (matches) token.memberId = header.id;
  }

  async function request(event, next) {
    requireShape(typeof next === 'function');
    // 不捕获或重放下游请求；已有成员在停用后仍校验其绑定。
    const resolved = await next();
    if (!record(event?.agent)) { disable(); return resolved; }
    const expected = bound.get(event.agent);
    if (expected) requireShape(record(resolved));
    // 请求准备阶段模型选择已经冻结；这里只检查，不覆盖其他中间件的结果。
    if (expected && ROUTE_KEYS.some((key) => resolved[key] !== expected[key])) {
      throw new Error('team-terra-ultra: teammate route was overridden; request refused');
    }
    return resolved;
  }

  function registerList() { ctx.tools.register({
    name: 'list_teammate_models',
    description: 'Inspect daily and hard-task teammate routes as Team Lead. No arguments: settings. provider + model: supported reasoning efforts for an available route.',
    parameters: { type: 'object', properties: {
      provider: { type: 'string', description: 'Exact provider ID; supply with model.' },
      model: { type: 'string', description: 'Exact allowed model ID; supply with provider.' },
    }, additionalProperties: false },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (!isLead(exec?.agent)) throw new Error(LEAD_ONLY);
      const policy = readPolicy(config);
      if (!canList(policy)) throw new Error('Model discovery requires multiple daily models or hard-task routing');
      if (args.provider === undefined && args.model === undefined) {
        return JSON.stringify({ ...policy, defaultReasoningEffort: policy.defaultReasoningEffort || '(model default)',
          ...(hardEnabled(policy) ? { hardTaskGuidance: policy.fallbackToCurrentModel
            ? 'Hard tasks use the main window current model and effort, overriding smartModels. Omit route fields.' : hardGuidance } : {}) });
      }
      if (args.provider === undefined || args.model === undefined) throw new Error('provider and model must be supplied together');
      const routes = policy.fallbackToCurrentModel ? policy.allowedModels : [...policy.allowedModels, ...policy.smartModels];
      const route = routes.find((candidate) => routeKey(candidate) === routeKey(args));
      if (!route) throw new Error('Requested teammate model is not allowed');
      checkSignal(exec.signal);
      const info = await llm.resolveModelInfo(route.provider, route.model, exec.signal);
      active(); checkSignal(exec.signal);
      return JSON.stringify({ provider: route.provider, model: info.id, name: info.name,
        reasoningEfforts: info.reasoning?.efforts ?? [], defaultEffort: info.reasoning?.defaultEffort ?? null });
    },
  }, { when: when(canList) }); }

  // 共用同一个原生工具管线，仅创建期的路由选择不同；不会放开 fork、审批或嵌套权限。
  function registerSpawn(hard) {
    const enabled = hard ? hardEnabled : dailyEnabled;
    ctx.tools.register({
      name: hard ? 'spawn_hard_teammate' : 'spawn_teammate_with_model',
      description: hard ? `Start a teammate for a hard task. ${hardGuidance} Inspect list_teammate_models first: choose a smartModels provider/model and optional supported effort, or omit all route fields when fallbackToCurrentModel is on.` : 'Start a named Team member with a selected route via the admitted native subagent (fresh) or subagent_fork (fork) tool. Use list_teammate_models first. Omit provider/model to use the configured default; for a different model, omitted effort uses that model default. Only available to the Team Lead in multi-model mode. Native in-process delegation without this wrapper uses the configured Team default.',
      parameters: { type: 'object', properties: {
        name: { type: 'string', description: 'Unique lower-kebab-case teammate name.' },
        description: { type: 'string', description: 'Short description of the delegated responsibility.' },
        prompt: { type: 'string', description: 'Complete initial task for the teammate.' },
        context: { type: 'string', enum: ['fresh', 'fork'], description: 'Default: fresh. Fork requires the native subagent_fork tool.' },
        provider: { type: 'string', description: 'Exact allowed provider ID. Supply together with model.' },
        model: { type: 'string', description: 'Exact allowed model ID. Supply together with provider.' },
        reasoning_effort: { type: 'string', description: 'Optional advertised effort ID for the selected model.' },
      }, required: ['name', 'description', 'prompt'], additionalProperties: false },
      output: { schema: {}, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      async execute(args, exec) {
        if (!isLead(exec?.agent)) throw new Error(LEAD_ONLY);
        const policy = readPolicy(config);
        if (!enabled(policy)) throw new Error(hard ? 'Hard teammate creation is disabled' : 'Model selection tools require multiple allowed models');
        const nativeName = Object.hasOwn(NATIVE_TOOLS, args.context ?? 'fresh') ? NATIVE_TOOLS[args.context ?? 'fresh'] : undefined;
        if (!nativeName || !synchronous(method(ctx.tools, 'executable')(nativeName, exec.agent, exec.toolSet))) {
          throw new Error(`Native ${nativeName ?? 'delegation'} tool is not admitted for this step`);
        }
        // rc.5 的 agent.model.current() 与主窗口 pre-step 共用；不从子代理的原生首选模型反推。
        const selected = hard ? selectHardRoute(policy, args, policy.fallbackToCurrentModel ? synchronous(method(exec.agent.model, 'current')()) : undefined)
          : selectRoute(policy, args);
        checkSignal(exec.signal);
        const route = await resolveRoute(llm, selected, exec.signal);
        const token = { parent: exec.agent, route, memberId: undefined };
        const nativeArgs = { name: args.name, description: args.description, prompt: args.prompt };
        const value = await pending.run(token, () => invokeNative(nativeName, nativeArgs, exec));
        if (!token.memberId) throw new Error('Native delegation did not bind a local teammate route; inspect the child before retrying');
        return { ...value, selected_route: { ...route } };
      },
    }, { when: when(enabled) });
  }
  try {
    ctx.on('agent/created', created);
    ctx.on('agent/request', request);
    registerList(); registerSpawn(false); registerSpawn(true);
    ready = true;
  } catch { disable(); } // Host 可能先保存回调再抛错；依靠当前激活的状态使残留入口失效。
}
