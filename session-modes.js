const INITIAL = Object.freeze({ mode: 'normal', revision: 0 });
const VALID_MODES = new Set(['normal', 'prayer', 'rice']);
const SESSION_ID = /^[a-zA-Z0-9_-]{1,128}$/;
export const SESSION_MODE_PATH = '/api/team-terra-ultra/session-mode';

function configValue(config, name) {
  const setting = config?.[name];
  return typeof setting?.get === 'function' ? setting.get() : setting;
}

// 缺省保留旧版行为；只有显式保存 false 才停用节俭。
export const riceEnabled = config => configValue(config, 'riceEnabled') !== false;

/** 声明本插件自己的模式和恢复记录；不写 DSH 的会话事件文件。 */
export function modeDomainSpec({ defineDomain, domainTable }, z) {
  const route = z.object({ provider: z.string().min(1), model: z.string().min(1), reasoningEffort: z.string().min(1).optional() }).strict();
  return defineDomain({ name: 'smarter_subagent_modes', version: 1, tables: {
    modes: domainTable(z.object({ mode: z.enum(['normal', 'prayer', 'rice']), revision: z.number().int().nonnegative() }).strict()),
    marks: domainTable(z.object({ rootId: z.string().regex(SESSION_ID), original: route, applied: route, pending: z.literal(true).optional() }).strict()),
  } });
}

/** Cordis 负责域生命周期。此接口的读取只访问已加载的记录，不打开会话。 */
export function modeStore(domain) {
  const modes = domain.table('modes');
  const marks = domain.table('marks');
  let writes = Promise.resolve();
  let clearing;
  const suppressed = new Set(); // 持久写失败时，本次挂载不重新启用未清除的旧记录。
  const raw = id => modes.get(id) ?? INITIAL;
  const peek = id => {
    const state = raw(id);
    return { ...state, mode: state.mode === 'rice' && (clearing || suppressed.has(id)) ? 'normal' : state.mode };
  };
  function serialize(write) {
    const result = writes.then(write);
    writes = result.catch(() => {});
    return result;
  }
  return {
    peek,
    async read(id) { return peek(id); },
    write(id, record, accepts = () => true) {
      return serialize(async () => {
        if (!accepts(raw(id)) || (record.mode === 'rice' && clearing)) return false;
        await modes.put(id, record);
        suppressed.delete(id);
        return true;
      });
    },
    // 关闭时按持久写入顺序清理所有会话（包括归档）；不激活会话。快速重新开启也不保留旧饭碗。
    clearRice() {
      if (clearing) return clearing;
      clearing = serialize(async () => {
        const roots = [];
        let failed = 0;
        for (const [id, state] of modes.entries()) {
          if (state.mode !== 'rice') continue;
          try {
            if (state.revision === Number.MAX_SAFE_INTEGER) throw new Error('mode revision exhausted');
            await modes.put(id, { mode: 'normal', revision: state.revision + 1 });
            suppressed.delete(id);
          } catch { suppressed.add(id); failed++; }
          roots.push(id);
        }
        return { roots, failed };
      }).finally(() => { clearing = undefined; });
      return clearing;
    },
    async readMark(id) { return marks.get(id); },
    async writeMark(id, record) {
      if (record == null) await marks.delete(id);
      else await marks.put(id, record);
    },
  };
}

/** 只注册在 Host 的 owner-only Connection 上；不同会话可并发，同一会话按提交顺序执行。 */
export function sessionModeHandler({ config, store, persistence, runtime, active = () => true }) {
  const queues = new Map();
  function serialize(id, work) {
    const current = (queues.get(id) ?? Promise.resolve()).then(work);
    const settled = current.catch(() => {});
    queues.set(id, settled);
    return current.finally(() => { if (queues.get(id) === settled) queues.delete(id); });
  }
  const respond = (value, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
  const reject = (error, status) => respond({ error }, status);
  const writable = () => active() && runtime?.available === true;
  const prayerConfigured = () => configValue(config, 'prayerEnabled') === true;
  async function canPray(id, signal) {
    if (!writable() || signal.aborted || !prayerConfigured()) return false;
    try {
      const available = await runtime.prayerAvailable?.(id, signal);
      return available === true && writable() && !signal.aborted && prayerConfigured();
    } catch { return false; }
  }
  // 不可用的祈求只隐藏；关闭节俭时则在持久清理落地前立即停止节俭。
  const view = (state, prayerEnabled) => {
    const rice = riceEnabled(config);
    const hidden = state.mode === 'prayer' && !prayerEnabled || state.mode === 'rice' && !rice;
    return { ...state, mode: hidden ? 'normal' : state.mode, prayerEnabled, riceEnabled: rice, writable: writable() };
  };
  return async request => {
    try {
      if (!active()) return reject('unavailable', 503);
      let id, input;
      if (request.method === 'GET') {
        id = new URL(request.url).searchParams.get('sessionId');
      } else if (request.method === 'POST') {
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return reject('invalid_input', 415);
        const text = await request.text();
        if (text.length > 2048) return reject('invalid_input', 413);
        try { input = JSON.parse(text); } catch { return reject('invalid_input', 400); }
        if (input == null || typeof input !== 'object' || Array.isArray(input)
            || Object.keys(input).length !== 3 || !VALID_MODES.has(input.mode)
            || !Number.isSafeInteger(input.revision) || input.revision < 0) return reject('invalid_input', 400);
        id = input.sessionId;
      } else {
        return reject('method_not_allowed', 405);
      }
      if (typeof id !== 'string' || !SESSION_ID.test(id)) return reject('invalid_session', 400);
      // stat 只看已存在会话的元数据。允许普通会话 fork（有父 lineage，不是子智能体）。
      const header = (await persistence.stat(id, { signal: request.signal }))?.header;
      if (!header || header.id !== id) return reject('session_not_found', 404);
      if (header.origin !== undefined) return reject('root_session_required', 403);
      if (!input) {
        const available = await canPray(id, request.signal);
        return respond(view(await store.read(id), available));
      }
      return await serialize(id, async () => {
        if (!writable() || request.signal.aborted) return reject('unavailable', 503);
        const stored = await store.read(id);
        if (stored.revision !== input.revision) return reject('revision_conflict', 409);
        if (input.mode === 'rice' && !riceEnabled(config)) return reject('rice_unavailable', 409);
        // 开启前重新验证候选；主动退出或用饭碗取代已保存的祈求不需要模型资格。
        if (input.mode === 'prayer' && (stored.mode === 'rice' || !await canPray(id, request.signal))) {
          return reject('prayer_unavailable', 409);
        }
        if (!writable() || request.signal.aborted) return reject('unavailable', 503);
        if (stored.mode === input.mode) {
          const available = await canPray(id, request.signal);
          return respond(view(await store.read(id), available));
        }
        if (stored.revision === Number.MAX_SAFE_INTEGER) return reject('unavailable', 503);
        const next = { mode: input.mode, revision: stored.revision + 1 };
        const written = await store.write(id, next, current => writable() && !request.signal.aborted
          && current.revision === stored.revision && (input.mode !== 'rice' || riceEnabled(config)));
        if (!written) return reject('revision_conflict', 409);
        // 提交后不回滚开关：部分成员可能已经换模；失败只报告成员同步未完成。
        let outcome;
        try { outcome = { result: await runtime.reconcile(id) }; }
        catch { outcome = { reconcileFailed: true }; }
        const available = await canPray(id, request.signal);
        const latest = await store.read(id);
        return respond({ ...view(latest, available), ...(latest.revision === next.revision && latest.mode === next.mode ? outcome : {}) });
      });
    } catch {
      // 不把路径、模型或原始宿主异常回送给浏览器。
      return reject('unavailable', 503);
    }
  };
}
