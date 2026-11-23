/* Scope period-comparison tests (js/analysis/compare.js, js/core/source.js, js/core/period-names.js, tools/data-folder.js).
 * Run in the browser
 * (tests/index.html) or Node; the data-folder cases need Node's file system and run in Node only, on a folder made in
 * the system temp directory and removed afterwards.
 *
 * The two periods are the demo and a copy of it with one asset's amounts doubled and another asset's positions removed,
 * so every change is known in advance.
 */
(function (global) {
  'use strict';
  const Scope = global.Scope, T = Scope.tests, U = Scope.util, CMP = Scope.compare;
  const assert = (c, msg) => { if (!c) throw new Error(msg || 'assertion failed'); };
  const close = (a, b, eps, msg) => { if (!(Math.abs(a - b) <= (eps === undefined ? 1e-6 : eps))) throw new Error(`${msg || ''} expected ${b}, got ${a}`); };

  /** The demo as the later period, and an earlier copy: asset `up` at half its amounts, asset `gone` not yet held. */
  function twoPeriods() {
    const later = T.demo();
    const rows = later.rows.slice().sort((a, b) => b.exposure_m - a.exposure_m);
    const up = rows[0].code, gone = rows[rows.length - 1].code;
    const s = T.demoSheets(), H = s.Holdings.rows, head = H[2], id = head.indexOf('Identification ID');
    const amountCols = ['Balance Nominal/Number', 'RA_Commitment QC', 'Current Drawn Amount CCY', 'Initial Commitment Amount CCY', 'Current Underlying Amount PC', 'Current Underlying Amount RC', 'Gross Notional PC', 'Gross Notional RC', 'Balance Unfunded Amount', 'Current Drawn Amount PC', 'Balance Book Value PC'].map((h) => head.indexOf(h)).filter((c) => c >= 0);
    s.Holdings.rows = H.filter((r, i) => i < 3 || !r || String(r[id]) !== String(gone)).map((r, i) => {
      if (i < 3 || !r || String(r[id]) !== String(up)) return r;
      const c = r.slice(); for (const k of amountCols) if (typeof c[k] === 'number') c[k] = c[k] / 2; return c;
    });
    const earlier = T.demo({ sheets: s, adjustments: [] });
    return { earlier, later, up, gone };
  }

  T.add('compare: key figures are later − earlier, shares in points, counts with a percentage', () => {
    const { earlier, later } = twoPeriods();
    const f = Object.fromEntries(CMP.figures(earlier.metrics, later.metrics).map((x) => [x.key, x]));
    close(f.total_exposure_m.change, later.metrics.total_exposure_m - earlier.metrics.total_exposure_m, 1e-9, 'exposure change');
    close(f.total_exposure_m.changePct, f.total_exposure_m.change / earlier.metrics.total_exposure_m, 1e-12, 'exposure %');
    assert(f.n_assets.change === 1, `one more asset in the later period, got ${f.n_assets.change}`);
    close(f.fixed_share.change, later.metrics.fixed_share - earlier.metrics.fixed_share, 1e-12, 'fixed share in points');
    assert(!U.isNum(f.fixed_share.changePct), 'no % change on a share');
    assert(f.w_rating_label.from === earlier.metrics.w_rating_label && U.isNum(f.w_rating_label.change), 'rating labels and notches');
  });

  T.add('compare: asset movements find the new asset, the one that grew, and sum to the exposure change', () => {
    const { earlier, later, up, gone } = twoPeriods();
    const mv = CMP.assets(earlier.rows, later.rows), by = new Map(mv.map((a) => [a.code, a]));
    assert(by.get(gone).status === 'new' && !U.isNum(by.get(gone).from), 'the asset added in the later period is new');
    assert(by.get(up).status === 'up' && by.get(up).change > 0, 'the asset with doubled amounts is up');
    close(U.sum(mv, (a) => a.change), later.metrics.total_exposure_m - earlier.metrics.total_exposure_m, 1e-6, 'movements add up to the change');
    const back = CMP.counts(CMP.assets(later.rows, earlier.rows));
    assert(back.exited === 1 && back.new === 0, 'the other way round, the same asset has exited');
    assert(Math.abs(mv[0].change) >= Math.abs(mv[mv.length - 1].change), 'biggest movement first');
  });

  T.add('compare: exposure by a dimension keeps every label from both periods and totals to each side', () => {
    const { earlier, later } = twoPeriods();
    const bd = CMP.breakdown(earlier.rows, later.rows, (r) => r.sector || '(blank)');
    close(U.sum(bd, (x) => x.from), earlier.metrics.total_exposure_m, 1e-6, 'from total');
    close(U.sum(bd, (x) => x.to), later.metrics.total_exposure_m, 1e-6, 'to total');
    close(U.sum(bd, (x) => x.shareTo), 1, 1e-9, 'shares add to 100%');
    assert(bd.every((x, i) => i === 0 || bd[i - 1].to >= x.to), 'largest first');
  });

  T.add('data folder: a period without the other sheets borrows the loaded ones, and says so', () => {
    const store = Scope.store, keep = { sheets: store.state.sheets, sources: store.state.sources, version: store.state.version };
    try {
      const s = T.demoSheets();
      store.state.sheets = { Holdings: s.Holdings, Mapping: s.Mapping, Hardcoded: s.Hardcoded, 'ESG Hardcoded': s['ESG Hardcoded'] };
      store.state.sources = {}; store.state.version += 1;
      const out = { sheets: { Holdings: { name: 'Holdings', rows: s.Holdings.rows } }, sources: { Holdings: { kind: 'xlsx', file: 'May.xlsx', period: 'Q2/May' } } };
      const c = Scope.source.complete(out, store);
      assert(c.sheets.Holdings === out.sheets.Holdings, 'its own Holdings');
      assert(c.borrowed.join() === 'Mapping,Hardcoded,ESG Hardcoded', `borrowed ${c.borrowed.join()}`);
      const r = store.resultFor(c.sheets, c.sources, 'test-period');
      close(r.metrics.total_exposure_m, T.demo().metrics.total_exposure_m, 1e-6, 'same data, same exposure');
      assert(store.resultFor(c.sheets, c.sources, 'test-period') === r, 'cached until something changes');
    } finally { store.state.sheets = keep.sheets; store.state.sources = keep.sources; store.state.version = keep.version + 2; }
  });

  T.add('corrections by month: made for the month loaded; a new month waits for keep or not; Remove puts the file value back; the CSV lists them all', () => {
    const store = Scope.store, keep = { sheets: store.state.sheets, sources: store.state.sources, version: store.state.version, adj: store.state.adjustments };
    const s = T.demoSheets(), H = s.Holdings.rows, rd = H[2].indexOf('Reporting Date');
    const load = (date) => { const rows = H.map((r, i) => (i < 3 || !r ? r : r.map((v, c) => (c === rd ? date : v)))); store.state.sheets = { Holdings: { name: 'Holdings', rows }, Mapping: s.Mapping, Hardcoded: s.Hardcoded, 'ESG Hardcoded': s['ESG Hardcoded'] }; store.state.sources = {}; store.emit(); return store.result(); };
    try {
      store.state.adjustments = [];
      const sep = load('2026-09-30'), p = sep.assets[0].positions[0], before = p.margin_bps;
      assert(store.holdingsMonth() === '2026-09', `month ${store.holdingsMonth()}`);
      const a = store.addAdjustment({ table: 'positions', key: p.key, field: 'spread', original: before, value: '999', reason: 'test' });
      const pOf = (r) => r.assets.flatMap((x) => x.positions).find((x) => x.key === p.key);
      assert(a.months.join() === '2026-09' && pOf(store.result()).margin_bps === 999, 'made for September and applied');
      const asset = store.addAdjustment({ table: 'assets', key: sep.assets[1].code, field: 'country', original: '', value: 'Testland', reason: 'test' });
      // October: the September fix waits, the asset attribute still applies
      const oct = load('2026-10-31');
      assert(store.holdingsMonth() === '2026-10' && pOf(oct).margin_bps === before, 'not applied to October: ' + pOf(oct).margin_bps);
      assert(store.pendingAdjustments().map((x) => x.id).join() === a.id && store.activeAdjustments().some((x) => x.id === asset.id), 'waiting; the asset correction applies');
      store.decideAdjustments(a.id, true);
      assert(pOf(store.result()).margin_bps === 999 && !store.pendingAdjustments().length && a.months.join() === '2026-09,2026-10', 'kept for October');
      // November: not for November leaves it for its own months
      load('2026-11-30'); store.decideAdjustments(a.id, false);
      assert(!store.pendingAdjustments().length && pOf(store.result()).margin_bps === before && a.skip.join() === '2026-11', 'not for November');
      assert(pOf(load('2026-10-31')).margin_bps === 999, 'back on October it applies again');
      // a later correction of the same field, then Remove: the file's own value, both kept in the history
      const b = store.addAdjustment({ table: 'positions', key: p.key, field: 'spread', original: before, value: '555', reason: 'second' });
      assert(pOf(store.result()).margin_bps === 555 && a.superseded === b.id, 'the later one wins');
      assert(store.removeAdjustments(b.id) === 2 && pOf(store.result()).margin_bps === before && a.reverted && b.reverted && store.state.adjustments.length === 3, 'Remove clears the field');
      const csv = Scope.corrections ? Scope.corrections.csv(store.result()) : null;
      if (csv) assert(/^Status,Asset code,Asset,Investor/.test(csv) && (csv.match(/\nRemoved,/g) || []).length === 2 && csv.includes('Testland'), 'CSV: ' + csv.slice(0, 200));
    } finally { store.state.adjustments = keep.adj; store.state.sheets = keep.sheets; store.state.sources = keep.sources; store.state.version = keep.version + 5; store.emit(); }
  });

  T.add('transactions grouped: each transaction group of two or more assets is one line; totals, shares and charts do not change; the sheets per Holdings line are untouched', () => {
    const G = Scope.grouping, AUM = Scope.calc.aum, res = T.demo(), g = G.apply(res);
    assert(g !== res && g.grouped && g.ungrouped === res && G.apply(res) === g, 'grouped once, the result as it was kept');
    const groups = new Map(); for (const r of res.rows) if (r.transaction_group) groups.set(r.transaction_group, (groups.get(r.transaction_group) || 0) + 1);
    const multi = Array.from(groups).filter(([, n]) => n > 1), lines = res.rows.length - U.sum(multi, ([, n]) => n) + multi.length;
    assert(multi.length > 0 && g.rows.length === lines && g.metrics.n_assets === lines, `lines ${g.rows.length}, expected ${lines}`);
    close(U.sum(g.rows, (r) => r.exposure_m), res.metrics.total_exposure_m, 1e-6, 'exposure adds up');
    close(U.sum(g.rows, (r) => r.drawn_m), res.metrics.total_drawn_m, 1e-6, 'drawn adds up');
    // every other figure is the members': the same weighted spread, shares and split by sector as without grouping
    const m = AUM.summarise(g.rows, res.ratingScale, res.config), m0 = AUM.summarise(res.rows, res.ratingScale, res.config);
    for (const k of ['total_exposure_m', 'w_margin_bps', 'w_wal_years', 'sub_ig_share', 'fixed_share', 'watchlist_share', 'n_positions']) close(m.metrics[k], m0.metrics[k], 1e-9, k);
    const bySector = new Map(m0.distributions.sector.map((d) => [d.label, d]));
    assert(m.distributions.sector.length === m0.distributions.sector.length && m.metrics.n_assets === lines, 'the same sectors; only the number of lines differs');
    for (const d of m.distributions.sector) { close(d.exposure_m, bySector.get(d.label).exposure_m, 1e-6, 'sector ' + d.label); assert(d.count === bySector.get(d.label).count, 'sector count ' + d.label); }
    // one grouped line: sums, weighted spread, latest maturity, "Mixed" where the deals differ, its deals kept
    const [name] = multi[0], line = g.rows.find((r) => r.code === 'tg:' + name), mem = res.rows.filter((r) => r.transaction_group === name);
    close(line.exposure_m, U.sum(mem, (r) => r.exposure_m), 1e-9, 'a line is its deals added up');
    close(line.margin_bps, U.sum(mem, (r) => r.margin_bps * r.exposure_m) / U.sum(mem, (r) => r.exposure_m), 1e-9, 'spread weighted by exposure');
    assert(+line.maturity_date === Math.max(...mem.map((r) => +r.maturity_date)) && line.name === name && G.members(g, line.code).length === mem.length, 'latest maturity, named by the group, deals kept');
    const diff = ['sector', 'country', 'sponsor', 'currency'].find((k) => new Set(mem.map((r) => r[k])).size > 1); if (diff) assert(line[diff] === 'Mixed', `${diff} differs: Mixed`);
    for (const [inv, v] of Object.entries(line.investors)) close(v, U.sum(mem, (r) => (r.investors || {})[inv] || 0), 1e-9, 'investor ' + inv);
    close(line.asset.nominal, U.sum(mem, (r) => r.asset.nominal), 1e-3, 'the investor book row adds the deals');
    // never grouped: positions and assets (Holdings, Calculations and Positions read these)
    assert(g.positions === res.positions && g.assets === res.assets, 'positions and assets untouched');
    // a question by asset lists the group; a deal named means its group
    const ds = Scope.engine.dataset.build(g), rec = ds.records.find((r) => r.asset_code === line.code);
    assert(rec && rec.asset_name === name && Scope.engine.dataset.build(res).records.every((r) => !String(r.asset_code).startsWith('tg:')), 'dataset: the group as the asset, only when grouped');
    const a = Scope.engine.ask.answer(g, `tell me about ${mem[0].name}`);
    assert(a.kind === 'asset' && a.headline === name, 'a deal named when grouped is its group: ' + a.headline);
    const top = Scope.engine.ask.answer(g, 'how many assets');
    assert(top.headline === String(lines), 'counts lines: ' + top.headline);
  });

  // A folder picked in the browser, as a folder upload gives it: files with their path below the picked folder.
  const pickedFile = (rel, text, at) => {
    const bytes = new TextEncoder().encode(text);
    return { name: rel.split('/').pop(), webkitRelativePath: rel, size: bytes.length, lastModified: at || 1767225600000, arrayBuffer: async () => bytes.buffer.slice(0) };
  };
  T.add('data folder picked in the browser: the same periods and order as the server finds, lock files and deep folders skipped', async () => {
    const files = ['Q2 2026/May/AUM.xlsx', 'Q2 2026/April/AUM.xlsx', 'Q1 2026/AUM.xlsx', 'Q2 2026/~$AUM.xlsx', 'Q2 2026/notes.docx', 'Q4 2025/Holdings.csv', '.hidden/AUM.xlsx', 'a/b/c/d/AUM.xlsx']
      .map((r) => pickedFile('Quarterly data/' + r, 'x'));
    const dir = Scope.source._treeFromFiles(files);
    assert(dir.name === 'Quarterly data', `folder name ${dir.name}`);
    const ids = (await Scope.source._walk(dir)).map((p) => p.id);
    assert(ids.join('|') === 'Q4 2025|Q1 2026|Q2 2026/April|Q2 2026/May', `periods ${ids.join('|')}`);
  });

  T.add('data folder picked in the browser: a period loads like a drop, tagged with its period; Forget empties the listing', async () => {
    const SRC = Scope.source, csv = 'Identification ID,Name\n1,Alpha\n';
    try {
      SRC.useFiles([pickedFile('Quarterly data/Q2 2026/May/Holdings.csv', csv), pickedFile('Quarterly data/Q1 2026/Holdings.csv', csv + '2,Beta\n')]);
      const list = await SRC.periods(true);
      assert(list.configured && list.local && !list.needsPermission && list.name === 'Quarterly data', 'listed as a local folder');
      assert(SRC.groups().map((g) => g.top).join() === 'Q2 2026,Q1 2026', 'newest quarter first');
      const out = await SRC.read('Q1 2026');
      assert(out.period === 'Q1 2026' && out.sources.Holdings.period === 'Q1 2026' && out.sources.Holdings.folder === 'Quarterly data', 'tagged with its period');
      assert(out.sheets.Holdings.rows.length === 3, `rows ${out.sheets.Holdings.rows.length}`);
      assert((await SRC.read('Q1 2026')) === out, 'read once while its files are unchanged');
    } finally { await SRC.forget(); }
    const after = SRC.cached();
    assert(after && !after.configured && after.periods.length === 0, 'nothing listed once forgotten');
  });

  T.add('data folder change notice: a loaded period\'s file changed in the folder is noticed, Not now hides it until it changes again, Refresh reloads only that period\'s sheets', async () => {
    const SRC = Scope.source, store = Scope.store, keep = { sheets: store.state.sheets, sources: store.state.sources, version: store.state.version }, apply = SRC.onApply;
    const csv = 'Identification ID,Name\n1,Alpha\n';
    const hold = pickedFile('Quarterly data/Q2 2026/May/Holdings.csv', csv), map = pickedFile('Quarterly data/Q2 2026/May/Mapping.csv', 'Code,Name\nA,Alpha\n');
    const edit = (f, text, at) => { const b = new TextEncoder().encode(text); f.size = b.length; f.lastModified = at; f.arrayBuffer = async () => b.buffer.slice(0); };
    let applied = null;
    try {
      SRC.useFiles([hold, map]);
      await SRC.periods(true);
      const out = await SRC.read('Q2 2026/May');
      assert(out.sources.Holdings.files.map((f) => f.name).join() === 'Holdings.csv,Mapping.csv', 'the source keeps the files read');
      // Holdings from the period; Mapping dropped on top afterwards (not from the folder)
      store.state.sheets = { Holdings: out.sheets.Holdings, Mapping: { name: 'Mapping', rows: [['x']] } };
      store.state.sources = { Holdings: out.sources.Holdings, Mapping: { kind: 'csv', file: 'Other.csv' } };
      assert(SRC.loadedPeriods().length === 1 && SRC.loadedPeriods()[0].sheets.join() === 'Holdings', 'only the period\'s sheet is watched');
      assert((await SRC.check()) === null && SRC.notice() === null, 'unchanged: no notice');
      edit(hold, csv + '2,Beta\n', 1767312000000);
      const n = await SRC.check();
      assert(n && n.id === 'Q2 2026/May' && n.changed.join() === 'Holdings.csv' && !n.gone.length && n.sheets.join() === 'Holdings', `notice ${JSON.stringify(n)}`);
      if (typeof document !== 'undefined' && Scope.ui) { // the top bar row (only where the UI helpers are loaded)
        const bar = document.createElement('div'); SRC.renderNotice(bar);
        assert(/Inputs changed in the data folder: Holdings\.csv changed in Q2 2026 · May/.test(bar.textContent) && /Refresh/.test(bar.textContent), `bar ${bar.textContent}`);
      }
      SRC.dismiss();
      assert(SRC.notice() === null && (await SRC.check()) === null, 'Not now: hidden while the file stays as it is');
      edit(hold, csv + '2,Beta\n3,Gamma\n', 1767398400000);
      assert((await SRC.check()) !== null, 'changed again: shown again');
      SRC.onApply = (o, from) => { applied = { o, from }; };
      await SRC.refresh();
      assert(applied && applied.from === 'Q2 2026 · May (data folder)', `from ${applied && applied.from}`);
      assert(Object.keys(applied.o.sheets).join() === 'Holdings', `sheets ${Object.keys(applied.o.sheets).join()}: the dropped Mapping is kept`);
      assert(applied.o.sheets.Holdings.rows.length === 4, `rows ${applied.o.sheets.Holdings.rows.length}`);
      assert(SRC.notice() === null, 'no notice after Refresh');
    } finally {
      SRC.onApply = apply; await SRC.forget();
      store.state.sheets = keep.sheets; store.state.sources = keep.sources; store.state.version = keep.version + 2;
    }
  });

  T.add('data folder, each input in its own place: every Holdings file is a month with the shared inputs; a new month is not a change, a shared input changing is', async () => {
    const SRC = Scope.source, store = Scope.store, keep = { sheets: store.state.sheets, sources: store.state.sources, version: store.state.version, layout: store.state.settings.dataLayout }, apply = SRC.onApply;
    const H = 'Identification ID,Name\n1,Alpha\n';
    const files = [pickedFile('Data/Mapping.csv', 'Code,Name\nA,Alpha\n'), pickedFile('Data/Hardcoded.csv', 'Security ID,Project Name\n1,Alpha\n'), pickedFile('Data/ESG Hardcoded.csv', 'Security ID,ESG Score\n1,50\n'),
      pickedFile('Data/Holdings/Sep 2026.csv', H), pickedFile('Data/Holdings/Oct 2026.csv', H + '2,Beta\n')];
    let applied = null;
    try {
      SRC.useFiles(files);
      await SRC.periods(true);
      const guess = SRC.guessLayout();
      assert(JSON.stringify(guess.sheets) === JSON.stringify({ Holdings: { folder: 'Holdings' }, Mapping: { folder: '', file: 'Mapping.csv' }, Hardcoded: { folder: '', file: 'Hardcoded.csv' }, 'ESG Hardcoded': { folder: '', file: 'ESG Hardcoded.csv' } }), `guess ${JSON.stringify(guess.sheets)}`);
      store.state.settings.dataLayout = guess;
      const list = SRC.cached();
      assert(list.split && list.periods.map((p) => p.label).join() === 'Sep 2026,Oct 2026', `months ${list.periods.map((p) => p.label).join()}`);
      const out = await SRC.read('Holdings/Sep 2026.csv');
      assert(Object.keys(out.sheets).sort().join() === 'ESG Hardcoded,Hardcoded,Holdings,Mapping', `sheets ${Object.keys(out.sheets).join()}`);
      assert(out.sheets.Holdings.rows.length === 2 && out.sources.Holdings.file === 'Sep 2026.csv' && out.sources.Mapping.file === 'Mapping.csv', 'Sep 2026.csv read as Holdings although its name does not say so');
      assert(SRC.label('Holdings/Sep 2026.csv') === 'Sep 2026', 'a month is named by its file');
      assert((await SRC.read('Holdings/Oct 2026.csv')).sheets.Holdings.rows.length === 3, 'October is its own month');
      store.state.sheets = out.sheets; store.state.sources = out.sources;
      assert((await SRC.check()) === null, 'unchanged');
      SRC.useFiles(files.concat([pickedFile('Data/Holdings/Nov 2026.csv', H)]));
      assert((await SRC.check()) === null, 'a new month in the Holdings folder is not a change to September');
      assert(SRC.cached().periods.length === 3 || (await SRC.periods(true)).periods.length === 3, 'November offered');
      const m = files[0], b = new TextEncoder().encode('Code,Name\nA,Alpha\nB,Beta\n'); m.size = b.length; m.lastModified = 1767312000000; m.arrayBuffer = async () => b.buffer.slice(0);
      const n = await SRC.check();
      assert(n && n.id === 'Holdings/Sep 2026.csv' && n.folder === '' && n.changed.join() === 'Mapping.csv' && !(n.added || []).length && n.sheets.join() === 'Mapping', `notice ${JSON.stringify(n)}`);
      SRC.onApply = (o) => { applied = o; };
      await SRC.refresh();
      assert(applied && applied.sheets.Mapping.rows.length === 3 && applied.sheets.Holdings.rows.length === 2, 'Refresh reloads September with the new Mapping');
    } finally {
      SRC.onApply = apply; await SRC.forget();
      store.state.settings.dataLayout = keep.layout;
      store.state.sheets = keep.sheets; store.state.sources = keep.sources; store.state.version = keep.version + 2;
    }
  });

  T.add('data folder, each input in its own place: one workbook can supply several inputs, each sheet taken from its own tab; a missing tab is a warning', async () => {
    const SRC = Scope.source, store = Scope.store, keep = store.state.settings.dataLayout;
    const book = Scope.inputs.writeXlsx([{ name: 'Hardcoded', rows: [['Security ID', 'Project Name'], [1, 'Alpha']] }, { name: 'ESG Hardcoded', rows: [['Security ID', 'ESG Score'], [1, 50]] }]);
    const xf = { name: 'Static.xlsx', webkitRelativePath: 'Data/Static.xlsx', size: book.length, lastModified: 1767225600000, arrayBuffer: async () => book.buffer.slice(book.byteOffset, book.byteOffset + book.length) };
    try {
      SRC.useFiles([xf, pickedFile('Data/Holdings/Sep 2026.csv', 'Identification ID,Name\n1,Alpha\n')]);
      await SRC.periods(true);
      const at = { folder: '', file: 'Static.xlsx' };
      store.state.settings.dataLayout = { mode: 'split', sheets: { Holdings: { folder: 'Holdings' }, Mapping: at, Hardcoded: at, 'ESG Hardcoded': at } };
      const out = await SRC.read('Holdings/Sep 2026.csv');
      assert(Object.keys(out.sheets).sort().join() === 'ESG Hardcoded,Hardcoded,Holdings', `sheets ${Object.keys(out.sheets).join()}`);
      assert(out.sheets.Hardcoded.rows[1][1] === 'Alpha' && out.sheets['ESG Hardcoded'].rows[1][1] === 50, 'each from its own tab');
      assert(out.warnings.some((w) => /Static\.xlsx has no Mapping sheet/.test(w)), `warnings ${out.warnings.join(' | ')}`);
    } finally { await SRC.forget(); store.state.settings.dataLayout = keep; }
  });

  T.add('compare, more periods: a column per period earliest first, change and status from the earliest to the latest, two periods as before', () => {
    const { earlier, later, up, gone } = twoPeriods();
    const f2 = CMP.figures(earlier.metrics, later.metrics), fN = CMP.figuresN([earlier.metrics, later.metrics]);
    assert(fN.every((x, i) => (Number.isNaN(x.change) ? Number.isNaN(f2[i].change) : x.change === f2[i].change) && (x.kind === 'rating' ? x.values[0] === f2[i].from : x.values[1] === f2[i].to || (Number.isNaN(x.values[1]) && Number.isNaN(f2[i].to)))), 'two periods: the same figures as before');
    // three periods: earlier, later, earlier again (the asset added in between is only in the middle)
    const f3 = CMP.figuresN([earlier.metrics, later.metrics, earlier.metrics]);
    assert(f3[0].values.length === 3 && Math.abs(f3[0].change) < 1e-9, 'exposure change first → last is nil');
    const bd = CMP.breakdownN([earlier.rows, later.rows, earlier.rows], (r) => r.sector || '(blank)');
    close(U.sum(bd, (x) => x.values[1]), later.metrics.total_exposure_m, 1e-6, 'middle column totals the later period');
    close(U.sum(bd, (x) => x.shares[2]), 1, 1e-9, 'shares of the last add to 100%');
    const mv = CMP.assetsN([earlier.rows, later.rows, earlier.rows]), by = new Map(mv.map((a) => [a.code, a])), c = CMP.counts(mv);
    assert(by.get(gone).status === 'between' && !U.isNum(by.get(gone).values[0]) && U.isNum(by.get(gone).values[1]), 'held only in the middle period: between');
    assert(by.get(up).status === 'same' && by.get(up).values[1] > by.get(up).values[0], 'up in the middle, back again: unchanged first → last');
    assert(c.between === 1 && c.new === 0 && c.exited === 0, `counts ${JSON.stringify(c)}`);
    const m2 = CMP.assetsN([earlier.rows, later.rows]), a2 = new Map(CMP.assets(earlier.rows, later.rows).map((a) => [a.code, a]));
    assert(m2.every((a) => a2.get(a.code).status === a.status && Math.abs(a2.get(a.code).change - a.change) < 1e-9), 'two periods: the same movements as before');
  });

  T.add('Holdings folder: every file is a month, newest by the date in its name; only Holdings is taken; a new month is not a change, the loaded month changing is', async () => {
    const SRC = Scope.source, HS = SRC.holdings, store = Scope.store, keep = { sheets: store.state.sheets, sources: store.state.sources, version: store.state.version }, apply = SRC.onApply;
    const H = 'Identification ID,Name\n1,Alpha\n';
    // saved out of order: the names, not the save times, give the order
    const files = [pickedFile('Holdings/Oct 2026.csv', H + '2,Beta\n', 1767225600000), pickedFile('Holdings/Sep 2026.csv', H, 1767312000000), pickedFile('Holdings/2026-08 holdings.csv', H, 1767398400000)];
    let applied = null;
    try {
      HS.useFiles(files);
      const l = await HS.list(true);
      assert(l.configured && l.name === 'Holdings' && l.months.map((m) => m.label).join() === '2026-08 holdings,Sep 2026,Oct 2026', `months ${l.months.map((m) => m.label).join()}`);
      assert(HS.latest().id === 'h:Oct 2026.csv' && SRC.label('h:Oct 2026.csv') === 'Oct 2026' && SRC.find('h:Sep 2026.csv'), 'newest is October; months found and named by their file');
      const out = await SRC.read('h:Sep 2026.csv');
      assert(Object.keys(out.sheets).join() === 'Holdings' && out.sheets.Holdings.rows.length === 2 && out.period === 'h:Sep 2026.csv', 'September read as Holdings although its name does not say so');
      const src = out.sources.Holdings;
      assert(src.file === 'Sep 2026.csv' && src.period === 'h:Sep 2026.csv' && src.whole === false && src.files[0].folder === HS.FOLDER, `source ${JSON.stringify(src)}`);
      // the other inputs come from elsewhere (the file box): a comparison borrows them
      const map = { rows: [['Code', 'Name'], ['A', 'Alpha']] };
      store.state.sheets = Object.assign({}, keep.sheets, { Mapping: map }, out.sheets); store.state.sources = Object.assign({}, keep.sources, { Mapping: { file: 'Mapping.csv' } }, out.sources);
      const c = SRC.complete(await SRC.read('h:Oct 2026.csv'), store);
      assert(c.sheets.Holdings.rows.length === 3 && c.borrowed.includes('Mapping'), 'October with the loaded Mapping');
      assert((await SRC.check()) === null, 'unchanged');
      HS.useFiles(files.concat([pickedFile('Holdings/Nov 2026.csv', H)]));
      assert((await SRC.check()) === null, 'a new month is not a change to September');
      assert((await HS.list(true)).months.length === 4 && HS.latest().label === 'Nov 2026', 'November offered, and now the newest');
      const sep = files[1], b = new TextEncoder().encode(H + '3,Gamma\n'); sep.size = b.length; sep.lastModified = 1767484800000; sep.arrayBuffer = async () => b.buffer.slice(0);
      const n = await SRC.check();
      assert(n && n.id === 'h:Sep 2026.csv' && n.folder === HS.FOLDER && n.changed.join() === 'Sep 2026.csv' && n.sheets.join() === 'Holdings', `notice ${JSON.stringify(n)}`);
      assert(/Holdings folder Holdings/.test(SRC.folderLabel(n.folder)), 'the notice names the Holdings folder');
      SRC.onApply = (o) => { applied = o; };
      await SRC.refresh();
      assert(applied && applied.sheets.Holdings.rows.length === 3 && !applied.sheets.Mapping, 'Refresh reloads September\'s Holdings only');
      // a name written day first reads as a date still to come: flagged, listed last, never the newest
      HS.useFiles(files.concat([pickedFile('Holdings/Holdings 300926.csv', H)]));
      const odd = await HS.list(true);
      assert(odd.months[odd.months.length - 1].future && /still to come/.test(odd.warning) && HS.latest().label !== 'Holdings 300926', `future: ${odd.warning} / newest ${HS.latest().label}`);
      await HS.forget();
      assert(!(await HS.list(true)).configured && !SRC.find('h:Sep 2026.csv'), 'Forget empties it');
    } finally {
      SRC.onApply = apply; await HS.forget();
      store.state.sheets = keep.sheets; store.state.sources = keep.sources; store.state.version = keep.version + 2;
    }
  });

  T.add('period names: a date in digits only is read (YYMMDD for six digits, YYYYMMDD and DDMMYYYY for eight); numbers that are no date are not', () => {
    const PN = Scope.periodNames, k = (n) => PN.key([n]).join();
    for (const n of ['Holdings 260930', 'Holdings_260930', 'Holdings260930', 'Holdings 20260930', 'Holdings 30092026', 'Holdings Sep 2026']) assert(k(n) === '2026,3,9', `${n} → ${k(n)}`);
    assert(k('Holdings 263099') === '0,0,13' && k('Holdings 123456') === '0,0,13', 'not a date');
    const ms = ['Holdings 261031', 'Holdings 260930', 'Holdings 251231'].map((n) => ({ id: n, parts: [n] })).sort(PN.compare).map((p) => p.id);
    assert(ms.join() === 'Holdings 251231,Holdings 260930,Holdings 261031', `order ${ms.join()}`);
  });

  // ---------- tools/data-folder.js (Node only: the server side) ----------
  if (typeof require !== 'function' || typeof process === 'undefined') return;
  const fs = require('fs'), path = require('path'), os = require('os');
  const DF = require(path.join(__dirname, '..', 'tools', 'data-folder.js'));

  T.add('launcher: both shortcut scripts carry launcher/Scope.ico exactly, write it on the PC and never point the shortcut at the share\'s icon first', () => {
    const E = require(path.join(__dirname, '..', 'tools', 'embed-icon.js'));
    const e = E.embedded();
    assert(e.ps1 && e.ps1.equals(e.ico), 'create-shortcut.ps1 holds the icon');
    assert(e.vbs && e.vbs.equals(e.ico), 'create-shortcut.vbs holds the icon');
    assert(E.plan().every((x) => x.same), 'node tools/embed-icon.js has nothing to change');
    const ps = fs.readFileSync(path.join(__dirname, '..', 'launcher', 'create-shortcut.ps1'), 'utf8'), vb = fs.readFileSync(path.join(__dirname, '..', 'launcher', 'create-shortcut.vbs'), 'utf8');
    assert(/FromBase64String\(\$IconBase64\)/.test(ps) && /WriteBase64\(d & "\\Scope\.ico", IconBase64\(\)\)/.test(vb), 'both write the icon from their own copy');
    assert(/ie4uinit/.test(ps) && /ie4uinit/.test(vb), 'both refresh the icon cache');
    assert(!/\r?\n/.test(ps.replace(/\r\n/g, '')) && !/\r?\n/.test(vb.replace(/\r\n/g, '')), 'Windows line endings kept');
  });

  T.add('data folder: periods are found up to three levels down, in date order, lock files skipped', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-periods-'));
    try {
      const put = (rel) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), 'x'); };
      ['Q2 2026/May/AUM.xlsx', 'Q2 2026/April/AUM.xlsx', 'Q1 2026/AUM.xlsx', 'Q2 2026/~$AUM.xlsx', 'Q2 2026/notes.docx', 'Q4 2025/Holdings.csv', '.hidden/AUM.xlsx', 'a/b/c/d/AUM.xlsx'].forEach(put);
      const ids = DF.listPeriods(dir).map((p) => p.id);
      assert(ids.join('|') === 'Q4 2025|Q1 2026|Q2 2026/April|Q2 2026/May', `periods ${ids.join('|')}`);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  T.add('data folder: only files of the folder are served, and Windows paths are read as written', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-periods-'));
    try {
      assert(DF.resolveFile(dir, 'Q2 2026/May', 'AUM.xlsx') === path.join(dir, 'Q2 2026', 'May', 'AUM.xlsx'), 'a period file');
      for (const [id, name] of [['../x', 'AUM.xlsx'], ['Q2', '../AUM.xlsx'], ['Q2', 'AUM.exe'], ['Q2', '~$AUM.xlsx'], ['.git', 'AUM.xlsx'], ['Q2', 'a\\b.xlsx']]) assert(DF.resolveFile(dir, id, name) === null, `refused ${id} ${name}`);
      fs.writeFileSync(path.join(dir, 'scope.config.json'), '{ "dataFolder": "C:\\new\\AUM\\\\Quarterly data" }');
      const before = process.env.SCOPE_DATA_FOLDER; delete process.env.SCOPE_DATA_FOLDER;
      try { assert(DF.readConfig(dir).folder.endsWith('C:\\new\\AUM\\Quarterly data'), `config ${DF.readConfig(dir).folder}`); } finally { if (before !== undefined) process.env.SCOPE_DATA_FOLDER = before; }
      const k = (s) => DF.periodKey(s.split('/')).join('-');
      assert(k('FY26/Mar-26') === '2026-1-3' && k('2026-05') === '2026-2-5' && k('Q3 2026') === '2026-3-13' && k('3Q26') === '2026-3-13', 'period keys');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
})(typeof window !== 'undefined' ? window : globalThis);
