/* Scope · the workbook's Calculations and Output sheets (js/modules/layer1-workbook.js).
 *
 * Two pages that show the calculation the way the workbook does, column for column, so every number can be followed
 * and checked against the sheet:
 *   #/calculations   the Calculations sheet, rows 5 onwards: columns A to JG in the workbook's order, each headed by its
 *                    letters, its row-3 label and its formula (written with names where the workbook uses cell references);
 *                    a second tab holds the per-asset split, Calculations DB to GK.
 *   #/output         the Output sheet for the selected view: the header row in the workbook's order and names.
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

  Scope.registerModule({
    id: 'calculations', layer: 1, order: 1.2, title: 'Calculations sheet', status: 'built', icon: 'hash',
    render(el, ctx) {
      const res = ctx.result, tab = ctx.params[0] === 'assets' ? 'assets' : 'positions';
      el.appendChild(Scope.app.pageHead({ title: 'Calculations · ' + (tab === 'assets' ? 'assets split (DB to GK)' : 'positions (rows 5 onwards)'),
        sub: 'the workbook\'s Calculations sheet as Scope computes it: columns in the workbook\'s order, each headed by its letters, row-3 label and formula',
        actions: h('div', { class: 'chips' }, UI.chip('Positions · A to JG', tab === 'positions', () => Scope.navigate('calculations', 'positions')), UI.chip('Assets split · DB to GK', tab === 'assets', () => Scope.navigate('calculations', 'assets'))) }));
      el.appendChild(links());
      if (tab === 'positions') {
        const cols = positionColumns(res), rows = res.positions || [];
        el.appendChild(formulaStrip(cols, 'Columns'));
        const grid = UI.grid({ columns: cols.map((c, i) => gridColumn(c, i, false)), rows, rowKey: 'key', height: '64vh', storageKey: 'wb-calc2', ariaLabel: 'Calculations sheet', exportName: `Calculations-${today()}.csv`, onRow: (r) => { if (r && r.asset_code) Scope.navigate('asset', r.asset_code); } });
        el.appendChild(UI.section({ title: `One row per Holdings row · ${F.int(rows.length)} rows`, subtitle: 'Calculations rows 5 onwards; hover a header for the formula; the last column is Scope\'s: why a row is excluded',
          actions: [h('button', { class: 'btn btn-sm', onClick: () => downloadSheet('Calculations', cols, rows) }, ic('download'), 'Download as Calculations.xlsx')], body: grid }));
      } else {
        const cols = assetColumns(res), rows = (res.assets || []).filter((a) => a.inActiveList);
        el.appendChild(formulaStrip(cols, 'Columns'));
        const grid = UI.grid({ columns: cols.map((c, i) => gridColumn(c, i, false)), rows, rowKey: 'code', height: '64vh', storageKey: 'wb-split2', ariaLabel: 'Calculations asset split', exportName: `Calculations-assets-${today()}.csv`, onRow: (r) => { if (r && r.code) Scope.navigate('asset', r.code); } });
        el.appendChild(UI.section({ title: `One row per active asset · ${F.int(rows.length)} assets · amounts in ${res.displayCurrency}`, subtitle: 'Split Calculations AUM (DB to ES) and Split calculations Drawn Amount (FA to GK)',
          actions: [h('button', { class: 'btn btn-sm', onClick: () => downloadSheet('Calculations-assets', cols, rows) }, ic('download'), 'Download as .xlsx')], body: grid }));
      }
    },
  });

  Scope.registerModule({
    id: 'output', layer: 1, order: 1.4, title: 'Output sheet', status: 'built', icon: 'columns',
    render(el, ctx) {
      const res = ctx.result, cols = outputColumns(res), rows = res.rows || [];
      el.appendChild(Scope.app.pageHead({ title: 'Output · ' + (res.platform ? res.platform.label : ''), sub: `the workbook's Output sheet for the selected view (Output!G8): ${F.int(rows.length)} assets with exposure, amounts in ${res.displayCurrency} millions, the header row in the workbook's order and names` }));
      el.appendChild(links());
      const missing = cols.filter((c) => c.exists === false).map((c) => c.label);
      if (missing.length) el.appendChild(h('div', { class: 'notice info' }, h('b', {}, 'Blank here: '), missing.join(', '), ' (the workbook reads them from Holdings by their row-2 names, which this Holdings sheet does not carry).'));
      const grid = UI.grid({ columns: cols.map((c, i) => gridColumn(c, i, true)), rows, rowKey: 'code', height: '66vh', storageKey: 'wb-output2', ariaLabel: 'Output sheet', exportName: `Output-${(res.platform ? res.platform.label : 'view').replace(/[^\w]+/g, '-')}-${today()}.csv`, onRow: (r) => { if (r && r.code) Scope.navigate('asset', r.code); } });
      el.appendChild(UI.section({ title: 'Output rows', subtitle: 'hover a column header for the Calculations column it comes from; the first two columns name the asset and are Scope\'s',
        actions: [h('button', { class: 'btn btn-sm', onClick: () => downloadSheet('Output', cols, rows) }, ic('download'), 'Download as Output.xlsx')], body: grid }));
    },
  });
})(window);
