/* Scope core: application store (Scope.store).
 *
 * Holds the four AUM input sheets (Holdings, Mapping, Hardcoded, ESG Hardcoded) as cell grids, the rows added to Mapping
 * in the app (edits), the previous month's Holdings (so a monthly update can be undone), the user's settings (view,
 * currency, global filters, calculation overrides), the manual-correction history and the cached results.
 * result() is what every page uses: the AUM calculation (js/calc/aum.js) for the selected view and currency with the
 * global filters applied. Settings and corrections persist in local storage; a loaded workbook, its edits and the
 * previous Holdings persist in IndexedDB (a real Holdings sheet is too large for local storage).
 */
(function (global) {
  'use strict';
  const Scope = global.Scope || (global.Scope = {});
  const LS = { settings: 'scope.settings', adjustments: 'scope.adjustments' };
  const SHEETS = ['Holdings', 'Mapping', 'Hardcoded', 'ESG Hardcoded'];
  const OPTIONAL_SHEETS = ['Scope Settings']; // read when present: names, groups, weights, views, look-through

  const listeners = new Set();
  const state = {
    sheets: {},          // name → { name, rows } (rows[r][c] = Excel row r+1, column c+1)
    sources: {},         // name → { kind: 'demo' | 'xlsx' | 'csv' | 'paste', file, sheetName, loadedAt }
    datasetLabel: '',    // 'SYNTHETIC DEMO' for the bundled demo, otherwise 'Workbook data'
    datasetSource: '',   // 'demo' | 'workbook'
    edits: [],           // rows added to Mapping in the app: { id, sheet: 'Mapping', table, values: { colKey: value }, note, at }
    previousHoldings: null, // { rows, source, replacedAt } the Holdings sheet before the last monthly update (one step of undo)
    settings: {
      platform: '', currency: 'EUR', sidebar: true,
      globalFilters: [],   // [{ field, op, value }] applied to every page (js/core/filters.js)
      calcOverrides: {},   // { roles: { 'Holdings.nominal': header }, views: { name: composition }, investors: { label: [type, weight] }, names: { label: display }, fxQuote }
    },
    adjustments: [],     // { id, table:'positions'|'assets', key, field, original, value, reason, user, at }
    version: 0,
  };
  let memo = { key: null, result: null }, baseMemo = { key: null, result: null }, sheetsMemo = { key: null, sheets: null };

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
    OPTIONAL_SHEETS,
    /** Register a listener called after every change; returns an unsubscribe function. */
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** Bump the data version, drop cached results and notify every listener (the app re-renders). */
    emit() { state.version++; memo.key = null; baseMemo.key = null; sheetsMemo.key = null; for (const fn of Array.from(listeners)) { try { fn(state); } catch (e) { console.error(e); } } },

    // ---------- input sheets ----------
    /**
     * Load sheets: { Holdings: grid, … } with their sources. `merge` keeps sheets not supplied (e.g. pasting one sheet).
     * Data loaded by the user is saved to IndexedDB so it is still there next time; the demo is never saved.
     */
    setSheets(sheets, sources, opts) {
      const o = opts || {};
      const wasDemo = state.datasetSource === 'demo';
      if (!o.merge) { state.sheets = {}; state.sources = {}; }
      // your own data never mixes with the synthetic demo: loading any sheet of yours clears every demo sheet
      // (including the demo's Scope Settings), so missing sheets show as missing rather than as demo data
      if (!o.demo) for (const n of Object.keys(state.sheets)) if ((state.sources[n] || {}).kind === 'demo') { delete state.sheets[n]; delete state.sources[n]; }
      if (o.demo || !o.merge) { state.edits = []; state.previousHoldings = null; } // edits belong to the workbook they were made on
      const now = new Date().toISOString();
      for (const [name, g] of Object.entries(sheets || {})) {
        if (!(SHEETS.includes(name) || OPTIONAL_SHEETS.includes(name)) || !g || !g.rows) continue;
        // a monthly update: the new Holdings replaces the loaded one, which is kept for one step of undo
        if (name === 'Holdings' && o.merge && !o.demo && !wasDemo && state.sheets.Holdings && state.sheets.Holdings.rows !== g.rows) state.previousHoldings = { rows: state.sheets.Holdings.rows, source: state.sources.Holdings || null, replacedAt: now };
        state.sheets[name] = { name, rows: g.rows };
        state.sources[name] = Object.assign({ loadedAt: now }, (sources || {})[name] || { kind: o.demo ? 'demo' : 'paste' });
      }
      state.datasetSource = o.demo ? 'demo' : 'workbook';
      state.datasetLabel = o.demo ? (o.label || 'SYNTHETIC DEMO') : 'Workbook data';
      if (!o.demo) store.persistSheets();
      store.emit();
    },
    /** Put back the Holdings sheet replaced by the last monthly update (the current one is not kept). */
    restorePreviousHoldings() {
      const prev = state.previousHoldings; if (!prev) return false;
      state.sheets.Holdings = { name: 'Holdings', rows: prev.rows };
      state.sources.Holdings = Object.assign({}, prev.source || { kind: 'xlsx' }, { restoredAt: new Date().toISOString() });
      state.previousHoldings = null;
      store.persistSheets(); store.emit();
      return true;
    },
    /** Restore sheets, edits and the previous Holdings saved earlier in this browser (loadSavedSheets). */
    loadSaved(saved) {
      store.setSheets(saved.sheets, saved.sources, { demo: false });
      state.edits = Array.isArray(saved.edits) ? saved.edits : [];
      state.previousHoldings = saved.previousHoldings && saved.previousHoldings.rows ? saved.previousHoldings : null;
      store.persistSheets(); // setSheets saved the sheets without them
      store.emit();
    },

    // ---------- rows added to Mapping in the app (closing mapping gaps without leaving Scope) ----------
    /**
     * Append a row to one of the Mapping tables: addEdit({ table: 'securityMapping', values: { codeName, holdingsName,
     * identificationId, holdingId, transactionGroup }, note }). Table keys and value keys are those of the calculation's
     * MAPPING_TABLES. The row is appended below the table when the sheets are read (effectiveSheets), so the calculation,
     * every page and the workbook download see it like any other row. The original sheet is never changed.
     */
    addEdit(edit) {
      const e = Object.assign({ id: Scope.util.uid(), sheet: 'Mapping', at: new Date().toISOString(), user: state.settings.user || 'local user' }, edit);
      state.edits.push(e);
      store.persistSheets(); store.emit();
      return e;
    },
    /** Append several rows in one update (one recalculation). */
    addEdits(list) {
      const out = [];
      for (const edit of list || []) out.push(Object.assign({ id: Scope.util.uid(), sheet: 'Mapping', at: new Date().toISOString(), user: state.settings.user || 'local user' }, edit));
      if (!out.length) return out;
      state.edits.push(...out);
      store.persistSheets(); store.emit();
      return out;
    },
    /** Remove one row added in the app. */
    removeEdit(id) { const n = state.edits.length; state.edits = state.edits.filter((e) => e.id !== id); if (state.edits.length !== n) { store.persistSheets(); store.emit(); } },
    /** Remove every row added in the app. */
    clearEdits() { if (!state.edits.length) return; state.edits = []; store.persistSheets(); store.emit(); },
    /**
     * The sheets with the app's additions applied: Mapping gets one appended row per edit, placed in its table's columns on
     * the first row below that table (found by the calculation's own table locator). Other sheets are returned as they are.
     * Edits whose table cannot be located are left out and reported in .unapplied.
     */
    effectiveSheets() {
      const key = state.version;
      if (sheetsMemo.key === key && sheetsMemo.sheets) return sheetsMemo.sheets;
      const out = Object.assign({}, state.sheets), unapplied = [];
      const edits = state.edits.filter((e) => e && e.sheet === 'Mapping' && e.table && e.values);
      const A = Scope.calc && Scope.calc.aum;
      if (edits.length && out.Mapping && A && A.locateMapping) {
        const rows = out.Mapping.rows.map((r) => (r ? r.slice() : []));
        const grid = { name: 'Mapping', rows, addedRows: [] }; // addedRows: 0-based indexes of the rows appended here (the calculation marks them)
        const tables = A.locateMapping(grid), next = {};
        for (const [k, t] of Object.entries(tables)) next[k] = t.rows.length ? t.rows[t.rows.length - 1].__row : t.headerRow + 1; // 0-based index of the row below the table
        for (const e of edits) {
          const t = tables[e.table];
          if (!t || !Object.keys(t.cols).length) { unapplied.push(e); continue; }
          const r = next[e.table]++;
          while (rows.length <= r) rows.push([]);
          grid.addedRows.push(r);
          for (const [ck, c] of Object.entries(t.cols)) if (e.values[ck] !== undefined && e.values[ck] !== null && e.values[ck] !== '') rows[r][c] = e.values[ck];
          // the helper column left of Security Mapping (P) repeats the holding ID in the workbook
          if (e.table === 'securityMapping' && t.cols.holdingId !== undefined && e.values.holdingId !== undefined) { const helper = Math.min.apply(null, Object.values(t.cols)) - 1; if (helper >= 0 && (rows[t.headerRow] || [])[helper] === undefined) rows[r][helper] = e.values.holdingId; }
        }
        out.Mapping = grid;
      } else if (edits.length) unapplied.push(...edits);
      Object.defineProperty(out, 'unapplied', { value: unapplied, enumerable: false });
      sheetsMemo = { key, sheets: out };
      return out;
    },
    /** Sheet grid by name (or null). */
    sheet(name) { return state.sheets[name] || null; },
    /** Sheets not loaded yet. */
    missingSheets() { return SHEETS.filter((n) => !state.sheets[n]); },
    /** Legacy table accessor: optional extra tables (e.g. fund look-through) are not part of the four-sheet input. */
    table() { return []; },
    /** Save user-loaded sheets, the app's additions and the previous Holdings to IndexedDB (best effort). */
    persistSheets() {
      const payload = { sheets: state.sheets, sources: state.sources, edits: state.edits, previousHoldings: state.previousHoldings, at: new Date().toISOString() };
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
      delete state.settings.calcOverrides.fundHolders; // earlier builds kept a separate register; look-through now comes from the views
    },

    // ---------- calculation ----------
    /** Input for the AUM calculation from the current state (extra fields such as includeLines are merged in). */
    computeInput(extra) {
      return Object.assign({
        sheets: store.effectiveSheets(), sources: state.sources, adjustments: store.activeAdjustments(), overrides: state.settings.calcOverrides,
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
