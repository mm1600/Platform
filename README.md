# Scope

**An infrastructure-debt portfolio platform that runs in any web browser.**

Scope replaces a spreadsheet-based AUM workbook with a connected, auditable web tool. It reads the same inputs as the workbook (exported as CSV files), reproduces its calculations, and lets a portfolio manager slice the book any way they need: by asset, investor, platform, sector, country, rating, maturity, currency, ESG and more, with every figure traceable back to the line of input that produced it.

It is plain HTML, CSS and JavaScript. There is nothing to install, no build step and no package manager. It works offline.

> **All bundled data is synthetic.** The demo investors, assets, amounts and thresholds are generated for illustration. None of them are real, and the dataset badge in the top bar says so.

---

## Quick start

Pick whichever suits the machine. Every option runs the same app.

| Option | How | Notes |
|---|---|---|
| **Open the file** | Double-click `index.html` | Works on any computer with a modern browser (Chrome, Edge, Firefox, Safari). Uses the embedded demo data. |
| **Windows launcher** | Double-click `start.bat` | Uses Node.js if installed (serves on http://localhost:8130), otherwise opens `index.html`. |
| **macOS launcher** | Double-click `start.command` | Same behaviour. If macOS blocks it the first time, right-click → Open. |
| **Linux / terminal** | `./start.sh` (optional port: `./start.sh 9000`) | Same behaviour. |
| **Any static server** | `node tools/serve.js 8130`, or serve the folder with any web server | Serving the folder makes the app read `data/demo/*.csv` directly. |

Node.js (version 16 or later) is only needed for the optional local server, the test runner and the demo-data generator. The app itself needs nothing but a browser.

---

## What it does

### Navigation

The sidebar follows the six business layers of the platform, from pipeline to reporting. Pages that exist today are marked built or partial. Planned pages are already in place, each describing what it will do, which inputs it needs and which business definitions must be agreed first, so the whole platform can be navigated from day one.

| Layer | Page | Status |
|---|---|---|
| −2 Pipeline | Pipeline & origination | planned |
| −1 Execution | Execution & handover, Pre-trade guideline test | planned |
| 0 Source data | **Data & validation** | built |
| 1 AUM | **AUM overview**, **Explorer**, **Investor book**, investor pages, asset pages | built |
| 1 AUM | Cash flows & returns | planned |
| 2 Monitoring | **Concentration & risk** | built |
| 2 Monitoring | **ESG** | partial |
| 2 Monitoring | Borrower reporting, Covenants, KPIs, Watchlist, Valuations, Comparables | planned |
| 3 Outputs | Investor reporting, Post-trade guidelines, Custom views | planned |

### The top bar: platform, currency, search and filters

- **Platform** selects which combination of investor columns counts as "exposure", exactly like the platform selector cell in the workbook's Output sheet.
- **Currency** converts every amount for display.
- **Search** (press `/` anywhere) finds assets, investors, sponsors, holding IDs, sectors, countries, ratings and pages. Choosing a value such as a country applies it as a filter. Choosing an asset or investor opens its page.
- **Filters** apply to every page at once. Add as many as you like and they combine: for example *fixed rate*, then *Germany or the Netherlands*, then *investment grade*, then *maturing after 2030*. Any field can be filtered: asset attributes, position terms, ratings, ESG data, investor, derived bands, and numeric ranges on any amount. The value picker shows only values still available under the other filters, with position counts and exposure, like Excel's AutoFilter. Filter sets can be saved and reloaded. Every KPI, chart, table and export on every page reflects the same filtered book.

### AUM overview

The interactive version of the workbook's Output sheet: headline KPIs (exposure, drawn, undrawn, group share of book, weighted rating, spread, WAL, fixed-rate share, watchlist share), charts by sector, country, rating and maturity, a two-level breakdown table by any pair of dimensions, and a full asset grid with every Output column and one column per investor. Clicking any chart bar filters the page. Output and position data export to CSV.

### Explorer

The Excel replacement for "any view of the book".

- **Pivot builder.** Put any fields into Rows, Columns, Values and Filters and nest as many levels as needed. Values can be summed, averaged, exposure-weighted, counted or distinct-counted, and shown as amounts or as % of total, row or column. Subtotals, grand totals, sorting by label or value, Top N with the rest folded into "Other", and expand / collapse per node or level. Clicking any cell drills through to the positions behind it. A chart mirrors the table.
- **Positions grid and assets grid.** Spreadsheet-style grids over every field, virtualised so they stay smooth with tens of thousands of rows. Per-column filters (value pickers, number expressions such as `>100` or `100..200`, date ranges), multi-column sort, frozen columns, a column chooser, totals for the visible rows, density toggle, copy and CSV export.
- **Presets, saved views and links.** Twelve ready-made layouts (sector × investor group, rating × maturity, country × currency and others), named views saved in the browser, and a shareable link that encodes the whole layout.

### Concentration & risk

Where the money is concentrated: a world map of exposure by country, a treemap by sector and asset, a heatmap of any two dimensions (rating × maturity by default), a Pareto chart of the largest exposures with cumulative share, a maturity ladder by year, sponsor and currency concentration, and concentration measures (largest names, top-10 share, Herfindahl index and effective number of names by asset, sector and country). An illustrative threshold table compares these measures with values from `config.csv`. Those thresholds are examples, not mandate limits. Clicking the map, treemap or heatmap filters the whole app.

### Investors and fund look-through

- **Investor book.** The asset × investor matrix for nominal, drawn or commitment, investor summaries, and the split between the attributed group and third parties.
- **Investor pages.** One page per investor with direct exposure, look-through exposure via funds, and total economic exposure. Breakdowns by sector, country, rating and maturity, plus a holdings table showing which fund each indirect exposure comes through.
- **Look-through.** When `fund_lookthrough.csv` is supplied, fund investor columns are traced to their unit holders. Totals are checked so that ultimate holders plus external fund holders reconcile to the platform total, with no double counting.

### Asset pages

Every asset shows its positions by investor, deal attributes, credit terms, ratings, ESG data, how it rolls into each platform, and a step-by-step calculation trace. Every value carries a provenance badge (imported, manual or calculated), and any input can be corrected with a recorded reason. The original value is always kept.

### Data & validation

Load your own CSV files by drag and drop, see how source columns map to the model, review validation issues, review and revert manual adjustments, and inspect every configuration table. Nothing is silently zeroed. An unmapped holding, unknown investor, missing FX rate or unreadable amount becomes an issue, and positions that cannot be valued are excluded and listed rather than shown as zero.

---

## Using your own data

1. Export each sheet of the workbook to CSV with the file names listed in [`data/SCHEMA.md`](data/SCHEMA.md): `holdings.csv`, `mapping_columns.csv`, `mapping_assets.csv`, `mapping_investors.csv`, `platforms.csv`, `ratings.csv`, `fx.csv`, `hardcoded.csv`, `esg.csv`, `config.csv`, and optionally `fund_lookthrough.csv`.
2. Open **Data & validation** and drop the files onto the page. A file replaces the table with the same name. Other tables are kept.
3. Review the **Issues** tab.

`mapping_columns.csv` renames the source extract's headers, so the holdings export can keep the source system's own column names. Loaded files stay in that browser only (local storage) until you reset to the demo. Nothing is uploaded anywhere.

To regenerate the synthetic demo data: `node tools/gen-demo.js` (deterministic).

---

## How the calculations work

The engine in `js/engine/aum.js` is a pure function from input tables to results. It also runs in Node for testing. It follows the workbook's logic:

| Workbook | Scope |
|---|---|
| Holdings extract and header renames | `holdings.csv` + `mapping_columns.csv` → canonical positions |
| Position key (investor × holding), the "SINGLE" portfolio rule | position key, `config.single_portfolio_token` |
| Holding → asset code, investor ID → investor label | `mapping_assets.csv`, `mapping_investors.csv` |
| Hardcoded and ESG lookups | `hardcoded.csv`, `esg.csv`, keyed by asset code |
| Rating branch and IG threshold | `ratings.csv`, `config.ig_threshold` |
| FX table and its one hard-coded exception | `fx.csv` standard rows plus override rows by investor and platform |
| Asset × investor matrices, inclusion weights, look-through columns | investor columns, `mapping_investors.group_weight`, `platforms.csv` compositions |
| Output platform and currency selectors, asset rows | top-bar selectors, AUM overview, Output CSV |
| Portfolio totals, weighted metrics, category shares | `AUM.summarise()` |

Rules that the workbook kept inside formulas are data here: platform compositions, group attribution weights, FX overrides, rating scales, IG threshold, maturity buckets and display units. Two workbook behaviours are reproduced and flagged because they need a business decision. First, the IG label uses the weaker of the internal and external numeric scores even when the internal grade is displayed. Second, an unrated position scores 0, which the workbook labels "IG". Scope shows it as NR instead.

The **dataset** layer (`js/engine/dataset.js`) flattens the result into one record per position, with every attribute as a dimension and every amount as a measure. The **pivot** engine (`js/engine/pivot.js`) aggregates it. Global filters are applied inside the engine (`js/core/store.js` computes twice: once to evaluate the filters on any field, once on the matching positions), so every page agrees.

---

## Project structure

```
index.html               page shell: loads core → engines → demo data → modules → app, in order
start.bat / start.command / start.sh   launchers for Windows / macOS / Linux
css/
  scope.css              design tokens, layout, cards, tables, badges, charts
  grid.css               spreadsheet grid
  explorer.css           pivot builder and Explorer page
  filters.css            global filter bar and search
  concentration.css      concentration page
  investor.css           investor pages and look-through
  fonts.css              optional corporate web font (see THIRD_PARTY_NOTICES.md)
js/core/
  util.js                numbers, dates (Excel YEARFRAC 30/360), rating normalisation, formatting
  csv.js                 CSV parse and serialise
  store.js               tables, settings, global filters, manual adjustments, cached results
  registry.js            business layers, module registry, hash router
  icons.js               inline icon set
  charts.js              SVG bar, column, donut and stacked charts with tooltips
  charts-extra.js        choropleth map, treemap, heatmap, Pareto, maturity ladder
  ui.js                  DOM helpers, KPI cards, badges, tables, modals, toasts
  grid.js                virtualised spreadsheet grid
  filters.js             global filters and global search
js/engine/
  aum.js                 AUM engine (the workbook's calculations)
  dataset.js             flat records and field registry over the engine result
  pivot.js               cross-tab aggregation, filters, Top N, % of total, export
  lookthrough.js         fund look-through to ultimate holders
js/modules/              one file per page; each registers itself with Scope.registerModule
js/app.js                app shell: data loading, sidebar, top bar, routing
data/
  demo/*.csv             synthetic input tables
  demo.js                the same tables embedded, so the app works when opened as a file
  world-map.js           country outlines for the map
  SCHEMA.md              input table reference
tools/
  serve.js               zero-dependency static server
  gen-demo.js            synthetic data generator
tests/                   engine tests (open tests/index.html, or run: node tests/run-node.js)
```

---

## Extending the platform

Each business function is one self-registering file, so new layers can be added without touching existing pages.

1. If it needs new inputs, add the CSV name to `Scope.store.REQUIRED` (or `OPTIONAL`) in `js/core/store.js` and document it in `data/SCHEMA.md`.
2. Put calculations in a new engine file under `js/engine/` as a pure function of the tables, reusing `result.positions` and `result.assets` where the data already exists.
3. Create the page in `js/modules/`:

```js
(function (global) {
  const Scope = global.Scope, UI = Scope.ui;
  Scope.registerModule({
    id: 'cashflows', layer: 1, order: 3, title: 'Cash flows & returns', status: 'built', icon: 'activity',
    // ctx.result is the engine result for the selected platform and currency, with global filters applied
    render(el, ctx) {
      el.appendChild(Scope.app.pageHead({ title: 'Cash flows' }));
      el.appendChild(UI.section({ title: 'Flows', body: UI.table({ rows: [], columns: [] }) }));
    },
  });
})(window);
```

4. Add its `<script>` tag to `index.html` and remove the matching entry from `js/modules/planned.js`.

Conventions that keep the numbers consistent: pages never compute totals themselves (engines do), every value can show its provenance badge, manual corrections go through `Scope.store.addAdjustment` so the audit trail is shared, and charts use `Scope.charts` so colours and tooltips match.

---

## Tests

```
node tests/run-node.js
```

The same tests run in the browser at `tests/index.html`. They cover CSV parsing, date and rating rules, the engine's totals and attribution, FX overrides, manual adjustments, the pivot engine (including a 50,000-record performance check), fund look-through reconciliation and the concentration measures.

---

## Definitions still to be agreed

These are configurable today, or listed on the relevant planned page, rather than decided in code.

| Definition | Where it lives today |
|---|---|
| AUM basis per view and position measure | `platforms.csv`; nominal / drawn / commitment toggles |
| FX rates, dates and overrides | `fx.csv` |
| Direct versus indirect (look-through) treatment | `group_weight` in `mapping_investors.csv`, `platforms.csv`, `fund_lookthrough.csv` |
| Name of the attributed investor group | `config.attribution_label` (default "Group") |
| Investor hierarchy | `investor_group` and platform compositions |
| Rating convention and IG threshold | `ratings.csv`, `config.csv` |
| Maturity buckets, display unit, concentration thresholds | `config.csv` |
| Returns and IRR, fees, NAV, cash-flow conventions, covenant definitions, valuation method, sector KPIs, watchlist criteria, report templates | not yet modelled; each planned page lists what must be supplied |

## Integrations

No live connection to source systems exists. The CSV files are the integration boundary: an adapter that produces the same files, or passes the same tables to `Scope.store.setTables`, is the intended connection point.

## Privacy

Everything runs locally in the browser. Scope makes no network requests other than reading its own files. Settings, saved views, filter sets and loaded data are kept in the browser's local storage on that machine.

## Third-party assets

See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for the icon set and world map licences, and for how to add a corporate typeface.
