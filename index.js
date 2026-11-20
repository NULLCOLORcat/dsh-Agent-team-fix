import z from '@deepseek-ai/schemastery';
import { ToolExecutionPipeline } from '@deepseek-ai/dsh-tools/pipeline';
import { DEFAULT_POLICY } from './routing.js';
import { installRouting } from './runtime.js';

export const name = 'team-terra-ultra';
// Cordis 使用服务名数组；required/optional 分组会被误认作两个服务名，导致一直 pending。
export const inject = ['agents', 'agentTeams', 'subagents', 'llm', 'tools', 'settings'];
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
  ctx.effect(() => ctx.settings.configure({ auto: false }));
  installRouting(ctx, config, ToolExecutionPipeline);
}
