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
 * kind: value | breakdown | list | asset | yesno | change | digest | help | define | issues | shared | none.
 * The write-ups (ctx.writeups: the Asset write-ups workbook, linked to the assets as the asset page links them) feed one
 * asset's answer (description, recent events, ratios against lock-up and covenant), "which assets are in lock-up", "which
 * write-ups mention refinancing" and the digest.
 * Beyond figures: one asset in detail ("when does X mature", "X's rating", "tell me about X"), yes / no ("is X on the
 * watchlist?"), what changed against the month before ("new deals", "what exited", "downgrades", "biggest movers": the page
 * passes that month's result as ctx.previous, see ASK.needsPrevious) and a digest of what deserves a look ("anything I
 * should worry about"). A misspelt name is read as the nearest word of the data ("Sumit" as "Summit"), and said so.
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
  // Other ways of saying what Scope already reads, rewritten to its words (our own list: add a line to teach it a phrase).
  const SAYINGS = [
    [/\b(paid off|paid back|got repaid|been repaid|redeemed|rolled off|came off the book|come off the book|dropped off|fell off|no longer held)\b/g, ' exited '],
    [/\b(new money|fresh deals?|what did we add|what have we added|came onto the book|came on the book|onboarded)\b/g, ' new deals '],
    [/\b(rating cuts?|got cut|cut to|negative rating moves?)\b/g, ' downgrades '],
    [/\b(unutilised|unutilized|available to draw|left to draw)\b/g, ' undrawn '],
    [/\b(credit watch|stressed|distressed|troubled|struggling|in trouble|problem (loans?|deals?|names?|assets?)|bad (loans?|deals?|names?))\b/g, ' which assets are on the watchlist '],
    [/\b(all in spread|credit spread|spread over)\b/g, ' margin '],
    [/\b(equity holders?|equity owners?)\b/g, ' sponsor '],
    [/\b(coming due|due soon|upcoming maturities|refinancing wall|maturity wall|matur\w* soon)\b/g, ' maturing in the next 12 months '],
    [/\b(lowdown on|rundown on|run down on|low down on|the scoop on|info on|details on|what do we know about|whats the story with|whats going on with|what is going on with|update on)\b/g, ' tell me about '],
    [/\b(keeps? (me|you) up at night|pain points?|red flags?|where are the risks|whats wrong with the (book|portfolio)|what looks bad|problem areas?)\b/g, ' anything i should worry about '],
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
    { id: 'remaining_years', words: ['remaining life', 'remaining term', 'remaining years', 'time to maturity', 'years to maturity', 'residual maturity', 'residual life', 'how long left', 'time left', 'years left', 'left to run'], kind: 'avg' },
    { id: 'initial_tenor', words: ['initial tenor', 'original tenor', 'tenor', 'tenors'], kind: 'avg' },
    { id: 'rating_numeric', words: ['average rating', 'weighted rating', 'weighted average rating', 'credit quality', 'average grade'], kind: 'avg' },
    { id: 'esg_score', words: ['esg score', 'esg scores'], kind: 'avg' },
    { id: 'ghg_scope3_t', words: ['scope 3'], kind: 'sum' },
    { id: 'ghg_scope12_t', words: ['scope 1 and 2', 'scope 12', 'scope 1', 'ghg', 'emissions', 'carbon', 'co2', 'greenhouse'], kind: 'sum' },
    { id: 'upfront_fee_bps', words: ['upfront fee', 'upfront fees', 'arrangement fee', 'fees', 'fee'], kind: 'avg' },
    { id: 'exposure', words: ['exposure', 'exposures', 'aum', 'invested', 'investment', 'amount', 'how much', 'how big', 'size of', 'outstanding', 'holdings', 'holding', 'book'], kind: 'sum' },
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
  // One asset's details asked for by name ("when does X mature", "X's rating"): key, words.
  const DETAILS = [
    ['maturity', /\b(matur\w*|expir\w*|end date|final date|when does .* (end|finish|repay))\b/],
    ['rating', /\b(rating|rated|grade|credit quality|credit)\b/],
    ['events', /\b(news|events?|updates?|latest|recent(ly)?|happen\w*|story|commentary|write ?ups?|description|background|what does .* do|business|what is it|whats new|what s new|what is new|new with|anything new|going on)\b/],
    ['sector', /\b(sector|industry|subsector)\b/],
    ['country', /\b(country|where|located|based|jurisdiction)\b/],
    ['sponsor', /\b(sponsors?|owners?|owned|behind|shareholders?)\b/],
    ['watchlist', /\b(watch ?list|on watch)\b/],
    ['rate', /\b(rate type|fixed or floating|fixed|floating)\b/],
    ['lead', /\b(deal lead|analyst|banker|who (looks after|covers|manages|runs|is responsible))\b/],
    ['covenant', /\b(covenants?|ratios?|icr|dscr|llcr|leverage|ltv|gearing|headroom|lock ?ups?)\b/],
    ['esg', /\besg\b/],
    ['currency', /\b(currency|ccy|denominated)\b/],
  ];
  const DETAIL_FIELDS = new Set(['fixed_floating', 'watchlist', 'currency']); // values that, with a detail asked, are the detail not a filter ("is X fixed or floating")
  // The write-ups' ratios asked for by name: key, words in a question, words in a write-up's row label.
  const METRICS = [
    ['icr', /\b(icr|interest cover\w*)\b/, /\bicr\b|interest cover/i],
    ['dscr', /\b(dscr|debt service cover\w*)\b/, /dscr|debt service cover/i],
    ['llcr', /\bllcr\b/, /llcr|loan life/i],
    ['plcr', /\bplcr\b/, /plcr|project life/i],
    ['ltv', /\b(ltv|loan to value)\b/, /ltv|loan to value/i],
    ['gearing', /\bgearing\b/, /gearing/i],
    ['leverage', /\b(leverage|net debt|debt (to |over )?ebitda|nd ebitda)\b/, /leverage|debt\s*\/|debt to ebitda|nd\s*\//i],
    ['headroom', /\b(covenant )?headroom\b/, null],
  ];
  // What changed against the month before: words → which view of the change.
  const CHANGE = [
    ['new', /\b(new (deals?|assets?|names?|loans?|positions?|investments?)|added|onboarded|what came in|first time)\b/],
    ['exited', /\b(exited|exits?|repaid|left the book|dropped out|gone|sold|matured out|what went)\b/],
    ['downgrades', /\b(downgrad\w*|got worse|deteriorat\w*|weaker rating)\b/],
    ['upgrades', /\b(upgrad\w*|improved rating|stronger rating)\b/],
    ['movers', /\b(movers?|moved (the )?most|biggest (changes?|moves?|movements?)|grew|shrank|increased|decreased)\b/],
    ['summary', /\b(what (has )?changed|changes?|since last (month|quarter|time)|vs last|versus last|compared (to|with) (last|the previous|previous)|month on month|previous month|last month)\b/],
  ];
  const DIGEST = /\b(worr\w*|concern\w*|red flags?|watch out|look out|needs? (my )?attention|should i (look at|check|know)|anything (wrong|odd|unusual|i should)|health check|brief me|briefing|sum(mary|marise|marize) (of )?(the )?(book|portfolio)|overview of (the )?(book|portfolio)|state of (the )?(book|portfolio)|how is the (book|portfolio))\b/;
  // Words never corrected as a misspelling (question words and Scope's own terms).
  const COMMON = new Set('about above after again against assets below between biggest change changed changes could deals does exposure final first floating fixed going have holds hold investor investors largest last latest maturing mature matures maturity month months much other since smallest spread their there these thing things those through under until what when where which while worry would years total average rating rated sector sectors country countries sponsor sponsors margin drawn undrawn commitment watchlist names number tell show give list compare versus split before after during inside outside excluding without should anything something summary overview portfolio please thanks thank'.split(' '));

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
    [['share', 'shared folder', 'save a version', 'version', 'versions', 'history', 'restore', 'refresh', 'team', 'colleague', 'merge'], 'Share with the team', 'The Shared folder page keeps the team\'s data in one file in a team folder. Pick the folder once; Scope tells you when someone saves (Get it); Save to team folder shares your changes; Older saves lets you go back.', 'shared', ''],
    [['pivot', 'cross tab', 'crosstab', 'explore', 'export csv', 'csv'], 'Slice the data', 'The Explorer pivots any field by any other and downloads the result as CSV.', 'explorer', ''],
    [['custom sheet', 'my own sheet', 'xlsx', 'excel', 'download a sheet', 'own columns'], 'Make your own sheet', 'Custom sheets lets you pick any columns, give them your own headings and download them as .xlsx or CSV.', 'sheets', ''],
    [['report', 'investor report', 'quarterly', 'pack', 'powerpoint', 'pptx', 'deck', 'slides', 'template'], 'Make the investor report', 'Investor reporting builds the quarterly PowerPoint pack on your own template, for the selected view.', 'reporting', ''],
    [['design', 'layout', 'slide layout', 'designer'], 'Change the pack layout', 'The Pack designer arranges what goes on each slide of the pack.', 'designer', ''],
    [['concentration', 'limit', 'limits', 'single name', 'largest exposures', 'risk'], 'Concentration and limits', 'Concentration & risk shows the largest names, sectors and countries against their limits.', 'concentration', ''],
    [['esg', 'sfdr', 'taxonomy', 'emissions', 'ghg'], 'ESG', 'The ESG page shows scores, emissions and coverage from the ESG Hardcoded sheet.', 'esg', ''],
    [['write up', 'writeup', 'write ups', 'commentary', 'notes on an asset'], 'Asset write-ups', 'Asset write-ups holds the commentary for each asset used in the report.', 'writeups', ''],
    [['group transactions', 'grouped', 'group deals', 'one line', 'transaction group', 'tranches together', 'combine tranches'], 'Show a transaction as one line', 'Group transactions, next to Sets in the filter row, shows each transaction group as one line on the page you are on; the master switch for every page is at the top of the Asset picker. Totals do not change.', 'aum', ''],
    [['filter', 'filters', 'narrow', 'only show'], 'Filter every page', 'Use the filter row under the top bar, or the Asset and Name pickers. A filter applies to every page, export and report. Press / to search.', 'aum', ''],
    [['investor book', 'per investor', 'investors page'], 'The investor book', 'The Investor book shows each investor\'s positions in the view.', 'investors', ''],
    [['output sheet'], 'The Output sheet', 'The Output sheet page rebuilds the workbook\'s Output tab, row by row.', 'output', ''],
    [['calculations sheet'], 'The Calculations sheet', 'Explorer › Calculations sheet rebuilds the workbook\'s Calculations tab; Explorer › Holdings sheet shows the Holdings sheet as loaded.', 'explorer', 'calculations'],
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
    // with transactions grouped (Scope.grouping), each group is an asset to ask about, by its name
    const groupRows = base.grouped ? (base.rows || []).filter((r) => r._group) : [];
    for (const r of groupRows) assetsByCode.set(String(r.code), r.asset);
    const platforms = (base.platforms || []).map((p) => ({ id: p.id, label: p.label, p: norm(p.label) })).filter((p) => p.p.split(' ').length > 1 || p.p.length > 5);
    // every asset's words (name and code name, legal words and brackets aside), with how many assets share each word, so a
    // part of a name ("Orla", "Kestrel", "tarn rail") finds its asset
    const LEGAL = new Set('ltd limited plc sa spa s p a ag gmbh bv nv llc inc sarl sas srl ab as oy co company holdings holding group the of and tranche facility loan'.split(' '));
    const assetWords = [], df = new Map();
    for (const a of (base.assets || []).concat(groupRows.map((r) => r.asset))) {
      if (!a || !a.positionCount) continue;
      const ws = new Set(norm([a.name, a.code_name].filter(Boolean).join(' ')).split(' ').filter((w) => w && !LEGAL.has(w) && (w.length >= 2 || /\d/.test(w))));
      if (a.code_name) { const pre = /^([a-z]{3,})\d/.exec(norm(a.code_name)); if (pre) ws.add(pre[1]); }
      assetWords.push({ code: String(a.code), name: a.name, words: Array.from(ws) });
      for (const w of ws) df.set(w, (df.get(w) || 0) + 1);
    }
    // every word of every name in the data (5 letters or more), for reading a misspelt word as the nearest one
    const words = new Set(); for (const p of phrases) for (const w of p.split(' ')) if (w.length >= 5 && !/\d/.test(w)) words.add(w);
    const out = { byPhrase, phrases, dimLabels, fieldById: fb, assetsByCode, platforms, words: Array.from(words), assetWords, assetDf: df, groupOf: base.grouped ? base.groupOf : null };
    memo.set(base, out);
    return out;
  }

  // ---------- an asset named in part ----------
  /**
   * The one asset the left-over words of a question name in part: each word (3 letters or more, not one of Scope's own
   * words) scores against each asset's words: the same word 1, the start of one ("orla" of "orla", "delt" of "delta") 0.8,
   * a letter away (5 letters or more) 0.6, each divided by how many assets share that word. The best is taken when it
   * scores 0.6 or more and clearly beats the next (half as much again). Returns { code, name, said } or null.
   */
  function looseAsset(V, text, others) {
    const cue = /\b(about|tell|holds?|owns?|matur\w*|rated|rating|watchlist|covenants?|lock ?up|on|for|of|is|does)\b/.test(text); // the question is about one thing
    const toks = Array.from(new Set(String(text).split(' ').filter((w) => w && (w.length >= 3 || /\d/.test(w)) && !STOP.has(w) && !isOwnWord(w) && !COMMON.has(w) && !MATCH_STOP.has(w) && !/^(tell|about|show|give|deal|deals|asset|assets|name|loan|project|projects|company|please|info|details|story|holds?|owns?|matures?|watchlist|rated|rating|sum|max|min|maximum|minimum|grand|gran|net|gross|new|old|per|can|will|has|had|was|get|got|see|let|put|use|out|any|now|yet|its|his|her|who|why|how|not|too|via|ago)$/.test(w))));
    if (!toks.length || !V.assetWords.length) return null;
    const score = (a) => {
      let n = 0; const used = [];
      for (const t of toks) {
        let best = 0;
        for (const w of a.words) {
          const d = V.assetDf.get(w) || 1, sc = w === t ? 1 : (w.startsWith(t) && (t.length >= 5 || (t.length >= 3 && cue))) ? 0.8 : (t.length >= 5 && w[0] === t[0] && dist(t, w, 1) <= 1) ? 0.6 : 0;
          if (sc / d > best) best = sc / d;
        }
        if (best) { n += best; used.push(t); }
      }
      // a word that names something else in full (a sector, a country) counts only next to another word of the name
      if (used.length && used.every((t) => others && others.has(t))) return { n: 0, used: [] };
      return { n, used };
    };
    const ranked = V.assetWords.map((a) => Object.assign({ a }, score(a))).filter((x) => x.n > 0).sort((x, y) => y.n - x.n);
    if (!ranked.length) return null;
    const top = ranked[0];
    // two assets as near as each other: ask which (both offered)
    const near = ranked.filter((x) => x.n * 1.5 > top.n);
    if (near.length > 1) return top.n >= 0.4 ? { choices: near.slice(0, 4).map((x) => x.a.name), said: top.used.join(' ') } : null;
    if (top.n < 0.6) return null;
    return { code: top.a.code, name: top.a.name, said: top.used.join(' '), used: top.used };
  }

  // ---------- the phrase matcher: an unread question → the nearest question Scope knows ----------
  // Each line: the question Scope answers ({asset}: one asset named, {value}: a country, sector or other value named), and
  // other ways people ask it. Ours to grow: a question that comes back "not understood" can be added to the nearest line.
  const LIKE = [
    ['tell me about {asset}', ['{asset}', '{asset} overview', '{asset} summary', 'summary of {asset}', 'overview of {asset}', 'what is {asset}', 'how is {asset} doing', 'how is {asset} looking', 'give me {asset}', 'show me {asset}', 'brief me on {asset}', 'anything on {asset}', 'talk me through {asset}', 'background on {asset}', 'the story on {asset}']],
    ['when does {asset} mature', ['when is {asset} due', 'how long is left on {asset}', 'when does {asset} end', 'when is {asset} repaid', 'when do we get repaid on {asset}', 'how long to run on {asset}', 'when does {asset} finish', 'term left on {asset}']],
    ['what is the rating of {asset}', ['how is {asset} rated', 'what grade is {asset}', 'credit of {asset}', 'is {asset} any good', 'how strong is {asset}', 'how risky is {asset}', '{asset} credit']],
    ['who holds {asset}', ['who is in {asset}', 'which investors are in {asset}', 'who has {asset}', 'who has a piece of {asset}', 'allocation of {asset}', 'how is {asset} allocated', 'which funds hold {asset}', 'split of {asset} by investor']],
    ['what is the margin of {asset}', ['what do we earn on {asset}', 'pricing on {asset}', 'how is {asset} priced', 'what does {asset} pay']],
    ['exposure in {value}', ['how much do we have in {value}', 'what is our {value} exposure', 'are we big in {value}', 'how exposed are we to {value}', '{value} total', 'how much is in {value}', 'how big are we in {value}', 'our {value} book']],
    ['list assets in {value}', ['which deals are in {value}', 'what do we have in {value}', 'names in {value}', 'show me {value} deals', 'what is in {value}']],
    ['what is the total exposure', ['how big are we', 'how big is the book', 'total book', 'how much do we have in total', 'overall size', 'size of the portfolio', 'what is the book worth', 'total aum', 'how much money is out']],
    ['top 10 assets', ['largest deals', 'biggest names', 'our largest positions', 'show me the biggest exposures', 'big tickets', 'largest tickets', 'main assets', 'key names']],
    ['how many assets', ['how many deals do we have', 'number of names', 'count of deals', 'how many loans', 'how many names are there']],
    ['average margin', ['what are we earning', 'average pricing', 'what is our spread', 'how much do we make', 'what does the book pay', 'portfolio margin']],
    ['average rating', ['how good is the book', 'credit quality of the book', 'overall rating', 'portfolio rating', 'how strong is the book', 'how risky is the book']],
    ['which assets are on the watchlist', ['who is on watch', 'watch names', 'deals we are worried about', 'names on watch', 'which deals need watching']],
    ['what changed since last month', ['what is different from last month', 'anything new this month', 'what moved', 'month over month', 'delta vs last month', 'show me the changes', 'what happened this month', 'differences to last month']],
    ['anything i should worry about', ['what should i look at', 'what needs attention', 'any concerns', 'where should i look', 'what stands out', 'what is risky', 'health of the book', 'how is the book doing', 'state of play']],
    ['exposure by sector', ['sector split', 'sector mix', 'split by industry', 'what sectors are we in', 'where is the money by sector']],
    ['exposure by country', ['country split', 'geographic split', 'where is the money', 'which countries are we in', 'country mix']],
  ];
  const MATCH_STOP = new Set('the a an of to is are be we our us do does did me my i you your it s please can could would just also so then there that this these those for on at with and or'.split(' '));
  /** A question's words for matching: lower case, slots kept, small words out, plurals and -ing / -ed cut. */
  const stem = (w) => (/^\{/.test(w) ? w : w.length > 4 ? w.replace(/(ings?|ed|es|s)$/, '') : w);
  const toks = (t) => String(t).replace(/[{}]/g, (c) => (c === '{' ? ' {' : '} ')).split(/\s+/).filter((w) => w && !MATCH_STOP.has(w)).map(stem);
  const grams = (t) => { const x = ' ' + String(t).replace(/\{\w+\}/g, '#') + ' ', g = new Set(); for (let i = 0; i < x.length - 2; i++) g.add(x.slice(i, i + 3)); return g; };
  const dice = (a, b) => { if (!a.size || !b.size) return 0; let n = 0; for (const x of a) if (b.has(x)) n++; return (2 * n) / (a.size + b.size); };
  let LIKE_PREP = null;
  /**
   * The known question nearest to `q` (already normalised): the values named in it become {asset} / {value} slots, then each
   * known way of asking is scored on shared words (70%) and shared letter triples (30%); slots must agree. Returns
   * { text, score, slots } for the best (text: the known question with the slots filled in), and the runners-up.
   */
  function nearest(V, q, original, prevAsset) {
    if (!LIKE_PREP) LIKE_PREP = LIKE.flatMap(([ask, ways]) => [ask].concat(ways).map((w) => ({ ask, w, t: new Set(toks(w)), g: grams(w), slots: (w.match(/\{\w+\}/g) || []).sort().join() })));
    const { found } = findValues(V, q, original);
    let t = ' ' + q + ' ', asset = null, value = null;
    for (const f of found.slice().sort((a, b) => b.len - a.len)) {
      const isAsset = ASSET_FIELDS.has(f.field);
      if (isAsset && !asset) { const a = V.assetsByCode.get(String(f.value)) || Array.from(V.assetsByCode.values()).find((x) => x.name === f.value || x.code_name === f.value); asset = a ? a.name : f.value; }
      else if (!isAsset && !value) value = f.value;
      t = t.replace(' ' + f.phrase + ' ', isAsset ? ' {asset} ' : ' {value} ');
    }
    if (!asset && prevAsset) { const r = t.replace(/\b(it|this (one|deal|asset|loan|name)|that (one|deal|asset|loan|name)|the (deal|asset|loan))\b/, '{asset}'); if (r !== t) { t = r; asset = 'it'; } }
    t = t.replace(/\s+/g, ' ').trim();
    const qt = new Set(toks(t)), qg = grams(t), qs = (t.match(/\{\w+\}/g) || []).sort().join();
    const best = new Map();
    for (const x of LIKE_PREP) {
      if (x.slots !== qs) continue;
      const sc = 0.7 * dice(qt, x.t) + 0.3 * dice(qg, x.g);
      if (!best.has(x.ask) || sc > best.get(x.ask)) best.set(x.ask, sc);
    }
    const fill = (ask) => ask.replace('{asset}', asset || '').replace('{value}', value || '');
    const ranked = Array.from(best).sort((a, b) => b[1] - a[1]).map(([ask, score]) => ({ text: fill(ask), score }));
    return ranked;
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
  /** Edit distance (with swapped neighbours as one edit), stopping above `max`. */
  function dist(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    const d = []; for (let i = 0; i <= a.length; i++) { d[i] = [i]; for (let j = 1; j <= b.length; j++) d[i][j] = i ? 0 : j; }
    for (let i = 1; i <= a.length; i++) { let row = Infinity; for (let j = 1; j <= b.length; j++) { const c = a[i - 1] === b[j - 1] ? 0 : 1; d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c); if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1); row = Math.min(row, d[i][j]); } if (row > max) return max + 1; }
    return d[a.length][b.length];
  }
  // the words Scope itself understands (measures, groupings, help), never read as a misspelt name
  let ownWords = null;
  const isOwnWord = (w) => { if (!ownWords) { ownWords = new Set(); for (const list of [MEASURES.map((x) => x.words), GROUPS.map((x) => x[1]), HELP.map((x) => x[0]), DEFINE.map((x) => x[0])]) for (const ws of list) for (const p of ws) for (const x of p.split(' ')) ownWords.add(x); } return ownWords.has(w) || ownWords.has(w.replace(/s$/, '')) || COMMON.has(w); };
  /**
   * Words of a question that name nothing, read as the one word of the data they are a letter or two from ("sumit" →
   * "summit", "germny" → "germany"), starting with the same letter: one edit for words of 5 to 7 letters, two from 8.
   * Returns { q, fixes: [[from, to]] }.
   */
  function spell(V, q) {
    const fixes = [], known = new Set(V.phrases.join(' ').split(' '));
    const out = q.split(' ').map((w) => {
      if (w.length < 5 || /\d/.test(w) || known.has(w) || isOwnWord(w)) return w;
      const max = w.length >= 8 ? 2 : 1; let best = null, tie = false;
      for (const c of V.words) { if (c[0] !== w[0]) continue; const d = dist(w, c, max); if (d > max) continue; if (!best || d < best.d) { best = { c, d }; tie = false; } else if (d === best.d && c !== best.c) tie = true; }
      if (!best || tie) return w;
      fixes.push([w, best.c]); return best.c;
    });
    return { q: out.join(' '), fixes };
  }
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
    for (const [re, to] of SAYINGS) q = q.replace(re, to);
    if (/\bUS\b/.test(original)) q = q.replace(/\bus\b(?! ?dollars?)/g, ' united states '); // "US" in capitals is the country; "us" the pronoun ("show us")
    q = q.replace(/\s+/g, ' ').trim();
    const V = vocab(res);
    const query = { text: original, intent: null, measure: null, groupBy: null, filters: [], having: [], top: null, followUp: false, notes: [] };
    if (!q) { query.intent = 'none'; return query; }
    const sp = spell(V, q); q = sp.q; if (sp.fixes.length) query.fixes = sp.fixes;
    query.yesno = /^(is|are|does|do|has|have|was|were|did|any)\b/.test(q);

    // named views ("Region A") are a choice in the top bar, not a filter
    for (const p of V.platforms) if ((' ' + q + ' ').includes(' ' + p.p + ' ') && !V.byPhrase.has(p.p)) { if (p.id !== res.platformId) query.view = { id: p.id, label: p.label }; q = (' ' + q + ' ').replace(' ' + p.p + ' ', ' ').trim(); }

    const fv = findValues(V, q, original);
    let found = fv.found, rest = fv.rest;
    // an asset named only in part (or two assets sharing a word): scored on the whole question, unless a name was written
    // in full; the words it takes are no longer read as other values ("Kestrel Wind" is the asset, not the Wind sector)
    let partAsset = null;
    const fullName = found.some((f) => ASSET_FIELDS.has(f.field) && Array.from(V.assetsByCode.values()).some((a) => [a.name, a.code_name, a.code].some((x) => x && norm(x) === f.phrase)));
    if (!fullName && !/\b(by|per|each|top|bottom|how many|count|number of)\b/.test(q)) {
      const others = new Set(found.filter((f) => !ASSET_FIELDS.has(f.field)).flatMap((f) => f.phrase.split(' ')));
      partAsset = looseAsset(V, q, others);
      if (partAsset && partAsset.code) {
        const took = new Set(partAsset.used);
        found = found.filter((f) => !ASSET_FIELDS.has(f.field) && !f.phrase.split(' ').every((w) => took.has(w)));
        rest = (' ' + rest + ' ').split(' ').filter((w) => !took.has(w)).join(' ').replace(/\s+/g, ' ').trim();
      } else if (partAsset && partAsset.choices) { found = found.filter((f) => !ASSET_FIELDS.has(f.field)); query.assetChoices = partAsset.choices; query.assetSaid = partAsset.said; partAsset = null; }
    }
    let r = ' ' + rest + ' ';

    // years: "in 2028", "before 2030", "between 2028 and 2031", "next 3 years"
    const yearField = /\b(deal|signed|closed|vintages?|originated|origination)\b/.test(q) ? 'deal_year' : /\b(funded|funding|drawn in)\b/.test(q) ? 'funding_year' : 'maturity_year';
    const repYear = res.reportingDate instanceof Date && !isNaN(res.reportingDate) ? res.reportingDate.getUTCFullYear() : null;
    const yr = (x) => String(x);
    let m;
    if ((m = /\bbetween (\d{4}) and (\d{4})\b/.exec(r))) { query.filters.push({ field: yearField, op: 'between', value: [yr(m[1]), yr(m[2])] }); r = r.replace(m[0], ' '); }
    if ((m = /\b(?:in the |within the |over the )?(?:next|coming|within) (\d+|one|two|three|four|five|six|seven|eight|nine|ten) years?\b/.exec(r))) { const n = NUMBER_WORDS[m[1]] || +m[1]; query.filters.push({ field: 'remaining_years', op: 'between', value: [0, n] }); r = r.replace(m[0], ' '); }
    if ((m = /\b(?:in the |within the |over the )?(?:next|coming|within) (\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty) months?\b/.exec(r))) { const n = NUMBER_WORDS[m[1]] || +m[1]; query.filters.push({ field: 'remaining_years', op: 'between', value: [0, n / 12] }); r = r.replace(m[0], ' '); }
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

    // a ratio of the write-ups ("DSCR below 1.3x", "lowest ICR", "average leverage"): its threshold is a multiple, not an amount
    const metric = METRICS.find(([, re]) => re.test(q));
    if (metric) {
      query.metric = metric[0];
      const mt = /\b(above|over|more than|greater than|higher than|at least|below|under|less than|lower than|at most)\s+(\d+(?:[.,]\d+)?)\s*(x|times|%)?(?=\s|$)/.exec(r);
      if (mt) { const op = /^(above|over|more than|greater than|higher than)$/.test(mt[1]) ? 'gt' : mt[1] === 'at least' ? 'gte' : mt[1] === 'at most' ? 'lte' : 'lt'; query.mThreshold = { op, value: +mt[2].replace(',', '.'), text: mt[0].trim() }; r = r.replace(mt[0], ' '); }
      query.mAverage = /\b(average|avg|mean|typical|weighted)\b/.test(q);
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
    if (partAsset && partAsset.code) { assetCodes.clear(); assetCodes.add(partAsset.code); query.assetGuess = [partAsset.said, partAsset.name]; }
    // with transactions grouped, a deal named in a question means its transaction group (the line shown)
    if (V.groupOf && assetCodes.size) { const mapped = Array.from(assetCodes).map((c) => V.groupOf.get(String(c)) || c); assetCodes.clear(); mapped.forEach((c) => assetCodes.add(String(c))); }
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
    const detail = DETAILS.filter(([, re]) => re.test(r)).map(([k]) => k);
    const wuSearch = /\b(?:mentions?|mentioning|mentioned|talks? about|talking about|refers? to|referring to|says?|said|write ?ups? (?:about|on|with|that mention))\s+(.+)$/.exec(q);
    const wuRatios = /\b(lock ?ups?|breach\w*|past (the |their )?covenants?|below (the |their )?covenants?|covenant (breach\w*|issues?|problems?))\b/.test(q);
    const change = /\b(mapping|settings?|columns?|folder|currency|view|filters?|template|password|name)\b/.test(q) ? null : CHANGE.find(([, re]) => re.test(q));
    const digest = DIGEST.test(q) || /\b(risks?|issues?) (in|with|on) (the |my |our )?(book|portfolio)\b/.test(q);

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
    else if (digest && !help) query.intent = 'digest';
    else if (query.metric && !assetCodes.size && !wuSearch) { query.intent = 'writeups'; query.wu = 'metric'; query.groupBy = null; }
    else if (wuSearch && !assetCodes.size) { query.intent = 'writeups'; query.wu = 'search'; query.wuTerm = wuSearch[1].replace(/\b(in (the|their) write ?ups?|please)\b/g, '').trim(); }
    else if (wuRatios && !assetCodes.size && !query.groupBy) { query.intent = 'writeups'; query.wu = 'ratios'; }
    else if (change && !help && !define && !query.groupBy) { query.intent = 'change'; query.change = change[0]; }
    else if (issues && !help) query.intent = 'issues';
    else if (define && !help) query.intent = 'define';
    else if (help && !query.filters.length && !query.measure) query.intent = 'help';
    else {
      if (who && !query.groupBy) query.groupBy = 'investor_label';
      if (whoSponsor && !query.groupBy) query.groupBy = 'sponsor';
      if (where && !query.groupBy) query.groupBy = 'country';
      // "top 5 countries", "which sector has the most", "largest sponsor"
      if (!query.groupBy && (query.top || /\b(which|what)\b/.test(r))) { const g = groupOf(r.trim()); if (g && g.word !== 'where' && g.word !== 'who' && g.id !== 'maturity_year' && g.id !== 'asset_name') query.groupBy = g.id; }
      if (assetCodes.size === 1 && (query.groupBy === 'asset_name' || query.groupBy === 'code_name') && !query.top && !/\b(list|which|all)\b/.test(r)) query.groupBy = null; // "the X deal", "project X": the asset
      if (assetCodes.size === 1 && detail.length && !groupBy && !query.top && !query.yesno && !who && !whoSponsor) { query.groupBy = null; query.intent = 'asset'; query.detail = detail; query.filters = query.filters.filter((f) => f.field === 'asset_code' || !DETAIL_FIELDS.has(f.field)); }
      else if (query.groupBy === 'asset_name' || query.groupBy === 'code_name') { query.groupBy = null; query.intent = 'list'; }
      else if (query.groupBy) query.intent = 'breakdown';
      else if (!(assetCodes.size === 1 && !query.top && !/\b(list|which|all)\b/.test(r)) && (wantsList || (query.top && (ENTITY.test(r) || !query.measure || MEASURES.find((x) => x.id === query.measure).kind === 'avg')))) query.intent = 'list';
      else if (assetCodes.size === 1 && !query.measure && query.filters.length === 1) query.intent = 'asset';
      else if (query.yesno && (query.filters.length || query.having.length)) query.intent = 'value';
      else if (!query.top && query.filters.some((f) => f.op === 'in' && Array.isArray(f.value) && f.value.length > 1 && !/_year$/.test(f.field) && f.field !== 'watchlist')) { const f = query.filters.find((x) => x.op === 'in' && Array.isArray(x.value) && x.value.length > 1 && !/_year$/.test(x.field) && x.field !== 'watchlist'); query.groupBy = f.field === 'asset_code' ? 'asset_name' : f.field; query.intent = 'breakdown'; }
      else if (query.measure || query.filters.length || query.having.length || query.top) query.intent = 'value';
    }

    // "it", "its", "this deal" after a question about one asset: the same asset, whatever else is asked
    const prevAsset = prev && (prev.filters || []).find((f) => f.field === 'asset_code' && f.op === 'in' && f.value.length === 1);
    if (prevAsset && !assetCodes.size && /\b(it|its|it s|this (one|deal|asset|loan|name)|that (one|deal|asset|loan|name)|the (deal|asset|loan))\b/.test(q) && !['help', 'define', 'issues', 'shared', 'intro', 'digest', 'writeups'].includes(query.intent)) {
      const one = { field: 'asset_code', op: 'in', value: prevAsset.value.slice() };
      if (/\b(same|other|else|similar|like it|peers?|comparable)\b/.test(q)) { // "who else is in its sector", "similar deals"
        const a = V.assetsByCode.get(one.value[0]), recs0 = E.dataset.build(res.base || res).records.filter((x) => String(x.asset_code) === one.value[0]), r0 = recs0[0] || {};
        const by = /\bcountry|where\b/.test(q) ? 'country' : /\bsponsor\b/.test(q) ? 'sponsor' : /\brating|grade\b/.test(q) ? 'rating' : 'sector';
        if (r0[by]) { query.filters = query.filters.filter((f) => f.field !== by); query.filters.push({ field: by, op: 'in', value: [r0[by]] }, { field: 'asset_code', op: 'notIn', value: one.value.slice() }); }
        query.intent = 'list'; query.groupBy = null; query.like = a ? a.name : one.value[0];
      } else {
        query.filters = query.filters.filter((f) => f.field !== 'asset_code').concat([one]);
        if (detail.length && !query.measure && !query.groupBy && !query.yesno) { query.intent = 'asset'; query.detail = detail; query.filters = query.filters.filter((f) => f.field === 'asset_code' || !DETAIL_FIELDS.has(f.field)); }
        else if (query.intent === 'none' || (!query.measure && !query.groupBy && !query.yesno && query.filters.length === 1)) { query.intent = 'asset'; query.detail = detail; }
        else if (query.yesno || query.measure) query.intent = query.groupBy ? 'breakdown' : 'value';
      }
      query.followUp = true;
      return query;
    }
    // a follow-up keeps the last question's measure, grouping and filters, and changes only what it names
    const short = q.split(' ').length <= 5, ownMeasure = !!(measure || countM);
    const followWord = /^(and|what about|how about|same for|same but|now|only|just|also|instead|but|then|ok|okay|plus|with|without|excluding|except|for|in)\b/.test(q);
    const ownSubject = assetCodes.size > 0 || query.yesno || query.intent === 'digest';
    const named = found.length || query.filters.length || query.having.length || query.groupBy || query.top || query.measure || query.listWord || detail.length || /\b(them|these|those)\b/.test(q);
    if (prev && prev.intent && named && !(prev.intent === 'change' && !followWord && !query.change) && !['help', 'define', 'issues', 'shared', 'none', 'intro', 'digest'].includes(prev.intent) && (followWord || (short && !ownMeasure && !ownSubject)) && !['help', 'define', 'issues', 'shared', 'intro', 'digest', 'writeups'].includes(query.intent) && !(query.intent === 'change' && prev.intent !== 'change')) {
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
      if (merged.intent === 'asset') merged.detail = detail;
      if (query.intent === 'change') { merged.intent = 'change'; merged.change = query.change; }
      if (prev.intent === 'change' && !query.change && (query.filters.length || query.having.length)) merged.intent = 'change'; // "and in Germany?" after "new deals"
      merged.yesno = query.yesno;
      if (query.view) merged.view = query.view;
      return merged;
    }
    if (!query.intent) query.intent = 'none';
    // not read, or read only loosely (the bare asset card, the total, a help request naming no topic): the nearest known
    // question when it is near enough (said so under the answer); for an unread question, the nearest as suggestions
    const loose = query.intent === 'none' || (query.intent === 'asset' && !(query.detail || []).length && q.split(' ').length > assetWords(V, found) + 1)
      || (query.intent === 'value' && !query.measure && !query.yesno && !query.having.length && !query.filters.length)
      || (query.intent === 'list' && !query.listWord && !query.top && !query.filters.length && !query.having.length)
      || (query.intent === 'help' && !HELP.some((t) => t[0].some((w) => (' ' + q + ' ').includes(' ' + w + ' '))));
    if (!query.followUp && !ASK._inLike && !query.assetChoices && !['intro', 'shared', 'issues', 'define'].includes(query.intent)) {
      // a way of asking in the list, word for word (or nearly), is taken as listed, however the question was read
      const ranked = nearest(V, q, original, prevAsset), need = !loose ? LIKE_EXACT : query.intent === 'none' || query.intent === 'help' ? LIKE_MIN : LIKE_SURE;
      if (ranked[0] && ranked[0].score >= need) {
        ASK._inLike = true;
        try {
          const again = ASK.parse(res, ranked[0].text, /\bit\b/.test(ranked[0].text) ? prev : null); // a fresh question, unless it is about "it"
          if (again.intent !== 'none') return Object.assign(again, { text: original, understoodAs: ranked[0].text, fixes: (query.fixes || []).concat(again.fixes || []), assetGuess: again.assetGuess || query.assetGuess });
        } finally { ASK._inLike = false; }
      }
      if (loose && (query.intent === 'none' || query.intent === 'help')) { query.didYouMean = ranked.filter((x) => x.score >= LIKE_HINT).slice(0, 3).map((x) => x.text); if (query.intent === 'help' && query.didYouMean.length) query.intent = 'none'; }
    }
    return query;
  };
  // how near a known question must be: to be taken for an unread question, to replace a loose reading, to replace any
  // reading (a listed way of asking, word for word), to be offered
  const LIKE_MIN = 0.5, LIKE_SURE = 0.6, LIKE_EXACT = 0.9, LIKE_HINT = 0.4;
  /** How many words of the question are the asset's own name (so "Summit Hydro" alone is not loose). */
  const assetWords = (V, found) => found.filter((f) => ASSET_FIELDS.has(f.field)).reduce((n, f) => Math.max(n, f.phrase.split(' ').length), 0);

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
  /** "Beacon Airports'" and "Summit Hydro's". */
  const poss = (n) => (/s$/i.test(String(n)) ? `${n}'` : `${n}'s`);
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
      else if (f.field === 'remaining_years') { const y = Array.isArray(f.value) ? f.value[1] : f.value; parts.push('maturing within ' + (y < 1 || Math.round(y) !== y ? `${Math.round(y * 12)} months` : `${y} year${y === 1 ? '' : 's'}`)); }
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
      out.sentence = 'Ask about the loaded data in your own words: a figure (exposure, drawn, margin, WAL, rating, emissions), split by anything (sector, country, sponsor, investor, rating, maturity), narrowed by any value or threshold, or a list of assets. Ask about one asset ("tell me about X", "when does it mature?", "is it on the watchlist?"), what changed since last month ("new deals", "downgrades", "biggest movers") or what deserves a look ("anything I should worry about?"). You can also ask where something is done in Scope, or what a term means. Short follow-ups such as "and France?", "by sponsor" or "its rating?" build on the last answer, and a misspelt name is read as the nearest one.';
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

    if (query.assetChoices && query.assetChoices.length > 1 && !query.filters.some((f) => f.field === 'asset_code')) {
      const rest = norm(query.text).replace(new RegExp('\\b' + (query.assetSaid || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b'), '{x}');
      out.kind = 'none'; out.headline = 'Which one?';
      out.sentence = `More than one asset matches "${query.text}": ${query.assetChoices.join(', ')}. Pick one below, or type more of the name.`;
      out.suggest = query.assetChoices.map((n) => (query.assetSaid && rest.includes('{x}') ? rest.replace('{x}', n) : `tell me about ${n}`));
      return out;
    }
    if (query.intent === 'none') {
      out.sentence = 'I did not understand that question. Try naming a figure (exposure, margin, WAL, rating), a group (by sector, by country), or an asset, investor or country.';
      // words close to something in the data
      const words = norm(query.text).split(' ').filter((w) => w.length >= 3 && !STOP.has(w));
      const near = []; for (const p of V.phrases) { if (near.length >= 6) break; if (words.some((w) => p.split(' ').some((x) => x.startsWith(w) || (w.length >= 5 && x.startsWith(w.slice(0, 4)))))) { const m = V.byPhrase.get(p)[0]; const lbl = m.field === 'asset_code' ? null : m.value; if (lbl && !near.includes(lbl)) near.push(lbl); } }
      out.suggest = (query.didYouMean || []).concat(near.map((v) => `exposure in ${v}`)).slice(0, 5);
      if (!out.suggest.length) out.suggest = ASK.examples(res).slice(0, 4);
      if (query.didYouMean && query.didYouMean.length) out.sentence = `I did not understand that question. Did you mean "${query.didYouMean[0]}"? Or name a figure (exposure, margin, WAL, rating), a group (by sector, by country), or an asset, investor or country.`;
      return out;
    }

    if (query.fixes && query.fixes.length) out.read.push({ k: 'Spelling', v: query.fixes.map(([a, b]) => `"${a}" read as "${b}"`).join(', '), part: null });
    if (query.understoodAs) out.read.unshift({ k: 'Understood as', v: `"${query.understoodAs}"`, part: null });
    if (query.assetGuess) out.read.push({ k: 'Matched', v: `"${query.assetGuess[0]}" read as ${query.assetGuess[1]}`, part: null });
    if (query.intent === 'change') return changeAnswer(res, query, c, out, ds, V);
    if (query.intent === 'digest') return digestAnswer(res, query, c, out, ds, V);
    if (query.intent === 'writeups') return writeupAnswer(res, query, c, out);

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

    // yes / no: is the asset (or anything) as asked? No says what it is instead
    if (query.yesno && (query.intent === 'value' || query.intent === 'list' || query.intent === 'asset')) {
      const one = query.filters.find((f) => f.field === 'asset_code' && f.op === 'in' && f.value.length === 1);
      out.kind = 'yesno';
      if (one && /\b(lock ?ups?|breach\w*|covenants?|headroom)\b/.test(norm(query.text))) { // from the asset's write-up ratios
        const a = V.assetsByCode.get(one.value[0]), name = a ? a.name : one.value[0], wm = writeupsBy(res, c), w = (wm && wm.get(String(one.value[0]))) || [];
        const rs = w[0] ? ratios(w[0]) : [], onlyBreach = !/lock ?ups?/.test(norm(query.text)), bad = rs.filter((x) => x.state === 'breach' || (!onlyBreach && x.state === 'lockup'));
        out.headline = !w[0] ? 'Cannot tell' : bad.length ? 'Yes' : 'No';
        out.sentence = !w[0] ? `${wm ? `No write-up is linked to ${name}` : 'No write-ups are loaded'}, so its ratios are not known here.` : bad.length ? `Yes: ${poss(name)} ${bad.map(ratioText).join('; ')}.` : `No: ${poss(name)} ratios are within ${onlyBreach ? 'their covenants' : 'lock-up and covenant'}${rs.length ? ` (${rs.map(ratioText).join('; ')})` : ''}.`;
        if (w[0]) out.writeups = w;
        out.actions.push({ kind: 'link', label: 'Open the asset', href: href('asset', one.value[0]), primary: true });
        return out;
      }
      if (one) {
        const a = V.assetsByCode.get(one.value[0]), name = a ? a.name : one.value[0];
        const mine = P.applyFilters(ds.records, ds.fieldById, [{ field: 'excluded', op: 'in', value: ['No'] }, one]);
        const asked = query.filters.filter((f) => f !== one);
        const LBL = { ig_label: 'grade band', fixed_floating: 'rate', watchlist: 'watchlist status', remaining_years: 'remaining life', maturity_year: 'maturity year' };
        const facts = asked.map((f) => { const fld = ds.fieldById[f.field]; const vals = U.uniq(mine.map((r) => (fld ? fld.get(r) : '')).filter((v) => v !== '' && v !== null && v !== undefined).map((v) => (typeof v === 'number' ? fmtNum(v, 1) : String(v)))); return `${LBL[f.field] || (fld ? fld.label : f.field).toLowerCase()} is ${vals.length ? vals.join(', ') : 'not filled in'}`; });
        for (const hv of query.having) facts.push(`${said(ds, hv.field).toLowerCase()} is ${fmtMeasure(res, ds, hv.field, P.aggregate(mine, valueSpec(ds, hv.field).field, valueSpec(ds, hv.field).agg, ds.fieldById))}`);
        out.headline = recs.length ? 'Yes' : 'No';
        out.sentence = `${out.headline}: ${facts.length ? `${poss(name)} ${facts.join(', and its ')}` : name + (recs.length ? ' is in ' + view : ' is not in ' + view)}.`;
        out.actions.push({ kind: 'link', label: 'Open the asset', href: href('asset', one.value[0]), primary: true });
        out.suggest = ['tell me about it', 'its rating', 'when does it mature'];
        return out;
      }
      out.headline = recs.length ? 'Yes' : 'No';
      out.sentence = recs.length ? `Yes: ${fmtNum(nAssets, 0)} asset${nAssets === 1 ? '' : 's'} ${where || 'in ' + view}, ${fmtMeasure(res, ds, 'exposure', exp)}${totalExp ? ` (${U.fmt.pct(exp / totalExp)} of ${view})` : ''}.` : `No: nothing in ${view} is ${where || 'like that'}${pageFilters ? ' with the page filters in force' : ''}.`;
      if (recs.length) { out.actions.push(explorer(['asset_name']), filterAction()); out.suggest = ['list them', 'by sector', 'by country']; }
      out.actions = out.actions.filter(Boolean);
      return out;
    }

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
      const fv = (id) => { const f = ds.fieldById[id]; return f ? U.uniq(recs.map((x) => f.get(x)).filter((v) => v !== '' && v !== null && v !== undefined).map(String)) : []; };
      const list = (id) => fv(id).join(', ');
      const name = a ? a.name : code, dates = fv('maturity_date').sort(), yrs = g('remaining_years');
      // the investors in the view, largest first
      const inv = new Map(); for (const x of recs) inv.set(x.investor_label, (inv.get(x.investor_label) || 0) + (P.aggregate([x], 'exposure', 'sum', ds.fieldById) || 0));
      const invs = Array.from(inv).sort((x, y) => y[1] - x[1]);
      const invText = invs.slice(0, 3).map(([n, v]) => `${n} ${exp ? U.fmt.pct(v / exp) : ''}`.trim()).join(', ') + (invs.length > 3 ? ` and ${invs.length - 3} more` : '');
      const matText = dates.length ? (dates.length > 1 ? `${dates[0]} to ${dates[dates.length - 1]}` : dates[0]) + (U.isNum(yrs) ? `, ${fmtNum(yrs, 1)} years left` : '') + (list('maturity_bucket') ? ` (${list('maturity_bucket')})` : '') : '';
      const ratingText = [list('rating'), list('ig_label')].filter(Boolean).join(' · ') + (list('internal_grade') ? `; internal ${list('internal_grade')}` : '') + (list('external_grade') ? `; external ${list('external_grade')}` : '');
      const covText = [list('covenant_type'), list('covenant_compliance') ? `compliance ${list('covenant_compliance')}` : ''].filter(Boolean).join(', ');
      const esg = g('esg_score');
      // the asset's write-up(s): description, recent events, ratios against lock-up and covenant, the write-up's rating
      const wmap = writeupsBy(res, c), wus = (wmap && wmap.get(String(code))) || [], w0 = wus[0] || null;
      const rts = w0 ? ratios(w0) : [], evs = w0 ? (w0.events || []).map(cellOf).filter(Boolean) : [], desc = w0 ? cellOf(w0.description) : '';
      const mine = query.metric ? rts.filter((x) => isMetric(x.label, query.metric)) : rts; // "Beacon's DSCR": that ratio only
      const ratioLine = mine.map((x) => ratioText(x) + (U.isNum(headroomOf(x.label, numOf(x.actual), numOf(x.covenant))) ? `, ${headText(headroomOf(x.label, numOf(x.actual), numOf(x.covenant)))}` : '')).join('; ');
      const D = {
        maturity: ['Maturity', matText, () => (dates.length ? `${name} ${dates.length > 1 ? `has tranches maturing from ${dates[0]} to ${dates[dates.length - 1]}` : `matures on ${dates[0]}`}${U.isNum(yrs) ? `, ${fmtNum(yrs, 1)} years from the reporting date` : ''}${list('maturity_bucket') ? ` (${list('maturity_bucket')} bucket)` : ''}.` : `No maturity date is filled in for ${name}.`)],
        rating: ['Rating', ratingText, () => (list('rating') ? `${name} is rated ${list('rating')}${list('ig_label') ? ` (${list('ig_label')})` : ''}${list('internal_grade') ? `, internal grade ${list('internal_grade')}` : ''}${list('external_grade') ? `, external ${list('external_grade')}` : ''}.` : `${name} is not rated.`)],
        sector: ['Sector', [list('sector'), list('subsector')].filter(Boolean).join(' › '), () => `${name} is in ${[list('sector'), list('subsector')].filter(Boolean).join(' › ') || 'no sector filled in'}.`],
        country: ['Country', [list('country'), list('region')].filter(Boolean).join(' · '), () => `${name} is in ${list('country') || 'no country filled in'}${list('region') ? ` (${list('region')})` : ''}.`],
        sponsor: ['Sponsor', list('sponsor'), () => (list('sponsor') ? `${poss(name)} sponsor is ${list('sponsor')}.` : `No sponsor is filled in for ${name}.`)],
        watchlist: ['Watchlist', list('watchlist'), () => `${poss(name)} watchlist status is ${list('watchlist') || 'not filled in'}.`],
        rate: ['Fixed / floating', list('fixed_floating'), () => `${name} is ${list('fixed_floating') ? list('fixed_floating').toLowerCase() + ' rate' : 'not marked fixed or floating'}.`],
        lead: ['Deal lead', list('deal_lead'), () => (list('deal_lead') ? `${poss(name)} deal lead is ${list('deal_lead')}.` : `No deal lead is filled in for ${name}.`)],
        covenant: [query.metric && query.metric !== 'headroom' ? (query.metric === 'leverage' ? 'Leverage' : query.metric.toUpperCase()) : 'Covenants', query.metric ? (mine.length ? mine.map((x) => x.actual).join(', ') : w0 ? 'not in the write-up' : 'no write-up') : [covText, ratioLine].filter(Boolean).join('; '),
          () => (query.metric && w0 && !mine.length ? `${poss(name)} write-up has no ${query.metric === 'leverage' ? 'leverage' : query.metric.toUpperCase()}${rts.length ? ` (it has ${rts.map((x) => x.label).join(', ')})` : ''}.`
            : ratioLine || covText ? `${name}: ${[ratioLine ? `from the write-up, ${ratioLine}` : '', covText && !query.metric ? `covenant ${covText}` : ''].filter(Boolean).join('; ')}.` : `No covenant or ratio is filled in for ${name}${wmap ? '' : ' (no write-ups loaded)'}.`)],
        events: ['Write-up', [desc, evs.length ? `Recent: ${evs.slice(0, 3).join(' · ')}` : ''].filter(Boolean).join(' '), () => (w0 ? [desc, evs.length ? `Recent events: ${evs.join(' ')}` : ''].filter(Boolean).join(' ') || `The write-up of ${name} has no description or events.` : wmap ? `No write-up is linked to ${name}: link one on Asset write-ups.` : `No write-ups are loaded: load the write-ups workbook on Asset write-ups to see ${poss(name)} description and recent events.`)],
        esg: ['ESG score', U.isNum(esg) ? fmtNum(esg, 0) : '', () => (U.isNum(esg) ? `${poss(name)} ESG score is ${fmtNum(esg, 0)}.` : `No ESG score is filled in for ${name}.`)],
        currency: ['Currency', list('currency'), () => `${name} is in ${list('currency') || 'no currency filled in'}.`],
      };
      const asked = (query.detail || []).filter((k) => D[k]);
      out.headline = asked.length === 1 ? `${D[asked[0]][0]}: ${D[asked[0]][1] || 'not filled in'}` : name;
      const alert = rts.filter((x) => x.state === 'breach' || x.state === 'lockup');
      out.sentence = asked.length ? asked.map((k) => D[k][2]()).join(' ') : `${name} (${[a && a.code_name, code].filter(Boolean).join(' · ')}): ${fmtMeasure(res, ds, 'exposure', exp)} exposure in ${view}${totalExp ? `, ${U.fmt.pct(exp / totalExp)} of the view` : ''}; ${[list('sector'), list('country'), list('rating') ? 'rated ' + list('rating') : ''].filter(Boolean).join(', ')}${dates.length ? `, maturing ${dates[dates.length - 1]}` : ''}.`
        + (desc ? ' ' + firstSentence(desc) : '') + (evs.length ? ` Latest: ${evs[0]}` : '') + (alert.length ? ` Watch: ${alert.map(ratioText).join('; ')}.` : '');
      // the write-up as its box (the page shows it when it can), when the profile, the events or the ratios are asked for
      if (w0 && (!asked.length || asked.includes('events') || asked.includes('covenant'))) out.writeups = wus;
      if (asked.length) out.read.push({ k: 'Asked', v: asked.map((k) => D[k][0].toLowerCase()).join(', '), part: null });
      const rows = [D.sector, D.country, D.sponsor, D.rating, ['Exposure', fmtMeasure(res, ds, 'exposure', exp)], ['Drawn', fmtMeasure(res, ds, 'drawn', g('drawn'))], ['Undrawn', fmtMeasure(res, ds, 'undrawn', g('undrawn'))],
        ['Margin', fmtMeasure(res, ds, 'margin_bps', g('margin_bps'))], ['WAL', fmtMeasure(res, ds, 'wal_years', g('wal_years'))], D.maturity, D.rate, D.currency, ['Instrument', list('instrument')], D.watchlist, D.covenant, D.esg, D.lead,
        ['Write-up rating', w0 ? cellOf(w0.rating) : ''], ['Recent events', evs.slice(0, 3).join(' · ')],
        ['Investors in the view', invText], ['Positions', fmtNum(recs.length, 0)]]
        .map((x) => [x[0], x[1]]).filter((x) => x[1] !== '' && x[1] !== undefined && x[1] !== null && x[1] !== '–');
      const first = asked.map((k) => D[k][0]);
      rows.sort((x, y) => (first.includes(y[0]) ? 1 : 0) - (first.includes(x[0]) ? 1 : 0));
      out.table = { columns: [{ label: 'Field' }, { label: 'Value' }], rows };
      out.actions.push({ kind: 'link', label: 'Open the asset', href: href('asset', code), primary: true }, filterAction());
      out.suggest = ['who holds it', 'when does it mature', w0 ? 'its covenants' : 'its rating', w0 ? 'what is new with it' : 'similar deals in its sector'].filter((x) => !(asked.includes('maturity') && /mature/.test(x)) && !(asked.includes('rating') && /rating/.test(x)));
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
    if (query.like) out.note = `Assets sharing ${query.filters.filter((f) => f.op === 'in' && f.field !== 'asset_code').map((f) => (ds.fieldById[f.field] || { label: f.field }).label.toLowerCase()).join(', ')} with ${query.like}, without it.`;
    if (query.top && query.top.n === 1 && shown[0]) { const x = shown[0]; out.headline = x.a ? x.a.name : x.code; out.sentence = `The ${query.top.dir === 'asc' ? 'smallest' : 'largest'} asset${extra ? ' by ' + said(ds, sortSpec.field.id).toLowerCase() : ''}${where ? ' ' + where : ''} in ${view} is ${out.headline}, with ${extra ? fmtMeasure(res, ds, sortSpec.field.id, x.v) + ' and ' : ''}${fmtMeasure(res, ds, 'exposure', x.e)} exposure${totalExp ? ` (${U.fmt.pct(x.e / totalExp)} of the view)` : ''}.`; }
    else out.sentence = (query.top ? `${query.top.dir === 'asc' ? 'Smallest' : 'Top'} ${fmtNum(shown.length, 0)} of ${fmtNum(items.length, 0)} asset${items.length === 1 ? '' : 's'}` : `${fmtNum(items.length, 0)} asset${items.length === 1 ? '' : 's'}`) + (where ? ' ' + where : '') + ` in ${view}, ${fmtMeasure(res, ds, 'exposure', exp)} in all` + (extra ? `, sorted by ${measureLabel(ds, sortSpec.field.id).toLowerCase()}` : ', largest first') + '.';
    out.actions.push(explorer(['asset_name'], query.top ? { topN: { n: query.top.n, valueIndex: 0 } } : null), filterAction());
    out.suggest = ['by sector', 'by country', 'average margin', 'by maturity'];
    out.actions = out.actions.filter(Boolean);
    return out;
  };

  // ---------- the write-ups (Asset write-ups page): description, recent events, ratios against lock-up and covenant ----------
  let WU = null;
  /** The write-ups linked to each asset, as the asset page links them: Map code → [write-up] (ctx.writeups: { items, links }). */
  function writeupsBy(res, c) {
    const W = c && c.writeups, R = Scope.report, base = res.base || res;
    WAYS = (W && W.ways) || null;
    if (!W || !(W.items || []).length || !R || !R.linkWriteups) return null;
    if (WU && WU.W === W && WU.base === base) return WU.map;
    const map = new Map();
    for (const l of R.linkWriteups(W.items, base, W.links)) for (const code of l.codes || []) { if (!map.has(code)) map.set(code, []); map.get(code).push(R.tidyWriteup ? R.tidyWriteup(l.item) : l.item); }
    if (base.grouped && base.groupOf) for (const [code, g] of base.groupOf) if (map.has(code)) { if (!map.has(g)) map.set(g, []); for (const w of map.get(code)) if (!map.get(g).includes(w)) map.get(g).push(w); } // a group's write-ups are its deals'
    WU = { W, base, map };
    return map;
  }
  const cellOf = (v) => (v === null || v === undefined ? '' : typeof v === 'object' ? String(v.text !== undefined ? v.text : v.value !== undefined ? v.value : '') : String(v)).trim();
  const numOf = (v) => { const m = /-?\d+(?:[.,]\d+)?/.exec(cellOf(v).replace(/,(?=\d{3}\b)/g, '')); return m ? +m[0].replace(',', '.') : NaN; };
  /**
   * Which way a ratio is good: 'up' (cover: ICR, DSCR, LLCR), 'down' (leverage, LTV, gearing), or '' (not judged). As set on
   * Asset write-ups (ways: { label in lower case: 'up' | 'down' | 'none' }, kept with the team's data), else guessed from
   * the ratio's name.
   */
  let WAYS = null;
  const wayKey = (label) => norm(label);
  const guessWay = (label) => (/icr|dscr|llcr|plcr|cover/i.test(label) ? 'up' : /leverage|debt\s*\/|nd\s*\/|net debt|ltv|gearing|loan to value/i.test(label) ? 'down' : '');
  const goodWay = (label) => { const set = WAYS && WAYS[wayKey(label)]; return set === 'up' || set === 'down' ? set : set === 'none' ? '' : guessWay(label); };
  ASK.ratioWay = (label, ways) => { const set = ways && ways[wayKey(label)]; return { set: set || '', guess: guessWay(label), key: wayKey(label) }; };
  /** A write-up's ratios: [{ label, actual, lockup, covenant, state }]; state breach (past the covenant), lockup (past the lock-up), ok, or '' (cannot tell). */
  function ratios(w) {
    return (w.metrics || []).map((x) => {
      const label = cellOf(x.label), way = goodWay(label), a = numOf(x.actual), l = numOf(x.lockup), cv = numOf(x.covenant);
      const worse = (lim) => U.isNum(lim) && (way === 'up' ? a <= lim : a >= lim); // on the level counts as past it
      const state = !way || !U.isNum(a) ? '' : worse(cv) ? 'breach' : worse(l) ? 'lockup' : U.isNum(l) || U.isNum(cv) ? 'ok' : '';
      return { label, actual: cellOf(x.actual), lockup: cellOf(x.lockup), covenant: cellOf(x.covenant), state };
    }).filter((x) => x.label);
  }
  const ratioText = (x) => `${x.label} ${x.actual || '–'}${x.lockup ? `, lock-up ${x.lockup}` : ''}${x.covenant ? `, covenant ${x.covenant}` : ''}${x.state === 'breach' ? ' (past the covenant)' : x.state === 'lockup' ? ' (past the lock-up)' : ''}`;
  const firstSentence = (t) => { const m = /^(.{20,260}?[.!?])(\s|$)/.exec(cellOf(t)); return m ? m[1] : cellOf(t).slice(0, 260); };
  /** Every asset with a write-up whose ratios are past the lock-up or the covenant: [{ code, name, w, bad: [ratio] }], breaches first. */
  function ratioAlerts(res, c) {
    const map = writeupsBy(res, c); if (!map) return null;
    const names = new Map((res.base || res).assets.map((a) => [String(a.code), a.name])), out = [];
    for (const [code, list] of map) for (const w of list) { const bad = ratios(w).filter((x) => x.state === 'breach' || x.state === 'lockup'); if (bad.length) out.push({ code, name: names.get(String(code)) || w.name, w, bad }); }
    return out.sort((a, b) => (b.bad.some((x) => x.state === 'breach') ? 1 : 0) - (a.bad.some((x) => x.state === 'breach') ? 1 : 0));
  }
  /** Write-ups whose text (name, description, events) holds every word of `term`: [{ code, name, w, line }]. */
  function writeupSearch(res, c, term) {
    const map = writeupsBy(res, c); if (!map) return null;
    // each word by its stem, so "refinancing" finds "refinanced" and "waivers" finds "waiver"
    const words = norm(term).split(' ').filter((w) => w.length >= 3 && !STOP.has(w) && !MATCH_STOP.has(w)).map((w) => (w.length > 5 ? w.replace(/(ings?|ed|es|e|s)$/, '') : w)), names = new Map((res.base || res).assets.map((a) => [String(a.code), a.name])), out = [];
    if (!words.length) return [];
    for (const [code, list] of map) for (const w of list) {
      const lines = [cellOf(w.description)].concat((w.events || []).map(cellOf)).filter(Boolean);
      const all = norm(lines.join(' ') + ' ' + cellOf(w.name));
      if (!words.every((x) => all.includes(x))) continue;
      const line = lines.find((l) => words.some((x) => norm(l).includes(x))) || lines[0] || '';
      out.push({ code, name: names.get(String(code)) || w.name, w, line });
    }
    return out;
  }

  /** Does a write-up row label name this ratio key (METRICS)? headroom: any ratio that can be judged. */
  const isMetric = (label, key) => { const m = METRICS.find((x) => x[0] === key); return key === 'headroom' ? !!goodWay(label) : !!(m && m[2] && m[2].test(label)); };
  /** How far a ratio is from its covenant, as a share of the covenant (positive: on the right side). */
  const headroomOf = (label, a, cv) => { const way = goodWay(label); return way && U.isNum(a) && U.isNum(cv) && cv ? (way === 'up' ? a - cv : cv - a) / Math.abs(cv) : NaN; };
  const multiple = (v) => (U.isNum(v) ? `${fmtNum(v, 2)}x` : '–');
  /** The write-ups' ratios of one kind as rows: [{ code, name, label, actual, lockup, covenant, a, l, cv, head, state, exp }]. */
  function metricRows(res, c, key, codes) {
    const map = writeupsBy(res, c); if (!map) return null;
    const base = res.base || res, names = new Map(base.assets.map((a) => [String(a.code), a.name])), exp = new Map((res.rows || []).map((r) => [String(r.code), r.exposure_m || 0])), out = [];
    for (const [code, list] of map) {
      if (codes && !codes.has(String(code))) continue;
      for (const w of list) for (const x of ratios(w)) {
        if (!isMetric(x.label, key)) continue;
        const a = numOf(x.actual), l = numOf(x.lockup), cv = numOf(x.covenant);
        out.push(Object.assign({}, x, { code, name: names.get(String(code)) || cellOf(w.name), a, l, cv, head: headroomOf(x.label, a, cv), exp: exp.get(String(code)) || 0, rating: cellOf(w.rating) }));
      }
    }
    return out;
  }
  const headText = (h) => (U.isNum(h) ? `${fmtNum(Math.abs(h) * 100, 0)}% ${h >= 0 ? 'inside' : 'past'} the covenant` : '');

  /** Write-up questions across the book: who is past the lock-up or the covenant, or which write-ups mention something. */
  function writeupAnswer(res, query, c, out) {
    out.kind = 'list';
    if (!writeupsBy(res, c)) {
      out.headline = 'No write-ups loaded';
      out.sentence = 'Load the write-ups workbook on Asset write-ups: then I can answer from each asset\'s description, recent events and ratios.';
      out.actions.push({ kind: 'link', label: 'Open Asset write-ups', href: href('writeups'), primary: true });
      return out;
    }
    if (query.wu === 'metric') {
      const ds = E.dataset.build(res), key = query.metric, label = key === 'headroom' ? 'Covenant headroom' : key === 'leverage' ? 'Leverage' : key.toUpperCase();
      const narrowed = query.filters.length ? new Set(recordsFor(ds, Object.assign({}, query, { having: [] })).recs.map((r) => String(r.asset_code))) : null;
      let rows = metricRows(res, c, key, narrowed);
      const where = query.filters.length ? phrase(ds, query.filters, []) : '';
      if (query.mThreshold) { const t = query.mThreshold, ok = { gt: (v) => v > t.value, gte: (v) => v >= t.value, lt: (v) => v < t.value, lte: (v) => v <= t.value }[t.op]; rows = rows.filter((x) => (key === 'headroom' ? U.isNum(x.head) && ok(x.head * 100) : U.isNum(x.a) && ok(x.a))); }
      // worst first: the least headroom; else by the figure (cover lowest first, leverage highest first), or as asked (top / lowest)
      const up = rows.length ? goodWay(rows[0].label) !== 'down' : true;
      const by = key === 'headroom' ? (x) => x.head : (x) => x.a;
      let dir = key === 'headroom' ? 1 : up ? 1 : -1;
      if (query.top) dir = query.top.dir === 'asc' ? 1 : -1;
      rows.sort((x, y) => { const p = by(x), q2 = by(y); return (U.isNum(p) ? 0 : 1) - (U.isNum(q2) ? 0 : 1) || dir * ((U.isNum(p) ? p : 0) - (U.isNum(q2) ? q2 : 0)); });
      const n = rows.length, shown = query.top ? rows.slice(0, query.top.n) : rows;
      out.read.push({ k: 'From', v: `the write-ups: ${label}`, part: null });
      if (query.mThreshold) out.read.push({ k: label, v: query.mThreshold.text, part: null });
      if (where) out.read.push({ k: 'Where', v: where, part: null });
      if (!n) { out.headline = 'None'; out.sentence = `No write-up${where ? ' ' + where : ''} has ${key === 'headroom' ? 'a ratio with a covenant' : `a ${label}`}${query.mThreshold ? ` ${query.mThreshold.text}` : ''}.`; return out; }
      if (query.mAverage && key !== 'headroom') {
        const known = rows.filter((x) => U.isNum(x.a)), wsum = U.sum(known, (x) => x.exp), avg = wsum ? U.sum(known, (x) => x.a * x.exp) / wsum : U.sum(known, (x) => x.a) / (known.length || 1), plain = U.sum(known, (x) => x.a) / (known.length || 1);
        out.kind = 'value'; out.headline = multiple(avg);
        out.sentence = `Average ${label}${where ? ' ' + where : ''} is ${multiple(avg)}${wsum ? ', weighted by exposure' : ''}, over ${known.length} asset${known.length === 1 ? '' : 's'} with a write-up (plain average ${multiple(plain)}; lowest ${multiple(Math.min(...known.map((x) => x.a)))}, highest ${multiple(Math.max(...known.map((x) => x.a)))}).`;
      } else if (query.top && query.top.n === 1) {
        const x = shown[0]; out.headline = `${x.name}: ${key === 'headroom' ? headText(x.head) : x.actual}`;
        out.sentence = `${query.top.dir === 'asc' ? 'The lowest' : 'The highest'} ${label}${where ? ' ' + where : ''} is ${x.name}: ${ratioText(x)}${U.isNum(x.head) ? `, ${headText(x.head)}` : ''}.`;
      } else {
        out.headline = `${n} asset${n === 1 ? '' : 's'}`;
        const worst = rows[0];
        out.sentence = `${label} from the write-ups${where ? ' ' + where : ''}${query.mThreshold ? ` ${query.mThreshold.text}` : ''}: ${n} asset${n === 1 ? '' : 's'}${key === 'headroom' ? `, tightest ${worst.name} (${worst.label} ${worst.actual}, ${headText(worst.head)})` : `; ${up ? 'lowest' : 'highest'} ${worst.name} at ${worst.actual}`}.`;
      }
      out.table = { columns: [{ label: 'Asset' }, { label: 'Ratio' }, { label: 'Actual', num: true }, { label: 'Lock-up', num: true }, { label: 'Covenant', num: true }, { label: 'Headroom', num: true }, { label: 'Where' }, { label: 'Exposure', num: true }],
        rows: shown.map((x) => [{ text: x.name, href: href('asset', x.code) }, x.label, x.actual || '–', x.lockup || '–', x.covenant || '–', U.isNum(x.head) ? `${x.head >= 0 ? '' : '−'}${fmtNum(Math.abs(x.head) * 100, 0)}%` : '–', x.state === 'breach' ? 'past the covenant' : x.state === 'lockup' ? 'past the lock-up' : x.state === 'ok' ? 'clear' : '', m1(res, x.exp)]) };
      out.suggest = [`average ${key === 'headroom' ? 'DSCR' : label}`, 'which assets are in lock-up', `lowest ${key === 'headroom' ? 'ICR' : label}`];
      out.actions.push({ kind: 'link', label: 'Open Asset write-ups', href: href('writeups') });
      return out;
    }
    if (query.wu === 'ratios') {
      const list = ratioAlerts(res, c), breach = list.filter((x) => x.bad.some((r) => r.state === 'breach'));
      out.headline = list.length ? `${list.length} past the lock-up${breach.length ? `, ${breach.length} past the covenant` : ''}` : 'All clear';
      out.sentence = list.length ? `From the write-ups: ${list.slice(0, 4).map((x) => `${x.name} (${x.bad.map(ratioText).join('; ')})`).join('; ')}${list.length > 4 ? ' and more' : ''}.` : 'No write-up shows a ratio past its lock-up or covenant (ratios whose name does not say which way is good, such as a plain "Ratio", are not judged).';
      out.table = list.length ? { columns: [{ label: 'Asset' }, { label: 'Ratio' }, { label: 'Actual' }, { label: 'Lock-up' }, { label: 'Covenant' }, { label: 'Where' }], rows: list.flatMap((x) => x.bad.map((r) => [{ text: x.name, href: href('asset', x.code) }, r.label, r.actual, r.lockup, r.covenant, r.state === 'breach' ? 'past the covenant' : 'past the lock-up'])) } : null;
      out.read.push({ k: 'From', v: 'the write-ups: each ratio against its lock-up and covenant', part: null });
    } else {
      const term = query.wuTerm || '', list = writeupSearch(res, c, term);
      out.headline = `${list.length} write-up${list.length === 1 ? '' : 's'}`;
      out.sentence = list.length ? `Write-ups mentioning "${term}": ${list.slice(0, 5).map((x) => x.name).join(', ')}${list.length > 5 ? ' and more' : ''}.` : `No write-up mentions "${term}".`;
      out.table = list.length ? { columns: [{ label: 'Asset' }, { label: 'Where it says so' }], rows: list.map((x) => [{ text: x.name, href: href('asset', x.code) }, x.line]) } : null;
      out.read.push({ k: 'Searched', v: `the write-ups for "${term}"`, part: null });
    }
    out.actions.push({ kind: 'link', label: 'Open Asset write-ups', href: href('writeups') });
    out.suggest = ['which assets are in lock-up', 'anything I should worry about'];
    return out;
  }

  // ---------- against the month before, and what deserves a look ----------
  /** Does answering this query need the month before (ctx.previous: { res, name })? The page reads it only then. */
  ASK.needsPrevious = (query) => !!query && (query.intent === 'change' || query.intent === 'digest');
  const WEAKER = 'weaker', STRONGER = 'stronger';
  /** One asset's Output row by code; rows of the filtered view. */
  const rowsByCode = (rows) => new Map((rows || []).map((r) => [String(r.code), r]));
  /** The asset codes a query's filters keep in a result (all its rows when there are no filters). */
  function keptCodes(res, query) {
    if (!query.filters.length && !query.having.length) return null;
    const ds = E.dataset.build(res), { recs } = recordsFor(ds, query);
    return new Set(recs.map((r) => String(r.asset_code)));
  }
  /** Rating moves between two months: [{ row, was, now, notches }] (a notch is a step of the rating scale; positive = weaker). */
  function ratingMoves(prevRows, rows, res) {
    // notches: steps between the two grades on the rating scale (its numbers are not evenly spaced)
    const steps = Array.from(new Set(((res && res.ratingScale) || []).map((x) => x.numeric).filter((v) => U.isNum(v) && v > 0))).sort((a, b) => a - b);
    const rank = (v) => { let i = 0; while (i < steps.length && steps[i] < v) i++; return i; };
    const before = rowsByCode(prevRows), out = [];
    for (const r of rows || []) {
      const p = before.get(String(r.code)); if (!p || !U.isNum(r.rating_numeric) || !U.isNum(p.rating_numeric) || r.rating_numeric === p.rating_numeric) continue;
      const d = r.rating_numeric - p.rating_numeric, n = steps.length ? Math.abs(rank(r.rating_numeric) - rank(p.rating_numeric)) || 1 : NaN;
      out.push({ row: r, was: p.rating, now: r.rating, d, notches: n });
    }
    return out.sort((x, y) => (y.notches || 0) - (x.notches || 0) || Math.abs(y.d) - Math.abs(x.d));
  }
  const m1 = (res, v) => `${res.displayCurrency || 'EUR'} ${U.fmt.m(v)}m`;
  const sgn = (res, v) => (U.isNum(v) ? (v > 0.05 ? '+' : v < -0.05 ? '−' : '') + m1(res, Math.abs(v)) : '–');
  const assetCell = (r) => ({ text: r.name || r.code, href: href('asset', r.code), sub: r.code_name || '' });

  function changeAnswer(res, query, c, out, ds, V) {
    const prev = c.previous, CMP = Scope.compare;
    out.kind = 'change';
    if (!prev || !prev.res || !CMP) {
      out.headline = 'No earlier month to compare with';
      out.sentence = 'To see what changed, Scope needs the month before: choose the Holdings folder on Data › Inputs (each file a month), or load the new month over the old one (the previous Holdings is kept). Then ask again.';
      out.actions.push({ kind: 'link', label: 'Open Data › Inputs', href: href('data', 'inputs'), primary: true });
      return out;
    }
    if (prev.current) { res = prev.current; out.read.push({ k: 'Corrections', v: 'left out on both sides, so only the files\' own changes show', part: null }); }
    const keepNow = keptCodes(res, query), keepThen = keptCodes(prev.res, query);
    const now = (res.rows || []).filter((r) => !keepNow || keepNow.has(String(r.code))), then = (prev.res.rows || []).filter((r) => !keepThen || keepThen.has(String(r.code)));
    const where = phrase(ds, query.filters, query.having), span = `from ${prev.name} to ${c.currentName || 'the loaded month'}`;
    out.read.push({ k: 'Compared', v: `${prev.name} → ${c.currentName || 'loaded data'}`, part: null });
    query.filters.forEach((f, i) => out.read.push(Object.assign(describe(ds, f), { part: 'filter:' + i })));
    const mv = CMP.assets(then, now), n = CMP.counts(mv), moves = ratingMoves(then, now, res);
    const total = U.sum(mv, (a) => a.change), down = moves.filter((x) => x.d > 0), up = moves.filter((x) => x.d < 0);
    const list = (items, cols, row) => ({ columns: cols, rows: items.slice(0, 25).map(row), more: Math.max(0, items.length - 25) });
    const k = query.change;
    if (k === 'new' || k === 'exited') {
      const items = mv.filter((a) => a.status === k);
      out.headline = `${fmtNum(items.length, 0)} ${k === 'new' ? 'new' : 'exited'}`;
      out.sentence = items.length ? `${items.length} asset${items.length === 1 ? '' : 's'} ${k === 'new' ? 'came in' : 'left'}${where ? ' ' + where : ''} ${span}, ${sgn(res, U.sum(items, (a) => a.change))} of exposure${k === 'new' && items[0] ? `; the largest is ${items[0].name}` : ''}.` : `No asset ${k === 'new' ? 'came in' : 'left'}${where ? ' ' + where : ''} ${span}.`;
      out.table = items.length ? list(items, [{ label: 'Asset' }, { label: 'Sector' }, { label: 'Country' }, { label: k === 'new' ? 'Exposure' : 'Exposure before', num: true }], (a) => [{ text: a.name, href: href('asset', a.code) }, a.sector || '', a.country || '', m1(res, k === 'new' ? a.to : a.from)]) : null;
    } else if (k === 'downgrades' || k === 'upgrades') {
      const items = k === 'downgrades' ? down : up;
      out.headline = `${fmtNum(items.length, 0)} ${items.length === 1 ? k.replace(/s$/, '') : k}`;
      out.sentence = items.length ? `${items.length} asset${items.length === 1 ? ' was' : 's were'} ${k === 'downgrades' ? 'downgraded' : 'upgraded'}${where ? ' ' + where : ''} ${span}: ` + items.slice(0, 3).map((x) => `${x.row.name} ${x.was} → ${x.now}`).join(', ') + (items.length > 3 ? ' and more' : '') + '.' : `No asset was ${k === 'downgrades' ? 'downgraded' : 'upgraded'}${where ? ' ' + where : ''} ${span}.`;
      out.table = items.length ? list(items, [{ label: 'Asset' }, { label: 'Before' }, { label: 'Now' }, { label: 'Notches', num: true }, { label: 'Exposure', num: true }], (x) => [assetCell(x.row), x.was || 'NR', x.now || 'NR', (U.isNum(x.notches) ? fmtNum(x.notches, 0) + ' ' : '') + (x.d > 0 ? WEAKER : STRONGER), m1(res, x.row.exposure_m)]) : null;
    } else if (k === 'movers') {
      const items = mv.filter((a) => a.status !== 'same');
      out.headline = items[0] ? `${items[0].name}: ${sgn(res, items[0].change)}` : 'No movement';
      out.sentence = items.length ? `Biggest movements${where ? ' ' + where : ''} ${span}: ` + items.slice(0, 3).map((a) => `${a.name} ${sgn(res, a.change)}`).join(', ') + '.' : `No asset's exposure moved${where ? ' ' + where : ''} ${span}.`;
      out.table = items.length ? list(items, [{ label: 'Asset' }, { label: 'Before', num: true }, { label: 'Now', num: true }, { label: 'Change', num: true }, { label: 'What' }], (a) => [{ text: a.name, href: href('asset', a.code) }, U.isNum(a.from) ? m1(res, a.from) : '–', U.isNum(a.to) ? m1(res, a.to) : '–', sgn(res, a.change), { new: 'new', exited: 'exited', up: 'up', down: 'down' }[a.status]]) : null;
    } else {
      const fNow = query.filters.length ? null : res.metrics, fThen = query.filters.length ? null : prev.res.metrics;
      out.headline = `${sgn(res, total)} exposure`;
      out.sentence = `${span[0].toUpperCase() + span.slice(1)}${where ? ', ' + where : ''}: exposure ${sgn(res, total)}; ${n.new} new, ${n.exited} exited, ${n.up} up, ${n.down} down; ${down.length} downgrade${down.length === 1 ? '' : 's'}, ${up.length} upgrade${up.length === 1 ? '' : 's'}.`;
      if (fNow && fThen) {
        const figs = CMP.figures(fThen, fNow).filter((f) => ['total_exposure_m', 'total_drawn_m', 'n_assets', 'w_margin_bps', 'w_rating_label', 'w_wal_years', 'sub_ig_share', 'watchlist_share'].includes(f.key));
        const txt = (f, v) => (f.kind === 'm' ? m1(res, v) : f.kind === 'pct' ? U.fmt.pct(v) : f.kind === 'bps' ? `${fmtNum(v, 0)} bps` : f.kind === 'yrs' ? `${fmtNum(v, 1)} y` : f.kind === 'rating' ? v || '–' : fmtNum(v, 0));
        const chg = (f) => (f.kind === 'rating' ? (U.isNum(f.change) && Math.abs(f.change) >= 1 ? (f.change > 0 ? WEAKER : STRONGER) : 'no change') : f.kind === 'pct' ? `${f.change >= 0 ? '+' : '−'}${fmtNum(Math.abs(f.change * 100), 1)} pp` : f.kind === 'm' ? sgn(res, f.change) : `${f.change >= 0 ? '+' : '−'}${txt(f, Math.abs(f.change))}`);
        out.table = { columns: [{ label: 'Figure' }, { label: prev.name, num: true }, { label: c.currentName || 'Now', num: true }, { label: 'Change', num: true }], rows: figs.map((f) => [f.label, txt(f, f.from), txt(f, f.to), chg(f)]) };
      }
    }
    out.actions.push({ kind: 'link', label: 'Compare in full on the AUM overview', href: href('aum'), primary: true });
    out.suggest = ['new deals', 'what exited', 'downgrades', 'biggest movers', 'what changed'].filter((x) => !(k === 'new' && x === 'new deals') && !(k === 'exited' && x === 'what exited') && !(k === 'downgrades' && x === 'downgrades') && !(k === 'movers' && x === 'biggest movers') && !(k === 'summary' && x === 'what changed'));
    return out;
  }

  /** What deserves a look in the loaded month: watchlist, maturities within a year, concentration, rating mix, data gaps, issues, and the month's changes when the month before is there. */
  function digestAnswer(res, query, c, out, ds, V) {
    out.kind = 'digest';
    const rows = res.rows || [], tot = U.sum(rows, (r) => r.exposure_m || 0) || 0, pct = (v) => (tot ? U.fmt.pct(v / tot) : '–');
    const sum = (rs) => U.sum(rs, (r) => r.exposure_m || 0), names = (rs) => rs.slice().sort((a, b) => (b.exposure_m || 0) - (a.exposure_m || 0)).slice(0, 3).map((r) => r.name).join(', ') + (rs.length > 3 ? ` and ${rs.length - 3} more` : '');
    const F = []; // [area, finding, ask next]
    const watch = rows.filter((r) => r.watchlist && !/^(no|none|n)$/i.test(String(r.watchlist)));
    F.push(['Watchlist', watch.length ? `${watch.length} asset${watch.length === 1 ? '' : 's'}, ${m1(res, sum(watch))} (${pct(sum(watch))}): ${names(watch)}` : 'nothing on the watchlist', watch.length ? 'which assets are on the watchlist' : null, watch.length ? 2 : 0]);
    const soon = rows.filter((r) => U.isNum(r.remaining_years) && r.remaining_years >= 0 && r.remaining_years <= 1), past = rows.filter((r) => U.isNum(r.remaining_years) && r.remaining_years < 0);
    F.push(['Maturing within a year', soon.length ? `${soon.length} asset${soon.length === 1 ? '' : 's'}, ${m1(res, sum(soon))}: ${names(soon)}` : 'nothing matures in the next 12 months', soon.length ? 'assets maturing in the next 12 months' : null, soon.length ? 1 : 0]);
    if (past.length) F.push(['Past maturity', `${past.length} asset${past.length === 1 ? '' : 's'} still held after the maturity date: ${names(past)}`, null, 2]);
    const share = (field) => { const m = new Map(); for (const r of rows) m.set(r[field] || '(blank)', (m.get(r[field] || '(blank)') || 0) + (r.exposure_m || 0)); return Array.from(m).sort((a, b) => b[1] - a[1])[0] || ['', 0]; };
    const big = rows.slice().sort((a, b) => (b.exposure_m || 0) - (a.exposure_m || 0))[0], sec = share('sector'), cty = share('country');
    if (big) F.push(['Concentration', `largest asset ${big.name} ${pct(big.exposure_m)}; largest sector ${sec[0]} ${pct(sec[1])}; largest country ${cty[0]} ${pct(cty[1])}`, 'top 10 assets', 0]);
    const subIg = rows.filter((r) => r.rating_status === 'rated' && r.ig_label && r.ig_label !== 'IG'), nr = rows.filter((r) => r.rating_status !== 'rated');
    F.push(['Ratings', `sub-IG ${pct(sum(subIg))} (${subIg.length} asset${subIg.length === 1 ? '' : 's'}); not rated ${pct(sum(nr))} (${nr.length}); average ${res.metrics && res.metrics.w_rating_label || '–'}`, subIg.length ? 'list sub-IG assets' : null, 0]);
    const gaps = [['rating', rows.filter((r) => r.rating_status !== 'rated')], ['spread', rows.filter((r) => !U.isNum(r.margin_bps))], ['maturity date', rows.filter((r) => !r.maturity_date)]].filter(([, rs]) => rs.length);
    if (gaps.length) F.push(['Gaps in the data', gaps.map(([k, rs]) => `${rs.length} without a ${k}`).join(', '), null, 1]);
    const al = ratioAlerts(res, c);
    if (al) { const br = al.filter((x) => x.bad.some((r) => r.state === 'breach')); F.push(['Covenants (write-ups)', al.length ? `${al.length} asset${al.length === 1 ? '' : 's'} past the lock-up${br.length ? `, ${br.length} past the covenant` : ''}: ${al.slice(0, 3).map((x) => `${x.name} (${x.bad.map(ratioText).join('; ')})`).join('; ')}${al.length > 3 ? ' and more' : ''}` : 'no ratio past its lock-up or covenant', al.length ? 'which assets are in lock-up' : null, al.length ? (br.length ? 3 : 2) : 0]); }
    const ic = res.issueCounts || {};
    if (ic.error) F.push(['Data issues', `${ic.error} error${ic.error === 1 ? '' : 's'} (positions left out of AUM), ${ic.warn || 0} warning${ic.warn === 1 ? '' : 's'}`, 'any data issues', 2]);
    if (c.previous && c.previous.res && Scope.compare) {
      const mv = Scope.compare.assets(c.previous.res.rows, rows), n = Scope.compare.counts(mv), down = ratingMoves(c.previous.res.rows, rows, res).filter((x) => x.d > 0);
      F.push([`Since ${c.previous.name}`, `exposure ${sgn(res, U.sum(mv, (a) => a.change))}; ${n.new} new, ${n.exited} exited; ${down.length} downgrade${down.length === 1 ? '' : 's'}${down.length ? ': ' + down.slice(0, 3).map((x) => `${x.row.name} ${x.was} → ${x.now}`).join(', ') : ''}`, down.length ? 'downgrades' : 'what changed', down.length ? 2 : 0]);
    }
    const look = F.filter((f) => f[3] > 0);
    out.headline = look.length ? `${look.length} thing${look.length === 1 ? '' : 's'} to look at` : 'Nothing stands out';
    out.sentence = look.length ? look.sort((a, b) => b[3] - a[3]).map((f) => `${f[0]}: ${f[1]}`).slice(0, 2).join('. ') + '.' : 'No watchlist names, no maturities within a year and no data errors in the view.';
    out.read.push({ k: 'In', v: `${(res.platform && res.platform.label) || 'the view'} · ${res.displayCurrency || 'EUR'}${c.previous ? ' · against ' + c.previous.name : ''}`, part: null });
    out.table = { columns: [{ label: 'Area' }, { label: 'What I found' }], rows: F.map((f) => [f[0], f[1]]) };
    out.suggest = F.map((f) => f[2]).filter(Boolean).slice(0, 5);
    out.actions.push({ kind: 'link', label: 'Concentration & risk', href: href('concentration'), primary: true });
    return out;
  }

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
    return ['Anything I should worry about?', 'What is the total exposure?', asset ? `Tell me about ${asset.name}` : 'Top 10 assets by exposure', country ? `Exposure in ${country} by sector` : 'Exposure by country', 'What changed since last month?', yr ? `Which assets mature before ${yr}?` : 'Exposure by maturity',
      'Average margin of sub-IG assets', asset ? `Is ${asset.name} on the watchlist?` : 'How many assets are on the watchlist?', sector ? `Largest sponsors in ${sector}` : 'Largest sponsors', 'How do I load a new month?'];
  };
})(typeof window !== 'undefined' ? window : globalThis);
