/* Planned modules: registered so the full six-layer platform is navigable. Each page states purpose, functions, inputs and open definitions from the build brief.
 *
 * Registers one 'planned' module per entry in PLANNED with a shared descriptive page (it does not read the engine result).
 * Building one of them for real means adding its own module file and removing its entry here (README "Add a module").
 */
(function (global) {
  'use strict';
  const Scope = global.Scope, UI = Scope.ui, h = UI.h;
  // Entry: { id, layer, order, title, icon, purpose, will[], needs[] (proposed CSV inputs), open[] (open definitions),
  //          priority, available[[text, module id]] (what existing pages already cover, rendered as links) }
  const PLANNED = [
    { id: 'pipeline', layer: -2, order: 1, title: 'Pipeline & origination', icon: 'inbox', purpose: 'Capture every opportunity early, keep its evolving description and status, and preserve its history whether it closes or not.',
      will: ['Create a pipeline entry from an NDA upload', 'Attach further documents that enrich the deal profile', 'Track defined stages and responsible team member', 'Compare past and present opportunities with filters', 'Retain declined / on-hold outcomes for comparison', 'Export pipeline views to PowerPoint, PDF and Excel'],
      needs: ['pipeline.csv (deal, category, rating, greenfield/brownfield, sponsor, tenor, ccy, size, proposed amount, repayment, rate type, spread, expected close, stage, owner)', 'pipeline_allocations.csv (proposed allocation by investor)', 'documents index'],
      open: ['Stage definitions', 'Ownership and permission model', 'NDA extraction review process'], priority: 'Low', available: [['Platform + investor structure to allocate against', 'investors']] },
    { id: 'execution', layer: -1, order: 1, title: 'Execution & handover', icon: 'git-merge', purpose: 'Move a viable opportunity through investment, allocation and closing, then hand a reliable asset record to the FMCG team.',
      will: ['Build the deal profile from IC paper, transaction documents and the SCD output', 'Aggregate sector research and commercial due-diligence material', 'Hand over on closing without losing deal information or documents', 'Create the held-asset record (mapping_assets + hardcoded rows) from the execution record'],
      needs: ['execution.csv (deal → holding IDs, closing date, IC reference, documents)', 'handover checklist definition'], open: ['Handover checklist and sign-off process (not yet supplied)'], priority: 'Medium', available: [['Asset record structure', 'aum']] },
    { id: 'pretrade', layer: -1, order: 2, title: 'Pre-trade guideline test', icon: 'shield', purpose: 'Test a proposed deal against each investor or mandate guideline and explain the result, never a bare pass/fail.',
      will: ['Represent mandate rules: countries, currencies, ratings, sectors and exclusions, tenor, max per transaction, greenfield/brownfield, fixed/floating', 'Show which rule and which input makes an investor eligible, ineligible or subject to review', 'Show resulting exposure and residual capacity after the proposed allocation', 'Pro-rata allocation across eligible investors (Low priority)'],
      needs: ['guidelines.csv (mandate, rule dimension, operator, limit, basis, ramp-up conditions)', 'proposed deal + allocation input form'], open: ['Denominator and exposure basis per mandate', 'Commitments vs invested amounts', 'Rule exceptions and ramp-up periods'], priority: 'Medium', available: [['Current exposure by dimension to test against', 'aum'], ['Investor columns and platforms', 'investors']] },
    { id: 'cashflows', layer: 1, order: 3, title: 'Cash flows & returns', icon: 'activity', purpose: 'Instrument and investor cash flows over selectable periods, with IRR and return calculations that reconcile to dated flows.',
      will: ['Ingest instrument cash-flow profiles (Simcorp Dimension or CSV)', 'Incorporate separately sourced cash flows into the AUM view', 'Expected interest and repayment flows by period, actual vs forecast', 'Investor commitments, calls, uncalled, repayments, distributions', 'IRR at asset, fund and investor level; gross vs net where defined', 'Reconcile a result to its underlying dated cash flows and NAV inputs'],
      needs: ['cashflows.csv (holding/investor, date, type, amount, ccy, actual/forecast, source)', 'investor_capital.csv (commitment, calls, distributions)', 'nav.csv'], open: ['IRR conventions, fee treatment, timing, FX and valuation assumptions'], priority: 'High', available: [['Nominal, drawn and commitment per position (the starting balances)', 'aum']] },
    { id: 'borrower-reporting', layer: 2, order: 1, title: 'Borrower reporting & documents', icon: 'file-text', purpose: 'Track what borrowers owe and what was received, and keep the source document behind every extracted data point.',
      will: ['Reporting calendar per transaction with due/outstanding notifications', 'Register of documents received', 'AI-assisted extraction of covenant data from PDFs — never presented as verified without human review'],
      needs: ['reporting_requirements.csv', 'documents.csv (asset, type, period, received date, file reference)'], open: ['Human review workflow for extracted values'], priority: 'High', available: [['Asset registry', 'aum']] },
    { id: 'covenants', layer: 2, order: 2, title: 'Covenants & ratings history', icon: 'sliders', purpose: 'Covenant measurements over time with lock-up and default thresholds, rating changes and closing-case comparison.',
      will: ['Store covenant observations per test date with the applicable definition', 'Show lock-up and default levels where supplied', 'Rating history from internal and agency grades', 'Compare closing case with actual performance', 'Charts and PDF/Excel export'],
      needs: ['covenants.csv (asset, covenant, test date, value, lockup, default, source document)', 'rating_history.csv'], open: ['Covenant definitions and testing dates per transaction'], priority: 'High', available: [['Current grade, covenant type and levels on the asset page', 'aum']] },
    { id: 'kpis', layer: 2, order: 3, title: 'Financial & operational KPIs', icon: 'bar-chart-2', purpose: 'Loan performance against the closing base case, budget and actuals, and separately the underlying project business plan.',
      will: ['KPI set defined per transaction, sector or project', 'Closing case vs budget vs actual for the loan', 'Business plan vs budget vs actual for the project', 'Retain underwriting forecasts and historical credit commentary'],
      needs: ['kpis.csv (asset, kpi, period, closing case, budget, actual, source)', 'commentary.csv'], open: ['Sector-specific KPI definitions'], priority: 'High', available: [] },
    { id: 'watchlist', layer: 2, order: 4, title: 'Watchlist & loan reviews', icon: 'flag', purpose: 'A consistently formatted watchlist with configurable criteria, analyst summaries and PowerPoint output; monitoring material reusable in loan reviews.',
      will: ['Apply the criteria defined for each transaction', 'Analyst written summary per asset', 'Export the watchlist view to PowerPoint', 'Loan review pack combining holdings and monitoring information'],
      needs: ['watchlist_criteria.csv', 'review_template definition'], open: ['Watchlist criteria, escalation rules and review template (not yet provided)'], priority: 'High', available: [['Watchlist flag and exposure share', 'aum']] },
    { id: 'valuations', layer: 2, order: 5, title: 'Valuations', icon: 'trending-up', purpose: 'Monthly valuations and market values with history, plus mark-to-model metrics such as Z-spread and ID-spread.',
      will: ['Retrieve valuations from portfolio-management and FMCG sources monthly', 'Valuation history per asset', 'Mark-to-model spread calculations once curves and conventions are supplied'],
      needs: ['valuations.csv (holding, date, price/MV, source)', 'curves.csv'], open: ['Valuation methodology, curves, ownership of marks, approval process'], priority: 'Medium', available: [] },
    { id: 'comparables', layer: 2, order: 6, title: 'Transaction comparables', icon: 'columns', purpose: 'A filterable dataset of pricing and commercial terms from transactions and market soundings.',
      will: ['Year, subsector, geography, rating, format, tenor, WAL, purpose, pricing, fees, all-in, fixed/floating, currency, covenant levels', 'Granular filtered comparison', 'Regularise key terms extracted from IC papers and loan agreements'],
      needs: ['comparables.csv'], open: ['Which terms are authoritative; source of market soundings'], priority: 'Medium', available: [['Own-book terms (spread, tenor, rating, format) already structured', 'aum']] },
    { id: 'reporting', layer: 3, order: 1, title: 'Investor reporting', icon: 'book-open', purpose: 'Quarterly reporting for group companies and third-party investors from editable templates, without re-entering holdings.',
      will: ['Select investor / group / look-through / vehicle and period', 'Editable templates with analyst commentary', 'Populate portfolio and monitoring information from the maintained record', 'PowerPoint output; underlying data export'],
      needs: ['report_templates definition', 'investor hierarchy confirmation'], open: ['Final report templates and sign-off', 'Investor-group and vehicle hierarchy'], priority: 'High', available: [['Investor book and per-platform AUM view', 'investors'], ['Output CSV export', 'aum']] },
    { id: 'guidelines', layer: 3, order: 2, title: 'Post-trade guidelines & capacity', icon: 'check-circle', purpose: 'Check that mandate guidelines remain met, show exposure and residual capacity, and progress by sector as a mandate approaches full investment.',
      will: ['Per-mandate branches starting from the exact platform total (the workbook\'s Guidelines sheet)', 'Add pipeline only when the switches match', 'Funded / unfunded / commitment ratios', 'Return blank, OK, Ramp-Up or BREACH per rule with the input shown'],
      needs: ['guidelines.csv (shared with pre-trade)', 'pipeline inclusion switches'], open: ['Denominators, exposure basis, commitments vs invested, exceptions per mandate'], priority: 'Medium', available: [['Exposure by rating, sector, country, currency, coupon type and maturity per platform', 'aum']] },
    { id: 'templates', layer: 3, order: 3, title: 'Custom views & templates', icon: 'grid', purpose: 'Saved KPIs across mandates, adjustable views and team-designed reporting templates.',
      will: ['Save filtered views and KPI sets', 'Template designer for reports and watchlist packs', 'Per-investor, group, look-through, vehicle and currency variants of the same view'],
      needs: ['saved view definitions'], open: [], priority: 'High', available: [['Breakdown by any dimension with filters', 'aum']] },
  ];

  for (const def of PLANNED) {
    Scope.registerModule({
      id: def.id, layer: def.layer, order: def.order, title: def.title, status: 'planned', icon: def.icon,
      /** Descriptive page: purpose, planned functions, proposed inputs, open definitions, what exists today and how to build it. */
      render(el) {
        el.appendChild(Scope.app.pageHead({ title: def.title, sub: `Planned module · priority in the requirements: ${def.priority}` }));
        el.appendChild(UI.section({ title: 'Purpose', body: h('div', { class: 'planned-hero' }, h('div', { class: 'icon' }, Scope.icon(def.icon, { size: 28, strokeWidth: 1.5 })), h('p', {}, def.purpose)) }));
        el.appendChild(h('div', { class: 'grid-3' },
          UI.section({ title: 'What it will do', body: h('ul', { class: 'checklist' }, def.will.map((t) => h('li', {}, t))) }),
          UI.section({ title: 'Inputs it needs', subtitle: 'proposed CSV tables — the same drop-in pattern as the AUM inputs', body: h('ul', { class: 'checklist' }, def.needs.map((t) => h('li', {}, t))) }),
          UI.section({ title: 'Open definitions', subtitle: 'must be confirmed by the business before results are authoritative (brief §21)', body: def.open.length ? h('ul', { class: 'checklist' }, def.open.map((t) => h('li', {}, t))) : UI.empty('None specific') }),
        ));
        el.appendChild(UI.section({ title: 'Already available today', body: def.available.length ? h('ul', { class: 'checklist' }, def.available.map(([t, mod]) => h('li', { class: 'done' }, h('a', { href: Scope.href(mod) }, t)))) : UI.empty('Nothing yet') }));
        el.appendChild(UI.section({ title: 'How to build it', body: h('p', { class: 'small ink2' }, 'Put the calculation in its own file under ', h('code', {}, 'js/calc/'), ' (one auditable file per coverage task, like ', h('code', {}, 'js/calc/aum.js'), '), reading any extra workbook sheets there, then copy ', h('code', {}, 'js/modules/layer2-esg.js'), ' as the page and set this module\'s status to "built". See README › Extending the platform.') }));
      },
    });
  }
})(window);
