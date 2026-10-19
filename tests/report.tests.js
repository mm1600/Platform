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

  T.add('template pages: cover, section and content slides with x boxes are filled in place; footers kept; exhibits sit in the free area', async () => {
    const P = Scope.pptx, R = Scope.report;
    const t = P.deck({ title: 'T' });
    const c = t.slide(); c.text({ x: 0.6, y: 0.8, w: 8, h: 1, text: 'x', size: 40, bold: true }); c.text({ x: 2.5, y: 5.4, w: 5, h: 0.5, text: 'x', size: 16 }); c.text({ x: 0.6, y: 7, w: 3, h: 0.3, text: 'Footer kept' });
    const sct = t.slide(); sct.rect({ x: 0, y: 0, w: 13.333, h: 6.7, fill: '00785A' }); sct.text({ x: 0.5, y: 0.2, w: 4, h: 2, text: 'x', size: 96 }); sct.text({ x: 0.5, y: 3, w: 9, h: 1, text: 'x', size: 40 }); sct.text({ x: 0.5, y: 4.2, w: 9, h: 1, text: 'x', size: 18 });
    const ct = t.slide(); ct.text({ x: 0.5, y: 0.2, w: 9, h: 0.3, text: 'x', size: 10 }); ct.text({ x: 0.5, y: 0.6, w: 11, h: 0.7, text: 'x', size: 28 }); ct.text({ x: 0.5, y: 6.95, w: 3, h: 0.3, text: 'Footer kept' }); ct.text({ x: 8, y: 6.6, w: 4.8, h: 0.25, text: '{source}', size: 7 });
    const tpl = await P.readTemplate(t.toBytes(), 't.pptx');
    assert(tpl.pages.length === 3 && tpl.kinds.content === 2 && tpl.layouts.length === 1, 'three pages read');
    assert(P.slotRoles(tpl.pages[0], 'cover').join() === 'name,date' && P.slotRoles(tpl.pages[1], 'section').join() === 'number,title,subtitle' && P.slotRoles(tpl.pages[2], 'content').join() === 'kicker,title,source', 'slot roles: ' + [0, 1, 2].map((i) => P.slotRoles(tpl.pages[i], ['cover', 'section', 'content'][i]).join()).join(' / '));
    const box = tpl.pages[2].box; assert(box.y > 1.3 && box.y < 1.6 && box.y + box.h < 6.6, 'free area under the title, above the source and footer: ' + JSON.stringify(box));
    const res = T.demo({ platform: 'Region A' });
    const out = R.investor({ res, template: tpl, inputs: { coverName: 'Investor X' } }), parts = await unpack(out.deck.toBytes()), names = packageOk(parts);
    const sl = (i) => dec.decode(parts[`ppt/slides/slide${i}.xml`]);
    assert(sl(1).includes('INVESTOR X') && sl(1).includes('REPORTING AS OF') && sl(1).includes('Footer kept') && !/<a:t>x<\/a:t>/.test(sl(1)), 'cover filled in place');
    assert(sl(2).includes('<a:t>01</a:t>') && sl(2).includes('MARKET ACTIVITY') && sl(2).includes('00785A'), 'section break filled, its band kept');
    assert(sl(3).includes('OVERVIEW OF THE INFRASTRUCTURE DEBT MARKET') && sl(3).includes('Current market activity') && sl(3).includes('Footer kept') && !sl(3).includes('{source}'), 'content page: kicker, title, footer; blank source');
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
    // a mandate of that investor under another name: picked by its investors' fund names, or by being the one column filled for its assets only
    const r11 = T.demo({ platform: 'Investor 11' }), inv = (r11.inputs.investors || []).map((i) => (i.label === 'Investor 11' ? Object.assign({}, i, { fundName: 'Investor 21 infrastructure debt' }) : i));
    assert(AUM.sectorColumnFor(r11, '') === '' && AUM.sectorColumnFor(Object.assign({}, r11, { inputs: Object.assign({}, r11.inputs, { investors: inv }) }), '') === 'Investor 21 Sector Classification', 'picked by the view\'s investors');
    const mine = new Set(r11.rows.map((r) => r.code)), K21 = 'Investor 21 Sector Classification';
    const only = (a) => (mine.has(a.code) ? a : Object.assign({}, a, { sheets: Object.assign({}, a.sheets, { Hardcoded: Object.assign({}, a.sheets.Hardcoded, { [K21]: { value: '' } }) }) }));
    const assets = r11.assets.map(only), byCode = new Map(assets.map((a) => [a.code, a]));
    const covered = Object.assign({}, r11, { assets, rows: r11.rows.map((r) => Object.assign({}, r, { asset: byCode.get(r.code) })) });
    assert(AUM.sectorColumnFor(covered, '') === K21 && AUM.sectorColumnFor(Object.assign({}, covered, { rows: T.demo({ platform: 'Total platform' }).rows.map((r) => Object.assign({}, r, { asset: byCode.get(r.code) })) }), '') === '', 'picked when only it covers every asset of the view (not for the whole book)');
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
    assert(R.writeupsForView(it, res, {}).length === 3 && R.writeupsForView(it, res, {}, { unlinked: 'omit' }).length === 2, 'unlinked ones go in every report unless left out');
    assert(R.writeupsForView(it, res, { [R.writeupKey(it[1])]: away.code }).map((m) => m.name).join('|') === `${first}|${a3.code_name}`, 'a write-up about an asset the view does not hold stays out');
    // the deck: header bar, boxed ratios, ► bullets in colour, the impact line bold, pages counted
    const long = { ref: '9/9', name: 'Long one', description: 'A long write-up', events: Array.from({ length: 40 }, (_, k) => `Event ${k + 1}: ` + 'the quarter went broadly as planned and lenders were informed. '.repeat(3)) };
    const out = R.investor({ res, inputs: { monitoring: R.writeupsForView(it, res, {}).concat([long]) } });
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
})(typeof window !== 'undefined' ? window : globalThis);
