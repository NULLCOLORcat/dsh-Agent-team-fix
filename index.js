import z from '@deepseek-ai/schemastery';
import { installAdvice, installModeRuntime } from './runtime.js';
import { modeDomainSpec, modeStore, riceEnabled, sessionModeHandler, SESSION_MODE_PATH } from './session-modes.js';

export const name = 'team-terra-ultra';
const ModelRoute = z.object({ provider: z.string().min(1).required(), model: z.string().min(1).required() });

// 保留旧版配置入口；节俭默认开启以保留已有安装的饭碗入口。
export const Config = z.object({
  smartModels: z.array(ModelRoute).default([]).volatile(),
  strictDifficulty: z.boolean().default(false).volatile(),
  prayerEnabled: z.boolean().default(false).volatile(),
  riceEnabled: z.boolean().default(true).volatile(),
});

const ADVICE_SERVICES = ['systemPrompt', 'sessionProjections', 'tools', 'agents', 'subagents', 'llm'];
const MODE_SERVICES = ['storageDomain', 'tools', 'subagents', 'sessionProjections', 'llm', 'agents'];

/** 分别等待设置、提示、模式服务；可选扩展失败时原生对话仍可用。 */
export function apply(ctx, config) {
  let current;
  const modeView = {
    get available() { return current?.runtime.available === true; },
    peek: id => current?.store.peek(id) ?? { mode: 'normal', revision: 0 },
    async read(id) { return this.peek(id); },
  };
  function mount(services, apply) {
    try { ctx.inject(services, apply); }
    catch { /* 不将扩展注册异常传播到 Host。 */ }
  }
  mount(['settings'], scope => {
    // 展示策略归属外层插件实例；注销跟随依赖 settings 的子作用域。
    try { scope.effect(() => scope.settings.configure({ auto: false }, ctx.fiber)); }
    catch { /* 设置服务不可用时不影响动态建议。 */ }
  });
  mount(ADVICE_SERVICES, scope => {
    try { installAdvice(scope, config, modeView); }
    catch { /* 提示失败时由原生工具自行工作。 */ }
  });
  mount(MODE_SERVICES, async scope => {
    let live = true, domain, binding, riceReset;
    scope.effect(() => async () => {
      live = false;
      if (current === binding) current = undefined;
      await riceReset;
      await domain?.close();
    });
    try {
      const [storage, { z: schema }, { ToolExecutionPipeline }] = await Promise.all([
        import('@deepseek-ai/dsh-storage-domain'), import('zod'), import('@deepseek-ai/dsh-tools/pipeline'),
      ]);
      if (!live) return;
      domain = await scope.storageDomain.open(modeDomainSpec(storage, schema));
      if (!live) { await domain.close(); return; }
      const store = modeStore(domain);
      const runtime = installModeRuntime(scope, config, store, ToolExecutionPipeline);
      binding = { store, runtime };
      let wasRiceEnabled = true;
      function syncRiceSetting() {
        const enabled = riceEnabled(config);
        const turnedOff = wasRiceEnabled && !enabled;
        wasRiceEnabled = enabled;
        if (!live || !turnedOff) return;
        const reset = store.clearRice();
        riceReset = reset.catch(() => {}); // 卸载等待持久清理，不等待远程模型目录。
        void (async () => {
          const { roots, failed } = await reset;
          if (failed) scope.logger('team-terra-ultra').warn('Some Rice mode records could not be cleared.');
          // 只同步内存中已加载的成员；归档成员仍在原生恢复时核对自己的记录。
          for (const id of roots) {
            if (!live) return;
            const result = await runtime.reconcile(id);
            if (result.failed || result.skipped) scope.logger('team-terra-ultra').warn('Some Rice mode members could not be restored.');
          }
        })().catch(() => { if (live) scope.logger('team-terra-ultra').warn('Rice mode reset failed.'); });
      }
      scope.on('settings/document-updated', ns => { if (ns === name) syncRiceSetting(); });
      syncRiceSetting();
      current = binding;
      scope.inject(['connection', 'sessionPersistence'], api => {
        try {
          api.effect(() => api.connection.fetch.register({
            path: SESSION_MODE_PATH,
            methods: ['GET', 'POST'],
            requestBody: 'buffered',
            fetch: sessionModeHandler({ config, store, runtime, persistence: api.sessionPersistence, active: () => live }),
          }));
        } catch { /* UI 无法读写时保留现有状态，不猜测用户意图。 */ }
      });
    } catch {
      try { scope.logger?.warn?.('team-terra-ultra: session-mode services unavailable'); }
      catch { /* 日志也属于可选能力。 */ }
    }
  });
}
