/* Scope · checking Scope's figures against your own data (js/analysis/tieout.js).
 *
 * Registers Scope.tieout. Two kinds of check, both run on the workbook you have loaded (never on the demo or test files):
 *
 *   tieout.compare(res, ref)   the tie-out: Scope's result against the workbook's own Output and Calculations sheets,
 *                              when the workbook was loaded with those tabs. They are read for this comparison only and
 *                              never feed the calculation. Output: asset by asset, every column Scope also produces.
 *                              Calculations: position by position (rows 5 onwards, matched by the backend identifier in C)
 *                              and asset by asset in the per-asset split (DB to GK, matched by the code name in DB).
 *   tieout.internal(res, LT)   checks that hold for any workbook: every position counted or excluded with a reason, the
 *                              investor columns add up to each asset, the group share, each view and the Output rows add
 *                              up, the headline figures equal the sum of the rows, look-through reconciles, and the
 *                              workbook formula checks (Data › Checks) passed.
 *   tieout.context(grid, res)  the view and currency the workbook's Output sheet was saved on (Output!G8 and G6), so the
 *                              caller can run Scope on the same view and currency before comparing.
 *
 * Each check returns { id, area, title, status: 'pass' | 'fail' | 'warn' | 'skip', detail, compared, differences,
 * examples: [{ where, item, workbook, scope, diff }] }. Amounts are compared to one currency unit (0.000001 in millions);
 * other numbers to 0.0001%; text ignoring capitals and spaces, with blank, 0 and Excel errors read as the same empty value
 * (Excel shows an empty looked-up cell as 0).
 */
(function (global) {
  'use strict';
  const Scope = global.Scope;
  const TO = (Scope.tieout = {});
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const nk = (s) => String(s === null || s === undefined ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const EXCEL_ERR = /^#(n\/a|ref!|value!|div\/0!|name\?|null!|num!|spill!|calc!|getting_data)$/i;
  const colName = (i) => { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const colIndex = (l) => String(l).toUpperCase().split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
  const MAX_EXAMPLES = 25;
  TO.REFERENCE_SHEETS = ['Output', 'Calculations'];

  // ---------- reading cells ----------
  const cell = (g, r, c) => { const row = g && g.rows && g.rows[r]; const v = row ? row[c] : undefined; return v === undefined ? null : v; };
  const blank = (v) => v === null || v === undefined || (typeof v === 'string' && (v.trim() === '' || EXCEL_ERR.test(v.trim())));
  /** A number from a cell (numbers typed as text too: "1,234.5", "(5)"), else null. */
  function num(v) {
    if (isNum(v)) return v;
    if (typeof v !== 'string') return null;
    let s = v.trim().replace(/[\s,€£$]/g, '');
    if (!s) return null;
    let neg = false; if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
    return neg ? -+s : +s;
  }
  /** 'yyyy-mm-dd' from an Excel date number, a Date or date text; '' when there is none. */
  function isoDay(v) {
    if (blank(v)) return '';
    if (isNum(v)) return v > 20000 && v < 80000 ? new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000).toISOString().slice(0, 10) : String(v);
    const d = Scope.util.parseDate(v);
    return d ? d.toISOString().slice(0, 10) : String(v).trim();
  }
  /** Text as compared: blank, 0 and Excel errors are one empty value; capitals and runs of spaces ignored. */
  const text = (v) => (blank(v) || v === 0 || v === '0' ? '' : String(v).trim().replace(/\s+/g, ' ').toLowerCase());

  /**
   * Compare one value. `kind` is 'amount' (tolerance `unitTol`), 'number', 'date' or 'text'.
   * Returns null when they agree, else { workbook, scope, diff }.
   */
  function same(wb, sc, kind, unitTol) {
    if (kind === 'amount' || kind === 'number') {
      const a = num(wb), b = isNum(sc) ? sc : num(sc);
      if (a === null && b === null) return null;
      if ((a === null || a === 0) && (b === null || b === 0)) return null; // an empty amount and 0 are the same
      if (a === null || b === null) return { workbook: wb, scope: sc, diff: null };
      const tol = kind === 'amount' ? unitTol : 1e-6 * Math.max(Math.abs(a), Math.abs(b)) + 1e-9;
      return Math.abs(a - b) <= tol ? null : { workbook: a, scope: b, diff: b - a };
    }
    if (kind === 'date') { const a = isoDay(wb), b = isoDay(sc); return a === b ? null : { workbook: a || '(blank)', scope: b || '(blank)', diff: null }; }
    const a = text(wb), b = text(isNum(sc) ? String(sc) : sc);
    if (a === b) return null;
    const an = num(wb), bn = isNum(sc) ? sc : num(sc); // "565" against 565
    if (an !== null && bn !== null && Math.abs(an - bn) <= 1e-6 * Math.max(Math.abs(an), Math.abs(bn)) + 1e-9) return null;
    return { workbook: blank(wb) ? '(blank)' : wb, scope: blank(sc) ? '(blank)' : sc, diff: null };
  }

  /** A check result with its counters; `add` records one comparison. */
  function newCheck(id, area, title, material) {
    const ck = { id, area, title, material: !!material, status: 'pass', detail: '', compared: 0, differences: 0, examples: [], maxDiff: 0 };
    ck.add = (where, item, d) => {
      ck.compared++;
      if (!d) return;
      ck.differences++;
      if (isNum(d.diff)) ck.maxDiff = Math.max(ck.maxDiff, Math.abs(d.diff));
      if (ck.examples.length < MAX_EXAMPLES) ck.examples.push({ where, item, workbook: d.workbook, scope: d.scope, diff: d.diff });
    };
    return ck;
  }
  function close(ck) {
    delete ck.add;
    if (ck.status === 'skip') return ck;
    if (ck.differences) ck.status = ck.material ? 'fail' : 'warn';
    if (!ck.detail) ck.detail = ck.differences ? `${ck.differences} of ${ck.compared} differ` : `${ck.compared} compared, all agree`;
    return ck;
  }
  const skip = (id, area, title, why) => ({ id, area, title, status: 'skip', detail: why, compared: 0, differences: 0, examples: [] });

  // ---------- the view and currency the workbook's Output was saved on ----------
  const SYMBOL = { '€': 'EUR', '£': 'GBP', $: 'USD', '¥': 'JPY' };
  /**
   * { view, viewCell, currency, currencyCell, platformId }: Output!G8 and Output!G6 as the workbook has them. When G8 is not
   * a view Scope knows, the first cell of rows 1 to 12 naming one is used instead. platformId is Scope's view of that name.
   */
  TO.context = function (grid, res) {
    const out = { view: '', viewCell: '', currency: '', currencyCell: '', platformId: null };
    if (!grid || !grid.rows) return out;
    const byKey = new Map((res.platforms || []).map((p) => [nk(p.id), p.id]).concat((res.platforms || []).map((p) => [nk(p.label), p.id])));
    const g8 = cell(grid, 7, 6);
    if (!blank(g8)) { out.view = String(g8).trim(); out.viewCell = 'G8'; out.platformId = byKey.get(nk(g8)) || null; }
    if (!out.platformId) {
      for (let r = 0; r < 12 && !out.platformId; r++) for (let c = 0; c < ((grid.rows[r] || []).length); c++) {
        const v = cell(grid, r, c);
        if (!blank(v) && typeof v === 'string' && byKey.has(nk(v))) { out.view = v.trim(); out.viewCell = colName(c) + (r + 1); out.platformId = byKey.get(nk(v)); break; }
      }
    }
    const g6 = cell(grid, 5, 6);
    if (!blank(g6)) {
      const s = String(g6).trim(), up = s.toUpperCase();
      out.currency = /^[A-Z]{3}$/.test(up) ? up : SYMBOL[s.charAt(0)] || '';
      out.currencyCell = 'G6';
    }
    return out;
  };

  // ---------- matching rows ----------
  /** The column (index) of `grid` rows [r0, r1) whose values best match `keys` (a Map of nk(value) → record). */
  function keyColumn(grid, r0, r1, keys, onlyCols) {
    let best = null;
    const width = Math.max(0, ...grid.rows.slice(r0, r1).map((r) => (r ? r.length : 0)));
    for (let c = 0; c < width; c++) {
      if (onlyCols && !onlyCols.includes(c)) continue;
      let filled = 0, hit = 0;
      for (let r = r0; r < r1; r++) { const v = cell(grid, r, c); if (blank(v) || v === 0) continue; filled++; if (keys.has(nk(v))) hit++; }
      if (hit && (!best || hit > best.hit)) best = { col: c, hit, filled };
    }
    return best && best.hit >= Math.max(1, best.filled * 0.5) ? best : null;
  }

  // ---------- the Output sheet ----------
  const AMOUNT_COL = (c) => c.type === 'number' && /\bm$/.test(c.unitLabel || '');
  /** Columns whose differences come from a decision Scope makes on purpose, with the reason shown beside them. */
  const DESIGN = {
    fixedfloating: 'Scope reads the Rate Type text itself (e.g. "EURIBOR 6M" is Floating) and shows "Mixed" when tranches differ; the workbook copies the Holdings value.',
    currency: 'Scope shows "Multi" when an asset\'s tranches are in different currencies; the workbook shows the first tranche\'s.',
    invgrd: 'Scope shows "NR" for an unrated asset; the workbook shows "IG" (a score of 0 is not above the threshold).',
    maturityatinception: 'Scope leaves the initial tenor blank when a date is missing; the workbook\'s IFERROR shows 0.',
  };

  function compareOutput(res, grid, checks) {
    const L = Scope.workbookLayout;
    const cols = L.outputColumns(res);
    const labels = new Map(); cols.forEach((c) => { const k = nk(c.label); if (k && !labels.has(k)) labels.set(k, []); if (k) labels.get(k).push(c); });
    // the header row: the row of the first 40 with the most Scope Output labels
    let hr = -1, bestScore = 0;
    for (let r = 0; r < Math.min(40, grid.rows.length); r++) {
      const seen = new Set();
      for (const v of grid.rows[r] || []) if (!blank(v) && labels.has(nk(v))) seen.add(nk(v));
      if (seen.size > bestScore) { bestScore = seen.size; hr = r; }
    }
    if (hr < 0 || bestScore < 3) { checks.push(skip('output-header', 'Output: assets and amounts', 'Output sheet layout', 'No header row with the Output column names was found in the first 40 rows of the Output tab.')); return; }
    // workbook column → Scope column (a label used twice is paired in order)
    const used = new Map(), map = [];
    (grid.rows[hr] || []).forEach((v, c) => {
      const k = nk(v); if (!k || !labels.has(k)) return;
      const n = used.get(k) || 0; used.set(k, n + 1);
      const sc = labels.get(k)[Math.min(n, labels.get(k).length - 1)];
      map.push({ c, sc });
    });
    // asset rows: matched by whichever workbook column holds Scope's code names, names or IDs
    const rows = res.rows || [];
    const keys = new Map();
    for (const r of rows) for (const v of [r.code_name, r.name, r.code]) if (!blank(v) && !keys.has(nk(v))) keys.set(nk(v), r);
    const r0 = hr + 1, r1 = grid.rows.length;
    const kc = keyColumn(grid, r0, r1, keys);
    if (!kc) { checks.push(skip('output-rows', 'Output: assets and amounts', 'Output rows', 'No column of the Output tab holds the assets\' code names, names or identification IDs, so its rows cannot be matched to Scope\'s.')); return; }
    const keyLabel = String(cell(grid, hr, kc.col) || colName(kc.col));
    const rowsCk = newCheck('output-rows', 'Output: assets and amounts', 'Assets listed on the Output sheet', true);
    const matched = new Map();
    for (let r = r0; r < r1; r++) {
      const v = cell(grid, r, kc.col);
      if (blank(v) || v === 0) continue;
      const sr = keys.get(nk(v));
      const exp = map.find((m) => nk(m.sc.label) === 'selectionexposure');
      if (!sr) { rowsCk.add(`row ${r + 1}`, String(v), { workbook: 'listed' + (exp && num(cell(grid, r, exp.c)) !== null ? ` (${num(cell(grid, r, exp.c))}m)` : ''), scope: 'not on Scope\'s Output', diff: null }); continue; }
      if (matched.has(sr)) { rowsCk.add(`row ${r + 1}`, String(v), { workbook: 'listed twice', scope: `row ${matched.get(sr) + 1}`, diff: null }); continue; }
      matched.set(sr, r); rowsCk.add(`row ${r + 1}`, String(v), null);
    }
    for (const sr of rows) if (!matched.has(sr)) rowsCk.add('Scope rank ' + sr.rank, sr.code_name || sr.name, { workbook: 'not listed', scope: `on Scope's Output (${(+sr.exposure_m).toFixed(3)}m)`, diff: null });
    rowsCk.detail = `${matched.size} of ${rows.length} Scope assets matched by the workbook's "${keyLabel}" column (header row ${hr + 1})` + (rowsCk.differences ? `; ${rowsCk.differences} listed on one side only` : '');
    checks.push(close(rowsCk));
    // every column both produce, value by value
    const unitTol = 1 / ((res.config || {}).unit || 1e6); // one currency unit, in the Output's millions
    const byLabel = new Map();
    for (const { c, sc } of map) {
      if (sc.exists === false) continue; // a Holdings column this extract does not carry: Scope shows it blank
      const kind = AMOUNT_COL(sc) ? 'amount' : sc.type === 'date' ? 'date' : sc.type === 'number' ? 'number' : 'text';
      const title = String(cell(grid, hr, c));
      const ck = newCheck('output-col-' + colName(c), AMOUNT_COL(sc) ? 'Output: assets and amounts' : 'Output: descriptive columns', `${title} (Output ${colName(c)})`, AMOUNT_COL(sc));
      let wbSum = 0, scSum = 0;
      for (const [sr, r] of matched) {
        let sv; try { sv = sc.get(sr); } catch (e) { sv = ''; }
        const wv = cell(grid, r, c);
        if (kind === 'amount') { wbSum += num(wv) || 0; scSum += num(sv) || 0; }
        ck.add(sr.code_name || sr.name, title, same(wv, sv, kind, unitTol));
      }
      if (kind === 'amount') { ck.totals = { workbook: wbSum, scope: scSum }; if (!ck.differences) ck.detail = `${ck.compared} assets agree; total ${scSum.toFixed(3)}m`; }
      const why = DESIGN[nk(sc.label)]; if (why && ck.differences) { ck.note = why; ck.material = false; }
      byLabel.set(nk(title), true);
      checks.push(close(ck));
    }
  }

  // ---------- the Calculations sheet ----------
  /** Labels of a workbook column in its header rows 1 to 4, compared form. */
  const headLabels = (grid, c) => [0, 1, 2, 3].map((r) => nk(cell(grid, r, c))).filter(Boolean);
  /** Plain names for Calculations columns whose row-3 label is a formula or blank. */
  const LETTER_NAMES = { CJ: 'reporting currency flag', CL: 'FX rate used', CN: 'display currency rate per EUR', CP: 'nominal in the display currency', CR: 'drawn in the display currency', CT: 'commitment in the display currency',
    DB: 'code name', DC: 'identification ID', DD: 'assets with exposure in the view', DE: 'listed asset number', DF: 'running number', DI: 'nominal in the selected view', FA: 'drawn in the selected view' };
  const MATERIAL_POS = new Set(['A', 'B', 'C', 'D', 'E', 'K', 'CI', 'CK', 'CL', 'CN', 'CO', 'CP', 'CQ', 'CR', 'CS', 'CT', 'CY', 'GW', 'GX', 'GY', 'GZ', 'HA']);
  /** Does Scope's column definition `sc` describe workbook column `c`? A formula label (=…) or a blank label is taken on its letters. */
  const labelOk = (grid, c, sc) => { const k = nk(sc.label); return !k || /^=/.test(String(sc.label)) || headLabels(grid, c).includes(k); };

  function comparePositions(res, grid, checks) {
    const L = Scope.workbookLayout;
    const cols = L.positionColumns(res).filter((c) => /^[A-Z]{1,3}$/.test(c.letters || ''));
    const C = colIndex('C');
    // the rows: from row 5, each with a backend identifier (investor code x Security ID) in C
    const byKey = new Map();
    for (const p of res.positions || []) { const k = nk(p.key); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(p); }
    const pairs = [], only = newCheck('calc-rows', 'Calculations: positions', 'Positions on the Calculations sheet', true);
    const taken = new Map();
    for (let r = 4; r < grid.rows.length; r++) {
      const v = cell(grid, r, C);
      if (blank(v) || /^0?x0?$/i.test(String(v).trim())) continue; // padded formula rows read "0x0"
      const list = byKey.get(nk(v)), n = taken.get(nk(v)) || 0;
      if (!list || !list[n]) { only.add(`row ${r + 1}`, String(v), { workbook: 'present', scope: 'no such position', diff: null }); continue; }
      taken.set(nk(v), n + 1); pairs.push([list[n], r]); only.add(`row ${r + 1}`, String(v), null);
    }
    if (!pairs.length) { checks.push(skip('calc-rows', 'Calculations: positions', 'Positions on the Calculations sheet', 'No row from row 5 down has a backend identifier (column C) that matches a Scope position.')); return; }
    for (const [k, list] of byKey) { const n = taken.get(k) || 0; for (const p of list.slice(n)) only.add('Holdings row ' + p.line, p.key, { workbook: 'missing', scope: 'position', diff: null }); }
    only.detail = `${pairs.length} positions matched by column C` + (only.differences ? `; ${only.differences} on one side only` : '');
    checks.push(close(only));
    const unlabelled = [];
    for (const sc of cols) {
      const c = colIndex(sc.letters);
      if (c === C) continue;
      if (!labelOk(grid, c, sc)) { unlabelled.push(`${sc.letters} (Scope: "${sc.label}", workbook: "${[0, 1, 2, 3].map((r) => cell(grid, r, c)).filter((x) => !blank(x)).join(' / ') || 'blank'}")`); continue; }
      const kind = sc.type === 'number' ? (/^C[O-T]$|^CY$/.test(sc.letters) ? 'amount' : 'number') : sc.type === 'date' ? 'date' : 'text';
      const ck = newCheck('calc-' + sc.letters, MATERIAL_POS.has(sc.letters) ? 'Calculations: positions' : 'Calculations: other position columns', `${sc.letters} ${sc.label && !/^=/.test(sc.label) ? sc.label : LETTER_NAMES[sc.letters] || ''}`.trim(), MATERIAL_POS.has(sc.letters));
      for (const [p, r] of pairs) { let sv; try { sv = sc.get(p); } catch (e) { sv = ''; } ck.add(`row ${r + 1} · ${p.key}`, sc.letters, same(cell(grid, r, c), sv, kind, 1)); }
      checks.push(close(ck));
    }
    if (unlabelled.length) checks.push({ id: 'calc-labels', area: 'Calculations: positions', title: 'Columns not compared because their label differs', status: 'warn', detail: `${unlabelled.length} column(s): the workbook's label is not the one Scope expects at that letter, so the column may have moved`, compared: unlabelled.length, differences: unlabelled.length, examples: unlabelled.slice(0, MAX_EXAMPLES).map((x) => ({ where: x, item: '', workbook: '', scope: '', diff: null })) });
  }

  function compareAssetSplit(res, grid, checks) {
    const L = Scope.workbookLayout;
    const cols = L.assetColumns(res);
    const DB = colIndex('DB');
    const assets = (res.assets || []).filter((a) => a.inActiveList);
    const keys = new Map(); for (const a of assets) if (!blank(a.code_name) && !keys.has(nk(a.code_name))) keys.set(nk(a.code_name), a);
    const pairs = [], rowsCk = newCheck('split-rows', 'Calculations: per-asset split', 'Assets in the per-asset split (DB)', true);
    const seen = new Set();
    for (let r = 4; r < grid.rows.length; r++) {
      const v = cell(grid, r, DB);
      if (blank(v) || v === 0) continue;
      const a = keys.get(nk(v));
      if (!a) { rowsCk.add(`row ${r + 1}`, String(v), { workbook: 'present', scope: 'not in Active Assets', diff: null }); continue; }
      if (seen.has(a)) continue;
      seen.add(a); pairs.push([a, r]); rowsCk.add(`row ${r + 1}`, String(v), null);
    }
    if (!pairs.length) { checks.push(skip('split-rows', 'Calculations: per-asset split', 'Per-asset split (DB to GK)', 'No code name in column DB from row 5 down matches an asset of Mapping › Active Assets.')); return; }
    for (const a of assets) if (!seen.has(a)) rowsCk.add(a.code_name, a.code, { workbook: 'missing', scope: 'in Active Assets', diff: null });
    checks.push(close(rowsCk));
    for (const sc of cols) {
      let c = null;
      if (/^[A-Z]{1,3}$/.test(sc.letters)) { c = colIndex(sc.letters); if (!labelOk(grid, c, sc)) c = null; }
      else { // a range such as DM…EN: the column of that range whose header names the investor or view
        const [a, b] = sc.letters.split('…').map(colIndex);
        for (let x = a; x <= b && c === null; x++) if (headLabels(grid, x).includes(nk(sc.label))) c = x;
      }
      if (c === null || c === DB) continue;
      const amount = sc.type === 'number' && sc.sum !== false;
      const ck = newCheck('split-' + colName(c), 'Calculations: per-asset split', `${colName(c)} ${sc.label && !/^=/.test(sc.label) ? sc.label : LETTER_NAMES[colName(c)] || ''}`.trim() + (sc.group && /Drawn/.test(sc.group) ? ' (drawn)' : ''), amount);
      for (const [a, r] of pairs) { let sv; try { sv = sc.get(a); } catch (e) { sv = ''; } ck.add(a.code_name, colName(c), same(cell(grid, r, c), sv, amount ? 'amount' : sc.type === 'number' ? 'number' : 'text', 1)); }
      checks.push(close(ck));
    }
  }

  /**
   * The tie-out. `ref` = { Output: grid, Calculations: grid } (either may be missing); `res` must be Scope's result on the
   * workbook's own view and display currency (see TO.context). Returns a list of checks.
   */
  TO.compare = function (res, ref) {
    const checks = [];
    if (ref && ref.Output && ref.Output.rows) compareOutput(res, ref.Output, checks);
    else checks.push(skip('output', 'Output: assets and amounts', 'Output sheet', 'The workbook was loaded without its Output tab.'));
    if (ref && ref.Calculations && ref.Calculations.rows) { comparePositions(res, ref.Calculations, checks); compareAssetSplit(res, ref.Calculations, checks); }
    else checks.push(skip('calculations', 'Calculations: positions', 'Calculations sheet', 'The workbook was loaded without its Calculations tab.'));
    return checks;
  };

  // ---------- checks that hold for any workbook ----------
  /** Internal consistency of Scope's result on your data. `LT` = Scope.engine.lookthrough when loaded. */
  TO.internal = function (res, LT) {
    const checks = [], unit = (res.config || {}).unit || 1e6;
    const eq = (a, b) => Math.abs((a || 0) - (b || 0)) <= 1 + 1e-9 * Math.max(Math.abs(a || 0), Math.abs(b || 0)); // within one currency unit
    const d = (w, s) => (eq(w, s) ? null : { workbook: w, scope: s, diff: (s || 0) - (w || 0) });
    // 1. every position is counted or excluded with a reason
    const c1 = newCheck('positions-accounted', 'Your data', 'Every Holdings row with a Security ID is counted or excluded with a reason', true);
    for (const p of res.positions || []) c1.add('Holdings row ' + p.line, p.key, p.excluded && !p.exclusionReason ? { workbook: 'excluded', scope: 'no reason given', diff: null } : null);
    c1.detail = `${(res.stats || {}).included || 0} counted, ${(res.stats || {}).excluded || 0} excluded with a reason` + (c1.differences ? `; ${c1.differences} without one` : '');
    checks.push(close(c1));
    // 2. the counted positions add up to the assets
    const c2 = newCheck('positions-to-assets', 'Your data', 'Counted positions add up to the asset totals', true);
    const sumPos = new Map();
    for (const p of res.positions || []) if (!p.excluded && p.asset_code) { const s = sumPos.get(p.asset_code) || { n: 0, d: 0, c: 0 }; s.n += p.nominal_base || 0; s.d += p.drawn_base || 0; s.c += p.commitment_base || 0; sumPos.set(p.asset_code, s); }
    for (const a of res.assets || []) { const s = sumPos.get(a.code) || { n: 0, d: 0, c: 0 }; c2.add(a.code_name || a.code, 'nominal', d(s.n, a.nominal)); c2.add(a.code_name || a.code, 'drawn', d(s.d, a.drawn)); c2.add(a.code_name || a.code, 'commitment', d(s.c, a.commitment)); }
    checks.push(close(c2));
    // 3. the investor columns add up to each asset; the group share recomputed from the ownership
    const own = new Map((res.investors || []).map((i) => [i.label, isNum(i.group_weight) ? i.group_weight : 0]));
    const c3 = newCheck('investors-to-assets', 'Your data', 'Investor columns add up to each asset (unmapped codes included)', true);
    const c4 = newCheck('group-share', 'Your data', 'Group attributed = Σ investor column × its Group ownership; third party = the rest', true);
    for (const a of res.assets || []) {
      let n = 0, dr = 0, cm = 0, g = 0;
      for (const [label, v] of a.byInvestor || []) { n += v.nominal || 0; dr += v.drawn || 0; cm += v.commitment || 0; g += (v.nominal || 0) * (own.get(label) || 0); }
      c3.add(a.code_name || a.code, 'nominal', d(n, a.nominal)); c3.add(a.code_name || a.code, 'drawn', d(dr, a.drawn)); c3.add(a.code_name || a.code, 'commitment', d(cm, a.commitment));
      c4.add(a.code_name || a.code, 'group', d(g, a.group_nominal)); c4.add(a.code_name || a.code, 'third party', d(a.nominal - a.group_nominal, a.third_party_nominal));
    }
    checks.push(close(c3), close(c4));
    // 4. every view of every asset = Σ weight × investor column
    const c5 = newCheck('views', 'Your data', 'Each view\'s amount = Σ weight × investor column, for every view and asset', true);
    for (const pl of res.platforms || []) {
      const comp = pl.composition || [], star = comp.filter((t) => t.label === '*').reduce((s, t) => s + (isNum(t.weight) ? t.weight : 1), 0);
      for (const a of res.assets || []) {
        let n = 0; for (const [label, v] of a.byInvestor || []) { const w = comp.filter((t) => t.label === label).reduce((s, t) => s + (isNum(t.weight) ? t.weight : 1), 0) + star; n += (v.nominal || 0) * w; }
        c5.add(`${pl.label} · ${a.code_name || a.code}`, 'nominal', d(n, (a.platform[pl.id] || {}).nominal || 0));
      }
    }
    c5.detail = c5.differences ? `${c5.differences} of ${c5.compared} differ` : `${(res.platforms || []).length} views × ${(res.assets || []).length} assets agree`;
    checks.push(close(c5));
    // 5. the Output rows and the headline figures
    const c6 = newCheck('output-rows-internal', 'Your data', 'Output rows = each asset\'s amount in the view; headline figures = Σ rows', true);
    const rows = res.rows || [];
    const assetByCode = new Map((res.assets || []).map((a) => [a.code, a]));
    for (const r of rows) { const a = assetByCode.get(r.code); c6.add(r.code_name || r.code, 'exposure', d(((a && a.platform[res.platformId]) || {}).nominal || 0, r.exposure_m * unit)); }
    const expected = (res.assets || []).filter((a) => a.inActiveList && ((a.platform[res.platformId] || {}).nominal || 0) > 0).length;
    c6.add('Output', 'number of rows', expected === rows.length ? null : { workbook: expected, scope: rows.length, diff: rows.length - expected });
    const sumExp = rows.reduce((s, r) => s + (r.exposure_m || 0), 0), sumDr = rows.reduce((s, r) => s + (r.drawn_m || 0), 0);
    const m = res.metrics || {};
    c6.add('Headline', 'total exposure', Math.abs(sumExp - (m.total_exposure_m || 0)) <= 1e-6 ? null : { workbook: sumExp, scope: m.total_exposure_m, diff: (m.total_exposure_m || 0) - sumExp });
    if (isNum(m.total_drawn_m)) c6.add('Headline', 'total drawn', Math.abs(sumDr - m.total_drawn_m) <= 1e-6 ? null : { workbook: sumDr, scope: m.total_drawn_m, diff: m.total_drawn_m - sumDr });
    c6.detail = c6.differences ? `${c6.differences} of ${c6.compared} differ` : `${rows.length} rows, total ${sumExp.toFixed(3)}m, agree with the headline figures`;
    checks.push(close(c6));
    // 6. look-through reconciles
    if (LT && LT.compute && (res.fundRegister || []).length) {
      let lt = null; try { lt = LT.compute(res, res.fundRegister || []); } catch (e) { lt = null; }
      if (lt) checks.push({ id: 'lookthrough', area: 'Your data', title: 'Look-through: ultimate holders + external fund holders = the direct book', material: true, status: lt.reconciles ? 'pass' : 'fail', detail: lt.reconciles ? 'reconciles' : `differs by ${(lt.totals.difference.nominal / unit).toFixed(6)}m (nominal)`, compared: 1, differences: lt.reconciles ? 0 : 1, examples: [] });
    }
    // 7. the workbook's own formula columns and EUR amounts (Data › Checks)
    for (const c of ((res.inputs || {}).checks || [])) {
      checks.push({ id: 'wb-' + c.id, area: 'Your workbook\'s own columns', title: c.label, material: true, status: c.status === 'ok' ? 'pass' : c.status === 'skipped' ? 'skip' : c.status === 'warn' ? 'warn' : 'fail', detail: c.status === 'skipped' ? 'not compared: every workbook value is a formula error' : `${c.matched} of ${c.total} agree`, compared: c.total || 0, differences: c.failed || 0,
        examples: (c.examples || []).slice(0, MAX_EXAMPLES).map((x) => ({ where: x.cell || '', item: '', workbook: x.workbook, scope: x.scope, diff: null })) });
    }
    return checks;
  };

  /** Areas in reading order: amounts and keys first, descriptive columns last. */
  TO.AREAS = ['Output: assets and amounts', 'Calculations: positions', 'Calculations: per-asset split', 'Output: descriptive columns', 'Calculations: other position columns', 'Your data', 'Your workbook\'s own columns'];

  /** Totals of a list of checks: { pass, fail, warn, skip, verdict }. */
  TO.summary = function (checks) {
    const s = { pass: 0, fail: 0, warn: 0, skip: 0 };
    for (const c of checks) s[c.status] = (s[c.status] || 0) + 1;
    s.verdict = s.fail ? 'fail' : s.warn ? 'warn' : s.pass ? 'pass' : 'skip';
    return s;
  };

  /** The checks as CSV rows (one per check, then one per example difference). */
  TO.csvRows = function (checks) {
    const out = [];
    for (const c of checks) {
      out.push({ area: c.area, check: c.title, status: c.status, detail: c.detail, compared: c.compared, differences: c.differences, where: '', item: '', workbook: '', scope: '', difference: '' });
      for (const x of c.examples || []) out.push({ area: c.area, check: c.title, status: '', detail: '', compared: '', differences: '', where: x.where, item: x.item, workbook: x.workbook, scope: x.scope, difference: isNum(x.diff) ? x.diff : '' });
    }
    return out;
  };
})(typeof window !== 'undefined' ? window : globalThis);
