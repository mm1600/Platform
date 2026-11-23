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
| Core | `js/core/store.js` (state, IndexedDB, `result()`), `drive-vc.js` (version control on a shared folder, stand-alone), `shared.js` (what Scope shares, merge dialog; the team data is one file, `Scope team.json`, in a team folder Scope only reads: `SH.connect` (read-only pick), `SH.pull` (every 20 s; a newer save is only flagged, `SH.refresh` = Get it), `SH.save` / `SH.publish` (write into the folder where allowed, else a download), `SH.openTeamFile` (file box where folders are blocked); drive-vc runs on `DriveVC.memory()` holding the file's entries), `source.js` (the data folder's periods and the Holdings folder's months, read as a file drop; watches the loaded period's files and offers Refresh in the top bar), `util.js`, `csv.js`, `ui.js`, `icons.js`, `grid.js` (big tables), `filters.js` (global filters, search), `charts.js`, `charts-extra.js` |
| Inputs | `js/inputs/workbook.js` (xlsx/CSV reader and writer, Excel number formats) |
| Calculation | `js/calc/aum.js` (everything the workbook computes) |
| Analysis | `js/analysis/dataset.js` (flat records), `pivot.js`, `lookthrough.js` (fund look-through), `sheets.js` (custom sheets), `workbook-layout.js` (Calculations / Output sheet columns), `tieout.js` (Check my data), `ask.js` (Ask Scope: questions in plain words → a pivot query; one asset's details, yes / no, spelling, what changed against `ctx.previous` (the page reads the month before only when `ASK.needsPrevious(query)`), and the digest; our own phrase lists SAYINGS (rewrites) and LIKE (known questions with other ways of asking, matched by `nearest()` when a question is not read or read loosely)), `compare.js` (two periods side by side: figures, breakdown, asset movements), `grouping.js` (a transaction group as one line: `Scope.grouping.apply(res)` gives a result with merged rows whose `_members` AUM.summarise still reads, so no total changes; `on(pageId)` / `set` are the page and master switches; `app.js` hands grouped results to the pages in `PAGES`, the dataset relabels positions to their group) |
| Reports | `js/report/pptx.js` (PowerPoint writer, template reader), `house.js` (house colours, page kit), `investor.js` (investor report), `quarterly.js` (analysis pack), `widgets.js` (pack designer) |
| Pages | `js/modules/layer0-data.js` (Data & validation), `layer0-shared.js` (Shared folder: save, history, restore, tags), `layer1-*.js` (Ask Scope, AUM, Explorer, asset, investors, Calculations/Output), `layer2-*.js` (Concentration, ESG, Asset write-ups), `layer3-reporting.js` (Investor reporting), `layer3-designer.js`, `planned.js` |
| Data | `data/demo.js` (synthetic demo), `data/world-map.js` and `data/europe-map.js` (map outlines), `data/SCHEMA.md` (input contract) |
| Tests | `tests/*.tests.js` (`T.add(name, fn)`), `tests/run-node.js`, `tests/fixtures/` |
| Tools | `tools/serve.js` (also `/source/periods` and `/source/file`), `tools/data-folder.js` (the data folder in `scope.config.json`), `tools/gen-signoff.js`, `tools/gen-demo.js`, `tools/embed-icon.js` (copies `launcher/Scope.ico` into both shortcut scripts, which write it on each PC so the shortcut never takes its icon from the share), `tools/xlsx-check.js`, `tools/diagnose.js` |
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
   - The asset and performance table, 9 pt, up to 30 rows a page, "(1/2)" on more than one page.
5. 04 Pipeline: blank pages.
6. 05 Appendix: the monitoring write-ups (grey F2F2F2 box, 9 pt, blue 027180 bullets and impact line).
7. The template's closing pages (its slides after the third: the disclaimers), copied unchanged (`K.closing()`).

**What drives the layout:**
- **Slice orders.** These follow the workbook's Quarterly Reporting sheet, as set in `ORDER` at the top of the file.
- **Two looks:**
  - The **house look**: Holdings sectors and subsectors.
  - The **client look**: used on a client's own views. It takes the client's sector column (`AUM.sectorColumnFor` / `withSectorColumn`), and its five sectors and subsectors (`OWN_SECTORS`, `OWN_SUBSECTORS`). The asset table then shows the client's own Classification column. `AUM.sectorColumnWhy` gives the reason shown on Investor reporting when a view keeps the house look.
- **Your template.** A user `.pptx` template with "x" boxes is filled in place (`P.readTemplate`, `P.slotRoles`, `fitSlot` in `pptx.js`). Without one, the built-in house pages from `house.js` are used. `readTemplate` also gives each page its footer rule (`footRule`) and each slot its text anchor, colour and free room (`anchor`, `color`, `above`, `below`); slides after the third are `tpl.closing`, and each page its footer shapes (`foot`: tagline, logo, page number). A section break with no lines box gets the lines as paragraphs in its title box (`value.after` in `fillSlot`, set by `K.section`); footnotes (`op.notes`) and the source line are one 8 pt 929289 block just under the footer rule, clear of the footer shapes (`notesSpot` in `house.js`); the cover name wraps instead of shrinking (`fitSlot`, role `name`).
- **Names and wording.** `coverName` is the cover's full name; `compartment` (the "Name in the page headers") goes in every kicker and "… Guidelines" (`hdr`). Every content page has a key (`page(…, { key })`) and every section `section:NN`: `inputs.wording[key]` (typed on Investor reporting, "Wording on the slides") replaces Scope's kicker/title or a section's title/lines, with `{name}`, `{cover}`, `{month}`, `{year}`, `{quarter}` filled in. The outline entries carry the defaults the page shows greyed.
- **Doughnut labels.** In the ring, largest slices first; a label that would overlap one already placed is tried smaller, nearer the ring's edges and narrower (`placeAt`), and only then goes outside; outside stacks stay within `op.top`/`op.bottom` (`donut`). The AuM pies take the run Accent 2, Accent 1, Accent 4, Text 2, Background 2 (`pieColours`); overview and AuM doughnuts have `border: 'none'`.
- **Tables.** `fitColumns` sizes columns to their longest text (else word); `packRows` counts wrapped lines word by word; the asset table is 9 pt, banded D9D9D9, external rating first (`tableRating`, Moody's on the S&P scale). Shared rules are written on both cells (`cellXml` in pptx.js).
- **More inputs.** `inputs.rvHide` (tranche names left off the relative value charts; `R.rvDeals` lists them for the page); write-ups carry `codes` (`writeupsForView`), the monitoring Ref = their asset-table rows; `tpl.bodyFace` / `style.bodyFont` = the house body font (`K.bodyFont`); new commitments = instruments closed in the reporting quarter (5th key figure).

## 6b. The shared folder (`js/core/drive-vc.js`, `js/core/shared.js`)

- **Optional:** a team keeps one copy of the data as one file, `Scope team.json`, in a team folder Scope only reads (Edge or Chrome; a file box where folders are blocked). drive-vc runs on `DriveVC.memory()` holding the file's entries; `SH.pull` reads the file every 20 s and only flags a newer save (`SH.refresh` = Get it); `SH.save` → `SH.publish` re-reads the file just before writing (a save made in that instant is merged, then written) and falls back to a download when the PC refuses writing. Every save is kept; there is no server and no git.
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

## 6d. Data folder and period comparison (`js/core/source.js`, `js/core/period-names.js`, `tools/data-folder.js`, `js/analysis/compare.js`)

- **Optional, beside the drop, two ways in.** (1) Picked in the browser: `Scope.source.choose()` (File System Access API; the handle is kept in IndexedDB `scope-source`, `reconnect()` asks again for read leave, `forget()`; a folder upload input elsewhere, session only). Works under `file://`. (2) `scope.config.json` (never served, never published) when served: `tools/serve.js` lists the periods (`/source/periods`) and sends one file (`/source/file`); it wins over a picked folder. Both use `js/core/period-names.js` for which folders are periods and their order.
- **A period loads as a drop.** `Scope.source.read(id)` fetches the files and runs `Scope.inputs.readFiles`; the Data page passes the result to the same `applyRead` as dropped files.
- **Layout.** The shared setting `dataLayout` (null, or `{ mode: 'split', sheets: { Holdings: { folder } | { folder, file }, Mapping/Hardcoded/ESG Hardcoded/Ownership: { folder, file } } }`) is applied by `derive()` in `source.js`: `raw` keeps the folders as found (`Scope.source.folders()`), the listing's periods become one per Holdings file (`split: true`, `label`, `files` each with `folder` and `sheet`), and `readSplit` reads each file once, taking only its chosen sheet (a CSV is renamed to its sheet so the name rule does not apply). `guessLayout()` suggests one from the names; the picker is `layoutPicker` on the Data page. Sources from a split read carry `whole: false`, so the watcher compares only the files read.
- **Change notice.** Each source read from a period carries `period` and `files` (name, size, modified when read). `Scope.source.watch()` (started in `js/app.js`) compares them with the folder every 20 s, on focus and when the loaded periods change; `renderNotice` draws the top-bar row, `refresh()` re-reads the period and hands only that period's sheets to `Scope.source.onApply` (set by the Data page to `applyRead`), `dismiss()` hides it until the files change again.
- **Holdings folder.** `Scope.source.holdings` (`list(force)`, `cached()`, `latest()`, `choose()`, `reconnect()`, `forget()`, `useFiles()`; handle kept in IndexedDB `scope-source` under `holdings`): every input file directly in the folder is one month, id `h:<file name>`, ordered by `hOrder` (the date in the name via `period-names.js`, else the save time). `Scope.source.read('h:…')` takes only the Holdings sheet (`hRead`); its source carries `whole: false` and files with the folder token `Scope.source.holdings.FOLDER`, so the watcher compares only that file. The Data page shows it as `holdingsBox` beside the file box (`loadBoxes`); the data folder sits folded under them.
- **More than two periods.** The AUM overview keeps `cmp.more` (extra pickers, saved in `localStorage` `scope.compare`) and uses `Scope.compare.figuresN / breakdownN / assetsN` (one value per period, earliest first; change and status first → last; status `between` for an asset held only in a middle period). `figures / breakdown / assets` (two periods) stay for the tests and other callers.
- **Corrections by month.** A `positions` correction carries `months` (and `skip`): `store.activeAdjustments()` applies it only when the loaded Holdings month (`store.holdingsMonth()`, from the result's reporting date, found in `baseResult`, which runs once more when the month changes) is in `months`; `pendingAdjustments()` / `decideAdjustments(ids, keep)` handle a new month; `removeAdjustments(ids)` takes a field back to the file value. `Scope.corrections` (in `layer0-data.js`) builds the rows and the CSV; `SH.writeCorrections()` writes `corrections.csv` in the shared folder after a save.
- **The comparison never recalculates by hand.** `store.resultFor(sheets, sources, tag)` runs the calculation for the other period (same view, currency, filters; no app edits or corrections); `Scope.compare` only lines the two results up. Tests: `tests/compare.tests.js`; rules: `DF-*`.

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
