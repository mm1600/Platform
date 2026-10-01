/* Module: Layer 0 · Data — dataset status, CSV loading, column mapping, validation issues, manual adjustments, configuration.
 *
 * Registers the 'data' page (route #/data/<tab>, sidebar Layer 0). It is the one page that works without a
 * computed result (needsData: false), because it is where data gets loaded. Files go into Scope.store, which
 * re-runs the AUM engine and re-renders the app; this page then shows what the engine made of them: the
 * holdings column mapping (workbook Mapping C:D), every issue it raised, the manual-adjustment audit trail
 * and the reference tables that hold the workbook's hard-coded conventions.
 */
(function (global) {
  'use strict';
  const Scope = global.Scope, U = Scope.util, F = U.fmt, UI = Scope.ui, h = UI.h, store = Scope.store, AUM = Scope.engine.aum;
  // [route param, tab label]; the active tab is the first route parameter (#/data/issues), default 'overview'.
  const TABS = [['overview', 'Dataset'], ['mapping', 'Column mapping'], ['issues', 'Issues'], ['adjustments', 'Adjustments'], ['config', 'Configuration']];
  const state = { sev: 'all' }; // issues tab severity filter; survives re-renders within the session

  /**
   * Read dropped / chosen files and hand them to the store. File names are matched to schema table names by
   * store.canonicalName; unknown names are skipped with a warning. merge: true replaces only the tables
   * supplied and keeps every other loaded table.
   */
  async function loadFiles(list) {
    const files = {}, unknown = [];
    for (const f of Array.from(list)) { const key = store.canonicalName(f.name); if (!key) { unknown.push(f.name); continue; } files[key] = await f.text(); }
    if (Object.keys(files).length) { store.setTables(files, 'file', { merge: true }); UI.toast(`Loaded ${Object.keys(files).join(', ')}`); }
    if (unknown.length) UI.toast(`Ignored (unknown names): ${unknown.join(', ')}`, 'warn');
  }

  Scope.registerModule({
    id: 'data', layer: 0, order: 1, title: 'Data & validation', status: 'built', icon: 'database', needsData: false,
    /** Page head, tab bar (with issue and adjustment counts) and the active tab's content. */
    render(el, ctx) {
      const res = ctx.result, tab = TABS.some((t) => t[0] === ctx.params[0]) ? ctx.params[0] : 'overview';
      el.appendChild(Scope.app.pageHead({ title: 'Data & validation', sub: 'Layer 0 — where every figure comes from: imports, mapping, checks and manual corrections' }));
      el.appendChild(h('div', { class: 'tabs' }, TABS.map(([id, label]) => h('a', { class: 'tab' + (tab === id ? ' active' : ''), href: Scope.href('data', id) }, label, id === 'issues' && res ? ` (${res.issues.length})` : id === 'adjustments' ? ` (${store.activeAdjustments().length})` : ''))));
      ({ overview, mapping, issues, adjustments, config })[tab](el, res);
    },
  });

  /** Dataset tab: what is loaded (label, source, reporting date, counts), the drop zone, per-table status and dataset exports. */
  function overview(el, res) {
    const s = store.state;
    const fileInput = h('input', { type: 'file', multiple: true, accept: '.csv,text/csv', class: 'hidden', onChange: (e) => loadFiles(e.target.files) });
    const drop = h('div', { class: 'dropzone', onDragOver: (e) => { e.preventDefault(); drop.classList.add('over'); }, onDragLeave: () => drop.classList.remove('over'), onDrop: (e) => { e.preventDefault(); drop.classList.remove('over'); loadFiles(e.dataTransfer.files); } },
      h('div', {}, h('b', {}, 'Drop CSV files here'), ' or ', h('button', { class: 'btn btn-sm', onClick: () => fileInput.click() }, 'choose files'), fileInput),
      h('div', { class: 'small muted', style: { marginTop: '6px' } }, 'File names must match the schema (holdings.csv, mapping_assets.csv, …). Files replace the table of the same name; others are kept. Loaded files stay in this browser only.'));
    const tables = store.ALL_TABLES().map((n) => { const t = store.tableInfo(n); const optional = store.OPTIONAL.includes(n); return { name: n, status: t ? 'loaded' : optional ? 'optional' : 'missing', rows: t ? t.parsed.records.filter(Boolean).length : 0, columns: t ? t.parsed.headers.length : 0, source: t ? t.source : '', file: t ? t.filename : '', loaded: t ? t.loadedAt.replace('T', ' ').slice(0, 19) : '' }; });
    el.appendChild(h('div', { class: 'grid-2' },
      UI.section({ title: 'Dataset', subtitle: 'what is loaded right now', actions: [h('button', { class: 'btn btn-sm', onClick: () => Scope.app.resetToDemo() }, 'Reset to demo')], body: UI.dl([
        ['label', h('span', {}, UI.badge(s.datasetLabel || '—', /synthetic/i.test(s.datasetLabel) ? 'synthetic' : ''), /synthetic/i.test(s.datasetLabel) ? h('span', { class: 'small muted' }, 'synthetic data — no real investors, mandates or amounts') : null)],
        ['source', { embedded: 'embedded demo (data/demo.js)', fetch: 'data/demo/*.csv fetched from the server', file: 'files loaded in the browser', none: 'nothing loaded' }[s.datasetSource] || s.datasetSource],
        ['reporting date', res ? `${F.date(res.reportingDate)} (${res.quarter})` : '–'],
        ['holdings', res ? `${res.stats.holdingsRows} rows read · ${res.stats.paddingRows} blank · ${res.stats.positions} positions · ${res.stats.included} included · ${res.stats.excluded} excluded` : '–'],
        ['assets', res ? `${res.stats.assetsMapped} mapped · ${res.stats.assetsActive} with exposure · ${res.stats.assetsSelected} on ${res.platform.label}` : '–'],
        ['issues', res ? `${res.issueCounts.error || 0} errors · ${res.issueCounts.warn || 0} warnings · ${res.issueCounts.info || 0} info` : '–'],
        ['compute time', res ? `${res.computeMs.toFixed(1)} ms` : '–'],
      ]) }),
      UI.section({ title: 'Load CSV files', subtitle: 'the same inputs as the Excel AUM, one file per sheet', body: drop }),
    ));
    el.appendChild(UI.section({ title: 'Tables', subtitle: 'one CSV per workbook sheet — see data/SCHEMA.md', body: UI.table({ rows: tables, filter: false, compact: true, columns: [
      { key: 'name', label: 'File', class: 'strong' }, { key: 'status', label: 'Status', html: (r) => `<span class="badge ${r.status === 'loaded' ? 'badge-ok' : r.status === 'optional' ? 'badge-muted' : 'badge-error'}">${r.status}</span>` },
      { key: 'rows', label: 'Rows', align: 'right' }, { key: 'columns', label: 'Columns', align: 'right' }, { key: 'source', label: 'Source' }, { key: 'loaded', label: 'Loaded at', class: 'dim' },
      { key: 'file', label: '', render: (r) => (r.status === 'loaded' ? h('button', { class: 'btn btn-ghost btn-sm', onClick: () => UI.downloadText(r.name, store.tableInfo(r.name).text) }, Scope.icon('download', { size: 14 })) : h('span')) }] }) }));
    if (res) el.appendChild(UI.section({ title: 'Export datasets', subtitle: 'brief §15: every dataset, including computed outputs, must be exportable', body: h('div', { class: 'chips' },
      h('button', { class: 'btn', onClick: () => UI.downloadText(`scope_output_${res.platformId}.csv`, Scope.csv.serialize(AUM.outputRecords(res))) }, Scope.icon('download', { size: 14 }), 'Output (AUM view)'),
      h('button', { class: 'btn', onClick: () => UI.downloadText('scope_positions.csv', Scope.csv.serialize(AUM.positionRecords(res))) }, Scope.icon('download', { size: 14 }), 'Positions (Calculations)'),
      h('button', { class: 'btn', onClick: () => UI.downloadText('scope_issues.csv', Scope.csv.serialize(res.issues.map((i) => ({ severity: i.severity, table: i.table, line: i.row || '', key: i.key || '', message: i.message })))) }, Scope.icon('download', { size: 14 }), 'Issues'),
      h('button', { class: 'btn', onClick: () => UI.downloadText('scope_adjustments.csv', Scope.csv.serialize(store.state.adjustments.map((a) => ({ id: a.id, table: a.table, key: a.key, field: a.field, original: a.original, value: a.value, reason: a.reason, user: a.user, at: a.at, status: a.reverted ? 'reverted' : a.superseded ? 'superseded' : 'active' })))) }, Scope.icon('download', { size: 14 }), 'Adjustments'),
      h('button', { class: 'btn', onClick: () => { for (const n of store.ALL_TABLES()) { const t = store.tableInfo(n); if (t) UI.downloadText(n, t.text); } } }, Scope.icon('download', { size: 14 }), 'All input CSVs')) }));
  }

  /**
   * Column mapping tab: each holdings.csv header with the canonical field it maps to (same rule as the engine:
   * mapping_columns.csv first, case-insensitive, else a header already named canonically), plus canonical
   * fields that no header supplies.
   */
  function mapping(el, res) {
    const info = store.tableInfo('holdings.csv'), rows = store.table('mapping_columns.csv');
    if (!info) { el.appendChild(UI.empty('holdings.csv not loaded')); return; }
    const map = new Map(rows.map((r) => [String(r.source_header).trim().toLowerCase(), r]));
    const present = new Set();
    const hdrs = info.parsed.headers.map((hd) => { const r = map.get(hd.trim().toLowerCase()); const canon = r ? r.canonical_field : AUM.POSITION_FIELDS.includes(hd.trim()) ? hd.trim() : ''; if (canon) present.add(canon); return { header: hd, canonical: canon, required: r ? r.required : '', note: r ? r.note : (canon ? 'header already canonical' : 'not in mapping_columns.csv — ignored'), status: canon ? 'mapped' : 'unmapped' }; });
    const missing = AUM.POSITION_FIELDS.filter((f) => !present.has(f)).map((f) => ({ field: f, required: rows.find((r) => r.canonical_field === f && /^y/i.test(r.required || '')) ? 'Y' : '' }));
    el.appendChild(h('div', { class: 'grid-2' },
      UI.section({ title: 'holdings.csv columns', subtitle: 'source header → canonical field (Mapping sheet C:D in the workbook)', body: UI.table({ rows: hdrs, filter: false, compact: true, columns: [
        { key: 'header', label: 'Source header', class: 'strong' }, { key: 'canonical', label: 'Canonical field', class: 'mono' }, { key: 'required', label: 'Required' },
        { key: 'status', label: 'Status', html: (r) => `<span class="badge ${r.status === 'mapped' ? 'badge-ok' : 'badge-muted'}">${r.status}</span>` }, { key: 'note', label: 'Note', class: 'dim' }] }) }),
      UI.section({ title: 'Canonical fields not present', subtitle: 'add a row to mapping_columns.csv to map a differently named source column', body: missing.length ? UI.table({ rows: missing, filter: false, compact: true, columns: [{ key: 'field', label: 'Field', class: 'mono' }, { key: 'required', label: 'Required' }] }) : UI.empty('All canonical fields are present') }),
    ));
  }

  /** Issues tab: engine validation issues filtered by severity; keys link to the asset page where they resolve to an asset. */
  function issues(el, res) {
    if (!res) { el.appendChild(UI.empty('No dataset')); return; }
    const sevs = ['all', 'error', 'warn', 'info'];
    const rows = res.issues.filter((i) => state.sev === 'all' || i.severity === state.sev).map((i, n) => Object.assign({ n: n + 1 }, i));
    // An issue key is either an asset code or a position key; map either to the asset code for linking.
    const assetOfKey = (key) => { if (!key) return null; if (res.assets.some((a) => a.code === key)) return key; const p = res.positions.find((x) => x.key === key); return p && p.asset_code ? p.asset_code : null; };
    el.appendChild(UI.section({ title: 'Validation issues', subtitle: 'errors exclude a position from AUM; warnings keep it but flag it; info is context. Nothing is silently zeroed.',
      actions: [h('div', { class: 'chips' }, sevs.map((sv) => UI.chip(sv === 'all' ? `all (${res.issues.length})` : `${sv} (${res.issueCounts[sv] || 0})`, state.sev === sv, () => { state.sev = sv; Scope.app.render(true); })))],
      body: UI.table({ rows, compact: true, exportName: 'scope_issues.csv', sortKey: null, columns: [
        { key: 'severity', label: 'Severity', html: (r) => `<span class="badge badge-${r.severity}">${r.severity}</span>` }, { key: 'table', label: 'Table', class: 'mono' }, { key: 'row', label: 'Line', align: 'right' },
        { key: 'key', label: 'Key', render: (r) => { const code = assetOfKey(r.key); return code ? h('a', { href: Scope.href('asset', code) }, r.key || code) : h('span', { class: 'dim' }, r.key || ''); } },
        { key: 'message', label: 'Message' }] }) }));
  }

  /** Adjustments tab: full audit trail, newest first, including reverted and superseded entries; active ones can be reverted. */
  function adjustments(el) {
    const rows = store.state.adjustments.slice().reverse().map((a) => Object.assign({ status: a.reverted ? 'reverted' : a.superseded ? 'superseded' : 'active' }, a));
    el.appendChild(UI.section({ title: 'Manual adjustments', subtitle: 'brief §11: original value, corrected value, reason, user and timestamp are all retained; a reverted adjustment stays in the history', body: rows.length ? UI.table({ rows, compact: true, filter: false, columns: [
      { key: 'status', label: 'Status', html: (r) => `<span class="badge ${r.status === 'active' ? 'badge-manual' : 'badge-muted'}">${r.status}</span>` }, { key: 'table', label: 'Table' },
      { key: 'key', label: 'Key', render: (r) => (r.table === 'assets' ? h('a', { href: Scope.href('asset', r.key) }, r.key) : h('span', { class: 'mono' }, r.key)) }, { key: 'field', label: 'Field', class: 'mono' },
      { key: 'original', label: 'Original' }, { key: 'value', label: 'New value', class: 'strong' }, { key: 'reason', label: 'Reason' }, { key: 'user', label: 'User' }, { key: 'at', label: 'When', format: (v) => String(v).replace('T', ' ').slice(0, 19), class: 'dim' },
      { key: 'id', label: '', render: (r) => (r.status === 'active' ? h('button', { class: 'btn btn-sm btn-danger', onClick: () => { store.revertAdjustment(r.id); UI.toast('Adjustment reverted'); } }, 'Revert') : h('span')) }] }) : UI.empty('No adjustments yet. Use the edit icon on an asset page to correct a value with an audit trail.') }));
  }

  /** Configuration tab: read-only views of config, platforms, investor mapping, FX and ratings tables. */
  function config(el, res) {
    const cfg = store.table('config.csv'), plats = store.table('platforms.csv'), fx = store.table('fx.csv'), inv = store.table('mapping_investors.csv'), ratings = store.table('ratings.csv');
    el.appendChild(h('div', { class: 'grid-2' },
      UI.section({ title: 'config.csv', subtitle: 'conventions that the workbook kept inside formulas', body: UI.table({ rows: cfg, filter: false, compact: true, columns: [{ key: 'key', label: 'Key', class: 'mono' }, { key: 'value', label: 'Value', class: 'strong' }, { key: 'note', label: 'Note', class: 'dim' }] }) }),
      UI.section({ title: 'platforms.csv', subtitle: 'a platform = weighted combination of investor columns (the workbook\'s header-row weights and special look-through columns)', body: UI.table({ rows: plats, filter: false, compact: true, columns: [{ key: 'platform_id', label: 'ID', class: 'mono' }, { key: 'platform_label', label: 'Platform' }, { key: 'investor_label', label: 'Investor column' }, { key: 'weight', label: 'Weight', align: 'right' }] }) }),
      UI.section({ title: 'mapping_investors.csv', subtitle: `${res ? res.config.attribution_label : 'Group'} attribution weights (Output row-3/row-4 inclusion weights; column group_weight)`, body: UI.table({ rows: inv, filter: false, compact: true, columns: [{ key: 'investor_id', label: 'ID', class: 'mono' }, { key: 'investor_key', label: 'Key' }, { key: 'investor_label', label: 'Investor' }, { key: 'investor_group', label: 'Group' }, { key: 'group_weight', label: `${res ? res.config.attribution_label : 'Group'} weight`, align: 'right' }] }) }),
      UI.section({ title: 'fx.csv', subtitle: 'units of currency per 1 EUR; rows with investor/platform are overrides (the workbook\'s hard-coded exception, now data)', body: UI.table({ rows: fx, filter: false, compact: true, columns: [{ key: 'currency', label: 'Ccy' }, { key: 'rate_per_eur', label: 'Rate / EUR', align: 'right' }, { key: 'investor_id', label: 'Investor override' }, { key: 'platform_id', label: 'Platform override' }, { key: 'note', label: 'Note', class: 'dim' }] }) }),
      UI.section({ title: 'ratings.csv', subtitle: `grade → numeric (higher = weaker); SUB IG above ${res ? res.config.ig_threshold : '?'}`, body: UI.table({ rows: ratings, compact: true, columns: [{ key: 'grade', label: 'Grade' }, { key: 'numeric', label: 'Numeric', align: 'right' }, { key: 'scale', label: 'Scale' }] }) }),
    ));
  }
})(window);
