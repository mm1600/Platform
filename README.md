# Scope

**An infrastructure-debt portfolio platform that runs in any web browser.**

Scope replaces a spreadsheet-based AUM workbook with a connected, auditable web tool. It reads the same four input sheets as the workbook (Holdings, Mapping, Hardcoded, ESG Hardcoded: drop the workbook or paste the sheets), reproduces its calculations, and lets a portfolio manager slice the book any way they need: by asset, investor, platform, sector, country, rating, maturity, currency, ESG and more, with every figure traceable back to the line of input that produced it.

It is plain HTML, CSS and JavaScript. There is nothing to install, no build step and no package manager. It works offline.

> **All bundled data is synthetic.** The demo investors, assets, amounts and thresholds are generated for illustration. None of them are real, and the dataset badge in the top bar says so.
>
> **Names are placeholders.** The demo and this documentation use *Investor 1 … Investor 20*, *Fund 1 … Fund 7*, *Region A* (a composite of two investors), *Group* (the attributed group) and *Investor 21* (a client named in some Hardcoded column headers). Nothing in the code names an investor, client or fund: your workbook's own names come from Mapping › Funding Name (column Z) and are used as they are, and you can rename any of them on Data › Setup.

---

## Quick start

**Get it:** on the repository page click **Code → Download ZIP**, unzip it anywhere, and you are ready. Then pick whichever suits the machine. Every option runs the same app.

| Option | How | Notes |
|---|---|---|
| **Open the file** | Double-click `index.html` | Works on any computer with a modern browser (Chrome, Edge, Firefox, Safari). Uses the embedded demo data. |
| **Windows launcher** | Double-click `start.bat` | Uses Node.js if installed (serves on http://localhost:8130), otherwise opens `index.html`. |
| **Windows app (icon + taskbar)** | Double-click `Create Scope shortcut.bat` once | Adds a **Scope** shortcut (green S icon) to the desktop and Start menu; right-click it → **Pin to taskbar**. Opens Scope in its own Edge window, straight from the folder (e.g. a shared drive), so replacing the files updates everyone. Steps by hand in `launcher/README.txt`. |
| **macOS launcher** | Double-click `start.command` | Same behaviour. If macOS blocks it the first time, right-click → Open. |
| **Linux / terminal** | `./start.sh` (optional port: `./start.sh 9000`) | Same behaviour. |
| **Any static server** | `node tools/serve.js 8130`, or serve the folder with any web server | Same app; the demo always comes from `data/demo.js` (the CSVs in `data/demo/` are reference copies for the tools and tests). |

Node.js (version 16 or later) is only needed for the optional local server, the test runner and the demo-data generator. The app itself needs nothing but a browser.

**How it works, in full:** open [`docs/how-scope-works.html`](docs/how-scope-works.html) in a browser. One page, nothing skipped: every sheet, column, lookup, formula, view, check and page, from the raw workbook up, with the demo's own numbers. Its exact companion, [`docs/how-scope-works-exact.html`](docs/how-scope-works-exact.html), goes header by header and field by field: every column role and the names it tries, every field of a position, an asset and an Output row with its formula, every Calculations and Output column, metric, check, setting and message, generated from the code.

---

## What it does

### Navigation

The sidebar follows the six business layers of the platform, from pipeline to reporting. Pages that exist today are marked built or partial. Planned pages are already in place, each describing what it will do, which inputs it needs and which business definitions must be agreed first, so the whole platform can be navigated from day one.

| Layer | Page | Status |
|---|---|---|
| −2 Pipeline | Pipeline & origination | planned |
| −1 Execution | Execution & handover, Pre-trade guideline test | planned |
| 0 Source data | **Data & validation** | built |
| 1 AUM | **AUM overview**, **Calculations sheet**, **Output sheet**, **Explorer**, **Investor book**, investor pages, asset pages | built |
| 1 AUM | Cash flows & returns | planned |
| 2 Monitoring | **Concentration & risk** | built |
| 2 Monitoring | **Asset write-ups** | built |
| 2 Monitoring | **ESG** | partial |
| 2 Monitoring | Borrower reporting, Covenants, KPIs, Watchlist, Valuations, Comparables | planned |
| 3 Outputs | Investor reporting (investor report on your template, analysis pack), Pack designer (drag-and-drop custom packs) | built |
| 3 Outputs | Post-trade guidelines, Custom views | planned |

### The top bar: view, currency, search and filters

- **View** lists the choices in Mapping column H (Views: portfolios / investors), exactly like the selector cell in the workbook's Output sheet. A view is either an investor column or a row of the Ownership grid (the Group, an investor's "incl. part in funds", a region).
- **Asset** and **Name** (next to View) narrow every page, export and deck to some assets, by code name (Mapping › Code Name). Asset lists them grouped as Mapping › Transaction Group groups them ("Asset A" and "Asset A top-up" are one "Asset A"; an asset with no group is listed by its code name; a group named by a code shows the words its members' code names start with). Name then lists the code names inside the groups picked. Each opens a checklist: All, None or ticks. Both are ordinary global filters, so they show in the filter row too.
- **Look-through** (next to View) lists the investors in the selected view and, under each, its segments: the rows of Mapping › Funding Name (fund name, with its code). Pick one and every page, export and the PowerPoint deck narrow to it, with the view's percentages still applied. "All of …" goes back to the whole view; changing the view resets it.
- **Currency** converts every amount for display, using the FX rates found in Holdings.
- **Search** (press `/` anywhere) finds assets, investors, sponsors, security IDs, sectors, countries, ratings and pages. Choosing a value such as a country applies it as a filter. Choosing an asset or investor opens its page.
- **Filters** apply to every page at once. Add as many as you like and they combine: for example *fixed rate*, then *Germany or the Netherlands*, then *investment grade*, then *maturing after 2030*. Any field can be filtered, including every raw column of the four sheets (e.g. a covenant status in Holdings or a jurisdiction tier in Hardcoded) and numeric ranges on any amount or ratio. The value picker shows only values still available under the other filters, with position counts and exposure, like Excel's AutoFilter. Filter sets can be saved and reloaded. Every KPI, chart, table and export on every page reflects the same filtered book.

### AUM overview

The interactive version of the workbook's Output sheet: headline KPIs (exposure, drawn, undrawn, group share of book, weighted rating, spread, WAL, fixed-rate share, watchlist share), charts by sector, country, rating, maturity, fixed / floating and currency, a two-level breakdown table by any pair of dimensions, and a full asset grid with every Output column and one column per investor (the investors in the assets on show are shown; the others sit in the column chooser). Fixed / floating and currency are summed position by position, as the workbook does, so an asset with a fixed and a floating tranche, or a EUR and a GBP one, is split between them; the Rate Type values of the extract are read whatever the spelling (FIXED, Fixed rate, FRN, Variable, Euribor …) and listed under the chart. The sector everywhere in the app is the Holdings one (Holdings › Sector, the Underlying Asset Type), as the Output names it. Clicking any chart bar filters the page. Output and position data export to CSV.

### Calculations sheet and Output sheet

The workbook, as the app computes it, so every figure can be followed and checked.

- **Calculations sheet.** One row per Holdings row with the workbook's columns: the keys (Portfolio ID, Holdings ID, Backend identifier, Identifier ID, Mandate…), the Holdings lookups, the FX block (the rate used and the converted amounts), the ratings branch, every Hardcoded and ESG field, and geography. Every column is headed by its workbook letters and formula, written with names. A second tab holds the per-asset split (Calculations DB:GK): the SUMIF by investor column, the attributed group (SUMPRODUCT with the ownership row) and every view, for nominal and drawn. Both download as .xlsx with the formula row included.
- **Output sheet.** The assets with exposure in the selected view, with the Output sheet's columns in the workbook's order and names: selection exposure, the asset fields, one column per investor column, the attributed group, the "incl. part in funds" views, the drawn block, terms, ratings, covenants and classifications. Columns the Holdings sheet does not carry are listed and left blank. Downloads as Output.xlsx.

Values on these pages are read, not typed: the parameters (IG threshold, FX rule, reference investor, SINGLE token) are changed on **Data › Formulas**, the ownership and the "incl. part in funds" formulas on **Data › Setup**.

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
- **Look-through.** Fund investor columns are traced to whoever holds their units, so an investor sees its direct exposure, its share of each fund's assets, and the total. This comes straight from the workbook's own "*<investor> incl. part in funds*" formulas: such a view is the investor's own column plus a coefficient on each fund it holds units of, and that coefficient is its share of the fund. Ultimate holders plus holders outside the platform always reconcile to the platform total, with no double counting, and the group entities' listed shares are checked against each fund's ownership.

### Asset pages

Every asset shows its positions by investor, deal attributes, credit terms, ratings, ESG data, how it rolls into each platform, and a step-by-step calculation trace. Every value carries a provenance badge (imported, manual or calculated), and any input can be corrected with a recorded reason. The original value is always kept.

### Custom sheets: your own output sheet

**Custom sheets** (Layer 1) builds an output sheet of your own: tick any columns, every named field of the Explorer and every raw column of the Holdings, Hardcoded and ESG sheets, put them in order, type your own heading for each, and download the sheet as .xlsx or CSV for the selected view, currency and filters. One row per asset (the Output rows) or one per position (the Holdings rows, excluded ones on request). Save a set under a name, export it as a small .json to share, start from the standard Output columns, a credit view or a positions sheet. The preview is exactly what the file holds.

### Investor reporting: the investor report on your own template

**Investor reporting** builds the quarterly investor report for the selected view and currency as a PowerPoint deck. Pick the view (any investor column, "incl. part in funds" view, Region A, Group, Total platform) and click **Download investor report**. Everything in the deck is native and editable: text boxes, tables and charts, and each chart's **Edit Data** opens the numbers behind it. The older analysis pack (key figures, sector and country, credit quality, maturity, top 10, changes, watchlist, asset list, notes) is still one click away: **Analysis pack**.

The report, section by section:

| Section | Slides | Built from |
|---|---|---|
| Cover | investor name, "Reporting as of" date | Report inputs (name on the cover), the reporting date |
| 01 Market activity | two "Current market activity" pages | left blank for the market commentary and charts |
| 02 Portfolio overview | key figures (under management, repaid, average all-in spread, brownfield, instruments, floating, average rating, sub-IG, new commitments in the quarter, each with its change on the quarter) and four doughnuts (currency, bullet / amortising, residual WAL, type of cashflows) · sectors (Holdings sectors inside, subsectors outside) and jurisdictions (a map of Europe drawn from Natural Earth's 1:50m outlines, the invested countries shaded by size with their share where it fits best, the amounts listed) · assets under management against the mandate (funded, unfunded, left to deploy; unfunded and partly funded transactions; one slice per transaction) | the view's Output rows; the mandate size and the amount repaid this year from Report inputs; quarter-on-quarter from the previous Holdings |
| 03 Portfolio metrics | spreads across sectors (bubble per sector of the report and spread band, size = volume, PowerPoint's own bubble size, one theme accent per sector in order, a small bubble's amount beside it) · relative value: each deal as an x at its close date and all-in spread against the public-market curves, BBB and BB charts, each label placed beside its marker where it clears the others, a tick a quarter · cashflow and yield projections (left blank) · asset and performance table (30 a page: country, currency, sector, nominal, format, fixed / floating, residual WAL, spread, covenant compliance, rating with internal ratings in bold blue, rating change, the classification column) | Holdings (Financial Close, All-in spread, Format, Current WAL), Hardcoded (Chronological Order, Compliance, the "… Classification" column); the curves from Market data |
| 04 Pipeline | transaction pipeline and guidelines | left blank (the pipeline will come from the Pipeline pages) |
| 05 Appendix | portfolio monitoring, one page per asset write-up, laid out like the house deck's: a header bar in the theme's dark green (Ref., Name, Description and recent events) over a pale mint box; the name in bold, the ratios in white boxes under Actual, Lock-up and Covenant with the rating under them (one rating across the three); the description in bold, then the recent events as small dark ► bullets, justified, an "… impact" line in bold; a long write-up carries on over the next page; the title counts pages | the write-ups of the assets the view holds (Asset write-ups page) |

**Your own template.** Load a `.pptx` with three slides taken from your corporate deck: slide 1 the cover, slide 2 a section break, slide 3 an ordinary content page. In each, type **x** in the boxes Scope should fill and keep everything else (pictures, logo, bands, footer, page-number field). Any case and quotes are fine ("“X”"), an x inside a group of shapes is found, and an x inside a short line keeps the line: "REPORTING AS OF “X”" becomes "REPORTING AS OF 30 SEPTEMBER 2026". Scope draws nothing over the cover and the section breaks: a box without an x stays as the template has it, and the page warns which ones it did not find. Scope fills them by their place: on the cover the name then the date line; on the section break by font size, largest first: the number, the title, the lines under it (a placeholder's type says nothing there; top to bottom when a size is unknown); on the content page the small header line and the page title at the top, and the source line if there is an x at the bottom. A box in a title placeholder is always the title. Page titles are set in the template theme's heading font (as PowerPoint sets titles), or the one typed under Your style › Title font. A filled box is made to hold its text without running into its neighbours: a one-line box (a title, a number) whose text would wrap is shrunk to one line, and text taller than its box (the lines under a section title) starts at the box's top and grows downward, shrinking only if it would reach the footer. Type `{name}`, `{date}`, `{number}`, `{title}`, `{subtitle}`, `{kicker}` or `{source}` instead of x to say it outright. Each generated slide is a copy of its template slide with the boxes filled and the exhibits placed in the free area between the title and the footer; the template's own layouts, master, theme, fonts and images come with it, so nothing about your branding is written by Scope. With no style of your own, the charts, tables and headings take the template's theme colours, each part a fixed slot and shade of the theme as PowerPoint's colour picker lists them (main colour, then its five shades). In a theme whose Background 2 and Text 2 are colours: header bars, table headers, banners, headings and the first series Background 2 (the main colour, as the house deck applies it), the bright series Text 2, the doughnuts' second colour Accent 2, neutral series Accent 3, the accent Accent 5 lighter 40 %, internal ratings Accent 4, grey for countries with no exposure Text 1 lighter 75 %; sector rings take a fixed run of slots and shades and each sector's subsectors the other shades of its colour; the map runs dark to light through Background 2 and Accent 2. In any other theme, Accent 1 leads. Asset names in the report are code names (Mapping › Code Name), as the house's own decks print them. The page lists what it found on each slide. The template stays in your browser (IndexedDB) and is never sent anywhere.

**Report inputs** (per view, kept in your browser): the name on the cover, the compartment or mandate name, the mandate size, the amount repaid this year (blank = the fall in drawn since the previous Holdings) and one source line for every slide (`{date}` = the reporting date). **Market data**: paste a date column and one or two index columns in bps (or load an .xlsx / .csv); the first becomes the BBB chart's curve, the second the BB chart's. **Sectors in the reports** (per view): the Holdings sector, as the Output, or an investor's own "… Sector Classification" column from Hardcoded (for that investor's reports); a view picks such a column by itself when its name, its cover name, one of its investors (name, Holdings name, fund name, group) or the Holdings portfolio names of its positions name that investor, or when that column alone is filled for every asset the view holds but not for most of the book (an investor's own classification, kept for its mandates); otherwise pick it once per view and Scope remembers it. **Portfolio monitoring**: the write-ups come from the Asset write-ups page.

**Asset write-ups** (Layer 2): load your write-ups workbook, one box per asset laid out like the monitoring slide's table: the asset's name next to the words Actual, Lock-up and Covenant (that row marks the box; a name in a merged cell above it works too), then a row per ratio with its name in the name's column or the next and its values under them, then a Rating row that closes the box (the rating under any of the three columns); right of Covenant, the description (a short first line) and the recent events (one cell with a line each, or a cell a row; leading dashes and bullets dropped). A ref column (3/30) is optional: left blank, the report numbers the boxes. One row per asset (Ref, Name, Description, Recent events) is read too. Every sheet is read, so one box per sheet works too. Each write-up's name is matched word by word against every name an asset goes by: its name, code name, ID, transaction group and asset group, every Mapping row of its securities, and every name column of its Hardcoded, ESG Hardcoded and Holdings rows (security name, issuer, deal …). Case, spacing, punctuation, legal forms (Ltd, Holdings, BidCo …), plurals and roman numerals do not matter; tranche numbers must agree when both names have one ("Asset 2" is not "Asset 3"; "Asset" finds "Asset 1" and "Asset 2" and links their asset group); a word that only names a kind of asset (Airport, Wind, Fibre …) never matches alone. Values show exactly as the workbook shows them: the number formats are read (6.62x, 565, 70%, EUR 668, n/a), nothing is added. The rating is read once per box, from its Rating row (or the row right under it, or any row of the box that holds nothing but a rating, whatever its name) and never from another box; on the slide the word Rating always sits under the ratio names and the rating under the middle of the three columns, never as a ratio row. The page shows each link and the name that made it (or the closest name when nothing is sure), lets you set one by hand, and shows each write-up as its slide will look. **Blank template (.xlsx)** gives a workbook in the same layout with one box per asset of the view. The linked write-up shows on the asset's page; a view's report carries the write-ups of the assets it holds (those linked to nothing go in every report, or none, as you choose). The workbook stays in your browser (IndexedDB).

Written by `js/report/pptx.js` (a small PowerPoint writer, no libraries: text, tables, freeforms, bar, doughnut, scatter and bubble charts with their data embedded, and the template reader), `js/report/house.js` (the page kit: cover, section break, content page, tiles, tables) and `js/report/investor.js` (the report and its two input readers); the analysis pack is `js/report/quarterly.js`.

**Your own style.** On the reporting page, **Your style** sets the colours of the pack and of the designer's decks (headings and table headers, second and accent colours, text, rules, banding) and the font. With a template loaded and no style set, the template's theme colours are used; one click copies them here to adjust; **House look** restores the default (the house theme applied as the house deck applies it: the main colours for header bars, bands, headings and charts, dark green, green, teal, mint, blue-grey, dark blue, red, orange; picker shades only for tints and greys); export and import as a small .json. Like the template, it stays in your browser. The app's own screens use the same theme colours (sidebar, buttons, charts); its tokens sit at the top of `css/scope.css` (`--brand-*`); for the pack's defaults, at the top of `js/report/house.js`.

**Design your own pack.** The **Pack designer** page (#/designer) is a mock-up of the page with a palette of blocks: KPI tiles (any figure of the view), charts and breakdown tables by any dimension, asset tables with the columns you choose, one asset's card with the details you choose, the investor columns, the group split, the changes since the previous Holdings, your own text and the notes page. Drag a block onto the page, move it, resize it from the corner; blocks snap to a 24 × 12 grid and show the real figures as you work. Add, reorder and name pages; mark one as the cover. Save layouts under a name in this browser, export them as a small .json file to share, start from the standard pack. Download writes the same blocks to a native deck in the house look, on your template when one is kept.


### Data & validation

Load the four sheets (drop the workbook, drop CSVs, or paste from Excel) and see exactly how they were read: the header row found in each sheet, which column feeds each input (with an override per input), where each of the six Mapping tables was found, the FX direction check, and the **workbook checks**: the workbook's own formula columns (Holdings B–E and row 2, Hardcoded D–E) recomputed and compared cell by cell. On the demo every check matches 100%. The Setup tab walks through five steps:

1. **Load** the workbook. Month after month, drop just the new Holdings sheet: Mapping, Hardcoded, ESG Hardcoded, the rows you added and every setting stay, and the previous Holdings is kept for one step of undo. *Download working workbook* gives you the file as it now stands.
2. **Columns**: every input resolved to a column by name.
3. **Mapping gaps**: a Security ID that is not in Security Mapping, an investor code that is not in Funding Name, or an asset outside Active Assets is listed once, with what is needed to close it. *Add* appends the row to the Mapping table there and then; the calculation, every page and the downloaded workbook see it like any other row. Nothing is written to your original file.
4. **Ownership and views**: the Ownership grid, editable in place. Names down the first column and the same names across the top; each cell is the share the row owns of the column (`1`, `0.35`, `35%` or `7/20`; blank = 0). The group's row gives the Group view (Σ ownership × column); a row named after an investor column with other cells filled gives "*name* incl. part in funds" (its own column plus its share of each fund, which is also the look-through), but only when the workbook's view list (Mapping column H) names that view, so a stray cell never invents one; a grid filled the other way round (the group's shares down the Group column) is recognised and read transposed, and "Group" or the platform total can never be a term of a view; any other row is a view of its own name. **Add name** adds a row and a column; **Download Ownership** gives the grid as a sheet to keep with the workbook. The grid only defines views: the four sheets are never changed.
5. **Checks**.

A **Formulas** tab shows every calculation as implemented, step by step, next to its workbook cell, with the parameters (IG threshold, the SINGLE rule, FX rule and reference investor, attribution label) editable in place.

Issues, corrections and the calculation settings are on the same page. Nothing is silently zeroed: a position that cannot be valued is excluded and listed with its reason, and errors are reported once per cause, not once per row.

## Using your own data

1. Open **Data & validation › Setup** and drop the AUM workbook (`.xlsx` / `.xlsm`, formulas and all; or one CSV per sheet, or paste each sheet). Only the four sheets are read.
2. Close any **mapping gaps** listed in step 3 with the Add buttons.
3. **Download the Ownership sheet** (Data › Setup): one grid with your names down column A and across row 1. Fill in each cell with the share the row owns of the column: the Group row is your ownership of each investor and fund (only the Group view uses it), a column's own row with fund shares gives its "incl. part in funds" view, and a region's row is that region. That is all the configuration there is.
4. Add it to your workbook as a fifth tab called **Ownership** (or drop it with the workbook). From then on every drop is configured automatically. Step 4 of Setup shows the same grid and lets you edit it in the app: type a share in any cell, or **Add name** for a new owner or region, fill in its row, and it appears in the View selector. The grid only defines views; your four sheets are never changed.
5. Every month, drop the new Holdings sheet. Use *Download working workbook* whenever you want the file with everything in it.

The sheet layouts, the Ownership grid and how formulas are handled are described in [`data/SCHEMA.md`](data/SCHEMA.md). Synthetic examples of all five sheets are in `data/demo/` (`Scope-demo.xlsx` plus one CSV per sheet). A loaded workbook, the rows added to it and the previous month's Holdings stay in that browser (IndexedDB) until you reset to the demo; loading your own data clears the demo. Nothing is uploaded anywhere.

To regenerate the synthetic demo workbook: `node tools/gen-demo.js` (deterministic). To inspect any workbook from the command line: `node tools/xlsx-check.js file.xlsx`. To see exactly how the calculation reads it (header rows, which column feeds each input, the six Mapping tables, workbook checks, issues): `node tools/diagnose.js file.xlsx`.

## How the calculations work

All AUM calculations sit in **one file, `js/calc/aum.js`**, which reads top to bottom in the same order as the workbook. It is a pure function from the four sheets to the results, so it also runs in Node for testing, and every number keeps the cell it came from (e.g. `Holdings!AK57`).

| Section | What it does | Workbook equivalent |
|---|---|---|
| §1 Settings | defaults for everything the four sheets do not hold (views, investor types and weights, the FX exception, IG threshold, buckets, thresholds) | |
| §1b–1c Ownership (and the older Scope Settings) | the optional fifth sheet: one grid of who owns what share of whom; the Group row is the group's ownership, other rows are views (incl. part in funds, regions). The older Scope Settings sheet still supplies the FX exception and settings | the Output sheet's header row (Calculations row 3) and the Calculations "incl. part in funds" formulas |
| §2 Inputs | where each input lives: the column roles, matched by output name (row 2) or header (row 3) | Holdings row 2 / row 3 |
| §3 Reading | find each sheet's header row; locate the six Mapping tables by title | — |
| §4 Mapping lookups | References, Active Assets, Security Mapping, Funding Name, Investment Grade, Fund Check | Mapping C:D, H:M, P:U, Y:AA, AC:AE, AH:AI |
| §5 Holdings | formula columns B–E recomputed; one position per row; amounts, dates, terms; exclusions | Holdings B–E, Calculations A–H |
| §6 Ratings | internal unless NR, else worst of Fitch / Moody's / S&P; score = MAX; IG if ≤ 610 | Calculations rating branch |
| §7 FX | one rate per currency, the reference investor's first row (or each row's own rate); amount ÷ rate; direction checked against the RC column; the exception, fixed or one rate per asset from a Hardcoded column | Calculations CU:CX, CL. Each amount column is read in the currency it is really in: the quotation currency (the workbook's rule), the reporting currency (already EUR) or the portfolio currency; for the nominal this is detected from drawn + unfunded, so an extract that already converted it is not converted twice (Data › Formulas, Data › Checks). A loan quoted in EUR is never converted: the row's own Forex is the rate to its portfolio's currency (0.855 on a EUR loan in a GBP portfolio), not a EUR rate |
| §8 Hardcoded and ESG | per-asset fields and every source column, with cells | Hardcoded / ESG Hardcoded INDEX-MATCH |
| §9 Investor columns | investor columns and the group's ownership of each (used only by the Group view: Σ ownership × column) | Calculations DL:EN, row 3 |
| §10 Views and Output | each view = Σ weight × investor column; look-through register from the "incl. part in funds" views; asset × investor matrices; group attributed = Σ weight × column; Output rows = active assets with exposure in the view | Calculations SUMIFs, EO, EQ:ES; Output!G8 |
| §11 Metrics | exposure-weighted metrics and distributions | Output totals, Quarterly Reporting distributions |
| §12 Checks | the workbook's own formula columns against this file | — |

Three workbook behaviours are reproduced and flagged because they need a business decision. First, the IG label uses the weaker of the internal and external scores even when the internal grade is displayed. Second, an unrated position scores 0, which the workbook labels "IG"; Scope shows it as NR instead. Third, the workbook converts a currency the reference investor does not hold to zero; Scope uses the row's own rate and warns.

On top of the calculation, the **analysis** layer (`js/analysis/`) flattens the results into one record per position (with every raw sheet column) for the Explorer and the global filters, and aggregates them with the pivot engine. Global filters are applied inside the calculation (`js/core/store.js` runs it twice: once to evaluate the filters on any field, once on the matching Holdings rows), so every page agrees.

## Project structure

```
index.html               page shell: loads core → workbook reader → AUM calculation → analysis → demo workbook → pages → app
start.bat / start.command / start.sh   launchers for Windows / macOS / Linux
Create Scope shortcut.bat              Windows: Scope shortcut with its icon (desktop, Start menu, taskbar)
docs/how-scope-works.html              the full explainer: every mechanism from the raw sheets up (open in a browser)
docs/how-scope-works-exact.html        the exact companion: every header, field, formula, check and message, generated from the code
launcher/                              its icon (Scope.ico), the script it runs and the steps by hand
js/inputs/
  workbook.js            reads .xlsx / .xlsm, CSV and pasted Excel ranges into cell grids (no business logic)
js/calc/
  aum.js                 ALL AUM calculations, one auditable file (§1 settings … §12 checks)
js/analysis/
  dataset.js             flat records and field registry over the results (every raw sheet column included)
  sheets.js              custom sheets: a saved column set → headers, rows and .xlsx (Custom sheets page)
  pivot.js               cross-tab aggregation, filters, Top N, % of total, export
  lookthrough.js         fund look-through to ultimate holders (register derived from the "incl. part in funds" views)
js/core/
  store.js               the four sheets, rows added to Mapping, the previous Holdings, settings, global filters, overrides, corrections, cached results
  filters.js             global filters and global search
  util.js, csv.js        numbers, dates (Excel YEARFRAC 30/360), formatting; CSV parse and serialise
  registry.js            business layers, page registry, hash router
  ui.js, grid.js         DOM helpers, cards, badges, tables, modals; virtualised spreadsheet grid
  charts.js, charts-extra.js, icons.js   SVG charts (bars, donut, map, treemap, heatmap, Pareto, ladder) and icons
js/report/               pptx.js (native PowerPoint writer: text, tables, freeforms, charts with embedded data; template pages with x slots), house.js (the page kit), investor.js (the investor report; the write-ups reader, linker and template; the market-data reader), quarterly.js (the analysis pack), widgets.js (the designer's blocks and custom decks)
js/modules/              one file per page; each registers itself with Scope.registerModule
js/app.js                app shell: data loading, sidebar, top bar, routing
css/                     scope.css (design tokens and layout), one stylesheet per page group, fonts.css
data/
  demo/                  the synthetic demo workbook: Scope-demo.xlsx and one CSV per sheet
  demo.js                the same five sheets embedded, so the app works when opened as a file
  world-map.js           country outlines for the map
  europe-map.js          Europe for the investor report's map (Natural Earth 1:50m, public domain)
  SCHEMA.md              the four input sheets and the optional Ownership grid
tools/
  serve.js               zero-dependency static server
  gen-demo.js            synthetic demo workbook generator
  xlsx-check.js          inspect a workbook from the command line
  diagnose.js            show how the AUM calculation reads a workbook: header rows, column roles, Mapping tables, checks, issues
tests/                   open tests/index.html, or run: node tests/run-node.js
```

## Extending the platform

Each coverage task gets **one calculation file** and one or more pages, so new layers can be added without touching existing ones.

1. Put the calculation in a new file under `js/calc/` (for example `js/calc/cashflows.js`): a pure function of the input sheets and/or the AUM result, with its settings at the top, the same shape as `js/calc/aum.js`. If it needs other sheets of the workbook, add their names to `IN.OPTIONAL_SHEETS` in `js/inputs/workbook.js` (the reader keeps only the sheets it knows) and to the matching list in `js/core/store.js`.
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

The same tests run in the browser at `tests/index.html`. They cover the workbook reader (xlsx, CSV and pasted ranges), a workbook saved with live formulas (`tests/fixtures/formulas.xlsx`), the Scope Settings sheet (weights in every form, type inference, precedence, renaming, download round trip), the AUM calculation (table location, column roles, the workbook formula checks, an independent recomputation of total exposure from the raw Holdings grid, views, the FX rules and exceptions, ratings, exclusions, mapping gaps closed by appended rows, IDs stored as numbers or text, robustness to where sheets are pasted and to Excel number and date types), the pivot engine (including a 50,000-record performance check), fund look-through reconciliation and the concentration measures.

## Definitions still to be agreed

These are settings (the optional **Ownership** sheet and the older **Scope Settings** sheet in your workbook, defaults in §1 of `js/calc/aum.js`, and per-browser changes on **Data › Setup** and **Data › Columns**) or are listed on the relevant planned page, rather than decided silently in code.

| Definition | Where it lives today |
|---|---|
| Which Holdings column is nominal, drawn, commitment, currency, FX rate | §2 column roles, matched by the row-2 output name (Amount nominal (QC), Current drawn amount (QC), …); override on Data › Columns |
| FX direction, one rate per currency or each row's own, the reference investor | auto-checked against the RC column; Scope Settings › Settings; override on Data › Views & investors |
| How each view in Mapping column H is composed | its row in the Ownership grid (or Scope Settings › Views, or §1 `views`); Data › Setup step 4 and the Formulas tab |
| The group's ownership of each investor column (types follow from it) | the Group row of the Ownership grid (or Scope Settings › Investors, or §1 `investors`); Data › Setup step 4 |
| Who holds each fund's units (look-through) | the "<investor> incl. part in funds" formulas |
| The FX exception (fixed, or one rate per asset from a Hardcoded column) | Scope Settings › FX Exception (or §1 `fxOverrides`) |
| Rating convention and IG threshold | Mapping Investment Grade table; §1 `igThreshold` |
| Maturity buckets, display unit, spread unit, concentration thresholds | §1 |
| Returns and IRR, fees, NAV, cash-flow conventions, covenant definitions, valuation method, sector KPIs, watchlist criteria, report sign-off and commentary | not yet modelled; each planned page lists what must be supplied |

## Integrations

No live connection to source systems exists. The four input sheets are the integration boundary: an adapter that produces the same sheets (or passes the same cell grids to `Scope.store.setSheets`) is the intended connection point.

## Privacy

Everything runs locally in the browser. Scope makes no network requests other than reading its own files. Settings, saved views, filter sets and corrections are kept in the browser's local storage, and a loaded workbook in its IndexedDB, on that machine only.

## Third-party assets

See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for the icon set and world map licences, and for how to add a corporate typeface.
