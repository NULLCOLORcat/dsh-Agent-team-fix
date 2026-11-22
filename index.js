import z from '@deepseek-ai/schemastery';
import { installAdvice } from './runtime.js';

export const name = 'team-terra-ultra';
const ModelRoute = z.object({ provider: z.string().min(1).required(), model: z.string().min(1).required() });

// 保留设置的持久化入口；Schemastery 可接收旧配置的额外字段，运行时只读 smartModels。
export const Config = z.object({
  smartModels: z.array(ModelRoute).default([]).volatile(),
});

/** 用两个独立子作用域等待可选服务；任一功能缺失不阻止原生 Host 或另一侧工作。 */
export function apply(ctx, config) {
  try {
    ctx.inject(['settings'], (scope) => {
      // 展示策略归属外层插件实例；注销则跟随依赖 settings 的子作用域。
      try { scope.effect(() => scope.settings.configure({ auto: false }, ctx.fiber)); }
      catch { /* 设置服务不可用时不影响动态建议。 */ }
    });
  } catch { /* 兼容缺少注入能力的 Host。 */ }

  try {
    ctx.inject(['systemPrompt', 'sessionProjections', 'tools'], (scope) => {
      try { installAdvice(scope, config); }
      catch { /* 注册失败时不影响其他提示和原生工具。 */ }
    });
  } catch { /* 可选扩展不可用时静默。 */ }
}
