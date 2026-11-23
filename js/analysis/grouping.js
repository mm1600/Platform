/* Scope analysis: transactions shown as one line (Scope.grouping).
 *
 * Some deals are several assets in the data ("Alder 1", "Alder 2", …, sharing a Mapping › Transaction Group). With
 * grouping on, the per-asset views list each transaction group as ONE line named by the group; assets without a group, or
 * alone in theirs, stay as they are. Nothing is recalculated and no total changes: a grouped line is its members added up,
 * and every total, share, average and chart is still worked out from the members (AUM.summarise reads row._members), so
 * only the number of lines differs. The sheets that are one row per Holdings line (Holdings, Calculations, Positions) are
 * never grouped.
 *
 * A grouped line: amounts are sums; margin, coupon, WAL, tenor, remaining years, rating number and ESG score are averages
 * weighted by exposure; the rating is the grade nearest that number (IG by the threshold); maturity is the latest date,
 * funding and financial close the earliest; the watchlist status is the most serious; any other text is the members' value
 * when they agree and "Mixed" when they differ. Its code is "tg:" + the group, which the asset page opens as the list of
 * its deals.
 *
 *   Scope.grouping.apply(res)          → the result with grouped rows (memoised per result); res itself when nothing groups
 *   Scope.grouping.on(pageId)          → is grouping on for this page (its own switch, else the master switch)?
 *   Scope.grouping.set(pageId, on)     → switch a page (pageId null: the master switch, which also clears the pages' own)
 *   Scope.grouping.PAGES               → the pages that can group
 *   Scope.grouping.isGroup(code), members(res, code)
 */
(function (global) {
  'use strict';
  const Scope = global.Scope || (global.Scope = {});
  const U = Scope.util;
  const G = (Scope.grouping = {});
  const memo = new WeakMap();
  const str = (v) => (v === null || v === undefined ? '' : String(v).trim());
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const PREFIX = 'tg:';
  G.PREFIX = PREFIX;
  // pages whose lists are per asset, so can show a transaction as one line (the Explorer: its Output tab only)
  G.PAGES = ['aum', 'explorer', 'investors', 'sheets', 'concentration', 'designer', 'ask'];
  const WEIGHTED = ['margin_bps', 'coupon', 'wal_years', 'initial_tenor', 'remaining_years', 'rating_numeric', 'esg_score'];
  const WATCH = ['', 'no', 'watch', 'intensive']; // the most serious wins

  G.isGroup = (code) => String(code || '').startsWith(PREFIX);
  /** The rows a grouped line stands for (its own row when it is not a group). */
  G.members = (res, code) => { const g = res && res.groups && res.groups.get(String(code)); return g ? g.rows : []; };

  /** One value for a text field: the members' value when they agree (blanks aside), "Mixed" when they differ. */
  const same = (list) => { const vals = Array.from(new Set(list.map(str).filter(Boolean))); return vals.length === 0 ? '' : vals.length === 1 ? vals[0] : 'Mixed'; };
  const sumMaps = (maps) => { const out = {}; for (const m of maps) for (const [k, v] of Object.entries(m || {})) if (isNum(v)) out[k] = (out[k] || 0) + v; return out; };
  const pickDate = (list, later) => { const ds = list.filter((d) => d instanceof Date && !isNaN(d)); return ds.length ? new Date((later ? Math.max : Math.min)(...ds.map((d) => +d))) : null; };

  /** The members of one transaction group as one Output row. */
  function mergeRows(name, list, res) {
    const code = PREFIX + name, w = (r) => (isNum(r.exposure_m) ? r.exposure_m : 0);
    const wavg = (k) => { let n = 0, d = 0; for (const r of list) if (isNum(r[k])) { n += r[k] * w(r); d += w(r); } return d ? n / d : (list.some((r) => isNum(r[k])) ? U.sum(list.filter((r) => isNum(r[k])), (r) => r[k]) / list.filter((r) => isNum(r[k])).length : null); };
    const out = { code, name, code_name: `${list.length} deals`, transaction_group: name, _members: list.slice(), _group: true };
    const keys = new Set(); for (const r of list) for (const k of Object.keys(r)) keys.add(k);
    for (const k of keys) {
      if (k in out || k === 'asset' || k === 'rank') continue;
      const vals = list.map((r) => r[k]);
      if (/_m$/.test(k) || k === 'positions' || k === 'ghg_scope12_t') out[k] = vals.some(isNum) ? U.sum(vals.filter(isNum), (v) => v) : vals[0];
      else if (WEIGHTED.includes(k)) out[k] = wavg(k);
      else if (k === 'maturity_date') out[k] = pickDate(vals, true);
      else if (k === 'funding_date' || k === 'financial_close') out[k] = pickDate(vals, false);
      else if (k === 'investors' || k === 'investors_drawn') out[k] = sumMaps(vals);
      else if (k === 'split') { out[k] = {}; const dims = new Set(); for (const v of vals) for (const d of Object.keys(v || {})) dims.add(d); for (const d of dims) out[k][d] = sumMaps(vals.map((v) => (v || {})[d])); }
      else if (k === 'flags') out[k] = Array.from(new Set([].concat(...vals.map((v) => v || []))));
      else if (k === 'watchlist') out[k] = vals.slice().sort((a, b) => WATCH.indexOf(str(b).toLowerCase()) - WATCH.indexOf(str(a).toLowerCase()))[0];
      else if (k === 'group_invested') out[k] = vals.some((v) => /^y/i.test(str(v))) ? 'Yes' : same(vals);
      else if (k === 'chronological_order' || k === 'deal_year') out[k] = vals.some(isNum) ? Math.min(...vals.filter(isNum)) : vals[0];
      else if (k === 'drawn_pct') out[k] = null; // below, from the sums
      else if (vals.every((v) => v === null || v === undefined || typeof v === 'string' || typeof v === 'number')) out[k] = vals.every(isNum) ? (vals.every((v) => v === vals[0]) ? vals[0] : wavg(k)) : same(vals);
      else out[k] = vals[0];
    }
    out.drawn_pct = isNum(out.drawn_m) && out.exposure_m ? out.drawn_m / out.exposure_m : NaN;
    // the rating: the grade nearest the weighted number; IG by the threshold, as for one asset
    const rated = list.filter((r) => r.rating_status === 'rated');
    out.rating_status = rated.length ? 'rated' : same(list.map((r) => r.rating_status)) || 'NR';
    if (rated.length) {
      let n = 0, d = 0; for (const r of rated) if (isNum(r.rating_numeric)) { n += r.rating_numeric * w(r); d += w(r); }
      out.rating_numeric = d ? n / d : rated[0].rating_numeric;
      const scale = (res.ratingScale || []).filter((s) => isNum(s.numeric) && s.numeric > 0); let best = null;
      for (const s of scale) if (!best || Math.abs(s.numeric - out.rating_numeric) < Math.abs(best.numeric - out.rating_numeric)) best = s;
      const agree = same(rated.map((r) => r.rating));
      out.rating = agree && agree !== 'Mixed' ? agree : best ? best.grade : 'Mixed';
      const th = res.config && isNum(res.config.ig_threshold) ? res.config.ig_threshold : NaN;
      out.ig_label = isNum(th) ? (out.rating_numeric > th ? 'SUB IG' : 'IG') : same(rated.map((r) => r.ig_label));
    }
    out.asset = mergeAssets(code, name, list.map((r) => r.asset).filter(Boolean), out);
    return out;
  }

  /** The members' asset records as one (for the investor book and anything that reads row.asset). */
  function mergeAssets(code, name, assets, row) {
    const add = (k) => U.sum(assets, (a) => (isNum(a[k]) ? a[k] : 0));
    const byInvestor = new Map(), platform = {};
    for (const a of assets) {
      for (const [label, v] of a.byInvestor || []) { const e = byInvestor.get(label) || { nominal: 0, drawn: 0, commitment: 0, positions: 0 }; for (const k of Object.keys(e)) e[k] += isNum(v[k]) ? v[k] : 0; byInvestor.set(label, e); }
      for (const [p, v] of Object.entries(a.platform || {})) { const e = platform[p] || (platform[p] = { nominal: 0, drawn: 0, commitment: 0 }); for (const k of Object.keys(e)) e[k] += isNum(v[k]) ? v[k] : 0; }
    }
    const attrs = {}; for (const a of assets) for (const k of Object.keys(a.attrs || {})) attrs[k] = same(assets.map((x) => (x.attrs || {})[k]));
    const out = { code, name, code_name: `${assets.length} deals`, members: assets, holdings: [].concat(...assets.map((a) => a.holdings || [])), aliases: [], positions: [].concat(...assets.map((a) => a.positions || [])),
      positionCount: add('positionCount'), excludedCount: add('excludedCount'), active: assets.some((a) => a.active), inActiveList: assets.some((a) => a.inActiveList), src: {}, attrs, esg: (assets[0] && assets[0].esg) || {}, sheets: {},
      byInvestor, platform, flags: Array.from(new Set([].concat(...assets.map((a) => a.flags || [])))), group_invested: assets.some((a) => a.group_invested), isGroup: true,
      sector_holdings: same(assets.map((a) => a.sector_holdings)), currency: same(assets.map((a) => a.currency)), fixed_floating: same(assets.map((a) => a.fixed_floating)), instrument_type: same(assets.map((a) => a.instrument_type)),
      funding_date: row.funding_date, maturity_date: row.maturity_date, margin_bps: row.margin_bps, coupon: row.coupon, initial_tenor: row.initial_tenor, remaining_years: row.remaining_years, maturity_bucket: row.maturity_bucket,
      rating: { current_grade: row.rating, status: row.rating_status, ig_label: row.ig_label, current_numeric: row.rating_numeric }, asset_group: same(assets.map((a) => a.asset_group)) || name, transaction_group: name };
    for (const k of ['nominal', 'drawn', 'commitment', 'nominal_eur', 'drawn_eur', 'group_nominal', 'group_drawn', 'group_commitment', 'third_party_nominal', 'third_party_drawn', 'third_party_commitment']) out[k] = add(k);
    return out;
  }

  /**
   * The result with each transaction group of two or more assets as one line. Adds: grouped (true), ungrouped (the result
   * as it was), groups (Map code → { name, codes, rows }), groupOf (Map asset code → its group's code). Totals and
   * shares are unchanged; metrics.n_assets counts lines.
   */
  G.apply = function (res) {
    if (!res || res.fatal || res.grouped || !Array.isArray(res.rows)) return res;
    if (memo.has(res)) return memo.get(res);
    const by = new Map();
    for (const r of res.rows) { const g = str(r.transaction_group); if (!g) continue; if (!by.has(g)) by.set(g, []); by.get(g).push(r); }
    const rows = [], groups = new Map(), groupOf = new Map(), done = new Set();
    for (const r of res.rows) {
      const g = str(r.transaction_group), list = g ? by.get(g) : null;
      if (!list || list.length < 2) { rows.push(r); continue; }
      if (done.has(g)) continue; done.add(g);
      const m = mergeRows(g, list, res);
      rows.push(m); groups.set(m.code, { name: g, codes: list.map((x) => String(x.code)), rows: list });
      for (const x of list) groupOf.set(String(x.code), m.code);
    }
    if (!groups.size) { memo.set(res, res); return res; }
    rows.slice().sort((a, b) => (b.exposure_m || 0) - (a.exposure_m || 0)).forEach((r, i) => { if (r._group) r.rank = i + 1; });
    const AUM = Scope.calc && Scope.calc.aum, sum = AUM && AUM.summarise ? AUM.summarise(rows, (res.ratingScale || []).filter((s) => /s&p|fitch/i.test(s.scale || '')).length ? res.ratingScale.filter((s) => /s&p|fitch/i.test(s.scale || '')) : res.ratingScale || [], res.config) : null;
    const out = Object.assign({}, res, { rows, grouped: true, ungrouped: res, groups, groupOf });
    if (sum) { out.metrics = Object.assign({}, res.metrics, { n_assets: sum.metrics.n_assets }); out.distributions = res.distributions; }
    memo.set(res, out);
    out.base = res.base && res.base !== res ? G.apply(res.base) : out;
    return out;
  };

  // ---------- the switches (kept in this browser): a master, and each page's own ----------
  const state = () => { const st = Scope.store && Scope.store.state && Scope.store.state.settings; const g = (st && st.groupTx) || {}; return { all: !!g.all, pages: Object.assign({}, g.pages) }; };
  /** Is grouping on for this page: its own switch when set, else the master switch. */
  G.on = (pageId) => { if (!G.PAGES.includes(pageId)) return false; const s = state(); return s.pages[pageId] !== undefined ? !!s.pages[pageId] : s.all; };
  G.master = () => state().all;
  /** Switch a page (pageId given) or the master (pageId null: every page follows it again). */
  G.set = function (pageId, on) {
    const s = state();
    if (pageId) s.pages[pageId] = !!on; else { s.all = !!on; s.pages = {}; }
    Scope.store.setSetting('groupTx', s);
  };
  /** The result a page should draw: grouped when its switch is on. */
  G.forPage = (pageId, res) => (res && G.on(pageId) ? G.apply(res) : res);
})(typeof window !== 'undefined' ? window : globalThis);
