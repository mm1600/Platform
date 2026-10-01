/* Scope engine: fund look-through.
 * Pure function of (AUM engine result, fund_lookthrough.csv rows) → who economically owns each asset. No DOM; runs in Node.
 *
 *   Scope.engine.lookthrough.compute(res, ltRows) → {
 *     available,                     true when at least one valid look-through row was read
 *     funds: [{ fund_label, holders:[{holder_label, share, holder_group, group_weight, note}], listedShare, externalShare,
 *               groupShareFromHolders, thirdPartyShare, groupWeight, consistent, isInvestorColumn, passThrough, externalAmount }],
 *     fundByLabel: Map(fund_label → fund),
 *     byInvestor: Map(label → { label, key, group, group_weight, isInvestorColumn, isFund, direct, indirect, total,
 *                               positions, assetCount:{direct, indirect, total}, viaFunds:[{fund, share, amount}] (every fund held),
 *                               shareOfBook (total nominal ÷ direct book),
 *                               perAsset: Map(code → { direct, indirect, total, via:[{fund, share, amount}] }) }),
 *     byAsset: Map(code → [{ holder, holder_group, kind:'investor'|'external', direct, indirect, total, via }]),
 *     assetTotals: Map(code → { direct, ultimate, external }),
 *     totals: { direct, ultimate, external, difference }, reconciles,
 *     issues: [{ severity, table, row, message }], cycles: [[label, …]], maxDepth, truncated }
 *   Every amount is { nominal, drawn, commitment } in display-currency full units (like res.assets[i].byInvestor).
 *
 * Rules
 *   - Direct exposure D(X, A) is investor column X's amount in asset A.
 *   - A fund F with rows in fund_lookthrough.csv is a pass-through: its holders H own share(F, H) of it, the residual
 *     1 − Σ shares is owned by holders outside the platform ("External fund holders").
 *   - Economic exposure T(X, A) = D(X, A) + Σ_F share(F, X) × T(F, A); indirect = T − D. A fund holding units of another
 *     fund is supported by propagating to a fixed point, capped at MAX_DEPTH levels (cycles are reported, never looped).
 *   - Ultimate holders of an asset are every holder that is not a pass-through fund, plus "External fund holders".
 *     Σ ultimate totals = Σ direct columns = the asset total, so nothing is double counted.
 *   - Consistency: Σ share × group_weight(holder) over a fund's holders should equal the fund's own group_weight
 *     (Group entities weigh 1, third parties 0). A divergence is a warning; attribution keeps using group_weight.
 *   - Shares outside 0–1, or a fund whose listed shares exceed 1, are errors. Values are used as entered, never clamped.
 */
(function (global) {
  'use strict';
  const Scope = global.Scope || (global.Scope = {});
  const U = Scope.util;
  const E = (Scope.engine = Scope.engine || {});
  const LT = (E.lookthrough = {});

  const MEASURES = ['nominal', 'drawn', 'commitment'];
  LT.MEASURES = MEASURES;
  LT.MAX_DEPTH = 5;
  LT.EXTERNAL_LABEL = 'External fund holders';
  LT.TABLE = 'fund_lookthrough.csv';
  /** Page modes: which part of the economic exposure a view shows. key = the amount field on perAsset / byInvestor. */
  LT.MODES = [
    { id: 'direct', label: 'Direct', key: 'direct' },
    { id: 'lookthrough', label: 'Look-through', key: 'indirect' },
    { id: 'total', label: 'Total', key: 'total' },
  ];
  LT.modeKey = (mode) => (LT.MODES.find((m) => m.id === mode) || LT.MODES[2]).key;

  const AMOUNT_EPS = 1e-6;   // full currency units: anything smaller is treated as zero
  const SHARE_EPS = 1e-6;    // tolerance for share sums and the group-weight check

  // ---------- small amount helpers ----------
  const zero = () => ({ nominal: 0, drawn: 0, commitment: 0 });
  /** acc += v × f, per measure; returns acc. */
  const addInto = (acc, v, f) => { const k = f === undefined ? 1 : f; for (const m of MEASURES) acc[m] += (v[m] || 0) * k; return acc; };
  const scaled = (v, f) => addInto(zero(), v, f);
  const isZero = (v) => MEASURES.every((m) => Math.abs(v[m] || 0) < AMOUNT_EPS);
  const str = (v) => (v === null || v === undefined ? '' : String(v));
  const pct = (x) => (U.isNum(x) ? (x * 100).toFixed(1) + '%' : '–');

  /** Parse a share: 0.15, "0.15" or "15%" → 0.15; anything else → NaN. */
  LT.parseShare = function (raw) {
    const s = str(raw).trim();
    if (!s) return NaN;
    const n = U.toNumber(s);
    if (!U.isNum(n)) return NaN;
    return /%\s*$/.test(s) ? n / 100 : n;
  };

  // memo: one result per engine result and look-through table content (pages call compute on every render)
  const memo = new WeakMap();
  const rowsKey = (rows) => rows.map((r) => (r ? `${str(r.fund_label)}|${str(r.holder_label)}|${str(r.share)}` : '')).join('\n');

  /** Main entry point. ltRows may be absent: everything then degrades to direct-only (available:false). */
  LT.compute = function (res, ltRows) {
    const rows = Array.isArray(ltRows) ? ltRows.filter(Boolean) : [];
    if (res && typeof res === 'object') {
      const key = rowsKey(rows), hit = memo.get(res);
      if (hit && hit.key === key) return hit.out;
      const out = computeFresh(res, rows);
      memo.set(res, { key, out });
      return out;
    }
    return computeFresh(res || {}, rows);
  };

  function computeFresh(res, rows) {
    const issues = [];
    const issue = (severity, message, row) => issues.push({ severity, table: LT.TABLE, row: row === undefined ? null : row, message });
    const cfg = res.config || {};
    const L = cfg.attribution_label || 'Group';
    const assets = Array.isArray(res.assets) ? res.assets : [];
    const investors = Array.isArray(res.investors) ? res.investors : [];
    const invByLabel = new Map(investors.map((i) => [i.label, i]));

    // ---------- 1. read the table: fund → holder → share ----------
    const shareMap = new Map(); // fund → Map(holder → { share, note, lines })
    rows.forEach((r, i) => {
      const line = i + 2;
      const fund = str(r.fund_label).trim(), holder = str(r.holder_label).trim();
      if (!fund || !holder) { issue('warn', `Line ${line}: fund_label or holder_label is blank; row ignored`, line); return; }
      const share = LT.parseShare(r.share);
      if (!U.isNum(share)) { issue('warn', `Line ${line}: share "${str(r.share)}" for ${holder} in ${fund} is not numeric; row ignored`, line); return; }
      if (share < 0 || share > 1) issue('error', `Line ${line}: share ${share} for ${holder} in ${fund} is outside 0–1; used as entered, not clamped`, line);
      if (!shareMap.has(fund)) shareMap.set(fund, new Map());
      const m = shareMap.get(fund);
      if (m.has(holder)) { const x = m.get(holder); issue('warn', `Line ${line}: ${holder} already listed for ${fund} (line ${x.lines.join(', ')}); shares added`, line); x.share += share; x.lines.push(line); }
      else m.set(holder, { share, note: str(r.note), lines: [line] });
    });
    const available = shareMap.size > 0;
    if (!rows.length) issue('info', `${LT.TABLE} not loaded: exposures are direct only and funds are shown as holders in their own right`);
    else if (!available) issue('warn', `${LT.TABLE} has no usable rows: exposures are direct only`);

    const fundLabels = Array.from(shareMap.keys());
    const isFund = new Set(fundLabels);

    // ---------- 2. label universe: investor columns, then labels seen in assets, then table-only labels ----------
    const labels = [], seen = new Set();
    const addLabel = (l) => { if (l && !seen.has(l)) { seen.add(l); labels.push(l); } };
    (Array.isArray(res.investorColumns) ? res.investorColumns : investors.map((i) => i.label)).forEach(addLabel);
    for (const a of assets) if (a.byInvestor) for (const l of a.byInvestor.keys()) addLabel(l);
    const columnSet = new Set(labels);
    for (const [f, m] of shareMap) { addLabel(f); for (const hl of m.keys()) addLabel(hl); }
    const groupOf = (l) => (invByLabel.has(l) ? invByLabel.get(l).group || '' : isFund.has(l) ? 'Fund' : columnSet.has(l) ? 'Unmapped' : 'Outside platform');
    const weightOf = (l) => (invByLabel.has(l) && U.isNum(invByLabel.get(l).group_weight) ? invByLabel.get(l).group_weight : 0);

    // ---------- 3. fund checks: listed share, external residual, group-weight consistency ----------
    const funds = fundLabels.map((f) => {
      const holders = Array.from(shareMap.get(f), ([holder_label, x]) => ({ holder_label, share: x.share, holder_group: groupOf(holder_label), group_weight: weightOf(holder_label), note: x.note }));
      holders.sort((a, b) => b.share - a.share || a.holder_label.localeCompare(b.holder_label));
      const listedShare = holders.reduce((s, x) => s + x.share, 0);
      const groupShareFromHolders = holders.reduce((s, x) => s + x.share * x.group_weight, 0);
      const inv = invByLabel.get(f);
      const groupWeight = inv && U.isNum(inv.group_weight) ? inv.group_weight : NaN;
      const consistent = U.isNum(groupWeight) && Math.abs(groupShareFromHolders - groupWeight) <= SHARE_EPS;
      const fund = { fund_label: f, holders, listedShare, externalShare: 1 - listedShare, groupShareFromHolders, thirdPartyShare: listedShare - groupShareFromHolders, groupWeight, consistent,
        isInvestorColumn: columnSet.has(f), group: groupOf(f), passThrough: zero(), externalAmount: zero() };
      if (listedShare > 1 + SHARE_EPS) issue('error', `${f}: listed unit holders hold ${pct(listedShare)} (more than 100%); the external residual is negative and look-through amounts exceed the fund`);
      if (!columnSet.has(f)) issue('warn', `${f} is not an investor column in Mapping › Funding Name; it has no direct exposure and only passes through what it holds in other funds`);
      else if (inv && inv.group && inv.group !== 'Fund') issue('info', `${f} is listed as a fund in ${LT.TABLE} but its investor_group is "${inv.group}"`);
      if (U.isNum(groupWeight) && !consistent) issue('warn', `${f}: ${L}-entity holders hold ${pct(groupShareFromHolders)} of units but group_weight is ${pct(groupWeight)}; ${L} attribution keeps using group_weight from mapping_investors.csv`);
      for (const x of holders) if (!columnSet.has(x.holder_label) && !isFund.has(x.holder_label)) issue('info', `${x.holder_label} (holder of ${f}) is not an investor column; it carries look-through exposure only`);
      return fund;
    });
    const fundByLabel = new Map(funds.map((f) => [f.fund_label, f]));
    if (available) for (const i of investors) if (i.group === 'Fund' && !isFund.has(i.label)) issue('info', `${i.label} is a fund with no rows in ${LT.TABLE}; it is shown as a holder in its own right (direct only)`);

    // ---------- 4. fund-in-fund graph: cycles and propagation reach ----------
    // reachTo[F] = [[G, fraction]]: fraction of fund G's direct holdings that economically passes through fund F (G itself at 1).
    const cycles = findCycles(fundLabels, (f) => Array.from(shareMap.get(f).keys()).filter((h) => isFund.has(h)));
    for (const c of cycles) issue('error', `Cycle in ${LT.TABLE}: ${c.concat(c[0]).join(' → ')}; look-through truncated at ${LT.MAX_DEPTH} levels, totals may not reconcile`);
    const reachTo = new Map(fundLabels.map((f) => [f, []]));
    let maxDepth = 0, truncated = false;
    for (const G of fundLabels) {
      const acc = new Map([[G, 1]]);
      let frontier = new Map([[G, 1]]), depth = 0;
      while (frontier.size && depth < LT.MAX_DEPTH) {
        const next = new Map();
        for (const [X, f] of frontier) for (const [H, x] of shareMap.get(X)) if (isFund.has(H) && f * x.share !== 0) next.set(H, (next.get(H) || 0) + f * x.share);
        for (const [H, f] of next) acc.set(H, (acc.get(H) || 0) + f);
        frontier = next; if (next.size) depth++;
      }
      maxDepth = Math.max(maxDepth, depth);
      if (frontier.size) truncated = true;
      for (const [F, f] of acc) reachTo.get(F).push([G, f]);
    }
    if (truncated && !cycles.length) issue('warn', `Fund-in-fund chain deeper than ${LT.MAX_DEPTH} levels in ${LT.TABLE}; look-through truncated`);

    // ---------- 5. per asset: pass-through amounts, holder totals, ultimate holders ----------
    const byInvestor = new Map(labels.map((l) => {
      const inv = invByLabel.get(l) || {};
      return [l, { label: l, key: inv.key || '', id: inv.id || '', group: groupOf(l), group_weight: weightOf(l), isInvestorColumn: columnSet.has(l), isFund: isFund.has(l),
        direct: zero(), indirect: zero(), total: zero(), positions: 0, assetCount: { direct: 0, indirect: 0, total: 0 }, viaFunds: [], shareOfBook: NaN, perAsset: new Map() }];
    }));
    // fundsHeldBy: label → [[fund, share]]; viaAcc: label → fund → { share, amount } (every fund held, amount 0 until seen)
    const fundsHeldBy = new Map(labels.map((l) => [l, []]));
    for (const f of fundLabels) for (const [h, x] of shareMap.get(f)) fundsHeldBy.get(h).push([f, x.share]);
    const viaAcc = new Map(labels.map((l) => [l, new Map(fundsHeldBy.get(l).map(([f, s]) => [f, { share: s, amount: zero() }]))]));
    const byAsset = new Map(), assetTotals = new Map();
    const totals = { direct: zero(), ultimate: zero(), external: zero(), difference: zero() };

    for (const a of assets) {
      const cells = a.byInvestor || new Map();
      const D = (l) => cells.get(l) || null;
      // t(F) = Σ_G reach(G → F) × D(G): the amount fund F passes to its holders
      const t = new Map();
      for (const F of fundLabels) { const v = zero(); for (const [G, f] of reachTo.get(F)) { const d = D(G); if (d) addInto(v, d, f); } t.set(F, v); }
      const ultimate = [], assetDirect = zero(), assetUlt = zero(), assetExt = zero();
      for (const l of labels) {
        const d = D(l), direct = d ? scaled(d, 1) : zero();
        const via = [], indirect = zero();
        for (const [F, s] of fundsHeldBy.get(l)) {
          const amount = scaled(t.get(F), s);
          if (isZero(amount)) continue;
          via.push({ fund: F, share: s, amount }); addInto(indirect, amount);
        }
        addInto(assetDirect, direct);
        if (isZero(direct) && isZero(indirect)) continue;
        const total = addInto(scaled(direct, 1), indirect);
        const inv = byInvestor.get(l);
        inv.perAsset.set(a.code, { direct, indirect, total, via });
        addInto(inv.direct, direct); addInto(inv.indirect, indirect); addInto(inv.total, total);
        if (d && d.positions) inv.positions += d.positions;
        if (!isZero(direct)) inv.assetCount.direct++;
        if (!isZero(indirect)) inv.assetCount.indirect++;
        inv.assetCount.total++;
        for (const v of via) addInto(viaAcc.get(l).get(v.fund).amount, v.amount);
        if (!isFund.has(l)) { ultimate.push({ holder: l, holder_group: inv.group, kind: 'investor', direct, indirect, total, via }); addInto(assetUlt, total); }
      }
      // residual of every pass-through fund goes to holders outside the platform
      const extVia = [], ext = zero();
      for (const F of fundLabels) {
        const fund = fundByLabel.get(F), tf = t.get(F);
        addInto(fund.passThrough, tf);
        const amount = scaled(tf, fund.externalShare);
        addInto(fund.externalAmount, amount);
        if (isZero(amount)) continue;
        extVia.push({ fund: F, share: fund.externalShare, amount }); addInto(ext, amount);
      }
      if (extVia.length) ultimate.push({ holder: LT.EXTERNAL_LABEL, holder_group: 'External', kind: 'external', direct: zero(), indirect: ext, total: scaled(ext, 1), via: extVia });
      addInto(assetUlt, ext); addInto(assetExt, ext);
      ultimate.sort((x, y) => y.total.nominal - x.total.nominal || x.holder.localeCompare(y.holder));
      if (ultimate.length) byAsset.set(a.code, ultimate);
      assetTotals.set(a.code, { direct: assetDirect, ultimate: assetUlt, external: assetExt });
      addInto(totals.direct, assetDirect); addInto(totals.ultimate, assetUlt); addInto(totals.external, assetExt);
    }

    // ---------- 6. roll-ups and reconciliation ----------
    for (const m of MEASURES) totals.difference[m] = totals.ultimate[m] - totals.direct[m];
    const scale = Math.max(1, Math.abs(totals.direct.nominal), Math.abs(totals.direct.commitment));
    const reconciles = MEASURES.every((m) => Math.abs(totals.difference[m]) <= 1e-9 * scale + AMOUNT_EPS);
    if (!reconciles) issue('warn', `Look-through does not reconcile: ultimate holders total differs from the direct book by ${U.fmt.amount(totals.difference.nominal)} (nominal)`);
    for (const [l, inv] of byInvestor) {
      inv.viaFunds = Array.from(viaAcc.get(l), ([fund, x]) => ({ fund, share: x.share, amount: x.amount })).sort((a, b) => b.amount.nominal - a.amount.nominal);
      inv.shareOfBook = totals.direct.nominal ? inv.total.nominal / totals.direct.nominal : NaN;
    }
    return { available, funds, fundByLabel, byInvestor, byAsset, assetTotals, totals, reconciles, issues, cycles, maxDepth, truncated, attributionLabel: L };
  }

  /** Elementary cycles reachable in a small directed graph (depth-first; each cycle reported once, rotated to start at its smallest label). */
  function findCycles(nodes, next) {
    const out = [], keys = new Set(), state = new Map(), stack = [];
    const visit = (n) => {
      state.set(n, 1); stack.push(n);
      for (const m of next(n)) {
        if (state.get(m) === 1) {
          const c = stack.slice(stack.indexOf(m));
          const i = c.indexOf(c.slice().sort()[0]), rot = c.slice(i).concat(c.slice(0, i)), k = rot.join('\u0001');
          if (!keys.has(k)) { keys.add(k); out.push(rot); }
        } else if (!state.get(m)) visit(m);
      }
      stack.pop(); state.set(n, 2);
    };
    for (const n of nodes) if (!state.get(n)) visit(n);
    return out;
  }

  // ---------- helpers for pages (keep arithmetic in the engine) ----------

  /** Output-row-shaped record for an asset not on the selected platform (mirrors the AUM engine's row fields). */
  function assetRecord(a, unit) {
    const at = a.attrs || {}, es = a.esg || {}, R = a.rating || null;
    return {
      code: a.code, name: a.name, code_name: a.code_name || '', asset: a,
      total_nominal_m: a.nominal / unit, total_drawn_m: a.drawn / unit, total_commitment_m: a.commitment / unit,
      group_nominal_m: (a.group_nominal || 0) / unit, third_party_nominal_m: (a.third_party_nominal || 0) / unit, group_drawn_m: (a.group_drawn || 0) / unit, third_party_drawn_m: (a.third_party_drawn || 0) / unit,
      group_invested: a.group_invested ? 'Yes' : 'No',
      sector: at.sector || '', subsector: at.subsector || '', country: at.country || '', region: at.region || '', sponsor: at.sponsor || '',
      greenfield_brownfield: at.greenfield_brownfield || '', repayment_type: at.repayment_type || '', instrument: a.instrument_type || '', watchlist: at.watchlist || '',
      wal_years: U.isNum(at.wal_years) ? at.wal_years : NaN, deal_year: at.deal_year, covenant_type: at.covenant_type || '',
      currency: a.currency, fixed_floating: a.fixed_floating, margin_bps: a.margin_bps, coupon: a.coupon, funding_date: a.funding_date, maturity_date: a.maturity_date,
      initial_tenor: a.initial_tenor, remaining_years: a.remaining_years, maturity_bucket: a.maturity_bucket,
      rating: R ? R.current_grade : '', rating_numeric: R ? R.current_numeric : NaN, ig_label: R ? R.ig_label : '', rating_status: R ? R.status : '',
      internal_grade: R ? R.internal : '', external_grade: R ? R.external_grade : '',
      esg_score: U.isNum(es.esg_score) ? es.esg_score : NaN, green_loan: es.green_loan || '', cbi_taxonomy: es.cbi_taxonomy || '', sfdr_article: es.sfdr_article || '',
      ghg_scope12_t: (U.isNum(es.ghg_scope1_t) ? es.ghg_scope1_t : 0) + (U.isNum(es.ghg_scope2_t) ? es.ghg_scope2_t : 0),
      flags: a.flags || [],
    };
  }

  /**
   * One Output-shaped row per asset in which `label` has exposure under `mode` ('direct' | 'lookthrough' | 'total').
   * exposure_m / drawn_m / commitment_m / undrawn_m carry the mode amount (millions); direct_m, indirect_m, total_m
   * (nominal) and via_text are added for holdings tables. Asset attributes come from res.rows when the asset is on the
   * selected platform, otherwise from the asset itself.
   */
  LT.investorRows = function (res, lt, label, mode) {
    const inv = lt && lt.byInvestor.get(label);
    if (!inv) return [];
    const unit = (res.config && res.config.unit) || 1e6, key = LT.modeKey(mode);
    const rowByCode = new Map((res.rows || []).map((r) => [r.code, r]));
    const assetByCode = new Map((res.assets || []).map((a) => [a.code, a]));
    const out = [];
    for (const [code, pa] of inv.perAsset) {
      const v = pa[key];
      if (isZero(v)) continue;
      const a = assetByCode.get(code);
      if (!a) continue;
      const base = rowByCode.has(code) ? Object.assign({}, rowByCode.get(code)) : assetRecord(a, unit);
      const cell = a.byInvestor && a.byInvestor.get(label);
      out.push(Object.assign(base, {
        exposure_m: v.nominal / unit, drawn_m: v.drawn / unit, commitment_m: v.commitment / unit, undrawn_m: (v.nominal - v.drawn) / unit, drawn_pct: v.nominal ? v.drawn / v.nominal : NaN,
        direct_m: pa.direct.nominal / unit, indirect_m: pa.indirect.nominal / unit, total_m: pa.total.nominal / unit,
        direct_drawn_m: pa.direct.drawn / unit, indirect_drawn_m: pa.indirect.drawn / unit, lt_total_drawn_m: pa.total.drawn / unit,
        via: pa.via, via_text: pa.via.map((x) => `${x.fund} (${pct(x.share)})`).join(', '),
        positions: key === 'indirect' ? 0 : (cell ? cell.positions : 0),
      }));
    }
    return out.sort((x, y) => y.exposure_m - x.exposure_m);
  };

  /** Exposure-weighted metrics and distributions of an investor under a mode, via the AUM engine's summarise(). */
  LT.summariseInvestor = function (res, lt, label, mode) {
    const rows = LT.investorRows(res, lt, label, mode);
    const AUM = Scope.engine && Scope.engine.aum;
    const s = AUM && AUM.summarise ? AUM.summarise(rows, res.ratingScale || [], res.config || { buckets: [], attribution_label: 'Group' }) : { metrics: {}, distributions: {} };
    return { rows, metrics: s.metrics, distributions: s.distributions };
  };

  /** Platforms whose composition includes `label` (or every investor via "*"), with the summed weight. */
  LT.platformsOf = function (res, label) {
    const out = [];
    for (const p of res.platforms || []) {
      let w = 0, all = false;
      for (const c of p.composition || []) if (c.label === label || c.label === '*') { w += U.isNum(c.weight) ? c.weight : 1; if (c.label === '*') all = true; }
      if (w) out.push({ id: p.id, label: p.label, weight: w, all });
    }
    return out;
  };

  /** Contribution of `label`'s direct column to the selected platform: weight × direct ÷ platform total (full units). */
  LT.platformShare = function (res, label, measure) {
    const m = measure || 'nominal', pid = res.platformId, pl = res.platform || { composition: [] };
    let weight = 0;
    for (const c of pl.composition || []) if (c.label === '*' || c.label === label) weight += U.isNum(c.weight) ? c.weight : 1;
    let direct = 0, platformTotal = 0;
    for (const a of res.assets || []) {
      const c = a.byInvestor && a.byInvestor.get(label); if (c) direct += c[m] || 0;
      const pv = a.platform && a.platform[pid]; if (pv) platformTotal += pv[m] || 0;
    }
    const contribution = weight * direct;
    return { platform: pl, weight, direct, contribution, platformTotal, share: platformTotal ? contribution / platformTotal : NaN };
  };

  /** Unit holders of a fund with amounts = share × the fund's amount under `mode`, plus the external residual row. */
  LT.unitHolderRows = function (lt, fundLabel, mode) {
    const fund = lt && lt.fundByLabel.get(fundLabel), inv = lt && lt.byInvestor.get(fundLabel);
    if (!fund || !inv) return [];
    const base = inv[LT.modeKey(mode)];
    const rows = fund.holders.map((x) => Object.assign({ kind: 'holder' }, x, scaled(base, x.share)));
    rows.push(Object.assign({ kind: 'external', holder_label: LT.EXTERNAL_LABEL, share: fund.externalShare, holder_group: 'External', group_weight: 0, note: 'not listed in ' + LT.TABLE }, scaled(base, fund.externalShare)));
    return rows;
  };

  /**
   * Investor × {direct, indirect, total} for one measure over a set of asset codes (null = all assets), plus the
   * reconciliation: Σ ultimate holders (pass-through funds excluded) + external = Σ direct columns.
   * Returns { rows:[{label, key, group, role, isFund, direct, indirect, total}], external, direct, ultimate, difference, ok } in full units.
   */
  LT.reconcile = function (lt, codes, measure) {
    const m = measure || 'nominal';
    const inScope = codes ? new Set(codes) : null;
    const rows = [];
    for (const inv of lt.byInvestor.values()) {
      let d = 0, i = 0;
      for (const [code, pa] of inv.perAsset) if (!inScope || inScope.has(code)) { d += pa.direct[m]; i += pa.indirect[m]; }
      if (Math.abs(d) < AMOUNT_EPS && Math.abs(i) < AMOUNT_EPS && !inv.isInvestorColumn) continue;
      rows.push({ label: inv.label, key: inv.key, group: inv.group, isFund: inv.isFund, role: inv.isFund ? 'Pass-through fund' : 'Ultimate holder', direct: d, indirect: i, total: d + i });
    }
    let direct = 0, ultimate = 0, external = 0;
    for (const [code, t] of lt.assetTotals) if (!inScope || inScope.has(code)) { direct += t.direct[m]; ultimate += t.ultimate[m]; external += t.external[m]; }
    const difference = ultimate - direct;
    return { rows, external, direct, ultimate, holders: ultimate - external, difference, ok: Math.abs(difference) <= 1e-9 * Math.max(1, Math.abs(direct)) + AMOUNT_EPS };
  };
})(typeof window !== 'undefined' ? window : globalThis);
