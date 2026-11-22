window.__ModuleLoader__.load({
  id: "dsh-agent-team-fix",
  factory: (require) => {
    "use strict";
    const React = require("react");
    const h = React.createElement;
    const NS = "team-terra-ultra";
    // rc.5 官方子智能体模型选择表单；只订阅已接受的值，不触碰官方草稿或写入 API。
    const OFFICIAL_NS = "subagent-model-selection-settings";
    const SLOT = "plugins.detail.section";
    const LOCALE_NS = "team-terra-ultra.difficulty-models";
    const routeKey = ({ provider, model }) => JSON.stringify([provider, model]);

    const copy = {
      en: {
        title: "Difficulty Models",
        intro: "Enable model choice and save the allowed models in Model selection above. Then choose which of those models to recommend for difficult tasks here (optional). This does not change the official allowlist or set a default model.",
        session: "These lists show provider and model IDs from the currently saved settings and your draft. DSH rc.5 snapshots model authorization at session start: start a new session after saving changes above. An open session can still have a different allowlist.",
        hard: "Difficult-task models", weak: "Other allowed models", weakHelp: "Can be suggested for routine tasks. These groups do not restrict native model choice.",
        noWeak: "No other allowed models.", noAllowed: "No allowed models. Add models and save in Model selection above first.",
        off: "Model choice is off in the official settings. Enable it and save above to add difficult-task models. Existing selections can be removed here.",
        retained: "No longer allowed · remove to save", invalid: "Remove the selections no longer allowed above before saving.",
        offDraft: "Model choice was turned off. Remove any new selections from your draft, or enable model choice above before saving.",
        loading: "Loading model settings…", unavailable: "Difficulty Models settings are unavailable on this host.",
        officialUnavailable: "The official Model selection settings are unavailable. Changes here cannot be saved.",
        readOnly: "This deployment stores settings read-only.", conflict: "Settings changed elsewhere or the connection reset. Your draft was kept. Review the candidates after merging your changes and before saving.",
        failed: "Saving was not confirmed. Your draft was kept and was not retried.",
        rebase: "Merge my changes with latest settings", discard: "Discard changes", save: "Save difficulty models", saving: "Saving…", saved: "Difficulty models saved.",
        savedStale: "Saved, but the official allowlist changed. Review the selections no longer allowed.", dirty: "Unsaved changes",
      },
      zh: {
        title: "任务难度模型",
        intro: "请先在上方「模型选择」中开启模型选择、勾选允许使用的模型并保存，再从中选择困难任务模型。这里不修改官方白名单，也不设置默认模型。",
        session: "下方按提供方和模型的 ID 显示当前已保存的设置与本地草稿。DSH rc.5 在会话启动时记录模型授权：修改并保存上方白名单后，请新建会话。已打开的会话仍可能使用不同的白名单。",
        hard: "困难任务模型", weak: "其他已授权模型", weakHelp: "可用于日常任务推荐。这两组不会限制原生选模。",
        noWeak: "没有其他已授权模型。", noAllowed: "当前没有允许的模型。请先在上方「模型选择」中添加模型并保存。",
        off: "官方模型选择尚未开启。若要添加困难任务模型，请先在上方开启并保存；已有选择仍可在这里移除。",
        retained: "已不在白名单 · 可移除", invalid: "请先移除已不在上方白名单的选项，再保存。",
        offDraft: "官方模型选择已关闭。请取消草稿中新勾选的项，或在上方开启模型选择后再保存。",
        loading: "正在加载模型设置…", unavailable: "此 Host 的任务难度模型设置不可用。",
        officialUnavailable: "官方「模型选择」设置不可用，暂时无法保存这里的修改。",
        readOnly: "本部署的设置为只读。", conflict: "设置已在其他位置更新，或连接已重置。草稿已保留。合并到最新设置后，请检查候选名单再保存。",
        failed: "未确认保存成功。草稿已保留，未自动重试。",
        rebase: "将我的修改合并到最新设置", discard: "放弃修改", save: "保存困难任务模型", saving: "保存中…", saved: "困难任务模型已保存。",
        savedStale: "已保存，但官方白名单已变更。请检查不再允许的选项。", dirty: "有未保存的修改",
      },
    };

    /** 以 provider/model 对为单位去重；未知表单形状返回 undefined，禁止编辑旧快照。 */
    function readRoutes(value) {
      if (!Array.isArray(value)) return undefined;
      const unique = new Map();
      for (const route of value) {
        if (typeof route?.provider !== "string" || !route.provider || typeof route?.model !== "string" || !route.model) return undefined;
        unique.set(routeKey(route), { provider: route.provider, model: route.model });
      }
      return [...unique.values()];
    }
    function sameRoutes(a, b) {
      if (a.length !== b.length) return false;
      const keys = new Set(b.map(routeKey));
      return a.every((route) => keys.has(routeKey(route)));
    }
    function makeStore(initial) {
      let snapshot = initial;
      const listeners = new Set();
      return { getSnapshot: () => snapshot, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
        set: (value) => { snapshot = value; for (const fn of listeners) fn(); } };
    }

    // 控制器：草稿和已接受的设置分离，仅 own.mutate 可以写值；官方表单是只读授权来源。
    class TeamModelController {
      constructor(own, official) {
        this.own = own;
        this.official = official;
        this.draft = undefined;
        this.draftRevision = undefined;
        this.draftBase = undefined; // 初次编辑时已接受的路由，用于只合并实际增删。
        this.saving = false;
        this.disposed = false;
        this.feedback = undefined;
        this.conflicted = false;
        this.saveGeneration = 0;
        this.store = makeStore(this.projection());
        this.unsubscribeOwn = own.subscribe(() => {
          if (this.draft && !this.saving && own.getSnapshot().revision !== this.draftRevision) this.conflicted = true;
          this.publish();
        });
        this.unsubscribeOfficial = official.subscribe(() => this.publish());
      }
      projection() {
        const own = this.own.getSnapshot();
        const official = this.official.getSnapshot();
        const stored = readRoutes(own.value?.smartModels);
        const allowed = official.status === "ready" && typeof official.value?.enabled === "boolean"
          ? readRoutes(official.value.allowedModels) : undefined;
        const officialEnabled = allowed !== undefined && official.value.enabled;
        const authorized = officialEnabled ? allowed : [];
        const desired = this.draft ?? stored ?? [];
        const allowedKeys = new Set(allowed?.map(routeKey));
        const stale = allowed !== undefined && desired.some((route) => !allowedKeys.has(routeKey(route)));
        const offDraft = allowed !== undefined && !officialEnabled && !!this.draft
          && desired.some((route) => !stored?.some((candidate) => routeKey(candidate) === routeKey(route)));
        const authorizedKeys = new Set(authorized.map(routeKey));
        const selectedKeys = new Set(desired.map(routeKey));
        // 未授权的已有选项仍显示以便清理；不会凭历史配置创建新的授权。
        const rows = [...(allowed ?? []), ...desired.filter((route) => !allowedKeys.has(routeKey(route)))].map((route) => {
          const key = routeKey(route);
          return { ...route, key, selected: selectedKeys.has(key), allowed: allowedKeys.has(key), authorized: authorizedKeys.has(key) };
        });
        const available = own.status === "ready" && stored !== undefined && Number.isInteger(own.revision);
        return {
          loading: own.status === "loading" || official.status === "loading",
          available, officialAvailable: allowed !== undefined, officialEnabled,
          writable: own.writable === true, revision: own.revision, stored, desired, rows,
          weak: authorized.filter((route) => !selectedKeys.has(routeKey(route))),
          editable: !this.disposed && available && allowed !== undefined && own.writable === true && !this.saving,
          hasDraft: this.draft !== undefined, dirty: !!this.draft && !sameRoutes(stored ?? [], desired),
          stale, offDraft, invalid: stale || offDraft,
          saved: this.feedback === "saved", failed: this.feedback === "failed", conflicted: this.conflicted, saving: this.saving,
        };
      }
      toggleModel(key) {
        const state = this.projection();
        if (!state.editable) return;
        const row = state.rows.find((item) => item.key === key);
        if (!row || (!row.selected && !row.authorized)) return;
        if (!this.draft) {
          this.draftRevision = state.revision;
          this.draftBase = state.stored;
        }
        this.feedback = undefined;
        this.draft = row.selected ? state.desired.filter((route) => routeKey(route) !== key)
          : [...state.desired, { provider: row.provider, model: row.model }];
        if (!this.conflicted && sameRoutes(state.stored, this.draft)) this.clearDraft();
        this.publish();
      }
      clearDraft() {
        this.draft = undefined;
        this.draftRevision = undefined;
        this.draftBase = undefined;
        this.conflicted = false;
      }
      discard() {
        if (this.disposed || this.saving || !this.draft) return;
        this.clearDraft();
        this.feedback = undefined;
        this.publish();
      }
      /** 把本窗口相对旧基线的增删合到最新值，不覆盖另一窗口的无关修改。 */
      rebase() {
        const state = this.projection();
        if (!state.editable || !this.draft || !this.draftBase || !this.conflicted) return;
        const baseKeys = new Set(this.draftBase.map(routeKey));
        const desiredKeys = new Set(this.draft.map(routeKey));
        const merged = new Map(state.stored.map((route) => [routeKey(route), route]));
        for (const key of baseKeys) if (!desiredKeys.has(key)) merged.delete(key);
        for (const route of this.draft) if (!baseKeys.has(routeKey(route))) merged.set(routeKey(route), route);
        this.draft = [...merged.values()];
        this.draftBase = state.stored;
        this.draftRevision = state.revision;
        this.conflicted = false;
        this.feedback = undefined;
        if (sameRoutes(state.stored, this.draft)) this.clearDraft();
        this.publish();
      }
      async save() {
        const state = this.projection();
        if (!state.editable || !state.dirty || state.invalid || this.conflicted) return;
        if (state.revision !== this.draftRevision) { this.conflicted = true; this.publish(); return; }
        const generation = ++this.saveGeneration;
        const desired = state.desired;
        this.saving = true;
        this.feedback = undefined;
        this.publish();
        let accepted = false;
        try {
          // 只对本插件命名空间做原子写入。官方白名单同步属于另一个独立修订；不做跨域写入。
          accepted = await this.own.mutate([{ op: "set", path: ["smartModels"], value: desired }], this.draftRevision);
        } catch { /* 未确认写入，显示显式失败，不自动重试。 */ }
        if (this.disposed || generation !== this.saveGeneration) return;
        const current = this.own.getSnapshot();
        const landed = current.status === "ready" && readRoutes(current.value?.smartModels);
        this.saving = false;
        if (accepted === true && landed && sameRoutes(landed, desired)) {
          this.clearDraft();
          this.feedback = "saved";
        } else {
          this.feedback = "failed";
          if (current.revision !== this.draftRevision) this.conflicted = true;
        }
        this.publish();
      }
      resetConnection() {
        if (this.disposed) return;
        ++this.saveGeneration;
        if (this.saving) this.feedback = "failed";
        this.saving = false;
        if (this.draft) this.conflicted = true;
        this.publish();
      }
      publish() { if (!this.disposed) this.store.set(this.projection()); }
      dispose() {
        this.disposed = true;
        ++this.saveGeneration;
        this.unsubscribeOwn();
        this.unsubscribeOfficial();
      }
      inject() { return { hooks: { difficultyModels: this.store }, controller: this }; }
    }

    // 复用官方表单的字体、留白、描边与主题令牌；仅作用于自己的扩展区域。
    const css = `
      .team-difficulty-settings{padding:16px 0;min-width:0;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary)}
      .team-difficulty-settings h3{margin:0;font-size:13px;font-weight:600}
      .team-difficulty-settings .body{display:grid;gap:10px;padding-top:12px}
      .team-difficulty-settings .hint,.team-difficulty-settings .error{margin:0;font-size:12px;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary)}
      .team-difficulty-settings .error{color:var(--dsw-alias-state-error-primary)}
      .team-difficulty-settings fieldset{display:grid;gap:6px;min-width:0;max-height:280px;margin:0;padding:10px;overflow:auto;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-lg)}
      .team-difficulty-settings legend{padding:0 4px;font-size:12px;color:var(--dsw-alias-label-secondary)}
      .team-difficulty-settings .model{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:8px;padding:6px;border-radius:var(--dsw-radius-md);cursor:pointer;overflow-wrap:anywhere}
      .team-difficulty-settings input{accent-color:var(--dsw-alias-brand-primary)}
      .team-difficulty-settings .model:has(:disabled){cursor:default}
      @media (hover:hover){.team-difficulty-settings .model:has(:enabled):hover{background:var(--dsw-alias-interactive-bg-hover)}}
      .team-difficulty-settings .weak{display:grid;gap:4px;border-top:.5px solid var(--dsw-alias-border-l3);padding-top:10px}
      .team-difficulty-settings h4{margin:0;font-size:13px;font-weight:600}
      .team-difficulty-settings ul{max-height:280px;overflow:auto;overflow-wrap:anywhere;margin:0;padding-inline-start:24px}
      .team-difficulty-settings footer{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:16px 0 0}
      .team-difficulty-settings button{min-height:28px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);padding:5px 14px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font:inherit;line-height:1.2;cursor:pointer}
      .team-difficulty-settings button[type=submit]{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
      .team-difficulty-settings button:disabled{opacity:.45;cursor:default}
      .team-difficulty-settings :focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
    `;
    const routeLabel = ({ provider, model }) => `${provider} / ${model}`;
    function DifficultyModelsForm({ useDifficultyModels, controller: c, t }) {
      const state = useDifficultyModels((snapshot) => snapshot);
      const heading = React.useId();
      const hint = (key, role) => h("p", { className: role === "alert" ? "error" : "hint", role }, t(key));
      return h("section", { className: "team-difficulty-settings", "aria-labelledby": heading },
        h("h3", { id: heading }, t("title")),
        h("form", { className: "body", onSubmit: (event) => { event.preventDefault(); return c.save(); } },
          hint("intro"), hint("session"),
          state.loading && hint("loading", "status"),
          !state.loading && !state.available && hint("unavailable", "status"),
          !state.loading && state.available && !state.officialAvailable && hint("officialUnavailable", "status"),
          state.available && !state.writable && hint("readOnly", "status"),
          state.officialAvailable && !state.officialEnabled && hint("off", "status"),
          state.officialAvailable && state.officialEnabled && state.rows.every((row) => !row.allowed) && hint("noAllowed", "status"),
          state.rows.length > 0 && h("fieldset", { disabled: !state.editable }, h("legend", null, t("hard")),
            state.rows.map((row) => h("label", { className: "model", key: row.key },
              h("input", { type: "checkbox", checked: row.selected, disabled: !row.selected && !row.authorized, onChange: () => c.toggleModel(row.key) }),
              h("span", null, routeLabel(row), state.officialAvailable && !row.allowed && h("span", { className: "hint" }, ` · ${t("retained")}`))))),
          state.stale && !state.saved && hint("invalid", "alert"),
          state.offDraft && hint("offDraft", "alert"),
          state.officialEnabled && h("div", { className: "weak" },
            h("h4", null, t("weak")), hint("weakHelp"),
            state.weak.length ? h("ul", null, state.weak.map((route) => h("li", { key: routeKey(route) }, routeLabel(route)))) : hint("noWeak")),
          state.conflicted && hint("conflict", "alert"),
          state.failed && hint("failed", "alert"),
          h("footer", null,
            h("button", { type: "submit", disabled: !state.editable || !state.dirty || state.invalid || state.conflicted }, t(state.saving ? "saving" : "save")),
            state.conflicted && h("button", { type: "button", disabled: !state.editable, onClick: () => c.rebase() }, t("rebase")),
            state.hasDraft && h("button", { type: "button", disabled: state.saving, onClick: () => c.discard() }, t("discard")),
            h("span", { className: "hint", role: "status", "aria-atomic": true }, state.saving ? t("saving") : state.saved ? t(state.stale ? "savedStale" : "saved") : state.dirty && !state.failed && !state.conflicted ? t("dirty") : ""))));
    }
    /** 官方详情页传入 subject；不要使用官方槽位注册或改写其标题和内容。 */
    function DifficultyModelsSection(props) {
      return props.subject?.kind === "item" && props.subject.id === "subagent" ? h(DifficultyModelsForm, props) : null;
    }

    const inject = ["slots", "locale", "configForms"];
    function apply(ctx) {
      // 版本缺少已知槽位或配置/语言服务时，不注册任何替代路径。
      if (typeof ctx.slots?.inject !== "function" || typeof ctx.slots.register !== "function" || typeof ctx.locale?.register !== "function"
        || typeof ctx.configForms?.get !== "function" || typeof ctx.configForms.whileServed !== "function" || typeof ctx.on !== "function"
        || typeof ctx.effect !== "function") return;
      const own = ctx.configForms.get(NS);
      const official = ctx.configForms.get(OFFICIAL_NS);
      const readable = (form) => typeof form?.getSnapshot === "function" && typeof form.subscribe === "function";
      if (!readable(own) || !readable(official) || typeof own.mutate !== "function") return;
      ctx.effect(() => ctx.locale.register(LOCALE_NS, copy), "team-terra-ultra: difficulty models copy");
      ctx.effect(() => {
        const tag = document.createElement("style");
        tag.dataset.plugin = "dsh-agent-team-fix";
        tag.textContent = css;
        document.head.appendChild(tag);
        return () => tag.remove();
      }, "team-terra-ultra: difficulty models theme");
      const controller = new TeamModelController(own, official);
      ctx.effect(() => () => controller.dispose(), "team-terra-ultra: difficulty models subscriptions");
      ctx.effect(() => ctx.on("connection/reset", () => controller.resetConnection()), "team-terra-ultra: connection");
      ctx.effect(() => ctx.configForms.whileServed([NS], () => ctx.slots.inject(SLOT, () => ctx.slots.register({
        name: SLOT, id: "team-terra-ultra.difficulty-models", locale: LOCALE_NS, inject: () => controller.inject(),
      }, DifficultyModelsSection))), "team-terra-ultra: official Subagent detail extension");
    }
    return { default: { apply, inject }, apply, inject, TeamModelController, routeKey };
  },
});
