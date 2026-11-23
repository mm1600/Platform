# Scope inputs: the four AUM sheets

The AUM calculation reads **exactly four sheets** of the AUM workbook. Load them on **Data & validation** in any of three ways:

- drop the workbook itself (`.xlsx` / `.xlsm`); the four sheets are picked by name and other sheets are ignored;
- drop one CSV per sheet, named after the sheet (`Holdings.csv`, `Mapping.csv`, `Hardcoded.csv`, `ESG Hardcoded.csv`);
- paste a sheet copied from Excel (select the used range, copy, paste; say which cell the copy started at, A1 by default).

Columns are found **by name**, not by letter, so a column can move or new columns can be added without breaking anything. Each input's resolution (which column, found how) is shown on **Data › Columns**, and any role can be pointed at another column there. Nothing leaves the browser.

Synthetic examples of the four sheets and of the Ownership grid are in `data/demo/` (one CSV per sheet and `Scope-demo.xlsx`).

## Holdings

| | |
|---|---|
| Row 2 | output names: `XLOOKUP(row-3 header, Mapping!C:C, Mapping!D:D)`, `#N/A` when a column is not in References |
| Row 3 | column headers, from column B (Security ID in column I) |
| Row 4+ | one row per investor × security; rows without a Security ID (copied formula rows showing `0x0`) are ignored |

Formula columns B–E are recomputed by the calculation and compared with the workbook's own values (**Data › Checks**):

| Column | Header | Formula |
|---|---|---|
| B | Unique Identifier | `Investor Code & "x" & Security ID` |
| C | Investor Code | `IF(Model Portfolio = "SINGLE", Portfolio, Model Portfolio)` |
| D | Identification ID | `XLOOKUP(Security ID, Mapping!T, Mapping!S)` |
| E | Code Name | `XLOOKUP(Security ID, Mapping!T, Mapping!Q)` |

Columns the calculation uses (matched on the row-2 output name first, then the row-3 header):

| Role | Output name (row 2) | Header (row 3) |
|---|---|---|
| Model portfolio, portfolio | Model Portfolio, Portfolio | Model Portfolio, Portfolio |
| Security ID, security name | Security ID, Security Name | Security ID, Security Name |
| Reporting date (MIN = reporting date) | Reporting Date | Reporting Date |
| Position currency | Currency | Quotation Currency |
| FX rate (units per EUR; checked against the RC column) | Forex, FX Rate | FX Rate EC |
| Nominal (exposure) | Amount nominal (QC), Nominal | RA_Commitment QC |
| Drawn | Current drawn amount (QC), Drawn | Current Drawn Amount CCY |
| Commitment | Initial commitment (QC), Commitment | Initial Commitment Amount CCY |
| Nominal in reference currency (FX direction check) | Nominal RC | RA Commitment RC |
| Maturity, purchase date | Maturity Date, Purchase Date | Maturity Date, Purchase Date |
| Rate type, spread, WAL | Fixed / Floating, All-in spread (bps), Current WAL | Rate Type, All-in Spread at Acquisition, WAL |
| Ratings | Internal Rating, Initial Rating, External Rating Fitch / Moodys / S&P | Internal Current Rating, …Rating_Closing, Rating Fitch, Rating S&P, Rating Moody's |
| Country, country code, sector, instrument, bullet flag, borrower, seniority | Country, Country code, Sector, Format, Bullet / Amortizing, Borrower name, Seniority | RA Asset Country Name, RA Country, Underlying Asset Type (the sector), Security Type Name, RA_Bullet, Parent Issuer Name, Seniority |
| Portfolio name, project code, Brownfield / Greenfield, Primary / Secondary, Yield | the same names | Portfolio Name, … |
| Financial close (the relative value slide's date; else the Funding Date) | Financial Close | Financial Close, Financial Close Date |

The row-2 names are the ones the workbook's Calculations sheet looks up; a column is found by its row-2 name first, then by its row-3 header.

Every other column (covenants, ICR, LTV, DSCR, yields, …) is carried through untouched and is available in the Explorer (group "Holdings columns").

## Mapping

Six tables side by side; each has its **title in row 2** and **headers in row 3**. A table is located by its title, so it can move; the workbook's default column is the fallback.

| Table | Default columns | Headers (row 3) | Used for |
|---|---|---|---|
| References | C:D | Columns in Holdings tab · Output Names | Holdings row 2 |
| Active Assets | H:M | Views (Portfolios / Investors) · List · Mapping · Active Assets Output · Selected Assets · Number | H = the view choices (Output!G8); I → J maps security names to assets; UNIQUE(J) = assets in the Output |
| Security Mapping | (P helper) Q:U | Code Name · Holdings Name · Identification ID · Holding ID · Transaction Group | holding ID (T) → asset = identification ID (S), code name (Q), project name (R); Transaction Group (U) groups assets for the navbar's Asset dropdown and the reports ("Asset A" + "Asset A top-up" → "Asset A") |
| Funding Name | Y:AA | Fund Name · Holdings Name · Holdings ID | investor code (AA) → investor column (Z) and fund name (Y) |
| Investment Grade Mapping | AC:AE | Rating · Score · (extra) | rating → score; IG if score ≤ 610 |
| Fund Check | AH:AI… | Mapping · Holdings · (extra) | checked: every listed holdings name must be an investor column |

## Hardcoded

Headers in row 3 from column C (row 2 holds the labels the workbook's lookups use). Keyed by **Security ID** = the asset's identification ID. Columns D (Project Name) and E (Code Name) are lookups to Mapping and are reconciled.

Columns used: Security ID, Project Name, Code Name, Chronological Order, Subsector, Cashflow Type, Description, Shareholders, Origination, Staff Closing, Upfront, End of NC / MW, IC Date, Funding Date, Total Debt Offering, Watchlist, every "… Sector Classification" column (an investor's own sectors: a view's reports can use one instead of the Holdings sector), a classification (the first other "… Classification" column, e.g. Core / Core+; its heading is printed on the investor report's asset table), Compliance with Financial Covenants. Every column, including those not listed (prepayment protection, jurisdiction tiers, investor-specific classifications, TICS code, …), is shown on the asset page with its cell and is available in the Explorer.

## ESG Hardcoded

Headers in row 3 from column C, keyed by **Security ID**: Security ID, Project Name, Code Name, Infra Code, FM Monitoring (row 2: Staff Monitoring), E Score, S Score, G Score, ESG Score, Shareholders, CBI Sector, CBI Subsector, CBI Subsubsector, CBI Asset Type, CBI Asset Specific, GHG Scope 1, GHG Scope 2, GHG Scope 3 (the taxonomy columns are also accepted as "CHI …"). The app's sector is the Holdings one (Sector, i.e. the Underlying Asset Type), everywhere, as the Output names it; the taxonomy's CBI / CHI Sector and an investor's own "… Sector Classification" (Hardcoded) stay columns of their own, and a view's reports can use such a classification instead (Investor reporting › Sectors in the reports). Rate Type is read whatever the spelling: float / variable / FRN / any IBOR or overnight index / V = Floating; fix / zero coupon / F = Fixed; another value is kept as written; a blank is "Not stated".

## Optional fifth sheet: Ownership

The four sheets do not say which share of each investor column the group owns, how views such as a region are built, or who holds each fund's units. In the workbook that is the Output sheet's header row (Calculations row 3) and the Calculations formulas of the "incl. part in funds" columns. The optional fifth tab, **Ownership**, holds all of it as **one grid**:

- the names down column A from A2, and the same names across row 1 from B1 (investor columns, funds, mandates, the group, regions: any name);
- each cell = the share the **row** owns of the **column**: `1`, `0.45`, `45%` or `9/20`; blank = 0. A grid filled the other way round (the group's shares written down the Group column) is recognised: nobody owns a share of the group, so when the Group row is empty and the Group column is filled the whole grid is read transposed (with a warning); when both are filled the row wins and the column cells are compared; a region whose row is empty but whose column lists its members is read from the column. Those cells are never terms of a view ("France + Group" would add the whole group to France). The diagonal (a name against itself) is the row's share of its own column: blank counts as 1 (100%), a value is used as typed.

| Row | Becomes |
|---|---|
| the group (named like the attribution label, default **Group**; when no row has that name, a row whose name carries the label or the word group/attribution, e.g. "Demo Group", else the first row that is neither an investor column nor the platform total; its name becomes the label) | the group's ownership of each investor column. The **Group view = Σ ownership × column**: 100% of its own entities, 10% of an investor it owns 10% of, 45% of a fund it holds 45% of |
| an investor column with other cells filled | the view "*name* incl. part in funds" = its own column + Σ % × column; the % in funds are also its share of each fund's units (the look-through). The workbook decides which of these views exist: the row counts only when Mapping › Active Assets column H (the view list) names "*name* incl. part in funds"; otherwise it is reported on Data › Issues and not used, so a stray cell never adds a view. Without a column H list, every filled row counts. The view may be filled in the column's own row, in a row named "*name* incl. part in funds", or both (combined; where both give a fund a different share, the incl. row wins). A region's incl. row that does not name the region gets it added. An incl. name filled down its column instead (X 100% in X's row, each fund's share in the fund's row) is read as its row. The drawn amount of an incl. view is blank, as in the workbook (Data › Formulas can show it) |
| any other name (a region, a composite) | a view of that name = Σ % × column; a cell may point at another such row (a region inside "Region A incl. part in funds") |

Every other view takes its columns at 100%: selecting Fund 1 shows the whole Fund 1 column, never the group's share of it. Types are worked out: ownership 1 → Group entity, between 0 and 1 → Partly owned, 0 → Third party; a column that a row holds units of through an "incl. part in funds" row is a Fund. **Data › Setup** downloads the grid pre-filled with every name from Mapping › Funding Name and the shares in force, so only the percentages need typing. Precedence: **changes made in the app** (this browser) > **the Ownership sheet** > the older Scope Settings sheet > the defaults in §1 of `js/calc/aum.js`. Without it, every view that is an investor column still works and the Data page lists what is undefined.

The older **Scope Settings** sheet (Investors, Views, FX Exception and Settings tables) is still read when present: for the FX exception and the few settings (attribution label, IG threshold, FX rate source and reference investor, single portfolio token, maturity buckets), and for ownership and views when there is no Ownership tab.

## Asset write-ups workbook (optional, Layer 2 · Asset write-ups)

Not one of the input sheets: a separate workbook, loaded on the Asset write-ups page and kept in the browser. Any sheet, one box per asset:

| Rows of a box | Column A (optional) | Column B | C · D · E | F |
|---|---|---|---|---|
| first | ref (3/30) | asset name | `Actual` · `Lock-up` · `Covenant` | description (one short line) |
| one per ratio | | ratio name (`Net debt / EBITDA`, `DSCR` …) | values, shown as Excel shows them (number formats read: 6.62x, 565, 70%, n/a) | recent events: one cell, a line each (or a cell a row) |
| last | | `Rating` | the rating, under any column (or in the row under it) | |

The columns are found from the `Actual` / `Covenant` words, so the box can sit anywhere on the sheet and a ratio name may also sit one column right of the name. A header row (Ref., Name, Description …) is skipped. One row per asset under a header row (Ref, Name, Description, Recent events) is read too. Names are matched to assets word by word against every name an asset goes by (name, code name, ID, transaction and asset group, Mapping, Hardcoded, ESG Hardcoded and Holdings name columns).

## Rows added in the app

A Security ID that is not in Security Mapping, an investor code that is not in Funding Name, or an asset held but not listed in Active Assets is reported once, with everything needed to close it, on **Data › Setup › Mapping gaps**. *Add* appends the row below the right Mapping table (Security Mapping Q:U with the helper in P, Funding Name Y:AA, Active Assets I:J). The rows live in this browser with the workbook, are read like any other row, and are part of *Download working workbook*. The original file is never changed.

## Monthly updates

Drop only the new Holdings sheet (a workbook with a Holdings tab, or `Holdings.csv`). Mapping, Hardcoded, ESG Hardcoded, the rows added in the app and every setting stay; the previous Holdings is kept for one step of undo (*Restore previous Holdings* on Data › Setup).

## Formulas

The four sheets can keep their formulas. Excel saves each formula's last result with the file and Scope reads that result, so formula columns (the XLOOKUPs in Holdings B–E and row 2, Hardcoded D–E, the Mapping helper column) come through as values. Scope recomputes those columns itself and compares them with the workbook's results (**Data › Checks**). A formula that fails in the workbook (#REF!, #NAME?, …), typically because it pointed at a sheet that was not copied with the four, is skipped by the check rather than reported as a difference; Scope's own value is used either way. Save as .xlsx or .xlsm (not .xlsb); if the workbook is set to manual calculation, recalculate before saving.

## Errors and warnings

Nothing is silently zeroed. A Security ID missing from Security Mapping, a currency without an FX rate, or a non-numeric nominal **excludes** the position, which is listed with its reason. An investor code missing from Funding Name is kept in the asset totals but in no investor column. An asset held in Holdings but missing from Active Assets is left out of the Output (as in the workbook). Each of these is reported **once per security, code or asset** (not once per row), with the positions and amount involved, on **Data › Issues** and on the Mapping gaps step, where it can be closed. IDs match whether they are stored as numbers or text (`100200`, `"100200"` and `"100200.0"` are the same ID). The key columns are checked against Mapping before anything else: if the column Scope resolved as Security ID matches almost none of the holding IDs in Security Mapping while another Holdings column matches almost all of them, that column is used and the correction is reported (and can be overridden on Data › Columns).
