import { AsyncLocalStorage } from 'node:async_hooks';
import { readPolicy, selectRoute, selectHardRoute, resolveRoute, routeKey } from './routing.js';

const ROUTE_KEYS = ['provider', 'model', 'reasoningEffort'];
const NATIVE_TOOLS = { fresh: 'subagent', fork: 'subagent_fork' };
const LEAD_ONLY = 'Only the Lead of an enabled Team can use teammate model selection';

/** 只有已绑定运行时的调用方才有 Team root；恢复中的孤立 Agent 不算有效成员。 */
function activeTeamRoot(ctx, caller) {
  if (!caller) return undefined;
  try {
    const root = ctx.subagents.rootOf(caller);
    return root && ctx.agentTeams.isEnabled(root) ? root : undefined;
  } catch (error) {
    if (error?.code === 'UNAUTHORIZED') return undefined;
    throw error;
  }
}

/** 像原生嵌套调用一样保留 Agent、步骤工具集、取消、审批与 guard；不直接调用工具函数。 */
async function invokeNative(pipeline, name, args, exec) {
  const prepared = await pipeline.prepare({
    name, arguments: args, agent: exec.agent, signal: exec.signal,
    toolSet: exec.toolSet, callId: `${exec.callId}:team-model`, rootCallId: exec.rootCallId,
    parent: exec.token,
  });
  const outcome = prepared.kind === 'dispatch' ? await pipeline.dispatch(prepared.exec) : prepared;
  const result = await pipeline.complete(prepared.exec, outcome);
  for (const context of result.additionalContexts ?? []) exec.deferContext(context);
  if (result.isError) throw new Error(result.error.message);
  return result.value;
}

/** 注册当前 Host 的创建期路由；探测到不兼容接口则不挂全局会话钩子。 */
export function installRouting(ctx, config, Pipeline) {
  if (typeof ctx.agentTeams?.isEnabled !== 'function' || typeof ctx.subagents?.rootOf !== 'function'
      || typeof ctx.agents?.get !== 'function' || typeof ctx.tools?.executable !== 'function'
      || typeof Pipeline?.prototype?.prepare !== 'function' || typeof Pipeline?.prototype?.dispatch !== 'function'
      || typeof Pipeline?.prototype?.complete !== 'function') {
    ctx.logger.warn('team-terra-ultra: unsupported Team routing API; session creation is left untouched');
    return;
  }

  const pipeline = new Pipeline(ctx);
  const pending = new AsyncLocalStorage(); // 一次原生委派独享路由快照，不共享队长的并发状态。
  const bound = new WeakMap(); // 仅本次注册后新建的成员 → 已确认路由。
  const isLead = (agent) => !!agent && activeTeamRoot(ctx, agent) === agent;
  const hardEnabled = (policy) => policy.fallbackToCurrentModel || policy.smartModels.length > 0;
  const dailyEnabled = (policy) => policy.allowedModels.length > 1;
  const canList = (policy) => dailyEnabled(policy) || hardEnabled(policy);
  const when = (enabled) => ({ agent }) => isLead(agent) && enabled(readPolicy(config));
  const hardGuidance = 'User-designated smarter models are best for unresolved or hard tasks and may consume more quota. Use daily teammates for routine work.';

  ctx.on('agent/created', async ({ agent, source, signal }) => {
    // 普通会话（包括从旧对话 fork 的对话）和所有恢复流程不访问 Team 或模型目录。
    const header = agent.session.header;
    if (source !== 'startup' || header.origin !== 'subagent' || !header.parentSession) return;
    // Hook 在子 Agent 进入 subagent 运行注册表之前触发；查询已存在的直属发起者，而非新子 Agent。
    const parent = ctx.agents.get(header.parentSession);
    if (!parent) return;
    const token = pending.getStore();
    const matches = token?.parent === parent;
    const root = activeTeamRoot(ctx, parent);
    if (!root) {
      if (matches) throw new Error('Team mode changed before teammate creation; request refused');
      return;
    }
    if (matches && (token.parent !== root || token.memberId !== undefined)) {
      throw new Error('Teammate route token does not match this creation');
    }
    const route = matches ? token.route : await resolveRoute(ctx.llm, selectRoute(readPolicy(config)), signal);
    signal?.throwIfAborted();
    agent.model.select({ ...route });
    bound.set(agent, Object.freeze({ ...route }));
    if (matches) token.memberId = header.id;
  });

  ctx.on('agent/request', async ({ agent }, next) => {
    const resolved = await next();
    const expected = bound.get(agent);
    // 请求准备阶段模型选择已经冻结；这里只检查，不覆盖其他中间件的结果。
    if (expected && ROUTE_KEYS.some((key) => resolved[key] !== expected[key])) {
      throw new Error('team-terra-ultra: teammate route was overridden; request refused');
    }
    return resolved;
  });

  ctx.tools.register({
    name: 'list_teammate_models',
    description: 'Inspect daily and hard-task teammate routes as Team Lead. No arguments: settings. provider + model: supported reasoning efforts for an available route.',
    parameters: { type: 'object', properties: {
      provider: { type: 'string', description: 'Exact provider ID; supply with model.' },
      model: { type: 'string', description: 'Exact allowed model ID; supply with provider.' },
    }, additionalProperties: false },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (!isLead(exec.agent)) throw new Error(LEAD_ONLY);
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
      const info = await ctx.llm.resolveModelInfo(route.provider, route.model, exec.signal);
      exec.signal?.throwIfAborted();
      return JSON.stringify({ provider: route.provider, model: info.id, name: info.name,
        reasoningEfforts: info.reasoning?.efforts ?? [], defaultEffort: info.reasoning?.defaultEffort ?? null });
    },
  }, { when: when(canList) });

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
        if (!isLead(exec.agent)) throw new Error(LEAD_ONLY);
        const policy = readPolicy(config);
        if (!enabled(policy)) throw new Error(hard ? 'Hard teammate creation is disabled' : 'Model selection tools require multiple allowed models');
        const nativeName = Object.hasOwn(NATIVE_TOOLS, args.context ?? 'fresh') ? NATIVE_TOOLS[args.context ?? 'fresh'] : undefined;
        if (!nativeName || !ctx.tools.executable(nativeName, exec.agent, exec.toolSet)) {
          throw new Error(`Native ${nativeName ?? 'delegation'} tool is not admitted for this step`);
        }
        // rc.5 的 agent.model.current() 与主窗口 pre-step 共用；不从子代理的原生首选模型反推。
        const selected = hard ? selectHardRoute(policy, args, policy.fallbackToCurrentModel ? exec.agent.model?.current?.() : undefined)
          : selectRoute(policy, args);
        const route = await resolveRoute(ctx.llm, selected, exec.signal);
        const token = { parent: exec.agent, route, memberId: undefined };
        const nativeArgs = { name: args.name, description: args.description, prompt: args.prompt };
        const value = await pending.run(token, () => invokeNative(pipeline, nativeName, nativeArgs, exec));
        if (!token.memberId) throw new Error('Native delegation did not bind a local teammate route; inspect the child before retrying');
        return { ...value, selected_route: { ...route } };
      },
    }, { when: when(enabled) });
  }
  registerSpawn(false);
  registerSpawn(true);
}
