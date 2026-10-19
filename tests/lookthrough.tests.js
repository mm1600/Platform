/* Scope fund look-through tests — run in the browser (tests/index.html) or Node (node tests/run-node.js). Loads after engine.tests.js. */
(function (global) {
  'use strict';
  const Scope = global.Scope, AUM = Scope.calc.aum, LT = Scope.engine.lookthrough;
  const T = (Scope.tests = Scope.tests || { cases: [], files: null });
  T.add = T.add || ((name, fn) => T.cases.push({ name, fn }));
  const add = T.add;
  const assert = (c, msg) => { if (!c) throw new Error(msg || 'assertion failed'); };
  const close = (a, b, eps, msg) => { if (!(Math.abs(a - b) <= (eps === undefined ? 1e-6 : eps))) throw new Error(`${msg || ''} expected ${b}, got ${a}`); };
  const MEASURES = ['nominal', 'drawn', 'commitment'];
  const HEAD = 'fund_label,holder_label,share,note\n';
  let cached = null;
  /** Demo result (Total platform, EUR) and its fund unit register (derived by js/calc/aum.js from the "incl. part in funds" views). */
  const demo = () => { if (!cached) { const res = T.demo(); cached = { res, rows: res.fundRegister }; } return cached; };
  /** Parse a look-through CSV text into records, as the store would. */
  const rowsOf = (text) => Scope.csv.parse(text).records.filter(Boolean);
  const nom = (a, label) => ((a.byInvestor.get(label) || { nominal: 0 }).nominal);

  add('lookthrough: the demo register is read: five funds, Region A (a view) as a holder', () => {
    const { res, rows } = demo();
    assert(rows.length === 8, `demo rows ${rows.length}`);
    const lt = LT.compute(res, rows);
    assert(lt.available && lt.funds.length === 5, 'five funds with holders: ' + lt.funds.map((f) => f.fund_label).join(', '));
    assert(!lt.issues.some((i) => i.severity === 'error' || i.severity === 'warn'), 'no warnings on the demo: ' + lt.issues.map((i) => i.message).join('; '));
    const f1 = lt.fundByLabel.get('Fund 1');
    close(f1.listedShare, 0.35, 1e-12, 'Fund 1 listed'); close(f1.externalShare, 0.65, 1e-12, 'Fund 1 external');
    const ra = lt.byInvestor.get('Region A');
    assert(ra && ra.group === 'View' && ra.group_weight === 1 && !ra.isInvestorColumn, 'a composite view is a holder with its entities\' weight');
    assert(LT.compute(res, rows) === lt, 'memoised on result and table content');
  });

  add('lookthrough: Σ ultimate holders (incl. external) = Σ direct columns for every asset and measure', () => {
    const { res, rows } = demo();
    const lt = LT.compute(res, rows);
    const funds = new Set(lt.funds.map((f) => f.fund_label));
    for (const a of res.assets) {
      const ult = lt.byAsset.get(a.code) || [];
      assert(!ult.some((r) => funds.has(r.holder)), `${a.code}: pass-through funds are replaced by their holders`);
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

  add('lookthrough: Investor 1 indirect in an asset = 0.25 × Fund 1 + 0.15 × Fund 2 + Fund 6 direct in that asset', () => {
    const { res, rows } = demo();
    const lt = LT.compute(res, rows), i1 = lt.byInvestor.get('Investor 1');
    let seen = 0;
    for (const a of res.assets) {
      const pa = i1.perAsset.get(a.code), d1 = nom(a, 'Fund 1'), d2 = nom(a, 'Fund 2'), d6 = nom(a, 'Fund 6');
      close(pa ? pa.indirect.nominal : 0, 0.25 * d1 + 0.15 * d2 + d6, 1e-6, a.code);
      close(pa ? pa.direct.nominal : 0, nom(a, 'Investor 1'), 1e-6, a.code + ' direct');
      if (d1) { seen++; const v = pa.via.find((x) => x.fund === 'Fund 1'); assert(v && v.share === 0.25, a.code + ' via Fund 1'); }
    }
    assert(seen > 0, 'Fund 1 has direct exposure somewhere in the demo');
    close(i1.direct.nominal / 1e6, res.investors.find((x) => x.label === 'Investor 1').nominal_m, 1e-6, 'direct = engine investor nominal');
    // a view gets its share too, and an investor without fund units has no look-through
    const d3all = res.assets.reduce((s, a) => s + nom(a, 'Fund 3'), 0), d1all = res.assets.reduce((s, a) => s + nom(a, 'Fund 1'), 0), d2all = res.assets.reduce((s, a) => s + nom(a, 'Fund 2'), 0);
    close(lt.byInvestor.get('Region A').indirect.nominal, 0.1 * d1all + 0.05 * d2all + d3all, 1e-4, 'Region A = 10% of Fund 1 + 5% of Fund 2 + all of Fund 3');
    close(lt.byInvestor.get('Investor 3').indirect.nominal, 0, 1e-9, 'Investor 3 holds no units');
  });

  add('lookthrough: group-weight consistency passes on the demo and fails when listed group shares exceed the weight', () => {
    const { res, rows } = demo();
    const ok = LT.compute(res, rows);
    assert(ok.funds.every((f) => f.consistent), 'demo funds consistent');
    close(ok.fundByLabel.get('Fund 1').groupShareFromHolders, 0.35, 1e-12, 'Fund 1 group share'); close(ok.fundByLabel.get('Fund 2').groupShareFromHolders, 0.3, 1e-12, 'Fund 2 group share');
    assert(ok.issues.some((i) => i.severity === 'info' && /Fund 1/.test(i.message) && /not assigned/.test(i.message)), 'unassigned group share is an info, not a warning');
    const bad = LT.compute(res, rowsOf(HEAD + 'Fund 1,Investor 1,0.4,\nFund 1,Investor 3,0.1,\nFund 2,Investor 2,0.1,\n'));
    const f1 = bad.fundByLabel.get('Fund 1');
    assert(!f1.consistent && bad.fundByLabel.get('Fund 2').consistent, 'only Fund 1 inconsistent');
    close(f1.groupShareFromHolders, 0.5, 1e-12, 'perturbed group share');
    assert(bad.issues.some((i) => i.severity === 'warn' && /Fund 1/.test(i.message) && /attribution weight/.test(i.message)), 'warning raised');
    assert(bad.reconciles, 'still reconciles (shares within 0–1)');
  });

  add('lookthrough: share outside 0–1 and listed shares above 100% are errors, used as entered', () => {
    const { res } = demo();
    const lt = LT.compute(res, rowsOf(HEAD + 'Fund 2,Investor 2,1.2,\nFund 2,Investor 10,0.3,\n'));
    assert(lt.issues.some((i) => i.severity === 'error' && /outside 0–1/.test(i.message)), 'share > 1 error');
    assert(lt.issues.some((i) => i.severity === 'error' && /more than 100%/.test(i.message)), 'listed > 100% error');
    const f2 = lt.fundByLabel.get('Fund 2');
    close(f2.listedShare, 1.5, 1e-12, 'not clamped'); close(f2.externalShare, -0.5, 1e-12, 'negative residual shown');
    assert(lt.reconciles, 'arithmetic still reconciles with a negative residual');
    const pct = LT.compute(res, rowsOf(HEAD + 'Fund 2,Investor 2,12%,\n'));
    close(pct.fundByLabel.get('Fund 2').listedShare, 0.12, 1e-12, '"12%" read as 0.12');
    const junk = LT.compute(res, rowsOf(HEAD + 'Fund 2,Investor 2,abc,\n'));
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
      assert(Array.from(lt.byAsset.values()).some((list) => list.some((r) => r.holder === 'Fund 1')), 'funds stay holders in their own right');
      assert(lt.reconciles, 'reconciles');
    }
    const s = LT.summariseInvestor(res, LT.compute(res, []), 'Fund 1', 'total');
    close(s.metrics.total_exposure_m, res.investors.find((x) => x.label === 'Fund 1').nominal_m, 1e-6, 'summary works without the table');
    assert(LT.compute({}, undefined).available === false, 'empty result does not throw');
  });

  add('lookthrough: fund holding a fund propagates and still reconciles', () => {
    const { res, rows } = demo();
    const extra = rows.map((r) => `${r.fund_label},${r.holder_label},${r.share},`).join('\n');
    const lt = LT.compute(res, rowsOf(HEAD + extra + '\nFund 2,Fund 1,0.1,fund in fund\n'));
    assert(!lt.cycles.length && lt.maxDepth === 1 && !lt.truncated, 'one level, no cycle');
    for (const a of res.assets) {
      const pa = lt.byInvestor.get('Investor 1').perAsset.get(a.code);
      close(pa ? pa.indirect.nominal : 0, 0.25 * (nom(a, 'Fund 1') + 0.1 * nom(a, 'Fund 2')) + 0.15 * nom(a, 'Fund 2') + nom(a, 'Fund 6'), 1e-6, a.code);
    }
    assert(lt.reconciles, 'reconciles through the chain');
    close(lt.fundByLabel.get('Fund 2').groupShareFromHolders, 0.15 + 0.1 + 0.1 * 0.45, 1e-12, 'Fund 2 group share now includes its fund holder (Fund 1 weighs 0.45)');
  });

  add('lookthrough: a cycle between funds is reported and the computation terminates', () => {
    const { res } = demo();
    const lt = LT.compute(res, rowsOf(HEAD + 'Fund 1,Fund 2,0.1,\nFund 2,Fund 1,0.1,\nFund 1,Investor 1,0.15,\n'));
    assert(lt.cycles.length === 1 && lt.cycles[0].join('|') === 'Fund 1|Fund 2', 'cycle found: ' + JSON.stringify(lt.cycles));
    assert(lt.issues.some((i) => i.severity === 'error' && /Cycle/.test(i.message)), 'error issue');
    assert(lt.truncated && lt.maxDepth === LT.MAX_DEPTH, 'truncated at the depth cap');
    const self = LT.compute(res, rowsOf(HEAD + 'Fund 1,Fund 1,0.5,\n'));
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
    assert(LT.summariseInvestor(res, lt, 'Investor 3', 'lookthrough').rows.length === 0, 'no units, no look-through rows');
    // the attribution view: Σ weight × direct column over investors = platform total
    const g = T.demo({ platform: 'Group' });
    const shares = g.investorColumns.map((l) => LT.platformShare(g, l, 'nominal'));
    close(shares.reduce((s, x) => s + x.contribution, 0), shares[0].platformTotal, 1e-3, 'contributions add up');
    close(LT.platformShare(g, 'Fund 1').weight, 0.45, 1e-12, 'fund weight in the Group view');
    assert(LT.platformsOf(g, 'Investor 4').some((p) => p.id === 'Region A' && p.weight === 1), 'platform membership');
  });

  add('lookthrough: global filter subset (positions kept by holdings line) still reconciles', () => {
    const { rows } = demo();
    const full = T.demo();
    const keepCodes = new Set(full.rows.slice(0, 15).map((r) => r.code));
    const lines = new Set(full.positions.filter((p) => !p.excluded && keepCodes.has(p.asset_code)).map((p) => p.line));
    const res = T.demo({ includeLines: lines });
    const lt = LT.compute(res, rows);
    assert(lt.reconciles, 'filtered reconciles');
    for (const [code] of lt.byInvestor.get('Investor 1').perAsset) assert(keepCodes.has(code), 'only filtered assets carry exposure');
    close(lt.totals.direct.nominal / 1e6, res.metrics.book_total_m, 1e-6, 'filtered direct = filtered book');
  });
})(typeof window !== 'undefined' ? window : globalThis);
