/* Scope core: application store (Scope.store).
 *
 * Holds the four AUM input sheets (Holdings, Mapping, Hardcoded, ESG Hardcoded) as cell grids, the user's settings
 * (view, currency, global filters, calculation overrides), the manual-correction history and the cached results.
 * result() is what every page uses: the AUM calculation (js/calc/aum.js) for the selected view and currency with the
 * global filters applied. Settings and corrections persist in local storage; a loaded workbook persists in IndexedDB
 * (a real Holdings sheet is too large for local storage).
 */
(function (global) {
  'use strict';
  const Scope = global.Scope || (global.Scope = {});
  const LS = { settings: 'scope.settings', adjustments: 'scope.adjustments' };
  const SHEETS = ['Holdings', 'Mapping', 'Hardcoded', 'ESG Hardcoded'];

  const listeners = new Set();
  const state = {
    sheets: {},          // name → { name, rows } (rows[r][c] = Excel row r+1, column c+1)
    sources: {},         // name → { kind: 'demo' | 'xlsx' | 'csv' | 'paste', file, sheetName, loadedAt }
    datasetLabel: '',    // 'SYNTHETIC DEMO' for the bundled demo, otherwise 'Workbook data'
    datasetSource: '',   // 'demo' | 'workbook'
    settings: {
      platform: '', currency: 'EUR', sidebar: true,
      globalFilters: [],   // [{ field, op, value }] applied to every page (js/core/filters.js)
      calcOverrides: {},   // { roles: { 'Holdings.nominal': header }, views: { name: composition }, investors: { label: [group, weight] }, fxQuote }
    },
    adjustments: [],     // { id, table:'positions'|'assets', key, field, original, value, reason, user, at }
    version: 0,
  };
  let memo = { key: null, result: null }, baseMemo = { key: null, result: null };

  // ---------- IndexedDB (loaded workbook) ----------
  const IDB = { db: 'scope', store: 'kv', key: 'sheets' };
  /** Open the database (null when IndexedDB is unavailable, e.g. some private windows). */
  function idbOpen() {
    return new Promise((resolve) => {
      try {
        if (typeof indexedDB === 'undefined') return resolve(null);
        const req = indexedDB.open(IDB.db, 1);
        req.onupgradeneeded = () => { try { req.result.createObjectStore(IDB.store); } catch (e) { /* exists */ } };
        req.onsuccess = () => resolve(req.result); req.onerror = () => resolve(null); req.onblocked = () => resolve(null);
      } catch (e) { resolve(null); }
    });
  }
  /** Resolve with `p`, or with null after `ms` (IndexedDB can stay silent, e.g. for pages opened as a file). */
  const withTimeout = (p, ms) => Promise.race([p, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
  /** Run one request against the key-value store; resolves with its result or null. */
  async function idb(mode, fn) {
    const db = await idbOpen(); if (!db) return null;
    return new Promise((resolve) => {
      try { const tx = db.transaction(IDB.store, mode); const req = fn(tx.objectStore(IDB.store)); req.onsuccess = () => resolve(req.result === undefined ? null : req.result); req.onerror = () => resolve(null); }
      catch (e) { resolve(null); }
    });
  }

  const store = (Scope.store = {
    state,
    SHEETS,
    /** Register a listener called after every change; returns an unsubscribe function. */
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** Bump the data version, drop cached results and notify every listener (the app re-renders). */
    emit() { state.version++; memo.key = null; baseMemo.key = null; for (const fn of Array.from(listeners)) { try { fn(state); } catch (e) { console.error(e); } } },

    // ---------- input sheets ----------
    /**
     * Load sheets: { Holdings: grid, … } with their sources. `merge` keeps sheets not supplied (e.g. pasting one sheet).
     * Data loaded by the user is saved to IndexedDB so it is still there next time; the demo is never saved.
     */
    setSheets(sheets, sources, opts) {
      const o = opts || {};
      if (!o.merge) { state.sheets = {}; state.sources = {}; }
      const now = new Date().toISOString();
      for (const [name, g] of Object.entries(sheets || {})) {
        if (!SHEETS.includes(name) || !g || !g.rows) continue;
        state.sheets[name] = { name, rows: g.rows };
        state.sources[name] = Object.assign({ loadedAt: now }, (sources || {})[name] || { kind: o.demo ? 'demo' : 'paste' });
      }
      state.datasetSource = o.demo ? 'demo' : 'workbook';
      state.datasetLabel = o.demo ? (o.label || 'SYNTHETIC DEMO') : 'Workbook data';
      if (!o.demo) store.persistSheets();
      store.emit();
    },
    /** Sheet grid by name (or null). */
    sheet(name) { return state.sheets[name] || null; },
    /** Sheets not loaded yet. */
    missingSheets() { return SHEETS.filter((n) => !state.sheets[n]); },
    /** Legacy table accessor: optional extra tables (e.g. fund look-through) are not part of the four-sheet input. */
    table() { return []; },
    /** Save user-loaded sheets to IndexedDB (best effort). */
    persistSheets() {
      const payload = { sheets: state.sheets, sources: state.sources, at: new Date().toISOString() };
      idb('readwrite', (s) => s.put(payload, IDB.key));
    },
    /** Saved sheets from IndexedDB, or null. */
    loadSavedSheets() { return withTimeout(idb('readonly', (s) => s.get(IDB.key)), 1500); },
    /** Forget saved sheets (the demo is used again). */
    clearSavedSheets() { return withTimeout(idb('readwrite', (s) => s.delete(IDB.key)), 1500); },

    // ---------- settings ----------
    /** Change one setting (view, currency, global filters, overrides, …), persist it and re-render. */
    setSetting(k, v) { if (state.settings[k] === v) return; state.settings[k] = v; store.persistSettings(); store.emit(); },
    /** Save settings to local storage (ignored when storage is unavailable). */
    persistSettings() { try { localStorage.setItem(LS.settings, JSON.stringify(state.settings)); } catch (e) { /* storage unavailable */ } },
    /** Set one calculation override, e.g. setOverride('roles', 'Holdings.nominal', 'RA_Commitment QC'); value null removes it. */
    setOverride(group, key, value) {
      const ov = JSON.parse(JSON.stringify(state.settings.calcOverrides || {}));
      if (group === 'fxQuote') { if (value) ov.fxQuote = value; else delete ov.fxQuote; }
      else { ov[group] = ov[group] || {}; if (value === null || value === undefined || value === '') delete ov[group][key]; else ov[group][key] = value; }
      store.setSetting('calcOverrides', ov);
    },

    // ---------- manual corrections (original value, reason, user and time are kept) ----------
    /** Record a correction; earlier corrections of the same field are superseded but kept in the history. */
    addAdjustment(a) {
      const adj = Object.assign({ id: Scope.util.uid(), at: new Date().toISOString(), user: state.settings.user || 'local user' }, a);
      state.adjustments.forEach((x) => { if (x.table === adj.table && x.key === adj.key && x.field === adj.field && !x.superseded) x.superseded = adj.id; });
      state.adjustments.push(adj);
      store.persistAdjustments(); store.emit(); return adj;
    },
    /** Revert a correction (kept in the history) and re-activate the one it replaced. */
    revertAdjustment(id) {
      const a = state.adjustments.find((x) => x.id === id); if (!a) return;
      a.reverted = new Date().toISOString();
      state.adjustments.filter((x) => x.superseded === id).forEach((x) => { delete x.superseded; });
      store.persistAdjustments(); store.emit();
    },
    /** Corrections currently in force. */
    activeAdjustments() { return state.adjustments.filter((x) => !x.superseded && !x.reverted); },
    /** Save the correction history to local storage. */
    persistAdjustments() { try { localStorage.setItem(LS.adjustments, JSON.stringify(state.adjustments)); } catch (e) { /* ignore */ } },
    /** Read settings and corrections from local storage at start-up. */
    restore() {
      try { const s = localStorage.getItem(LS.settings); if (s) Object.assign(state.settings, JSON.parse(s)); } catch (e) { /* ignore */ }
      try { const a = localStorage.getItem(LS.adjustments); if (a) state.adjustments = JSON.parse(a); } catch (e) { /* ignore */ }
      if (!Array.isArray(state.settings.globalFilters)) state.settings.globalFilters = [];
      if (!state.settings.calcOverrides || typeof state.settings.calcOverrides !== 'object') state.settings.calcOverrides = {};
    },

    // ---------- calculation ----------
    /** Input for the AUM calculation from the current state (extra fields such as includeLines are merged in). */
    computeInput(extra) {
      return Object.assign({
        sheets: state.sheets, sources: state.sources, adjustments: store.activeAdjustments(), overrides: state.settings.calcOverrides,
        platform: state.settings.platform, currency: state.settings.currency, datasetLabel: state.datasetLabel,
      }, extra || {});
    },
    /** AUM result for the selected view and currency, without global filters (cached). */
    baseResult() {
      const key = state.version + '|' + state.settings.platform + '|' + state.settings.currency;
      if (baseMemo.key === key) return baseMemo.result;
      const t0 = Date.now();
      const res = Scope.calc.aum.run(store.computeInput());
      res.computeMs = Date.now() - t0;
      baseMemo = { key, result: res };
      return res;
    },
    /**
     * AUM result with the global filters applied (every page uses this). Two passes: the unfiltered result feeds the
     * dataset layer so a filter can use any field, then the calculation reruns on the matching Holdings rows only, so
     * every total, metric and export agrees. Data-quality issues always describe the whole input, not the filtered view.
     */
    result() {
      const filters = (state.settings.globalFilters || []).filter((f) => f && f.field);
      const key = state.version + '|' + state.settings.platform + '|' + state.settings.currency + '|' + JSON.stringify(filters);
      if (memo.key === key) return memo.result;
      const base = store.baseResult();
      if (!filters.length || !Scope.engine.dataset || !Scope.pivot) { base.globalFilters = []; base.base = base; memo = { key, result: base }; return base; }
      const t0 = Date.now();
      const ds = Scope.engine.dataset.build(base);
      const valid = filters.filter((f) => ds.fieldById[f.field]);
      const keep = new Set(Scope.pivot.applyFilters(ds.records, ds.fieldById, valid).map((r) => r._pos && r._pos.line).filter((x) => x !== undefined));
      const res = Scope.calc.aum.run(store.computeInput({ includeLines: keep }));
      res.computeMs = Date.now() - t0 + (base.computeMs || 0);
      res.globalFilters = valid; res.base = base;
      res.issues = base.issues; res.issueCounts = base.issueCounts; res.inputs = base.inputs;
      memo = { key, result: res };
      return res;
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
