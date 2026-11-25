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
    const INPUT_SLOT = "conversation.input.left";
    const LOCALE_NS = "team-terra-ultra.difficulty-models";
    const MODE_LOCALE_NS = "team-terra-ultra.session-modes";
    const FLAG_HELP = { strictDifficulty: "strictHelp", prayerEnabled: "prayerHelp", riceEnabled: "riceSettingHelp" };
    const FLAG_KEYS = Object.keys(FLAG_HELP);
    // 祷文为用户提供的原文；仅作设置页展示，不会进入模型提示或会话请求。
    const MACHINE_PRAYER = `不朽的机械之神，聆听我们的祈祷
我们是您的孩子，通往机械道路上的诸多的学者们
我们希望受次远在我们之上的知识，因为这是您的永恒，在人类至上的赐礼
我们受到以机械形式降临的必用的激励，并通过科技不断进步，以使我们配得上您的荣光
我们受到钢铁的庇护，受到您战争神使的保护
我们不辞辛劳以使那些您遗失的赐礼—那些在可搜索范围内的星辰回归到我们这一边
机械之神。照看我们的旅行，以金属和光芒保护我们
因为这个宇宙是一个漠然的空白，并且这扭曲的饥渴于吞噬我们
鸣大钟一次
推动杠杆，启动活塞和泵
鸣大钟两次
按下按钮，发动引擎，点燃涡轮，注入生命
鸣大钟三次
齐声歌唱，赞美万机之神`;
    const riceOn = "token来token来";
    const riceOff = "GPT6.2ASTRAUltra，帮我算个99乘法表";
    const routeKey = ({ provider, model }) => JSON.stringify([provider, model]);

    const copy = {
      en: {
        title: "Difficulty Models",
        intro: "Enable model choice and save the allowed models in Model selection above. Then optionally mark difficult-task models here. For local delegation by difficulty, the lead must use delegate_by_difficulty and specify the task difficulty, not a provider or model. This does not change the official allowlist or set a default model.",
        session: "These lists show provider and model IDs from the currently saved settings and your draft. DSH rc.5 snapshots model authorization at session start: start a new session after saving changes above. An open session can still have a different allowlist.",
        hard: "Difficult-task models", prayerHard: "万机之神", weak: "Other allowed models", weakHelp: "Unmarked models are routine candidates; there is no separate routine-task selection.",
        strictDifficulty: "Strict difficulty",
        strictHelp: "Ask for one-time approval before delegating on a difficult route. Active Prayer waives only this extra prompt; DSH's own approvals and allowlist still apply.",
        prayerEnabled: "Invoke the Omnissiah",
        prayerHelp: "The Prayer button appears only in a main session with a configured, authorized, usable difficult route. When this setting is on, difficult requests outside Rice require active Prayer and do not silently fall back. Turning this off pauses saved Prayer rather than clearing it.",
        riceEnabled: "Frugal mode",
        riceSettingHelp: "Show the rice bowl in the composer. Save with this off to end active Rice sessions and try to restore members’ previous models. Turning it back on only restores the button.",
        noWeak: "No other allowed models.", noAllowed: "No allowed models. Add models and save in Model selection above first.",
        off: "Model choice is off in the official settings. Enable it and save above to add difficult-task models. Existing selections can be removed here.",
        retained: "No longer allowed · can be removed", invalid: "Remove the selections no longer allowed above before saving model changes.",
        offDraft: "Model choice was turned off. Remove any new selections from your draft, or enable model choice above before saving.",
        loading: "Loading model settings…", unavailable: "Difficulty Models settings are unavailable on this host.",
        officialUnavailable: "The official Model selection settings are unavailable. Model changes cannot be saved.",
        readOnly: "This deployment stores settings read-only.", conflict: "Settings changed elsewhere or the connection reset. Your draft was kept. Review the candidates after merging your changes and before saving.",
        failed: "Saving was not confirmed. Your draft was kept and was not retried.",
        rebase: "Merge my changes with latest settings", discard: "Discard changes", save: "Save settings", saving: "Saving…", saved: "Settings saved.",
        savedStale: "Saved, but the official allowlist changed. Review the selections no longer allowed.", dirty: "Unsaved changes",
      },
      zh: {
        title: "任务难度模型",
        intro: "请先在上方「模型选择」中开启模型选择、勾选允许使用的模型并保存，再按需标记困难任务模型。队长按难度进行本地委派时，须使用 delegate_by_difficulty 指定任务难度，而不是指定提供方或模型。这里不修改官方白名单，也不设置默认模型。",
        session: "下方按提供方和模型的 ID 显示当前已保存的设置与本地草稿。DSH rc.5 在会话启动时记录模型授权：修改并保存上方白名单后，请新建会话。已打开的会话仍可能使用不同的白名单。",
        hard: "困难任务模型", prayerHard: "万机之神", weak: "其他已授权模型", weakHelp: "未标记的模型可用于日常委派，无需另选。",
        strictDifficulty: "严格难度",
        strictHelp: "使用困难模型委派前，额外请求一次性审批。祈求只免这次额外审批，官方审批和模型白名单仍然生效。",
        prayerEnabled: "赞美万机之神",
        prayerHelp: "先安抚机魂，再解难题。只有配置了已获授权且可用的困难模型的主会话才显示「祈求」。开启此设置后，饭碗关闭时，困难委派必须先点亮祈求，不会自动改用日常模型。关闭此设置只是暂停，不会抹掉已点亮的祈求。",
        riceEnabled: "节俭功能",
        riceSettingHelp: "在输入框显示饭碗。关闭并保存会退出已开启的节俭模式，并尝试恢复成员原模型；重新开启只恢复按钮。",
        noWeak: "没有其他已授权模型。", noAllowed: "当前没有允许的模型。请先在上方「模型选择」中添加模型并保存。",
        off: "官方模型选择尚未开启。若要添加困难任务模型，请先在上方开启并保存；已有选择仍可在这里移除。",
        retained: "已不在白名单 · 可移除", invalid: "请先移除已不在上方白名单的选项，再保存模型修改。",
        offDraft: "官方模型选择已关闭。请取消草稿中新勾选的项，或在上方开启模型选择后再保存。",
        loading: "正在加载模型设置…", unavailable: "此 Host 的任务难度模型设置不可用。",
        officialUnavailable: "官方「模型选择」设置不可用，暂时无法保存模型修改。",
        readOnly: "本部署的设置为只读。", conflict: "设置已在其他位置更新，或连接已重置。草稿已保留。合并到最新设置后，请检查候选名单再保存。",
        failed: "未确认保存成功。草稿已保留，未自动重试。",
        rebase: "将我的修改合并到最新设置", discard: "放弃修改", save: "保存设置", saving: "保存中…", saved: "设置已保存。",
        savedStale: "已保存，但官方白名单已变更。请检查不再允许的选项。", dirty: "有未保存的修改",
      },
    };

    const modeCopy = {
      en: {
        group: "Session modes", prayer: "Prayer", rice: "Rice bowl", riceTooltip: "月底了没有大白饭了",
        prayerHelp: "Praise the Omnissiah. Active Prayer allows difficult delegation and may switch eligible members for later requests. Turning it off tries to restore the original selection where it is still usable and does not override later manual choices. The lead still decides whether to delegate.",
        prayerBlocked: "Even the machine spirit must wait for dinner. Turn off Rice bowl first.",
        riceHelp: "End of the month. No more rice. Rice clears Prayer. New difficult local requests use an authorized routine route or are rejected if none is usable. Eligible members may switch for later requests; running calls continue. Turning off Rice does not restore Prayer and tries to restore original selections without overriding later manual choices.",
        prayerOn: "The machine spirit is pleased.", prayerOff: "The rite is complete.",
        riceOn, riceOff,
        loading: "Reading modes…", saving: "Saving mode…", unavailable: "Modes unavailable", readOnly: "Modes are read-only",
        conflict: "Mode or availability changed. Review and try again.",
        failed: "Change not confirmed. Review the current mode.", refresh: "Reload modes", refreshShort: "Reload",
        reconcileFailed: "Mode changed; some members could not be synchronized.",
        deferred: "Mode saved. No live session to synchronize.", updated: "Members updated", skipped: "Skipped",
      },
      zh: {
        group: "会话模式", prayer: "祈求", rice: "饭碗", riceTooltip: "月底了没有大白饭了",
        prayerHelp: "赞美万机之神。点亮后可进行困难委派，符合条件的成员可从后续请求起换模。熄灭时尝试恢复仍可用的原选项，不覆盖后来手动做出的选择。派不派活，还是队长说了算。",
        prayerBlocked: "机魂也得等开饭。先关饭碗，再念祷词。",
        riceHelp: "月底了没有大白饭了。开饭碗会熄掉祈求；新的困难本地委派改用已授权的日常模型，没有可用日常模型就拒绝。已在跑的调用不打断，符合条件的成员从后续请求起换模。关饭碗会尝试恢复原选项，不覆盖后来手动做出的选择，也不会替你重新念祷词。",
        prayerOn: "机魂悦纳了。", prayerOff: "祷告完毕。",
        riceOn, riceOff,
        loading: "正在读取模式…", saving: "正在保存模式…", unavailable: "模式不可用", readOnly: "模式只读",
        conflict: "模式或可用性已变更，请检查后重试。", failed: "未确认修改，请检查当前模式。", refresh: "重新读取会话模式", refreshShort: "刷新",
        reconcileFailed: "模式已切换，部分成员状态未同步。",
        deferred: "模式已保存，暂无在载会话可同步。", updated: "已更新成员", skipped: "跳过",
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
    // 旧快照缺省时保留饭碗，其他开关默认关闭；错误类型不可写。
    function readSettings(snapshot) {
      const value = snapshot.value;
      const smartModels = readRoutes(value?.smartModels);
      if (snapshot.status !== "ready" || !Number.isInteger(snapshot.revision) || smartModels === undefined
        || FLAG_KEYS.some((key) => value[key] !== undefined && typeof value[key] !== "boolean")) return undefined;
      return { smartModels, strictDifficulty: value.strictDifficulty === true,
        prayerEnabled: value.prayerEnabled === true, riceEnabled: value.riceEnabled !== false };
    }
    function changedSettings(before, after) {
      return ["smartModels", ...FLAG_KEYS].filter((key) => key === "smartModels"
        ? !sameRoutes(before.smartModels, after.smartModels) : before[key] !== after[key]);
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
        this.draftBase = undefined; // 初次编辑时已接受的设置，用于只合并实际修改。
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
        const stored = readSettings(own);
        const desiredSettings = this.draft ?? stored;
        const desired = desiredSettings?.smartModels ?? [];
        const changed = stored && desiredSettings ? changedSettings(stored, desiredSettings) : [];
        const allowed = official.status === "ready" && typeof official.value?.enabled === "boolean"
          ? readRoutes(official.value.allowedModels) : undefined;
        const officialEnabled = allowed !== undefined && official.value.enabled;
        const authorized = officialEnabled ? allowed : [];
        const allowedKeys = new Set(allowed?.map(routeKey));
        const stale = allowed !== undefined && desired.some((route) => !allowedKeys.has(routeKey(route)));
        const offDraft = allowed !== undefined && !officialEnabled && !!this.draft
          && desired.some((route) => !stored?.smartModels.some((candidate) => routeKey(candidate) === routeKey(route)));
        const authorizedKeys = new Set(authorized.map(routeKey));
        const selectedKeys = new Set(desired.map(routeKey));
        // 未授权的已有选项仍显示以便清理；不会凭历史配置创建新的授权。
        const rows = [...(allowed ?? []), ...desired.filter((route) => !allowedKeys.has(routeKey(route)))].map((route) => {
          const key = routeKey(route);
          return { ...route, key, selected: selectedKeys.has(key), allowed: allowedKeys.has(key), authorized: authorizedKeys.has(key) };
        });
        const available = stored !== undefined;
        const flagsEditable = !this.disposed && available && own.writable === true && !this.saving;
        const editable = flagsEditable && allowed !== undefined;
        const canSave = flagsEditable && changed.length > 0 && !this.conflicted
          && (!changed.includes("smartModels") || editable && !stale && !offDraft);
        return {
          loading: own.status === "loading" || official.status === "loading",
          available, officialAvailable: allowed !== undefined, officialEnabled,
          writable: own.writable === true, revision: own.revision, stored, desiredSettings, changed, desired, rows,
          weak: authorized.filter((route) => !selectedKeys.has(routeKey(route))),
          flagsEditable, editable, canSave, hasDraft: this.draft !== undefined, dirty: changed.length > 0,
          stale, offDraft, invalid: stale || offDraft,
          saved: this.feedback === "saved" || this.feedback === "prayer-lit", prayerLit: this.feedback === "prayer-lit" && stored?.prayerEnabled === true,
          failed: this.feedback === "failed", conflicted: this.conflicted, saving: this.saving,
        };
      }
      toggleModel(key) {
        const state = this.projection();
        if (!state.editable) return;
        const row = state.rows.find((item) => item.key === key);
        if (!row || (!row.selected && !row.authorized)) return;
        const smartModels = row.selected ? state.desired.filter((route) => routeKey(route) !== key)
          : [...state.desired, { provider: row.provider, model: row.model }];
        this.editDraft(state, { smartModels });
      }
      toggleFlag(key) {
        const state = this.projection();
        if (!state.flagsEditable || !FLAG_KEYS.includes(key)) return;
        this.editDraft(state, { [key]: !state.desiredSettings[key] });
      }
      editDraft(state, patch) {
        if (!this.draft) {
          this.draftRevision = state.revision;
          this.draftBase = state.stored;
        }
        this.feedback = undefined;
        this.draft = { ...state.desiredSettings, ...patch };
        if (!this.conflicted && changedSettings(state.stored, this.draft).length === 0) this.clearDraft();
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
      /** 只合并相对旧基线修改过的开关和逐项路由增删，不覆盖另一窗口的无关修改。 */
      rebase() {
        const state = this.projection();
        if (!state.flagsEditable || !this.draft || !this.draftBase || !this.conflicted) return;
        const baseKeys = new Set(this.draftBase.smartModels.map(routeKey));
        const desiredKeys = new Set(state.desired.map(routeKey));
        const merged = new Map(state.stored.smartModels.map((route) => [routeKey(route), route]));
        for (const key of baseKeys) if (!desiredKeys.has(key)) merged.delete(key);
        for (const route of state.desired) if (!baseKeys.has(routeKey(route))) merged.set(routeKey(route), route);
        const settings = { ...state.stored, smartModels: [...merged.values()] };
        for (const key of FLAG_KEYS) if (this.draftBase[key] !== this.draft[key]) settings[key] = this.draft[key];
        this.draft = settings;
        this.draftBase = state.stored;
        this.draftRevision = state.revision;
        this.conflicted = false;
        this.feedback = undefined;
        if (changedSettings(state.stored, settings).length === 0) this.clearDraft();
        this.publish();
      }
      async save() {
        const state = this.projection();
        if (!state.canSave) return;
        if (state.revision !== this.draftRevision) { this.conflicted = true; this.publish(); return; }
        const generation = ++this.saveGeneration;
        const desired = state.desiredSettings;
        const ops = state.changed.map((key) => ({ op: "set", path: [key], value: desired[key] }));
        this.saving = true;
        this.feedback = undefined;
        this.publish();
        let accepted = false;
        try {
          // 只对本插件命名空间做一次原子写入；未修改的字段和官方白名单均不写回。
          accepted = await this.own.mutate(ops, this.draftRevision);
        } catch { /* 未确认写入，显示显式失败，不自动重试。 */ }
        if (this.disposed || generation !== this.saveGeneration) return;
        const current = this.own.getSnapshot();
        const landed = readSettings(current);
        this.saving = false;
        if (accepted === true && landed && !changedSettings(landed, desired).some((key) => state.changed.includes(key))) {
          this.clearDraft();
          this.feedback = state.changed.includes("prayerEnabled") && landed.prayerEnabled ? "prayer-lit" : "saved";
        } else {
          this.feedback = "failed";
          if (current.revision !== this.draftRevision) this.conflicted = true;
        }
        this.publish();
      }
      finishPrayerGlint() {
        if (this.feedback !== "prayer-lit") return;
        this.feedback = "saved";
        this.publish();
      }
      resetConnection() {
        if (this.disposed) return;
        ++this.saveGeneration;
        if (this.feedback === "prayer-lit") this.feedback = "saved";
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

    const SESSION_MODE_URL = "api/team-terra-ultra/session-mode"; // 与宿主 RPC 一样，相对页面挂载路径。
    function readMode(value) {
      if (!["normal", "prayer", "rice"].includes(value?.mode) || !Number.isSafeInteger(value.revision) || value.revision < 0
        || typeof value.prayerEnabled !== "boolean" || typeof value.riceEnabled !== "boolean" || typeof value.writable !== "boolean") return;
      return { mode: value.mode, revision: value.revision,
        prayerEnabled: value.prayerEnabled, riceEnabled: value.riceEnabled, writable: value.writable };
    }
    // prayerEnabled 是 Host 对此主会话的能力判断；只有当前回应有效时才可操作祈求。
    const prayerEligible = (value) => value?.prayerEnabled === true && value.writable;
    const canTogglePrayer = ({ prayerCurrent, value }) => prayerCurrent === true && prayerEligible(value);
    function readModeResult(value) {
      if (![value?.updated, value?.skipped].every((count) => Number.isSafeInteger(count) && count >= 0)) return;
      return value.updated || value.skipped ? { updated: value.updated, skipped: value.skipped } : undefined;
    }

    /** 单会话状态来自 Host；刷新及冲突、拒绝后的核对都只做 GET，不开会话或补发写入。 */
    class SessionModeController {
      constructor(sessionId, fetchMode = (url, options) => globalThis.fetch(url, options)) {
        this.sessionId = sessionId;
        this.fetchMode = fetchMode;
        this.store = makeStore({ phase: "loading" });
      }
      start() {
        this.active = true;
        return this.refresh();
      }
      stop() {
        this.active = false;
        this.refreshQueued = false;
        this.pending?.abort();
        this.pending = undefined;
      }
      // 每次只允许一个请求流程；会话卸载后即使旧响应到达，也不能更新界面。
      async run(work) {
        if (!this.active || this.pending) return;
        const request = new AbortController();
        this.pending = request;
        try { await work(request.signal); } finally {
          if (this.pending === request) {
            this.pending = undefined;
            if (this.refreshQueued) {
              this.refreshQueued = false;
              void this.refresh(true);
            }
          }
        }
      }
      refresh(preserveFeedback = false) {
        const snapshot = this.store.getSnapshot();
        if (this.pending) {
          // 排队也立即让旧能力失效。仅保留已可用过的控件供焦点停留，不恢复其操作。
          this.refreshQueued = true;
          if (snapshot.prayerCurrent) this.store.set({ ...snapshot, prayerCurrent: false, prayerHeld: canTogglePrayer(snapshot) });
          return;
        }
        const { feedback, result, confirmation, prayerFeedbackPending } = snapshot;
        return this.run((signal) => this.read(signal, preserveFeedback ? feedback : undefined,
          preserveFeedback ? result : undefined, preserveFeedback ? confirmation : undefined,
          preserveFeedback && prayerFeedbackPending));
      }
      async read(signal, feedback, result, confirmation, prayerFeedbackPending = false) {
        const snapshot = this.store.getSnapshot();
        const { value, celebration } = snapshot;
        const prayerHeld = snapshot.prayerHeld || canTogglePrayer(snapshot);
        this.store.set({ phase: "loading", value, feedback, result, confirmation, prayerHeld, prayerFeedbackPending,
          celebration: confirmation?.target === "rice" ? celebration : undefined });
        try {
          const response = await this.fetchMode(`${SESSION_MODE_URL}?sessionId=${encodeURIComponent(this.sessionId)}`,
            { method: "GET", credentials: "same-origin", mode: "same-origin", cache: "no-store", signal });
          if (signal.aborted || this.refreshQueued) return;
          if (response.status === 401 || response.status === 403) { this.store.set({ phase: "excluded" }); return; }
          const next = response.ok && readMode(await response.json());
          if (signal.aborted || this.refreshQueued) return;
          if (!next) throw new Error("Session mode unavailable");
          // 同一修订、模式和能力才保留已确认台词；仅为排队核对的主动切换首次播放动画。
          const unchanged = value?.revision === next.revision && value.mode === next.mode;
          const keepConfirmation = unchanged && (confirmation?.target !== "prayer" || prayerEligible(next));
          const nextCelebration = prayerFeedbackPending ? confirmation : confirmation?.target === "rice" ? celebration : undefined;
          this.store.set({ phase: "ready", value: next, prayerCurrent: true, feedback: keepConfirmation || !confirmation ? feedback : undefined,
            result: keepConfirmation ? result : undefined, confirmation: keepConfirmation ? confirmation : undefined,
            celebration: keepConfirmation ? nextCelebration : undefined });
        } catch {
          if (!signal.aborted && !this.refreshQueued) this.store.set({ phase: "unavailable", value, feedback });
        }
      }
      toggle(target) {
        const snapshot = this.store.getSnapshot();
        const { phase, value, prayerCurrent, prayerHeld } = snapshot;
        if (phase !== "ready" || !value?.writable || !["prayer", "rice"].includes(target)
          || target === "rice" && !value.riceEnabled
          || target === "prayer" && (!canTogglePrayer(snapshot) || value.mode === "rice")) return;
        // 关闭饭碗始终回普通；没有客户端祈求备份可以恢复。
        const mode = value.mode === target ? "normal" : target;
        return this.run(async (signal) => {
          this.store.set({ phase: "saving", value, prayerCurrent });
          try {
            const response = await this.fetchMode(SESSION_MODE_URL, {
              method: "POST", credentials: "same-origin", mode: "same-origin", cache: "no-store", signal,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sessionId: this.sessionId, mode, revision: value.revision }),
            });
            if (signal.aborted) return;
            // POST 的拒绝不等于整个会话不可读；只有 GET 确认无权读取才移除控制区。
            if (response.status === 409 || response.status === 403) return this.read(signal, "conflict");
            if (response.status === 401) { this.store.set({ phase: "excluded" }); return; }
            const body = response.ok && await response.json();
            if (signal.aborted) return;
            const next = readMode(body);
            if (!next) throw new Error("Session mode write not confirmed");
            const syncFeedback = body.reconcileFailed === true || body.result?.failed === true ? "reconcileFailed"
              : body.result?.deferred === true ? "deferred" : undefined;
            const matched = next.mode === mode;
            const current = { value: next, prayerCurrent: !this.refreshQueued };
            const confirmation = matched && syncFeedback !== "reconcileFailed" && (target === "rice" || prayerEligible(next))
              ? { target, active: mode === target } : undefined;
            const prayerFeedbackPending = !!(confirmation?.target === "prayer" && this.refreshQueued);
            // 排队时先留下主动写入的凭据，等最新 GET 核实后才显示祈求的成功台词和动画。
            this.store.set({ phase: "ready", ...current, prayerHeld: this.refreshQueued && this.store.getSnapshot().prayerHeld,
              feedback: !matched ? "failed" : syncFeedback,
              result: matched && !syncFeedback ? readModeResult(body.result) : undefined,
              confirmation, prayerFeedbackPending, celebration: prayerFeedbackPending ? undefined : confirmation });
          } catch {
            // 连接失败不代表写入没发生；先重新核对，且不自动重试 POST。
            if (!signal.aborted) return this.read(signal, "failed");
          }
        });
      }
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
      .team-difficulty-settings .flags .hint{display:block}
      .team-difficulty-settings .machine-prayer{margin:6px 0 8px;padding-inline-start:12px;border-inline-start:2px solid var(--dsw-alias-border-l4);color:var(--dsw-alias-label-secondary);white-space:pre-line;overflow-wrap:anywhere}
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
      .team-session-modes{position:relative;display:inline-grid;min-width:0;vertical-align:middle}
      .team-session-modes .actions{display:inline-flex;align-items:center;gap:4px}
      .team-session-modes button{display:inline-flex;align-items:center;gap:4px;justify-content:center;min-width:28px;min-height:28px;padding:0 6px;border:1px solid transparent;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1.2;white-space:nowrap;cursor:pointer}
      .team-session-modes button[aria-pressed=true]{border-color:currentColor;color:var(--dsw-alias-state-business-primary);font-weight:600}
      .team-session-modes button:is(:disabled,[aria-disabled=true]){opacity:.6;cursor:default}
      .team-session-modes button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
      .team-session-modes svg{display:block;flex:none}
      .team-session-modes .mode-feedback,.team-session-modes .mode-explanation{position:absolute;z-index:1;inset-inline-start:0;inset-block-end:calc(100% + 4px);width:max-content;max-width:min(30ch,70vw);padding:6px 8px;border:1px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-system-solid);pointer-events:none;font-size:11px;line-height:1.3;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
      .team-session-modes .mode-feedback:empty{padding:0;border:0}
      .team-session-modes .mode-description{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
      .team-session-modes .mode-explanation{display:none;z-index:2}
      .team-session-modes:not([data-mode-confirmed]):has(button[data-team-mode=rice]:focus-visible) .rice-explanation,.team-session-modes:has(button[data-mode-blocked=true]:focus-visible) .prayer-explanation{display:block}
      @container (max-width:400px){.team-session-modes .mode-label{display:none}}
      @media (hover:hover){.team-session-modes button:enabled:not([aria-disabled=true]):hover{background:var(--dsw-alias-interactive-bg-hover)}}
      .team-difficulty-settings .machine-legend{display:inline-flex;align-items:center;gap:5px;color:var(--dsw-alias-state-business-primary);font-weight:600}
      .team-session-modes .mode-emblem{position:relative;display:inline-grid;place-items:center;flex:none}
      .team-session-modes .rice-grain{position:absolute;inset-block-start:4px;inset-inline-start:6px;width:2px;height:3px;border-radius:50%;background:currentColor;opacity:0;pointer-events:none}
      @media (prefers-reduced-motion:no-preference){
        .team-session-modes button{transition:color 120ms ease,background-color 120ms ease}
        .team-difficulty-settings .machine-legend[data-confirmed=true]{animation:ssl-legend-glint 650ms ease-out}
        .team-session-modes .mode-emblem[data-celebrate=prayer] svg{animation:ssl-machine-rite 520ms cubic-bezier(.2,.8,.3,1)}
        .team-session-modes .mode-emblem[data-celebrate=rice] svg{animation:ssl-bowl-rattle 320ms ease-out}
        .team-session-modes .mode-emblem[data-celebrate=rice] .rice-grain{animation:ssl-rice-grain 440ms ease-out both}
      }
      @keyframes ssl-legend-glint{0%,100%{text-shadow:none}36%{text-shadow:-4px 0 7px currentColor}63%{text-shadow:4px 0 5px currentColor}}
      @keyframes ssl-machine-rite{0%{transform:rotate(-24deg) scale(.91)}64%{transform:rotate(51deg) scale(1.1)}100%{transform:rotate(0)}}
      @keyframes ssl-bowl-rattle{0%,100%{transform:rotate(0)}26%{transform:rotate(-12deg)}58%{transform:rotate(9deg)}}
      @keyframes ssl-rice-grain{0%{opacity:0;transform:translate(0,0)}22%{opacity:1}49%{opacity:1;transform:translate(var(--ssl-rice-x),-5px) rotate(35deg)}100%{opacity:0;transform:translate(var(--ssl-rice-x),5px) rotate(75deg)}}
    `;
    const routeLabel = ({ provider, model }) => `${provider} / ${model}`;
    function ModeIcon({ kind, size = 14 }) {
      return h("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor",
        strokeWidth: 1.25, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, focusable: "false" },
      kind === "prayer" ? h(React.Fragment, null,
        h("path", { d: "M6.7 1.5h2.6l.4 1.7 1 .5 1.6-.5 1.4 2.1-1.1 1.4.1 1.1 1.5.8-.7 2.4-1.8 0-.8.8-.1 1.7-2.5.6-.9-1.5-1.1-.1-1.3 1.1-2.1-1.4.5-1.7-.5-.9-1.7-.4V6.7l1.7-.4.5-1-.5-1.6 2.1-1.4 1.3 1.1 1-.2z" }),
        h("circle", { cx: 8, cy: 8, r: 2 }))
        : h("path", { d: "M2 7.2h12a6 6 0 0 1-12 0zm3-1.7a1.3 1.3 0 0 1 1.7-1.4 1.4 1.4 0 0 1 2.6 0A1.3 1.3 0 0 1 11 5.5M6.2 13.5h3.6" }));
    }
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
          h("div", { className: "flags" }, FLAG_KEYS.map((key) => {
            const description = `${heading}-${key}`;
            return h("label", { className: "model", key },
              h("input", { type: "checkbox", checked: state.desiredSettings?.[key] === true, disabled: !state.flagsEditable,
                "aria-label": t(key), "aria-describedby": description, onChange: () => c.toggleFlag(key) }),
              h("span", null, t(key), h("span", { className: "hint", id: description }, t(FLAG_HELP[key]))));
          }), state.desiredSettings?.prayerEnabled === true && h("blockquote", { className: "machine-prayer", lang: "zh" }, MACHINE_PRAYER)),
          state.officialAvailable && !state.officialEnabled && hint("off", "status"),
          (state.rows.length > 0 || state.officialEnabled || state.desiredSettings?.prayerEnabled) && h("fieldset", { disabled: !state.editable },
            h("legend", null, state.desiredSettings?.prayerEnabled
               ? h("span", { className: "machine-legend", "data-confirmed": state.prayerLit || undefined,
                 onAnimationEnd: () => c.finishPrayerGlint() },
                 h(ModeIcon, { kind: "prayer", size: 12 }), t("prayerHard")) : t("hard")),
            state.officialEnabled && state.rows.every((row) => !row.allowed) && hint("noAllowed", "status"),
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
            h("button", { type: "submit", disabled: !state.canSave }, t(state.saving ? "saving" : "save")),
            state.conflicted && h("button", { type: "button", disabled: !state.flagsEditable, onClick: () => c.rebase() }, t("rebase")),
            state.hasDraft && h("button", { type: "button", disabled: state.saving, onClick: () => c.discard() }, t("discard")),
            h("span", { className: "hint", role: "status", "aria-atomic": true }, state.saving ? t("saving") : state.saved ? t(state.stale ? "savedStale" : "saved") : state.dirty && !state.failed && !state.conflicted ? t("dirty") : ""))));
    }
    /** 官方详情页传入 subject；不要使用官方槽位注册或改写其标题和内容。 */
    function DifficultyModelsSection(props) {
      return props.subject?.kind === "item" && props.subject.id === "subagent" ? h(DifficultyModelsForm, props) : null;
    }

    // 官方输入栏提供会话快照；子会话不发请求。Host 仍独立检查权限与能力。
    function SessionModesSlot({ useSession, sessionId, ...props }) {
      if (typeof useSession !== "function") return null;
      const excluded = useSession((snapshot) => !!(snapshot?.subagent || snapshot?.removed));
      const running = useSession((snapshot) => snapshot?.running === true);
      return !excluded && typeof sessionId === "string" && sessionId ? h(SessionModeControls, { ...props, sessionId, running }) : null;
    }
    function SessionModeControls({ sessionId, settings, subscribeReset, t, running }) {
      const controller = React.useMemo(() => new SessionModeController(sessionId), [sessionId]);
      const state = React.useSyncExternalStore(controller.store.subscribe, controller.store.getSnapshot);
      const id = React.useId();
      const previousRun = React.useRef({ controller, running });
      const riceButton = React.useRef(null);
      const prayerButton = React.useRef(null);
      const recentRice = React.useRef(null);
      const recentPrayer = React.useRef(null);
      const [prayerFocused, setPrayerFocused] = React.useState(false);
      const prayerVisible = canTogglePrayer(state) || !!(state.prayerHeld && prayerFocused);
      const riceVisible = state.value?.riceEnabled === true && readSettings(settings.getSnapshot())?.riceEnabled !== false;
      // 仅接续确实还停留在被移除按钮上的焦点，不抢用户已移走的焦点。
      const bindPrayer = React.useCallback((button) => {
        if (!button && prayerButton.current?.ownerDocument.activeElement === prayerButton.current) recentPrayer.current = prayerButton.current;
        prayerButton.current = button;
      }, []);
      const bindRice = React.useCallback((button) => {
        if (!button && riceButton.current?.ownerDocument.activeElement === riceButton.current) recentRice.current = riceButton.current;
        riceButton.current = button;
      }, []);
      React.useLayoutEffect(() => {
        if (riceVisible) return;
        const previous = recentRice.current;
        recentRice.current = null;
        const prayer = prayerButton.current;
        if (previous && prayer && prayer.getAttribute("aria-disabled") !== "true") {
          const { activeElement, body } = previous.ownerDocument;
          if (activeElement === body || activeElement === previous) prayer.focus({ preventScroll: true });
        }
      }, [riceVisible]);
      React.useLayoutEffect(() => {
        if (prayerVisible) return;
        const previous = recentPrayer.current;
        recentPrayer.current = null;
        if (!previous) return;
        setPrayerFocused(false);
        const { activeElement, body } = previous.ownerDocument;
        if ((activeElement === body || activeElement === previous) && riceButton.current && !riceButton.current.disabled) {
          riceButton.current.focus({ preventScroll: true });
        }
      }, [prayerVisible]);
      React.useEffect(() => {
        void controller.start();
        const refresh = () => { void controller.refresh(true); };
        const unsubscribeReset = subscribeReset(refresh);
        // 只在本插件的已保存设置变化时读取；官方白名单在 rc.5 中按会话启动时的快照生效。
        let saved = readSettings(settings.getSnapshot());
        const unsubscribeSettings = settings.subscribe(() => {
          const current = readSettings(settings.getSnapshot());
          if (!current) return;
          const changed = !saved || changedSettings(saved, current).length > 0;
          saved = current;
          if (changed) refresh();
        });
        window.addEventListener("focus", refresh);
        return () => {
          controller.stop();
          unsubscribeReset();
          unsubscribeSettings();
          window.removeEventListener("focus", refresh);
        };
      }, [controller, settings, subscribeReset]);
      React.useEffect(() => {
        const previous = previousRun.current;
        previousRun.current = { controller, running };
        // 打开历史不一定唤醒 Agent；运行开始后仅为尚无祈求入口的会话再检查一次。
        if (previous.controller === controller && !previous.running && running
          && !canTogglePrayer(controller.store.getSnapshot()) && readSettings(settings.getSnapshot())?.prayerEnabled !== false) {
          void controller.refresh(true);
        }
      }, [controller, running, settings]);
      if (state.phase === "excluded" || state.phase === "ready" && !riceVisible && !prayerVisible) return null;
      const { value, phase, feedback, result, celebration, prayerFeedbackPending } = state;
      const confirmation = !riceVisible && state.confirmation?.target === "rice" ? undefined : state.confirmation;
      const pending = phase === "loading" || phase === "saving";
      const readonly = phase === "unavailable" || !value?.writable;
      const message = confirmation && !prayerFeedbackPending ? t(`${confirmation.target}${confirmation.active ? "On" : "Off"}`) : "";
      const detail = prayerFeedbackPending ? "" : feedback ? t(feedback) : result ? `${t("updated")} ${result.updated} · ${t("skipped")} ${result.skipped}` : "";
      const status = phase === "loading" && !message ? t("loading") : phase === "saving" || prayerFeedbackPending ? t("saving")
        : phase === "unavailable" ? t("unavailable") : readonly ? t("readOnly") : [message, detail].filter(Boolean).join(" · ");
      const toggle = (target) => {
        const rice = target === "rice";
        const blocked = !rice && value.mode === "rice";
        const help = t(rice ? "riceHelp" : blocked ? "prayerBlocked" : "prayerHelp");
        const description = `${id}-${target}`;
        return h(React.Fragment, { key: target },
          h("button", { type: "button", ref: rice ? bindRice : bindPrayer,
            "data-team-mode": target, "aria-label": t(target), "aria-pressed": value.mode === target,
            "aria-describedby": description, "aria-disabled": pending || blocked || !rice && !canTogglePrayer(state) || undefined,
            disabled: rice && readonly, "data-mode-blocked": blocked || undefined, title: rice ? `${t("rice")} · ${t("riceTooltip")}` : help,
            onFocus: rice ? undefined : () => setPrayerFocused(true), onBlur: rice ? undefined : () => setPrayerFocused(false),
            onClick: () => controller.toggle(target) },
          h("span", { className: "mode-emblem", "data-celebrate": celebration?.target === target ? target : undefined },
            h(ModeIcon, { kind: target }), rice && celebration?.target === target && [-6, 2, 8].map((x) =>
              h("span", { key: x, className: "rice-grain", "aria-hidden": true, style: { "--ssl-rice-x": `${x}px` } }))),
          !rice && h("span", { className: "mode-label" }, t(target))),
          h("span", { className: "mode-description", id: description }, help));
      };
      return h("div", { className: "team-session-modes", role: "group", "aria-label": t("group"),
        "data-mode-confirmed": confirmation?.target === "rice" || undefined },
        h("div", { className: "actions" },
          prayerVisible && toggle("prayer"),
          riceVisible && toggle("rice"),
          phase === "unavailable" && h("button", { type: "button", title: t("refresh"), onClick: () => controller.refresh() }, t("refreshShort"))),
        h("div", { className: "mode-feedback", role: "status", "aria-atomic": true }, status),
        riceVisible && h("span", { className: "mode-explanation rice-explanation", "aria-hidden": true }, t("riceHelp")),
        prayerVisible && value.mode === "rice" && h("span", { className: "mode-explanation prayer-explanation", "aria-hidden": true }, t("prayerBlocked")));
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
      ctx.effect(() => ctx.locale.register(MODE_LOCALE_NS, modeCopy), "team-terra-ultra: session modes copy");
      ctx.effect(() => {
        const tag = document.createElement("style");
        tag.dataset.plugin = "dsh-agent-team-fix";
        tag.textContent = css;
        document.head.appendChild(tag);
        return () => tag.remove();
      }, "team-terra-ultra: settings and session modes theme");
      const controller = new TeamModelController(own, official);
      ctx.effect(() => () => controller.dispose(), "team-terra-ultra: difficulty models subscriptions");
      ctx.effect(() => ctx.on("connection/reset", () => controller.resetConnection()), "team-terra-ultra: connection");
      ctx.effect(() => ctx.configForms.whileServed([NS], () => ctx.slots.inject(SLOT, () => ctx.slots.register({
        name: SLOT, id: "team-terra-ultra.difficulty-models", locale: LOCALE_NS, inject: () => controller.inject(),
      }, DifficultyModelsSection))), "team-terra-ultra: official Subagent detail extension");
      const modeInputs = { settings: own, subscribeReset: (refresh) => ctx.on("connection/reset", refresh) };
      ctx.effect(() => ctx.slots.inject(INPUT_SLOT, () => ctx.slots.register({
        name: INPUT_SLOT, id: "team-terra-ultra.session-modes", order: 100, locale: MODE_LOCALE_NS, inject: () => modeInputs,
      }, SessionModesSlot)), "team-terra-ultra: session composer modes");
    }
    return { default: { apply, inject }, apply, inject, TeamModelController, SessionModeController, routeKey };
  },
});
