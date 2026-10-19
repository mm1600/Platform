/* Scope page: Layer 1 · Ask Scope (route #/ask, or #/ask/<question> to ask one straight away).
 *
 * A question box over the loaded data: type a question in your own words and get the figure, the split or the list of
 * assets, with a table, a chart for splits, and links to open the same thing in the Explorer, filter every page to it,
 * or open the asset. Questions are read and answered in this browser by js/analysis/ask.js (no model, no server), for
 * the view, currency and page filters in force. Under each answer, "How I read it" lists what was understood; × on a
 * part asks again without it. Short follow-ups ("and France?", "by sponsor", "list them") build on the last answer until
 * New topic. The thread lasts while the app is open; it is not saved or shared.
 */
(function (global) {
  'use strict';
  const Scope = global.Scope, UI = Scope.ui, h = UI.h, icon = Scope.icon, store = Scope.store, ASK = Scope.engine.ask;
  // the conversation: [{ q, a, at }] oldest first; prev = the query a follow-up builds on; asked = the last #/ask/<q> handled
  const S = { thread: [], prev: null, asked: null, draft: '' };
  const ic = (n) => icon(n, { size: 14 });

  /** Ask `text` (or run a prepared query) and add the answer to the thread. */
  function ask(res, text, query) {
    const shared = Scope.shared && Scope.shared.status ? Scope.shared.status() : null;
    let a;
    try { a = query ? ASK.run(res, query, { shared }) : ASK.answer(res, text, S.prev, { shared }); }
    catch (e) { console.error(e); a = { kind: 'none', sentence: 'Something went wrong answering that: ' + (e && e.message || e), read: [], actions: [], suggest: [], query: { intent: 'none' } }; }
    S.thread.push({ q: text, a, at: new Date() });
    if (S.thread.length > 40) S.thread.shift();
    if (a.query && !['help', 'define', 'issues', 'shared', 'none', 'intro'].includes(a.query.intent) && a.kind !== 'none') S.prev = a.query;
  }

  /** One table cell: text, an asset or investor link, or a group label that narrows the question to it. */
  function cell(c, entry, rerun) {
    if (c === null || c === undefined) return '';
    if (typeof c !== 'object') return String(c);
    const parts = [];
    if (c.href) parts.push(h('a', { href: c.href }, c.text)); else if (c.filter) parts.push(h('a', { href: '#', title: 'The assets in this group', onClick: (e) => { e.preventDefault(); const q = JSON.parse(JSON.stringify(entry.a.query)); q.filters = q.filters.filter((f) => f.field !== c.filter.field); q.filters.push(c.filter); q.groupBy = null; q.top = null; q.intent = 'list'; rerun(`Assets in ${c.text}`, q); } }, c.text)); else parts.push(c.text);
    if (c.sub) parts.push(h('span', { class: 'muted small' }, ' ' + c.sub));
    if (c.filter && Scope.filters) parts.push(h('button', { type: 'button', class: 'btn btn-sm btn-ghost ask-cell-filter', title: 'Filter every page to this', onClick: () => { Scope.filters.add(c.filter); UI.toast(`Filter added: ${Scope.filters.describe(c.filter)}`); } }, ic('filter')));
    return parts;
  }

  /** The answer card: headline, sentence, how it was read, table and chart, actions, follow-ups. */
  function answerCard(entry, res, rerun, send) {
    const a = entry.a, card = h('div', { class: 'ask-answer' + (a.kind === 'none' ? ' ask-none' : '') });
    if (a.headline) card.appendChild(h('div', { class: 'ask-headline' }, a.headline));
    if (a.sentence) card.appendChild(h('p', { class: 'ask-sentence' }, a.sentence));
    if (a.note) card.appendChild(h('div', { class: 'notice info ask-note' }, a.note));
    if (a.read && a.read.length) {
      card.appendChild(h('div', { class: 'ask-read' }, h('span', { class: 'ask-read-label' }, 'How I read it'),
        a.read.map((r) => h('span', { class: 'ask-tag', title: r.part ? 'Ask again without this part' : '' }, h('b', {}, r.k), ' ', r.v,
          r.part && r.part !== 'measure' ? h('button', { type: 'button', class: 'ask-tag-x', 'aria-label': `Drop ${r.k}`, onClick: () => rerun(`${entry.q} (without ${r.k.toLowerCase()})`, ASK.drop(a.query, r.part)) }, '×') : null))));
    }
    if (a.table && a.table.rows && a.table.rows.length) {
      const t = a.table;
      if (t.chart && t.chart.length > 1 && Scope.charts) {
        const box = h('div', { class: 'ask-chart' });
        card.appendChild(box);
        const unit = (res.config && res.config.unit) || 1e6;
        requestAnimationFrame(() => { try { Scope.charts.hbar(box, { items: t.chart.map((x) => ({ label: x.label, value: x.value / unit })), format: (v) => Scope.util.fmt.m(v) + 'm', max: 12 }); } catch (e) { console.error(e); } });
      }
      const head = h('tr', {}, t.columns.map((c) => h('th', { class: c.num ? 'num' : '' }, c.label)));
      const body = t.rows.map((r) => h('tr', {}, r.map((c, i) => h('td', { class: t.columns[i] && t.columns[i].num ? 'num' : '' }, cell(c, entry, rerun)))));
      if (t.total) body.push(h('tr', { class: 'ask-total' }, t.total.map((c, i) => h('td', { class: t.columns[i] && t.columns[i].num ? 'num' : '' }, c))));
      card.appendChild(h('div', { class: 'ask-table' }, h('table', { class: 'tbl compact' }, h('thead', {}, head), h('tbody', {}, body))));
      if (t.more) card.appendChild(h('div', { class: 'muted small ask-more' }, `${t.more} more not shown. Open in Explorer for all of them.`));
    }
    const acts = (a.actions || []).filter(Boolean);
    if (acts.length) {
      card.appendChild(h('div', { class: 'ask-actions' }, acts.map((x) => {
        const cls = 'btn btn-sm' + (x.primary ? ' btn-primary' : '');
        if (x.kind === 'link') return h('a', { class: cls, href: x.href, title: x.sub || '' }, ic(/explorer/.test(x.href) ? 'columns' : /asset/.test(x.href) ? 'box' : 'arrow-up'), ' ', x.label);
        if (x.kind === 'filter') return h('button', { type: 'button', class: cls, onClick: () => { for (const f of x.filters) Scope.filters.add(f); UI.toast(`Every page now shows: ${x.filters.map((f) => Scope.filters.describe(f)).join(' · ')}`); } }, ic('filter'), ' ', x.label);
        if (x.kind === 'view') return h('button', { type: 'button', class: cls, onClick: () => store.setSetting('platform', x.platform) }, ic('layers'), ' ', x.label);
        return null;
      })));
    }
    if (a.suggest && a.suggest.length) card.appendChild(h('div', { class: 'ask-suggest' }, h('span', { class: 'muted small' }, a.kind === 'none' || a.kind === 'help' ? 'Try' : 'Next'), a.suggest.map((s) => UI.chip(s, false, () => send(s)))));
    return card;
  }

  Scope.registerModule({
    id: 'ask', layer: 1, order: 0.5, title: 'Ask Scope', status: 'built', icon: 'message-circle',
    /** The thread, then the question box. A question in the route (#/ask/<question>) is asked once on arrival. */
    render(el, ctx) {
      const res = ctx.result;
      el.appendChild(Scope.app.pageHead({ title: 'Ask Scope', sub: 'questions in your own words, answered from the data loaded, for the view, currency and filters in force. Read in this browser: nothing is sent anywhere' }));
      if (!res || res.fatal) { el.appendChild(h('div', { class: 'notice warn' }, 'Load the four sheets on Data & validation first.')); return; }
      const routeQ = (ctx.params || []).join('/').trim();
      if (routeQ && routeQ !== S.asked) { S.asked = routeQ; S.prev = null; ask(res, routeQ); } // from the top search: a new topic

      const draw = () => ctx.app.render(true);
      const send = (text) => { const t = String(text || '').trim(); if (!t) return; S.draft = ''; ask(res, t); draw(); };
      const rerun = (label, query) => { ask(res, label, query); draw(); };

      const thread = h('div', { class: 'ask-thread', role: 'log', 'aria-live': 'polite' });
      if (!S.thread.length) {
        thread.appendChild(h('div', { class: 'ask-empty' },
          h('div', { class: 'ask-empty-icon' }, icon('message-circle', { size: 28 })),
          h('h2', {}, 'Ask about your book'),
          h('p', { class: 'muted' }, 'A figure (exposure, drawn, margin, WAL, rating), split by anything (sector, country, sponsor, investor, maturity), narrowed by any value or threshold, or a list of assets. Or ask where something is done in Scope. Every figure is the same as on the AUM page and the Explorer.'),
          h('div', { class: 'ask-suggest ask-examples' }, ASK.examples(res).map((s) => UI.chip(s, false, () => send(s))))));
      }
      S.thread.forEach((entry, i) => {
        const last = i === S.thread.length - 1;
        thread.appendChild(h('div', { class: 'ask-q' }, h('span', {}, entry.q), h('span', { class: 'ask-time' }, entry.at.toTimeString().slice(0, 5))));
        thread.appendChild(answerCard(entry, res, rerun, send));
        if (last && entry.a.query && entry.a.query.followUp) thread.lastChild.classList.add('ask-follow');
      });

      const input = h('input', { class: 'input ask-input', type: 'text', placeholder: S.prev ? 'Ask a follow-up, e.g. "and by sponsor?", or a new question' : 'e.g. Exposure by sector in sub-IG assets maturing before 2030', 'aria-label': 'Your question', value: S.draft, autocomplete: 'off' });
      let recall = S.thread.length;
      input.addEventListener('input', () => { S.draft = input.value; });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); send(input.value); }
        else if (e.key === 'ArrowUp' && S.thread.length) { recall = Math.max(0, recall - 1); input.value = S.thread[recall].q; e.preventDefault(); }
        else if (e.key === 'ArrowDown' && S.thread.length) { recall = Math.min(S.thread.length, recall + 1); input.value = recall < S.thread.length ? S.thread[recall].q : ''; e.preventDefault(); }
      });
      const bar = h('div', { class: 'ask-bar' }, input,
        h('button', { type: 'button', class: 'btn btn-primary', onClick: () => send(input.value) }, ic('send'), ' Ask'),
        S.prev ? h('button', { type: 'button', class: 'btn', title: 'The next question starts fresh instead of building on the last answer', onClick: () => { S.prev = null; draw(); } }, 'New topic') : null,
        S.thread.length ? h('button', { type: 'button', class: 'btn btn-ghost', title: 'Clear the questions on this page', onClick: () => { S.thread = []; S.prev = null; draw(); } }, ic('trash-2'), ' Clear') : null);

      el.appendChild(h('div', { class: 'section ask-section' }, h('div', {}, thread)));
      el.appendChild(bar);
      // keep the newest answer in view and the cursor in the box
      requestAnimationFrame(() => { const qs = thread.querySelectorAll('.ask-q'), lastQ = qs[qs.length - 1]; if (lastQ) { const top = document.getElementById('topbar'); lastQ.style.scrollMarginTop = ((top ? top.offsetHeight : 0) + 12) + 'px'; lastQ.scrollIntoView({ block: 'start' }); } input.focus({ preventScroll: true }); });
    },
  });
})(window);
