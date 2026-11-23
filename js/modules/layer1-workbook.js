/* Scope · the workbook's Calculations and Output sheets (js/modules/layer1-workbook.js).
 *
 * Two pages that show the calculation the way the workbook does, column for column, so every number can be followed
 * and checked against the sheet:
 *   Explorer › Calculations sheet (drawn by Scope.workbookPages.calculations; #/calculations opens it)
 *                    the Calculations sheet, rows 5 onwards: columns A to JG in the workbook's order, each headed by its
 *                    letters, its row-3 label and its formula (written with names where the workbook uses cell references);
 *                    a second tab holds the per-asset split, Calculations DB to GK.
 *   Explorer › Holdings sheet (Scope.workbookPages.holdings): the Holdings sheet exactly as loaded.
 *   Explorer › Output (Scope.workbookPages.output; #/output opens it)
 *                    the Output sheet for the selected view: the header row in the workbook's order and names.
 * The layouts are the workbook's (Calculations rows 2 to 5 and the Output header row). Nothing is calculated here: every
 * value comes from the AUM result (js/calc/aum.js). Parameters are changed on Data › Formulas, the ownership and the
 * "incl. part in funds" formulas on Data › Setup.
 */
(function (global) {
  'use strict';
  const Scope = global.Scope, U = Scope.util, UI = Scope.ui, h = UI.h, F = U.fmt, store = Scope.store;
  const ic = (name, size) => Scope.icon(name, { size: size || 14 });
  const { positionColumns, assetColumns, outputColumns, isNum, toNum } = Scope.workbookLayout;
  const today = () => new Date().toISOString().slice(0, 10);

  // ---------- rendering ----------
  function gridColumn(c, i, millions) {
    const key = 'c' + i;
    const col = { key, label: c.label || (c.letters ? '(' + c.letters + ')' : ''), type: c.type || 'text', group: c.group || '', title: `${c.letters ? c.letters + ' · ' : ''}${c.formula || c.source || ''}`, get: c.type === 'number' ? (r, i) => toNum(c.get(r, i)) : c.get, width: c.type === 'number' ? 112 : 140 };
    // amounts in millions with one decimal; otherwise integers as such and rates, fractions, ratios with up to four decimals
    if (c.type === 'number') col.format = (v) => (isNum(v) ? (c.decimals !== undefined ? v.toFixed(c.decimals) : millions ? F.n1(v) : Number.isInteger(v) ? F.int(v) : Math.abs(v) >= 1000 ? F.n2(v) : String(+v.toFixed(4))) : '');
    if (c.type === 'date') col.format = (v) => (v ? F.date(v instanceof Date ? v : U.parseDate(v)) : '');
    if (c.unitLabel) col.unit = c.unitLabel;
    if (c.type === 'number' && c.sum) col.total = 'sum'; // amounts only: a sum of rates, ratios or scores means nothing
    return col;
  }
  function formulaStrip(cols, title) {
    return h('details', { class: 'wb-formulas' }, h('summary', {}, ic('file-text'), ` ${title}: ${cols.length} columns in the workbook's order, with their letters, row-3 labels and formulas`),
      h('div', { class: 'wb-formula-list' }, cols.map((c) => h('div', { class: 'wb-formula' }, h('span', { class: 'wb-letters' }, c.letters || ''), h('b', {}, c.label || h('span', { class: 'muted' }, '(no label)')), h('code', {}, c.formula || c.source || '')))));
  }
  function downloadSheet(name, cols, rows) {
    const write = Scope.inputs && Scope.inputs.writeXlsx, save = Scope.inputs && Scope.inputs.downloadBytes;
    if (!write || !save) { UI.toast('The workbook writer is not available in this copy of Scope', 'warn'); return; }
    // header rows as in the workbook: letters (Calculations only), labels, formulas or sources
    const grid = (cols.some((c) => c.letters) ? [cols.map((c) => c.letters || '')] : []).concat([cols.map((c) => c.label), cols.map((c) => c.formula || c.source || '')]);
    rows.forEach((r, i) => grid.push(cols.map((c) => { const v = c.type === 'number' ? toNum(c.get(r, i)) : c.get(r, i); return v instanceof Date ? U.isoDate(v) : isNum(v) ? v : v === null || v === undefined || typeof v === 'number' ? null : String(v); })));
    const file = `${name}-${today()}.xlsx`;
    try { save(file, write({ [name]: { name, rows: grid } })); UI.toast(`${file} downloaded`); } catch (e) { UI.toast(`Could not write the workbook: ${(e && e.message) || e}`, 'warn'); }
  }
  const links = () => h('div', { class: 'wb-links' },
    h('a', { class: 'btn btn-sm', href: Scope.href('data', 'formulas') }, ic('sliders'), 'Parameters (Data › Formulas)'),
    h('a', { class: 'btn btn-sm', href: Scope.href('data', 'setup', 'weights') }, ic('edit-2'), 'Ownership and the incl. part in funds formulas (Data › Setup)'));

  /**
   * The Calculations sheet, drawn into `host` (the Explorer's Calculations sheet tab): positions (A to JG) or the per-asset
   * split (DB to GK), chosen with the chips; sub: 'positions' | 'assets', onSub(next) switches. Returns the grid (to destroy).
   */
  function calculationsInto(host, res, sub, onSub) {
    const tab = sub === 'assets' ? 'assets' : 'positions';
    host.appendChild(h('div', { class: 'wb-head' },
      h('span'),
      h('div', { class: 'chips' }, UI.chip('Positions · A to JG', tab === 'positions', () => onSub('positions')), UI.chip('Assets split · DB to GK', tab === 'assets', () => onSub('assets')))));
    host.appendChild(links());
    let grid;
    if (tab === 'positions') {
      const cols = positionColumns(res), rows = res.positions || [];
      host.appendChild(formulaStrip(cols, 'Columns'));
      grid = UI.grid({ columns: cols.map((c, i) => gridColumn(c, i, false)), rows, rowKey: 'key', height: '64vh', storageKey: 'wb-calc2', ariaLabel: 'Calculations sheet', exportName: `Calculations-${today()}.csv`, onRow: (r) => { if (r && r.asset_code) Scope.navigate('asset', r.asset_code); } });
      host.appendChild(UI.section({ title: `One row per Holdings row · ${F.int(rows.length)} rows`, subtitle: 'Calculations rows 5 onwards; hover a header for the formula; the last column is Scope\'s: why a row is excluded',
        actions: [h('button', { class: 'btn btn-sm', onClick: () => downloadSheet('Calculations', cols, rows) }, ic('download'), 'Download as Calculations.xlsx')], body: grid }));
    } else {
      const cols = assetColumns(res), rows = (res.assets || []).filter((a) => a.inActiveList);
      host.appendChild(formulaStrip(cols, 'Columns'));
      grid = UI.grid({ columns: cols.map((c, i) => gridColumn(c, i, false)), rows, rowKey: 'code', height: '64vh', storageKey: 'wb-split2', ariaLabel: 'Calculations asset split', exportName: `Calculations-assets-${today()}.csv`, onRow: (r) => { if (r && r.code) Scope.navigate('asset', r.code); } });
      host.appendChild(UI.section({ title: `One row per active asset · ${F.int(rows.length)} assets · amounts in ${res.displayCurrency}`, subtitle: 'Split Calculations AUM (DB to ES) and Split calculations Drawn Amount (FA to GK)',
        actions: [h('button', { class: 'btn btn-sm', onClick: () => downloadSheet('Calculations-assets', cols, rows) }, ic('download'), 'Download as .xlsx')], body: grid }));
    }
    return grid;
  }
  /** A column's Excel letters (0 → A, 26 → AA). */
  const letters = (i) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
  /**
   * The Holdings sheet exactly as loaded (the input, before any calculation), drawn into `host`: one column per sheet
   * column, headed by its header-row label and Excel letters, one row per sheet row under the header row, with its sheet
   * row number. Nothing is changed or left out. Returns the grid (to destroy).
   */
  function holdingsInto(host, res) {
    const g = store.sheet('Holdings'), src = store.state.sources.Holdings || {};
    if (!g || !g.rows || !g.rows.length) { host.appendChild(UI.empty('No Holdings sheet is loaded.')); return null; }
    // the header row: the one the calculation found, else the fullest of the first ten rows
    const d = res && res.inputs && res.inputs.sheets && res.inputs.sheets.Holdings, found = d && U.isNum(d.headerRow) ? d.headerRow - 1 : -1;
    const fill = (r) => (r || []).filter((v) => v !== null && v !== undefined && v !== '').length;
    const hr = found >= 0 && found < g.rows.length ? found : g.rows.slice(0, 10).reduce((best, r, i) => (fill(r) > fill(g.rows[best]) ? i : best), 0);
    const head = g.rows[hr] || [], width = g.rows.reduce((n, r) => Math.max(n, (r || []).length), 0);
    const rows = g.rows.slice(hr + 1).map((r, i) => ({ _row: hr + 2 + i, cells: r || [] })).filter((r) => fill(r.cells));
    const numeric = (c) => { let n = 0, k = 0; for (const r of rows.slice(0, 200)) { const v = r.cells[c]; if (v === null || v === undefined || v === '') continue; k++; if (typeof v === 'number') n++; } return k > 0 && n === k; };
    const text = (v) => (v === null || v === undefined ? '' : v instanceof Date ? U.isoDate(v) : v);
    const d1904 = !!src.date1904, sample = rows.slice(0, 300);
    const cols = [{ key: '_row', label: 'Row', type: 'number', width: 64, frozen: true, format: (v) => String(v) }].concat(Array.from({ length: width }, (_, c) => {
      const name = head[c] === null || head[c] === undefined || head[c] === '' ? `(${letters(c)})` : String(head[c]);
      // a date column (Excel keeps dates as numbers) shows dates, never the numbers
      if (U.dateColumn(name, sample.map((r) => r.cells[c]))) return { key: 'c' + c, label: name, title: `Column ${letters(c)} · dates`, type: 'date', width: 120, get: (r) => { const v = r.cells[c]; return U.isSerialDate(v) ? U.isoDate(U.serialDate(v, d1904)) : text(v); } };
      const num = numeric(c);
      return { key: 'c' + c, label: name, title: `Column ${letters(c)}`, type: num ? 'number' : 'text', width: num ? 120 : 150, get: (r) => text(r.cells[c]), format: num ? (v) => (isNum(v) ? (Number.isInteger(v) ? F.int(v) : String(+v.toFixed(4))) : v === null || v === undefined ? '' : String(v)) : undefined };
    }));
    host.appendChild(h('div', { class: 'small muted wb-head' }, `The Holdings sheet as loaded${src.file ? ` from ${src.file}` : ''}${src.period !== undefined && Scope.source ? ` (${Scope.source.label(src.period)})` : ''}: the input itself, before any calculation. Header row ${hr + 1}; corrections made in Scope are not shown here (they are on Data › Corrections).`));
    const grid = UI.grid({ columns: cols, rows, rowKey: '_row', height: '66vh', storageKey: 'wb-holdings', ariaLabel: 'Holdings sheet', exportName: `Holdings-as-loaded-${today()}.csv` });
    host.appendChild(UI.section({ title: `Holdings · ${F.int(rows.length)} rows × ${F.int(width)} columns`, subtitle: 'every column of the sheet in its own order; hover a header for its Excel column', body: grid }));
    return grid;
  }
  Scope.workbookPages = { calculations: calculationsInto, holdings: holdingsInto };

  // #/calculations (old links) opens the Explorer's Calculations sheet tab
  Scope.registerModule({
    id: 'calculations', layer: 1, order: 99, title: 'Calculations sheet', status: 'built', icon: 'hash', hidden: true,
    render(el, ctx) { Scope.navigate('explorer', ctx.params[0] === 'assets' ? 'calculations-assets' : 'calculations'); el.appendChild(h('div', { class: 'empty' }, 'Opening the Calculations sheet in the Explorer…')); },
  });

  /**
   * The Output sheet for the selected view, drawn into `host` (the Explorer's Output tab): the header row in the workbook's
   * order and names, one row per asset with exposure, the columns the Holdings sheet cannot fill named, the download as
   * Output.xlsx and the links to the parameters. Returns the grid (to destroy).
   */
  function outputInto(host, res) {
    const cols = outputColumns(res), rows = res.rows || [];
    host.appendChild(h('div', { class: 'small muted wb-head' }, `The workbook's Output sheet for ${res.platform ? res.platform.label : 'the selected view'} (Output!G8): ${F.int(rows.length)} assets with exposure, amounts in ${res.displayCurrency} millions, the header row in the workbook's order and names.`));
    host.appendChild(links());
    if (res.grouped) host.appendChild(h('div', { class: 'notice info' }, h('b', {}, 'Transactions grouped. '), `${res.groups.size} transaction group${res.groups.size === 1 ? '' : 's'} shown as one line each (amounts added; spread, WAL and rating weighted by exposure; latest maturity; "Mixed" where the deals differ). Click a grouped line for its deals. Switch it off with Transactions grouped, next to Sets.`));
    const missing = cols.filter((c) => c.exists === false).map((c) => c.label);
    if (missing.length) host.appendChild(h('div', { class: 'notice info' }, h('b', {}, 'Blank here: '), missing.join(', '), ' (the workbook reads them from Holdings by their row-2 names, which this Holdings sheet does not carry).'));
    const grid = UI.grid({ columns: cols.map((c, i) => gridColumn(c, i, true)), rows, rowKey: 'code', height: '66vh', storageKey: 'wb-output2', ariaLabel: 'Output sheet', exportName: `Output-${(res.platform ? res.platform.label : 'view').replace(/[^\w]+/g, '-')}-${today()}.csv`, onRow: (r) => { if (r && r.code) Scope.navigate('asset', r.code); } });
    host.appendChild(UI.section({ title: 'Output rows', subtitle: 'hover a column header for the Calculations column it comes from; the first two columns name the asset and are Scope\'s',
      actions: [h('button', { class: 'btn btn-sm', onClick: () => downloadSheet('Output', cols, rows) }, ic('download'), 'Download as Output.xlsx')], body: grid }));
    return grid;
  }
  Scope.workbookPages.output = outputInto;

  // #/output (old links) opens the Explorer's Output tab
  Scope.registerModule({
    id: 'output', layer: 1, order: 99, title: 'Output sheet', status: 'built', icon: 'columns', hidden: true,
    render(el) { Scope.navigate('explorer', 'output'); el.appendChild(h('div', { class: 'empty' }, 'Opening the Output sheet in the Explorer…')); },
  });
})(window);
