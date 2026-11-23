/* Scope tests · Check my data (js/analysis/tieout.js): the tie-out against a workbook's own Output and Calculations sheets,
 * and the checks that hold for any workbook. The workbook's sheets are built here from the demo's own result in the
 * workbook's layout (Output: view in G8, currency in G6, header row 10; Calculations: labels in row 3, data from row 5), so a
 * clean copy must agree everywhere and every planted difference must be found. Runs in the browser and in Node. */
(function (global) {
  'use strict';
  const Scope = global.Scope, AUM = Scope.calc.aum, TO = Scope.tieout, L = Scope.workbookLayout;
  const T = (Scope.tests = Scope.tests || { cases: [], files: null });
  T.add = T.add || ((name, fn) => T.cases.push({ name, fn }));
  const assert = (c, msg) => { if (!c) throw new Error(msg || 'assertion failed'); };
  const put = (g, r, c, v) => { while (g.length <= r) g.push([]); g[r][c] = v; };
  const serial = (v) => (v instanceof Date ? Math.round(v / 86400000) + 25569 : v);

  /** The demo's result and a workbook Output / Calculations built from it in the workbook's layout. */
  function book() {
    const res = AUM.run({ sheets: (global.SCOPE_DEMO || {}).sheets, adjustments: [], platform: 'Group', currency: 'EUR' });
    const out = []; put(out, 5, 6, 'EUR'); put(out, 7, 6, 'Group');
    const oc = L.outputColumns(res).slice(1); // the workbook has no "Code name" column of Scope's: it starts with Project name
    oc.forEach((c, i) => put(out, 9, i + 1, c.label));
    res.rows.forEach((r, k) => oc.forEach((c, i) => { let v = serial(c.get(r)); if (c.type === 'text' && (v === '' || v === null || v === undefined)) v = 0; put(out, 10 + k, i + 1, v); })); // Excel shows an empty looked-up cell as 0
    const calc = [];
    const pc = L.positionColumns(res).filter((c) => /^[A-Z]{1,3}$/.test(c.letters));
    pc.forEach((c) => put(calc, 2, L.colIndex(c.letters), c.label));
    res.positions.forEach((p, k) => pc.forEach((c) => { let v; try { v = c.get(p); } catch (e) { v = ''; } put(calc, 4 + k, L.colIndex(c.letters), serial(v)); }));
    const ac = L.assetColumns(res), next = {};
    const at = ac.map((c) => { if (/^[A-Z]{1,3}$/.test(c.letters)) return L.colIndex(c.letters); const a = c.letters.split('…')[0]; next[a] = next[a] || 0; return L.colIndex(a) + next[a]++; });
    ac.forEach((c, i) => { if (c.label && !/^=/.test(c.label)) put(calc, 2, at[i], c.label); });
    res.assets.filter((a) => a.inActiveList).forEach((a, k) => ac.forEach((c, i) => { let v; try { v = c.get(a); } catch (e) { v = ''; } put(calc, 4 + k, at[i], v); }));
    return { res, out, calc };
  }
  const failing = (checks) => checks.filter((c) => c.status === 'fail' || c.status === 'warn');

  T.add('check my data: the view and currency are read from Output!G8 and G6', () => {
    const { res, out } = book();
    const ctx = TO.context({ rows: out }, res);
    assert(ctx.platformId === 'Group' && ctx.viewCell === 'G8' && ctx.currency === 'EUR', JSON.stringify(ctx));
    out[7][6] = 'Not a view'; out[2] = []; out[2][3] = 'Region A'; // G8 unknown: the first cell of rows 1 to 12 naming a view
    const c2 = TO.context({ rows: out }, res);
    assert(c2.platformId === 'Region A' && c2.viewCell === 'D3', JSON.stringify(c2));
    out[5][6] = '£'; assert(TO.context({ rows: out }, res).currency === 'GBP', 'a currency symbol is read as its code');
  });

  T.add('check my data: a clean copy of the workbook ties out everywhere', () => {
    const { res, out, calc } = book();
    const checks = TO.compare(res, { Output: { rows: out }, Calculations: { rows: calc } });
    const bad = failing(checks).concat(checks.filter((c) => c.status === 'skip'));
    assert(!bad.length, bad.map((c) => `${c.title}: ${c.detail} ${JSON.stringify(c.examples[0] || '')}`).join('; '));
    const exp = checks.find((c) => /^Selection exposure \(/.test(c.title));
    assert(exp && exp.compared === res.rows.length && exp.material, 'the Output exposure column is compared for every asset');
    assert(checks.some((c) => c.id === 'calc-CP' && c.compared === res.positions.length), 'Calculations CP is compared for every position');
    assert(checks.some((c) => /Investor 1$/.test(c.title) && c.area === 'Calculations: per-asset split'), 'the per-asset investor split is compared');
  });

  T.add('check my data: planted differences are each found, with the amount', () => {
    const { res, out, calc } = book();
    const hdr = out[9];
    out[12][hdr.indexOf('Selection exposure')] += 0.5;                       // one asset's exposure 0.5m off
    calc[7][L.colIndex('CP')] *= 1.01;                                      // one position's converted nominal 1% off
    calc[5][L.colIndex('DM')] = (calc[5][L.colIndex('DM')] || 0) + 1000;    // one investor split 1,000 off
    const extra = []; extra[hdr.indexOf('Project name')] = 'Zeta Phantom'; out.push(extra); // an asset only the workbook lists
    out[14][hdr.indexOf('Sector')] = 'Something else';                       // a descriptive column
    const checks = TO.compare(res, { Output: { rows: out }, Calculations: { rows: calc } });
    const by = (re) => checks.find((c) => re.test(c.title));
    const exp = by(/^Selection exposure \(/);
    assert(exp.status === 'fail' && exp.differences === 1 && Math.abs(exp.examples[0].diff + 0.5) < 1e-9, 'exposure: ' + JSON.stringify(exp.examples[0]));
    const cp = checks.find((c) => c.id === 'calc-CP');
    assert(cp.status === 'fail' && cp.differences === 1, 'CP: ' + cp.detail);
    const dm = checks.find((c) => c.area === 'Calculations: per-asset split' && /Investor 1$/.test(c.title));
    assert(dm.status === 'fail' && dm.examples[0].diff === -1000, 'DM: ' + JSON.stringify(dm.examples[0]));
    const rows = checks.find((c) => c.id === 'output-rows');
    assert(rows.status === 'fail' && rows.examples.some((x) => x.item === 'Zeta Phantom'), 'an asset only the workbook lists');
    const sec = by(/^Sector \(/);
    assert(sec.status === 'warn' && !sec.material, 'a descriptive column differs as "to look at", not as a failed amount');
    assert(failing(checks).length === 5, failing(checks).map((c) => c.title).join(', '));
  });

  T.add('check my data: a moved Calculations column is not compared, and is listed', () => {
    const { res, out, calc } = book();
    calc[2][L.colIndex('CO')] = 'Something moved here';
    const checks = TO.compare(res, { Output: { rows: out }, Calculations: { rows: calc } });
    assert(!checks.some((c) => c.id === 'calc-CO'), 'CO is not compared under the wrong label');
    const lab = checks.find((c) => c.id === 'calc-labels');
    assert(lab && lab.examples.some((x) => /^CO /.test(x.where)), 'the moved column is listed');
  });

  T.add('check my data: without the Output and Calculations tabs part 1 is not run', () => {
    const { res } = book();
    const checks = TO.compare(res, {});
    assert(checks.length === 2 && checks.every((c) => c.status === 'skip'), JSON.stringify(checks.map((c) => c.status)));
  });

  T.add('check my data: Scope\'s figures add up on the demo, and a broken total is caught', () => {
    const res = AUM.run({ sheets: (global.SCOPE_DEMO || {}).sheets, adjustments: [], platform: 'Group' });
    const internal = TO.internal(res, Scope.engine.lookthrough);
    assert(!failing(internal).length, failing(internal).map((c) => c.title + ': ' + c.detail).join('; '));
    assert(internal.some((c) => c.id === 'lookthrough' && c.status === 'pass'), 'look-through reconciles');
    res.assets[0].group_nominal += 5; res.rows[0].exposure_m += 1; // break two figures
    const again = TO.internal(res, Scope.engine.lookthrough);
    assert(again.find((c) => c.id === 'group-share').status === 'fail', 'a group share that is not Σ column × ownership is caught');
    assert(again.find((c) => c.id === 'output-rows-internal').status === 'fail', 'an Output row that is not the asset\'s amount in the view is caught');
  });

  T.add('tie-out fixes: a workbook-column check counts its mismatches as differences; the position sum check skips filtered-out positions; the Output shows NR for an unrated asset', () => {
    const res = T.demo({ platform: 'Group', adjustments: [] }), ck = res.inputs.checks.find((c) => c.total > 0); // a result of its own: its check is changed below
    ck.matched = ck.total - 1; ck.status = 'warn';
    const wb = TO.internal(res, Scope.engine.lookthrough).find((c) => c.id === 'wb-' + ck.id);
    assert(wb && wb.differences === 1, 'one difference: ' + JSON.stringify(wb && { d: wb.differences, s: wb.status }));
    const some = new Set(res.positions.filter((p) => !p.excluded).slice(0, 60).map((p) => p.line));
    const c2 = TO.internal(T.demo({ platform: 'Group', includeLines: some }), Scope.engine.lookthrough).find((c) => c.id === 'positions-to-assets');
    assert(c2 && c2.status === 'pass', 'a filtered result still adds up: ' + (c2 && c2.status + ' ' + c2.detail));
    const inv = L.outputColumns(res).find((c) => /INVGRD/.test(c.label));
    assert(inv && inv.get({ ig_label: 'IG', rating_status: 'NR' }) === 'NR' && inv.get({ ig_label: 'IG', rating_status: 'rated' }) === 'IG', 'INVGRD: NR for an unrated asset');
  });

})(typeof window !== 'undefined' ? window : globalThis);
