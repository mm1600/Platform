# Scope

**An infrastructure-debt portfolio platform that runs in any web browser.**

Scope replaces a spreadsheet-based AUM workbook with a connected, auditable web tool. It reads the same four input sheets as the workbook (Holdings, Mapping, Hardcoded, ESG Hardcoded: drop the workbook or paste the sheets), reproduces its calculations, and lets a portfolio manager slice the book any way they need: by asset, investor, platform, sector, country, rating, maturity, currency, ESG and more, with every figure traceable back to the line of input that produced it.

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

### The top bar: view, currency, search and filters

- **View** lists the choices in Mapping column H (Views: portfolios / investors), exactly like the selector cell in the workbook's Output sheet. A view is either an investor column or a combination defined in the calculation file's settings.
- **Currency** converts every amount for display, using the FX rates found in Holdings.
- **Search** (press `/` anywhere) finds assets, investors, sponsors, security IDs, sectors, countries, ratings and pages. Choosing a value such as a country applies it as a filter. Choosing an asset or investor opens its page.
- **Filters** apply to every page at once. Add as many as you like and they combine: for example *fixed rate*, then *Germany or the Netherlands*, then *investment grade*, then *maturing after 2030*. Any field can be filtered, including every raw column of the four sheets (e.g. a covenant status in Holdings or a jurisdiction tier in Hardcoded) and numeric ranges on any amount or ratio. The value picker shows only values still available under the other filters, with position counts and exposure, like Excel's AutoFilter. Filter sets can be saved and reloaded. Every KPI, chart, table and export on every page reflects the same filtered book.

### AUM overview

The interactive version of the workbook's Output sheet: headline KPIs (exposure, drawn, undrawn, group share of book, weighted rating, spread, WAL, fixed-rate share, watchlist share), charts by sector, country, rating and maturity, a two-level breakdown table by any pair of dimensions, and a full asset grid with every Output column and one column per investor. Clicking any chart bar filters the page. Output and position data export to CSV.

### Explorer

The Excel replacement for "any view of the book".

- **Pivot builder.** Put any fields into Rows, Columns, Values and Filters and nest as many levels as needed. Values can be summed, averaged, exposure-weighted, counted or distinct-counted, and shown as amounts or as % of total, row or column. Subtotals, grand totals, sorting by label or value, Top N with the rest folded into "Other", and expand / collapse per node or level. Clicking any cell drills through to the positions behind it. A chart mirrors the table.
- **Positions grid and assets grid.** Spreadsheet-style grids over every field, virtualised so they stay smooth with tens of thousands of rows. Per-column filters (value pickers, number expressions such as `>100` or `100..200`, date ranges), multi-column sort, frozen columns, a column chooser, totals for the visible rows, density toggle, copy and CSV export.
- **Presets, saved views and links.** Twelve ready-made layouts (sector × investor group, rating × maturity, country × currency and others), named views saved in the browser, and a shareable link that encodes the whole layout.

### Concentration & risk

Where the money is concentrated: a world map of exposure by country, a treemap by sector and asset, a heatmap of any two dimensions (rating × maturity by default), a Pareto chart of the largest exposures with cumulative share, a maturity ladder by year, sponsor and currency concentration, and concentration measures (largest names, top-10 share, Herfindahl index and effective number of names by asset, sector and country). An illustrative threshold table compares these measures with values set in §1 of `js/calc/aum.js`. Those thresholds are examples, not mandate limits. Clicking the map, treemap or heatmap filters the whole app.

### Investors and fund look-through

- **Investor book.** The asset × investor matrix for nominal, drawn or commitment, investor summaries, and the split between the attributed group and third parties.
- **Investor pages.** One page per investor with direct exposure, look-through exposure via funds, and total economic exposure. Breakdowns by sector, country, rating and maturity, plus a holdings table showing which fund each indirect exposure comes through.
- **Look-through.** Fund investor columns are traced to whoever holds their units, so an investor sees its direct exposure, its share of each fund's assets, and the total. Who holds each fund's units is not in the four sheets (they only carry the group's share of a fund), so it is entered per investor in the Scope Settings sheet or in the investors × funds grid on **Data › Setup**. Ultimate holders plus holders outside the platform always reconcile to the platform total, with no double counting, and the group entities' shares are checked against each fund's attribution weight.

### Asset pages

Every asset shows its positions by investor, deal attributes, credit terms, ratings, ESG data, how it rolls into each platform, and a step-by-step calculation trace. Every value carries a provenance badge (imported, manual or calculated), and any input can be corrected with a recorded reason. The original value is always kept.

### Data & validation

Load the four sheets (drop the workbook, drop CSVs, or paste from Excel) and see exactly how they were read: the header row found in each sheet, which column feeds each input (with an override per input), where each of the six Mapping tables was found, how each view and investor column is defined (editable), the FX direction check, and the **workbook checks**: the workbook's own formula columns (Holdings B–F and row 2, Hardcoded D–E) recomputed and compared cell by cell. On the demo every check matches 100%. Issues, corrections and the calculation settings are on the same page. Nothing is silently zeroed: a position that cannot be valued is excluded and listed with its reason.

## Using your own data

1. Export the four sheets from the AUM workbook (Holdings, Mapping, Hardcoded, ESG Hardcoded), formulas and all, or just use the whole workbook.
2. Open **Data & validation › Setup** and drop the `.xlsx` / `.xlsm` (or one CSV per sheet, or paste each sheet).
3. Work down the Setup steps: columns resolved, investors named and classified (group and weight), views defined, fund look-through entered per investor ("Investor 1 holds 15% of Fund A") in an Excel-like grid, workbook checks.
4. **Download the Scope Settings sheet** and add it to your workbook as a fifth sheet. From then on every drop is configured automatically: drop and play. Later changes can be made in the app or in the sheet.

The sheet layouts, the Scope Settings sheet and how formulas are handled are described in [`data/SCHEMA.md`](data/SCHEMA.md). Synthetic examples of all five sheets are in `data/demo/` (`Scope-demo.xlsx` plus one CSV per sheet). A loaded workbook stays in that browser (IndexedDB) until you reset to the demo; loading your own data clears the demo. Nothing is uploaded anywhere.

To regenerate the synthetic demo workbook: `node tools/gen-demo.js` (deterministic). To inspect any workbook from the command line: `node tools/xlsx-check.js file.xlsx`. To see exactly how the calculation reads it (header rows, which column feeds each input, the six Mapping tables, workbook checks, issues): `node tools/diagnose.js file.xlsx`.

## How the calculations work

All AUM calculations sit in **one file, `js/calc/aum.js`**, which reads top to bottom in the same order as the workbook. It is a pure function from the four sheets to the results, so it also runs in Node for testing, and every number keeps the cell it came from (e.g. `Holdings!AK57`).

| Section | What it does | Workbook equivalent |
|---|---|---|
| §1 Settings | defaults for everything the four sheets do not hold (views, investor groups and weights, fund unit holders, the FX exception, IG threshold, buckets, thresholds) |
| §1b Scope Settings | the optional fifth sheet that overrides those defaults per workbook (names, groups, weights, views, look-through, FX exception) | header-row weights and constants inside Calculations / Output formulas |
| §2 Inputs | where each input lives: the column roles, matched by output name (row 2) or header (row 3) | Holdings row 2 / row 3 |
| §3 Reading | find each sheet's header row; locate the six Mapping tables by title | — |
| §4 Mapping lookups | References, Active Assets, Security Mapping, Funding Name, Investment Grade, Fund Check | Mapping C:D, H:M, P:U, Y:AA, AC:AE, AH:AI |
| §5 Holdings | formula columns B–F recomputed; one position per row; amounts, dates, terms; exclusions | Holdings B–F, Calculations A–H |
| §6 Ratings | internal unless NR, else worst of Fitch / Moody's / S&P; score = MAX; IG if ≤ 610 | Calculations rating branch |
| §7 FX | amount ÷ rate (units per EUR); direction checked against the RC column; display currency; the one exception | Calculations CU:CX |
| §8 Hardcoded and ESG | per-asset fields and every source column, with cells | Hardcoded / ESG Hardcoded INDEX-MATCH |
| §9 Investor columns | asset × investor matrices; group attributed = Σ weight × column; third party = total − attributed | Calculations nominal / drawn matrices |
| §10 Views and Output | each view = Σ weight × investor column; Output rows = active assets with exposure in the view | Output!G8, Output rows 11–283 |
| §11 Metrics | exposure-weighted metrics and distributions | Output totals, Quarterly Reporting distributions |
| §12 Checks | the workbook's own formula columns against this file | — |

Two workbook behaviours are reproduced and flagged because they need a business decision. First, the IG label uses the weaker of the internal and external scores even when the internal grade is displayed. Second, an unrated position scores 0, which the workbook labels "IG". Scope shows it as NR instead.

On top of the calculation, the **analysis** layer (`js/analysis/`) flattens the results into one record per position (with every raw sheet column) for the Explorer and the global filters, and aggregates them with the pivot engine. Global filters are applied inside the calculation (`js/core/store.js` runs it twice: once to evaluate the filters on any field, once on the matching Holdings rows), so every page agrees.

## Project structure

```
index.html               page shell: loads core → workbook reader → AUM calculation → analysis → demo workbook → pages → app
start.bat / start.command / start.sh   launchers for Windows / macOS / Linux
js/inputs/
  workbook.js            reads .xlsx / .xlsm, CSV and pasted Excel ranges into cell grids (no business logic)
js/calc/
  aum.js                 ALL AUM calculations, one auditable file (§1 settings … §12 checks)
js/analysis/
  dataset.js             flat records and field registry over the results (every raw sheet column included)
  pivot.js               cross-tab aggregation, filters, Top N, % of total, export
  lookthrough.js         fund look-through to ultimate holders (register: §1 fundHolders)
js/core/
  store.js               the four sheets, settings, global filters, overrides, corrections, cached results
  filters.js             global filters and global search
  util.js, csv.js        numbers, dates (Excel YEARFRAC 30/360), formatting; CSV parse and serialise
  registry.js            business layers, page registry, hash router
  ui.js, grid.js         DOM helpers, cards, badges, tables, modals; virtualised spreadsheet grid
  charts.js, charts-extra.js, icons.js   SVG charts (bars, donut, map, treemap, heatmap, Pareto, ladder) and icons
js/modules/              one file per page; each registers itself with Scope.registerModule
js/app.js                app shell: data loading, sidebar, top bar, routing
css/                     scope.css (design tokens and layout), one stylesheet per page group, fonts.css
data/
  demo/                  the synthetic demo workbook: Scope-demo.xlsx and one CSV per sheet
  demo.js                the same four sheets embedded, so the app works when opened as a file
  world-map.js           country outlines for the map
  SCHEMA.md              the four input sheets
tools/
  serve.js               zero-dependency static server
  gen-demo.js            synthetic demo workbook generator
  xlsx-check.js          inspect a workbook from the command line
  diagnose.js            show how the AUM calculation reads a workbook: header rows, column roles, Mapping tables, checks, issues
tests/                   open tests/index.html, or run: node tests/run-node.js
```

## Extending the platform

Each coverage task gets **one calculation file** and one or more pages, so new layers can be added without touching existing ones.

1. Put the calculation in a new file under `js/calc/` (for example `js/calc/cashflows.js`): a pure function of the input sheets and/or the AUM result, with its settings at the top, the same shape as `js/calc/aum.js`. If it needs other sheets of the workbook, add their names to `Scope.store.SHEETS` and the reader picks them up by name.
2. Create the page in `js/modules/`:

```js
(function (global) {
  const Scope = global.Scope, UI = Scope.ui;
  Scope.registerModule({
    id: 'cashflows', layer: 1, order: 3, title: 'Cash flows & returns', status: 'built', icon: 'activity',
    // ctx.result is the AUM result for the selected view and currency, with global filters applied
    render(el, ctx) {
      el.appendChild(Scope.app.pageHead({ title: 'Cash flows' }));
      el.appendChild(UI.section({ title: 'Flows', body: UI.table({ rows: [], columns: [] }) }));
    },
  });
})(window);
```

3. Add its `<script>` tags to `index.html` (calculation after `js/calc/aum.js`, page after the other modules) and remove the matching entry from `js/modules/planned.js`.

Conventions that keep the numbers consistent: pages never compute totals themselves (calculation files do), every value can show its provenance badge, manual corrections go through `Scope.store.addAdjustment` so the audit trail is shared, and charts use `Scope.charts` so colours and tooltips match.

## Tests

```
node tests/run-node.js
```

The same tests run in the browser at `tests/index.html`. They cover the workbook reader (xlsx, CSV and pasted ranges), a workbook saved with live formulas (`tests/fixtures/formulas.xlsx`), the Scope Settings sheet (precedence, renaming, download round trip), the AUM calculation (table location, column roles, the workbook formula checks, an independent recomputation of total exposure from the raw Holdings grid, views, FX, ratings, exclusions, robustness to where sheets are pasted and to Excel number and date types), the pivot engine (including a 50,000-record performance check), fund look-through reconciliation and the concentration measures.

## Definitions still to be agreed

These are settings (the optional **Scope Settings** sheet in your workbook, defaults in §1 of `js/calc/aum.js`, and per-browser changes on **Data › Setup** and **Data › Columns**) or are listed on the relevant planned page, rather than decided silently in code.

| Definition | Where it lives today |
|---|---|
| Which Holdings column is nominal, drawn, commitment, currency, FX rate | §2 column roles, matched by output name; override on Data › Columns |
| FX direction | auto-checked against the RC column; override on Data › Views & investors |
| How each view in Mapping column H is composed | Scope Settings › Views (or §1 `views`); change per view on Data › Setup |
| Investor names, groups and attribution weights | Scope Settings › Investors (or §1 `investors`); change on Data › Setup |
| Who holds each fund's units (look-through) | Scope Settings › Look Through (or §1 `fundHolders`); the investors × funds grid on Data › Setup |
| The FX exception | Scope Settings › FX Exception (or §1 `fxOverrides`) |
| Rating convention and IG threshold | Mapping Investment Grade table; §1 `igThreshold` |
| Maturity buckets, display unit, spread unit, concentration thresholds | §1 |
| Returns and IRR, fees, NAV, cash-flow conventions, covenant definitions, valuation method, sector KPIs, watchlist criteria, report templates | not yet modelled; each planned page lists what must be supplied |

## Integrations

No live connection to source systems exists. The four input sheets are the integration boundary: an adapter that produces the same sheets (or passes the same cell grids to `Scope.store.setSheets`) is the intended connection point.

## Privacy

Everything runs locally in the browser. Scope makes no network requests other than reading its own files. Settings, saved views, filter sets and corrections are kept in the browser's local storage, and a loaded workbook in its IndexedDB, on that machine only.

## Third-party assets

See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for the icon set and world map licences, and for how to add a corporate typeface.
