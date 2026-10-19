/* Scope shared-folder tests (js/core/shared.js on js/core/drive-vc.js). Run in the browser (tests/index.html) or Node.
 *
 * The folder is DriveVC.memory() and the second person a plain repository with its own copy of the data, so nothing is
 * written to disk. Saving into this browser is switched off while these cases run (the test page shares the app's
 * storage), and the store is put back as it was afterwards.
 */
(function (global) {
  'use strict';
  const Scope = global.Scope, T = Scope.tests, VC = global.DriveVC, SH = Scope.shared, store = Scope.store;
  const assert = (c, msg) => { if (!c) throw new Error(msg || 'assertion failed'); };
  const eq = (a, b, msg) => { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${msg || ''} expected ${y}, got ${x}`); };
  const FAST = { pollMs: 0, settleMs: 5, verifyMs: 5 };
  const memCache = () => { const m = new Map(); return { get: async (k) => m.get(k), set: async (k, v) => { m.set(k, v); }, del: async (k) => { m.delete(k); } }; };
  /** Run fn with the store's browser saving switched off, then restore the store and the repository. */
  async function sandbox(fn) {
    const keep = {}, names = ['persistSheets', 'persistSettings', 'persistAdjustments', 'persistReportInputs'], saved = JSON.stringify(store.state, (k, v) => (v instanceof ArrayBuffer ? undefined : v)), tpl = store.state.template, repo = SH.repo;
    for (const n of names) { keep[n] = store[n]; store[n] = () => Promise.resolve(true); }
    try { return await fn(); } finally {
      if (SH.repo && SH.repo !== repo) SH.repo.disconnect(); SH.repo = repo;
      Object.assign(store.state, JSON.parse(saved)); store.state.template = tpl;
      for (const n of names) store[n] = keep[n];
      store.emit();
    }
  }
  /** Scope with the demo loaded as a user's own workbook. */
  function loadWorkbook() {
    const sheets = T.demoSheets();
    store.setSheets(sheets, Object.fromEntries(Object.keys(sheets).map((k) => [k, { kind: 'xlsx', file: 'Workbook.xlsx', sheetName: k }])), {});
    store.state.edits = []; store.state.adjustments = []; store.state.settings.calcOverrides = {}; store.state.reportData = {}; store.state.template = null;
    delete store.state.settings.reportInputs; delete store.state.settings.reportTemplateText;
  }
  /** A second person: a repository on the same folder with its own copy of the data. */
  function other(folder, name, timing) {
    const p = { data: null };
    p.repo = VC.open(Object.assign({ store: folder, appId: 'other', user: name, local: memCache(), getState: () => JSON.parse(JSON.stringify(p.data)), setState: (s) => { p.data = s; } }, FAST, timing));
    return p;
  }

  T.add('shared folder: what Scope shares goes out and comes back the same (sheets, Mapping rows, corrections, shared settings, report inputs, template); the view, currency and name stay', () => sandbox(async () => {
    loadWorkbook();
    store.addEdit({ table: 'securityMapping', values: { codeName: 'Deal 01', holdingsName: 'Deal 01 loan', identificationId: 'X1', holdingId: 'H1', transactionGroup: 'Deal 01' }, note: 'gap' });
    store.addAdjustment({ table: 'assets', key: 'A001', field: 'internal_grade', original: 'BBB', value: 'BBB-', reason: 'review' });
    store.setOverride('fxQuote', null, 'eur_per_ccy');
    store.state.settings.reportInputs = { 'Fund 1': { mandateSize: 400 } };
    store.state.reportData = { market: { name: 'curves.xlsx', series: [{ name: 'A', points: [[1, 2]] }] } };
    store.state.template = { name: 'house.pptx', at: '2026-11-01', bytes: new Uint8Array([80, 75, 3, 4, 0, 255]).buffer };
    store.state.settings.platform = 'Fund 1'; store.state.settings.currency = 'GBP'; store.state.settings.user = 'Sam';
    const out = JSON.parse(JSON.stringify(SH.stateOf()));
    eq(Object.keys(out).sort(), ['adjustments', 'datasetLabel', 'edits', 'reportData', 'settings', 'sheets', 'sources', 'template']);
    eq(Object.keys(out.settings).sort(), ['calcOverrides', 'reportInputs'], 'only shared settings travel');
    assert(out.sheets.Holdings.length === store.state.sheets.Holdings.rows.length && out.edits.length === 1 && out.adjustments.length === 1, 'sheets, rows, corrections');
    assert(typeof out.template.base64 === 'string' && !('bytes' in out.template), 'template as text');
    // someone else's browser: different personal settings, nothing loaded
    store.state.settings.platform = 'Fund 2'; store.state.settings.user = 'Alex'; store.state.sheets = {}; store.state.edits = []; store.state.template = null;
    SH.applyState(JSON.parse(JSON.stringify(out)));
    eq(JSON.parse(JSON.stringify(SH.stateOf())), out, 'back the same');
    eq(Array.from(new Uint8Array(store.state.template.bytes)), [80, 75, 3, 4, 0, 255], 'template bytes');
    eq([store.state.settings.platform, store.state.settings.currency, store.state.settings.user], ['Fund 2', 'GBP', 'Alex'], 'personal settings stay');
    assert(store.state.datasetSource === 'workbook' && store.result().metrics.total_exposure_m > 0, 'the calculation runs on it');
  }));

  T.add('shared folder: two people each add a Mapping row and a correction, both are kept; the same setting changed by both asks which to keep', () => sandbox(async () => {
    loadWorkbook(); store.state.settings.user = 'Sam';
    const folder = VC.memory({ lag: 3 }), repo = await SH.attach(folder, Object.assign({ local: memCache() }, FAST));
    assert(repo.status().empty, 'new folder'); eq(await repo.init('First version'), { ok: true, version: 1 });
    const alex = other(folder, 'Alex'); await alex.repo.connect(); await alex.repo.load();
    eq(alex.data.sheets.Holdings.length, store.state.sheets.Holdings.rows.length, 'Alex has the workbook');
    store.addEdit({ table: 'securityMapping', values: { codeName: 'Deal 01' } }); store.addAdjustment({ table: 'assets', key: 'A001', field: 'sector', original: 'x', value: 'y', reason: 'Sam' });
    alex.data.edits.push({ id: 'alex-row', sheet: 'Mapping', table: 'securityMapping', values: { codeName: 'Deal 02' } });
    alex.data.adjustments.push({ id: 'alex-adj', table: 'assets', key: 'A002', field: 'sector', original: 'x', value: 'z', reason: 'Alex' });
    eq(repo.unsaved().length, 2, 'two unsaved changes');
    eq((await alex.repo.save('Alex rows')).version, 2);
    const r = await repo.save('Sam rows'); eq(r.version, 3, 'Sam merged then saved');
    eq(store.state.edits.map((e) => e.values.codeName).sort(), ['Deal 01', 'Deal 02'], 'both Mapping rows');
    eq(store.state.adjustments.map((a) => a.reason).sort(), ['Alex', 'Sam'], 'both corrections');
    await alex.repo.refresh(); eq(alex.data.edits.length, 2, 'Alex has both too');
    // both change the FX quote
    store.setOverride('fxQuote', null, 'eur_per_ccy');
    alex.data.settings.calcOverrides.fxQuote = 'ccy_per_eur'; await alex.repo.save('FX');
    const c = await repo.save();
    assert(c.conflicts && c.conflicts.length === 1, 'one question'); eq(SH.describe({ p: c.conflicts[0].p, b: c.conflicts[0].base, a: c.conflicts[0].mine }).where, 'Calculation settings › FX quote');
    await repo.resolve({ [c.conflicts[0].k]: 'mine' }); eq((await repo.save()).version, 5);
    eq(store.state.settings.calcOverrides.fxQuote, 'eur_per_ccy');
    const h = await repo.history(); eq(h.map((e) => `${e.v} ${e.by}`), ['5 Sam', '4 Alex', '3 Sam', '2 Alex', '1 Sam']);
    // an old version, read only, then back
    await repo.preview(h[4].id); eq(store.state.edits.length, 0, 'v1 had no rows'); await repo.endPreview(); eq(store.state.edits.length, 2, 'back');
  }));

  T.add('shared folder: changes in words (sheets in rows, settings by page, the template as a file)', () => {
    const d = (p, b, a) => SH.describe({ p, b: b === undefined ? undefined : JSON.stringify(b), a: a === undefined ? undefined : JSON.stringify(a) });
    eq(d(['sheets', 'Holdings'], [[1], [2]], [[1], [2], [3]]), { where: 'Holdings sheet', what: 'replaced (2 → 3 rows)' });
    eq(d(['sheets', 'Mapping'], [[1]], [[2]]).what, 'cells changed (1 rows)');
    eq(d(['settings', 'calcOverrides', 'roles', 'Holdings.nominal'], undefined, 'RA_Commitment QC'), { where: 'Calculation settings › Column choices › Holdings.nominal', what: 'set to RA_Commitment QC' });
    eq(d(['settings', 'reportInputs', 'Fund 1', 'mandateSize'], 400, 450), { where: 'Investor reporting › Fund 1 › mandateSize', what: '400 → 450' });
    eq(d(['edits'], [{ id: 'a' }], [{ id: 'a' }, { id: 'b' }]), { where: 'Mapping rows added in Scope', what: '1 added' });
    eq(d(['template', 'base64'], 'UEsDBA', 'UEsDBB'), { where: 'PowerPoint template', what: 'file replaced' });
  });

  T.add('shared folder: saves at the same moment on a slow share land one at a time and keep every change', async () => {
    const folder = VC.memory({ lag: 10 }), people = [0, 1, 2, 3].map((i) => other(folder, 'P' + i, { settleMs: 40, verifyMs: 40 }));
    people[0].data = { s: {} }; await people[0].repo.connect(); await people[0].repo.init();
    for (const p of people.slice(1)) { await p.repo.connect(); await p.repo.load(); }
    people.forEach((p, i) => { p.data.s['k' + i] = i; });
    const out = await Promise.all(people.map((p) => p.repo.save()));
    eq(out.map((r) => r.version).sort(), [2, 3, 4, 5], 'one version each');
    await people[0].repo.refresh(); eq(Object.keys(people[0].data.s).sort(), ['k0', 'k1', 'k2', 'k3'], 'every change');
  });
})(typeof window !== 'undefined' ? window : globalThis);
