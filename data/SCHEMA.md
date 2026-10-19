# Scope inputs: the four AUM sheets

The AUM calculation reads **exactly four sheets** of the AUM workbook. Load them on **Data & validation** in any of three ways:

- drop the workbook itself (`.xlsx` / `.xlsm`); the four sheets are picked by name and other sheets are ignored;
- drop one CSV per sheet, named after the sheet (`Holdings.csv`, `Mapping.csv`, `Hardcoded.csv`, `ESG Hardcoded.csv`);
- paste a sheet copied from Excel (select the used range, copy, paste; say which cell the copy started at, A1 by default).

Columns are found **by name**, not by letter, so a column can move or new columns can be added without breaking anything. Each input's resolution (which column, found how) is shown on **Data › Columns**, and any role can be pointed at another column there. Nothing leaves the browser.

Synthetic examples of all four sheets are in `data/demo/` (one CSV per sheet and `Scope-demo.xlsx`).

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
| Country, country code, sector, instrument, bullet flag, borrower, seniority | Country, Country code, Sector, Format, Bullet / Amortizing, Borrower name, Seniority | RA Asset Country Name, RA Country, Security Type Name, RA_Bullet, Parent Issuer Name, Seniority |
| Portfolio name, project code, Brownfield / Greenfield, Primary / Secondary, Yield | the same names | Portfolio Name, … |

The row-2 names are the ones the workbook's Calculations sheet looks up; a column is found by its row-2 name first, then by its row-3 header.

Every other column (covenants, ICR, LTV, DSCR, yields, …) is carried through untouched and is available in the Explorer (group "Holdings columns").

## Mapping

Six tables side by side; each has its **title in row 2** and **headers in row 3**. A table is located by its title, so it can move; the workbook's default column is the fallback.

| Table | Default columns | Headers (row 3) | Used for |
|---|---|---|---|
| References | C:D | Columns in Holdings tab · Output Names | Holdings row 2 |
| Active Assets | H:M | Views (Portfolios / Investors) · List · Mapping · Active Assets Output · Selected Assets · Number | H = the view choices (Output!G8); I → J maps security names to assets; UNIQUE(J) = assets in the Output |
| Security Mapping | (P helper) Q:U | Code Name · Holdings Name · Identification ID · Holding ID · Transaction Group | holding ID (T) → asset = identification ID (S), code name (Q), project name (R) |
| Funding Name | Y:AA | Fund Name · Holdings Name · Holdings ID | investor code (AA) → investor column (Z) and fund name (Y) |
| Investment Grade Mapping | AC:AE | Rating · Score · (extra) | rating → score; IG if score ≤ 610 |
| Fund Check | AH:AI… | Mapping · Holdings · (extra) | checked: every listed holdings name must be an investor column |

## Hardcoded

Headers in row 3 from column C (row 2 holds the labels the workbook's lookups use). Keyed by **Security ID** = the asset's identification ID. Columns D (Project Name) and E (Code Name) are lookups to Mapping and are reconciled.

Columns used: Security ID, Project Name, Code Name, Chronological Order, Subsector, Cashflow Type, Description, Shareholders, Origination, Staff Closing, Upfront, End of NC / MW, IC Date, Funding Date, Total Debt Offering, Watchlist, a sector classification (any "… Sector Classification" column), Compliance with Financial Covenants. Every column, including those not listed (prepayment protection, jurisdiction tiers, investor-specific classifications, TICS code, …), is shown on the asset page with its cell and is available in the Explorer.

## ESG Hardcoded

Headers in row 3 from column C, keyed by **Security ID**: Security ID, Project Name, Code Name, Infra Code, FM Monitoring (row 2: Staff Monitoring), E Score, S Score, G Score, ESG Score, Shareholders, CBI Sector, CBI Subsector, CBI Subsubsector, CBI Asset Type, CBI Asset Specific, GHG Scope 1, GHG Scope 2, GHG Scope 3 (the taxonomy columns are also accepted as "CHI …").

## Optional fifth sheet: Scope Settings

The four sheets do not say which share of each investor column the group owns, how the views are built, who holds each fund's units, or how investors should be named. In the workbook that is the Output sheet's header row (the ownership weights, Calculations row 3) and the Calculations formulas of the "incl. part in funds" columns. The optional fifth sheet, **Scope Settings**, holds the same two things as two small tables, plus the FX exception and a few settings. **Data › Setup** downloads it pre-filled from your workbook, and everything changed in the app can be downloaded back into it.

| Table | Columns | What it holds |
|---|---|---|
| **Investors** (B:E) | Investor column · Type · Display name · Group ownership | one row per column of Mapping › Funding Name (Z). Type: Group entity, Fund, Third party or Mandate (inferred when blank). Ownership: 1 = fully group, 0 = not group, 0.45, 45% or 9/20 for a fund partly owned |
| **Views** (G:H) | View · Formula | one row per view that is not a plain investor column: `Region A` = `Investor 4 + Investor 5`; `Investor 1 incl. part in funds` = `Investor 1 + 1/4 × Fund 1 + 3/20 × Fund 2 + Fund 6`. A formula adds columns or other views, each with an optional coefficient (`7/20 × Fund 1`, `25% of Fund 1`, `Fund 1 × 0.25`, `(1/4)*Fund 1`). A view named "<investor> incl. part in funds" also says who holds the funds' units: its fund coefficients are that investor's share of each fund |
| **FX Exception** (J:N) | Investor · Currency · View · Rate · Note | Investor = a column name or a portfolio code; Rate = a number in units per EUR, or the name of a Hardcoded column holding one rate per asset |
| **Settings** (P:Q) | Setting · Value | Attribution label, IG threshold, Base currency, FX quote (Auto / Units per EUR / EUR per unit), FX rate source (Workbook: one rate per currency from the reference investor / Each position's own rate), FX reference investor, Single portfolio token, Maturity buckets |

Each table has its title in a cell (row 2 when downloaded), headers on the next row and rows until a blank row. Tables are found by their titles, so they may sit side by side or below one another. Names may be the workbook names or display names. "Total platform" (every column) and single investor columns need no row. The older form, a Views table with the investor columns across and one row of weights per view, is still read. Precedence: **changes made in the app** (this browser) > **the Scope Settings sheet** > **the defaults in §1 of `js/calc/aum.js`** (which define only "Total platform"). Without the sheet, the AUM still calculates: every view that is an investor column works, and the Data page lists what is undefined.

## Rows added in the app

A Security ID that is not in Security Mapping, an investor code that is not in Funding Name, or an asset held but not listed in Active Assets is reported once, with everything needed to close it, on **Data › Setup › Mapping gaps**. *Add* appends the row below the right Mapping table (Security Mapping Q:U with the helper in P, Funding Name Y:AA, Active Assets I:J). The rows live in this browser with the workbook, are read like any other row, and are part of *Download working workbook*. The original file is never changed.

## Monthly updates

Drop only the new Holdings sheet (a workbook with a Holdings tab, or `Holdings.csv`). Mapping, Hardcoded, ESG Hardcoded, the rows added in the app and every setting stay; the previous Holdings is kept for one step of undo (*Restore previous Holdings* on Data › Setup).

## Formulas

The four sheets can keep their formulas. Excel saves each formula's last result with the file and Scope reads that result, so formula columns (the XLOOKUPs in Holdings B–E and row 2, Hardcoded D–E, the Mapping helper column) come through as values. Scope recomputes those columns itself and compares them with the workbook's results (**Data › Checks**). A formula that fails in the workbook (#REF!, #NAME?, …), typically because it pointed at a sheet that was not copied with the four, is skipped by the check rather than reported as a difference; Scope's own value is used either way. Save as .xlsx or .xlsm (not .xlsb); if the workbook is set to manual calculation, recalculate before saving.

## Errors and warnings

Nothing is silently zeroed. A Security ID missing from Security Mapping, a currency without an FX rate, or a non-numeric nominal **excludes** the position, which is listed with its reason. An investor code missing from Funding Name is kept in the asset totals but in no investor column. An asset held in Holdings but missing from Active Assets is left out of the Output (as in the workbook). Each of these is reported **once per security, code or asset** (not once per row), with the positions and amount involved, on **Data › Issues** and on the Mapping gaps step, where it can be closed. IDs match whether they are stored as numbers or text (`100200`, `"100200"` and `"100200.0"` are the same ID). The key columns are checked against Mapping before anything else: if the column Scope resolved as Security ID matches almost none of the holding IDs in Security Mapping while another Holdings column matches almost all of them, that column is used and the correction is reported (and can be overridden on Data › Columns).
