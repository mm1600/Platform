/* Scope engine: Ask Scope, questions in plain words answered from the loaded data.
 *
 * Pure: no DOM, runs in Node. Nothing leaves the browser: there is no model and no server. A question is read with a
 * vocabulary built from the data itself (every sector, country, sponsor, rating, investor, asset name and code name in
 * the result, and every field label) and a fixed list of words for measures and groupings. It is then answered by the
 * same pivot as the Explorer (js/analysis/pivot.js) over the same records (js/analysis/dataset.js), so every figure
 * ties to the AUM page. What was understood is returned with the answer, part by part, so a misread can be seen and
 * dropped.
 *
 *   Scope.engine.ask.parse(res, text, prev) → query { intent, measure, groupBy, filters, having, top, followUp, notes, … }
 *   Scope.engine.ask.run(res, query, ctx)   → answer { kind, sentence, read, table, actions, suggest, query }
 *   Scope.engine.ask.answer(res, text, prev, ctx) = run(res, parse(res, text, prev), ctx)
 *   Scope.engine.ask.examples(res)          → example questions made from the data loaded
 *
 * kind: value | breakdown | list | asset | help | define | issues | shared | none.
 * Filters inside a question use the dataset's filter shape { field, op, value } (op in | notIn | gte | lte | gt | lt |
 * between), so the same filters can open the Explorer or become filters on every page. A threshold on an amount or an
 * average ("assets over 100m", "margin above 250 bps") is a `having`: it is tested per asset, then keeps that asset's rows.
 * The answer is for the view, currency and page filters in force (res is store.result()).
 */
(function (global) {
  'use strict';
  const Scope = global.Scope || (global.Scope = {});
  const U = Scope.util;
  const E = (Scope.engine = Scope.engine || {});
  const ASK = (E.ask = {});

  // ---------- words ----------
  /** Lower case, accents and punctuation removed, "&" as "and"; "+" and "-" kept (ratings such as BBB- and BB+). */
  const norm = (s) => String(s === null || s === undefined ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[’']/g, '')
    .replace(/(\d),(\d{3})/g, '$1$2')             // 1,000 → 1000
    .replace(/([a-z0-9])-(?=[a-z0-9])/g, '$1 ')   // sub-ig, 0-3 → words; a trailing minus (BBB-) stays
    .replace(/\.(?!\d)/g, ' ')                    // full stops, but not decimals
    .replace(/[^a-z0-9+\-.%]+/g, ' ').replace(/(^|\s)[+\-]+(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
  const has = (q, re) => re.test(q);
  // Words that never name a value on their own (a single-word value equal to one of these is not matched).
  const STOP = new Set('a an the no yes y n other others unknown none mixed fund funds loan loans asset assets deal deals data total all group investor investors new not stated portfolio mandate sector sectors country countries rating ratings margin by in of on for and or to with is are be what which how who where when show list me my our we us than more less over under above below top most least energy north south east west green high low'.split(' '));
  // Words said for a place, a grade or a group, rewritten to the value the data uses.
  const REWRITE = [
    [/\b(sub|non|below) ?(investment grade|ig)\b|\bhigh yield\b|\bhy\b|\bjunk\b/g, ' sub ig '], [/\binvestment grade\b/g, ' ig '],
    [/\b(uk|britain|great britain|british|england|english)\b/g, ' united kingdom '], [/\b(usa|u s|america|american)\b(?! ?dollars?)/g, ' united states '],
    [/\bgerman\b/g, ' germany '], [/\bfrench\b/g, ' france '], [/\bitalian\b/g, ' italy '], [/\bspanish\b/g, ' spain '], [/\bdutch|holland\b/g, ' netherlands '],
    [/\birish\b/g, ' ireland '], [/\bswiss\b/g, ' switzerland '], [/\bswedish\b/g, ' sweden '], [/\bfinnish\b/g, ' finland '], [/\bbelgian\b/g, ' belgium '],
    [/\bportuguese\b/g, ' portugal '], [/\baustralian\b/g, ' australia '], [/\bnorwegian\b/g, ' norway '], [/\bdanish\b/g, ' denmark '], [/\bpolish\b/g, ' poland '], [/\baustrian\b/g, ' austria '],
    [/\b(euros?)\b/g, ' eur '], [/\b(pounds?|sterling)\b/g, ' gbp '], [/\b(us )?dollars?\b/g, ' usd '], [/\bfrancs?\b/g, ' chf '],
    [/\bfloating rate|floaters?\b/g, ' floating '], [/\bfixed rate\b/g, ' fixed '], [/\bamortizing|amortisation|amortization\b/g, ' amortising '],
    [/\bintensive care\b/g, ' intensive '], [/\bsingle name\b/g, ' asset '],
  ];
  const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20 };

  // Measures: field id, words (longest first wins), the kind of figure.
  const MEASURES = [
    { id: 'exposure_drawn', words: ['drawn exposure', 'exposure drawn'], kind: 'sum' },
    { id: 'undrawn', words: ['undrawn', 'unfunded', 'dry powder', 'still to draw', 'to be drawn', 'remaining commitment', 'unused'], kind: 'sum' },
    { id: 'drawn', words: ['drawn', 'drawdown', 'drawdowns', 'utilised', 'utilized', 'funded amount'], kind: 'sum' },
    { id: 'commitment', words: ['commitments', 'commitment', 'committed'], kind: 'sum' },
    { id: 'attributed', words: ['attributed', 'group share', 'our share', 'own share'], kind: 'sum' },
    { id: 'third_party', words: ['third party', 'third parties', '3rd party', 'other investors', 'external investors'], kind: 'sum' },
    { id: 'total_transaction_size', words: ['transaction size', 'deal size', 'size of the deal', 'facility size'], kind: 'sum' },
    { id: 'nominal', words: ['nominal', 'notional', 'total book', 'whole book', 'gross'], kind: 'sum' },
    { id: 'margin_bps', words: ['margin', 'margins', 'spread', 'spreads', 'pricing', 'bps'], kind: 'avg' },
    { id: 'coupon', words: ['coupon', 'coupons', 'interest rate', 'yield'], kind: 'avg' },
    { id: 'wal_years', words: ['weighted average life', 'average life', 'wal'], kind: 'avg' },
    { id: 'remaining_years', words: ['remaining life', 'remaining term', 'remaining years', 'time to maturity', 'years to maturity', 'residual maturity', 'residual life'], kind: 'avg' },
    { id: 'initial_tenor', words: ['initial tenor', 'original tenor', 'tenor', 'tenors'], kind: 'avg' },
    { id: 'rating_numeric', words: ['average rating', 'weighted rating', 'weighted average rating', 'credit quality', 'average grade'], kind: 'avg' },
    { id: 'esg_score', words: ['esg score', 'esg scores'], kind: 'avg' },
    { id: 'ghg_scope3_t', words: ['scope 3'], kind: 'sum' },
    { id: 'ghg_scope12_t', words: ['scope 1 and 2', 'scope 12', 'scope 1', 'ghg', 'emissions', 'carbon', 'co2', 'greenhouse'], kind: 'sum' },
    { id: 'upfront_fee_bps', words: ['upfront fee', 'upfront fees', 'arrangement fee', 'fees', 'fee'], kind: 'avg' },
    { id: 'exposure', words: ['exposure', 'exposures', 'aum', 'invested', 'investment', 'amount', 'how much', 'outstanding', 'holdings', 'holding', 'book'], kind: 'sum' },
  ];
  // Groupings: what can follow "by", "per", "top 5 …", "which …". Field id → words.
  const GROUPS = [
    ['investor_group', ['investor groups', 'investor group', 'investor type', 'investor types']],
    ['subsector', ['subsectors', 'subsector', 'sub sectors', 'sub sector', 'technologies', 'technology', 'segments of the market']],
    ['sector', ['sectors', 'sector', 'industries', 'industry']],
    ['country', ['countries', 'country', 'jurisdictions', 'jurisdiction', 'geography', 'where']],
    ['region', ['regions', 'region', 'geographies']],
    ['sponsor', ['sponsors', 'sponsor', 'owners', 'owner', 'shareholders']],
    ['currency', ['currencies', 'currency', 'ccy']],
    ['ig_label', ['ig split', 'ig or sub ig', 'ig sub ig', 'ig']],
    ['rating', ['ratings', 'rating', 'grades', 'grade', 'credit quality']],
    ['investor_label', ['investors', 'investor', 'holders', 'holder', 'clients', 'client', 'who']],
    ['fixed_floating', ['fixed or floating', 'fixed floating', 'fixed vs floating', 'rate type', 'interest type']],
    ['repayment_type', ['repayment type', 'repayment profile', 'repayment', 'amortisation profile']],
    ['instrument', ['instruments', 'instrument', 'instrument type']],
    ['maturity_year', ['maturity year', 'year of maturity', 'maturity years', 'year']],
    ['maturity_bucket', ['maturity buckets', 'maturity bucket', 'maturity profile', 'maturities', 'maturity', 'tenor bucket', 'buckets']],
    ['deal_year', ['deal year', 'vintages', 'vintage', 'year signed']],
    ['funding_year', ['funding year', 'year funded']],
    ['deal_lead', ['deal leads', 'deal lead', 'leads', 'deal team', 'analysts', 'analyst', 'bankers', 'banker']],
    ['watchlist', ['watchlist status', 'watchlist', 'watch list']],
    ['size_band', ['size band', 'size bands', 'ticket size']],
    ['spread_band', ['margin band', 'margin bands', 'spread band']],
    ['wal_band', ['wal band', 'wal bands']],
    ['remaining_years_band', ['remaining years band', 'remaining life band']],
    ['tranche', ['tranches', 'tranche']],
    ['sfdr_article', ['sfdr article', 'sfdr']], ['cbi_taxonomy', ['cbi taxonomy', 'taxonomy']], ['green_loan', ['green loan', 'green loans']],
    ['greenfield_brownfield', ['greenfield or brownfield', 'greenfield', 'brownfield']], ['covenant_compliance', ['covenant compliance', 'covenants', 'covenant']],
    ['cash_flow_type', ['cash flow type', 'cash flow profile']], ['origination', ['origination', 'originator']],
    ['asset_name', ['assets', 'asset', 'deals', 'deal', 'loans', 'loan', 'names', 'name', 'transactions', 'transaction', 'projects', 'project', 'companies', 'borrowers', 'borrower']],
  ];
  const ENTITY = /\b(assets?|deals?|loans?|names?|transactions?|projects?|companies|borrowers?|positions?|holdings?)\b/;
  // Value fields matched by name anywhere in a question (from the unfiltered data).
  const VALUE_FIELDS = ['asset_name', 'code_name', 'asset_code', 'investor_label', 'sector', 'subsector', 'country', 'region', 'sponsor', 'currency', 'rating', 'ig_label', 'investor_group', 'fixed_floating',
    'repayment_type', 'instrument', 'watchlist', 'deal_lead', 'cbi_taxonomy', 'sfdr_article', 'greenfield_brownfield', 'green_loan', 'covenant_compliance', 'cash_flow_type', 'origination'];
  const ASSET_FIELDS = new Set(['asset_name', 'code_name', 'asset_code']);

  // Short definitions of Scope's terms (what each figure is, as the calculation computes it).
  const DEFINE = [
    [['exposure', 'aum'], 'Exposure', 'Each position\'s nominal times the weight the selected view gives its investor. The view is the Output!G8 choice in the top bar. Amounts are in the display currency.'],
    [['nominal', 'notional'], 'Nominal', 'The position\'s amount for all investors, before any view weight, in the display currency.'],
    [['drawn'], 'Drawn', 'The amount drawn so far. Undrawn is nominal minus drawn.'], [['undrawn'], 'Undrawn', 'Nominal minus drawn: what is committed but not yet drawn.'],
    [['commitment'], 'Commitment', 'The committed amount from Holdings, in the display currency.'],
    [['attributed'], 'Attributed', 'Nominal times the attribution weight of each investor (its group ownership). Other investors are nominal minus attributed.'],
    [['margin', 'spread'], 'Margin', 'The margin in basis points, weighted by exposure across the positions asked about.'],
    [['wal', 'weighted average life', 'average life'], 'WAL', 'Weighted average life in years: the asset\'s WAL from the input sheets, weighted by exposure.'],
    [['tenor', 'initial tenor'], 'Initial tenor', 'Years from the funding date to the maturity date, weighted by exposure.'],
    [['remaining life', 'remaining years', 'time to maturity'], 'Remaining years', 'Years from the reporting date to the maturity date, weighted by exposure. The maturity bucket is set from these years.'],
    [['rating', 'grade', 'current grade'], 'Rating', 'The internal grade when there is one, otherwise the external grade. An average rating weights the grade\'s number on the rating scale by exposure, over rated positions only.'],
    [['ig', 'sub ig', 'investment grade'], 'IG / Sub-IG', 'IG means rated at or above the investment-grade threshold of the rating scale. Sub IG means rated below it, and NR means not rated.'],
    [['view', 'platform'], 'View', 'Which investor columns count, and with what weight: the Output!G8 choice. Change it with View in the top bar.'],
    [['look through', 'lookthrough'], 'Look-through', 'Narrows every page to one investor in the view, or one of its segments, through the page filters.'],
    [['reporting date'], 'Reporting date', 'The earliest position date in Holdings (the workbook rule), shown in the top bar.'],
    [['maturity bucket', 'bucket'], 'Maturity bucket', 'Remaining years grouped by the bucket edges in the calculation settings (for example 0-3 y and 3-5 y).'],
    [['watchlist', 'watch list'], 'Watchlist', 'The asset\'s watchlist status from Hardcoded: No, Watch or Intensive.'],
    [['excluded', 'exclusion'], 'Excluded positions', 'Positions the calculation could not value, such as an unmapped security. They are left out of AUM and listed on Data › Issues.'],
  ];

  // Where things are done in Scope: words → page.
  const HELP = [
    [['load', 'upload', 'import', 'workbook', 'new month', 'monthly update', 'holdings file', 'update holdings', 'drop'], 'Load or update the workbook', 'Drop the workbook, or a new month\'s Holdings, on Data & validation › Setup. The previous Holdings is kept for one step of undo.', 'data', 'setup'],
    [['unmapped', 'mapping row', 'add mapping', 'mapping gap', 'security mapping', 'new security'], 'Close a mapping gap', 'Data & validation › Setup lists every unmapped security, with a form to add its Mapping row without leaving Scope.', 'data', 'setup'],
    [['issue', 'issues', 'error', 'errors', 'warning', 'warnings', 'problem', 'problems'], 'See the data issues', 'Data & validation › Issues lists every error (the position is left out), warning (kept, but flagged) and note.', 'data', 'issues'],
    [['correct', 'correction', 'override', 'change a value', 'fix a value', 'edit a value', 'wrong value'], 'Correct a value', 'Open the asset and correct the field there, giving a reason. Every correction is listed, and can be reverted, on Data & validation › Corrections.', 'data', 'corrections'],
    [['check', 'tie out', 'tieout', 'reconcile', 'compare with the workbook', 'match the workbook'], 'Check Scope against the workbook', 'Data & validation › Check my data compares Scope with the workbook\'s own Output and Calculations tabs.', 'data', 'tieout'],
    [['column', 'columns', 'which column', 'header'], 'Choose which columns are read', 'Data & validation › Columns shows which column of each sheet is read for each role, and lets you pick another.', 'data', 'columns'],
    [['fx', 'fx quote', 'exchange rate', 'rates', 'view', 'views', 'investor column', 'weights'], 'Views, investors and FX', 'Data & validation › Views & investors shows the views, the investors in each, and how the FX rates are quoted.', 'data', 'views'],
    [['formula', 'formulas', 'calculated', 'calculation', 'how is'], 'How the figures are calculated', 'Data & validation › Formulas lists each calculation step with the workbook cell it reproduces.', 'data', 'formulas'],
    [['setting', 'settings', 'parameter', 'parameters', 'bucket edges', 'threshold'], 'Calculation settings', 'Data & validation › Settings holds the parameters of the calculation.', 'data', 'settings'],
    [['share', 'shared folder', 'save a version', 'version', 'versions', 'history', 'restore', 'refresh', 'team', 'colleague', 'merge'], 'Share with the team', 'The Shared folder page keeps one copy for the team. Save a version, Refresh when someone else saves, and use History to view or restore any version.', 'shared', ''],
    [['pivot', 'cross tab', 'crosstab', 'explore', 'export csv', 'csv'], 'Slice the data', 'The Explorer pivots any field by any other and downloads the result as CSV.', 'explorer', ''],
    [['custom sheet', 'my own sheet', 'xlsx', 'excel', 'download a sheet', 'own columns'], 'Make your own sheet', 'Custom sheets lets you pick any columns, give them your own headings and download them as .xlsx or CSV.', 'sheets', ''],
    [['report', 'investor report', 'quarterly', 'pack', 'powerpoint', 'pptx', 'deck', 'slides', 'template'], 'Make the investor report', 'Investor reporting builds the quarterly PowerPoint pack on your own template, for the selected view.', 'reporting', ''],
    [['design', 'layout', 'slide layout', 'designer'], 'Change the pack layout', 'The Pack designer arranges what goes on each slide of the pack.', 'designer', ''],
    [['concentration', 'limit', 'limits', 'single name', 'largest exposures', 'risk'], 'Concentration and limits', 'Concentration & risk shows the largest names, sectors and countries against their limits.', 'concentration', ''],
    [['esg', 'sfdr', 'taxonomy', 'emissions', 'ghg'], 'ESG', 'The ESG page shows scores, emissions and coverage from the ESG Hardcoded sheet.', 'esg', ''],
    [['write up', 'writeup', 'write ups', 'commentary', 'notes on an asset'], 'Asset write-ups', 'Asset write-ups holds the commentary for each asset used in the report.', 'writeups', ''],
    [['filter', 'filters', 'narrow', 'only show'], 'Filter every page', 'Use the filter row under the top bar, or the Asset and Name pickers. A filter applies to every page, export and report. Press / to search.', 'aum', ''],
    [['investor book', 'per investor', 'investors page'], 'The investor book', 'The Investor book shows each investor\'s positions in the view.', 'investors', ''],
    [['output sheet'], 'The Output sheet', 'The Output sheet page rebuilds the workbook\'s Output tab, row by row.', 'output', ''],
    [['calculations sheet'], 'The Calculations sheet', 'The Calculations sheet page rebuilds the workbook\'s Calculations tab.', 'calculations', ''],
  ];

  // ---------- vocabulary from the data ----------
  const memo = new WeakMap();
  /** Phrases (normalised) → { field, value }, from the unfiltered result; plus field labels for "by <label>". */
  function vocab(res) {
    const base = res.base || res;
    if (memo.has(base)) return memo.get(base);
    const DS = E.dataset, ds = DS.build(base), fb = ds.fieldById;
    const byPhrase = new Map(), firstWord = new Map();
    const add = (phrase, field, value) => {
      const p = norm(phrase); if (!p || p.length < 2 && !/^[a-z]$/.test(p)) return;
      if (STOP.has(p) && !(field === 'rating' && p === 'a')) return;
      const list = byPhrase.get(p) || []; if (!list.some((x) => x.field === field && x.value === value)) list.push({ field, value }); byPhrase.set(p, list);
    };
    for (const id of VALUE_FIELDS) {
      const f = fb[id]; if (!f) continue;
      const seen = new Set();
      for (const r of ds.records) { const v = f.get(r); if (v === '' || v === null || v === undefined) continue; const s = String(v); if (seen.has(s)) continue; seen.add(s); }
      for (const s of seen) {
        if (id === 'ig_label' && s === 'NR') continue;
        add(s, id, s);
        const n = norm(s);
        if (!ASSET_FIELDS.has(id) && id !== 'investor_label' && id !== 'rating' && id !== 'currency') { if (/s$/.test(n)) add(n.replace(/s$/, ''), id, s); else if (/[a-z]$/.test(n)) add(n + 's', id, s); }
        const w = n.split(' ');
        const part = (k) => { if (k.length < 4 || STOP.has(k) || /^\d/.test(k)) return; const x = firstWord.get(k) || []; if (!x.some((y) => y.field === id && y.value === s)) x.push({ field: id, value: s }); firstWord.set(k, x); };
        if (w.length > 1 && id !== 'investor_label') { part(w[0]); if (!ASSET_FIELDS.has(id)) part(w[w.length - 1]); }
      }
    }
    // the first word of a name (or the last, for a sector or the like) stands for it when it names nothing else ("solar" for "Solar PV")
    for (const [k, list] of firstWord) if (list.length === 1 && !byPhrase.has(k)) byPhrase.set(k, list);
    const phrases = Array.from(byPhrase.keys()).sort((a, b) => b.length - a.length);
    // dimension labels for "by <label>" (named fields and every raw column)
    const dimLabels = ds.fields.filter((f) => f.kind === 'dimension').map((f) => ({ id: f.id, p: norm(f.label) })).filter((x) => x.p.length >= 3).sort((a, b) => b.p.length - a.p.length);
    const assetsByCode = new Map(); for (const a of base.assets || []) assetsByCode.set(String(a.code), a);
    const platforms = (base.platforms || []).map((p) => ({ id: p.id, label: p.label, p: norm(p.label) })).filter((p) => p.p.split(' ').length > 1 || p.p.length > 5);
    const out = { byPhrase, phrases, dimLabels, fieldById: fb, assetsByCode, platforms };
    memo.set(base, out);
    return out;
  }

  // ---------- reading a question ----------
  /** Find each phrase of the vocabulary in `q`, longest first, without overlaps. Returns [{ field, value, at, len, negated }]. */
  function findValues(V, q, original) {
    const padded = ' ' + q + ' ', taken = new Array(padded.length).fill(false), found = [];
    for (const p of V.phrases) {
      let from = 0;
      for (;;) {
        const i = padded.indexOf(' ' + p + ' ', from); if (i < 0) break; from = i + 1;
        const s = i + 1, e = s + p.length; let clash = false; for (let k = s; k < e; k++) if (taken[k]) { clash = true; break; }
        if (clash) continue;
        // a one-letter grade ("A") only when written as a capital, so "a" the word is never read as a rating
        if (p.length === 1 && !new RegExp('(^|[^A-Za-z])' + p.toUpperCase() + '(?![A-Za-z+\\-])').test(original)) continue;
        for (let k = s; k < e; k++) taken[k] = true;
        const before = padded.slice(Math.max(0, s - 24), s);
        const negated = /\b(not|excluding|exclude|except|ex|outside|without|other than|apart from|besides|non)\s+(the\s+|in\s+|from\s+)?$/.test(before);
        for (const m of V.byPhrase.get(p)) found.push({ field: m.field, value: m.value, at: s, len: p.length, negated, phrase: p });
      }
    }
    // blank out what was matched so its words are not read again as measures or groupings
    let rest = ''; for (let k = 0; k < padded.length; k++) rest += taken[k] ? ' ' : padded[k];
    return { found, rest: rest.replace(/\s+/g, ' ').trim() };
  }
  /** The first of `list` ([id, words] or { id, words }) whose word appears in q; returns { id, word, at }. */
  function firstOf(list, q) {
    let best = null;
    for (const item of list) {
      const id = item.id || item[0], words = item.words || item[1];
      for (const w of words) { const m = new RegExp('(^|\\s)' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=\\s|$|\\?)').exec(q); if (m && (!best || m.index < best.at || (m.index === best.at && w.length > best.word.length))) best = { id, word: w, at: m.index }; }
    }
    return best;
  }
  const groupOf = (q) => firstOf(GROUPS, q);
  /** "by sector", "per country", "split by rating", "sector breakdown", "for each sponsor" → field id (or a raw column by its label). */
  function readGroupBy(V, q) {
    const m = /\b(?:by|per|for each|for every|across|split by|broken down by|breakdown by|grouped by|group by|each)\s+(?:the\s+|their\s+|its\s+)?(.+)$/.exec(q);
    if (m) {
      const tail = m[1];
      const g = groupOf(tail); if (g && g.at === 0 && g.word !== 'where' && g.word !== 'who') return g.id;
      for (const d of V.dimLabels) if (tail === d.p || tail.startsWith(d.p + ' ')) return d.id;
    }
    const b = /\b([a-z ]+?)\s+(?:breakdown|split|mix|distribution|profile|allocation|exposure split)\b/.exec(q);
    if (b) { const g = groupOf(b[1].split(' ').slice(-3).join(' ')); if (g && g.id !== 'asset_name' && g.word !== 'where') return g.id; }
    return null;
  }

  /**
   * Read a question into a query. `prev` is the previous query: a short follow-up ("and France?", "by sponsor", "only
   * floating") keeps what it does not change.
   */
  ASK.parse = function (res, text, prev) {
    const original = String(text || '').trim();
    let q = ' ' + norm(original) + ' ';
    for (const [re, to] of REWRITE) q = q.replace(re, to);
    if (/\bUS\b/.test(original)) q = q.replace(/\bus\b(?! ?dollars?)/g, ' united states '); // "US" in capitals is the country; "us" the pronoun ("show us")
    q = q.replace(/\s+/g, ' ').trim();
    const V = vocab(res);
    const query = { text: original, intent: null, measure: null, groupBy: null, filters: [], having: [], top: null, followUp: false, notes: [] };
    if (!q) { query.intent = 'none'; return query; }

    // named views ("Region A") are a choice in the top bar, not a filter
    for (const p of V.platforms) if ((' ' + q + ' ').includes(' ' + p.p + ' ') && !V.byPhrase.has(p.p)) { if (p.id !== res.platformId) query.view = { id: p.id, label: p.label }; q = (' ' + q + ' ').replace(' ' + p.p + ' ', ' ').trim(); }

    const { found, rest } = findValues(V, q, original);
    let r = ' ' + rest + ' ';

    // years: "in 2028", "before 2030", "between 2028 and 2031", "next 3 years"
    const yearField = /\b(deal|signed|closed|vintages?|originated|origination)\b/.test(q) ? 'deal_year' : /\b(funded|funding|drawn in)\b/.test(q) ? 'funding_year' : 'maturity_year';
    const repYear = res.reportingDate instanceof Date && !isNaN(res.reportingDate) ? res.reportingDate.getUTCFullYear() : null;
    const yr = (x) => String(x);
    let m;
    if ((m = /\bbetween (\d{4}) and (\d{4})\b/.exec(r))) { query.filters.push({ field: yearField, op: 'between', value: [yr(m[1]), yr(m[2])] }); r = r.replace(m[0], ' '); }
    if ((m = /\b(?:in the |within the |over the )?(?:next|coming|within) (\d+|one|two|three|four|five|six|seven|eight|nine|ten) years?\b/.exec(r))) { const n = NUMBER_WORDS[m[1]] || +m[1]; query.filters.push({ field: 'remaining_years', op: 'between', value: [0, n] }); r = r.replace(m[0], ' '); }
    if ((m = /\b(this|next) year\b/.exec(r)) && repYear) { query.filters.push({ field: yearField, op: 'in', value: [yr(repYear + (m[1] === 'next' ? 1 : 0))] }); r = r.replace(m[0], ' '); }
    for (const re of [/\b(before|by|until|till|up to|prior to|no later than|earlier than) (19\d\d|20\d\d|21\d\d)\b/g, /\b(after|since|from|beyond|later than|onwards from|post) (19\d\d|20\d\d|21\d\d)\b/g, /\b(in|during|for|of|year) (19\d\d|20\d\d|21\d\d)\b/g, /(?:^|\s)(19\d\d|20\d\d|21\d\d)(?=\s|$)/g]) {
      r = r.replace(re, (all, a, b) => {
        const yearOnly = typeof b !== 'string', word = yearOnly ? 'in' : a, y = yearOnly ? a : b; // a bare year: one group, so b is the match offset
        const op = /^(before|prior to|earlier than)$/.test(word) ? 'lt' : /^(by|until|till|up to|no later than)$/.test(word) ? 'lte' : /^(after|beyond|later than|post)$/.test(word) ? 'gt' : /^(since|from|onwards from)$/.test(word) ? 'gte' : 'in';
        const ex = query.filters.find((f) => f.field === yearField && f.op === 'in' && op === 'in');
        if (ex) ex.value.push(yr(y)); else query.filters.push({ field: yearField, op, value: op === 'in' ? [yr(y)] : yr(y) });
        return ' ';
      });
    }

    // thresholds: "margin above 250 bps" (read before top / bottom: "at least" and "at most" are comparators, not "least" / "most"), "over 100m", "WAL of more than 10 years", "exposure below 1bn"
    const CMP = '(above|over|more than|greater than|bigger than|larger than|higher than|at least|exceeding|in excess of|>=|>|below|under|less than|lower than|smaller than|at most|up to|<=|<)';
    const UNIT = '(m|mn|mm|million|millions|bn|billion|billions|k|thousand|bps|bp|basis points|%|percent|per cent|y|yr|yrs|years?)?';
    const cmpRe = new RegExp('(?:\\b([a-z][a-z0-9 ]*?)\\s+(?:is |of |at |was )?)?' + CMP + '\\s+(-?\\d+(?:[.,]\\d+)?)\\s*' + UNIT + '(?=\\s|$|\\?)', 'g');
    r = r.replace(cmpRe, (all, lead, cmp, num, unit) => {
      const n = +String(num).replace(',', '.');
      if (!unit && /^(19|20|21)\d\d$/.test(num)) return all; // a year, read above
      const u = (unit || '').replace(/s$/, '');
      const leadM = lead ? firstOf(MEASURES, lead.trim().split(' ').slice(-4).join(' ')) : null;
      let id = leadM ? leadM.id : null;
      if (!id) id = /^(bp|basis point)$/.test(u) ? 'margin_bps' : /^(y|yr|year)$/.test(u) ? (/\b(matur|tenor|remaining)/.test(q) ? 'remaining_years' : 'wal_years') : 'exposure';
      const mdef = MEASURES.find((x) => x.id === id);
      let value = n;
      if (mdef.kind === 'sum' && !/^ghg/.test(id)) value = n * ({ m: 1e6, mn: 1e6, mm: 1e6, million: 1e6, bn: 1e9, billion: 1e9, k: 1e3, thousand: 1e3 }[u] || (res.config && res.config.unit) || 1e6);
      if (id === 'margin_bps' && /^(%|percent|per cent)$/.test(u)) value = n * 100;
      const op = /^(above|over|more than|greater than|bigger than|larger than|higher than|exceeding|in excess of|>)$/.test(cmp) ? 'gt' : /^(at least|>=)$/.test(cmp) ? 'gte' : /^(at most|up to|<=)$/.test(cmp) ? 'lte' : 'lt';
      query.having.push({ field: id, op, value, text: `${cmp} ${num}${unit ? (/^[%a-z]{1,3}$/.test(unit) ? '' : ' ') + unit : ''}` });
      return leadM ? ' ' + lead.replace(leadM.word, ' ') + ' ' : ' ';
    });

    // top / bottom
    const NUM = '(\\d+|' + Object.keys(NUMBER_WORDS).join('|') + ')';
    if ((m = new RegExp('\\b(top|largest|biggest|highest|most|main|key|leading|bottom|smallest|lowest|least|fewest|tightest|widest)\\s*' + NUM + '?\\b').exec(r))) {
      const dir = /^(bottom|smallest|lowest|least|fewest|tightest)$/.test(m[1]) ? 'asc' : 'desc';
      let n = m[2] ? (NUMBER_WORDS[m[2]] || +m[2]) : 0;
      if (!n) { const after = r.slice(m.index + m[0].length); const plural = /^\s*(\w+\s+)?(assets|deals|loans|names|sectors|countries|sponsors|investors|regions|currencies|ratings|exposures|positions|transactions|projects|borrowers|subsectors|leads|holders)\b/.test(after) || /\b(top|bottom)\b/.test(m[1]); n = plural ? 10 : 1; }
      query.top = { n: Math.min(100, Math.max(1, n)), dir, word: m[1] };
      r = r.replace(m[0], ' ');
    }

    // watchlist words
    if (/\b(on (the )?watch ?list|watch ?listed|on watch|flagged)\b/.test(r) && !found.some((f) => f.field === 'watchlist')) {
      const fb = V.fieldById.watchlist; if (fb) { const vals = ['Watch', 'Intensive']; query.filters.push({ field: 'watchlist', op: 'in', value: vals }); r = r.replace(/\b(on (the )?watch ?list|watch ?listed|on watch|flagged)\b/, ' '); }
    }

    // values found by name: values of one field together; "not in Germany" excludes
    const byField = new Map();
    for (const f of found) { const k = f.field + (f.negated ? '!' : ''); if (!byField.has(k)) byField.set(k, { field: f.field, op: f.negated ? 'notIn' : 'in', value: [] }); const x = byField.get(k); if (!x.value.includes(f.value)) x.value.push(f.value); }
    // an asset named by its code name and by its name is one asset
    const assetCodes = new Set();
    for (const f of byField.values()) {
      if (ASSET_FIELDS.has(f.field) && f.op === 'in') { for (const v of f.value) for (const a of V.assetsByCode.values()) if ((f.field === 'asset_code' && String(a.code) === v) || (f.field === 'asset_name' && a.name === v) || (f.field === 'code_name' && a.code_name === v)) assetCodes.add(String(a.code)); continue; }
      query.filters.push(f);
    }
    if (assetCodes.size) query.filters.push({ field: 'asset_code', op: 'in', value: Array.from(assetCodes) });

    // measure, grouping and intent from what is left
    const measure = firstOf(MEASURES, r.trim());
    const countM = ((m = /\b([a-z]+) count\b/.exec(r)) && groupOf(m[1]) ? [m[0], 'count', m[1]] : null) || /\b(how many|number of|count of|count|no of)\b\s*(?:the\s+)?([a-z]+(?:\s[a-z]+)?)?/.exec(r);
    if (countM) {
      const what = countM[2] || '';
      const g = groupOf(what);
      query.measure = /^(positions?|holdings?|lines?)\b/.test(what) ? 'positions' : g && g.id === 'investor_label' ? 'investors' : g && g.id !== 'asset_name' ? 'count:' + g.id : 'assets';
    } else if (measure) query.measure = measure.id;
    if (/\b(average|avg|mean|weighted)\s+rating\b|\brating\b.*\b(average|overall)\b/.test(r)) query.measure = 'rating_numeric';
    const groupBy = readGroupBy(V, r.trim());
    if (groupBy) query.groupBy = groupBy;

    query.listWord = ENTITY.test(r) || /\b(list|show|name) (them|these|those|it|the names)\b/.test(r);
    const wantsList = (/\b(which|list|show|name|what|give|find|tell|any)\b/.test(r) && ENTITY.test(r)) || /^(assets?|deals?|loans?|names?|projects?|transactions?|borrowers?)\b/.test(q) || /\b(list|show|name) (them|these|those|it|the names)\b/.test(r);
    const who = /\bwho\b/.test(r) && /\b(invested|holds?|holding|owns?|own|in it|exposed|participat|lend|lenders?|investors?)\b/.test(r);
    const whoSponsor = /\bwho\b.*\b(sponsors?|owns? the|behind)\b/.test(r);
    const where = /\bwhere\b/.test(r) && /\b(most|highest|largest|biggest|concentrat|exposed|invested|lend|lent|exposure)\b/.test(r);
    const bare = /^(what is|whats|what are|what s|what)\s+(an?\s+)?(.+?)\??$/.exec(q);
    const define = (/\b(what does .* mean|meaning of|define|definition|explain|what is meant by|how is .* (calculated|computed|worked out|defined|measured))\b/.test(q) || !!(bare && DEFINE.some((d) => d[0].includes(bare[3])))) && !query.filters.length && !query.groupBy && !query.top && !query.having.length;
    const help = /\b(how (do|can|should|would) (i|we|you)|where (do|can|should) (i|we)|where is the|where are the|how to|i want to|i need to|help me|can i|is there a way)\b/.test(q);
    const issues = /\b(issues?|errors?|warnings?|problems?|unmapped|data quality|excluded|exclusions?)\b/.test(q) && !query.measure && !query.groupBy;
    const shared = /\b(who saved|last saved|saved last|latest version|which version|shared folder|version history|who changed|last change|last update|out of date|up to date)\b/.test(q);

    if (/^(help|hi|hello|hey|what can (you|i) (do|ask)|what do you do|how does this work|examples?)\b/.test(q) && !query.filters.length) query.intent = 'intro';
    else if (shared) query.intent = 'shared';
    else if (issues && !help) query.intent = 'issues';
    else if (define && !help) query.intent = 'define';
    else if (help && !query.filters.length && !query.measure) query.intent = 'help';
    else {
      if (who && !query.groupBy) query.groupBy = 'investor_label';
      if (whoSponsor && !query.groupBy) query.groupBy = 'sponsor';
      if (where && !query.groupBy) query.groupBy = 'country';
      // "top 5 countries", "which sector has the most", "largest sponsor"
      if (!query.groupBy && (query.top || /\b(which|what)\b/.test(r))) { const g = groupOf(r.trim()); if (g && g.word !== 'where' && g.word !== 'who' && g.id !== 'maturity_year' && g.id !== 'asset_name') query.groupBy = g.id; }
      if (query.groupBy === 'asset_name' || query.groupBy === 'code_name') { query.groupBy = null; query.intent = 'list'; }
      else if (query.groupBy) query.intent = 'breakdown';
      else if (wantsList || (query.top && (ENTITY.test(r) || !query.measure || MEASURES.find((x) => x.id === query.measure).kind === 'avg'))) query.intent = 'list';
      else if (assetCodes.size === 1 && !query.measure && query.filters.length === 1) query.intent = 'asset';
      else if (!query.top && query.filters.some((f) => f.op === 'in' && Array.isArray(f.value) && f.value.length > 1 && !/_year$/.test(f.field) && f.field !== 'watchlist')) { const f = query.filters.find((x) => x.op === 'in' && Array.isArray(x.value) && x.value.length > 1 && !/_year$/.test(x.field) && x.field !== 'watchlist'); query.groupBy = f.field === 'asset_code' ? 'asset_name' : f.field; query.intent = 'breakdown'; }
      else if (query.measure || query.filters.length || query.having.length || query.top) query.intent = 'value';
    }

    // a follow-up keeps the last question's measure, grouping and filters, and changes only what it names
    const short = q.split(' ').length <= 5, ownMeasure = !!(measure || countM);
    const followWord = /^(and|what about|how about|same for|same but|now|only|just|also|instead|but|then|ok|okay|plus|with|without|excluding|except|for|in)\b/.test(q);
    if (prev && prev.intent && !['help', 'define', 'issues', 'shared', 'none', 'intro'].includes(prev.intent) && (followWord || (short && !ownMeasure)) && !['help', 'define', 'issues', 'shared', 'intro'].includes(query.intent)) {
      const merged = JSON.parse(JSON.stringify(prev));
      merged.text = original; merged.followUp = true; merged.notes = [];
      const also = /\b(also|as well|too|plus)\b/.test(q);
      for (const f of query.filters) {
        const same = merged.filters.findIndex((x) => x.field === f.field && x.op === f.op);
        if (same >= 0 && also && f.op === 'in' && Array.isArray(merged.filters[same].value)) merged.filters[same].value = Array.from(new Set(merged.filters[same].value.concat(f.value)));
        else { merged.filters = merged.filters.filter((x) => x.field !== f.field); merged.filters.push(f); }
      }
      for (const hv of query.having) { merged.having = merged.having.filter((x) => x.field !== hv.field); merged.having.push(hv); }
      if (query.measure) merged.measure = query.measure;
      if (query.top) merged.top = query.top;
      if (query.groupBy) { merged.groupBy = query.groupBy; merged.intent = 'breakdown'; }
      if (query.intent === 'list' && query.listWord) { merged.intent = 'list'; merged.groupBy = null; }
      if (merged.intent === 'value' && query.top && !query.groupBy) merged.intent = 'list';
      if (merged.intent === 'asset' && (query.measure || query.groupBy)) merged.intent = query.groupBy ? 'breakdown' : 'value';
      if (query.view) merged.view = query.view;
      return merged;
    }
    if (!query.intent) query.intent = 'none';
    return query;
  };

  // ---------- answering ----------
  const fmtNum = (v, d) => (U.isNum(v) ? v.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–');
  /** Rating scale number → nearest grade (S&P / Fitch scale when there is one). */
  function gradeOf(res, n) {
    if (!U.isNum(n)) return 'NR';
    const scale = (res.ratingScale || []).filter((s) => /s&p|fitch/i.test(s.scale || '')); const list = scale.length ? scale : res.ratingScale || [];
    let best = null; for (const s of list) if (U.isNum(s.numeric) && s.numeric > 0 && (!best || Math.abs(s.numeric - n) < Math.abs(best.numeric - n))) best = s;
    return best ? best.grade : 'NR';
  }
  /** Format one measure value for text: amounts as "EUR 1,234.5m", averages with their own unit. */
  function fmtMeasure(res, ds, id, v) {
    const ccy = res.displayCurrency || 'EUR', unit = (res.config && res.config.unit) || 1e6;
    if (id === 'assets' || id === 'positions' || id === 'investors' || /^count:/.test(id)) return fmtNum(v, 0);
    if (id === 'rating_numeric') return gradeOf(res, v);
    if (/^ghg/.test(id)) return U.isNum(v) ? fmtNum(v, 0) + ' t' : '–';
    const f = ds.fieldById[id];
    if (f && f.kind === 'measure' && f.unit === unit && f.unitLabel) return U.isNum(v) ? `${ccy} ${fmtNum(v / unit, 1)}m` : '–';
    return f ? f.format(v) : fmtNum(v, 1);
  }
  /** Label of a measure. */
  function measureLabel(ds, id) {
    if (id === 'assets') return 'Assets'; if (id === 'positions') return 'Positions'; if (id === 'investors') return 'Investors';
    if (/^count:/.test(id)) { const f = ds.fieldById[id.slice(6)]; return 'Number of ' + plural(f ? f.label.toLowerCase() : id.slice(6)); }
    if (id === 'rating_numeric') return 'Average rating';
    const f = ds.fieldById[id]; return f ? f.label : id;
  }
  /** "country" → "countries", "sector" → "sectors". */
  const plural = (w) => (/[^aeiou]y$/.test(w) ? w.slice(0, -1) + 'ies' : /(s|x|ch|sh)$/.test(w) ? w + 'es' : w + 's');
  /** A measure's label for a sentence: "Margin (bps)" → "Margin" (the value carries its unit). */
  const said = (ds, id) => measureLabel(ds, id).replace(/\s*\((bps|years|%|t)\)$/i, '');
  const isAvg = (id) => { const m = MEASURES.find((x) => x.id === id); return !!(m && m.kind === 'avg'); };
  /** Field + agg for the pivot; an ad-hoc distinct count for "how many sponsors". */
  function valueSpec(ds, id) {
    if (/^count:/.test(id)) { const f = ds.fieldById[id.slice(6)]; return { field: { id, label: measureLabel(ds, id), kind: 'measure', type: 'number', agg: 'countDistinct', get: (r) => (f ? f.get(r) : ''), distinctKey: (r) => (f ? f.get(r) : '') }, agg: 'countDistinct' }; }
    const f = ds.fieldById[id]; return { field: f, agg: f ? f.agg : 'sum' };
  }
  /** One filter in words: "Country: Germany, France", "Maturity year before 2030", "Margin (bps) over 250 bps (per asset)". */
  function describe(ds, f) {
    const fl = ds.fieldById[f.field], label = f.field === 'asset_code' ? 'Asset' : fl ? fl.label : f.field;
    const vals = Array.isArray(f.value) ? f.value : [f.value];
    const names = f.field === 'asset_code' ? vals.map((c) => { const a = (ds.records.find((r) => r.asset_code === c) || {})._asset; return a ? a.name : c; }) : vals;
    const list = names.length > 4 ? names.slice(0, 4).join(', ') + ` +${names.length - 4}` : names.join(', ');
    if (f.op === 'in') return { k: label, v: list }; if (f.op === 'notIn') return { k: label, v: 'not ' + list };
    if (f.field === 'remaining_years' && f.op === 'between') return { k: 'Maturity', v: `within ${vals[1]} years` };
    if (f.op === 'between') return { k: label, v: `${vals[0]} to ${vals[1]}` };
    return { k: label, v: ({ lt: 'before ', lte: 'up to ', gt: 'after ', gte: 'from ' }[f.op] || f.op + ' ') + vals[0] };
  }
  /** "in Germany", "for Fund 1", "rated BBB-", "maturing before 2030": the filters as a phrase for the sentence. */
  function phrase(ds, filters, having) {
    const parts = [];
    const rank = (f) => (f.op === 'notIn' ? 9 : f.field === 'asset_code' ? 0 : f.field === 'country' || f.field === 'region' ? 1 : /sector$/.test(f.field) ? 2 : 3); // place, then sector, then the rest; exclusions last
    for (const f of filters.slice().sort((a, b) => rank(a) - rank(b))) {
      const d = describe(ds, f), not = f.op === 'notIn', v = not ? d.v.replace(/^not /, '') : d.v;
      if (f.field === 'country' || f.field === 'region') parts.push((not ? 'outside ' : 'in ') + v);
      else if (f.field === 'investor_label') parts.push((not ? 'excluding ' : 'held by ') + v);
      else if (f.field === 'sponsor') parts.push((not ? 'not sponsored by ' : 'sponsored by ') + v);
      else if (f.field === 'rating') parts.push((not ? 'not rated ' : 'rated ') + v);
      else if (f.field === 'ig_label') parts.push((not ? 'not rated ' : 'rated ') + v.replace('SUB IG', 'sub-IG'));
      else if (f.field === 'fixed_floating') parts.push((not ? 'not at ' : 'at ') + v.toLowerCase() + ' rates');
      else if (f.field === 'repayment_type') parts.push((not ? 'not ' : '') + v.toLowerCase());
      else if (f.field === 'remaining_years') parts.push('maturing within ' + (Array.isArray(f.value) ? f.value[1] : f.value) + ' years');
      else if (f.field === 'asset_code') parts.push((not ? 'excluding ' : 'in ') + v);
      else if (/_year$/.test(f.field)) parts.push((f.field === 'maturity_year' ? 'maturing ' : f.field === 'deal_year' ? 'signed ' : 'funded ') + (f.op === 'in' ? 'in ' : f.op === 'between' ? 'from ' : '') + d.v);
      else if (f.field === 'watchlist') parts.push((not ? 'not ' : '') + 'on the watchlist (' + v + ')');
      else parts.push((not ? 'excluding ' : 'in ') + v);
    }
    for (const hv of having) parts.push(`with ${said(ds, hv.field).toLowerCase()} ${hv.text}`);
    if (parts.length < 2) return parts.join('');
    const last = parts[parts.length - 1];
    return parts.slice(0, -1).join(', ') + (/^(excluding|outside|not )/.test(last) ? ', ' : ' and ') + last;
  }
  /** base64url of UTF-8 JSON, as the Explorer reads its #/explorer/v/<token> links. */
  function token(obj) {
    const s = JSON.stringify(obj);
    if (typeof Buffer !== 'undefined' && typeof btoa === 'undefined') return Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const bytes = new TextEncoder().encode(s); let bin = ''; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  const href = (id, ...params) => '#/' + [id].concat(params).map(encodeURIComponent).join('/');

  /** The records a query covers: not excluded, its filters, then the per-asset thresholds. */
  function recordsFor(ds, query) {
    const P = Scope.pivot;
    let recs = P.applyFilters(ds.records, ds.fieldById, [{ field: 'excluded', op: 'in', value: ['No'] }].concat(query.filters.filter((f) => ds.fieldById[f.field])));
    let passing = null;
    if (query.having.length) {
      const byAsset = new Map(); for (const r of recs) { if (!byAsset.has(r.asset_code)) byAsset.set(r.asset_code, []); byAsset.get(r.asset_code).push(r); }
      passing = [];
      for (const [code, rs] of byAsset) {
        const ok = query.having.every((hv) => { const s = valueSpec(ds, hv.field); const v = P.aggregate(rs, s.field, s.agg, ds.fieldById); if (!U.isNum(v)) return false; return hv.op === 'gt' ? v > hv.value : hv.op === 'gte' ? v >= hv.value : hv.op === 'lt' ? v < hv.value : v <= hv.value; });
        if (ok) passing.push(code);
      }
      const keep = new Set(passing); recs = recs.filter((r) => keep.has(r.asset_code));
    }
    return { recs, passing };
  }
  /** The filters that reproduce a query elsewhere (page filters, the Explorer): a threshold becomes the list of assets it kept. */
  function portableFilters(query, passing) {
    const out = query.filters.map((f) => ({ field: f.field, op: f.op, value: f.value }));
    if (passing) out.push({ field: 'asset_code', op: 'in', value: passing.slice() });
    return out;
  }

  /** Answer a query (from parse). ctx: { shared } with the shared-folder status when one is connected. */
  ASK.run = function (res, query, ctx) {
    const c = ctx || {}, DS = E.dataset, P = Scope.pivot;
    const ds = DS.build(res), V = vocab(res);
    const view = (res.platform && res.platform.label) || 'the view', ccy = res.displayCurrency || 'EUR';
    const pageFilters = (res.globalFilters || []).length;
    const out = { kind: query.intent, query, read: [], actions: [], suggest: [], table: null, sentence: '', headline: '' };
    const scopeNote = `${view} · ${ccy}${pageFilters ? ` · ${pageFilters} page filter${pageFilters === 1 ? '' : 's'}` : ''}`;
    if (query.view) { out.actions.push({ kind: 'view', label: `Switch the view to ${query.view.label}`, platform: query.view.id, primary: true }); out.note = `This is for the view in force, ${view}. ${query.view.label} is a view: switch to it to see its figures.`; }

    if (query.intent === 'intro') {
      out.kind = 'help'; out.headline = 'What you can ask';
      out.sentence = 'Ask about the loaded data in your own words: a figure (exposure, drawn, margin, WAL, rating, emissions), split by anything (sector, country, sponsor, investor, rating, maturity), narrowed by any value or threshold, or a list of assets. You can also ask where something is done in Scope, or what a term means. Short follow-ups such as "and France?" or "by sponsor" build on the last answer.';
      out.suggest = ASK.examples(res).slice(0, 6);
      return out;
    }
    if (query.intent === 'help' || query.intent === 'define') {
      const q = ' ' + norm(query.text) + ' ';
      if (query.intent === 'define') {
        let best = null; for (const d of DEFINE) for (const w of d[0]) if (q.includes(' ' + w + ' ') && (!best || w.length > best.w.length)) best = { w, d };
        if (best) { out.headline = best.d[1]; out.sentence = best.d[2]; out.suggest = [`${best.d[1].toLowerCase()} by sector`, 'how is exposure calculated']; return out; }
      }
      const scored = HELP.map((t) => ({ t, s: t[0].reduce((n, w) => n + (q.includes(' ' + w + ' ') || q.includes(' ' + w + 's ') ? w.split(' ').length + 1 : 0), 0) })).filter((x) => x.s).sort((a, b) => b.s - a.s).slice(0, 3);
      if (!scored.length) { out.kind = 'none'; out.sentence = 'I could not find that in Scope\'s help. Try naming what you want to do, for example "load a new month" or "make the investor report".'; out.suggest = ASK.examples(res).slice(0, 4); return out; }
      out.kind = 'help';
      out.headline = scored[0].t[1]; out.sentence = scored[0].t[2];
      for (const x of scored) out.actions.push({ kind: 'link', label: x === scored[0] ? `Open ${x.t[1].toLowerCase().replace(/^(see|open) /, '')}` : x.t[1], href: href(x.t[3], ...(x.t[4] ? [x.t[4]] : [])), sub: x === scored[0] ? '' : x.t[2] });
      out.actions[0].label = 'Go there'; out.actions[0].primary = true;
      return out;
    }

    if (query.intent === 'issues') {
      const n = res.issueCounts || {}, total = (n.error || 0) + (n.warn || 0) + (n.info || 0);
      const excl = (res.base || res).excludedPositions || [];
      out.headline = total ? `${n.error || 0} errors · ${n.warn || 0} warnings · ${n.info || 0} notes` : 'No data issues';
      out.sentence = total ? `Errors leave a position out of AUM${excl.length ? ` (${excl.length} position${excl.length === 1 ? '' : 's'} left out now)` : ''}, and warnings keep it but flag it.` : 'Every position was read and valued.';
      const groups = new Map();
      for (const i of res.issues || []) { const k = i.severity + '|' + String(i.message).replace(/\d[\d,.]*/g, '#').replace(/\(.*?\)/g, '').slice(0, 90); const g = groups.get(k) || { sev: i.severity, msg: i.message, n: 0 }; g.n++; groups.set(k, g); }
      const order = { error: 0, warn: 1, info: 2 };
      const rows = Array.from(groups.values()).sort((a, b) => order[a.sev] - order[b.sev] || b.n - a.n);
      if (rows.length) out.table = { columns: [{ label: 'Kind' }, { label: 'Example' }, { label: 'Count', num: true }], rows: rows.slice(0, 12).map((g) => [g.sev === 'warn' ? 'Warning' : g.sev === 'error' ? 'Error' : 'Note', g.msg, fmtNum(g.n, 0)]), more: Math.max(0, rows.length - 12) };
      out.actions.push({ kind: 'link', label: 'Open Data › Issues', href: href('data', 'issues'), primary: true });
      if ((res.issues || []).some((i) => i.kind === 'unmapped_security')) out.actions.push({ kind: 'link', label: 'Add the missing Mapping rows', href: href('data', 'setup') });
      return out;
    }

    if (query.intent === 'shared') {
      const st = c.shared;
      if (!st || !st.connected) { out.headline = 'No shared folder'; out.sentence = 'This browser is not using a shared folder, so changes stay here. The Shared folder page sets one up.'; out.actions.push({ kind: 'link', label: 'Open the Shared folder page', href: href('shared'), primary: true }); return out; }
      const hd = st.head;
      out.headline = hd ? `Version ${hd.v}` : 'Nothing saved yet';
      out.sentence = hd ? `Latest version ${hd.v} was saved by ${hd.by || 'someone'} at ${String(hd.at || '').replace('T', ' ').slice(0, 16)}${hd.note ? `: "${hd.note}"` : ''}. ` + (st.behind ? `You have version ${st.version}: Refresh to bring in the newer one.` : st.version ? 'You are on it.' : '') + (st.unsaved ? ` You have ${st.unsaved} unsaved change${st.unsaved === 1 ? '' : 's'}.` : '') : 'The folder is connected but has no version yet.';
      out.actions.push({ kind: 'link', label: 'Open the history', href: href('shared', 'history'), primary: true });
      return out;
    }

    if (query.intent === 'none') {
      out.sentence = 'I did not understand that question. Try naming a figure (exposure, margin, WAL, rating), a group (by sector, by country), or an asset, investor or country.';
      // words close to something in the data
      const words = norm(query.text).split(' ').filter((w) => w.length >= 3 && !STOP.has(w));
      const near = []; for (const p of V.phrases) { if (near.length >= 6) break; if (words.some((w) => p.split(' ').some((x) => x.startsWith(w) || (w.length >= 5 && x.startsWith(w.slice(0, 4)))))) { const m = V.byPhrase.get(p)[0]; const lbl = m.field === 'asset_code' ? null : m.value; if (lbl && !near.includes(lbl)) near.push(lbl); } }
      out.suggest = near.length ? near.map((v) => `exposure in ${v}`) : ASK.examples(res).slice(0, 4);
      return out;
    }

    // ---------- figures ----------
    const measure = query.measure || 'exposure';
    const { recs, passing } = recordsFor(ds, query);
    const spec = valueSpec(ds, measure);
    if (!spec.field) { out.kind = 'none'; out.sentence = `${measure} is not in this data.`; return out; }
    out.read.push({ k: 'Figure', v: measureLabel(ds, measure) + (isAvg(measure) ? ' (exposure-weighted)' : ''), part: 'measure' });
    query.filters.forEach((f, i) => out.read.push(Object.assign(describe(ds, f), { part: 'filter:' + i })));
    query.having.forEach((hv, i) => out.read.push({ k: measureLabel(ds, hv.field), v: hv.text + ' (per asset)', part: 'having:' + i }));
    if (query.groupBy) out.read.push({ k: 'By', v: (ds.fieldById[query.groupBy] || { label: query.groupBy }).label, part: 'groupBy' });
    if (query.top) out.read.push({ k: query.top.dir === 'asc' ? 'Smallest' : 'Top', v: String(query.top.n), part: 'top' });
    out.read.push({ k: 'In', v: scopeNote, part: null });
    if (query.followUp) out.read.unshift({ k: 'Follow-up', v: 'on your last question', part: null });

    const where = phrase(ds, query.filters, query.having);
    const filtersOut = portableFilters(query, passing);
    const allRecs = P.applyFilters(ds.records, ds.fieldById, [{ field: 'excluded', op: 'in', value: ['No'] }]);
    const totalExp = P.aggregate(allRecs, 'exposure', 'sum', ds.fieldById);
    const exp = P.aggregate(recs, 'exposure', 'sum', ds.fieldById);
    const nAssets = P.aggregate(recs, 'assets', 'countDistinct', ds.fieldById);
    const explorer = (rowDims, extra) => ({ kind: 'link', label: 'Open in Explorer', href: href('explorer', 'v', token({ t: 'pivot', p: Object.assign({ source: 'positions', rowDims, colDims: [], values: [{ field: /^count:/.test(measure) ? 'assets' : measure, agg: /^count:/.test(measure) ? 'countDistinct' : spec.agg, showAs: 'value' }], filters: [{ field: 'excluded', op: 'in', value: ['No'] }].concat(filtersOut), sort: { by: 'value', valueIndex: 0, dir: 'desc' }, topN: null, subtotals: false, grandTotal: true }, extra || {}) })) });
    const filterAction = () => (filtersOut.length ? { kind: 'filter', label: 'Filter every page to this', filters: filtersOut } : null);

    if (!recs.length) {
      out.kind = 'value'; out.headline = 'Nothing matches';
      out.sentence = `Nothing in ${view} is ${where || 'left'}${pageFilters ? ' with the page filters in force' : ''}. Drop a part of the question below to widen it.`;
      return out;
    }

    if (query.intent === 'asset') {
      const code = query.filters.find((f) => f.field === 'asset_code').value[0], a = V.assetsByCode.get(code) || (recs[0] && recs[0]._asset);
      const g = (id) => { const s = valueSpec(ds, id); return P.aggregate(recs, s.field, s.agg, ds.fieldById); };
      const r0 = recs[0];
      out.headline = a ? a.name : code;
      out.sentence = `${a ? a.name : code} (${[a && a.code_name, code].filter(Boolean).join(' · ')}): ${fmtMeasure(res, ds, 'exposure', exp)} exposure in ${view}${totalExp ? `, ${U.fmt.pct(exp / totalExp)} of the view` : ''}.`;
      const rows = [['Sector', [r0.sector, r0.subsector].filter(Boolean).join(' › ')], ['Country', r0.country], ['Sponsor', r0.sponsor], ['Rating', [r0.rating, r0.ig_label].filter(Boolean).join(' · ')],
        ['Exposure', fmtMeasure(res, ds, 'exposure', exp)], ['Drawn', fmtMeasure(res, ds, 'drawn', g('drawn'))], ['Undrawn', fmtMeasure(res, ds, 'undrawn', g('undrawn'))], ['Margin', fmtMeasure(res, ds, 'margin_bps', g('margin_bps'))],
        ['WAL', fmtMeasure(res, ds, 'wal_years', g('wal_years'))], ['Maturity', r0.maturity_date ? `${r0.maturity_date} (${r0.maturity_bucket})` : ''], ['Fixed / floating', r0.fixed_floating], ['Watchlist', r0.watchlist],
        ['Investors in the view', fmtNum(g('investors'), 0)], ['Positions', fmtNum(recs.length, 0)]].filter((x) => x[1] !== '' && x[1] !== undefined && x[1] !== null && x[1] !== '–');
      out.table = { columns: [{ label: 'Field' }, { label: 'Value' }], rows };
      out.actions.push({ kind: 'link', label: 'Open the asset', href: href('asset', code), primary: true }, filterAction());
      out.suggest = ['who holds it', 'by investor', 'what is its margin'];
      out.actions = out.actions.filter(Boolean);
      return out;
    }

    if (query.intent === 'value') {
      const v = P.aggregate(recs, spec.field, spec.agg, ds.fieldById);
      const label = said(ds, measure);
      out.headline = fmtMeasure(res, ds, measure, v);
      if (/^count:|^(assets|positions|investors)$/.test(measure)) { const one = /^count:/.test(measure) ? (ds.fieldById[measure.slice(6)] || { label: '' }).label.toLowerCase() : measure.replace(/s$/, ''); out.sentence = `There ${v === 1 ? 'is' : 'are'} ${out.headline} ${v === 1 ? one : plural(one)}${where ? ' ' + where : ''} in ${view}${measure === 'assets' ? `, with ${fmtMeasure(res, ds, 'exposure', exp)} exposure` : ''}.`; }
      else if (isAvg(measure)) out.sentence = `${label} ${where || 'in ' + view} is ${out.headline}, weighted by exposure over ${fmtNum(nAssets, 0)} asset${nAssets === 1 ? '' : 's'} (${fmtMeasure(res, ds, 'exposure', exp)}).`;
      else out.sentence = `${label} ${where || 'in ' + view} is ${out.headline}` + (measure === 'exposure' ? ` across ${fmtNum(nAssets, 0)} asset${nAssets === 1 ? '' : 's'}${where && totalExp ? `, ${U.fmt.pct(exp / totalExp)} of ${view}` : ''}` : '') + '.';
      if (!U.isNum(v) && !/^count:/.test(measure)) out.sentence = `${label} is not filled in for ${where || 'these positions'}.`;
      out.actions.push(explorer(query.filters.length ? [query.filters[0].field === 'asset_code' ? 'asset_name' : query.filters[0].field] : ['sector']), filterAction());
      out.suggest = ['by sector', 'by country', 'top 5 assets', isAvg(measure) ? 'by rating' : 'by maturity'].filter((s) => !(query.filters[0] && s === 'by ' + query.filters[0].field));
      out.actions = out.actions.filter(Boolean);
      return out;
    }

    if (query.intent === 'breakdown') {
      const g = query.groupBy, gf = ds.fieldById[g];
      if (!gf) { out.kind = 'none'; out.sentence = 'That grouping is not in this data.'; return out; }
      const values = [{ field: spec.field.id, agg: spec.agg }];
      const fb = Object.assign({}, ds.fieldById, { [spec.field.id]: spec.field });
      if (measure !== 'exposure') values.push({ field: 'exposure', agg: 'sum' });
      values.push({ field: 'assets', agg: 'countDistinct' });
      const ordinal = typeof gf.sortRank === 'function' && !query.top && /^(rating|ig_label|maturity_bucket|maturity_year|deal_year|funding_year|watchlist|size_band|spread_band|wal_band|remaining_years_band)$/.test(g);
      const run = P.run({ records: recs, fieldById: fb, rowDims: [g], values, sort: ordinal ? { by: 'label', dir: 'asc' } : { by: 'value', valueIndex: 0, dir: measure === 'rating_numeric' ? 'asc' : 'desc' }, subtotals: false, grandTotal: true });
      let groups = run.rows.filter((r) => r.kind === 'group');
      const nGroups = groups.length;
      // top / smallest: rank on the figure; "the largest" still shows the next four for context
      if (query.top) { const d = query.top.dir === 'asc' ? 1 : -1; groups = groups.slice().sort((x, y) => d * ((U.isNum(x.rowTotal[0]) ? x.rowTotal[0] : -d * Infinity) - (U.isNum(y.rowTotal[0]) ? y.rowTotal[0] : -d * Infinity))).slice(0, query.top.n === 1 ? 5 : query.top.n); }
      const total = run.rows.find((r) => r.kind === 'total');
      const counted = /^count:|^(assets|positions|investors)$/.test(measure), sumLike = !isAvg(measure) && !counted;
      const tv = total ? total.rowTotal[0] : NaN, pct = (v) => (U.isNum(tv) && tv && U.isNum(v) ? U.fmt.pct(v / tv) : '–');
      const cols = [{ label: gf.label }, { label: measureLabel(ds, measure), num: true }];
      if (sumLike) cols.push({ label: 'Share', num: true });
      if (measure !== 'exposure') cols.push({ label: 'Exposure', num: true });
      cols.push({ label: 'Assets', num: true });
      const linkOf = (label) => (g === 'investor_label' && Scope.modules && Scope.modules.get && Scope.modules.get('investor') ? href('investor', label) : null);
      const rows = groups.map((r) => {
        const row = [{ text: r.label, href: linkOf(r.label), filter: r.label === '(blank)' ? null : { field: g, op: 'in', value: [r.label] } }, fmtMeasure(res, ds, measure, r.rowTotal[0])];
        if (sumLike) row.push(pct(r.rowTotal[0]));
        if (measure !== 'exposure') row.push(fmtMeasure(res, ds, 'exposure', r.rowTotal[1]));
        row.push(fmtNum(r.rowTotal[values.length - 1], 0));
        return row;
      });
      const totalRow = total ? ['Total', fmtMeasure(res, ds, measure, tv)].concat(sumLike ? ['100.0%'] : [], measure !== 'exposure' ? [fmtMeasure(res, ds, 'exposure', total.rowTotal[1])] : [], [fmtNum(total.rowTotal[values.length - 1], 0)]) : null;
      out.table = { columns: cols, rows, total: totalRow, more: Math.max(0, nGroups - groups.length), chart: sumLike ? groups.slice(0, 12).map((r) => ({ label: r.label, value: r.rowTotal[0] })) : null };
      // the sentence names the filters other than the grouping's own ("Germany vs France" compares, it does not filter)
      const own = query.filters.find((f) => f.field === g && f.op === 'in' && Array.isArray(f.value) && f.value.length > 1);
      const wOther = phrase(ds, query.filters.filter((f) => f !== own), query.having), w = wOther ? ' ' + wOther : '';
      const lead = groups[0], what = said(ds, measure).toLowerCase(), by = gf.label.toLowerCase();
      if (lead) {
        const valOf = (r) => fmtMeasure(res, ds, measure, r.rowTotal[0]) + (sumLike ? ` (${pct(r.rowTotal[0])})` : '');
        out.headline = `${lead.label}: ${fmtMeasure(res, ds, measure, lead.rowTotal[0])}`;
        if (own && groups.length <= 6) out.sentence = `${said(ds, measure)}${w}: ` + groups.map((r) => `${r.label} ${valOf(r)}`).join(', ') + '.';
        else if (ordinal) { const most = groups.reduce((x, y) => ((y.rowTotal[0] || 0) > (x.rowTotal[0] || 0) ? y : x), lead); out.headline = `Total ${fmtMeasure(res, ds, measure, tv)}`; out.sentence = `${said(ds, measure)} by ${by}${w}, in ${fmtNum(nGroups, 0)} group${nGroups === 1 ? '' : 's'}. The most is in ${most.label}, with ${valOf(most)}.`; }
        else if (isAvg(measure) && !query.top && groups.length > 1) {
          const known = groups.filter((r) => U.isNum(r.rowTotal[0])), hi = known.reduce((x, y) => (y.rowTotal[0] > x.rowTotal[0] ? y : x), known[0]), lo = known.reduce((x, y) => (y.rowTotal[0] < x.rowTotal[0] ? y : x), known[0]);
          const [first, second, a1, a2] = measure === 'rating_numeric' ? [lo, hi, 'best', 'weakest'] : [hi, lo, 'highest', 'lowest'];
          out.headline = `${first.label}: ${fmtMeasure(res, ds, measure, first.rowTotal[0])}`;
          out.sentence = `${said(ds, measure)} by ${by}${w}, weighted by exposure: ${a1} ${first.label} (${fmtMeasure(res, ds, measure, first.rowTotal[0])}), ${a2} ${second.label} (${fmtMeasure(res, ds, measure, second.rowTotal[0])}). Overall ${fmtMeasure(res, ds, measure, tv)}.`;
        }
        else if (query.top && query.top.n === 1) out.sentence = `The ${by} with the ${query.top.dir === 'asc' ? 'least' : 'most'} ${what}${w} is ${lead.label}, with ${valOf(lead)}.`;
        else out.sentence = `${said(ds, measure)} by ${by}${w}: ${query.top ? `${query.top.dir === 'asc' ? 'the smallest' : 'the top'} ${fmtNum(groups.length, 0)} of ${fmtNum(nGroups, 0)}` : `${fmtNum(nGroups, 0)} group${nGroups === 1 ? '' : 's'}`}, ${query.top && query.top.dir === 'asc' ? 'starting with' : 'led by'} ${lead.label} with ${valOf(lead)}.`;
      }
      out.actions.push(explorer([g], query.top ? { topN: { n: query.top.n, valueIndex: 0 } } : null), filterAction());
      out.suggest = ['top 5 assets', g === 'country' ? 'by sector' : 'by country', g === 'rating' ? 'by maturity' : 'by rating', isAvg(measure) ? 'exposure' : 'average margin'];
      out.actions = out.actions.filter(Boolean);
      return out;
    }

    // list of assets
    const sortBy = query.top || isAvg(measure) || measure !== 'exposure' ? measure : 'exposure';
    const byAsset = new Map(); for (const r of recs) { if (!byAsset.has(r.asset_code)) byAsset.set(r.asset_code, []); byAsset.get(r.asset_code).push(r); }
    const sortSpec = valueSpec(ds, /^count:|^(assets|investors)$/.test(sortBy) ? 'exposure' : sortBy);
    const items = Array.from(byAsset, ([code, rs]) => ({ code, rs, a: rs[0]._asset, e: P.aggregate(rs, 'exposure', 'sum', ds.fieldById), v: P.aggregate(rs, sortSpec.field, sortSpec.agg, ds.fieldById) }));
    const dir = query.top && query.top.dir === 'asc' ? 1 : -1;
    items.sort((x, y) => { const a = U.isNum(x.v) ? x.v : -Infinity * dir, b = U.isNum(y.v) ? y.v : -Infinity * dir; return dir * (a - b) || y.e - x.e; });
    const shown = items.slice(0, query.top ? query.top.n : 25);
    const extra = sortSpec.field.id !== 'exposure' && !/^count:|^(assets|investors|positions)$/.test(sortBy);
    const cols = [{ label: 'Asset' }, { label: 'Sector' }, { label: 'Country' }, { label: 'Rating' }, { label: 'Maturity' }, { label: 'Exposure', num: true }];
    if (extra) cols.push({ label: measureLabel(ds, sortSpec.field.id), num: true });
    const maxDate = (rs) => rs.reduce((m, r) => (r.maturity_date && r.maturity_date > m ? r.maturity_date : m), '');
    out.table = { columns: cols, rows: shown.map((x) => { const r0 = x.rs[0]; const row = [{ text: x.a ? x.a.name : x.code, href: href('asset', x.code), sub: x.a ? x.a.code_name : '' }, r0.sector || '', r0.country || '', r0.rating || 'NR', maxDate(x.rs) || '–', fmtMeasure(res, ds, 'exposure', x.e)]; if (extra) row.push(fmtMeasure(res, ds, sortSpec.field.id, x.v)); return row; }), more: Math.max(0, items.length - shown.length) };
    out.kind = 'list';
    out.headline = `${fmtNum(items.length, 0)} asset${items.length === 1 ? '' : 's'}`;
    if (query.top && query.top.n === 1 && shown[0]) { const x = shown[0]; out.headline = x.a ? x.a.name : x.code; out.sentence = `The ${query.top.dir === 'asc' ? 'smallest' : 'largest'} asset${extra ? ' by ' + said(ds, sortSpec.field.id).toLowerCase() : ''}${where ? ' ' + where : ''} in ${view} is ${out.headline}, with ${extra ? fmtMeasure(res, ds, sortSpec.field.id, x.v) + ' and ' : ''}${fmtMeasure(res, ds, 'exposure', x.e)} exposure${totalExp ? ` (${U.fmt.pct(x.e / totalExp)} of the view)` : ''}.`; }
    else out.sentence = (query.top ? `${query.top.dir === 'asc' ? 'Smallest' : 'Top'} ${fmtNum(shown.length, 0)} of ${fmtNum(items.length, 0)} asset${items.length === 1 ? '' : 's'}` : `${fmtNum(items.length, 0)} asset${items.length === 1 ? '' : 's'}`) + (where ? ' ' + where : '') + ` in ${view}, ${fmtMeasure(res, ds, 'exposure', exp)} in all` + (extra ? `, sorted by ${measureLabel(ds, sortSpec.field.id).toLowerCase()}` : ', largest first') + '.';
    out.actions.push(explorer(['asset_name'], query.top ? { topN: { n: query.top.n, valueIndex: 0 } } : null), filterAction());
    out.suggest = ['by sector', 'by country', 'average margin', 'by maturity'];
    out.actions = out.actions.filter(Boolean);
    return out;
  };

  /** Read and answer in one step. */
  ASK.answer = (res, text, prev, ctx) => ASK.run(res, ASK.parse(res, text, prev), ctx);

  /** A query with one part removed (a read chip dropped): 'measure', 'groupBy', 'top', 'filter:<i>', 'having:<i>'. */
  ASK.drop = function (query, part) {
    const q = JSON.parse(JSON.stringify(query)); const [k, i] = String(part).split(':');
    if (k === 'measure') q.measure = null; else if (k === 'groupBy') { q.groupBy = null; if (q.intent === 'breakdown') q.intent = 'value'; }
    else if (k === 'top') q.top = null; else if (k === 'filter') q.filters.splice(+i, 1); else if (k === 'having') q.having.splice(+i, 1);
    if (q.intent === 'asset' && !q.filters.some((f) => f.field === 'asset_code')) q.intent = 'value';
    return q;
  };

  /** Example questions made from the data loaded (its largest country, sector and asset), so they always have an answer. */
  ASK.examples = function (res) {
    const top = (field) => { const d = res.distributions && res.distributions[field]; const x = d && d.find((y) => y.label && y.label !== '(blank)'); return x ? x.label : null; };
    const country = top('country'), sector = top('sector');
    const asset = (res.assets || []).filter((a) => a.positionCount).sort((a, b) => (b.nominal || 0) - (a.nominal || 0))[0];
    const yr = res.reportingDate instanceof Date && !isNaN(res.reportingDate) ? res.reportingDate.getUTCFullYear() + 5 : null;
    return ['What is the total exposure?', country ? `Exposure in ${country} by sector` : 'Exposure by country', 'Top 10 assets by exposure', yr ? `Which assets mature before ${yr}?` : 'Exposure by maturity',
      'Average margin of sub-IG assets', 'How many assets are on the watchlist?', sector ? `Largest sponsors in ${sector}` : 'Largest sponsors', asset ? `Who holds ${asset.name}?` : 'Exposure by investor', 'Any data issues?', 'How do I load a new month?'];
  };
})(typeof window !== 'undefined' ? window : globalThis);
