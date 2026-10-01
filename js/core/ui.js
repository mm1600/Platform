/* Scope core: small DOM component kit (no framework).
 *
 * Registers Scope.ui (aliased `UI` in modules): the h() element builder plus the
 * AdminKit-style building blocks every page uses — KPI stat cards, badges, the
 * provenance badge, sections, definition lists, the sortable / filterable table,
 * modal, toast, chip and a text-file download helper. Styling lives in css/scope.css.
 * Loaded after icons.js and charts.js; grid.js later extends Scope.ui with Scope.ui.grid.
 */
(function (global) {
  'use strict';
  const Scope = global.Scope || (global.Scope = {});
  const U = Scope.util, esc = U.escapeHtml;
  const UI = (Scope.ui = {});

  /**
   * Hyperscript-style element builder: h('div', { class: 'x', onClick: fn }, child, ...).
   * attrs: 'class' → className; 'html' → innerHTML (trusted markup only); 'style' object →
   * inline styles; on<Event> functions → listeners (onClick → 'click'); 'dataset' object →
   * data-* attributes; true → empty boolean attribute; null / undefined / false are skipped.
   * children: nested arrays are flattened; strings and numbers become text nodes (so data
   * is never parsed as HTML); null / undefined / false are skipped.
   * @returns {HTMLElement}
   */
  UI.h = function (tag, attrs, ...children) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(e.dataset, v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    return e;
  };
  const h = UI.h;

  /** AdminKit stat card: title, icon circle top-right, big value, sub line */
  UI.kpi = ({ label, value, sub, tone, title, icon }) => h('div', { class: 'kpi' + (tone ? ' kpi-' + tone : ''), title },
    h('div', { class: 'kpi-head' }, h('div', { class: 'kpi-label' }, label), h('div', { class: 'stat' }, Scope.icon(icon || 'bar-chart-2'))),
    h('div', { class: 'kpi-value' }, value), sub ? h('div', { class: 'kpi-sub' }, sub) : null);

  /** Small pill; kind adds a badge-<kind> modifier (e.g. 'synthetic', 'error', 'calc'); title becomes the hover text. */
  UI.badge = (textContent, kind, title) => h('span', { class: 'badge' + (kind ? ' badge-' + kind : ''), title }, textContent);

  /**
   * Provenance badge from a source descriptor {table,row,col,adjustment,original,note}.
   * 'manual' → Manual (who, original value, reason from the store's adjustment trail);
   * 'calc' → Calculated (engine-derived); anything else → Imported, naming the CSV table,
   * file line and column so every displayed value can be traced back to its input.
   */
  UI.prov = function (src) {
    if (!src) return UI.badge('n/a', 'muted', 'No source recorded');
    if (src.table === 'manual') return UI.badge('Manual', 'manual', `Manual adjustment by ${src.adjustment ? src.adjustment.user : '?'} · original: ${src.original === undefined ? '' : src.original} · reason: ${src.adjustment ? src.adjustment.reason : ''}`);
    if (src.table === 'calc') return UI.badge('Calculated', 'calc', src.note || 'Calculated by the engine');
    return UI.badge('Imported', 'imported', `${src.table}${src.row ? ' · line ' + src.row : ''}${src.col ? ' · column "' + src.col + '"' : ''}`);
  };

  /** Card-style page section: header (title, optional subtitle and right-aligned actions) + body (element or trusted HTML string). */
  UI.section = function ({ title, subtitle, actions, body, class: cls, id }) {
    const head = h('div', { class: 'section-head' }, h('div', {}, h('h2', {}, title), subtitle ? h('p', { class: 'section-sub' }, subtitle) : null), actions ? h('div', { class: 'section-actions' }, actions) : null);
    const bodyEl = typeof body === 'string' ? h('div', { html: body }) : body;
    return h('section', { class: 'section ' + (cls || ''), id }, head, bodyEl);
  };

  /** Muted placeholder block for an empty state. */
  UI.empty = (msg) => h('div', { class: 'empty' }, msg);
  /** Definition list from [[term, value], ...] pairs (values may be elements). */
  UI.dl = (pairs) => h('dl', { class: 'dl' }, pairs.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));

  /**
   * Save text as a file via a temporary object URL and a synthetic <a download> click
   * (works from file:// with no server). Defaults to CSV; the URL is revoked shortly after.
   */
  UI.downloadText = function (filename, textContent, mime) {
    const blob = new Blob([textContent], { type: mime || 'text/csv;charset=utf-8' });
    const a = h('a', { href: URL.createObjectURL(blob), download: filename });
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };

  /** Transient notification in a shared bottom-corner stack; fades out after ~3.2 s. kind: optional modifier class, e.g. 'warn'. */
  UI.toast = function (msg, kind) {
    let host = document.querySelector('.toasts'); if (!host) { host = h('div', { class: 'toasts' }); document.body.appendChild(host); }
    const t = h('div', { class: 'toast ' + (kind || '') }, msg); host.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 3200);
  };

  /**
   * Open a modal dialog appended to <body>. Closes on the × button or a click on the
   * backdrop (not inside the dialog).
   * @returns {{close: function(), el: HTMLElement}} so callers can close it from their actions
   */
  UI.modal = function ({ title, body, actions, wide }) {
    const close = () => overlay.remove(); // declared first so the backdrop and × handlers can reference it
    const overlay = h('div', { class: 'modal-overlay', onClick: (e) => { if (e.target === overlay) close(); } },
      h('div', { class: 'modal' + (wide ? ' modal-wide' : ''), role: 'dialog', 'aria-modal': 'true' },
        h('div', { class: 'modal-head' }, h('h3', {}, title), h('button', { class: 'btn btn-ghost btn-sm', onClick: close, 'aria-label': 'Close' }, Scope.icon('x', { size: 16 }))),
        h('div', { class: 'modal-body' }, body),
        actions ? h('div', { class: 'modal-actions' }, actions) : null));
    document.body.appendChild(overlay);
    return { close, el: overlay };
  };

  /** Toggle-style pill button (filters, selectors); `active` adds the highlighted state. */
  UI.chip = (label, active, onClick) => h('button', { class: 'chip' + (active ? ' active' : ''), onClick }, label);

  /**
   * Sortable/filterable table for small and medium row counts (the virtualised
   * Scope.ui.grid in grid.js handles large ones).
   * columns: [{ key, label, align:'right'|'left', format(v,row)→string, html(row)→string, render(row)→Element,
   *             sortValue(row), width, title, class, total:'sum'|fn(rows) }]
   * opts: { rows, rowKey, onRow(row), filter:true, filterPlaceholder, exportName, extraToolbar,
   *         sortKey, sortDir, pageSize, compact, totalsLabel }
   * Renders the first pageSize rows (default 200) with a "Show all" button; the returned
   * element has refresh() to redraw. Export CSV writes the visible (filtered, sorted) rows
   * as displayed (formatted text), headed by the column labels.
   */
  UI.table = function (opts) {
    const columns = opts.columns, allRows = opts.rows || [];
    const st = { sortKey: opts.sortKey || null, sortDir: opts.sortDir || 'desc', q: '', limit: opts.pageSize || 200 };
    const root = h('div', { class: 'tbl-wrap' + (opts.compact ? ' compact' : '') });
    const toolbar = h('div', { class: 'tbl-toolbar' });
    const count = h('span', { class: 'tbl-count' });
    const input = opts.filter === false ? null : h('input', { type: 'search', class: 'input tbl-filter', placeholder: opts.filterPlaceholder || 'Filter rows…', onInput: (e) => { st.q = e.target.value.toLowerCase(); draw(); } });
    const exportBtn = opts.exportName ? h('button', { class: 'btn btn-sm', onClick: () => UI.downloadText(opts.exportName, Scope.csv.serialize(visible().map(flat), columns.map((c) => c.label))) }, Scope.icon('download', { size: 14 }), 'Export CSV') : null;
    toolbar.append(input || h('span'), count, exportBtn || h('span'));
    const scroller = h('div', { class: 'tbl-scroll' });
    root.append(toolbar, scroller);
    if (opts.extraToolbar) toolbar.insertBefore(opts.extraToolbar, count);

    // Displayed text of a cell: used for rendering, the quick filter and the CSV export alike.
    const cellText = (c, row) => { const v = row[c.key]; return c.format ? c.format(v, row) : v === null || v === undefined ? '' : String(v); };
    // flat: a row as { column label: displayed text } for CSV export; sortVal: the value a column sorts on.
    const flat = (row) => { const o = {}; columns.forEach((c) => { o[c.label] = cellText(c, row); }); return o; };
    const sortVal = (c, row) => (c.sortValue ? c.sortValue(row) : row[c.key]);
    /**
     * Rows after the quick filter (case-insensitive substring over every column's
     * displayed text) and the current sort. Blanks and NaN always sort last in both
     * directions; numbers compare numerically, everything else with a natural-order
     * localeCompare ("A2" before "A10").
     */
    function visible() {
      let rows = allRows;
      if (st.q) rows = rows.filter((r) => columns.some((c) => cellText(c, r).toLowerCase().includes(st.q)));
      if (st.sortKey) {
        const c = columns.find((x) => x.key === st.sortKey);
        if (c) rows = rows.slice().sort((a, b) => {
          const x = sortVal(c, a), y = sortVal(c, b);
          const xn = x === null || x === undefined || x === '' || (typeof x === 'number' && isNaN(x)), yn = y === null || y === undefined || y === '' || (typeof y === 'number' && isNaN(y));
          if (xn && yn) return 0; if (xn) return 1; if (yn) return -1;
          const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
          return st.sortDir === 'desc' ? -r : r;
        });
      }
      return rows;
    }
    /** Rebuild the whole table (header, body, totals footer, "Show all") from the current state. */
    function draw() {
      const rows = visible();
      count.textContent = rows.length === allRows.length ? `${rows.length} rows` : `${rows.length} of ${allRows.length} rows`;
      const table = h('table', { class: 'tbl' });
      const thead = h('thead', {}, h('tr', {}, columns.map((c) => h('th', {
        class: (c.align === 'right' ? 'num ' : '') + (st.sortKey === c.key ? 'sorted ' + st.sortDir : ''), style: c.width ? { width: c.width } : null, title: c.title || '',
        // Header click: same column toggles direction; a new column starts descending for numbers, ascending for text.
        onClick: () => { if (st.sortKey === c.key) st.sortDir = st.sortDir === 'desc' ? 'asc' : 'desc'; else { st.sortKey = c.key; st.sortDir = c.align === 'right' ? 'desc' : 'asc'; } draw(); },
      }, c.label, h('span', { class: 'sort-ind' })))));
      const tbody = h('tbody');
      rows.slice(0, st.limit).forEach((row) => {
        const tr = h('tr', { class: opts.onRow ? 'clickable' : '', onClick: opts.onRow ? () => opts.onRow(row) : null });
        columns.forEach((c) => {
          const td = h('td', { class: (c.align === 'right' ? 'num' : '') + (c.class ? ' ' + c.class : '') });
          if (c.html) td.innerHTML = c.html(row); else if (c.render) td.appendChild(c.render(row)); else td.textContent = cellText(c, row);
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      table.append(thead, tbody);
      // Totals footer over all filtered rows (not just the rendered page); first non-total column shows the label.
      if (columns.some((c) => c.total)) {
        const tf = h('tfoot', {}, h('tr', {}, columns.map((c, i) => {
          let v = '';
          if (c.total === 'sum') { const s = rows.reduce((a, r) => a + (U.isNum(r[c.key]) ? r[c.key] : 0), 0); v = c.format ? c.format(s, null) : String(s); }
          else if (typeof c.total === 'function') v = c.total(rows);
          else if (i === 0) v = opts.totalsLabel || 'Total';
          return h('td', { class: c.align === 'right' ? 'num' : '' }, v);
        })));
        table.appendChild(tf);
      }
      scroller.innerHTML = ''; scroller.appendChild(table);
      if (rows.length > st.limit) scroller.appendChild(h('button', { class: 'btn btn-sm btn-ghost show-all', onClick: () => { st.limit = Infinity; draw(); } }, `Show all ${rows.length} rows`));
    }
    draw();
    root.refresh = draw;
    return root;
  };
})(typeof window !== 'undefined' ? window : globalThis);
