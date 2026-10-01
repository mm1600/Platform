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
| Row 3 | column headers, from column B |
| Row 4+ | one row per investor × security; rows without a Security ID (copied formula rows showing `0x0`) are ignored |

Formula columns B–F are recomputed by the calculation and compared with the workbook's own values (**Data › Checks**):

| Column | Header | Formula |
|---|---|---|
| B | Mapping | `XLOOKUP(Security Name, Mapping!I, Mapping!J)` |
| C | Unique Identifier | `Investor Code & "x" & Security ID` |
| D | Investor Code | `IF(Model Portfolio = "SINGLE", Portfolio, Model Portfolio)` |
| E | Identification ID | `XLOOKUP(Security ID, Mapping!T, Mapping!S)` |
| F | Code Name | `XLOOKUP(Security ID, Mapping!T, Mapping!Q)` |

Columns the calculation uses (matched on the row-2 output name first, then the row-3 header):

| Role | Output name (row 2) | Header (row 3) |
|---|---|---|
| Model portfolio, portfolio | Model Portfolio, Portfolio | Model Portfolio, Portfolio |
| Security ID, security name | Security ID, Security Name | Security ID, Security Name |
| Reporting date (MIN = reporting date) | Reporting Date | Reporting Date |
| Position currency | Currency | Quotation Currency |
| FX rate (units per EUR; checked against the RC column) | FX Rate | FX Rate EC |
| Nominal (exposure) | Nominal | RA_Commitment QC |
| Drawn | Drawn | Current Drawn Amount CCY |
| Commitment | Commitment | Initial Commitment Amount CCY |
| Nominal in reference currency (FX direction check) | Nominal RC | RA Commitment RC |
| Maturity, purchase date | Maturity Date, Purchase Date | Maturity Date, Purchase Date |
| Rate type, spread, WAL | Rate Type, Spread at Acquisition, WAL | Rate Type, All-in Spread at Acquisition, WAL |
| Ratings | Internal Rating, Closing Rating, Fitch, S&P, Moody's | Internal Current Rating, …Rating_Closing, Rating Fitch, Rating S&P, Rating Moody's |
| Country, instrument, bullet flag, parent issuer, seniority | Country, Instrument, Bullet, Parent Issuer, Seniority | RA Asset Country Name, Security Type Name, RA_Bullet, Parent Issuer Name, Seniority |

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

Columns used: Security ID, Project Name, Code Name, Chronological Order, Subsector, Cashflow Type, Description, Shareholders, Origination, Staff Closing, Upfront, End of NC / MW, IC Date, Funding Date, Total Debt Offering, Watchlist, Investor 2 Sector Classification, Compliance with Financial Covenants. Every column, including those not listed (prepayment protection, jurisdiction tiers, MN classifications, TICS code, …), is shown on the asset page with its cell and is available in the Explorer.

## ESG Hardcoded

Headers in row 3 from column C, keyed by **Security ID**: Security ID, Project Name, Code Name, Infra Code, FM Monitoring (row 2: Staff Monitoring), E Score, S Score, G Score, ESG Score, Shareholders, CHI Sector, CHI Subsector, CHI Subsubsector, CHI Asset Type, CHI Asset Specific, GHG Scope 1, GHG Scope 2, GHG Scope 3.

## What is not in the four sheets

Rules the workbook keeps inside Calculations and Output formulas are collected in **§1 of `js/calc/aum.js`** (and can be overridden per browser on **Data › Views & investors**):

- how each view in Mapping column H is composed (an investor column needs nothing; aggregates such as "Total platform" or a look-through column are defined there);
- each investor column's group (group entity, fund, third party) and attribution weight;
- who holds the units of each fund investor column, and what share (the fund look-through register: the sheets only carry the group's share of a fund);
- the FX exception (one investor, one currency, one view, one rate);
- the IG threshold, maturity buckets, display unit, spread unit and the illustrative concentration thresholds.

## Errors and warnings

Nothing is silently zeroed. A Security ID missing from Security Mapping, a currency without an FX rate, or a non-numeric nominal **excludes** the position, which is listed with its reason. An investor code missing from Funding Name is kept in the asset totals but in no investor column. An asset held in Holdings but missing from Active Assets is left out of the Output (as in the workbook), with one warning per asset. All of these appear on **Data › Issues** with the sheet and row.
