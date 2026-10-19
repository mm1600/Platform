/* Scope tests · Ask Scope (js/analysis/ask.js): questions in plain words on the demo. Every figure in an answer must be
 * the calculation's own (metrics, distributions, the pivot), each part of a question must be read as written, follow-ups
 * must build on the last answer, and the links must reproduce the answer elsewhere. Runs in the browser and in Node. */
(function (global) {
  'use strict';
  const Scope = global.Scope, T = Scope.tests, ASK = Scope.engine.ask, P = Scope.pivot, DS = Scope.engine.dataset;
  const assert = (c, msg) => { if (!c) throw new Error(msg || 'assertion failed'); };
  const near = (a, b, msg) => assert(Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b)), `${msg || ''} expected ${b}, got ${a}`);
  const eq = (a, b, msg) => { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${msg || ''} expected ${y}, got ${x}`); };
  const res = () => T.demo();
  const parse = (q, prev) => ASK.parse(res(), q, prev);
  const filt = (q) => q.filters.map((f) => `${f.field} ${f.op} ${[].concat(f.value).join(',')}`).sort();
  /** Exposure (full units) of the records a set of filters keeps, as the Explorer and the page filters count it. */
  const exposureOf = (filters) => { const ds = DS.build(res()); return P.aggregate(P.applyFilters(ds.records, ds.fieldById, [{ field: 'excluded', op: 'in', value: ['No'] }].concat(filters)), 'exposure', 'sum', ds.fieldById); };

  T.add('ask: figures are the calculation\'s own (total, a country, a split by sector, the average margin, an asset count)', () => {
    const r = res(), m = r.metrics, unit = r.config.unit;
    const total = ASK.answer(r, 'What is the total exposure?');
    assert(total.kind === 'value' && total.headline === `EUR ${m.total_exposure_m.toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}m`, total.headline);
    const top = r.distributions.country[0];
    const one = ASK.parse(r, `exposure in ${top.label}`); near(exposureOf(one.filters) / unit, top.exposure_m, 'one country');
    const split = ASK.answer(r, 'exposure by sector');
    eq(split.table.rows.map((x) => x[0].text).sort(), r.distributions.sector.map((d) => d.label).sort(), 'every sector');
    for (const d of r.distributions.sector) { const row = split.table.rows.find((x) => x[0].text === d.label); assert(row[1] === `EUR ${d.exposure_m.toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}m`, `${d.label}: ${row[1]}`); }
    eq(ASK.answer(r, 'average margin').headline, `${Math.round(m.w_margin_bps)} bps`, 'exposure-weighted margin');
    eq(ASK.answer(r, 'how many assets').headline, String(m.n_assets), 'asset count');
    eq(ASK.answer(r, 'average rating').headline, m.w_rating_label, 'average rating as a grade');
  });

  T.add('ask: a question is read as written (values from the data, "not", years, thresholds per asset, top N, counts, a view)', () => {
    eq(filt(parse('German exposure excluding offshore wind')), ['country in Germany', 'subsector notIn Offshore wind']);
    eq(filt(parse('exposure to solar')), ['subsector in Solar PV'], 'the first word of a value names it');
    eq(filt(parse('average margin of sub-investment grade assets')), ['ig_label in SUB IG']);
    eq(filt(parse('a loan rated A in the UK')), ['country in United Kingdom', 'rating in A'], '"A" is a grade only as a capital; "a" the word is not');
    eq(filt(parse('which assets mature before 2030')), ['maturity_year lt 2030']);
    eq(filt(parse('exposure maturing between 2030 and 2035')), ['maturity_year between 2030,2035']);
    eq(filt(parse('how many assets are on the watchlist')), ['watchlist in Watch,Intensive']);
    const th = parse('assets with margin above 2.5% and over 100m');
    eq(th.having.map((x) => `${x.field} ${x.op} ${x.value}`), ['margin_bps gt 250', 'exposure gt 100000000'], 'thresholds in their units');
    const a = ASK.run(res(), th);
    for (const row of a.table.rows) { const code = decodeURIComponent(row[0].href.split('/').pop()); const ds = DS.build(res()); const rs = ds.records.filter((x) => x.asset_code === code && x.excluded === 'No'); assert(P.aggregate(rs, 'margin_bps', 'wavg', ds.fieldById) > 250 && P.aggregate(rs, 'exposure', 'sum', ds.fieldById) > 1e8, `${row[0].text} passes both`); }
    const t5 = parse('top 5 deals by margin'); eq([t5.intent, t5.measure, t5.top.n, t5.top.dir], ['list', 'margin_bps', 5, 'desc']);
    const big = parse('biggest country'); eq([big.intent, big.groupBy, big.top.n], ['breakdown', 'country', 1]);
    eq(parse('how many sponsors in Germany').measure, 'count:sponsor');
    const vs = parse('Germany vs France'); eq([vs.intent, vs.groupBy], ['breakdown', 'country'], 'two values of one field are compared');
    const v = parse('exposure in Region A'); assert(v.view && v.view.label === 'Region A' && !v.filters.length, 'a view is offered as a switch, not read as rating A');
    const who = ASK.answer(res(), 'Who holds Aurora Offshore?'); eq([who.kind, who.query.groupBy, who.query.filters[0].field], ['breakdown', 'investor_label', 'asset_code']);
  });

  T.add('ask: follow-ups keep the last question and change only what they name; a part can be dropped', () => {
    const r = res();
    const q1 = parse('Exposure in Germany');
    const q2 = parse('what about France', q1); eq(filt(q2), ['country in France'], 'replaces the country'); assert(q2.followUp);
    const q3 = parse('by sector', q2); eq([q3.intent, q3.groupBy, filt(q3)], ['breakdown', 'sector', ['country in France']]);
    const q4 = parse('only floating', q3); eq(filt(q4), ['country in France', 'fixed_floating in Floating']);
    const q5 = parse('list them', q4); eq(q5.intent, 'list');
    const a5 = ASK.run(r, q5);
    assert(a5.table.rows.every((x) => x[2] === 'France'), 'still France');
    const fresh = parse('how many countries', q4); assert(!fresh.followUp && fresh.measure === 'count:country', 'a full question starts afresh');
    const dropped = ASK.drop(q4, 'filter:0'); eq(filt(dropped), ['fixed_floating in Floating']);
    const a = ASK.run(r, q4), tag = a.read.find((x) => x.k === 'Country'); assert(tag && tag.part === 'filter:0', 'each part is listed with its key');
  });

  T.add('ask: help, terms, data issues, the shared folder, and nothing understood', () => {
    const r = res();
    const hlp = ASK.answer(r, 'How do I load a new month?'); eq([hlp.kind, hlp.actions[0].href], ['help', '#/data/setup']);
    eq(ASK.answer(r, 'where do I change the fx quote').actions[0].href, '#/data/views');
    const wal = ASK.answer(r, 'what is WAL'); eq([wal.kind, wal.headline], ['define', 'WAL']);
    eq(ASK.answer(r, 'what is the WAL in Italy').kind, 'value', 'a figure, not a definition');
    const iss = ASK.answer(r, 'any data issues?'); eq(iss.headline, `${r.issueCounts.error} errors · ${r.issueCounts.warn} warnings · ${r.issueCounts.info} notes`);
    eq(ASK.answer(r, 'who saved last').headline, 'No shared folder');
    const sh = ASK.answer(r, 'who saved last', null, { shared: { connected: true, head: { v: 7, by: 'Sam', at: '2026-11-05T14:05:00Z', note: 'October' }, version: 6, behind: true, unsaved: 2 } });
    assert(sh.headline === 'Version 7' && /Sam/.test(sh.sentence) && /Refresh/.test(sh.sentence) && /2 unsaved/.test(sh.sentence), sh.sentence);
    const none = ASK.answer(r, 'zzqx blorp'); eq(none.kind, 'none'); assert(none.suggest.length > 0, 'suggests something to ask');
    assert(ASK.examples(r).every((q) => ASK.answer(r, q).kind !== 'none'), 'every example has an answer');
  });

  T.add('ask: the links reproduce the answer (Explorer view, filters for every page, asset page)', () => {
    const r = res(), unit = r.config.unit;
    const a = ASK.answer(r, 'exposure in Spain at floating rates over 100m');
    const exp = a.actions.find((x) => /Explorer/.test(x.label)), flt = a.actions.find((x) => x.kind === 'filter');
    const tok = exp.href.split('/').pop(), b64 = tok.replace(/-/g, '+').replace(/_/g, '/');
    const view = JSON.parse(typeof Buffer !== 'undefined' ? Buffer.from(b64, 'base64').toString('utf8') : decodeURIComponent(escape(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)))));
    eq(view.t, 'pivot'); eq(view.p.filters.slice(1), flt.filters, 'the Explorer gets the same filters');
    assert(flt.filters.some((f) => f.field === 'asset_code'), 'a threshold travels as the assets it kept');
    eq(`EUR ${(exposureOf(flt.filters) / unit).toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}m`, a.headline, 'the page filters give the same figure');
    const card = ASK.answer(r, 'AURO01'); eq([card.kind, card.actions[0].href], ['asset', '#/asset/100200']);
  });

  T.add('ask: a bare year, "at least / at most", "us" and "vintages" are read as written', () => {
    eq(filt(parse('exposure maturing 2031')), ['maturity_year in 2031'], 'a bare year is the year, not its place in the text');
    const al = parse('exposure at least 100m'); eq(al.having.map((x) => `${x.field} ${x.op} ${x.value}`), ['exposure gte 100000000']); assert(!al.top, '"at least" is a threshold, not a bottom-N');
    const am = parse('exposure at most 50m in Germany'); eq(am.having.map((x) => `${x.field} ${x.op} ${x.value}`), ['exposure lte 50000000']); eq(filt(am), ['country in Germany']);
    const least = parse('least exposed country'); assert(least.top && least.top.dir === 'asc' && !least.having.length, '"least" on its own is still a bottom-N');
    eq(filt(parse('give us exposure by sector')), [], '"us" the pronoun is no country'); eq(filt(parse('exposure in the US')), ['country in United States'], '"US" in capitals is the country');
    eq(filt(parse('exposure in 2019 vintages')), ['deal_year in 2019']);
  });

})(typeof window !== 'undefined' ? window : globalThis);
