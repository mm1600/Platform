/* Scope concentration tests — run in the browser (tests/index.html) or Node (node tests/run-node.js).
 * Loads after engine.tests.js, js/core/charts-extra.js and js/modules/layer2-concentration.js. */
(function (global) {
  'use strict';
  const Scope = global.Scope, U = Scope.util, AUM = Scope.engine.aum, CX = Scope.concentration;
  const T = (Scope.tests = Scope.tests || { cases: [], files: null });
  T.add = T.add || ((name, fn) => T.cases.push({ name, fn }));
  const add = T.add;
  const assert = (c, msg) => { if (!c) throw new Error(msg || 'assertion failed'); };
  const close = (a, b, eps, msg) => { if (!(Math.abs(a - b) <= (eps === undefined ? 1e-6 : eps))) throw new Error(`${msg || ''} expected ${b}, got ${a}`); };
  T.tablesFrom = T.tablesFrom || function (files) { const tables = {}, tableInfo = {}; for (const [n, t] of Object.entries(files)) { const p = Scope.csv.parse(t); tables[n] = p.records.filter(Boolean); tableInfo[n] = { parsed: p }; } return { tables, tableInfo }; };
  const cache = {};
  const demo = (platform, currency) => { const k = (platform || 'TOTAL') + '|' + (currency || 'EUR'); return cache[k] || (cache[k] = AUM.compute(Object.assign({ adjustments: [], platform: platform || 'TOTAL', currency: currency || 'EUR' }, T.tablesFrom(T.files)))); };
  const d = (s) => U.parseDate(s);
  const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
  // a tiny synthetic result with only the fields the helpers read
  const fake = (rows, raw) => ({ rows, config: { base_currency: 'EUR', raw: Object.assign({ base_currency: 'EUR' }, raw || {}) }, reportingDate: d('2026-06-30') });
  const row = (code, exposure, extra) => Object.assign({ code, name: 'Asset ' + code, exposure_m: exposure, drawn_m: exposure, undrawn_m: 0, sector: 'S1', country: 'France', sponsor: 'Sp1', currency: 'EUR', rating_status: 'rated', ig_label: 'IG', rating: 'BBB', fixed_floating: 'Fixed', maturity_date: d('2030-06-30'), positions: 1 }, extra || {});

  add('concentration: hhi and effective number of names', () => {
    close(CX.hhi([25, 25, 25, 25]), 0.25, 1e-12, 'equal weights → 1/n');
    close(CX.hhi([7]), 1, 1e-12, 'single name → 1');
    close(CX.hhi([60, 40]), 0.36 + 0.16, 1e-12, 'two names');
    close(CX.hhi([60, 40, 0, -5, NaN, null, 'x']), 0.52, 1e-12, 'non-positive and non-numeric ignored');
    close(CX.hhi([6, 4]), CX.hhi([600, 400]), 1e-12, 'scale invariant');
    assert(isNaN(CX.hhi([])) && isNaN(CX.hhi([0, 0])) && isNaN(CX.hhi(null)), 'empty → NaN');
    close(CX.effectiveN(0.25), 4, 1e-12, 'from an HHI'); close(CX.effectiveN([10, 10, 10]), 3, 1e-12, 'from amounts');
    assert(isNaN(CX.effectiveN(0)) && isNaN(CX.effectiveN([])), 'undefined → NaN');
  });

  add('concentration: groupShares and paretoCumulative', () => {
    const g = CX.groupShares([{ k: 'a', v: 1 }, { k: 'b', v: 3 }, { k: '', v: 2 }, { k: 'a', v: 2 }, { k: 'c', v: NaN }], (r) => r.k, (r) => r.v);
    assert(g.map((x) => x.label).join('|') === 'a|b|(blank)', 'largest first, blank labelled, NaN skipped: ' + g.map((x) => x.label).join('|'));
    close(g[0].value, 3, 1e-12, 'a value'); assert(g[0].count === 2, 'a count'); close(sum(g, (x) => x.share), 1, 1e-12, 'shares sum to 1');
    const p = CX.paretoCumulative([{ label: 'x', value: 10 }, { label: 'y', value: 30 }, { label: 'z', value: 20 }]);
    assert(p.map((x) => x.label).join('') === 'yzx' && p[0].rank === 1 && p[2].rank === 3, 'sorted desc with ranks');
    close(p[0].share, 0.5, 1e-12, 'share'); close(p[1].cumShare, 50 / 60, 1e-12, 'cumulative'); close(p[2].cumShare, 1, 1e-12, 'ends at 100 %');
    for (let i = 1; i < p.length; i++) assert(p[i].cumShare >= p[i - 1].cumShare, 'monotonic');
    const q = CX.paretoCumulative([{ label: 'x', value: 10 }, { label: 'y', value: 30 }], 200);
    close(q[1].cumShare, 0.2, 1e-12, 'explicit book total for a top-N cut');
  });

  add('concentration: addMonths clamps to the month end', () => {
    assert(U.isoDate(CX.addMonths(d('2026-01-31'), 1)) === '2026-02-28', 'Jan 31 + 1 → Feb 28');
    assert(U.isoDate(CX.addMonths(d('2028-01-31'), 1)) === '2028-02-29', 'leap year');
    assert(U.isoDate(CX.addMonths(d('2026-06-30'), 12)) === '2027-06-30' && U.isoDate(CX.addMonths(d('2026-06-30'), 36)) === '2029-06-30', 'whole years');
    assert(U.isoDate(CX.addMonths(d('2026-11-15'), 3)) === '2027-02-15', 'year roll');
    assert(CX.addMonths(null, 3) === null, 'no date → null');
  });

  add('concentration: maturityLadder fills gaps, keeps undated apart, windows include past due', () => {
    const rows = [
      row('A', 10, { maturity_date: d('2026-03-31') }),   // past due on the reporting date
      row('B', 20, { maturity_date: d('2027-06-30') }),   // exactly reporting date + 12 months
      row('C', 30, { maturity_date: d('2027-07-01') }),
      row('D', 15, { maturity_date: d('2030-01-15') }),   // 2028 and 2029 empty
      row('E', 25, { maturity_date: null }),
    ];
    const L = CX.maturityLadder(rows, d('2026-06-30'));
    assert(L.years.map((y) => y.label).join(',') === '2026,2027,2028,2029,2030', 'continuous years: ' + L.years.map((y) => y.label).join(','));
    close(L.years[1].value, 50, 1e-12, '2027'); assert(L.years[2].value === 0 && L.years[2].count === 0, 'empty year kept');
    close(L.total, 100, 1e-12, 'total includes undated'); close(L.unknown.value, 25, 1e-12, 'undated'); close(L.unknown.share, 0.25, 1e-12, 'undated share');
    close(sum(L.years, (y) => y.value) + L.unknown.value, L.total, 1e-12, 'years + unknown = total');
    close(L.years[L.years.length - 1].cumShare, 0.75, 1e-12, 'cumulative ends at the dated share');
    close(L.within[12].value, 30, 1e-12, '12 months: past due + boundary date'); assert(L.within[12].count === 2, '12m count');
    close(L.within[24].value, 60, 1e-12, '24 months'); close(L.within[36].value, 60, 1e-12, '36 months'); close(L.within[36].share, 0.6, 1e-12, '36m share');
    const early = CX.maturityLadder([row('A', 1, { maturity_date: d('2028-01-01') })], d('2026-06-30'));
    assert(early.years[0].label === '2026', 'ladder starts at the reporting year');
    const none = CX.maturityLadder([], d('2026-06-30'));
    assert(none.years.length === 0 && none.within[12].value === 0 && isNaN(none.within[12].share), 'empty book');
    assert(isNaN(CX.maturityLadder(rows, null).within[12].value), 'no reporting date → windows undefined');
  });

  add('concentration: thresholds status, headroom, worst contributor (illustrative config values)', () => {
    const rows = [
      row('A', 40, { sponsor: 'Big', sector: 'Energy', country: 'Spain', currency: 'GBP', ig_label: 'SUB IG' }),
      row('B', 30, { sponsor: '', sector: 'Energy', country: 'France' }),
      row('C', 20, { sponsor: 'Small', sector: 'Digital', country: 'France', rating_status: 'NR', ig_label: 'IG' }),
      row('D', 10, { sponsor: 'Small', sector: 'Social', country: 'France', currency: 'USD' }),
    ];
    const th = CX.thresholds(fake(rows, { limit_single_name_pct: '10', limit_sponsor_pct: '45', limit_sector_pct: '70', limit_country_pct: '60', limit_sub_ig_pct: '40' }));
    const by = {}; th.forEach((t) => { by[t.id] = t; });
    assert(th.length === CX.THRESHOLDS.length && th.every((t) => t.illustrative === true), 'one entry per threshold, all illustrative');
    close(by.single_name.measured, 0.4, 1e-12, 'single name'); assert(by.single_name.status === 'above' && by.single_name.worst.code === 'A', 'single name above, worst A');
    close(by.single_name.headroom, -0.3, 1e-12, 'negative headroom'); close(by.single_name.utilisation, 4, 1e-12, 'utilisation');
    assert(by.single_name.worst.filter.field === 'asset_code' && by.single_name.worst.filter.value[0] === 'A', 'worst filter');
    close(by.sponsor.measured, 0.4, 1e-12, 'blank sponsor is not the largest sponsor'); assert(by.sponsor.worst.label === 'Big' && by.sponsor.status === 'within', 'sponsor within');
    close(by.sector.measured, 0.7, 1e-12, 'sector'); assert(by.sector.status === 'within' && by.sector.worst.label === 'Energy', 'at the threshold counts as within');
    close(by.country.measured, 0.6, 1e-12, 'country'); assert(by.country.worst.label === 'France', 'country worst');
    close(by.sub_ig.measured, 0.4, 1e-12, 'sub-IG = rated SUB IG only'); assert(by.sub_ig.worst.code === 'A' && by.sub_ig.worst.filter.field === 'ig_label', 'sub-IG worst');
    close(by.non_base_ccy.measured, 0.5, 1e-12, 'non-base currency'); assert(by.non_base_ccy.worst.label === 'GBP', 'largest non-base currency');
    assert(by.non_base_ccy.status === 'na' && isNaN(by.non_base_ccy.limit) && isNaN(by.non_base_ccy.headroom), 'missing threshold → na');
    const empty = CX.thresholds(fake([], { limit_single_name_pct: '10' }));
    assert(empty.every((t) => t.status === 'na'), 'empty book → na');
  });

  add('concentration: metrics on a synthetic book', () => {
    const rows = [row('A', 50, { currency: 'GBP', fixed_floating: 'Floating', undrawn_m: 5, drawn_m: 45 }), row('B', 30, { sector: 'S2', sponsor: 'Sp2' }), row('C', 20, { sector: 'S2', country: 'Spain', rating_status: 'NR', sponsor: '' })];
    const M = CX.metrics(fake(rows));
    close(M.total, 100, 1e-12, 'total'); assert(M.nAssets === 3 && M.nSponsors === 2 && M.nPositions === 3, 'counts');
    assert(M.largest.code === 'A', 'largest'); close(M.largest.share, 0.5, 1e-12, 'largest share');
    close(M.hhiAsset, 0.25 + 0.09 + 0.04, 1e-12, 'HHI assets'); close(M.effectiveN, 1 / 0.38, 1e-9, 'effective N');
    close(M.hhiSector, 0.5, 1e-12, 'HHI sectors 50/50'); close(M.hhiCountry, 0.64 + 0.04, 1e-12, 'HHI countries 80/20');
    close(M.top10Share, 1, 1e-12, 'top 10 of 3 = all'); close(M.floatingShare, 0.5, 1e-12, 'floating'); close(M.nonBaseShare, 0.5, 1e-12, 'non-base');
    close(M.nrShare, 0.2, 1e-12, 'NR share'); close(M.subIgShare, 0, 1e-12, 'no sub-IG'); close(M.undrawn, 5, 1e-12, 'undrawn');
    const empty = CX.metrics(fake([]));
    assert(empty.total === 0 && empty.largest === null && isNaN(empty.hhiAsset), 'empty book');
  });

  add('concentration: demo book reconciles with the engine', () => {
    const res = demo(), M = CX.metrics(res);
    close(M.total, res.metrics.total_exposure_m, 1e-6, 'total'); assert(M.nAssets === res.metrics.n_assets, 'assets');
    close(M.subIgShare, res.metrics.sub_ig_share, 1e-9, 'sub-IG share = engine metric');
    close(M.undrawn, res.metrics.total_undrawn_m, 1e-6, 'undrawn = engine metric');
    close(M.largestSector.share, res.distributions.sector[0].share, 1e-9, 'largest sector = engine distribution');
    close(M.hhiSector, CX.hhi(res.distributions.sector.map((x) => x.exposure_m)), 1e-12, 'HHI sector from engine distribution');
    close(M.largest.share, res.rows[0].exposure_m / res.metrics.total_exposure_m, 1e-9, 'largest = rank 1 row');
    assert(M.top10Share >= M.top5Share && M.top5Share >= M.largest.share && M.top10Share <= 1, 'top-N shares ordered');
    assert(M.effectiveN >= 1 && M.effectiveN <= M.nAssets, `effective N ${M.effectiveN} within 1..${M.nAssets}`);
    close(sum(M.ladder.years, (y) => y.value) + M.ladder.unknown.value, M.total, 1e-6, 'ladder reconciles');
    assert(M.maturing[12].value <= M.maturing[24].value && M.maturing[24].value <= M.maturing[36].value, 'windows nested');
    const th = CX.thresholds(res);
    assert(th.length === 6 && th.every((t) => isFinite(t.limit) && (t.status === 'within' || t.status === 'above')), 'all six illustrative thresholds read from config.csv');
    const sp = th.find((t) => t.id === 'sponsor');
    close(sp.measured, res.distributions.sponsor.filter((x) => x.label !== '(blank)')[0].share, 1e-9, 'sponsor = engine distribution');
  });

  add('concentration: another platform and currency stay consistent', () => {
    const res = demo('ALPHA', 'GBP'), M = CX.metrics(res);
    close(M.total, res.metrics.total_exposure_m, 1e-6, 'total in display currency');
    close(sum(CX.paretoCumulative(res.rows.map((r) => ({ label: r.code, value: r.exposure_m }))).slice(-1), (x) => x.cumShare), 1, 1e-9, 'pareto of all rows ends at 100 %');
    const base = demo();
    close(CX.metrics(base).nonBaseShare, CX.metrics(demo('TOTAL', 'GBP')).nonBaseShare, 1e-9, 'non-base share independent of display currency');
  });

  if (Scope.charts && Scope.charts.squarify) {
    const C = Scope.charts;
    add('charts-extra: squarify conserves area and stays inside the rectangle', () => {
      const items = [6, 6, 4, 3, 2, 2, 1].map((v, i) => ({ value: v, id: i })).concat([{ value: 0 }, { value: NaN }]);
      const out = C.squarify(items, 10, 20, 600, 400);
      assert(out.length === 7, 'zero and NaN dropped');
      close(sum(out, (t) => t.w * t.h), 600 * 400, 1e-6, 'area conserved');
      for (const t of out) {
        close(t.w * t.h, (t.item.value / 24) * 600 * 400, 1e-6, 'area proportional to value');
        assert(t.x >= 10 - 1e-9 && t.y >= 20 - 1e-9 && t.x + t.w <= 610 + 1e-6 && t.y + t.h <= 420 + 1e-6, 'inside bounds');
      }
      const worst = Math.max.apply(null, out.map((t) => Math.max(t.w / t.h, t.h / t.w)));
      assert(worst < 4, 'squarified aspect ratios stay reasonable: ' + worst.toFixed(2));
      assert(C.squarify([], 0, 0, 100, 100).length === 0 && C.squarify([{ value: 1 }], 0, 0, 0, 100).length === 0, 'degenerate inputs');
    });
    add('charts-extra: quantile breaks, classes, sequential ramp and path bounds', () => {
      const b = C.quantileBreaks([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5);
      assert(b.length === 4 && b.every((x, i) => i === 0 || x > b[i - 1]), 'four ascending breaks: ' + b.join(','));
      assert(C.classOf(1, b) === 0 && C.classOf(10, b) === 4 && C.classOf(b[1], b) === 1, 'class index');
      assert(C.quantileBreaks([5, 5, 5], 5).length === 0, 'one distinct value → one class');
      assert(C.quantileBreaks([1, 2], 5).join(',') === '1', 'two distinct values → two classes');
      assert(C.quantileBreaks([0, -1, NaN], 5).length === 0, 'no positive values');
      assert(C.seqColor(0) === C.SEQ_RAMP[0].toLowerCase() && C.seqColor(1) === C.SEQ_RAMP[C.SEQ_RAMP.length - 1].toLowerCase(), 'ramp ends');
      assert(C.inkOn('#005e3a') === '#ffffff' && C.inkOn('#c2e3d3') === '#1d1d1b', 'label ink follows fill lightness');
      const bb = C.pathBBox('M10,10l5,0v5h-5zM100,100L110,120Z');
      assert(bb.join(',') === '10,10,110,120', 'whole-path bounds: ' + bb.join(','));
      assert(C.mainBBox('M10,10l5,0v5h-5zM100,100L110,120Z').join(',') === '100,100,110,120', 'largest subpath');
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
