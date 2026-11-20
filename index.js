import z from '@deepseek-ai/schemastery';
import { DEFAULT_POLICY } from './routing.js';
import { installRouting } from './runtime.js';

export const name = 'team-terra-ultra';
// 顶层只依赖设置服务。路由依赖另置子作用域，缺少 Team 服务时设置页仍可显示等待状态。
export const inject = ['settings'];
const routingServices = ['agents', 'agentTeams', 'subagents', 'llm', 'tools'];
const warning = 'team-terra-ultra: unsupported Team routing API；队友模型路由已停用，等待更新。';
const ModelRoute = z.object({ provider: z.string().min(1).required(), model: z.string().min(1).required() });

// volatile 设置经 Host configForms 持久化；新操作读取新值，已创建成员保留原路由。
export const Config = z.object({
  allowedModels: z.array(ModelRoute).min(1).default(DEFAULT_POLICY.allowedModels.map((route) => ({ ...route }))).volatile(),
  defaultModel: ModelRoute.default({ ...DEFAULT_POLICY.defaultModel }).volatile(),
  defaultReasoningEffort: z.string().default(DEFAULT_POLICY.defaultReasoningEffort).volatile(),
  smartModels: z.array(ModelRoute).default([]).volatile(),
  fallbackToCurrentModel: z.boolean().default(false).volatile(),
});

/** 保持原 entry ID 和设置命名空间；升级不搬迁用户配置或历史会话。 */
export function apply(ctx, config) {
  let status = 'waiting'; // 此激活独享；disabled 只能由插件显式重新加载清除。
  try { ctx.effect(() => ctx.settings.configure({ auto: false })); }
  catch { throw new Error('team-terra-ultra: settings API unavailable; teammate routing not installed.'); }
  ctx.inject(['connection'], function routingStatus(scope) {
    // rc.5 Connection 负责 owner 身份和 GET 路由生命周期；只返回枚举，不返回错误或配置。
    try {
      scope.effect(() => scope.connection.fetch.register({
        path: '/api/team-terra-ultra/status', methods: ['GET'], requestBody: 'buffered',
        fetch: () => Response.json({ status }, { headers: { 'cache-control': 'no-store' } }),
      }));
    } catch { throw new Error('team-terra-ultra: read-only routing status unavailable.'); }
  });
  ctx.inject(routingServices, async function teammateRouting(scope) {
    if (status === 'disabled') return;
    let live = true;
    scope.effect(() => () => { live = false; if (status !== 'disabled') status = 'waiting'; });
    try {
      // 动态导入失败不会破坏同步 Config 导出或阻止诊断卡注册。
      const { ToolExecutionPipeline } = await import('@deepseek-ai/dsh-tools/pipeline');
      if (!live) return;
      installRouting(scope, config, ToolExecutionPipeline, () => { if (live) status = 'disabled'; });
      if (status !== 'disabled') status = 'ready';
    } catch {
      if (!live) return;
      status = 'disabled';
      try { await scope.logger?.warn?.(warning); } catch { /* 日志故障不应影响 Host */ }
    }
  });
}
