/* Scope page: Layer 3 · Investor reporting (route #/reporting).
 *
 * The investor report for one view as a native, fully editable PowerPoint deck (js/report/investor.js, written by
 * js/report/pptx.js), built on the user's own template: its cover, section break and content slides, the boxes marked
 * "x" filled by Scope. The page also keeps the report's inputs: the name on the cover, the mandate, the public-market
 * spread curves (relative value slide) and the portfolio monitoring workbook (appendix). The older analysis pack
 * (js/report/quarterly.js) stays one click away. Pick the view and currency here or in the top bar; the deck uses the
 * same result as every other page (global filters included). Templates, inputs and workbooks stay in this browser.
 */
(function (global) {
  'use strict';
  const Scope = global.Scope, U = Scope.util, F = U.fmt, UI = Scope.ui, h = UI.h;
  const store = Scope.store;

  /** The result for the Holdings sheet loaded before the current one (same view and currency), or null. */
  function previousResult(res) {
    const prev = store.state.previousHoldings;
    if (!prev || !prev.rows || (res.globalFilters || []).length) return null;
    try {
      const sheets = Object.assign({}, store.effectiveSheets(), { Holdings: { name: 'Holdings', rows: prev.rows } });
      return Scope.calc.aum.run(store.computeInput({ sheets }));
    } catch (e) { console.error(e); return null; }
  }

  /** The user's template, parsed from the bytes kept in the store, or null. */
  async function templateInForce() {
    const t = store.state.template; if (!t || !t.bytes) return null;
    return Scope.pptx.readTemplate(new Uint8Array(t.bytes), t.name);
  }
  /** What a read template holds, page by page, for the page (kept with the template). */
  function templateSummary(tpl) {
    const kinds = tpl.kinds, P = Scope.pptx;
    const NEED = { cover: ['name', 'date'], section: ['number', 'title', 'subtitle'], content: ['title'] };
    return { w: tpl.w, h: tpl.h, font: tpl.font, majorFont: tpl.majorFont || '', shapes: tpl.shapeCount, images: tpl.imageCount, dropped: tpl.dropped, layout: tpl.layoutName, colors: tpl.colors || {},
      pages: tpl.pages.map((p, i) => {
        const used = Object.entries(kinds).filter(([, k]) => k === i).map(([kind]) => kind), roles = used.map((kind) => P.slotRoles(p, kind)).flat().filter(Boolean);
        return { layout: p.layoutName, used, roles, slots: p.slots.length, inline: p.slots.filter((x) => x.inline).map((x) => x.text), box: p.box,
          missing: Array.from(new Set(used.map((kind) => (NEED[kind] || []).filter((r) => !roles.includes(r))).flat())) };
      }) };
  }

  /** The report's inputs for a view: what is typed on this page, the market curves and the monitoring workbook. */
  function inputsFor(res) {
    const all = store.state.settings.reportInputs || {}, own = all[res.platformId] || {}, data = store.state.reportData || {};
    // the asset write-ups of the assets this view holds (Asset write-ups page), in the workbook's order
    const mon = data.monitoring, monitoring = mon ? Scope.report.writeupsForView(mon.items || [], res, mon.links, { unlinked: store.state.settings.writeupsUnlinked }) : [];
    return Object.assign({}, own, { sourceLine: all.sourceLine || '', market: data.market || null, monitoring });
  }
  function setInput(viewId, key, value) {
    const all = JSON.parse(JSON.stringify(store.state.settings.reportInputs || {}));
    if (viewId) { all[viewId] = Object.assign({}, all[viewId], { [key]: value }); if (value === '' || value === null) delete all[viewId][key]; } else all[key] = value;
    store.setSetting('reportInputs', all);
  }

  /**
   * The sectors a view's reports use: Holdings (as the Output), or a Hardcoded "<investor> Sector Classification" column,
   * as picked on this page; unpicked, the column of the investor the view (or the cover) is named after, else Holdings.
   */
  function sectorSourceFor(res) {
    const own = ((store.state.settings.reportInputs || {})[res.platformId]) || {}, AUM = Scope.calc.aum;
    const pick = own.sectorSource === undefined ? AUM.sectorColumnFor(res, own.coverName) : own.sectorSource;
    return pick && pick !== 'holdings' && AUM.sectorColumns(res).includes(pick) ? pick : '';
  }
  /** The result as the reports read it: its sectors from the source picked for the view. */
  const forReport = (res) => Scope.calc.aum.withSectorColumn(res, sectorSourceFor(res));

  async function download(res0, which) {
    try {
      const res = forReport(res0);
      const common = { res, prev: previousResult(res0), template: await templateInForce(), templateText: store.state.settings.reportTemplateText || 'dark', style: store.state.settings.reportStyle || null };
      const out = which === 'analysis' ? Scope.report.quarterly(common) : Scope.report.investor(Object.assign(common, { inputs: inputsFor(res) }));
      Scope.inputs.downloadBytes(out.filename, out.deck.toBytes(), Scope.pptx.MIME);
      UI.toast(`${out.filename} downloaded · ${out.deck.slides.length} slides · sectors: ${res.sectorSource || 'Holdings'}`);
    } catch (e) { console.error(e); UI.toast(`Could not build the deck: ${(e && e.message) || e}`, 'warn'); }
  }

  const serialDate = (n) => (Number.isFinite(n) ? U.isoDate(new Date(Date.UTC(1899, 11, 30) + n * 86400000)) : '–');
  /** The rows of every sheet of an .xlsx, or of a .csv / .txt file, as [{ name, rows }]. */
  async function readGrids(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (/\.(xlsx|xlsm)$/i.test(file.name)) { const wb = await Scope.inputs.readXlsx(bytes); return wb.order.map((n) => ({ name: n, rows: (wb.sheets[n] || {}).rows || [] })); }
    const text = Scope.inputs.decodeText(bytes);
    return [{ name: file.name, rows: Scope.inputs.parseText(text).rows || [], text }];
  }

  Scope.registerModule({
    id: 'reporting', layer: 3, order: 1, title: 'Investor reporting', status: 'built', icon: 'book-open',
    render(el, ctx) {
      const res = ctx.result, R = Scope.report;
      el.appendChild(Scope.app.pageHead({ title: 'Investor reporting', sub: 'the investor report for one view as an editable PowerPoint deck on your own template: native text, tables and charts (Edit Data opens the numbers behind each chart)' }));
      if (!res || res.fatal) { el.appendChild(h('div', { class: 'notice warn' }, 'Load the four sheets on Data & validation first.')); return; }
      const views = (res.platforms || []).filter((p) => p.composition && p.composition.length);
      const viewSel = h('select', { class: 'input', 'aria-label': 'View', onChange: (e) => store.setSetting('platform', e.target.value) }, views.map((p) => h('option', { value: p.id, selected: p.id === res.platformId }, p.label)));
      const ccySel = h('select', { class: 'input', 'aria-label': 'Currency', onChange: (e) => store.setSetting('currency', e.target.value) }, (res.currencies || ['EUR']).map((c) => h('option', { value: c, selected: c === res.displayCurrency }, c)));
      const prevKept = !!(store.state.previousHoldings && store.state.previousHoldings.rows), filtered = (res.globalFilters || []).length;
      const t = store.state.template, sum = (t && t.summary) || {};
      // a template kept by an earlier version is read again once, so the page shows what this version finds in it
      if (t && t.bytes && (!sum.colors || sum.majorFont === undefined)) templateInForce().then((tpl) => { if (tpl && store.state.template === t) store.setTemplate(Object.assign({}, t, { summary: templateSummary(tpl) })); }).catch((e) => console.error(e));
      el.appendChild(UI.section({ title: 'Make the deck', body: h('div', {},
        h('div', { class: 'dp-field-row', style: { display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' } },
          h('label', { class: 'strong' }, 'View'), viewSel, h('label', { class: 'strong' }, 'Currency'), ccySel,
          h('button', { class: 'btn btn-primary', onClick: () => download(res, 'investor') }, Scope.icon('download', { size: 14 }), ' Download investor report'),
          h('button', { class: 'btn', onClick: () => download(res, 'analysis') }, Scope.icon('download', { size: 14 }), ' Analysis pack')),
        h('p', { class: 'small muted', style: { marginTop: '10px' } },
          `${res.platform.label} · ${res.quarter || ''} · reporting date ${U.isoDate(res.reportingDate)} · ${F.int(res.metrics.n_assets || 0)} assets · ${res.displayCurrency} ${F.m(res.metrics.total_exposure_m)}m · ${t ? 'on your template ' + t.name : 'house look (no template loaded)'}. `,
          filtered ? `${filtered} global filter(s) apply to the deck as to every page. ` : '',
          prevKept ? (filtered ? 'The quarter-on-quarter figures are left out while filters apply.' : 'The previous Holdings sheet is kept, so the deck shows quarter-on-quarter changes and rating changes.') : 'No previous Holdings sheet is kept, so there are no quarter-on-quarter figures (load the next quarter as a monthly update on Data › Setup).')) }));

      // ---------- the report's own inputs (per view) ----------
      const own = ((store.state.settings.reportInputs || {})[res.platformId]) || {}, srcLine = (store.state.settings.reportInputs || {}).sourceLine || '';
      const field = (label, key, ph, help, type) => h('label', { class: 'small', style: { display: 'grid', gap: '3px' }, title: help || '' }, h('span', { class: 'strong' }, label),
        h('input', { class: 'input', type: type || 'text', value: own[key] === undefined ? '' : own[key], placeholder: ph, 'aria-label': label, onChange: (e) => setInput(res.platformId, key, e.target.value.trim()) }));
      /** Which sectors the reports of this view show: Holdings (as the Output) or an investor's own classification column. */
      function sectorPicker() {
        const AUM = Scope.calc.aum, cols = AUM.sectorColumns(res), auto = AUM.sectorColumnFor(res, own.coverName), cur = sectorSourceFor(res) || 'holdings';
        return h('label', { class: 'small', style: { display: 'grid', gap: '3px' }, title: 'the sectors on the sector pages and in the asset tables of both decks; the Output and every other page always use the Holdings sector' },
          h('span', { class: 'strong' }, 'Sectors in the reports'),
          h('select', { class: 'input', 'aria-label': 'Sectors in the reports', onChange: (e) => setInput(res.platformId, 'sectorSource', e.target.value) },
            [['holdings', 'Holdings sector (as the Output)']].concat(cols.map((c) => [c, `${c} (Hardcoded)`])).map(([v, l]) => h('option', { value: v, selected: v === cur }, l))),
          own.sectorSource === undefined && auto ? h('span', { class: 'muted' }, 'picked for this view: its name, investors or fund names name that investor, or only that column covers every asset it holds') : own.sectorSource === undefined ? h('span', { class: 'muted' }, 'pick an investor\'s column for its mandates; Scope remembers it for this view') : null);
      }
      el.appendChild(UI.section({ title: 'Report inputs', subtitle: `for ${res.platform.label}; what the Holdings cannot tell. Kept in this browser.`, body: h('div', {},
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '10px 16px' } },
          field('Name on the cover', 'coverName', res.platform.label, 'the investor name on the cover and in the page headers'),
          field('Compartment / mandate name', 'compartment', res.platform.label, 'used in "Assets under management in …" and "… Guidelines"'),
          field(`Mandate size (${res.displayCurrency} m)`, 'mandate_m', 'e.g. 1500', 'the AuM slide shows funded, unfunded and left to deploy against it', 'number'),
          field(`Repaid this year (${res.displayCurrency} m)`, 'repaid_m', prevKept ? 'blank = since the previous Holdings' : 'optional', 'the "Repaid in <year>" figure; blank = the fall in drawn since the previous Holdings', 'number'),
          sectorPicker()),
        h('label', { class: 'small', style: { display: 'grid', gap: '3px', marginTop: '10px' } }, h('span', { class: 'strong' }, 'Source line (every view)'),
          h('input', { class: 'input', value: srcLine, placeholder: 'Source: internal data (unaudited at {date})', 'aria-label': 'Source line', onChange: (e) => setInput(null, 'sourceLine', e.target.value.trim()) }),
          h('span', { class: 'muted' }, '{date} becomes the reporting date, e.g. 30 September 2026.'))) }));

      // ---------- the template ----------
      const picker = h('input', { type: 'file', accept: '.pptx', class: 'hidden', 'aria-label': 'Template file', onChange: async (e) => {
        const f = e.target.files && e.target.files[0]; if (!f) return;
        try {
          const bytes = new Uint8Array(await f.arrayBuffer());
          const tpl = await Scope.pptx.readTemplate(bytes, f.name);
          store.setTemplate({ name: f.name, bytes: bytes.buffer, at: new Date().toISOString(), summary: templateSummary(tpl) });
          UI.toast(`Template kept: ${f.name} (${tpl.pages.length} page(s), ${tpl.pages.reduce((n, p) => n + p.slots.length, 0)} box(es) marked x)`);
        } catch (err) { console.error(err); UI.toast(`Could not read the template: ${(err && err.message) || err}`, 'warn'); }
        e.target.value = '';
      } });
      const pageRows = (sum.pages || []).map((p, i) => h('tr', {}, h('td', { class: 'strong' }, `Slide ${i + 1}`), h('td', {}, p.used.map((k) => ({ cover: 'cover', section: 'section breaks', content: 'content pages' })[k]).join(', ') || h('span', { class: 'dim' }, 'not used')),
        h('td', {}, p.layout || '–'), h('td', {}, p.roles.length ? Array.from(new Set(p.roles)).join(', ') : h('span', { class: 'dim' }, 'none'),
          (p.inline || []).length ? h('div', { class: 'small muted' }, `in a line: ${p.inline.map((x) => `"${x}"`).join(', ')}`) : null,
          (p.missing || []).length ? h('div', { class: 'small', style: { color: 'var(--warning, #f1885a)' } }, `no x for ${p.missing.join(', ')}: ${p.used.includes('content') ? 'Scope writes it at the top of the page' : 'left as the template has it'}`) : null),
        h('td', { class: 'small muted' }, p.used.includes('content') && p.box ? `exhibits go in ${p.box.w.toFixed(1)} × ${p.box.h.toFixed(1)} in from ${p.box.y.toFixed(2)} in down` : '')));
      el.appendChild(UI.section({ title: 'Your template', subtitle: 'a .pptx of your own: slide 1 the cover, slide 2 a section break, slide 3 a content page. In each, type x in the boxes Scope should fill and leave everything else (logo, pictures, footer, page number). It stays in this browser and is never sent anywhere.',
        body: h('div', {}, picker,
          t ? h('p', {}, h('b', {}, t.name), ` · ${sum.w ? sum.w.toFixed(2) + ' × ' + sum.h.toFixed(2) + ' in' : ''} · font ${sum.font || ''} · ${sum.images || 0} image(s)${sum.dropped ? ` · ${sum.dropped} empty placeholder(s) or linked object(s) left out` : ''}`,
            sum.colors && Object.keys(sum.colors).length ? h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '3px', marginLeft: '10px' }, title: 'The template\'s theme colours: with no style of your own (below), the charts, tables and headings use them' },
              ' · theme colours ', ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'dk2'].filter((k) => sum.colors[k]).map((k) => h('span', { title: `${k} #${sum.colors[k]}`, style: { display: 'inline-block', width: '14px', height: '14px', borderRadius: '2px', border: '1px solid var(--border-color)', background: '#' + sum.colors[k] } }))) : null)
            : h('p', { class: 'muted' }, 'No template: the deck uses the house look (white pages, green section breaks, no logo).'),
          t && sum.pages ? h('div', { class: 'tbl-scroll' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, 'Slide'), h('th', {}, 'Used for'), h('th', {}, 'Layout'), h('th', {}, 'Boxes Scope fills'), h('th', {}, ''))), h('tbody', {}, pageRows)))
            : t ? h('p', { class: 'small muted' }, 'Load the template again to see what Scope found on each slide.') : null,
          h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' } },
            h('button', { class: 'btn btn-sm', onClick: () => picker.click() }, Scope.icon('upload', { size: 14 }), t ? ' Replace the template' : ' Load a template (.pptx)'),
            t ? h('button', { class: 'btn btn-sm', onClick: () => { store.setTemplate(null); UI.toast('Template removed'); } }, Scope.icon('x', { size: 14 }), ' Remove') : null,
            t ? h('label', { class: 'small', style: { marginLeft: '12px' } }, 'Text Scope draws on it: ', h('select', { class: 'input', 'aria-label': 'Text colour on the template', onChange: (e) => store.setSetting('reportTemplateText', e.target.value) },
              [['dark', 'dark (a light background)'], ['light', 'light (a dark background)']].map(([v, l]) => h('option', { value: v, selected: (store.state.settings.reportTemplateText || 'dark') === v }, l)))) : null),
          h('details', { style: { marginTop: '8px' } }, h('summary', { class: 'small strong' }, 'How to make it'),
            h('ol', { class: 'small' },
              h('li', {}, 'Open your corporate deck in PowerPoint and keep three slides: the cover, one section break and one ordinary content page (delete the others).'),
              h('li', {}, 'Cover: replace the investor name with x and the date with x. Quotes are fine ("“X”"), and an x inside a line keeps the line: "REPORTING AS OF “X”" becomes "REPORTING AS OF 30 SEPTEMBER 2026". Scope draws nothing else on the cover or the section breaks.'),
              h('li', {}, 'Section break: replace the number, the title and the lines under it with x each.'),
              h('li', {}, 'Content page: replace the small header line with x and the page title with x; delete the slide\'s content (charts, tables) but keep the logo, footer and page number. Optionally an x where the source line goes, at the bottom.'),
              h('li', {}, 'Save as .pptx and load it here. To be explicit, type {name}, {date}, {number}, {title}, {subtitle}, {kicker} or {source} instead of x.')))) }));

      // ---------- market data: the public-market curves of the relative value slide ----------
      const data = store.state.reportData || {}, mk = data.market;
      const keepMarket = (parsed, name) => { if (!parsed.series.length) { UI.toast('No date and value columns found: paste a date column then one or two spread columns (bps)', 'warn'); return; } store.setReportData('market', { name, at: new Date().toISOString(), series: parsed.series }); UI.toast(`Kept ${parsed.series.map((x) => `${x.name} (${x.points.length} points)`).join(' and ')}`); };
      const area = h('textarea', { class: 'input', rows: 4, style: { width: '100%', fontFamily: 'monospace', fontSize: '12px' }, placeholder: 'Date\tiBoxx EUR Infrastructure BBB\tEUR High Yield BB\n31/12/2019\t92\t215\n…', 'aria-label': 'Market data' });
      const mkFile = h('input', { type: 'file', accept: '.xlsx,.xlsm,.csv,.txt', class: 'hidden', 'aria-label': 'Market data file', onChange: async (e) => {
        const f = e.target.files && e.target.files[0]; if (!f) return;
        try { const grids = await readGrids(f); const best = grids.map((g) => R.parseMarket(g.rows)).sort((a, b) => b.series.length - a.series.length || (b.series[0] ? b.series[0].points.length : 0) - (a.series[0] ? a.series[0].points.length : 0))[0]; keepMarket(best || { series: [] }, f.name); }
        catch (err) { console.error(err); UI.toast(`Could not read ${f.name}: ${err.message || err}`, 'warn'); }
        e.target.value = '';
      } });
      el.appendChild(UI.section({ title: 'Market data · relative value slide', subtitle: 'the public-market spread curves your deals are plotted against: a date column, then the BBB index and the BB index in bps (first column → BBB chart, second → BB chart). Paste from Excel or load a file.',
        body: h('div', {}, mkFile,
          mk ? h('p', {}, h('b', {}, mk.name || 'pasted'), ' · ', mk.series.map((x, i) => `${i ? 'BB chart' : 'BBB chart'}: ${x.name}, ${x.points.length} points ${serialDate(x.points[0][0])} – ${serialDate(x.points[x.points.length - 1][0])}`).join(' · '))
            : h('p', { class: 'muted' }, 'No curves kept: the slide shows your deals only.'),
          area,
          h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '6px' } },
            h('button', { class: 'btn btn-sm', onClick: () => keepMarket(R.parseMarket(area.value), 'pasted') }, Scope.icon('clipboard', { size: 14 }), ' Keep the pasted data'),
            h('button', { class: 'btn btn-sm', onClick: () => mkFile.click() }, Scope.icon('upload', { size: 14 }), ' Load a file'),
            mk ? h('button', { class: 'btn btn-sm', onClick: () => { store.setReportData('market', null); UI.toast('Market data removed'); } }, Scope.icon('x', { size: 14 }), ' Remove') : null)) }));

      // ---------- portfolio monitoring: the asset write-ups, kept and linked on their own page ----------
      const mon = data.monitoring, monIn = inputsFor(res).monitoring;
      el.appendChild(UI.section({ title: 'Portfolio monitoring · appendix', subtitle: 'one page per asset write-up (ratios, rating, description and recent events), from your write-ups workbook',
        body: h('div', {},
          mon && mon.v !== 2 ? h('div', { class: 'notice warn' }, 'The write-ups were read by an earlier version of Scope (numbers with an added "x"): load the workbook again on Asset write-ups.') : null,
          h('p', {}, mon ? `${monIn.length} of ${(mon.items || []).length} write-up(s) from ${mon.name} are about assets of ${res.platform.label}, so the appendix has ${monIn.length || 'one empty'} page(s) for them. ` : 'No write-ups loaded: the appendix has one empty page. ',
            h('a', { href: Scope.href('writeups') }, mon ? 'See and link them on Asset write-ups' : 'Load them on Asset write-ups'), '.')) }));

      // ---------- your own style: colours and font (house look by default; the template's theme colours in one click) ----------
      const st = store.state.settings.reportStyle || null, pal = R.palette(st);
      const setStyle = (next) => store.setSetting('reportStyle', next && Object.keys(next).length ? next : null);
      const colourRow = ([k, help]) => h('label', { class: 'small', style: { display: 'flex', alignItems: 'center', gap: '6px', margin: '3px 0' }, title: help },
        h('input', { type: 'color', value: '#' + pal[k], 'aria-label': k, onChange: (e) => setStyle(Object.assign({}, st || {}, { [k]: e.target.value.replace('#', '').toUpperCase() })) }), h('span', {}, help));
      const stylePicker = h('input', { type: 'file', accept: '.json', class: 'hidden', 'aria-label': 'Style file', onChange: async (e) => { const f = e.target.files && e.target.files[0]; if (!f) return; try { const j = JSON.parse(await f.text()); if (!j || typeof j !== 'object') throw new Error('not a style file'); setStyle(j); UI.toast('Style loaded'); } catch (err) { UI.toast(`Could not read the style: ${err.message || err}`, 'warn'); } e.target.value = ''; } });
      el.appendChild(UI.section({ title: 'Your style', subtitle: 'the colours and font of what Scope draws (charts, tables, headings) in the decks; kept in this browser, exportable as a small .json file. Nothing here is sent anywhere.',
        body: h('div', {}, stylePicker,
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '2px 18px' } }, R.STYLE_KEYS.map(colourRow)),
          h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '10px' } },
            h('label', { class: 'small' }, 'Font ', h('input', { class: 'input', style: { width: '160px' }, value: (st && st.font) || '', placeholder: pal.font || 'Arial (or the template\'s)', 'aria-label': 'Font', onChange: (e) => setStyle(Object.assign({}, st || {}, { font: e.target.value.trim() })) })),
            h('label', { class: 'small', title: 'the typeface of the page titles; blank = the template theme\'s heading font, as PowerPoint sets titles' }, 'Title font ', h('input', { class: 'input', style: { width: '190px' }, value: (st && st.titleFont) || '', placeholder: (t && sum.majorFont) || 'the template\'s heading font', 'aria-label': 'Title font', onChange: (e) => setStyle(Object.assign({}, st || {}, { titleFont: e.target.value.trim() })) })),
            t ? h('button', { class: 'btn btn-sm', onClick: async () => { try { const tpl = await templateInForce(); const s2 = R.styleFromTheme(tpl && tpl.colors); if (!s2 || !Object.keys(s2).length) { UI.toast('The template has no theme colours to take', 'warn'); return; } setStyle(Object.assign({}, st || {}, s2, { font: (st && st.font) || tpl.font || '' })); UI.toast('Style taken from the template\'s theme'); } catch (err) { UI.toast(`Could not read the template: ${err.message || err}`, 'warn'); } } }, Scope.icon('droplet', { size: 14 }), " Use the template's theme colours") : null,
            h('button', { class: 'btn btn-sm', onClick: () => { setStyle(null); UI.toast('House look restored'); } }, Scope.icon('rotate-ccw', { size: 14 }), ' House look'),
            h('button', { class: 'btn btn-sm', onClick: () => stylePicker.click() }, Scope.icon('upload', { size: 14 }), ' Import .json'),
            st ? h('button', { class: 'btn btn-sm', onClick: () => UI.downloadText('scope-style.json', JSON.stringify(st, null, 1)) }, Scope.icon('download', { size: 14 }), ' Export .json') : null,
            h('span', { class: 'small muted' }, st ? 'Your style is in force.' : t && sum.colors && Object.keys(sum.colors).length ? 'Your template\'s theme colours are in force (set a colour here to override).' : 'The house look is in force.'))) }));

      // ---------- the outline, from a dry run of the same builder ----------
      let outline = [];
      try { outline = R.investor({ res: forReport(res), prev: null, inputs: inputsFor(res) }).outline; } catch (e) { console.error(e); }
      el.appendChild(UI.section({ title: `What is in it · ${outline.length} slides`, subtitle: 'blank pages carry their title only, for the market commentary, the cashflow and yield projections, the pipeline and the guidelines',
        body: h('div', { class: 'tbl-scroll' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Slide'), h('th', {}, 'What it shows'))),
          h('tbody', {}, outline.map((o, i) => h('tr', {}, h('td', { class: 'dim' }, String(i + 1)), h('td', { class: 'strong' }, o.title), h('td', { class: 'wrap' }, o.note || h('span', { class: 'dim' }, '–'))))))) }));
    },
  });
})(window);
