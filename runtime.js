import { difficultyCandidates } from './routing.js';

// 0.2.2-rc.5：dsh-tool-subagent 的原生执行同样读取此会话投影。
// 该投影是 Host 内部状态，不在 wire snapshot；本插件不注册所有者的投影，也不修改返回值。
const POLICY_KEY = 'subagentModelSelectionPolicy';
const CONTEXT_NAME = 'team-terra-ultra:difficulty-candidates';

/** 仅检查本作用域可用的原生工具定义；不运行或包装任何一个工具。 */
function hasRouteFields(tool) {
  const properties = tool?.parameters?.properties;
  return properties?.provider?.type === 'string' && properties?.model?.type === 'string';
}

/**
 * 注册一段可省略的动态提示。配置与授权在每次组装时读取；不将 Agent 或会话保存到插件状态。
 * @param {object} ctx 提供 systemPrompt、sessionProjections 和 tools 的 Cordis 子作用域。
 * @param {object} config 插件配置；旧版本遗留字段不读取、不迁移、不改写。
 */
export function installAdvice(ctx, config) {
  ctx.systemPrompt.context({
    name: CONTEXT_NAME,
    order: 500,
    interpolate: false,
    text(context) {
      try {
        const { agent, scope, toolSet } = context;
        if (agent == null || scope !== agent || agent.session == null) return '';
        if (!hasRouteFields(ctx.tools.executable('subagent', scope, toolSet))
            && !hasRouteFields(ctx.tools.executable('subagent_fork', scope, toolSet))) return '';

        const allowed = ctx.sessionProjections.stateOf(agent.session, POLICY_KEY);
        // 老会话、原生未启用或投影未注册时均不可推断授权，尤其不能回退到当前模型。
        if (!Array.isArray(allowed) || !allowed.length) return '';
        const smart = config?.smartModels;
        const groups = difficultyCandidates(allowed, typeof smart?.get === 'function' ? smart.get() : (smart === undefined ? [] : smart));
        if (!groups) return '';

        const hasList = ctx.tools.executable('list_subagent_models', scope, toolSet) !== undefined;
        return [
          'Subagent difficulty candidates (advisory; exact provider/model pairs from this session’s native allowlist):',
          `Difficult tasks — user-designated candidates: ${JSON.stringify(groups.difficult)}.`,
          `Routine tasks — remaining authorized candidates: ${JSON.stringify(groups.routine)}.`,
          'These are user-defined labels, not measured capabilities. An empty group has no candidates. This advice does not change native defaults, model selection, reasoning effort, or tool authorization. An authorized route may not be available in the live catalog.',
          hasList ? 'Use native list_subagent_models for live availability and supported reasoning efforts; native delegation tools make the final admission decision.' : 'Native delegation tools make the final admission decision.',
        ].join('\n');
      } catch {
        // 可选能力失效时本轮静默；不得让诊断信息或异常影响原生对话。
        return '';
      }
    },
  });
}
