/* Scope fund look-through tests — run in the browser (tests/index.html) or Node (node tests/run-node.js). Loads after engine.tests.js. */
(function (global) {
  'use strict';
  const Scope = global.Scope, AUM = Scope.engine.aum, LT = Scope.engine.lookthrough;
  const T = (Scope.tests = Scope.tests || { cases: [], files: null });
  T.add = T.add || ((name, fn) => T.cases.push({ name, fn }));
  const add = T.add;
  const assert = (c, msg) => { if (!c) throw new Error(msg || 'assertion failed'); };
  const close = (a, b, eps, msg) => { if (!(Math.abs(a - b) <= (eps === undefined ? 1e-6 : eps))) throw new Error(`${msg || ''} expected ${b}, got ${a}`); };
  T.tablesFrom = T.tablesFrom || function (files) { const tables = {}, tableInfo = {}; for (const [n, t] of Object.entries(files)) { const p = Scope.csv.parse(t); tables[n] = p.records.filter(Boolean); tableInfo[n] = { parsed: p }; } return { tables, tableInfo }; };
  const MEASURES = ['nominal', 'drawn', 'commitment'];
  const HEAD = 'fund_label,holder_label,share,note\n';
  let cached = null;
  /** Demo engine result (TOTAL, EUR) plus the demo look-through rows. */
  const demo = () => { if (!cached) { const t = T.tablesFrom(T.files); cached = { res: AUM.compute(Object.assign({ adjustments: [], platform: 'TOTAL', currency: 'EUR' }, t)), rows: t.tables['fund_lookthrough.csv'] || [] }; } return cached; };
  /** Parse a look-through CSV text into records, as the store would. */
  const rowsOf = (text) => Scope.csv.parse(text).records.filter(Boolean);
  const nom = (a, label) => ((a.byInvestor.get(label) || { nominal: 0 }).nominal);

  add('lookthrough: demo table is loaded and both funds are read', () => {
    const { res, rows } = demo();
    assert(rows.length === 7, `demo rows ${rows.length}`);
    const lt = LT.compute(res, rows);
    assert(lt.available && lt.funds.length === 2, 'two funds');
    assert(!lt.issues.some((i) => i.severity === 'error' || i.severity === 'warn'), 'no warnings on the demo: ' + lt.issues.map((i) => i.message).join('; '));
    const f7 = lt.fundByLabel.get('Investor 7');
    close(f7.listedShare, 0.6, 1e-12, 'Investor 7 listed'); close(f7.externalShare, 0.4, 1e-12, 'Investor 7 external');
    assert(LT.compute(res, rows) === lt, 'memoised on result and table content');
  });

  add('lookthrough: Σ ultimate holders (incl. external) = Σ direct columns for every asset and measure', () => {
    const { res, rows } = demo();
    const lt = LT.compute(res, rows);
    for (const a of res.assets) {
      const ult = lt.byAsset.get(a.code) || [];
      assert(!ult.some((r) => r.holder === 'Investor 7' || r.holder === 'Investor 8'), `${a.code}: pass-through funds are replaced by their holders`);
      for (const m of MEASURES) {
        const direct = Array.from(a.byInvestor.values()).reduce((s, c) => s + c[m], 0);
        close(ult.reduce((s, r) => s + r.total[m], 0), direct, 1e-4, `${a.code} ${m}`);
        close(direct, a[m], 1e-4, `${a.code} ${m} = asset total`);
      }
    }
    assert(lt.reconciles, 'overall reconciliation flag');
    for (const m of MEASURES) close(lt.totals.ultimate[m], lt.totals.direct[m], 1e-3, 'totals ' + m);
    const rec = LT.reconcile(lt, null, 'nominal');
    assert(rec.ok, 'reconcile helper'); close(rec.holders + rec.external, rec.direct, 1e-3, 'holders + external = direct');
    close(rec.direct / 1e6, res.metrics.book_total_m, 1e-6, 'direct book = engine book total');
  });

  add('lookthrough: Investor 1 indirect in an asset = 0.15 × Investor 7 direct in that asset', () => {
    const { res, rows } = demo();
    const lt = LT.compute(res, rows), i1 = lt.byInvestor.get('Investor 1');
    let seen = 0;
    for (const a of res.assets) {
      const pa = i1.perAsset.get(a.code), d7 = nom(a, 'Investor 7');
      close(pa ? pa.indirect.nominal : 0, 0.15 * d7, 1e-6, a.code);
      close(pa ? pa.direct.nominal : 0, nom(a, 'Investor 1'), 1e-6, a.code + ' direct');
      if (d7) { seen++; assert(pa.via.length === 1 && pa.via[0].fund === 'Investor 7' && pa.via[0].share === 0.15, a.code + ' via'); }
    }
    assert(seen > 0, 'Investor 7 has direct exposure somewhere in the demo');
    close(i1.direct.nominal / 1e6, res.investors.find((x) => x.label === 'Investor 1').nominal_m, 1e-6, 'direct = engine investor nominal');
    // a third party gets its share too, and an investor without fund units has no look-through
    const d7all = res.assets.reduce((s, a) => s + nom(a, 'Investor 7'), 0);
    close(lt.byInvestor.get('Investor 9').indirect.nominal, 0.25 * d7all, 1e-4, 'Investor 9 = 25% of Investor 7');
    close(lt.byInvestor.get('Investor 4').indirect.nominal, 0, 1e-9, 'Investor 4 holds no units');
  });

  add('lookthrough: group-weight consistency passes on the demo and fails on a perturbed table', () => {
    const { res, rows } = demo();
    const ok = LT.compute(res, rows);
    assert(ok.funds.every((f) => f.consistent), 'demo funds consistent');
    close(ok.fundByLabel.get('Investor 7').groupShareFromHolders, 0.35, 1e-12, 'Investor 7 group share'); close(ok.fundByLabel.get('Investor 8').groupShareFromHolders, 0.2, 1e-12, 'Investor 8 group share');
    const bad = LT.compute(res, rowsOf(HEAD + 'Investor 7,Investor 1,0.25,\nInvestor 7,Investor 3,0.1,\nInvestor 7,Investor 5,0.1,\nInvestor 7,Investor 9,0.25,\nInvestor 8,Investor 2,0.12,\nInvestor 8,Investor 6,0.08,\nInvestor 8,Investor 10,0.3,\n'));
    const f7 = bad.fundByLabel.get('Investor 7');
    assert(!f7.consistent && bad.fundByLabel.get('Investor 8').consistent, 'only Investor 7 inconsistent');
    close(f7.groupShareFromHolders, 0.45, 1e-12, 'perturbed group share');
    assert(bad.issues.some((i) => i.severity === 'warn' && /Investor 7/.test(i.message) && /group_weight/.test(i.message)), 'warning raised');
    assert(bad.reconciles, 'still reconciles (shares within 0–1)');
  });

  add('lookthrough: share outside 0–1 and listed shares above 100% are errors, used as entered', () => {
    const { res } = demo();
    const lt = LT.compute(res, rowsOf(HEAD + 'Investor 8,Investor 2,1.2,\nInvestor 8,Investor 10,0.3,\n'));
    assert(lt.issues.some((i) => i.severity === 'error' && /outside 0–1/.test(i.message)), 'share > 1 error');
    assert(lt.issues.some((i) => i.severity === 'error' && /more than 100%/.test(i.message)), 'listed > 100% error');
    const f8 = lt.fundByLabel.get('Investor 8');
    close(f8.listedShare, 1.5, 1e-12, 'not clamped'); close(f8.externalShare, -0.5, 1e-12, 'negative residual shown');
    assert(lt.reconciles, 'arithmetic still reconciles with a negative residual');
    const pct = LT.compute(res, rowsOf(HEAD + 'Investor 8,Investor 2,12%,\n'));
    close(pct.fundByLabel.get('Investor 8').listedShare, 0.12, 1e-12, '"12%" read as 0.12');
    const junk = LT.compute(res, rowsOf(HEAD + 'Investor 8,Investor 2,abc,\n'));
    assert(!junk.available && junk.issues.some((i) => i.severity === 'warn' && /not numeric/.test(i.message)), 'non-numeric share ignored with a warning');
  });

  add('lookthrough: missing table → available:false, no throw, direct only', () => {
    const { res } = demo();
    for (const input of [undefined, null, [], [null]]) {
      const lt = LT.compute(res, input);
      assert(lt.available === false && lt.funds.length === 0, 'unavailable');
      assert(lt.issues.some((i) => i.severity === 'info'), 'info notice');
      for (const inv of res.investors) {
        const x = lt.byInvestor.get(inv.label);
        close(x.indirect.nominal, 0, 1e-9, inv.label + ' indirect'); close(x.total.nominal / 1e6, inv.nominal_m, 1e-6, inv.label + ' total = direct');
      }
      assert(Array.from(lt.byAsset.values()).some((list) => list.some((r) => r.holder === 'Investor 7')), 'funds stay holders in their own right');
      assert(lt.reconciles, 'reconciles');
    }
    const s = LT.summariseInvestor(res, LT.compute(res, []), 'Investor 7', 'total');
    close(s.metrics.total_exposure_m, res.investors.find((x) => x.label === 'Investor 7').nominal_m, 1e-6, 'summary works without the table');
    assert(LT.compute({}, undefined).available === false, 'empty result does not throw');
  });

  add('lookthrough: fund holding a fund propagates and still reconciles', () => {
    const { res, rows } = demo();
    const extra = rows.map((r) => `${r.fund_label},${r.holder_label},${r.share},`).join('\n');
    const lt = LT.compute(res, rowsOf(HEAD + extra + '\nInvestor 8,Investor 7,0.1,fund in fund\n'));
    assert(!lt.cycles.length && lt.maxDepth === 1 && !lt.truncated, 'one level, no cycle');
    for (const a of res.assets) {
      const pa = lt.byInvestor.get('Investor 1').perAsset.get(a.code);
      close(pa ? pa.indirect.nominal : 0, 0.15 * (nom(a, 'Investor 7') + 0.1 * nom(a, 'Investor 8')), 1e-6, a.code);
    }
    assert(lt.reconciles, 'reconciles through the chain');
    assert(lt.issues.some((i) => /Investor 8/.test(i.message) && /group_weight/.test(i.message)), 'Investor 8 group share now includes its fund holder (0.2 + 0.1 × 0.35)');
  });

  add('lookthrough: a cycle between funds is reported and the computation terminates', () => {
    const { res } = demo();
    const lt = LT.compute(res, rowsOf(HEAD + 'Investor 7,Investor 8,0.1,\nInvestor 8,Investor 7,0.1,\nInvestor 7,Investor 1,0.15,\n'));
    assert(lt.cycles.length === 1 && lt.cycles[0].join('|') === 'Investor 7|Investor 8', 'cycle found: ' + JSON.stringify(lt.cycles));
    assert(lt.issues.some((i) => i.severity === 'error' && /Cycle/.test(i.message)), 'error issue');
    assert(lt.truncated && lt.maxDepth === LT.MAX_DEPTH, 'truncated at the depth cap');
    const self = LT.compute(res, rowsOf(HEAD + 'Investor 7,Investor 7,0.5,\n'));
    assert(self.cycles.length === 1 && self.issues.some((i) => /Cycle/.test(i.message)), 'self-holding is a cycle');
  });

  add('lookthrough: investor summary modes tie to the engine; platform shares add up to the platform', () => {
    const { res, rows } = demo();
    const lt = LT.compute(res, rows);
    const inv = lt.byInvestor.get('Investor 1');
    const d = LT.summariseInvestor(res, lt, 'Investor 1', 'direct'), i = LT.summariseInvestor(res, lt, 'Investor 1', 'lookthrough'), t = LT.summariseInvestor(res, lt, 'Investor 1', 'total');
    close(d.metrics.total_exposure_m, inv.direct.nominal / 1e6, 1e-6, 'direct'); close(i.metrics.total_exposure_m, inv.indirect.nominal / 1e6, 1e-6, 'look-through'); close(t.metrics.total_exposure_m, inv.total.nominal / 1e6, 1e-6, 'total');
    close(t.metrics.total_drawn_m, inv.total.drawn / 1e6, 1e-6, 'total drawn');
    assert(t.rows.length === inv.assetCount.total && d.rows.length === inv.assetCount.direct && i.rows.length === inv.assetCount.indirect, 'asset counts');
    assert(t.rows.every((r) => Math.abs(r.direct_m + r.indirect_m - r.total_m) < 1e-9), 'direct + look-through = total per row');
    assert(typeof t.metrics.w_rating_label === 'string' && t.distributions.sector.length > 0, 'weighted rating and breakdowns');
    close(t.distributions.sector.reduce((s, x) => s + x.exposure_m, 0), t.metrics.total_exposure_m, 1e-6, 'sector breakdown reconciles');
    assert(LT.summariseInvestor(res, lt, 'Investor 4', 'lookthrough').rows.length === 0, 'no units, no look-through rows');
    // GROUP platform: Σ weight × direct column over investors = platform total
    const g = AUM.compute(Object.assign({ adjustments: [], platform: 'GROUP', currency: 'EUR' }, T.tablesFrom(T.files)));
    const shares = g.investorColumns.map((l) => LT.platformShare(g, l, 'nominal'));
    close(shares.reduce((s, x) => s + x.contribution, 0), shares[0].platformTotal, 1e-3, 'contributions add up');
    close(LT.platformShare(g, 'Investor 7').weight, 0.35, 1e-12, 'fund weight in GROUP');
    assert(LT.platformsOf(g, 'Investor 7').some((p) => p.id === 'BETA' && p.weight === 1), 'platform membership');
  });

  add('lookthrough: global filter subset (positions kept by holdings line) still reconciles', () => {
    const { rows } = demo();
    const t = T.tablesFrom(T.files);
    const full = AUM.compute(Object.assign({ adjustments: [], platform: 'TOTAL', currency: 'EUR' }, t));
    const keepCodes = new Set(full.rows.slice(0, 15).map((r) => r.code));
    const lines = new Set(full.positions.filter((p) => !p.excluded && keepCodes.has(p.asset_code)).map((p) => p.line));
    const res = AUM.compute(Object.assign({ adjustments: [], platform: 'TOTAL', currency: 'EUR', includeLines: lines }, t));
    const lt = LT.compute(res, rows);
    assert(lt.reconciles, 'filtered reconciles');
    for (const [code] of lt.byInvestor.get('Investor 1').perAsset) assert(keepCodes.has(code), 'only filtered assets carry exposure');
    close(lt.totals.direct.nominal / 1e6, res.metrics.book_total_m, 1e-6, 'filtered direct = filtered book');
  });
})(typeof window !== 'undefined' ? window : globalThis);
