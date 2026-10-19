/* Quarterly report tests (js/report/pptx.js, js/report/quarterly.js): the deck is a valid package whose every relationship
 * resolves, every XML part is well formed, and the chart caches and embedded workbooks hold the result's own figures.
 */
(function (global) {
  'use strict';
  const Scope = global.Scope, IN = Scope.inputs, T = Scope.tests;
  const assert = (c, msg) => { if (!c) throw new Error(msg || 'assertion failed'); };
  const dec = new TextDecoder();
  /** Tag balance check: every element opened is closed in order (enough to catch a malformed part). */
  function wellFormed(xml) {
    const stack = []; const re = /<(\/?)([A-Za-z_][\w:.-]*)([^>]*?)(\/?)>/g; let m;
    const body = xml.replace(/<\?xml[^>]*\?>/, '');
    while ((m = re.exec(body))) {
      if (m[4] === '/') continue;
      if (m[1]) { const top = stack.pop(); if (top !== m[2]) return `</${m[2]}> closes <${top}>`; } else stack.push(m[2]);
    }
    return stack.length ? `unclosed <${stack[stack.length - 1]}>` : '';
  }
  async function unpack(bytes) { const out = {}; for (const e of IN.zipEntries(bytes)) out[e.name] = await e.bytes(); return out; }

  T.add('quarterly report: a valid PowerPoint package, every relationship resolves, every part well formed', async () => {
    const res = T.demo({ platform: 'Region A' });
    const out = Scope.report.quarterly({ res });
    const parts = await unpack(out.deck.toBytes());
    const names = Object.keys(parts);
    for (const n of ['[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml', 'ppt/slideMasters/slideMaster1.xml', 'ppt/slideLayouts/slideLayout1.xml', 'ppt/theme/theme1.xml', 'docProps/core.xml']) assert(names.includes(n), 'missing ' + n);
    const slides = names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    assert(slides.length === out.deck.slides.length && slides.length >= 10, `${slides.length} slides`);
    const types = dec.decode(parts['[Content_Types].xml']);
    for (const n of names) {
      if (/\.xml$/.test(n) || /\.rels$/.test(n)) { const err = wellFormed(dec.decode(parts[n])); assert(!err, `${n}: ${err}`); }
      if (/\.xml$/.test(n) && n !== '[Content_Types].xml' && !/\.rels$/.test(n)) assert(types.includes(`PartName="/${n}"`), 'no content type for ' + n);
    }
    // every relationship target exists
    for (const n of names.filter((x) => /\.rels$/.test(x))) {
      const dir = n.replace(/_rels\/[^/]*\.rels$/, '');
      for (const m of dec.decode(parts[n]).matchAll(/Target="([^"]+)"/g)) {
        const parts2 = (dir + m[1]).split('/'), st = [];
        for (const p of parts2) { if (p === '..') st.pop(); else if (p && p !== '.') st.push(p); }
        assert(names.includes(st.join('/')), `${n} → ${m[1]} missing`);
      }
    }
    assert(/^Region-A-quarterly-report-Q\d-\d{4}\.pptx$/.test(out.filename), out.filename);
  });

  T.add('quarterly report: chart caches and embedded workbooks carry the result figures; no placeholder text leaks', async () => {
    const res = T.demo({ platform: 'Investor 1 incl. part in funds' });
    const out = Scope.report.quarterly({ res });
    const parts = await unpack(out.deck.toBytes());
    const all = Object.keys(parts).filter((n) => /ppt\/slides\/slide\d+\.xml$/.test(n)).map((n) => dec.decode(parts[n])).join('');
    assert(!/NaN|undefined|\[object/.test(all), 'no NaN / undefined in slide text');
    assert(all.includes('Investor 1 incl. part in funds') && all.includes(res.metrics.total_exposure_m.toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })), 'view and total exposure written');
    // the sector chart (slide 3, first chart in the deck order after the key-figure doughnuts) holds the sector distribution
    const charts = Object.keys(parts).filter((n) => /ppt\/charts\/chart\d+\.xml$/.test(n)).map((n) => dec.decode(parts[n]));
    const sec = res.distributions.sector.filter((d) => d.exposure_m > 0);
    const hit = charts.find((x) => x.includes(`<c:v>${sec[0].label}</c:v>`) && x.includes(`<c:v>${sec[0].exposure_m}</c:v>`));
    assert(hit, 'a chart cache carries the top sector and its exposure');
    // every embedded workbook opens with the workbook reader and matches its chart cache
    const books = Object.keys(parts).filter((n) => /ppt\/embeddings\/.+\.xlsx$/.test(n));
    assert(books.length === charts.length, `${books.length} workbooks for ${charts.length} charts`);
    // each chart's workbook (via its relationship file) opens and its first category and value match the chart's cache
    let compared = 0;
    for (const name of Object.keys(parts).filter((n) => /ppt\/charts\/chart\d+\.xml$/.test(n))) {
      const xml = dec.decode(parts[name]), rels = dec.decode(parts[name.replace('charts/', 'charts/_rels/') + '.rels'] || new Uint8Array());
      const target = (rels.match(/Target="\.\.\/embeddings\/([^"]+)"/) || [])[1];
      assert(target && parts['ppt/embeddings/' + target], `${name}: embedded workbook linked`);
      const wb = await IN.readXlsx(parts['ppt/embeddings/' + target]);
      const g = Object.values(wb.sheets || wb)[0];
      assert(g && g.rows && g.rows.length >= 2, `${name}: embedded workbook readable`);
      const cat = (xml.match(/<c:cat>[\s\S]*?<c:pt idx="0"><c:v>([^<]*)<\/c:v>/) || [])[1];
      const val = (xml.match(/<c:val>[\s\S]*?<c:pt idx="0"><c:v>([^<]*)<\/c:v>/) || [])[1];
      if (cat !== undefined) assert(String(g.rows[1][0]) === cat.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'), `${name}: first category ${g.rows[1][0]} vs cache ${cat}`);
      if (val !== undefined) assert(Math.abs(+g.rows[1][1] - +val) < 1e-9, `${name}: first value ${g.rows[1][1]} vs cache ${val}`);
      if (cat !== undefined && val !== undefined) compared++;
    }
    assert(compared === charts.length, `${compared} of ${charts.length} charts compared with their workbooks`);
    const tile = all.match(/Exposure<\/a:t>/g) || [];
    assert(tile.length >= 2, 'exposure tiles written');
  });

  T.add('quarterly report: with a previous Holdings the changes slide counts added and exited assets', () => {
    const cur = T.demo({ platform: 'Total platform' });
    // previous period: the same workbook without the largest asset's rows, so that asset shows as added
    const sheets = T.demoSheets(), H = sheets.Holdings;
    const hr = H.rows.findIndex((r) => (r || []).includes('Quotation Currency')), ci = H.rows[hr].indexOf('Security ID');
    const big = cur.rows[0], ids = new Set(big.asset.holdings.map(String));
    H.rows = H.rows.filter((r, i) => i <= hr || !ids.has(String((r || [])[ci])));
    const prev = T.demo({ sheets, platform: 'Total platform' });
    const out = Scope.report.quarterly({ res: cur, prev });
    const note = out.outline.find((o) => /^Changes/.test(o.title)).note;
    assert(/1 asset\(s\) added, 0 exited/.test(note), note);
  });

  T.add('quarterly report on a template: the template\'s size, theme, master, layout and background shapes are used on every slide; the package stays valid', async () => {
    const P = Scope.pptx;
    const tdeck = P.deck({ title: 'Template' }); const ts = tdeck.slide();
    ts.rect({ x: 0, y: 7.1, w: 13.333, h: 0.4, fill: '00915A' }); ts.text({ x: 0.3, y: 7.12, w: 6, h: 0.35, text: 'Template footer', size: 9, color: 'FFFFFF' });
    const tpl = await P.readTemplate(tdeck.toBytes(), 'test.pptx');
    assert(tpl.shapeCount === 2 && tpl.dropped === 0 && Math.abs(tpl.w - 13.333) < 0.01 && tpl.font === 'Arial', 'template read: ' + JSON.stringify({ n: tpl.shapeCount, w: tpl.w, font: tpl.font }));
    const res = T.demo({ platform: 'Region A' });
    const out = Scope.report.quarterly({ res, template: tpl }), parts = await unpack(out.deck.toBytes()), names = Object.keys(parts);
    const slides = names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    assert(slides.length === out.deck.slides.length && slides.length > 5, 'slides written');
    for (const n of slides) { const x = dec.decode(parts[n]); assert(x.includes('Template footer') && x.includes('id="1002"') && !x.includes('<p:ph'), n + ' carries the template shapes'); }
    assert(dec.decode(parts['ppt/slides/slide2.xml']).indexOf('Template footer') < dec.decode(parts['ppt/slides/slide2.xml']).indexOf('Source: Holdings'), 'template shapes sit under Scope\'s');
    assert(dec.decode(parts['ppt/presentation.xml']).includes(`cx="${Math.round(13.333 * 914400)}"`), 'slide size from the template');
    // every part well formed, every relationship target present (as the package test checks)
    const types = dec.decode(parts['[Content_Types].xml']);
    for (const n of names) { if (/\.xml$|\.rels$/.test(n)) { const err = wellFormed(dec.decode(parts[n])); assert(!err, `${n}: ${err}`); } if (/\.xml$/.test(n) && n !== '[Content_Types].xml') assert(types.includes(`PartName="/${n}"`), 'no content type for ' + n); }
    for (const n of names.filter((x) => /\.rels$/.test(x))) { const dir = n.replace(/_rels\/[^/]*\.rels$/, ''); for (const m of dec.decode(parts[n]).matchAll(/Target="([^"]+)"/g)) { const st = []; for (const p of (dir + m[1]).split('/')) { if (p === '..') st.pop(); else if (p && p !== '.') st.push(p); } assert(names.includes(st.join('/')), `${n} → ${m[1]} missing`); } }
    // without a template nothing changes
    const plain = await unpack(Scope.report.quarterly({ res }).deck.toBytes());
    assert(!dec.decode(plain['ppt/slides/slide2.xml']).includes('Template footer'), 'plain deck untouched');
  });

  T.add('pack designer: every block type gives content on the demo; the standard layout builds a valid deck with every block; a custom layout with an asset card and text', async () => {
    const W = Scope.report.widgets, res = T.demo({ platform: 'Region A' }), ctx = W.context(res, null);
    for (const type of Object.keys(W.TYPES)) {
      const w = W.create(type, 0, 0); if (type === 'asset') w.opts.code = res.rows[0].code;
      const c = W.content(w, ctx);
      assert(c && c.kind && (c.kind !== 'table' || (c.head.length && c.rows.length >= 0)) && (c.kind !== 'chart' || c.categories.length === c.series[0].values.length), type + ' content: ' + JSON.stringify(c).slice(0, 120));
    }
    const kpi = W.content(W.create('kpi', 0, 0), ctx); assert(kpi.value === res.metrics.total_exposure_m.toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 }), 'KPI shows the view total');
    const L = W.standardLayout(); assert(L.slides.length === 9 && L.slides[0].cover, 'standard layout');
    const out = Scope.report.custom({ res, layout: L }), parts = await unpack(out.deck.toBytes()), names = Object.keys(parts);
    assert(out.deck.slides.length === 9 && /Region-A-Standard-pack/.test(out.filename), 'nine slides: ' + out.filename);
    const types = dec.decode(parts['[Content_Types].xml']);
    for (const n of names) { if (/\.xml$|\.rels$/.test(n)) { const err = wellFormed(dec.decode(parts[n])); assert(!err, `${n}: ${err}`); } if (/\.xml$/.test(n) && n !== '[Content_Types].xml') assert(types.includes(`PartName="/${n}"`), 'no content type for ' + n); }
    for (const n of names.filter((x) => /\.rels$/.test(x))) { const dir = n.replace(/_rels\/[^/]*\.rels$/, ''); for (const m of dec.decode(parts[n]).matchAll(/Target="([^"]+)"/g)) { const st = []; for (const p of (dir + m[1]).split('/')) { if (p === '..') st.pop(); else if (p && p !== '.') st.push(p); } assert(names.includes(st.join('/')), `${n} → ${m[1]} missing`); } }
    const all = names.filter((n) => /ppt\/slides\/slide\d+\.xml$/.test(n)).map((n) => dec.decode(parts[n])).join('');
    assert(!/NaN|undefined|\[object/.test(all) && all.includes('Key figures') && all.includes('Figure 1 –'), 'titles and captions written');
    const custom = { name: 'Mine', slides: [{ title: 'One asset', message: 'A card and a note', widgets: [Object.assign(W.create('asset', 0, 0), { w: 10, h: 8, opts: { code: res.rows[0].code, details: ['sector', 'country', 'exposure_m'], title: '' } }), Object.assign(W.create('text', 12, 0), { opts: { title: 'Note', text: 'First line.\nSecond line.' } })] }] };
    const two = await unpack(Scope.report.custom({ res, layout: custom }).deck.toBytes());
    const x = dec.decode(two['ppt/slides/slide1.xml']);
    assert(x.includes('One asset') && x.includes(res.rows[0].name) && x.includes('Second line.') && x.includes('Exposure in the view'), 'custom page carries the card and the text');
    assert(Scope.report.houseKit && Scope.report.PALETTE.green === '0F7164', 'house kit present');
  });

  /** Every XML part well formed, every part typed, every relationship target present. */
  function packageOk(parts) {
    const names = Object.keys(parts), types = dec.decode(parts['[Content_Types].xml']);
    for (const n of names) { if (/\.xml$|\.rels$/.test(n)) { const err = wellFormed(dec.decode(parts[n])); assert(!err, `${n}: ${err}`); } if (/\.xml$/.test(n) && n !== '[Content_Types].xml') assert(types.includes(`PartName="/${n}"`), 'no content type for ' + n); }
    for (const n of names.filter((x) => /\.rels$/.test(x))) { const dir = n.replace(/_rels\/[^/]*\.rels$/, ''); for (const m of dec.decode(parts[n]).matchAll(/Target="([^"]+)"( TargetMode="External")?/g)) { if (m[2]) continue; const st = []; for (const q of (dir + m[1]).split('/')) { if (q === '..') st.pop(); else if (q && q !== '.') st.push(q); } assert(names.includes(st.join('/')), `${n} → ${m[1]} missing`); } }
    // every r:id / r:embed a slide uses is one of its relationships
    for (const n of names.filter((x) => /^ppt\/(slides|slideLayouts|slideMasters)\/[^/]+\.xml$/.test(x))) {
      const relN = n.replace(/([^/]+)$/, '_rels/$1.rels'), ids = new Set(Array.from(dec.decode(parts[relN] || new Uint8Array()).matchAll(/Id="([^"]+)"/g)).map((m) => m[1]));
      for (const m of dec.decode(parts[n]).matchAll(/\br:(?:id|embed|link)="([^"]+)"/g)) assert(ids.has(m[1]), `${n} uses ${m[1]} with no relationship`);
    }
    return names;
  }

  T.add('investor report: sections, overview, sectors and map, AuM, spreads, relative value, asset table and monitoring pages; a valid package', async () => {
    const R = Scope.report, res = T.demo({ platform: 'Region A' });
    const market = R.parseMarket('Date\tBBB index\tBB index\n31/12/2019\t90\t210\n31/03/2020\t190\t520\n30/09/2026\t130\t330');
    assert(market.series.length === 2 && market.series[0].name === 'BBB index' && market.series[1].points.length === 3 && market.series[0].points[0][0] === 43830, 'market curves read: ' + JSON.stringify(market).slice(0, 160));
    const monitoring = [{ ref: '1/2', name: 'Asset A', description: 'A company', metrics: [{ label: 'Net debt / EBITDA', actual: '7.56x', lockup: '7.75x', covenant: '8.25x' }], rating: '- / BBB / -', events: ['First event.', 'Second event.'] }, { name: 'Asset B', events: ['Only event.'], metrics: [] }];
    const out = R.investor({ res, inputs: { mandate_m: '2000', coverName: 'Investor X', market, monitoring } });
    const parts = await unpack(out.deck.toBytes()), names = packageOk(parts);
    const titles = out.outline.map((o) => o.title);
    assert(titles[0] === 'Cover' && titles.includes('01 MARKET ACTIVITY') && titles.includes('05 APPENDIX') && titles.includes('Portfolio Monitoring (2/2)') && titles.filter((x) => x === 'Current market activity').length === 2, 'outline: ' + titles.join(' | '));
    assert(out.deck.slides.length === titles.length && /^Investor-X-investor-report-Q\d-\d{4}\.pptx$/.test(out.filename), out.filename);
    const slides = names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]).map((n) => dec.decode(parts[n]));
    const all = slides.join('');
    assert(!/NaN|undefined|\[object/.test(all), 'no NaN or undefined written');
    assert(slides[0].includes('INVESTOR X') && all.includes('€2,000 M') && all.includes('Left to deploy') && all.includes('Unfunded &amp; partially funded transactions'), 'cover and AuM slide');
    const charts = names.filter((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n)).map((n) => dec.decode(parts[n]));
    assert(charts.some((c) => c.includes('<c:bubbleChart>')) && charts.filter((c) => c.includes('<c:scatterChart>')).length === 2 && charts.some((c) => c.includes('BBB index')), 'bubble and two scatter charts, the curve plotted');
    assert(all.includes('<a:custGeom>') && all.includes('name="ES"'), 'the map is drawn as one freeform per country');
    const mapSlide = slides.find((x) => x.includes('name="ES"')), es = mapSlide.match(/name="ES"[\s\S]*?<\/a:pathLst>/)[0];
    assert(Scope.europeMap && (mapSlide.match(/<a:custGeom>/g) || []).length > 40 && (es.match(/<a:lnTo>/g) || []).length > 80, 'the map uses the 1:50m Europe outlines (Spain in more than 80 points)');
    for (const r of res.rows) { const n = r.code_name || r.name; assert(all.includes(n.replace(/&/g, '&amp;')), 'asset table lists ' + n + ' (the code name)'); }
    assert(all.includes('Net debt / EBITDA') && all.includes('7.75x') && all.includes('Second event.'), 'monitoring page');
    const plain = R.investor({ res });
    assert(plain.outline.some((o) => o.title === 'Portfolio Monitoring') && plain.deck.slides.length === out.deck.slides.length - 1, 'without a workbook the appendix keeps one page');
  });

  T.add('investor report follows the house deck: split, sector and group orders, Benelux, unfunded table by tranche, Bond/Loan, UK, internal rating unless NR, own classification column', async () => {
    const R = Scope.report, demo = T.demo({ platform: 'Region A' }), base = demo.rows;
    const mk = (i, o) => Object.assign({}, base[i], { chronological_order: i + 1, funding_date: null, rank: i + 1 }, o);
    const rows = [
      mk(0, { asset_group: 'Grp B', transaction_group: 'TG-B', currency: 'GBP', repayment_type: 'Bullet', cash_flow_type: 'Merchant', sector: 'Social', subsector: 'Education', wal_years: 22, country: 'NETHERLANDS', instrument: 'Infra Bond', external_grade: 'Baa3', internal_grade: 'BBB', exposure_m: 10, drawn_m: 10 }),
      mk(1, { asset_group: 'Grp A', transaction_group: 'TG-A', currency: 'EUR', repayment_type: 'Amortising', cash_flow_type: 'PPP', sector: 'Transport', subsector: 'Rosco', wal_years: 3, country: 'UK', instrument: 'Loan', external_grade: 'NR', internal_grade: 'BBB-', exposure_m: 100, drawn_m: 40 }),
      mk(2, { asset_group: 'Grp A', transaction_group: 'TG-A', currency: 'EUR', repayment_type: 'Amortising', cash_flow_type: 'Contracted', sector: 'Transport', subsector: 'Roads', wal_years: 17, country: 'BELGIUM', instrument: 'Private Placement Note', exposure_m: 50, drawn_m: 50 }),
      mk(3, { asset_group: 'Grp C', transaction_group: 'TG-C', currency: 'SEK', repayment_type: 'Bullet', cash_flow_type: 'Regulated', sector: 'Energy', subsector: 'Electricity networks', wal_years: 7, country: 'GERMANY', exposure_m: 30, drawn_m: 0 }),
      mk(4, { asset_group: 'Grp B', transaction_group: 'TG-B', currency: 'EUR', repayment_type: 'Bullet', cash_flow_type: 'Contracted', sector: 'Telecom', subsector: 'Fibre network', wal_years: 12, country: 'SPAIN', exposure_m: 20, drawn_m: 20 }),
    ];
    const res = Object.assign({}, demo, { rows, distributions: Object.assign({}, demo.distributions, { currency: undefined }) });
    const parts = await unpack(R.investor({ res }).deck.toBytes()), names = packageOk(parts);
    const charts = names.filter((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n)).map((n) => dec.decode(parts[n]));
    const cats = (c) => ((c.match(/<c:cat>[\s\S]*?<\/c:cat>/) || [''])[0].match(/<c:v>[^<]*<\/c:v>/g) || []).map((v) => v.slice(5, -6)).join(', ');
    const donuts = charts.filter((c) => c.includes('<c:doughnutChart>')).map(cats);
    // the four splits clockwise from 12 o'clock in the workbook's fixed lists, not by size
    for (const want of ['EUR, GBP, SEK', 'Bullet, Amortizing', '&lt; 5, 5 - 10, 10 - 15, 15 - 20, &gt; 20', 'PPP, Regulated, Contracted, Merchant']) assert(donuts.includes(want), `split ${want} in: ${donuts.join(' | ')}`);
    // sectors in the house order, subsectors in the house order under each; the groups in the order the asset list first has them
    assert(donuts.includes('Energy, Transport, Telecom, Social') && donuts.includes('Electricity networks, Roads, Rosco, Fibre network, Education'), 'sector rings: ' + donuts.join(' | '));
    assert(donuts.includes('Grp B, Grp A, Grp C'), 'groups by first appearance: ' + donuts.join(' | '));
    const bubble = charts.find((c) => c.includes('<c:bubbleChart>')), sers = (bubble.match(/<c:ser>[\s\S]*?<\/c:tx>/g) || []).map((x) => x.match(/<c:v>([^<]*)<\/c:v>/)[1]);
    assert(sers.join(', ') === 'Energy, Social, Transport, Telecoms', 'bubble sectors: ' + sers.join(', '));
    // every house sector along the bottom in the workbook's order, empty ones too; a band of room above and below; labels "37 M€"
    const bslide = names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).map((n) => dec.decode(parts[n])).find((x) => x.includes('Spreads across sectors')), bt = (bslide.match(/<a:t>[^<]*<\/a:t>/g) || []).map((t) => t.slice(5, -6));
    const order = ['Energy', 'Renewable Power', 'Social', 'Transport', 'Telecoms', 'Utilities'].map((l) => bt.indexOf(l));
    assert(order.every((i, k) => i >= 0 && (k === 0 || i > order[k - 1])), 'six sectors in order: ' + bt.join('|'));
    assert(bt.some((t) => / – OUTSTANDING SPREADS ACROSS PORTFOLIO$/.test(t)), 'kicker names the investor: ' + bt.slice(0, 4).join('|'));
    assert(/<c:max val="7"\/>/.test(bubble) && /<c:min val="0"\/>/.test(bubble) && /\d M€/.test(bubble), 'room above the top band, labels as "37 M€"');
    const slides = names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).map((n) => dec.decode(parts[n])), all = slides.join('');
    const txt = (x) => (x.match(/<a:t>[^<]*<\/a:t>/g) || []).map((t) => t.slice(5, -6));
    // unfunded and partly funded: one row per group, most undrawn first (A 60 undrawn, C 30); B is fully drawn
    const aum = txt(slides.find((x) => x.includes('Unfunded &amp; partially funded transactions')));
    // one row per tranche with anything undrawn, by its code name, the most undrawn first (A's first tranche 60 undrawn, C 30)
    const nmOf = (r) => r.code_name || r.name, ia = aum.lastIndexOf(nmOf(rows[1])), ic = aum.lastIndexOf(nmOf(rows[3]));
    assert(ia > aum.indexOf('Transaction') && ic > ia && aum[ia + 1] === '40.0' && aum[ia + 2] === '40%' && aum[ic + 1] === '0.0' && aum[ic + 2] === '0%' && aum.lastIndexOf(nmOf(rows[2])) < aum.indexOf('Transaction'), 'tranche table: ' + aum.join('|'));
    // the AuM page as the house deck words it: the investor's kicker, "Portfolio overview" title, labels from the left, the banner in Accent 1
    const aumSlide = slides.find((x) => x.includes('Unfunded &amp; partially funded transactions'));
    assert(aum.some((t) => / – ASSETS UNDER MANAGEMENT$/.test(t)) && aum.includes('Portfolio overview as at end of June 2026') && aum.includes('Amount (€m)') && aum.includes('Transaction') && !aum.includes('Total assets under management'), 'AuM page words: ' + aum.slice(0, 12).join('|'));
    assert(/<a:srgbClr val="00A2A3"\/>[\s\S]{0,400}?Assets under management/.test(aumSlide) || aumSlide.includes('00A2A3'), 'banner in Accent 1');
    assert(!/<a:pPr algn="r"[^>]*>(?:(?!<\/a:p>)[\s\S])*?<a:t>Funded<\/a:t>/.test(aumSlide), 'Funded from the left');
    // the portfolio split in month case; doughnut labels never wrap inside a word
    assert(all.includes('Portfolio split – June 2026') && !all.includes('Portfolio split – JUNE'), 'split title in month case');
    const dn = names.filter((n) => /charts\/chart\d+\.xml$/.test(n)).map((n) => dec.decode(parts[n])).filter((c) => c.includes('<c:doughnutChart>'));
    // the labels are set by hand round the ring (a chart's own get cut at the ring's edge), each on one line, never wrapped
    assert(dn.length && dn.every((c) => !/<c:showPercent val="1"\/>/.test(c)) && slides.some((x) => x.includes('Portfolio split') && /wrap="none"[\s\S]*?<a:t>EUR<\/a:t>/.test(x)), 'doughnut labels by hand, on one line each');
    // the map's legend: Benelux as one entry, countries in proper case, "UK" kept
    const map = txt(slides.find((x) => x.includes('name="ES"')));
    assert(map.includes('Benelux') && map.includes('UK') && map.includes('Germany') && !map.includes('Belgium') && !map.includes('NETHERLANDS'), 'map legend: ' + map.join('|'));
    // the asset table: Bond / Loan, countries as the house shows them, the internal rating (bold) unless NR, else the external one
    const table = txt(slides.find((x) => x.includes('Compliance')));
    assert(table.includes('Bond') && table.filter((t) => t === 'Loan').length === 4 && !table.includes('Infra Bond') && table.includes('Netherlands') && table.includes('UK'), 'format and country: ' + table.join('|'));
    assert(!table.includes('Baa3') && table.includes('BBB') && /<a:rPr[^>]*b="1"[^>]*>(?:(?!<\/a:rPr>)[\s\S])*?<\/a:rPr><a:t>BBB-<\/a:t>|<a:rPr[^>]*b="1"[^>]*\/><a:t>BBB-<\/a:t>/.test(all), 'ratings: the internal BBB over the external Baa3, in bold');
    // an investor's own "… Classification" column only on that investor's decks (the report uses its sector classification)
    const AUM = Scope.calc.aum, classCol = async (r) => { const p = await unpack(R.investor({ res: r }).deck.toBytes()); return Object.keys(p).filter((n) => /slides\/slide\d+\.xml$/.test(n)).some((n) => dec.decode(p[n]).includes('<a:t>Classification</a:t>')); };
    assert(!(await classCol(demo)) && (await classCol(AUM.withSectorColumn(demo, 'Investor 21 Sector Classification'))) && !(await classCol(AUM.withSectorColumn(demo, 'Investor 14 Sector Classification'))), 'classification column only with its own investor\'s sectors');
  });

  T.add('investor report on the client\'s own look: its five sectors, Holdings subsectors put into its list (or its own subsector column), picked for its mandates only', async () => {
    const R = Scope.report, AUM = Scope.calc.aum, demo = T.demo({ platform: 'Region A' }), base = demo.rows, K21 = 'Investor 21 Sector Classification';
    const mk = (i, sector, subsector, v) => Object.assign({}, base[i % base.length], { sector, subsector, exposure_m: v, drawn_m: v });
    const rows = [mk(0, 'Telecom', 'Fibre network', 23), mk(1, 'Energy + O&G', 'Heating and cooling', 13), mk(2, 'Transport', 'Rosco', 6), mk(3, 'Social', 'Government buildings', 7),
      mk(4, 'Renewables', 'Onshore wind', 20), mk(5, 'Renewables', 'Solar', 6), mk(6, 'Transport', 'Airports', 7), mk(7, 'Energy + O&G', 'Electricity networks', 7),
      mk(8, 'Transport', 'Roads', 3), mk(9, 'Telecom', 'Telecom towers', 7), mk(10, 'Telecom', 'Data centres', 3), Object.assign(mk(11, '', 'Water', 4), { sector_holdings: 'Utilities' })];
    const ring = async (res) => { const p = await unpack(R.investor({ res }).deck.toBytes()); return Object.keys(p).filter((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n)).map((n) => dec.decode(p[n])).filter((c) => c.includes('<c:doughnutChart>'))
      .map((c) => ((c.match(/<c:cat>[\s\S]*?<\/c:cat>/) || [''])[0].match(/<c:v>[^<]*<\/c:v>/g) || []).map((v) => v.slice(5, -6)).join(', ')); };
    // as the example deck: clockwise from 12, the client's sectors, and under them its subsectors (renewables all Renewable power,
    // heating and cooling in Regulated gas networks, Government buildings as Government Services)
    // its five sectors as the deck names them ("Renewables" in the column is "Renewables + Environmental & Waste" on the rings and
    // bubbles, as it is in the asset table); a blank one from Holdings (a Utilities water network is Energy + O&G)
    const ownRes = Object.assign({}, demo, { rows, sectorSource: K21, subsectorSource: '' }), own = await ring(ownRes);
    assert(own.includes('Energy + O&amp;G, Renewables + Environmental &amp; Waste, Transport, Telecom, Social'), 'client sectors: ' + own.join(' | '));
    assert(own.includes('Electricity networks, Water, Regulated gas networks, Renewable power, Roads, Airports, Rosco, Telecom towers, Fiber network, Data center, Government Services'), 'client subsectors: ' + own.join(' | '));
    const op = await unpack(R.investor({ res: ownRes }).deck.toBytes()), oNames = Object.keys(op);
    const bub = oNames.filter((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n)).map((n) => dec.decode(op[n])).find((c) => c.includes('<c:bubbleChart>'));
    assert((bub.match(/<c:ser>[\s\S]*?<\/c:tx>/g) || []).map((x) => x.match(/<c:v>([^<]*)<\/c:v>/)[1]).join(', ') === 'Energy + O&amp;G, Renewables + Environmental &amp; Waste, Transport, Telecom, Social', 'bubble sectors as the client deck');
    const tbl = oNames.filter((n) => /slides\/slide\d+\.xml$/.test(n)).map((n) => dec.decode(op[n])).find((x) => x.includes('Compliance')), tt = (tbl.match(/<a:t>[^<]*<\/a:t>/g) || []).map((t) => t.slice(5, -6));
    assert(tt.filter((t) => t === 'Renewables').length === 2 && !tt.includes('Renewables + Environmental &amp; Waste') && tt.includes('Energy + O&amp;G'), 'the asset table shows the column\'s own value: ' + tt.join('|'));
    // the house look keeps the Holdings subsectors; the client's own subsector column, when the workbook has one, is used as it is
    const house = await ring(Object.assign({}, demo, { rows }));
    assert(house.some((d) => d.includes('Onshore wind') && d.includes('Heating and cooling') && d.includes('Government buildings')) && !house.some((d) => d.includes('Renewable power')), 'house subsectors: ' + house.join(' | '));
    const KS = 'Investor 21 Subsector Classification', withSub = (a) => Object.assign({}, a, { sheets: Object.assign({}, a.sheets, { Hardcoded: Object.assign({}, a.sheets.Hardcoded, { [KS]: { value: 'Own ' + a.code } }) }) });
    const assets = demo.assets.map(withSub), byCode = new Map(assets.map((a) => [a.code, a]));
    const d2 = Object.assign({}, demo, { assets, rows: demo.rows.map((r) => Object.assign({}, r, { asset: byCode.get(r.code) })) });
    assert(AUM.subsectorColumnOf(d2, K21) === KS && AUM.subsectorColumnOf(d2, 'Investor 14 Sector Classification') === '' && AUM.subsectorColumnOf(demo, K21) === '', 'the client\'s subsector column is found by its name');
    const w2 = AUM.withSectorColumn(d2, K21);
    assert(w2.subsectorSource === KS && w2.rows.every((r) => r.subsector === 'Own ' + r.code && r.subsector_holdings !== undefined) && (await ring(w2)).some((d) => d.includes('Own ')), 'its own subsectors are used as they are');
    // picked only for the client (its own Classification column beside the sector one), never for an investor with a sector column only
    assert(AUM.sectorColumnFor(demo, 'Investor 21 mandate') === K21 && AUM.sectorColumnFor(demo, 'Investor 14 mandate') === '', 'only the client is picked by name');
    // a view of mandates only (type Mandate) whose every asset the client has classified: the client's look, as its mandates need no name in common
    const r11 = T.demo({ platform: 'Investor 11' }), typed = (g) => (r11.inputs.investors || []).map((i) => (i.label === 'Investor 11' ? Object.assign({}, i, { group: g }) : i));
    const fill = (v) => (a) => Object.assign({}, a, { sheets: Object.assign({}, a.sheets, { Hardcoded: Object.assign({}, a.sheets.Hardcoded, { [K21]: { value: v(a) } }) }) });
    const view = (g, v) => { const as = r11.assets.map(fill(v)), by = new Map(as.map((a) => [a.code, a])); return Object.assign({}, r11, { assets: as, rows: r11.rows.map((r) => Object.assign({}, r, { asset: by.get(r.code) })), inputs: Object.assign({}, r11.inputs, { investors: typed(g) }) }); };
    const first = r11.rows[0].code;
    assert(AUM.sectorColumnFor(view('Mandate', () => 'Social'), '') === K21, 'a mandate whose assets the client classifies is the client\'s');
    assert(AUM.sectorColumnFor(view('Third party', () => 'Social'), '') === '', 'not for another type');
    assert(/not all of type Mandate/.test(AUM.sectorColumnWhy(view('Third party', () => 'Social'), '')), 'and the page says why: ' + AUM.sectorColumnWhy(view('Third party', () => 'Social'), ''));
    // a few blank cells do not stop it (the report gives them their Holdings sector); a mostly blank column does
    assert(AUM.sectorColumnFor(view('Mandate', (a) => (a.code === first ? '' : 'Social')), '') === K21, 'one asset not classified: still the client\'s');
    const sparse = view('Mandate', (a) => (a.code === first ? 'Social' : ''));
    assert(AUM.sectorColumnFor(sparse, '') === '' && /filled for only \d+% of this view/.test(AUM.sectorColumnWhy(sparse, '')), 'mostly blank: house look, and why: ' + AUM.sectorColumnWhy(sparse, ''));
    assert(AUM.sectorColumnWhy(view('Mandate', () => 'Social'), '') === '', 'no reason when picked');
  });


  T.add('template pages: cover, section and content slides with x boxes are filled in place; footers kept; exhibits sit in the free area', async () => {
    const P = Scope.pptx, R = Scope.report;
    const t = P.deck({ title: 'T' });
    const c = t.slide(); c.text({ x: 0.6, y: 0.8, w: 8, h: 1, text: 'x', size: 40, bold: true }); c.text({ x: 2.5, y: 5.4, w: 5, h: 0.5, text: 'x', size: 16 }); c.text({ x: 0.6, y: 7, w: 3, h: 0.3, text: 'Footer kept' });
    const sct = t.slide(); sct.rect({ x: 0, y: 0, w: 13.333, h: 6.7, fill: '00785A' }); sct.text({ x: 0.5, y: 0.2, w: 4, h: 2, text: 'x', size: 96 }); sct.text({ x: 0.5, y: 3, w: 9, h: 1, text: 'x', size: 40 }); sct.text({ x: 0.5, y: 4.2, w: 9, h: 1, text: 'x', size: 18 });
    const ct = t.slide(); ct.text({ x: 0.5, y: 0.2, w: 9, h: 0.3, text: 'x', size: 10 }); ct.text({ x: 0.5, y: 0.6, w: 11, h: 0.7, text: 'x', size: 28, font: 'House Serif' }); ct.text({ x: 0.5, y: 6.95, w: 3, h: 0.3, text: 'Footer kept' }); ct.text({ x: 8, y: 6.6, w: 4.8, h: 0.25, text: '{source}', size: 7 });
    const tpl = await P.readTemplate(t.toBytes(), 't.pptx');
    assert(tpl.majorFont === 'Arial' && tpl.titleFont === 'House Serif', 'the title font is the one its x shows, not the theme\'s: ' + tpl.titleFont);
    assert(tpl.pages.length === 3 && tpl.kinds.content === 2 && tpl.layouts.length === 1, 'three pages read');
    assert(P.slotRoles(tpl.pages[0], 'cover').join() === 'name,date' && P.slotRoles(tpl.pages[1], 'section').join() === 'number,title,subtitle' && P.slotRoles(tpl.pages[2], 'content').join() === 'kicker,title,source', 'slot roles: ' + [0, 1, 2].map((i) => P.slotRoles(tpl.pages[i], ['cover', 'section', 'content'][i]).join()).join(' / '));
    const box = tpl.pages[2].box; assert(box.y > 1.3 && box.y < 1.6 && box.y + box.h < 6.6, 'free area under the title, above the source and footer: ' + JSON.stringify(box));
    // a rule under the title ends the header: nothing is placed on or above it
    const t2 = P.deck({ title: 'T' }); t2.slide(); t2.slide(); const c2 = t2.slide(); c2.text({ x: 0.5, y: 0.3, w: 11, h: 0.6, text: 'x', size: 28 }); c2.line({ x1: 0.5, y1: 1.5, x2: 12.8, y2: 1.5, color: '999999', w: 0.75 });
    const box2 = (await P.readTemplate(t2.toBytes(), 't2.pptx')).pages[2].box; assert(box2.y >= 1.6 && box2.y < 1.8, 'free area a little under the rule: ' + JSON.stringify(box2));
    const res = T.demo({ platform: 'Region A' });
    const out = R.investor({ res, template: tpl, inputs: { coverName: 'Investor X' } }), parts = await unpack(out.deck.toBytes()), names = packageOk(parts);
    const sl = (i) => dec.decode(parts[`ppt/slides/slide${i}.xml`]);
    assert(sl(1).includes('INVESTOR X') && sl(1).includes('REPORTING AS OF') && sl(1).includes('Footer kept') && !/<a:t>x<\/a:t>/.test(sl(1)), 'cover filled in place');
    assert(sl(2).includes('<a:t>01</a:t>') && sl(2).includes('MARKET ACTIVITY') && sl(2).includes('00785A'), 'section break filled, its band kept');
    assert(sl(3).includes('OVERVIEW OF THE INFRASTRUCTURE DEBT MARKET') && sl(3).includes('Current market activity') && sl(3).includes('Footer kept') && !sl(3).includes('{source}'), 'content page: kicker, title, footer; blank source');
    const titleRun = (sl(3).match(/<a:r>(?:(?!<\/a:r>)[\s\S])*?<a:t>Current market activity<\/a:t><\/a:r>/) || [''])[0];
    assert(/<a:latin typeface="House Serif"\/>/.test(titleRun) && !/\+mj-lt/.test(sl(3)), 'the title keeps the typeface of its x: ' + titleRun);
    const all = names.filter((n) => /slides\/slide\d+\.xml$/.test(n)).map((n) => dec.decode(parts[n])).join('');
    assert(!/<a:t>x<\/a:t>|\{source\}/.test(all), 'no x or token left on any slide');
    assert(all.includes('Source: internal data (unaudited at '), 'source line in the template slot');
    // the analysis pack and the designer's decks build on the same three-page template
    const q = await unpack(R.quarterly({ res, template: tpl }).deck.toBytes()); packageOk(q);
    assert(dec.decode(q['ppt/slides/slide2.xml']).includes('Key figures') && dec.decode(q['ppt/slides/slide2.xml']).includes('Footer kept'), 'analysis pack page titles go in the title slot');
    packageOk(await unpack(R.custom({ res, layout: R.widgets.standardLayout(), template: tpl }).deck.toBytes()));
  });

  T.add('template x boxes as people type them: “X” in quotes, an x inside a line ("REPORTING AS OF “X”"), x boxes in a group; nothing drawn over the cover or section', async () => {
    const P = Scope.pptx, R = Scope.report;
    const t = P.deck({ title: 'T' });
    const c = t.slide(); c.text({ x: 0.6, y: 0.8, w: 8, h: 1, text: '“X”', size: 40, bold: true }); c.text({ x: 0.6, y: 2.2, w: 8, h: 0.4, text: 'A LINE THAT STAYS' });
    c.rect({ x: 2.3, y: 5.2, w: 5.5, h: 0.8, fill: '00785A', paras: [{ runs: [{ text: 'REPORTING AS OF ', bold: true }, { text: '“X”', bold: true }] }] });
    c.text({ x: 9.5, y: 1.5, w: 3.4, h: 2.5, text: 'A long disclaimer paragraph on the cover, where an x in prose marks nothing because the text is long enough to be prose.', size: 8 });
    const sct = t.slide(); sct.text({ x: 0.5, y: 0.2, w: 4, h: 2, text: 'X', size: 96 }); sct.text({ x: 0.5, y: 3, w: 9, h: 1, text: 'x', size: 40 }); sct.text({ x: 0.5, y: 4.2, w: 9, h: 1, text: 'x', size: 18 });
    const ct = t.slide(); ct.text({ x: 0.5, y: 0.2, w: 9, h: 0.3, text: 'x', size: 10 }); ct.text({ x: 0.5, y: 0.6, w: 11, h: 0.7, text: 'x', size: 28 });
    // the section's number and title go into a group moved 1 in to the right
    const raw = await unpack(t.toBytes()), dec2 = (n) => dec.decode(raw[n]), enc = new TextEncoder();
    let s2 = dec2('ppt/slides/slide2.xml'); const sps = s2.match(/<p:sp>[\s\S]*?<\/p:sp>/g);
    const G = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="90" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="914400" y="0"/><a:ext cx="9144000" cy="3657600"/><a:chOff x="0" y="0"/><a:chExt cx="9144000" cy="3657600"/></a:xfrm></p:grpSpPr>${sps[0]}${sps[1]}</p:grpSp>`;
    s2 = s2.replace(sps[1], '').replace(sps[0], () => G); raw['ppt/slides/slide2.xml'] = enc.encode(s2);
    const bytes = IN.zipStore(Object.keys(raw).map((n) => ({ name: n, data: raw[n] })));
    const tpl = await P.readTemplate(bytes, 't.pptx');
    const p0 = tpl.pages[0], p1 = tpl.pages[1];
    assert(p0.slots.length === 2 && !p0.slots[0].inline && p0.slots[1].inline && P.slotRoles(p0, 'cover').join() === 'name,date', 'cover: quoted name, inline date: ' + JSON.stringify(p0.slots.map((x) => [x.token, x.inline, x.text])));
    assert(p1.slots.length === 3 && p1.slots[0].path.length === 1 && Math.abs(p1.slots[0].x - 1.5) < 0.01 && P.slotRoles(p1, 'section').join() === 'number,title,subtitle', 'section: slots found in the group, placed out of it: ' + JSON.stringify(p1.slots.map((x) => [x.path, x.x])));
    const res = T.demo({ platform: 'Region A' });
    const out = R.investor({ res, template: tpl, inputs: { coverName: 'Investor X' } }), parts = await unpack(out.deck.toBytes()); packageOk(parts);
    const sl = (i) => dec.decode(parts[`ppt/slides/slide${i}.xml`]), tx = (x) => Array.from(x.matchAll(/<a:t>([^<]*)<\/a:t>/g)).map((m) => m[1]).join('|');
    const cov = sl(1);
    assert(tx(cov).includes('INVESTOR X') && (tx(cov).match(/REPORTING AS OF/g) || []).length === 1 && /REPORTING AS OF \|\d{1,2} [A-Z]+ \d{4}/.test(tx(cov)) && !cov.includes('“X”'), 'cover: the name, the date once in the line: ' + tx(cov));
    assert((cov.match(/<p:sp>/g) || []).length === (dec2('ppt/slides/slide1.xml').match(/<p:sp>/g) || []).length, 'cover: no shape added over the template');
    assert(tx(cov).includes('where an x in prose marks nothing'), 'prose left as it is');
    const sec = sl(2);
    assert(/<p:grpSp>[\s\S]*<a:t>01<\/a:t>[\s\S]*MARKET ACTIVITY[\s\S]*<\/p:grpSp>/.test(sec) && (sec.match(/<p:sp>/g) || []).length === 3, 'section: number and title filled inside the group, nothing drawn over it');
    // reports group assets by Mapping › Transaction Group and use the Holdings sector
    assert(res.rows.every((r) => r.asset_group), 'every row has its asset group');
    const ds = Scope.engine.dataset.build(res); assert(ds.fieldById.asset_group && ds.records.every((r) => r.asset_group), 'asset group is a filterable field');
    // sectors: Holdings (as the Output) by default; an investor's own Hardcoded classification when a report picks it
    const AUM = Scope.calc.aum, res1 = T.demo({ platform: 'Region A' }), slidesOf = async (r) => { const o = await unpack(R.investor({ res: r }).deck.toBytes()); return Object.keys(o).filter((n) => /slides\/slide\d+\.xml$/.test(n)).map((n) => dec.decode(o[n])).join(''); };
    assert(res1.rows.every((r) => r.sector === r.sector_holdings) && res1.rows.some((r) => r.sector === 'Renewables'), 'rows carry the Holdings sector');
    const cols = AUM.sectorColumns(res1); assert(cols.includes('Investor 21 Sector Classification') && cols.includes('Investor 14 Sector Classification'), 'sector classification columns found: ' + cols);
    assert(AUM.sectorColumnFor(res1, 'Investor 21 mandate') === 'Investor 21 Sector Classification' && AUM.sectorColumnFor(res1, 'Investor 2') === '' && AUM.sectorColumnFor(res1, '') === '', 'the column is picked by the name it starts with');
    // a mandate of that investor under another name: picked when every investor of the view is that investor's (here by its fund name)
    const r11 = T.demo({ platform: 'Investor 11' }), inv = (r11.inputs.investors || []).map((i) => (i.label === 'Investor 11' ? Object.assign({}, i, { fundName: 'Investor 21 infrastructure debt' }) : i));
    assert(AUM.sectorColumnFor(r11, '') === '' && AUM.sectorColumnFor(Object.assign({}, r11, { inputs: Object.assign({}, r11.inputs, { investors: inv }) }), '') === 'Investor 21 Sector Classification', 'picked by the view\'s investors');
    const K21 = 'Investor 21 Sector Classification', r11n = Object.assign({}, r11, { inputs: Object.assign({}, r11.inputs, { investors: inv }) });
    // a view that merely includes the mandate keeps Holdings' sectors (the workbook uses the classification only on the investor's own views)
    const mixed = Object.assign({}, r11n, { platform: Object.assign({}, r11n.platform, { label: 'Mixed view', composition: [{ label: 'Investor 11' }, { label: 'Investor 12' }] }) });
    assert(AUM.sectorColumnFor(mixed, '') === '' && AUM.sectorColumnFor(Object.assign({}, mixed, { platform: Object.assign({}, mixed.platform, { composition: [{ label: 'Investor 11' }] }) }), '') === K21, 'a view with another investor beside the mandate is not picked');
    // never by coverage: a view holding only deals the investor also holds keeps Holdings' sectors
    const mine = new Set(r11.rows.map((r) => r.code));
    const only = (a) => (mine.has(a.code) ? a : Object.assign({}, a, { sheets: Object.assign({}, a.sheets, { Hardcoded: Object.assign({}, a.sheets.Hardcoded, { [K21]: { value: '' } }) }) }));
    const assets = r11.assets.map(only), byCode = new Map(assets.map((a) => [a.code, a]));
    const covered = Object.assign({}, r11, { assets, rows: r11.rows.map((r) => Object.assign({}, r, { asset: byCode.get(r.code) })) });
    assert(AUM.sectorColumnFor(covered, '') === '', 'not picked because only its assets carry the classification');
    const res2 = AUM.withSectorColumn(res1, 'Investor 21 Sector Classification'), all1 = await slidesOf(res1), all2 = await slidesOf(res2);
    assert(res2.rows.some((r) => r.sector === 'TRANSPORTATION') && res1.rows.every((r) => r.sector !== 'TRANSPORTATION') && res2.distributions.sector[0].label === res2.distributions.sector[0].label.toUpperCase(), 'the investor\'s classification replaces the sector in a copy');
    assert(all1.includes('>Renewables<') && !all1.includes('>TRANSPORTATION<') && all2.includes('>TRANSPORTATION<') && !all2.includes('>Renewables<'), 'the deck shows the sectors of the source picked');
  });

  T.add('monitoring workbook: block layout (like the slide) and one row per asset are both read', () => {
    const R = Scope.report;
    const block = [['Portfolio monitoring'], ['Ref.', 'Name', '', 'Actual', 'Lock-up', 'Covenant', 'Description and recent events'],
      ['1/2', 'Asset A', '', 'Actual', 'Lock-up', 'Covenant', 'A train leasing company'], [null, null, 'Net debt / EBITDA', 7.56, 7.75, 8.25, '• Lenders meeting scheduled.\n• Revenues in line.'], [null, null, 'ICR', 3.88, 2.5, 2, 'Utilisation declined.'], [null, null, 'Rating', null, '-/BBB/-', null, null],
      ['2/2', 'Asset B', '', '', '', '', 'A fibre network'], [null, null, 'Net debt / EBITDA', '5.1x', '', '6.0x', 'Build-out on plan.']];
    const a = R.parseMonitoring(block);
    assert(a.length === 2 && a[0].name === 'Asset A' && a[0].ref === '1/2' && a[0].description === 'A train leasing company', 'blocks: ' + JSON.stringify(a).slice(0, 200));
    assert(a[0].metrics.length === 2 && a[0].metrics[0].actual === '7.56' && a[0].metrics[1].covenant === '2' && a[0].rating === '-/BBB/-', 'ratios and rating: ' + JSON.stringify(a[0].metrics));
    assert(a[0].events.join('|') === 'Lenders meeting scheduled.|Revenues in line.|Utilisation declined.' && a[1].metrics[0].covenant === '6.0x', 'events split, bullets dropped: ' + a[0].events.join('|'));
    const flat = R.parseMonitoring([['Ref', 'Name', 'Description', 'Recent events'], ['1', 'Asset C', 'A toll road', 'Traffic up 4%.\nRefinancing signed.'], ['2', 'Asset D', 'A hospital', '']]);
    assert(flat.length === 2 && flat[0].description === 'A toll road' && flat[0].events.length === 2 && flat[1].events.length === 0, 'one row per asset: ' + JSON.stringify(flat));
    assert(R.parseMonitoring([['nothing', 'here']]).length === 0, 'no header, no assets');
  });

  T.add('asset write-ups: every sheet read (a box per sheet, no header row), linked by name or by hand, the view\'s write-ups on monitoring pages like the deck\'s', async () => {
    const R = Scope.report, res = T.demo({ platform: 'Region A' }), held = new Set(res.rows.map((r) => r.code));
    const a1 = res.rows[0].asset, a3 = res.rows[1].asset, first = a1.name.split(' ')[0];
    const boxes = [['Ref.', 'Name', '', 'Actual', 'Lock-up', 'Covenant', 'Description and recent events'],
      ['1/3', first, '', 'Actual', 'Lock-up', 'Covenant', 'A wagon leasing company\n• Lenders meeting scheduled.\nNeutral impact: no rating change'], [null, null, 'Net debt / EBITDA', 7.56, 7.75, 8.25], [null, null, 'Rating', null, '-/BBB/-']];
    const other = [['Ref', 'Name', 'Description'], ['2/3', 'Unknown Holdings', 'Something']];
    const noHead = [[], [null, '3/3', a3.code_name, null, 'Actual', 'Lock-up', 'Covenant', 'A third\nAn event'], [null, null, null, 'ICR', 2.1, 1.5, 1.3]];
    const wb = await Scope.inputs.readXlsx(Scope.inputs.writeXlsx([{ name: 'Boxes', rows: boxes }, { name: 'Other', rows: other }, { name: 'Third', rows: noHead }]));
    const read = R.parseWriteups(wb.order.map((n) => ({ name: n, rows: wb.sheets[n].rows }))), it = read.items;
    assert(it.length === 3 && read.sheets.length === 3 && it.map((m) => m.name).join('|') === `${first}|Unknown Holdings|${a3.code_name}`, 'three sheets: ' + JSON.stringify(it.map((m) => m.name)));
    assert(it[0].rating_cells.join('|') === '|-/BBB/-|' && it[0].events.length === 2 && it[0].description === 'A wagon leasing company' && it[2].metrics[0].label === 'ICR' && it[2].ref === '3/3', 'boxes read: ' + JSON.stringify(it[2]));
    const L = R.linkWriteups(it, res, {});
    assert(L[0].how === 'auto' && L[0].codes.includes(a1.code) && L[2].how === 'auto' && L[2].codes.join() === a3.code && L[1].how === 'none', 'linked by name: ' + JSON.stringify(L.map((l) => [l.how, l.codes])));
    const away = res.assets.find((a) => !held.has(a.code) && a.code_name);
    const L2 = R.linkWriteups(it, res, { [R.writeupKey(it[1])]: away.code, [R.writeupKey(it[0])]: 'none' });
    assert(L2[1].how === 'set' && L2[1].codes.join() === away.code && L2[0].how === 'none', 'links set by hand win');
    const grp = res.assets.find((a) => a.asset_group && res.assets.filter((b) => b.asset_group === a.asset_group).length > 1);
    const L3 = R.linkWriteups([{ name: grp.asset_group }], res, {});
    assert(L3[0].how === 'auto' && L3[0].codes.length > 1 && L3[0].target === 'group:' + grp.asset_group, 'a name shared by an asset group links the group');
    assert(R.writeupsForView(it, res, {}).length === 2 && R.writeupsForView(it, res, {}, { unlinked: 'include' }).length === 3, 'a write-up matched to no asset is in no report unless the setting puts it in every one');
    assert(R.writeupsForView(it, res, { [R.writeupKey(it[1])]: 'none' }, { unlinked: 'include' }).length === 2, 'one set to "Not linked" by hand is in no report, whatever the setting');
    const zero = Object.assign({}, res, { rows: res.rows.map((r) => (r.code === a3.code ? Object.assign({}, r, { exposure_m: 0 }) : r)) });
    assert(!R.writeupsForView(it, zero, {}).some((m) => m.name === a3.code_name), 'an asset the view holds at 0 is not held: its write-up stays out');
    assert(R.writeupsForView(it, res, { [R.writeupKey(it[1])]: away.code }).map((m) => m.name).join('|') === `${first}|${a3.code_name}`, 'a write-up about an asset the view does not hold stays out');
    // the deck: header bar, boxed ratios, ► bullets in colour, the impact line bold, pages counted
    const long = { ref: '9/9', name: 'Long one', description: 'A long write-up', events: Array.from({ length: 40 }, (_, k) => `Event ${k + 1}: ` + 'the quarter went broadly as planned and lenders were informed. '.repeat(3)) };
    const out = R.investor({ res, inputs: { monitoring: R.writeupsForView(it, res, {}, { unlinked: 'include' }).concat([long]) } });
    const titles = out.outline.map((o) => o.title).filter((t) => /^Portfolio Monitoring \(/.test(t));
    assert(titles.length >= 5 && titles[0] === `Portfolio Monitoring (1/${titles.length})`, 'pages counted: ' + titles.join(', '));
    const parts = await unpack(out.deck.toBytes()), xml = Object.keys(parts).filter((n) => /slides\/slide\d+\.xml$/.test(n)).map((n) => dec.decode(parts[n])).join('');
    assert(xml.includes('Description and recent events') && xml.includes('<a:buChar char="\u25BA"/>') && /<a:buClr><a:srgbClr val="[0-9A-F]{6}"\/><\/a:buClr>/.test(xml), 'header and coloured ► bullets');
    assert(/b="1"[^>]*>(?:(?!<\/a:rPr>).)*<\/a:rPr><a:t>Neutral impact: no rating change<\/a:t>/.test(xml), 'the impact line in bold');
    assert(xml.includes('Long one (continued)') && xml.includes('>7.56<') && xml.includes('>-/BBB/-<'), 'a long write-up carries on; ratios and rating shown');
    // the blank template: one box per asset of the view, read back once filled in
    const tpl = R.writeupTemplate(res), rows = tpl[0].rows;
    assert(rows[0].join('|') === 'Ref.|Name||||Description and recent events' && rows[1].join('|') === `|${res.rows[0].asset_group}|Actual|Lock-up|Covenant|` && rows[2][1] === 'Net debt / EBITDA' && tpl[1].name === 'How to fill', 'template laid out like the house workbook: ' + rows[1].join('|'));
    assert(R.parseWriteups([{ name: 'W', rows }]).items.length === 0, 'a blank template holds no write-ups');
    rows[1][5] = 'Filled in'; rows[2][5] = 'One event'; rows[2][2] = 4.2;
    const back = R.parseWriteups([{ name: 'W', rows }]).items;
    assert(back.length === 1 && back[0].name === res.rows[0].asset_group && back[0].events[0] === 'One event' && back[0].metrics[0].actual === '4.2' && R.linkWriteups(back, res, {})[0].codes.length >= 1, 'the filled template is read and linked: ' + JSON.stringify(back));
  });

  T.add('asset write-ups: the house workbook (name and ratio names in one column, a tall first row, the text in one cell to the right) read, every name type matched', () => {
    const R = Scope.report, res = T.demo({ platform: 'Region A' });
    const byName = (n) => res.assets.find((a) => a.name === n);
    const sec = res.positions.find((p) => p.asset_code && p.security_name && p.security_name !== (res.assets.find((a) => a.code === p.asset_code) || {}).name);
    const tg = res.assets.find((a) => a.attrs.transaction_group && res.assets.filter((b) => b.attrs.transaction_group === a.attrs.transaction_group).length > 1);
    const box = (name, desc, mets, rating, body) => [[null, name, 'Actual', 'Lock-up', 'Covenant', desc]].concat(mets.map((m, k) => [null, m[0], m[1], m[2], m[3], k ? null : body]), [[null, 'Rating', null, null, rating, null]]);
    const grid = [].concat(
      box('Aurora Offshore 3', 'Offshore wind operator', [['Net debt / EBITDA', '6.62x', '7.50x', '8.25x'], ['EBITDA / Debt Service', 2.62, 1.75, 1.4]], '- / BBB+ / -', 'Revenue up 7.2% y-o-y.'),
      box(sec.security_name, 'A water utility', [['DSCR', 1.25, 1.1, 1.05], ['LLCR', 1.34, 1.15, 1.1]], 'BBB- (Internal)', 'Performing well. Key findings are:\n- Operations stable.\n- Helpdesk notifications up.'),
      box('Juniper 1', 'Wind farms', [['DSCR', null, null, null]], null, 'REPAID'),
      box('Nimbus Airport', 'Regional airport', [['NLCR', 1.34, 1.13, 1.08], ['DSCR', 'n/a', 1.1, 1.05]], 'A (Internal)', 'No update during the quarter.\nRatios as of June 2026\nNeutral impact: no rating change'),
      box(tg.attrs.transaction_group, 'A group of assets', [['ICR', 2, 1.5, 1.2]], 'BB', 'One event.'),
      box('Unknown Holdings', 'Something else', [['ICR', 2, 1.5, 1.2]], 'BB (Internal)', 'No news.'));
    const it = R.parseMonitoring(grid);
    assert(it.length === 6 && it.map((m) => m.name).join('|') === ['Aurora Offshore 3', sec.security_name, 'Juniper 1', 'Nimbus Airport', tg.attrs.transaction_group, 'Unknown Holdings'].join('|'), 'one box per name, ratio rows not taken for names: ' + it.map((m) => m.name).join('|'));
    const a = it[0], b = it[1], c = it[2], d = it[3];
    assert(a.description === 'Offshore wind operator' && a.events.join() === 'Revenue up 7.2% y-o-y.' && a.metrics.map((m) => `${m.label}=${m.actual}/${m.lockup}/${m.covenant}`).join() === 'Net debt / EBITDA=6.62x/7.50x/8.25x,EBITDA / Debt Service=2.62/1.75/1.4' && a.rating === '- / BBB+ / -', 'first box: ' + JSON.stringify(a));
    assert(b.events.join('|') === 'Performing well. Key findings are:|Operations stable.|Helpdesk notifications up.' && b.rating === 'BBB- (Internal)', 'dashes dropped, a line each: ' + JSON.stringify(b.events));
    assert(c.metrics.length === 1 && c.metrics[0].label === 'DSCR' && !c.metrics[0].actual && c.events.join() === 'REPAID' && !c.rating, 'a repaid box: ' + JSON.stringify(c));
    assert(d.metrics[1].actual === 'n/a' && d.events.length === 3, 'text values kept: ' + JSON.stringify(d.metrics));
    // the names: asset name with a number, a Holdings security name, a plural, a transaction group (its assets' group), no match
    const L = R.linkWriteups(it, res, {});
    assert(L[0].how === 'auto' && L[0].codes.join() === byName('Aurora Offshore').code && L[0].via[0].type === 'Name', 'name with a tranche number: ' + JSON.stringify(L[0].via));
    assert(L[1].how === 'auto' && L[1].codes.join() === sec.asset_code, 'Holdings security name: ' + JSON.stringify(L[1].via));
    assert(L[2].how === 'auto' && L[2].codes.join() === byName('Juniper Gas').code && L[3].codes.join() === byName('Nimbus Airports').code, 'a word of the name; singular for plural');
    assert(L[4].how === 'auto' && L[4].codes.length === 2 && L[4].target.startsWith('group:'), 'a transaction group links its assets: ' + JSON.stringify(L[4]));
    assert(L[5].how === 'none' && L[5].checked.names > 100 && ['Name', 'Code name', 'Hardcoded', 'Holdings'].every((t) => L[5].checked.types.includes(t)), 'no match, every name type checked: ' + JSON.stringify(L[5].checked));
    // free text in a name column (a long description) is not a name; linking twice gives the same answer without redoing it
    const longA = Object.assign({}, res.assets[0], { aliases: [{ type: 'Mapping › Holdings Name', value: 'A long description of the deal that runs on for well over sixty characters in all' }] });
    assert(!R.assetNames(longA, []).some((n) => n.value.startsWith('A long description')), 'long text is not a name');
    assert(R.linkWriteups(it, res, {}) === L, 'the same result, write-ups and links are linked once');
    // the scores
    const sc = R.nameScore;
    assert(sc('Harbour Ports 3', 'Harbour Ports 3 Ltd') === 100 && sc('Lynx II', 'Lynx 2') === 100 && sc('Asset 2', 'Asset 3') === 0 && sc('Copper Airport', 'Airport Holdings') === 0 && sc('Zander', 'Zander Prison PPP') === 90 && sc('Kestrel 1', 'Kestrel') === 90 && sc('Marlowe', 'Marlow') >= 75 && sc('Orion', 'Polaris') === 0,
      'scores: ' + [sc('Harbour Ports 3', 'Harbour Ports 3 Ltd'), sc('Lynx II', 'Lynx 2'), sc('Asset 2', 'Asset 3'), sc('Copper Airport', 'Airport Holdings'), sc('Zander', 'Zander Prison PPP'), sc('Kestrel 1', 'Kestrel'), sc('Marlowe', 'Marlow')].join());
  });

  T.add('write-up ratings: one per box, under the middle column, never a ratio row or said twice, never taken from the next box', async () => {
    const R = Scope.report, A = (n, d) => [[null, n, 'Actual', 'Lock-up', 'Covenant', d]];
    const grid = [].concat(
      A('Alpha', 'value under the label'), [[null, 'ICR', 2, 1.5, 1.2, 'One.'], [null, 'Rating', null, null, null, null], [null, null, null, 'BBB- (Internal)', null, null]],
      A('Bravo', 'stray rating row'), [[null, 'DSCR', 1.3, 1.1, 1.05, 'Two.'], [null, null, null, null, 'BB+ (Internal)', null]],
      A('Charlie', 'label and prefix'), [[null, 'LLCR', 1.4, 1.2, 1.1, 'Three.'], [null, 'Internal rating', 'Rating: A-', null, null, null]],
      A('Delta', 'rating in the name column'), [[null, 'ICR', 3, 2, 1.5, 'Four.'], [null, 'Rating', null, null, null, null], [null, 'BBB', null, null, null, null]],
      A('Echo', 'no rating at all'), [[null, 'ICR', 2.2, 1.8, 1.4, 'Five.'], [null, 'Rating', null, null, null, null]],
      A('Foxtrot', 'three cells'), [[null, 'ICR', 2.2, 1.8, 1.4, 'Six.'], [null, 'Rating', '-', 'BBB+', '-', null]],
      A('Hotel', 'the rating in a row with another name, the Rating row empty'), [[null, 'ICR', '3.6x', 'n/a', '2.50x', 'Seven.'], [null, 'Holdco', null, null, 'BBB- (Internal)', null], [null, 'Rating', null, null, null, null]]);
    const it = R.parseMonitoring(grid), by = (n) => it.find((m) => m.name === n);
    assert(it.map((m) => m.name).join() === 'Alpha,Bravo,Charlie,Delta,Echo,Foxtrot,Hotel', 'no box made of a rating: ' + it.map((m) => m.name).join());
    assert(by('Hotel').rating === 'BBB- (Internal)' && by('Hotel').metrics.map((m) => `${m.label}=${m.actual}/${m.lockup}/${m.covenant}`).join() === 'ICR=3.6x/n/a/2.50x', 'a row holding only a rating is the rating, values kept as typed: ' + JSON.stringify(by('Hotel')));
    assert(by('Alpha').rating === 'BBB- (Internal)' && by('Bravo').rating === 'BB+ (Internal)' && by('Charlie').rating === 'A-' && by('Delta').rating === 'BBB' && by('Echo').rating === '' && by('Foxtrot').rating === '- / BBB+ / -',
      'ratings: ' + it.map((m) => `${m.name}=${m.rating}`).join(', '));
    assert(it.every((m) => m.metrics.length === 1 && !/rating/i.test(m.metrics[0].label) && m.metrics[0].label) && it.every((m) => !m.rating || m.rating_cells.join('|') === `|${m.rating}|`), 'one ratio row each, the rating under the middle: ' + JSON.stringify(it.map((m) => m.metrics)));
    // write-ups read by an older build: the rating row left among the ratios is tidied when drawn
    const old = { name: 'Golf', description: 'd', events: ['e'], rating: '', rating_cells: [], metrics: [{ label: 'ICR', actual: '2.00x', lockup: '', covenant: '' }, { label: '', actual: '', lockup: '', covenant: 'A (Internal)' }, { label: 'Rating', actual: '', lockup: 'A', covenant: '' }] };
    const t = R.tidyWriteup(old);
    assert(t.rating === 'A' && t.metrics.length === 1 && old.metrics.length === 3, 'tidied, the row named Rating first: ' + JSON.stringify(t));
    // on the slide: the word Rating once per box, the rating once, unboxed
    const res = T.demo({ platform: 'Region A' }), out = R.investor({ res, inputs: { monitoring: [old, by('Echo')] } });
    const parts = await unpack(out.deck.toBytes()), dec = new TextDecoder(), slides = Object.keys(parts).filter((n) => /slides\/slide\d+\.xml$/.test(n)).map((n) => dec.decode(parts[n])).filter((x) => x.includes('Description and recent events'));
    assert(slides.length === 2 && slides.every((x) => (x.match(/<a:t>Rating<\/a:t>/g) || []).length === 1) && (slides.join('').match(/<a:t>A<\/a:t>/g) || []).length === 1 && !slides.join('').includes('A (Internal)'), 'Rating once per page, the rating once');
  });

  T.add('style: a user style recolours the pack (table headers, headings) and sets the font; a template\'s theme colours become a style', async () => {
    const R = Scope.report, res = T.demo({ platform: 'Region A' });
    const styled = await unpack(R.quarterly({ res, style: { green: '7A2638', font: 'Georgia' } }).deck.toBytes()), plain = await unpack(R.quarterly({ res }).deck.toBytes());
    const s2 = dec.decode(styled['ppt/slides/slide6.xml']), p2 = dec.decode(plain['ppt/slides/slide6.xml']);
    assert(s2.includes('7A2638') && !p2.includes('7A2638') && p2.includes('0F7164'), 'the heading colour follows the style');
    assert(s2.includes('typeface="Georgia"') && !p2.includes('typeface="Georgia"'), 'the font follows the style');
    assert(R.palette({ green: 'zzz' }).green === '0F7164' && R.palette(null).green === '0F7164', 'malformed or absent style = house');
    const W = R.widgets, custom = await unpack(R.custom({ res, layout: W.standardLayout(), style: { green: '7A2638' } }).deck.toBytes());
    assert(dec.decode(custom['ppt/slides/slide2.xml']).includes('7A2638'), 'the designer deck follows the style too');
    const tdeck = Scope.pptx.deck({ title: 'T' }); tdeck.slide().text({ x: 0, y: 7, w: 2, h: 0.3, text: 'x' });
    const tpl = await Scope.pptx.readTemplate(tdeck.toBytes(), 't.pptx');
    assert(tpl.colors && tpl.colors.accent1 === '3A6FD8' && tpl.colors.dk1 === '1F2937', 'theme colours read: ' + JSON.stringify(tpl.colors));
    const fromTheme = R.styleFromTheme(tpl.colors);
    assert(fromTheme.green === '3A6FD8' && fromTheme.slate === '9DB7EE' && fromTheme.text === '1F2937' && /^[0-9A-F]{6}$/.test(fromTheme.pgreen), 'style from theme: ' + JSON.stringify(fromTheme));
    // shades as PowerPoint's picker lists them; a theme whose Background 2 and Text 2 are coloured maps like the house theme
    assert(R.shadesOf('8ACBBB').slice(1).join() === 'E7F4F1,D0EAE3,B8DFD6,4EB098,347665' && R.shadesOf('FFFFFF').slice(1).join() === 'F2F2F2,D8D8D8,BFBFBF,A5A5A5,7F7F7F', 'picker shades: ' + R.shadesOf('8ACBBB').join());
    const own = { lt1: 'FFFFFF', dk1: '202020', lt2: '7A2638', dk2: '2E7D4F', accent1: '00A2A3', accent2: '9C8AB0', accent3: '9A9A9A', accent4: '1B3A6B', accent5: 'C3454B', accent6: 'F1885A' };
    const P2 = R.palette(null, R.themeColumns(own));
    assert(P2.green === '7A2638' && P2.dark === '7A2638' && P2.lgreen === '2E7D4F' && P2.pgreen === '9C8AB0' && P2.tgreen === R.shadesOf('9C8AB0')[1] && R.rampOf(R.themeColumns(own)).slice(0, 4).join() === '7A2638,9C8AB0,1B3A6B,2E7D4F', 'house-like theme mapped by slot, main colours first: ' + JSON.stringify(P2));
    // the house theme as the house deck applies it: header bars and headings in Background 2, boxes in Accent 2 lighter 80 %
    assert(R.PALETTE.dark === '0F7164' && R.PALETTE.green === '0F7164' && R.PALETTE.tgreen === 'E7F4F1' && R.rampOf().slice(0, 6).join() === '0F7164,8ACBBB,17596F,00A76C,939FA6,00A2A3', 'house palette: ' + JSON.stringify(R.PALETTE));
  });

  T.add('pasted market curves: month-year dates are month ends, quoted thousands stay whole, tabs win, a blank header cell keeps its column, a leading minus is a number', () => {
    const R = Scope.report;
    const a = R.parseMarket('Date,BBB,BB\nMar-20,"1,234",210\nJun-2020,95,"1,100"');
    assert(a.series.length === 2 && a.series[0].name === 'BBB' && a.series[0].points[0][0] === 43921 && a.series[0].points[0][1] === 1234 && a.series[1].points[1][1] === 1100 && a.series[0].points[1][0] === 44012, 'csv with quotes, month-year: ' + JSON.stringify(a));
    const b = R.parseMarket('Date\tSpread\n31/12/2019\t1,234\n31/03/2020\t-5');
    assert(b.series.length === 1 && b.series[0].points[0][1] === 1234 && b.series[0].points[1][1] === -5, 'tabs keep "1,234" whole; -5 read: ' + JSON.stringify(b));
    const c = R.parseMarket('Date;;BB\n31/12/2019;90;210');
    assert(c.series[0].name === 'Index 1' && c.series[1].name === 'BB', 'a blank header cell keeps its place: ' + c.series.map((x) => x.name));
    const d = R.parseMarket('Date  BBB  BB\n2019-12-31  90  210');
    assert(d.series.length === 2 && d.series[1].points[0][1] === 210, 'two or more spaces as the separator');
  });

  T.add('write-ups: a dash bullet is dropped but "-3% revenue" keeps its minus; up to 12 ratio rows are drawn; a group link covers every asset of the group', async () => {
    const R = Scope.report, res = T.demo({ platform: 'Region A' });
    const rows = [['Ref.', 'Name', 'Actual', 'Lock-up', 'Covenant', 'Description and recent events'], ['1/1', 'Asset A', null, null, null, 'A company'], [null, 'Net debt / EBITDA', '7.5x', '8.0x', '8.5x', '- First event'], [null, null, null, null, null, '-3% revenue in the quarter'], [null, null, null, null, null, '• Third event']];
    const it = R.parseWriteups([{ name: 'W', rows }]).items;
    const ev = it[0].events.join('|');
    assert(ev.includes('First event') && !/^- /.test(ev) && ev.includes('-3% revenue in the quarter') && ev.includes('Third event') && !ev.includes('•'), 'bullets dropped, minus kept: ' + ev);
    const many = { name: 'Asset M', events: ['One.'], metrics: Array.from({ length: 14 }, (_, k) => ({ label: 'Ratio ' + (k + 1), actual: String(k + 1), lockup: '', covenant: '' })) };
    const out = R.investor({ res, inputs: { monitoring: [many] } });
    const parts = await unpack(out.deck.toBytes()), xml = Object.keys(parts).filter((n) => /slides\/slide\d+\.xml$/.test(n)).map((n) => dec.decode(parts[n])).join('');
    assert(xml.includes('>Ratio 12<') && !xml.includes('>Ratio 13<'), '12 ratio rows, no more');
    const grp = res.assets.find((a) => a.asset_group && res.assets.filter((b) => b.asset_group === a.asset_group).length > 1);
    const all = res.assets.filter((a) => a.asset_group === grp.asset_group).map((a) => a.code).sort().join();
    assert(R.linkWriteups([{ name: grp.asset_group }], res, {})[0].codes.slice().sort().join() === all, 'every asset of the group');
  });

  T.add('pack designer: a "light text" setting left from a template is ignored when no template is loaded (no white text on white pages)', async () => {
    const R = Scope.report, res = T.demo({ platform: 'Region A' });
    const slides = async (tt) => { const parts = await unpack(R.custom({ res, layout: R.widgets.standardLayout(), templateText: tt }).deck.toBytes()); return Object.keys(parts).filter((n) => /slides\/slide\d+\.xml$/.test(n)).sort().map((n) => dec.decode(parts[n])).join(''); };
    assert((await slides('light')) === (await slides('dark')), 'without a template, light and dark give the same slides');
  });

  T.add('write-up names: plurals in -ies are singular, and words on the filler or kind-of-asset lists stay whole ("Facilities", "Batteries", "Netherlands")', () => {
    const S = Scope.report.nameScore;
    assert(S('Kestrel Facilities', 'Kestrel') === 100 && S('Kestrel Energies', 'Kestrel Energy') === 100, 'filler and plural: ' + S('Kestrel Facilities', 'Kestrel') + ' ' + S('Kestrel Energies', 'Kestrel Energy'));
    assert(S('Lynx Batteries', 'Zander Batteries') === 0 && S('Lynx Netherlands', 'Zander Netherlands') === 0 && S('Lynx Utilities', 'Zander Utilities') === 0, 'a kind-of-asset word alone is no match');
  });

  T.add('group report pages: ticked for the group view only (a choice kept per view); spreads by maturity, allocation by investor, ESG ratings, prepayment protection', async () => {
    const R = Scope.report, grp = T.demo({ platform: 'Group' }), other = T.demo({ platform: 'Region A' });
    assert(grp.platform.isGroup && !other.platform.isGroup, 'the demo has a group view');
    const on = (r, i) => Object.values(R.extrasFor(r, i));
    assert(on(grp, {}).every(Boolean) && !on(other, {}).some(Boolean), 'ticked for the group view, unticked for the others');
    assert(!R.extrasFor(grp, { extras: { esg: false } }).esg && R.extrasFor(grp, { extras: { esg: false } }).allocation && R.extrasFor(other, { extras: { esg: true } }).esg, 'a choice made is kept');
    const titles = (r, i) => R.investor({ res: r, inputs: i || {} }).outline.map((o) => o.title);
    assert(!titles(other).some((t) => /^(Maturities and spreads|Portfolio allocation|ESG ratings|Prepayment protection)/.test(t)), 'none on another view');
    const out = R.investor({ res: grp, inputs: { coverName: 'Investor X' } }), tl = out.outline.map((o) => o.title);
    const ix = (re) => tl.findIndex((t) => re.test(t));
    assert(ix(/^Maturities and spreads/) === ix(/^Spreads across sectors/) + 1 && ix(/^Aggregated Credit Exposure/) > ix(/APPENDIX/) && ix(/^Portfolio allocation/) > ix(/^Aggregated Credit Exposure/) && ix(/^ESG Ratings/) > ix(/^Portfolio allocation/) && ix(/^Prepayment protection/) > ix(/^ESG Ratings/) && ix(/^Portfolio Monitoring/) > ix(/^Prepayment protection/), 'where they sit: ' + tl.join(' | '));
    const parts = await unpack(out.deck.toBytes()), names = packageOk(parts), slides = names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).map((n) => dec.decode(parts[n]));
    const txt = (x) => (x.match(/<a:t>[^<]*<\/a:t>/g) || []).map((t) => t.slice(5, -6));
    const mat = txt(slides.find((x) => x.includes('SPREAD PROFILES OF PORTFOLIO MATURITIES')));
    assert(['Less than 1', 'Between 1 to 3', 'Greater than'].every((w) => mat.includes(w)), 'maturity buckets along the bottom: ' + mat.join('|'));
    // allocation: a column per entity of the group in its order, the columns another view adds up whole as that view (Region A =
    // Investor 3 + Investor 4), each the entity's own amount (a fund in full); the last column the group's exposure
    const comp = grp.platform.composition, alloc = slides.filter((x) => x.includes('PORTFOLIO ALLOCATION')).map(txt);
    const ents = comp.map((c) => (c.label === 'Investor 3' || c.label === 'Investor 4' ? 'Region A' : c.label)).filter((l, i, a) => a.indexOf(l) === i);
    const head = alloc[0].slice(alloc[0].indexOf('Name') + 1, alloc[0].indexOf('Name') + 2 + ents.length);
    assert(JSON.stringify(head) === JSON.stringify(ents.concat(['Investor X'])), 'a column per entity of the view, then the view: ' + head.join('|'));
    const full = (r, l) => (l === 'Region A' ? (r.investors['Investor 3'] || 0) + (r.investors['Investor 4'] || 0) : r.investors[l] || 0);
    const r0 = grp.rows.slice().sort((a, b) => b.exposure_m - a.exposure_m)[0], row = alloc.flat(), at = row.indexOf(r0.code_name || r0.name);
    const want = ents.map((l) => full(r0, l)).map((v) => (v > 0.0005 ? `${Math.round(v)}m` : '-'));
    assert(at >= 0 && JSON.stringify(row.slice(at + 1, at + 1 + ents.length)) === JSON.stringify(want) && row[at + 1 + ents.length] === `${Math.round(r0.exposure_m)}m`, 'allocation row: ' + row.slice(at, at + ents.length + 2).join('|') + ' want ' + want.join('|'));
    // ESG: one row per deal (its tranches as one) with its scores; green when the deal has a CBI sector
    const esg = slides.filter((x) => x.includes('ESG RATINGS')).map(txt).flat(), withCbi = grp.rows.find((r) => r.asset.esg.chi_sector);
    const dealOf = (r) => r.asset_group || r.transaction_group || r.code_name || r.name, d0 = dealOf(grp.rows[0]);
    assert(esg.includes('E score') && esg.includes('Green asset') && esg.includes('Yes') && withCbi && esg.includes(d0), 'ESG table');
    // granularity: each deal's share of AuM, largest first, the shares adding up to 100 %
    const gr = slides.filter((x) => x.includes('PORTFOLIO GRANULARITY')).map(txt).flat(), sh = gr.filter((t) => /^\d+\.\d\d%$/.test(t)).map(parseFloat);
    assert(sh.length && Math.abs(sh.reduce((t, v) => t + v, 0) - 100) < 0.2 && sh.every((v, i) => !i || v <= sh[i - 1]) && gr.some((t) => /^EUR [\d,]+m$/.test(t)), 'granularity: ' + gr.slice(0, 12).join('|'));
    // prepayment protection: the share of the life protected as the workbook works it out, (end − funding) ÷ (maturity − funding)
    const AUM = Scope.calc.aum, adj = T.demo({ platform: 'Group' });
    const pp = slides.filter((x) => x.includes('PREPAYMENT PROTECTION')).map(txt).flat();
    assert(['Prepayment protection', 'Financial close', 'End of protection', '% of time protected', 'Eligible for MW fee', 'Reason for non-eligibility'].every((h) => pp.includes(h)), 'prepayment headers');
    assert(pp.some((t) => /^Denomination in [A-Z]{3}$/.test(t)) && pp.includes('Floating'), 'reasons a make-whole fee cannot be earned');
    const withEnd = grp.rows.find((r) => r.asset.attrs.protection_end_date && r.maturity_date && (r.financial_close || r.funding_date));
    if (withEnd) { const c = withEnd.funding_date || withEnd.financial_close, e = new Date(withEnd.asset.attrs.protection_end_date + 'T00:00:00Z'), m = withEnd.maturity_date, sh = Math.round(Math.max(0, Math.min(1, (e - c) / (m - c))) * 100) + '%', i = pp.indexOf(withEnd.code_name || withEnd.name); assert(i >= 0 && pp.slice(i, i + 9).includes(sh), `share protected ${sh}: ` + pp.slice(i, i + 9).join('|')); }
  });

  T.add('the group\'s own deck: WAL, repaid by quarter and changes on the quarter in the key figures; budget, shares of AuM, undrawn amounts and the entities on the AuM page; curves by name and the window from their start', async () => {
    const R = Scope.report, grp = T.demo({ platform: 'Group' });
    const pts = []; for (let t = Date.UTC(2020, 5, 30); t <= +grp.reportingDate; t += 30 * 864e5) pts.push([Math.round((t - Date.UTC(1899, 11, 30)) / 864e5), 150]);
    const market = { series: [{ name: 'EUR Corp BBB 7-10y', points: pts }, { name: 'Markit iBoxx EUR Infrastructure BBB', points: pts }, { name: 'EUR Corp BB All', points: pts.map((p) => [p[0], 300]) }] };
    const out = R.investor({ res: grp, prev: T.demo({ platform: 'Group' }), inputs: { coverName: 'Investor X', mandate_m: '3000', market } });
    const parts = await unpack(out.deck.toBytes()), names = packageOk(parts), slides = names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).map((n) => dec.decode(parts[n]));
    const txt = (x) => (x.match(/<a:t>[^<]*<\/a:t>/g) || []).map((t) => t.slice(5, -6));
    const kf = txt(slides.find((x) => x.includes('Weighted Average Life')));
    assert(kf.includes('Repaid in Q1, Q2 2026') && kf.includes('Brownfield') && kf.includes('Sub-IG') && kf.some((t) => /^\d+\.\d%$/.test(t)) && kf.filter((t) => /QoQ\)$/.test(t)).length >= 6 && !kf.includes('Instruments outstanding'), 'group key figures: ' + kf.slice(0, 30).join('|'));
    const aum = txt(slides.find((x) => x.includes('Unused Budget')));
    const total = grp.metrics.total_exposure_m;
    assert(aum.includes('Total Assets under management') && aum.includes('% of total AUM') && aum.includes('100%') && aum.includes(`€${Math.round(3000 - total).toLocaleString('en-GB')} M`) && aum.includes('Total unfunded') && aum.includes('Region A') && aum.includes(`EUR ${Math.round(total).toLocaleString('en-GB')} M`), 'group AuM page: ' + aum.slice(0, 40).join('|'));
    // relative value: both BBB curves on the BBB chart, the BB one on the BB chart, the dates from the curves' start
    const rv = names.filter((n) => /charts\/chart\d+\.xml$/.test(n)).map((n) => dec.decode(parts[n])).filter((c) => c.includes('<c:scatterChart>'));
    assert(rv.length === 2 && rv[0].includes('EUR Corp BBB 7-10y') && rv[0].includes('Markit iBoxx EUR Infrastructure BBB') && rv[1].includes('EUR Corp BB All') && !rv[1].includes('BBB 7-10y'), 'curves by name');
    const min = +(rv[0].match(/<c:valAx><c:axId val="50010"\/><c:scaling><c:orientation val="minMax"\/>(?:<c:max val="[\d.]+"\/>)?<c:min val="([\d.]+)"\/>/) || [])[1];
    assert(min >= pts[0][0] - 92 && min <= pts[0][0], 'the window from the curves\' start: ' + min + ' vs ' + pts[0][0]);
    assert(slides.some((x) => x.includes('INVESTOR X – ACHIEVED SPREADS ACROSS PORTFOLIO')), 'the group in the relative-value kicker');
  });

  T.add('long tables fit the page: every row as tall as its type needs, the table above the source line; ratings bold (internal ones in Accent 1); the protection as its description', async () => {
    const R = Scope.report, grp = T.demo({ platform: 'Group' });
    const parts = await unpack(R.investor({ res: grp, inputs: { coverName: 'Investor X' } }).deck.toBytes()), names = packageOk(parts), slides = names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).map((n) => dec.decode(parts[n]));
    const EMU = 914400;
    let n = 0;
    for (const x of slides) for (const tbl of x.match(/<p:graphicFrame>[\s\S]*?<\/p:graphicFrame>/g) || []) {
      if (!tbl.includes('<a:tbl>')) continue;
      const y = +(tbl.match(/<a:off x="\d+" y="(\d+)"\/>/) || [])[1];
      let bottom = y;
      for (const tr of tbl.match(/<a:tr h="\d+">[\s\S]*?<\/a:tr>/g)) {
        const h = +tr.match(/<a:tr h="(\d+)">/)[1], cells = tr.match(/<a:tc>[\s\S]*?<\/a:tc>/g);
        const need = Math.max(...cells.map((c) => { const sz = Math.max(0, ...(c.match(/ sz="(\d+)"/g) || []).map((v) => +v.match(/\d+/)[0])) / 100, lines = (c.match(/<a:br>/g) || []).length + 1, m = c.match(/marT="(\d+)" marB="(\d+)"/); return (lines * sz * 1.2 / 72) * EMU + (m ? +m[1] + +m[2] : 0); }));
        assert(h >= need - 2000, `a row shorter than its type: ${h} < ${Math.round(need)}`);
        bottom += h; n++;
      }
      assert(bottom <= 6.9 * EMU, 'a table past the content area: ' + (bottom / EMU).toFixed(2) + ' in');
    }
    assert(n > 100, 'tables checked');
    const at = slides.find((x) => x.includes('Compliance'));
    assert(/<a:rPr[^>]* b="1"[^>]*><a:solidFill><a:srgbClr val="00A2A3"\/>/.test(at), 'internal ratings bold in Accent 1');
    const pp = slides.filter((x) => x.includes('PREPAYMENT PROTECTION')).map((x) => (x.match(/<a:t>[^<]*<\/a:t>/g) || []).map((t) => t.slice(5, -6))).flat();
    assert(!pp.some((t) => /^(yes|no)\s*;/i.test(t)) && !pp.includes('None') && pp.includes('n/a') && pp.includes('#'), 'protection as its description: ' + pp.slice(0, 30).join('|'));
  });

  T.add('house deck colours and words: each sector its colour on the rings, countries in turn on the map, the kicker above a template title that has no kicker box', async () => {
    const P = Scope.pptx, R = Scope.report, res = T.demo({ platform: 'Region A' });
    // rings: Renewables Accent 2, Transport Accent 1, Telecom/Digital Accent 4 (the house theme: 8ACBBB, 00A2A3, 17596F)
    const H = R.sectorColourOf(null, 'Renewables'), Tr = R.sectorColourOf(null, 'Transport'), Te = R.sectorColourOf(null, 'Digital');
    assert(H === '8ACBBB' && Tr === '00A2A3' && Te === '17596F' && R.sectorColourOf(null, 'Shipping') === null, 'sector colours: ' + [H, Tr, Te]);
    assert(R.sectorKinOf(null, 'Transport')[0] === '00A2A3' && R.sectorKinOf(null, 'Transport').length === 6, 'subsectors: the colour, then its tints');
    assert(JSON.stringify(R.catOf(null, 6)) === JSON.stringify(['0F7164', '8ACBBB', '00A2A3', '17596F', '00A76C', '8ACBBB']), 'map: ' + R.catOf(null, 6));
    assert(R.cashflowColourOf(null, 'Contracted') === '00A2A3' && R.cashflowColourOf(null, 'Regulated') === '8ACBBB', 'types of cash flow');
    // a template whose content page has a title x but no kicker x: the kicker goes above the title
    const t = P.deck({ title: 'T' }); t.slide(); t.slide(); const ct = t.slide(); ct.text({ x: 0.5, y: 0.9, w: 11, h: 0.6, text: 'x', size: 28 });
    const tpl = await P.readTemplate(t.toBytes(), 't.pptx');
    const out = R.investor({ res, template: tpl, inputs: { coverName: 'Investor X' } }), parts = await unpack(out.deck.toBytes()); packageOk(parts);
    const sl = Object.keys(parts).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).map((n) => dec.decode(parts[n])).find((x) => x.includes('Portfolio overview as at end of'));
    assert(sl.includes('INVESTOR X – PORTFOLIO OVERVIEW'), 'kicker drawn above the title');
    // key figures as the house deck: eight figures in four columns, no quarter-on-quarter tags, "Repaid in <year>", "289bps",
    // footnote 1 on the title, footnote 2 on Brownfield and Sub-IG with their shares of the mandate
    const prev = T.demo({ platform: 'Region A' }), out2 = R.investor({ res, prev, inputs: { coverName: 'Investor X', mandate_m: '1000' } });
    const p2 = await unpack(out2.deck.toBytes()), kf = Object.keys(p2).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).map((n) => dec.decode(p2[n])).find((x) => x.includes('Instruments outstanding'));
    const kt = (kf.match(/<a:t>[^<]*<\/a:t>/g) || []).map((t) => t.slice(5, -6));
    assert(!kf.includes('QoQ') && !kf.includes('New commitments') && kt.includes('Repaid in 2026') && kt.includes('Brownfield²') && kt.includes('Sub-IG²') && kt.some((t) => /^\d+bps$/.test(t)), 'key figures: ' + kt.slice(0, 20).join('|'));
    assert(out2.outline.some((o) => o.title === 'Portfolio overview as at end of June 2026\u207D\u00B9\u207E') && kt.some((t) => /^\(2\) Calculated as a percentage of AuM\. Brownfield is \d+% as a percentage of mandate size, Sub-IG is \d+% of mandate size$/.test(t)), 'footnotes: ' + kt.filter((t) => /^\(/.test(t)).join('|'));
    // monitoring pages in deal order (the asset table's), whatever order the write-ups workbook has them in
    const ord = res.rows.slice().sort((a, b) => (a.chronological_order || 1e9) - (b.chronological_order || 1e9)), last = ord[ord.length - 1], first = ord[0];
    const items = [{ name: last.code_name, description: 'x', events: [] }, { name: first.code_name, description: 'y', events: [] }];
    const got = R.writeupsForView(items, res, {}).map((m) => m.name);
    assert(got[0] === first.code_name && got[1] === last.code_name, 'write-ups in deal order: ' + got.join(', '));
  });

  T.add('CSV export: text Excel would run as a formula opens as text; negative numbers and "-5" stay numbers', () => {
    const csv = Scope.csv.serialize([{ a: '=SUM(A1)', b: '+44 20', c: '@cmd', d: '-x', e: -5, f: '-5', g: '-.5', h: 'plain' }]);
    assert(csv.split('\n')[1] === "'=SUM(A1),'+44 20,'@cmd,'-x,-5,-5,-.5,plain", 'escaped: ' + csv);
  });
})(typeof window !== 'undefined' ? window : globalThis);
