/** 纯数据层：只给原生已授权的路由分组；不选择、排序或修改模型。 */
function exactRoutes(value) {
  if (!Array.isArray(value)) return undefined;
  const routes = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
    const { provider, model } = item;
    if (typeof provider !== 'string' || !provider || typeof model !== 'string' || !model) return undefined;
    routes.push({ provider, model });
  }
  return routes;
}

function routeKey({ provider, model }) {
  return JSON.stringify([provider, model]);
}

/**
 * 使用原生快照的顺序和标识；配置中不在快照内的项没有任何影响。
 * @param {unknown} policy 原生会话模型白名单；无效、缺失或为空时无建议。
 * @param {unknown} smartModels 用户标注的精确 provider/model 对；重复标注合并。
 * @returns {{ difficult: {provider: string, model: string}[], routine: {provider: string, model: string}[] } | undefined} 两组独立副本；没有授权困难候选时不提供分组，不比较实际能力。
 */
export function difficultyCandidates(policy, smartModels) {
  const allowed = exactRoutes(policy);
  const smart = exactRoutes(smartModels);
  if (!allowed?.length || !smart?.length || new Set(allowed.map(routeKey)).size !== allowed.length) return undefined;

  const smartKeys = new Set(smart.map(routeKey));
  const groups = { difficult: [], routine: [] };
  for (const route of allowed) {
    (smartKeys.has(routeKey(route)) ? groups.difficult : groups.routine).push(route);
  }
  return groups.difficult.length === 0 ? undefined : groups;
}
