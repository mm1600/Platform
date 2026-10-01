/* Scope core: application store (Scope.store).
 *
 * Holds the loaded CSV tables, user settings (platform, currency, global filters, …), the manual-correction history,
 * and the cached engine results. result() is what every page uses: the AUM engine output for the selected platform
 * and currency with the global filters applied. Settings, corrections and user-loaded files persist in local storage.
 */
(function (global) {
  'use strict';
  const Scope = global.Scope || (global.Scope = {});
  const LS = { settings: 'scope.settings', adjustments: 'scope.adjustments', dataset: 'scope.dataset' };

  const listeners = new Set();
  const state = {
    tables: {},          // name → { text, parsed:{headers,records}, source:'embedded'|'fetch'|'file', filename, loadedAt }
    datasetLabel: '',    // e.g. 'SYNTHETIC DEMO' from config.csv or 'Loaded files'
    datasetSource: '',   // 'embedded' | 'fetch' | 'file'
    settings: { platform: 'TOTAL', currency: 'EUR', theme: 'auto', sidebar: true, globalFilters: [] }, // globalFilters: [{ field, op, value }] (Scope.pivot filter shape) applied to every page
    adjustments: [],     // { id, table:'positions'|'assets', key, field, original, value, reason, user, at }
    version: 0,
  };
  let memo = { key: null, result: null }, baseMemo = { key: null, result: null };

  const store = (Scope.store = {
    state,
    /** Register a listener called after every change; returns an unsubscribe function. */
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** Bump the data version, drop cached results and notify every listener (the app re-renders). */
    emit() { state.version++; memo.key = null; for (const fn of Array.from(listeners)) { try { fn(state); } catch (e) { console.error(e); } } },

    // ---------- tables ----------
    REQUIRED: ['holdings.csv', 'mapping_columns.csv', 'mapping_assets.csv', 'mapping_investors.csv', 'platforms.csv', 'ratings.csv', 'fx.csv', 'hardcoded.csv', 'esg.csv', 'config.csv'],
    OPTIONAL: ['fund_lookthrough.csv'], // loaded when present; modules degrade gracefully without them
    ALL_TABLES() { return store.REQUIRED.concat(store.OPTIONAL); },
    /** Load CSV texts ({ 'holdings.csv': text, … }); `merge` keeps tables not supplied. Files loaded by the user are saved locally. */
    setTables(files, source, opts) {
      // files: { 'holdings.csv': text, ... }
      const now = new Date().toISOString();
      if (!(opts && opts.merge)) state.tables = {};
      for (const [name, text] of Object.entries(files)) {
        const key = store.canonicalName(name);
        if (!key) continue;
        state.tables[key] = { text, parsed: Scope.csv.parse(text), source, filename: name, loadedAt: now };
      }
      state.datasetSource = source;
      const cfg = store.config();
      state.datasetLabel = cfg.dataset_label || (source === 'file' ? 'Loaded files' : 'Dataset');
      if (source === 'file') store.persistDataset();
      store.emit();
    },
    /** Map a file name (any folder, any case) to a known table name, or null if it is not part of the schema. */
    canonicalName(name) {
      const base = String(name).split(/[\\/]/).pop().toLowerCase();
      return store.REQUIRED.includes(base) || store.OPTIONAL.includes(base) ? base : null;
    },
    /** Parsed rows of a table (blank padding rows removed); [] when the table is not loaded. */
    table(name) { const t = state.tables[name]; return t ? t.parsed.records.filter(Boolean) : []; },
    /** Raw table entry (text, parsed headers/records, source, file name, load time) or null. */
    tableInfo(name) { return state.tables[name] || null; },
    /** config.csv as a { key: value } object. */
    config() {
      const out = {};
      for (const r of store.table('config.csv')) if (r.key) out[r.key] = r.value;
      return out;
    },
    /** Required tables that are not loaded yet. */
    missingTables() { return store.REQUIRED.filter((n) => !state.tables[n]); },

    // ---------- settings ----------
    setSetting(k, v) { if (state.settings[k] === v) return; state.settings[k] = v; store.persistSettings(); store.emit(); },
    /** Save settings to local storage (ignored when storage is unavailable). */
    persistSettings() { try { localStorage.setItem(LS.settings, JSON.stringify(state.settings)); } catch (e) { /* storage unavailable */ } },

    // ---------- manual adjustments (brief §11: keep original, reason, user, timestamp) ----------
    addAdjustment(a) {
      const adj = Object.assign({ id: Scope.util.uid(), at: new Date().toISOString(), user: state.settings.user || 'local user' }, a);
      // one live adjustment per (table,key,field): newer supersedes but history is retained
      state.adjustments.forEach((x) => { if (x.table === adj.table && x.key === adj.key && x.field === adj.field && !x.superseded) x.superseded = adj.id; });
      state.adjustments.push(adj);
      store.persistAdjustments(); store.emit(); return adj;
    },
    /** Revert a correction (kept in the history) and re-activate the one it replaced. */
    revertAdjustment(id) {
      const a = state.adjustments.find((x) => x.id === id); if (!a) return;
      a.reverted = new Date().toISOString();
      // re-activate the previous one for that field, if any
      const prev = state.adjustments.filter((x) => x.superseded === id); prev.forEach((x) => { delete x.superseded; });
      store.persistAdjustments(); store.emit();
    },
    /** Corrections currently in force (not superseded, not reverted). */
    activeAdjustments() { return state.adjustments.filter((x) => !x.superseded && !x.reverted); },
    /** Save the full correction history to local storage. */
    persistAdjustments() { try { localStorage.setItem(LS.adjustments, JSON.stringify(state.adjustments)); } catch (e) { /* ignore */ } },
    /** Save user-loaded CSV files locally (skipped above ~4.5 MB so storage quotas are not exceeded). */
    persistDataset() {
      try {
        const files = {}; for (const [k, t] of Object.entries(state.tables)) files[t.filename || k] = t.text;
        const s = JSON.stringify({ files, at: new Date().toISOString() });
        if (s.length < 4.5e6) localStorage.setItem(LS.dataset, s); else localStorage.removeItem(LS.dataset);
      } catch (e) { /* quota or unavailable */ }
    },
    /** Forget user-loaded files (the demo data is used again). */
    clearDataset() { try { localStorage.removeItem(LS.dataset); } catch (e) { /* ignore */ } },
    /** Read settings, corrections and any saved dataset from local storage at start-up. */
    restore() {
      try { const s = localStorage.getItem(LS.settings); if (s) Object.assign(state.settings, JSON.parse(s)); } catch (e) { /* ignore */ }
      if (!Array.isArray(state.settings.globalFilters)) state.settings.globalFilters = [];
      try { const a = localStorage.getItem(LS.adjustments); if (a) state.adjustments = JSON.parse(a); } catch (e) { /* ignore */ }
      let ds = null;
      try { const d = localStorage.getItem(LS.dataset); if (d) ds = JSON.parse(d); } catch (e) { /* ignore */ }
      return ds;
    },

    // ---------- engine ----------
    /** Engine result for the current platform / currency, unfiltered. */
    baseResult() {
      const key = state.version + '|' + state.settings.platform + '|' + state.settings.currency;
      if (baseMemo.key === key) return baseMemo.result;
      const t0 = performance.now();
      const res = Scope.engine.aum.compute(store.computeInput());
      res.computeMs = performance.now() - t0;
      baseMemo = { key, result: res };
      return res;
    },
    computeInput(extra) {
      return Object.assign({
        tables: Object.fromEntries(Object.keys(state.tables).map((n) => [n, store.table(n)])),
        tableInfo: state.tables,
        adjustments: store.activeAdjustments(),
        platform: state.settings.platform,
        currency: state.settings.currency,
      }, extra || {});
    },
    /** Engine result with the global filters applied (every page uses this). Two passes: the unfiltered result
     *  feeds Scope.engine.dataset so filters can use any field (asset attributes, ratings, ESG, derived bands),
     *  then the engine recomputes with only the matching holdings lines, so every total, metric and export agrees. */
    result() {
      const filters = (state.settings.globalFilters || []).filter((f) => f && f.field);
      const key = state.version + '|' + state.settings.platform + '|' + state.settings.currency + '|' + JSON.stringify(filters);
      if (memo.key === key) return memo.result;
      const base = store.baseResult();
      if (!filters.length || !Scope.engine.dataset || !Scope.pivot) { base.globalFilters = []; base.base = base; memo = { key, result: base }; return base; }
      const t0 = performance.now();
      const ds = Scope.engine.dataset.build(base);
      const valid = filters.filter((f) => ds.fieldById[f.field]);
      const keep = new Set(Scope.pivot.applyFilters(ds.records, ds.fieldById, valid).map((r) => r._pos && r._pos.line).filter((x) => x !== undefined));
      const res = Scope.engine.aum.compute(store.computeInput({ includeLines: keep }));
      res.computeMs = performance.now() - t0 + (base.computeMs || 0);
      res.globalFilters = valid; res.base = base;
      // data-quality issues describe the dataset, not the filtered view: keep the unfiltered list everywhere
      res.issues = base.issues; res.issueCounts = base.issueCounts;
      memo = { key, result: res };
      return res;
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
