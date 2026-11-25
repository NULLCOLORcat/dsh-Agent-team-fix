/** 原生路由和模型元数据的纯数据边界；不推测别名、默认路由或 effort 等级。 */
export function selectionOf(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const { provider, model, reasoningEffort } = value;
  if (typeof provider !== 'string' || !provider || typeof model !== 'string' || !model
      || (reasoningEffort !== undefined && (typeof reasoningEffort !== 'string' || !reasoningEffort))) return undefined;
  return { provider, model, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) };
}

export function routeKey({ provider, model }) {
  return JSON.stringify([provider, model]);
}

export function sameSelection(a, b) {
  return !!a && !!b && a.provider === b.provider && a.model === b.model && a.reasoningEffort === b.reasoningEffort;
}

/** 记录的白名单必须有效且没有重复；配置标注中的重复项可以合并。 */
function exactRoutes(value, allowDuplicates) {
  if (!Array.isArray(value)) return undefined;
  const keys = new Set();
  const routes = [];
  for (const item of value) {
    const selection = selectionOf(item);
    if (!selection) return undefined;
    const { provider, model } = selection;
    const key = routeKey(selection);
    if (keys.has(key)) {
      if (!allowDuplicates) return undefined;
      continue;
    }
    keys.add(key);
    routes.push({ provider, model });
  }
  return routes;
}

/** 保留原生记录的顺序；空白名单不是授权，也不使用原生父模型兜底。 */
export function groupRoutes(policy, smartModels) {
  const allowed = exactRoutes(policy, false);
  const smart = exactRoutes(smartModels, true);
  if (!allowed?.length || !smart) return undefined;
  const smartKeys = new Set(smart.map(routeKey));
  const groups = { difficult: [], routine: [] };
  for (const route of allowed) groups[smartKeys.has(routeKey(route)) ? 'difficult' : 'routine'].push(route);
  return groups;
}

/** 自动分类仅在用户设置了非空 smart 分组且存在原生白名单时生效。 */
export function classifiedGroups(policy, smartModels) {
  return smartModels?.length ? groupRoutes(policy, smartModels) : undefined;
}


/** 原生 rc.5 的 efforts 按能力由低到高排列；缺少或不合规时不猜测。 */
export function effortIds(info) {
  const efforts = info?.reasoning?.efforts;
  if (!Array.isArray(efforts) || efforts.length === 0) return [];
  const ids = efforts.map(item => item?.id);
  return ids.every(id => typeof id === 'string' && id.length > 0) && new Set(ids).size === ids.length ? ids : [];
}
