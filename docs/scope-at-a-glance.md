# Scope at a glance

The short version of "Scope, step by step". It lists only the headline steps: every place where Scope **changes, converts, combines, fills in or drops** your data on the way from the workbook to a page or a deck. For the exact conditions and the rule numbers, look up the same stage in the long document.

**The flow in one line**

Workbook → (1) cells read → (2) settings and ownership read → (3) one **position** per Holdings row → (4) positions summed into **assets** → (5) **views** decide each investor's share → (6) **Output rows and metrics** → (7) pages → (8) write-ups matched → (9, 10) decks.

**Two things to know first**

- Scope never edits your workbook. Everything below happens on a copy, in the browser.
- Global filters are applied *inside* the calculation (it runs twice: once on everything, then again on only the rows that pass), so every page, total and download shows the same filtered book.

## 1. Reading the files

| Data | What Scope does to it | Example |
|---|---|---|
| Tabs | Keeps only Holdings, Mapping, Hardcoded, ESG Hardcoded, Ownership and Scope Settings (names matched ignoring capitals, spaces, `_`, `-`), plus your Output and Calculations tabs, which are used **only** to compare against (Data › Check my data). Every other tab is never opened. | "esg_hardcoded" is read; "Old Holdings" is not |
| Number cells | Read as the stored value, not as displayed. | 6.6% is read as 0.066 |
| Formula cells | Read as the result Excel last saved; no saved result means blank (with a warning). | |
| Excel errors | #N/A, #REF!, #VALUE!, #DIV/0!, #NAME?, #NULL! and #NUM! count as **blank** everywhere. | Security ID "#N/A" means the row is skipped |
| Text | Trimmed. IDs are compared ignoring capitals, double spaces and a trailing ".0". | 100200, "100200" and "100200.0" are one holding |
| Amounts typed as text | Spaces, commas, €£$ removed; brackets mean negative; a trailing % is dropped **without** dividing by 100. A comma is always a thousands separator. | "(1,234)" = −1234; **"1,5" = 15** (Silent) |
| Dates | Excel date numbers (20,000–80,000) used as they are; text dates read **day first** when ambiguous. | "03/04/2026" = 3 April |
| 1904-date workbooks | Warned once, then every date is read about 4 years early. | |
| Write-ups workbook | The one file read **as displayed**: each number becomes the text Excel shows. | 6.62 formatted `0.00"x"` becomes "6.62x" |
| Shared folder (optional) | One copy for the team: the sheets, Mapping rows added in Scope, corrections, calculation and report settings, write-ups, market curves and the template. **Save** writes a new version (who, when, note, what changed), one save at a time; if someone saved first, the changes **merge field by field** and only a field you both changed is asked. Every open Scope checks every 20 seconds and shows "Newer version … Refresh". The view, currency, filters and layouts stay **yours**. | Sam and Alex each add a Mapping row: both are kept in version 14 |

## 2. Settings and ownership

| Data | What Scope does to it |
|---|---|
| Settings | Takes the app's value, else the Scope Settings sheet's, else the built-in default. Defaults: base currency EUR, IG threshold 610, buckets 0-3/3-5/5-10/10-20/20+ y, amounts shown in millions, spread unit "auto". |
| Fixed in code (not settable from the workbook) | Display unit, the region table (UK & Ireland / Continental Europe / Rest of world), concentration limits, explorer bands. **Scope's choice.** |
| Ownership shares | Every share cell is turned into a fraction: a number above 1 is a percent (35 = 35%), "9/20" = 45%, "45%" = 0.45, blank = not given. Negatives become 0 with a warning. |
| Ownership grid vs Settings sheet | The grid wins for ownership and views; the Settings sheet still supplies settings and FX exceptions. A grid edited in the app replaces the sheet's grid entirely. |
| View formulas | "Investor 1 + 1/4 × Fund 1" is split into terms (name, weight). Subtraction is not supported. |
| Investor names | Display names replace workbook names on screen; names in settings are matched exactly, else loosely (4+ characters, reported once). |

## 3. Holdings rows into positions

**Which rows become positions**

- Rows with a blank, error or "0" Security ID are dropped. A dropped row that still carries a nominal is warned about.
- The header row is found automatically in the first 15 rows. Columns are found by the row-2 output name, else the row-3 header, else a pattern; a column you chose on Data › Columns always wins.
- Key columns are checked against Mapping. If an automatically chosen key matches under 50% and another column matches 80% or more, Scope **switches to the better column** (with a warning).

**What is changed on each position**

| Field | Transformation | Example |
|---|---|---|
| Investor code | Portfolio when Model Portfolio = "SINGLE", else Model Portfolio. | |
| Manual corrections | Applied **before** anything is calculated, matched by investor code × Security ID. They silently stop applying if a new extract changes either key. | 10m corrected to 11m: totals +1m |
| Nominal | Not a number: position **excluded**. Negatives accepted with no message. | |
| Drawn | Blank or text becomes 0. | |
| Commitment | Blank becomes the nominal. | |
| Currency | Trimmed, capitals. Blank: position **excluded**. | "gbp " = GBP |
| Rate type | Reduced to Fixed / Floating / Not stated by keywords; anything unrecognised is kept as written. | "Euribor 6M" = Floating; "Fixed to floating" = Floating |
| All-in spread | Converted to bps on "auto": below 0.5 × 10,000; 0.5 to under 20 × 100; 20 or more kept. | 0.0165 and 1.65 both = 165 bps |
| Ratings | Grades tidied (dashes, spaces) and scored from Investment Grade Mapping; unknown grade = NR. External = **worst** of Fitch / Moody's / S&P. Grade shown = internal if known, else external; **score = the worse of internal and external**. | Internal A (500), external BB (650): shows "A", scores 650 |
| IG label | SUB IG when the score is above 610. Unrated keeps the label "IG" in the engine (shown as NR on pages). | 610 = IG; 620 = SUB IG |
| Tenor | Initial tenor = 30/360 years from funding to maturity. Remaining years = actual days ÷ 365.25 from the reporting date. | |
| Maturity bucket | First bucket that fits ("a-b" includes a, excludes b); past maturity = Matured; no date = Unknown. | 3.0 y = "3-5 y" |
| Reporting date | The **earliest** Reporting Date on any row. | |

**Exclusions (counted in no total, still listed)** — first reason found wins: nominal not a number, blank currency, Security ID not in Security Mapping, asset not in Active Assets, no FX rate. An **unknown investor code is not excluded**: it counts in the asset's total under "Unmapped investor <code>", owned by nobody.

**FX conversion**

| Step | What happens |
|---|---|
| Direction | On "auto", Scope tests ÷ rate and × rate against the extract's own EUR column and uses the one that reproduces it (default ÷, as the workbook). |
| Which rate | One rate per currency: the **reference investor's first row** in that currency (the workbook's rule), not each row's own rate. EUR positions always use 1. |
| Gaps | Reference investor holds nothing in a currency: each row's own rate is used (the workbook would show 0). **Scope's choice.** Still no rate: the most frequent rate. Still none: excluded. |
| FX exceptions | Replace the rate for a given investor, currency and (optionally) view, either a fixed rate or a Hardcoded column per asset. |
| Amount currency | Nominal is auto-detected as already-EUR or in its own currency (by testing nominal against drawn + unfunded); drawn and commitment are treated as in their own currency. |
| Display currency | EUR amount × the display currency's rate per EUR. A currency with no rate falls back to EUR with a warning. |

## 4. Positions into assets

| Output | How it is built | Example |
|---|---|---|
| Asset list | One asset per identification ID in Security Mapping; Active Assets order first. | |
| Asset totals | Sum of counted positions (nominal, drawn, commitment). | 100m + 20m = 120m |
| Investor columns | Sum per investor column (the workbook's SUMIF). | |
| Group attributed | Σ investor column × its Group ownership (SUMPRODUCT). Third party = total − attributed. | 100×1 + 50×0.5 + 20×0.4 = 133m |
| Attributes | From the Hardcoded row (found by ID, else by a holding ID), with fall-backs: funding date → Purchase Date; subsector → ESG CHI subsector; sponsor → ESG Shareholders → Parent Issuer. | |
| Per-asset terms | Country, maturity, margin, WAL, rating, bucket, instrument all come from the **first position in Holdings row order**. Reordering rows can change them. **Scope's choice.** | |
| Currency / rate type | "Multi" / "Mixed" when tranches differ. | |
| Rating mismatch | Different grades across tranches: flagged, first one used. | |
| Region | Country looked up in the built-in table; anything else = Rest of world; blank country = blank region. | "Netherlands (the)" = Continental Europe |
| GHG intensity | (scope 1 + scope 2) ÷ (whole-deal Total Debt Offering ÷ 1m). Uses the whole deal, not the platform's share. | 1,500 t ÷ 300 = 5 t/m |
| Protected life | (protection end − funding) ÷ (maturity − funding). | |
| Asset group label | Transaction Group; a code-like group ("TG-001") is relabelled with its members' common name. | |
| Hardcoded missing | Flag "no Hardcoded row" and its attributes stay blank. | |

## 5. Views: who owns what

| Step | What happens | Example |
|---|---|---|
| Group row | Found in the Ownership grid by name ("Group", "Attribution"…), else by elimination. A grid filled the other way round (column owns row) is **turned round automatically**, with a warning. | |
| Group ownership | Each investor column's share from the group row; a column with no cell = 0 (no message). | |
| Column types | Given, else worked out: ownership ≥ 1 Group entity, > 0 Partly owned, 0 Third party; nothing at all = Unclassified (treated as third party). | |
| View list | Mapping column H, cleaned of copied section and measure headings ("Ratings", "Drawn", "… draw"), then the group view, grid views, app views. | |
| View definitions | Each view becomes "weight × investor column" terms. Views naming other views are expanded and weights multiplied; loops are cut with an error. | "Region A incl." = Region A + 0.1 × Fund 1 → Investor 3 + Investor 4 + 0.1 × Fund 1 |
| Asset amount in a view | Σ term weight × that investor column's amount. "Total platform" = every column. | Investor 1 + 0.25 × Fund 1 = 100 + 5 = 105m |
| Look-through | "<investor> incl. part in funds" views give a register of who holds which fund's units. Investor pages add each investor's share of the funds it holds (up to 5 levels); the remainder is "External fund holders". | Fund 1 40m, external 65% = 26m |

## 6. Output rows and metrics

**Output rows**

- One row per asset that is in Active Assets **and** has nominal above 0 in the view.
- Amounts are divided by 1,000,000. Undrawn = exposure − drawn.
- For "incl. part in funds" views, drawn is blank unless "Look through drawn" = show.
- "All investors", group attributed and the per-investor columns on a row are the **whole asset's**, not the view's share.
- Rows are sorted by exposure and ranked.
- Each asset's exposure is also split by tranche currency and fixed/floating, so currency and rate charts show EUR 120 / GBP 50 rather than "Multi".

**Metrics (from the view's Output rows)**

| Metric | Formula |
|---|---|
| Totals | Σ exposure, Σ drawn, Σ commitment; undrawn = total − drawn |
| Averages (margin, WAL, tenor, ESG) | Exposure-weighted over rows that have a value; coverage shown |
| Weighted rating | Exposure-weighted score of rated rows → nearest S&P/Fitch-style grade |
| Sub-IG share | Engine and Concentration page: SUB IG ÷ **all** exposure. AUM page KPI by default: SUB IG ÷ **rated** exposure. **Scope's choice.** |
| Watchlist share | Exposure whose Watchlist text reads as "on" (watch, intensive, amber, red, yes…; "No", "Performing", "Off watch" are off) ÷ total |
| Group share of book | Σ group attributed ÷ Σ asset totals over the view's rows |
| Fixed share | Fixed part of the tranche split ÷ total |
| GHG | Plain sum of asset values, **not** scaled by the view's share. **Scope's choice.** |

**The client's own look:** only for a client (an investor with its own "<investor> Classification" column beside its "<investor> Sector Classification" one) and only on its own views (the view or cover named after it, every investor in the view being its mandates, or, with one client, a view of Mandate-type investors whose every asset the client has classified), the client's sector column **replaces the Holdings sector** in the sector breakdown and the decks (only there): its five sectors on the rings and bubbles (Energy + O&G, Renewables + Environmental & Waste, Transport, Telecom, Social; a blank one filled from Holdings), its own value in the asset table; and the subsectors become the client's own column, or the Holdings ones put into the client's list (all renewables "Renewable power", social "Government Services", heating and cooling under "Regulated gas networks"). Every other view keeps the house look; any view can be set by hand on Investor reporting.

## 7. The pages

| Page | What is changed before it is shown |
|---|---|
| All pages | Global filters keep only matching tranches and **recalculate** the assets from them (totals, first position, rank). Ranks restart at 1 among filtered assets. |
| AUM | KPIs from the metrics above; the breakdown table's Drawn is the view's share; country chart top 10, rest folded; Output and Positions downloads follow the filters. |
| Explorer / pivot | Each position's exposure = nominal × its investor's weight in the view. Fixed bands for size, margin, WAL and years. Subtotals are recomputed from the records, not added up from child rows. |
| Concentration | HHI = Σ share² (shown × 10,000); limits 10 / 20 / 35 / 30 / 25 / 40% are illustrative only; maturity windows 12 / 24 / 36 months. |
| ESG | E, S, G and ESG scores exposure-weighted; GHG summed in full. |
| Investor pages | Direct + look-through; share of book = total ÷ the whole book before look-through. Includes assets not in Active Assets. |
| Check my data | Changes nothing. Compares Scope with your workbook's Output and Calculations tabs on the view and currency in Output!G8 / G6 (corrections and filters left out), amounts to one currency unit; then checks Scope's own sums add up on your data. |
| Ask Scope | Changes nothing. A question is read in the browser (no model, no server) and answered from the Explorer's records and totals. A **threshold is tested per asset**, a bare year is a **maturity year**, and a short follow-up keeps the last question. |
| Calculations sheet | Shows the workbook's own column logic (including "IG" for unrated and 0 tenor where a date is missing), for comparison only. |

## 8. Write-ups

| Step | What happens |
|---|---|
| Reading | Boxes found by "Actual" + "Lock-up"/"Covenant" marker rows; values kept exactly as Excel shows them. |
| Rating | Any row named "…rating…" or holding only grades is removed from the ratios and becomes the single rating, placed under Lock-up. |
| Text | Bullets stripped. With two or more lines, the first (≤ 160 characters) becomes the description and the rest become events. **Scope's choice.** |
| Dropped silently | Boxes with no name; the second of two boxes with the same name. |
| Matching to assets | Names cleaned (accents, "&" = and, legal words, years and percentages removed, plurals singular, II = 2), then scored 0–100. Links at **75 or more**; near-ties within one asset group link to the whole group; ties across groups are left unlinked. A link set by hand always wins. |
| Which go in a deck | Only write-ups linked to an asset the view **holds** (exposure above 0). Write-ups matched to no asset, or set to "Not linked", are in no deck by default; the page says how many need linking. **Scope's choice.** |

## 9. Investor deck

| Slide | What is calculated |
|---|---|
| Key figures | Under management = view exposure; **Repaid** = the typed figure, else the fall in each asset's drawn since the previous Holdings (rises count as 0); Brownfield, Floating and Sub-IG shares; instruments = number of assets. Four columns of two, no quarter-on-quarter tags; repaid always "Repaid in <year>"; footnote 2 gives brownfield and sub-IG as shares of the mandate. |
| Portfolio split | Currency (tranche split), repayment, cash-flow type, Residual WAL (WAL, else remaining years) in < 5 / 5-10 / 10-15 / 15-20 / > 20. Slices in the workbook's Quarterly Reporting order (EUR, GBP, SEK, DKK, NOK, JPY; Bullet, Amortizing; PPP, Regulated, Contracted, Concession, Merchant), the rest after, largest first. |
| Sectors / map | Sector and subsector rings in the sheet's order (Energy, Renewables, Transport, Telecom, Utilities, Social); countries coloured in turn, largest first; Belgium, Netherlands and Luxembourg listed as one "Benelux"; labels shown at 2% or more. Unrecognised country names are not shaded (Silent). |
| AUM | Funded = drawn; unfunded = exposure − drawn; left to deploy = mandate − AuM (can be negative). Unfunded table: one row per tranche with anything undrawn, drawn and drawn ÷ exposure, most undrawn first. Group doughnut in deal order, not by size. |
| Spreads | Six bands from < 150 to > 350 bps; a boundary goes to the higher band. |
| Relative value | IG deals on the "BBB" chart, sub-IG on the "BB" chart (including A/AA and B or lower), against the first and second pasted curves respectively. |
| Asset table | Ordered by Chronological Order, then funding date; "UK" else proper-case country; Bond / Loan; rating = internal (bold blue) unless NR, else external; an investor's own classification column only on that investor's decks; rating change vs the previous Holdings (Upgrade / Downgrade, else "No" as the house deck types it); 30 rows a page with a closing bar. |
| Monitoring | Write-ups split over pages by estimated text length; at most 12 ratio rows drawn (the rest dropped silently). |
| Group pages | Ticked by default for the group view only (a choice kept per view). Spreads by maturity: bubbles by spread band and years to final maturity. Allocation: each instrument's amount per investor of the view × its weight. ESG: E, S, G, ESG scores per ESG project, green when it has a CBI sector. Prepayment: share of life protected = (end of protection − close) ÷ (maturity − close); make-whole fee not eligible when floating, not in euro, or WAL at acquisition (WAL + years since funding) under 8. |
| Formats | Whole millions ("€375m"), whole percent, dates in words. |

## 10. Other decks and templates

| Item | What happens |
|---|---|
| Template | Slide 1 = cover, 2 = section break, 3 = content page. Boxes containing just "x" are filled; notes, charts, embedded objects and empty placeholders are dropped. |
| Text fitting | Text is shrunk (never below 50%) or its box grown when it would overflow, using an estimate of text width. |
| Colours | From the template's theme, else the house greens; your style overrides any part. |
| Analysis pack | Its own fixed ten-part layout; names assets by their Holdings name (the investor deck uses the code name). Top-N lists fold the rest into "Other (k)". |
| Pack designer | Blocks on a 24 × 12 grid; the same figures as the AUM page. |
| Charts | Native, editable PowerPoint charts with their data embedded. |
