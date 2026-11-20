/** 团队成员路由策略。纯逻辑不依赖 Host，供设置、创建入口及测试共享。 */
export const DEFAULT_ROUTE = Object.freeze({ provider: 'openai-codex', model: 'gpt-6.1-terra' });
export const DEFAULT_POLICY = Object.freeze({
  allowedModels: Object.freeze([DEFAULT_ROUTE]),
  defaultModel: DEFAULT_ROUTE,
  defaultReasoningEffort: 'ultra',
  smartModels: Object.freeze([]),
  fallbackToCurrentModel: false,
});

/** provider/model 采用精确标识；不以模型名猜供应商，也不允许重复条目。 */
export function routeKey(route) {
  return JSON.stringify([route.provider, route.model]);
}
function exactRoute(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || typeof value.provider !== 'string' || !value.provider.trim()
      || typeof value.model !== 'string' || !value.model.trim()) {
    throw new Error(`${label} requires non-empty provider and model ids`);
  }
  return { provider: value.provider, model: value.model };
}

/** 获取一次操作的独立策略快照；0 个模型或默认模型不在白名单时拒绝，不继承队长模型。 */
export function readPolicy(config = DEFAULT_POLICY) {
  const read = (key) => typeof config[key]?.get === 'function' ? config[key].get() : config[key];
  const candidates = read('allowedModels') ?? DEFAULT_POLICY.allowedModels;
  if (!Array.isArray(candidates) || candidates.length === 0) throw new Error('Select at least one allowed teammate model');
  const allowedModels = candidates.map((route) => exactRoute(route, 'allowedModels'));
  const keys = new Set(allowedModels.map(routeKey));
  if (keys.size !== allowedModels.length) throw new Error('Duplicate allowed teammate model');
  const defaultModel = exactRoute(read('defaultModel') ?? DEFAULT_POLICY.defaultModel, 'defaultModel');
  if (!keys.has(routeKey(defaultModel))) throw new Error('Default teammate model must be selected in allowedModels');
  const defaultReasoningEffort = read('defaultReasoningEffort') ?? DEFAULT_POLICY.defaultReasoningEffort;
  if (typeof defaultReasoningEffort !== 'string' || (defaultReasoningEffort && !defaultReasoningEffort.trim())) {
    throw new Error('defaultReasoningEffort must be an effort id or an empty string');
  }
  const smart = read('smartModels');
  if (smart !== undefined && !Array.isArray(smart)) throw new Error('smartModels must be an array');
  const smartModels = (smart ?? []).map((route) => exactRoute(route, 'smartModels'));
  if (new Set(smartModels.map(routeKey)).size !== smartModels.length) throw new Error('Duplicate smart teammate model');
  const fallback = read('fallbackToCurrentModel');
  if (fallback !== undefined && typeof fallback !== 'boolean') throw new Error('fallbackToCurrentModel must be boolean');
  return { allowedModels, defaultModel, defaultReasoningEffort, smartModels, fallbackToCurrentModel: fallback ?? false };
}

/** 困难任务独立于日常名单和默认强度。回退时只接受主窗口快照，不向旧请求授予改选权。 */
export function selectHardRoute(policy, request, current) {
  if (policy.fallbackToCurrentModel) {
    const route = exactRoute(current, 'Current main-window model');
    return { ...route, ...(current.reasoningEffort === undefined ? {} : { reasoningEffort: current.reasoningEffort }) };
  }
  if (!policy.smartModels.length) throw new Error('Hard teammate creation is disabled');
  const route = exactRoute(request, 'Hard teammate selection');
  if (!policy.smartModels.some((item) => routeKey(item) === routeKey(route))) throw new Error('Requested hard teammate model is not in smartModels');
  const effort = request.reasoning_effort;
  if (effort !== undefined && (typeof effort !== 'string' || !effort.trim())) throw new Error('reasoning_effort must be a non-empty effort id');
  return { ...route, ...(effort === undefined ? {} : { reasoningEffort: effort }) };
}

/** 单选只接受固定路由；多选允许精确选模型。省略模型使用配置默认，换模型不继承默认模型的强度。 */
export function selectRoute(policy, request = {}) {
  if ((request.provider === undefined) !== (request.model === undefined)) throw new Error('provider and model must be supplied together');
  const chosen = request.provider === undefined ? { ...policy.defaultModel } : exactRoute(request, 'teammate route');
  if (!policy.allowedModels.some((route) => routeKey(route) === routeKey(chosen))) throw new Error('Requested teammate model is not allowed');
  if (policy.allowedModels.length === 1 && request.reasoning_effort !== undefined) throw new Error('Single-model mode fixes reasoning effort in settings');
  const isDefault = routeKey(chosen) === routeKey(policy.defaultModel);
  const effort = request.reasoning_effort ?? (isDefault ? policy.defaultReasoningEffort : '');
  if (typeof effort !== 'string' || (request.reasoning_effort !== undefined && !effort.trim())) throw new Error('reasoning_effort must be a non-empty effort id');
  return { ...chosen, ...(effort ? { reasoningEffort: effort } : {}) };
}

/** 使用目标模型自己的目录验证强度并解析其默认值；不支持的显式值直接报错。 */
export async function resolveRoute(llm, route, signal) {
  signal?.throwIfAborted();
  const info = await llm.resolveModelInfo(route.provider, route.model, signal);
  if (info.id !== route.model) throw new Error('LLM resolved a different teammate model; request refused');
  if (route.reasoningEffort !== undefined && !info.reasoning?.efforts.some((effort) => effort.id === route.reasoningEffort)) {
    throw new Error(`Model ${route.provider}/${route.model} does not support reasoning effort ${route.reasoningEffort}`);
  }
  const resolved = await llm.resolveCallConfig({ ...route }, signal);
  signal?.throwIfAborted();
  if (resolved.provider !== route.provider || resolved.model !== route.model) throw new Error('LLM changed the teammate route; request refused');
  if (route.reasoningEffort !== undefined && resolved.reasoningEffort !== route.reasoningEffort) throw new Error('LLM changed the teammate effort; request refused');
  return { provider: route.provider, model: route.model,
    ...(resolved.reasoningEffort === undefined ? {} : { reasoningEffort: resolved.reasoningEffort }) };
}
