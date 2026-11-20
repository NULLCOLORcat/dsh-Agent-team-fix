window.__ModuleLoader__.load({
  id: "dsh-agent-team-fix",
  factory: (require) => {
    "use strict";
    const React = require("react");
    const h = React.createElement;
    const NS = "team-terra-ultra";

    const PACKAGE = "dsh-agent-team-fix"; // 详情以包名索引；配置仍从迁移前的 NS 读取。
    // 参数与定义区：只编辑 Host 的五个顶层 volatile 字段，不控制插件启用状态。
    const routeKey = (route) => JSON.stringify([route?.provider, route?.model]);
    const routeCopy = (route) => ({ provider: route?.provider ?? "", model: route?.model ?? "" });
    function readValue(value) {
      return {
        allowedModels: (value?.allowedModels ?? []).map(routeCopy),
        defaultModel: routeCopy(value?.defaultModel),
        defaultReasoningEffort: value?.defaultReasoningEffort ?? "",
        smartModels: (value?.smartModels ?? []).map(routeCopy),
        fallbackToCurrentModel: value?.fallbackToCurrentModel === true
      };
    }
    function sameValue(a, b) {
      const left = a.allowedModels.map(routeKey).sort();
      const right = b.allowedModels.map(routeKey).sort();
      return JSON.stringify(left) === JSON.stringify(right) && routeKey(a.defaultModel) === routeKey(b.defaultModel)
        && a.defaultReasoningEffort === b.defaultReasoningEffort && a.fallbackToCurrentModel === b.fallbackToCurrentModel
        && JSON.stringify(a.smartModels.map(routeKey)) === JSON.stringify(b.smartModels.map(routeKey));
    }
    /** 将目录与草稿/已存路由合并；消失的模型仍显示且可移除，不猜测其推理档位。 */
    function candidates(groups, retained, selected) {
      const rows = new Map();
      for (const group of groups) for (const model of group.models ?? []) {
        const route = { provider: group.id, model: model.id };
        rows.set(routeKey(route), {
          ...route, key: routeKey(route), providerName: group.name ?? group.id,
          modelName: model.name ?? model.id, available: true, reasoning: model.reasoning,
          selected: selected.has(routeKey(route))
        });
      }
      for (const route of retained) if (!rows.has(routeKey(route))) rows.set(routeKey(route), {
        ...route, key: routeKey(route), providerName: route.provider, modelName: route.model,
        available: false, selected: selected.has(routeKey(route))
      });
      return [...rows.values()];
    }
    function makeStore(initial) {
      let snapshot = initial;
      const listeners = new Set();
      return { getSnapshot: () => snapshot, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
        set: (value) => { snapshot = value; for (const fn of listeners) fn(); } };
    }

    // 方法区：草稿和接受值分离；修订变化只标记冲突，绝不自动覆盖草稿。
    class TeamModelController {
      constructor(scope, ctx) {
        this.scope = scope; this.ctx = ctx;
        this.groups = []; this.catalogStatus = "idle"; this.catalogPartial = false;
        this.draft = undefined; this.draftRevision = undefined;
        this.saving = false; this.failed = false; this.conflicted = false;
        this.disposed = false; this.catalogGeneration = 0; this.saveGeneration = 0;
        this.store = makeStore(this.projection());
        this.unsubscribe = scope.subscribe(() => {
          if (this.draft && scope.getSnapshot().revision !== this.draftRevision && !this.saving) this.conflicted = true;
          this.publish();
        });
        this.loadCatalog();
      }
      current() { return readValue(this.scope.getSnapshot().value); }
      desired() { return this.draft ?? this.current(); }
      editable() { const s = this.scope.getSnapshot(); return !this.disposed && s.status === "ready" && s.writable && !this.saving; }
      beginDraft() {
        if (!this.draft) { this.draft = this.current(); this.draftRevision = this.scope.getSnapshot().revision; }
        this.failed = false;
        return this.draft;
      }
      rows(field = "allowedModels") {
        const routes = this.desired()[field];
        return candidates(this.groups, [...this.current()[field], ...routes], new Set(routes.map(routeKey)));
      }
      setFallback(on) {
        if (!this.editable()) return;
        this.beginDraft().fallbackToCurrentModel = on === true; // 切换只改变来源，不清空智能模型。
        this.publish();
      }
      toggleModel(key, field = "allowedModels") {
        if (!this.editable() || !["allowedModels", "smartModels"].includes(field)) return;
        if (field === "smartModels" && this.desired().fallbackToCurrentModel) return;
        const row = this.rows(field).find((item) => item.key === key);
        if (!row) return;
        const draft = this.beginDraft();
        if (draft[field].some((route) => routeKey(route) === key)) draft[field] = draft[field].filter((route) => routeKey(route) !== key);
        else draft[field].push(routeCopy(row));
        // 不偷偷重定向默认模型：取消默认模型时显示错误，要求用户明确选择。
        this.publish();
      }
      selectDefault(key) {
        if (!this.editable()) return;
        const route = this.desired().allowedModels.find((route) => routeKey(route) === key);
        if (!route) return;
        const draft = this.beginDraft();
        if (routeKey(route) !== routeKey(draft.defaultModel)) {
          draft.defaultModel = routeCopy(route);
          draft.defaultReasoningEffort = ""; // 旧路由的档位不能泄漏到新路由；空值采用新路由公布的默认值。
        }
        this.publish();
      }
      selectEffort(effort) {
        if (!this.editable()) return;
        const row = this.rows().find((row) => row.key === routeKey(this.desired().defaultModel));
        if (effort !== "" && !row?.reasoning?.efforts?.some((item) => item.id === effort)) return;
        this.beginDraft().defaultReasoningEffort = effort;
        this.publish();
      }
      /** 用户检查冲突后显式更新 fence；保留完整草稿，不进行隐式合并或再次发送。 */
      rebase() {
        if (!this.editable()) return;
        this.draftRevision = this.scope.getSnapshot().revision;
        this.conflicted = false; this.failed = false; this.publish();
      }
      async save() {
        const state = this.projection();
        if (!this.editable() || !state.dirty || state.invalid || this.conflicted) return;
        if (this.scope.getSnapshot().revision !== this.draftRevision) { this.conflicted = true; this.publish(); return; }
        const desired = readValue(this.desired());
        const generation = ++this.saveGeneration;
        this.saving = true; this.failed = false; this.publish();
        try {
          // 一次原子写入五个字段，共享 namespace revision fence。
          const response = await this.scope.mutate([
            { op: "set", path: ["allowedModels"], value: desired.allowedModels },
            { op: "set", path: ["defaultModel"], value: desired.defaultModel },
            { op: "set", path: ["defaultReasoningEffort"], value: desired.defaultReasoningEffort },
            { op: "set", path: ["smartModels"], value: desired.smartModels },
            { op: "set", path: ["fallbackToCurrentModel"], value: desired.fallbackToCurrentModel }
          ], this.draftRevision);
          if (this.disposed || generation !== this.saveGeneration) return;
          const landed = response?.ok !== false && this.scope.getSnapshot().status === "ready" && sameValue(this.current(), desired);
          this.saving = false; this.failed = !landed;
          if (landed) { this.draft = undefined; this.draftRevision = undefined; this.conflicted = false; }
          else if (this.scope.getSnapshot().revision !== this.draftRevision) this.conflicted = true;
        } catch (_) {
          if (this.disposed || generation !== this.saveGeneration) return;
          this.saving = false; this.failed = true;
          if (this.scope.getSnapshot().revision !== this.draftRevision) this.conflicted = true;
        }
        this.publish();
      }
      async loadCatalog() {
        if (this.disposed || this.catalogStatus === "loading") return;
        const generation = ++this.catalogGeneration;
        this.catalogStatus = "loading"; this.publish();
        try {
          const response = await this.ctx.remote.session.modelCatalog();
          if (this.disposed || generation !== this.catalogGeneration) return;
          if (!response?.ok) throw new Error("model catalog unavailable");
          this.groups = response.value.groups ?? [];
          this.catalogPartial = (response.value.failures ?? []).length > 0;
          this.catalogStatus = "ready";
        } catch (_) {
          if (this.disposed || generation !== this.catalogGeneration) return;
          this.catalogStatus = "error";
        }
        this.publish();
      }
      refreshCatalog() {
        if (this.disposed) return;
        ++this.catalogGeneration; this.catalogStatus = "idle";
        // 旧目录不再授权可选档位；已选模型通过 retained 路径继续显示。
        this.groups = []; this.catalogPartial = false; this.loadCatalog();
      }
      resetConnection() {
        if (this.disposed) return;
        ++this.saveGeneration; this.saving = false;
        if (this.draft) { this.conflicted = true; this.failed = true; }
        this.refreshCatalog(); // 连接重置保留草稿；迟到的旧 Host 响应不能修改状态。
      }
      projection() {
        const snapshot = this.scope.getSnapshot();
        const value = this.desired();
        const rows = this.rows();
        const route = rows.find((row) => row.key === routeKey(value.defaultModel));
        const empty = value.allowedModels.length === 0;
        const missingDefault = !value.allowedModels.some((route) => routeKey(route) === routeKey(value.defaultModel));
        const invalidEffort = !!value.defaultReasoningEffort && !!route?.available && !route.reasoning?.efforts?.some((effort) => effort.id === value.defaultReasoningEffort);
        return { available: snapshot.status === "ready", writable: !!snapshot.writable, value, rows, smartRows: this.rows("smartModels"),
          dirty: !!this.draft && !sameValue(this.current(), value), hasDraft: !!this.draft,
          empty, missingDefault, invalidEffort, invalid: empty || missingDefault || invalidEffort,
          saving: this.saving, failed: this.failed, conflicted: this.conflicted,
          catalogStatus: this.catalogStatus, catalogPartial: this.catalogPartial,
          defaultRoute: route, multi: value.allowedModels.length > 1 };
      }
      publish() { if (!this.disposed) this.store.set(this.projection()); }
      dispose() { this.disposed = true; ++this.catalogGeneration; ++this.saveGeneration; this.unsubscribe(); }
      inject() {
        return { hooks: { teamModelCard: this.store }, controller: this };
      }
    }

    const css = `.team-terra-settings{color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;min-width:0}.team-terra-settings section{padding:16px 0}.team-terra-settings h3{font-size:13px;font-weight:600;margin:0 0 8px}.team-terra-settings p{margin:6px 0;color:var(--dsw-alias-label-secondary)}.team-terra-settings fieldset{border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-lg);margin:12px 0;padding:10px;min-width:0;max-height:280px;overflow:auto}.team-terra-settings legend{font-weight:600;margin-bottom:8px}.team-terra-settings .group{margin:12px 0}.team-terra-settings .provider{font-weight:600;margin-bottom:6px}.team-terra-settings .model{display:flex;align-items:center;gap:10px;padding:7px 0;cursor:pointer}.team-terra-settings .route{display:block;color:var(--dsw-alias-label-secondary);font-size:12px;overflow-wrap:anywhere}.team-terra-settings input{accent-color:var(--dsw-alias-brand-primary)}.team-terra-settings .field{display:grid;gap:6px;margin:14px 0}.team-terra-settings select,.team-terra-settings button{font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-4);border:1px solid var(--dsw-alias-border-l4);border-radius:8px;padding:7px 10px;max-width:100%}.team-terra-settings select{width:100%}.team-terra-settings button{cursor:pointer}.team-terra-settings button:disabled,.team-terra-settings fieldset:disabled{opacity:.55}.team-terra-settings button:disabled,.team-terra-settings fieldset:disabled label{cursor:not-allowed}.team-terra-settings :focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.team-terra-settings .warning{color:var(--dsw-alias-label-primary);border-left:2px solid var(--dsw-alias-border-l4);padding-left:10px}.team-terra-settings footer{display:flex;gap:10px;align-items:center;padding-top:12px}`;

    /** 两个独立的选择集合共用同一目录请求和原生控件；已下架项不混入另一个集合。 */
    function modelList(rows, legend, disabled, toggle, ready) {
      const groups = new Map();
      for (const row of rows) {
        const key = row.available ? row.provider : null;
        if (!groups.has(key)) groups.set(key, { label: row.available ? row.providerName : "已保存但当前不可用", rows: [] });
        groups.get(key).rows.push(row);
      }
      return h("fieldset", { disabled }, h("legend", null, legend),
        [...groups].map(([key, group]) => h("div", { className: "group", key: JSON.stringify(key) },
          h("div", { className: "provider" }, group.label),
          group.rows.map((row) => h("label", { className: "model", key: row.key },
            h("input", { type: "checkbox", checked: row.selected, onChange: () => toggle(row.key) }),
            h("span", null, row.modelName, h("span", { className: "route" }, `${row.providerName} · ${row.provider}/${row.model}`)),
            !row.available && h("span", { className: "route" }, "当前不可用"))))),
        !rows.length && ready && h("p", null, "当前没有提供方公布模型。"));
    }
    /** 详情页挂载和手动刷新时读取 Host 只读状态；卡片卸载/换次请求后丢弃迟到的响应。 */
    function RoutingStatus() {
      const [status, setStatus] = React.useState('loading');
      const [revision, refresh] = React.useReducer(n => n + 1, 0);
      React.useEffect(() => {
        let live = true;
        const controller = new AbortController();
        async function load() {
          try {
            // 与 rc.5 Connection 相同：优先桌面壳载体，Web 使用同源相对 URL（保留部署前缀）。
            const send = window.__DSH_TRANSPORT__?.fetch ?? globalThis.fetch;
            const response = await send('api/team-terra-ultra/status', { method: 'GET', cache: 'no-store', signal: controller.signal });
            const state = response.ok && (await response.json()).status;
            if (live) setStatus(['ready', 'waiting', 'disabled'].includes(state) ? state : 'unknown');
          } catch { if (live) setStatus('unknown'); }
        }
        load();
        return () => { live = false; controller.abort(); };
      }, [revision]);
      const labels = { ready: '队友模型路由已就绪。', waiting: '队友模型路由尚未启用，正在等待 Host 路由服务。',
        disabled: '队友模型路由已停用：当前 Host 接口不兼容。请检查插件与 DSH 版本，更新后重新加载插件。',
        unknown: '无法读取队友模型路由状态；请检查插件管理器的 Host 状态。', loading: '正在读取队友模型路由状态…' };
      return h('div', null, h('p', { className: 'warning', role: status === 'disabled' ? 'alert' : 'status' }, labels[status]),
        h('button', { type: 'button', onClick: refresh }, '刷新路由状态'));
    }
    function TeamModelCard(props) {
      const state = props.useTeamModelCard((snapshot) => snapshot);
      const c = props.controller;
      const id = React.useId();
      if (props.view === "summary") return null;
      const disabled = !state.available || !state.writable || state.saving;
      const notice = (text, alert = false) => h("p", { className: "warning", role: alert ? "alert" : "status" }, text);
      const selected = state.rows.filter((row) => row.selected);
      const efforts = state.defaultRoute?.reasoning?.efforts ?? [];
      const effort = state.value.defaultReasoningEffort;
      return h("form", { className: "team-terra-settings", onSubmit: (event) => { event.preventDefault(); c.save(); } },
        h(RoutingStatus),
        h("section", null, h("h3", null, "日常任务模型"),
          !state.available && notice("该插件当前未加载或设置尚未就绪；草稿会保留。"),
          state.available && !state.writable && notice("本部署的设置为只读。"),
          state.catalogStatus === "loading" && notice("正在加载模型…"),
          state.catalogStatus === "error" && notice("无法加载模型目录；已有选择仍会保留。", true),
          (state.catalogStatus === "error" || state.catalogPartial) && h("button", { type: "button", disabled: state.saving, onClick: () => c.refreshCatalog() }, "重试模型目录"),
          state.catalogPartial && notice("部分提供方暂时无法加载；已保存的模型仍可移除。"),
          modelList(state.rows, "允许队长选择的模型", disabled, (key) => c.toggleModel(key), state.catalogStatus === "ready"),
          h("div", { className: "field" }, h("label", { htmlFor: id + "-model" }, "默认模型"),
            h("select", { id: id + "-model", value: routeKey(state.value.defaultModel), disabled, onChange: (e) => c.selectDefault(e.target.value) },
              state.missingDefault && h("option", { value: routeKey(state.value.defaultModel), disabled: true }, "请选择已选模型"),
              selected.map((row) => h("option", { value: row.key, key: row.key }, `${row.providerName} / ${row.modelName}${row.available ? "" : "（当前不可用）"}`)))),
          h("div", { className: "field" }, h("label", { htmlFor: id + "-effort" }, "默认推理强度（仅用于默认路由）"),
            h("select", { id: id + "-effort", value: effort, disabled, onChange: (e) => c.selectEffort(e.target.value) },
              h("option", { value: "" }, `使用模型公布的默认值${state.defaultRoute?.reasoning?.defaultEffort ? `（${state.defaultRoute.reasoning.defaultEffort}）` : ""}`),
              effort && !efforts.some((item) => item.id === effort) && h("option", { value: effort, disabled: true }, `${effort}（已保存；当前目录未公布）`),
              efforts.map((item) => h("option", { value: item.id, key: item.id }, item.name ? `${item.name} · ${item.id}` : item.id)))),
          state.empty && notice("保存前请至少选择一个模型。", true),
          state.missingDefault && notice("默认模型必须在已选模型中。", true),
          state.invalidEffort && notice("当前默认模型不支持已选推理强度，请重新选择。", true)),
        h("section", null, h("h3", null, "更聪明的模型"),
          h("label", { className: "model" }, h("input", { type: "checkbox", checked: state.value.fallbackToCurrentModel,
            disabled, onChange: (event) => c.setFallback(event.target.checked) }), "高复杂度回退至当前模型"),
          modelList(state.smartRows, "高复杂度任务候选模型（可多选）", disabled || state.value.fallbackToCurrentModel,
            (key) => c.toggleModel(key, "smartModels"), state.catalogStatus === "ready"),
          state.available && h("span", { className: "route", role: "status" }, state.value.fallbackToCurrentModel
            ? "使用当前模型 · 保留候选选择" : state.value.smartModels.length ? `已选 ${state.value.smartModels.length} 个候选模型` : "未启用高复杂度回退")),
        h("div", null,
          state.conflicted && h("div", null, notice("设置已在其他位置更新或连接已重置。草稿未丢失；请检查当前草稿后明确确认继续。", true),
            h("button", { type: "button", disabled, onClick: () => c.rebase() }, "保留草稿，基于最新修订继续")),
          state.failed && notice("保存未确认成功。草稿已保留，未自动重试。", true),
          h("footer", null, h("button", { type: "submit", disabled: disabled || !state.dirty || state.invalid || state.conflicted }, state.saving ? "保存中…" : "保存"),
            h("span", { className: "route", role: "status" }, state.hasDraft ? "存在未清除的本地草稿" : "设置已同步"))));
    }

    const inject = ["slots", "remote", "remote.session", "configForms"];
    function apply(ctx) {
      ctx.effect(() => {
        const tag = document.createElement("style"); tag.dataset.plugin = PACKAGE; tag.textContent = css;
        document.head.appendChild(tag); return () => tag.remove();
      }, "team-terra-ultra: theme");
      const controller = new TeamModelController(ctx.configForms.get(NS), ctx);
      ctx.effect(() => () => controller.dispose(), "team-terra-ultra: settings subscription");
      ctx.effect(() => ctx.remote.$on("llm/adapters-updated", () => controller.refreshCatalog()), "team-terra-ultra: adapters");
      ctx.effect(() => ctx.remote.$on("settings/document-updated", () => controller.refreshCatalog()), "team-terra-ultra: catalog settings");
      ctx.effect(() => ctx.on("connection/reset", () => controller.resetConnection()), "team-terra-ultra: connection");
      ctx.effect(() => ctx.configForms.whileServed([NS], () => ctx.slots.inject("plugins.bundle.config", () => ctx.slots.register({
        name: "plugins.bundle.config", key: PACKAGE, inject: () => controller.inject()
      }, TeamModelCard))), "team-terra-ultra: settings page");
    }
    return { default: { apply, inject }, apply, inject, TeamModelController, routeKey, readValue, sameValue, candidates };
  }
});
