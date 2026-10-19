# Scope: briefing for an AI coding assistant

Read this before changing anything. It tells you what Scope is, how it is built, where everything lives, how to test it, and which documents must change with the code. For a section-by-section map of "change X → edit these files, tests, rules and guide sections", open `docs/scope-editor-map.html`.

## 1. What Scope is

- Scope is a web app for an infrastructure-debt portfolio. It replaces an Excel AUM workbook and makes the investor PowerPoint decks.
- It reads the workbook's four input sheets: **Holdings**, **Mapping**, **Hardcoded** and **ESG Hardcoded**. It can also read an optional **Ownership** grid, or the older **Scope Settings** sheet.
- It works out every position, asset, view and figure the workbook works out, and shows them on pages: AUM overview, Explorer and pivot, investor and asset pages, Concentration, ESG, Data & validation, and the Calculations and Output sheets.
- It writes decks: the **investor report**, laid out like the house quarterly deck, and the **analysis pack**.
- **The Excel workbook is the reference.** Scope must give the numbers the workbook gives. Where Scope deliberately differs, the sign-off sheet and the guides say so.

## 2. Hard rules

1. **No dependencies and no build.**
   - Plain HTML, CSS and JavaScript.
   - Classic `<script>` files, loaded in the order set in `index.html`.
   - No npm packages, no ES modules, no bundler, no TypeScript, no Python in the app.
   - Node.js is only used for the test runner and tools.
2. **Every file is an IIFE that adds to the global `Scope` object.** For example: `Scope.calc.aum`, `Scope.report`, `Scope.pptx`, `Scope.inputs`, `Scope.tests`.
   - Match the surrounding code: its naming, its comment density, and short one-line helpers.
3. **Anonymity.**
   - Never write real deal, investor, client or firm names in code, tests, docs or commit messages.
   - Use placeholders: Investor 1…21, Fund 1…7, Region A, Group, Deal 01. The bundled demo data is synthetic.
4. **Keep the docs in step with the code** (section 7). A change is not finished until the tests pass and the sign-off check shows 0 changed.
5. **Make the smallest change that works.** Don't refactor or restyle unrelated code.
6. **Decks must stay fully editable PowerPoint:** native shapes, charts and tables, never pictures of slides.

## 3. Run and test

| What | Command |
|---|---|
| Serve the app | `node tools/serve.js 8130`, then open http://localhost:8130 (or just open `index.html`) |
| All tests | `node tests/run-node.js` (149 tests, all must pass) |
| Tests in a browser | open `tests/index.html` |
| Sign-off sheet | `node tools/gen-signoff.js` (writes `docs/production-signoff.html`) |
| Sign-off drift check | `node tools/gen-signoff.js --check` (must report `0 changed`)  (fails on a changed anchor, a weak one — short or found twice — or a test name gone; `--write` refreshes the line numbers in rules.json)|
| Demo data | `node tools/gen-demo.js` rebuilds `data/demo.js` and `data/demo/*.csv` |

## 4. How data moves

```
files (.xlsx / .csv / paste)
  → js/inputs/workbook.js   IN.readFiles / IN.readXlsx / IN.parseText → one grid per sheet (rows[r][c])
  → js/core/store.js        store.setSheets → sheets + Mapping rows added in the app + overrides + corrections → store.result()
  → js/calc/aum.js          AUM.run(input) → res (one result object, cached)
  → pages (js/modules/*.js) and decks (js/report/*.js) read res; nothing writes back into it
```

**`res`, the result object (from `AUM.run`):**
- `res.rows`: one **Output row per asset** held in the selected view, largest first. Each row carries:
  - `rank`, `code`, `code_name`, `name`, `transaction_group`, `asset_group`, `chronological_order`
  - `exposure_m`, `drawn_m`, `undrawn_m`
  - `sector` (Holdings) and `sector_holdings`, `subsector`, `country`
  - `currency`, `fixed_floating`, `margin_bps` (all-in spread), `wal_years`, `instrument`, `repayment_type`, `cash_flow_type`
  - `internal_grade`, `external_grade` (the worst agency), `rating`, `rating_numeric`, `ig_label`
  - `covenant_compliance`, `classification`, `funding_date`, `maturity_date`
  - `asset` (the full asset, including `asset.sheets.Hardcoded`)
- `res.positions`: one per Holdings row.
- `res.assets`: every asset across all views.
- `res.platforms`: the views. `res.platform` is the selected view, and `res.platform.composition` lists the investor columns and weights it is built from.
- `res.metrics` and `res.distributions`: totals, averages and breakdowns.
- `res.issues`: every error, warning and note.
- `res.inputs`: diagnostics, including the investors and their types.

**The engine, `js/calc/aum.js`,** holds all the workbook logic in one file:
- §1 `CONFIG`: the defaults.
- §1b and §1c: the settings sheets.
- §2 `ROLES` and `HEADER_HINTS`: where each input column is found. Row-2 output names are tried first, then row-3 headers, then patterns.
- §3: the readers.
- `AUM.run`: steps 1–16.
- §11: `AUM.summarise`.
- After that: report helpers (`sectorColumnFor`, `withSectorColumn`, `subsectorColumnOf`), exports (`outputRecords`, `positionRecords`) and settings grids.
- Inside `AUM.run`, find a step by the search strings listed in the editor map, for example `// Security Mapping (Q:U)`, `// §8 attributes` or `const rows = assets.filter`.

## 5. File map

| Area | Files |
|---|---|
| Boot and routing | `index.html`, `js/app.js` (App.init, render, shell), `js/core/registry.js` (routes, `Scope.registerModule`) |
| Core | `js/core/store.js` (state, IndexedDB, `result()`), `drive-vc.js` (version control on a shared folder, stand-alone), `shared.js` (what Scope shares, top-bar notice, merge dialog, check before a deck), `util.js`, `csv.js`, `ui.js`, `icons.js`, `grid.js` (big tables), `filters.js` (global filters, search), `charts.js`, `charts-extra.js` |
| Inputs | `js/inputs/workbook.js` (xlsx/CSV reader and writer, Excel number formats) |
| Calculation | `js/calc/aum.js` (everything the workbook computes) |
| Analysis | `js/analysis/dataset.js` (flat records), `pivot.js`, `lookthrough.js` (fund look-through), `sheets.js` (custom sheets), `workbook-layout.js` (Calculations / Output sheet columns), `tieout.js` (Check my data), `ask.js` (Ask Scope: questions in plain words → a pivot query) |
| Reports | `js/report/pptx.js` (PowerPoint writer, template reader), `house.js` (house colours, page kit), `investor.js` (investor report), `quarterly.js` (analysis pack), `widgets.js` (pack designer) |
| Pages | `js/modules/layer0-data.js` (Data & validation), `layer0-shared.js` (Shared folder: save, history, restore, tags), `layer1-*.js` (Ask Scope, AUM, Explorer, asset, investors, Calculations/Output), `layer2-*.js` (Concentration, ESG, Asset write-ups), `layer3-reporting.js` (Investor reporting), `layer3-designer.js`, `planned.js` |
| Data | `data/demo.js` (synthetic demo), `data/world-map.js` and `data/europe-map.js` (map outlines), `data/SCHEMA.md` (input contract) |
| Tests | `tests/*.tests.js` (`T.add(name, fn)`), `tests/run-node.js`, `tests/fixtures/` |
| Tools | `tools/serve.js`, `tools/gen-signoff.js`, `tools/gen-demo.js`, `tools/xlsx-check.js`, `tools/diagnose.js` |
| Docs | `docs/scope-step-by-step.md`, `docs/scope-at-a-glance.md`, `docs/how-scope-works.html`, `docs/scope-editor-map.html`, `docs/production-signoff.html` (generated from `docs/signoff/rules.json`), `README.md` |

## 6. The investor report (`js/report/investor.js`, `R.investor`)

**Slide order** (each block in the code starts with `// ---------- …`):
1. Cover.
2. 01 Market activity: two blank pages.
3. 02 Portfolio overview:
   - Key figures and four doughnuts (currency, bullet/amortizing, residual WAL, type of cashflows).
   - Sector and subsector rings with the Europe map.
   - AuM against the mandate, with the unfunded table and the groups doughnut.
4. 03 Portfolio metrics:
   - Spread bubbles by sector and spread band.
   - Group report pages (`R.INVESTOR_EXTRAS`, `R.extrasFor`): spreads by maturity, portfolio granularity, portfolio allocation (by `entities()`: composition columns, another view's whole-sum members merged under its name), ESG ratings (one row per deal), prepayment protection; ticked for the group view (`res.platform.isGroup`) unless changed per view (`reportInputs[view].extras`). The group view also gets its own key figures (WAL, QoQ tags, repaid by quarter) and AuM page (Unused Budget, % of total AUM, doughnut by entity). Long tables size their rows with `fitRows(K.contentBox(), …)` so they never run onto the footer.
   - Relative value against the public-market curves.
   - Blank cashflow and yield pages.
   - The asset and performance table, 30 rows a page.
5. 04 Pipeline: blank pages.
6. 05 Appendix: the monitoring write-ups.

**What drives the layout:**
- **Slice orders.** These follow the workbook's Quarterly Reporting sheet, as set in `ORDER` at the top of the file.
- **Two looks:**
  - The **house look**: Holdings sectors and subsectors.
  - The **client look**: used on a client's own views. It takes the client's sector column (`AUM.sectorColumnFor` / `withSectorColumn`), and its five sectors and subsectors (`OWN_SECTORS`, `OWN_SUBSECTORS`). The asset table then shows the client's own Classification column. `AUM.sectorColumnWhy` gives the reason shown on Investor reporting when a view keeps the house look.
- **Your template.** A user `.pptx` template with "x" boxes is filled in place (`P.readTemplate`, `P.slotRoles`, `fitSlot` in `pptx.js`). Without one, the built-in house pages from `house.js` are used.

## 6b. The shared folder (`js/core/drive-vc.js`, `js/core/shared.js`)

- **Optional:** a team keeps one copy of the data in a shared folder (Edge or Chrome, File System Access API). Each save is a version; there is no server and no git.
- **`drive-vc.js` is a stand-alone library.** It holds no Scope code and must stay identical to the stand-alone library's `drive-vc.js` (its own repository; the release build publishes it as `drive-vc/` in the public copy). Change the library first, then copy the file over.
- **The API:** `DriveVC.open({ store, getState, setState, … })` returns a repository with these methods:
  - `connect`, `init`, `load`
  - `save(note)`, `refresh`, `resolve`
  - `history`, `changesIn`, `compare`
  - `preview`, `endPreview`, `restore`, `tag`
- **`shared.js` decides what is shared.**
  - `SHARED_SETTINGS` lists the shared settings. `stateOf()` builds the shared object; `applyState()` puts a version back into the store.
  - Anything personal stays out: view, currency, filters, name, layouts.
  - Sheets go by reference and must never be edited in place: replace them.
- **Adding something that should be shared:**
  1. Add it to `stateOf` and `applyState`.
  2. Give it words in `describe`.
  3. Add a case to `tests/shared.tests.js` and a `SHR` rule.
- **Merging:** it is three-way, per path. Arrays whose items all carry an `id` merge item by item, so give new list items an `id`.

## 6c. Ask Scope (`js/analysis/ask.js`, `js/modules/layer1-ask.js`)

- **No model, no server.** A question is read in the browser with the names found in the loaded data (`vocab(res)`) and fixed word lists: `REWRITE`, `MEASURES`, `GROUPS`, `DEFINE` (terms), `HELP` (topics → page). Never add a call to an online model or API; the data must not leave the browser.
- **The answer is the Explorer's.** `ASK.parse` turns a question into `{ intent, measure, filters, having, groupBy, top }`. Filters use the dataset's `{ field, op, value }` shape. `ASK.run` answers from `Scope.pivot` over `Scope.engine.dataset` records. Do not add sums of its own.
- **Thresholds are per asset.** A `having` (for example over 100m) is tested on each asset's positions; it travels to the Explorer and page filters as the list of assets it kept.
- **Teaching it a new word:**
  1. Add the word to the matching list: a figure to `MEASURES`, a grouping to `GROUPS`, a synonym to `REWRITE`, a page to `HELP`.
  2. Add a case to `tests/ask.tests.js` and an `ASK` rule.
  3. Never put a real deal, investor or firm name in these lists: names come from the data.

## 7. Docs that must change with the code

| When you change… | Also update |
|---|---|
| Any logic | the rules in `docs/signoff/rules.json` that describe it. Each rule has `id`, `area`, `title`, `rule`, `example`, `file`, `line`, `code` (a line of code it quotes), `tests`, `origin` and `confirm`. Then run `node tools/gen-signoff.js` and `--check` (0 changed). Keep the file format: `JSON.stringify(list, null, 1)` with leading spaces stripped. |
| What the user sees, or a step | `docs/scope-step-by-step.md` (the numbered section; keep its 165 `###` sub-steps), `docs/scope-at-a-glance.md`, and `README.md` if visible in the app |
| A mechanism | the section of `docs/how-scope-works.html` and of `docs/scope-editor-map.html` |
| Tests | the rule's `tests` list, if a test name changes |

**Rule ID prefixes:**
- `IN`: inputs and settings.
- `POS`: positions, FX and ratings.
- `CALC`: assets, views, Output rows and metrics.
- `VIEW`: pages.
- `RPT`: decks and templates.
- `WU`: write-ups and market curves.
- `CHK`: Check my data.
- `SHR`: the shared folder.
- `ASK`: Ask Scope.

## 8. Checklist for a change

1. Find the section in `docs/scope-editor-map.html` and read the code it names.
2. Make the smallest change, in the style of the file.
3. Add or adjust a test in the named `tests/*.tests.js`. Run `node tests/run-node.js`.
4. Update the sign-off rules, then run `node tools/gen-signoff.js` and `--check`.
5. Update the guides and the explainer or editor map sections.
6. Check it in the app (`node tools/serve.js 8130`): the page, or the downloaded deck.
7. No real names anywhere.
