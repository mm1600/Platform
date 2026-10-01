# Scope input schema (CSV)

One CSV per sheet of the existing Excel AUM workbook. All files are UTF-8, comma-separated, first row = headers. Dates are `yyyy-mm-dd` (also accepted: `dd/mm/yyyy`, Excel serials). Amounts are plain numbers in the position currency.

| File | Workbook sheet | Key | Purpose |
|---|---|---|---|
| `holdings.csv` | Holdings (rows 4..1388) | investor × holding | The position extract (SCD / Simcorp). Headers may be the source system's own; `mapping_columns.csv` renames them. Blank rows are ignored (the workbook's padded rows). |
| `mapping_columns.csv` | Mapping C:D | source header | `source_header,canonical_field,required,note`. Maps extract headers to canonical fields. If the extract already uses canonical names no row is needed. |
| `mapping_assets.csv` | Mapping I:J, P:T | holding_id | `holding_id,asset_code,asset_name,code_name,security_id,tranche`. Many holdings (tranches) → one asset. |
| `mapping_investors.csv` | Mapping Y:AA + Output row-3/4 weights | investor_id | `investor_id,investor_key,investor_label,investor_group,group_weight`. `group_weight` is the group inclusion / look-through weight (1 = group entity, 0 = third party, 0.35 = a fund 35% held by the group). `investor_group` ∈ `Group entity`, `Fund`, `Third party`. Without the column nothing is attributed to the group and one warning is raised. |
| `platforms.csv` | Output!G8 choices + special look-through columns | platform_id | `platform_id,platform_label,investor_label,weight`. A platform is a weighted combination of investor columns. `*` = every investor. |
| `ratings.csv` | Mapping AC:AD | grade | `grade,numeric,scale` with scale ∈ SP_FITCH, MOODYS, INTERNAL, ALL. Numeric rises as credit weakens. |
| `fx.csv` | Calculations CU:CW (+ the hard-coded exception) | currency | `currency,rate_per_eur,investor_id,platform_id,note`. Rows with investor/platform are overrides applied only when both match. |
| `hardcoded.csv` | Hardcoded | asset_code | Manual deal attributes: sector, subsector, country, region, sponsor, greenfield_brownfield, repayment_type, cash_flow_type, instrument, origination, deal_year, upfront_fee_bps, protection_end_date, watchlist, deal_lead, covenant_type, lockup_level, default_level, wal_years, total_transaction_size, description. Extra columns are kept and shown. |
| `esg.csv` | ESG Hardcoded | asset_code | esg_score, cbi_taxonomy, ghg_scope1_t, ghg_scope2_t, ghg_scope3_t, ghg_intensity_t_per_eurm, green_loan (Y/N), sfdr_article, data_coverage. |
| `config.csv` | formula constants | key | base_currency, ig_threshold, rating_selection, single_portfolio_token, amount_display_unit, maturity_buckets, reporting_date_rule, dataset_label, attribution_label (display name of the attributed group, default `Group`; every UI label is built from it: "Group attributed", "Group share of book", "Group vs third party"). |
| `fund_lookthrough.csv` *(optional)* | special look-through columns (unit registers) | fund_label × holder_label | `fund_label,holder_label,share,note`. Who owns the units of each fund investor column. See "Fund look-through" below. When absent every page shows direct exposure only, with a notice. |

## Fund look-through (`fund_lookthrough.csv`, optional)

One row per unit holder of a fund investor column. Read by `js/engine/lookthrough.js` (`Scope.engine.lookthrough`); the investor book and the investor page (`#/investor/<label>`) use it.

| Column | Required | Notes |
|---|---|---|
| fund_label | Y | The fund's `investor_label` in mapping_investors.csv (e.g. `Investor 7`). A label that is not an investor column is accepted with a warning: it has no direct exposure and only passes through what it holds in other funds. |
| holder_label | Y | Who holds the units: normally another investor column (Group entity, third party, or another fund). A holder that is not an investor column is kept and carries look-through exposure only (info issue). |
| share | Y | Fraction of the fund's units held, 0–1 (`0.15`); `15%` is also read as 0.15. A share outside 0–1 is an error; it is used as entered, never clamped. Duplicate fund × holder rows are added (warning). |
| note | | Free text, shown on the investor page. |

Rules:

- **Residual.** 1 − Σ shares of a fund is held outside the platform and shown as "External fund holders". Σ shares above 100% is an error (the residual turns negative).
- **Economic exposure.** total(H, asset) = direct(H, asset) + Σ over funds F of share(F, H) × total(F, asset); look-through = total − direct. A fund holding units of another fund is followed to a fixed point, capped at 5 levels; a cycle (including a fund holding itself) is an error and is truncated, never looped.
- **Ultimate holders.** A fund with rows here is a pass-through: in ultimate-holder views it is replaced by its holders plus the external residual, so Σ ultimate holders + external = Σ investor columns = asset total (no double counting). A fund without rows stays a holder in its own right.
- **Consistency with `group_weight`.** Σ share × holder group_weight (Group entity 1, third party 0, a fund at its own weight) should equal the fund's `group_weight` in mapping_investors.csv. A divergence is a warning; Group attribution on every other page keeps using `group_weight`.
- **Filters.** Look-through runs on the engine result after global filters, so a filter that removes a fund's positions also removes the look-through exposure that comes from them.

Demo (SYNTHETIC): Investor 7 (Fund, group_weight 0.35) is held 15% / 10% / 10% by Investors 1, 3 and 5 (Group entities) and 25% by Investor 9 (third party), 40% external; Investor 8 (Fund, 0.20) is held 12% / 8% by Investors 2 and 6 and 30% by Investor 10, 50% external.

## Canonical position fields (`holdings.csv` after mapping)

| Field | Required | Workbook column | Notes |
|---|---|---|---|
| portfolio_id | Y | Holdings G | investor / portfolio identifier; `SINGLE` → use portfolio_alt_id |
| portfolio_alt_id | | Holdings H | |
| holding_id | Y | Holdings I | joins to mapping_assets |
| security_name | | Holdings J | |
| as_of_date | Y | Holdings F | reporting date = MIN over rows |
| currency | Y | Calculations CI | |
| nominal | Y | Calculations CO | |
| drawn | Y | Calculations CQ | blank → 0 (flagged) |
| commitment | | Calculations CS | blank → nominal |
| internal_grade, fitch, moodys, sp | | ratings branch | NR / blank allowed |
| funding_date, maturity_date | | tenor, buckets | |
| coupon_type | | fixed_floating | "Fixed" → Fixed, anything else → Floating |
| coupon, margin_bps, instrument_type | | | |

## What the engine does with them
1. Map headers → canonical fields; blank rows skipped; required fields checked (fatal if absent).
2. Build the position key `investor_id x holding_id`; apply manual adjustments (original kept).
3. Look up asset (holding_id) and investor (investor_id). Unmapped holding → **excluded + error**. Unmapped investor → kept in totals, shown as "Unmapped investor", error.
4. Ratings: internal unless NR, else worst external (Fitch → Moody's → S&P); numeric = MAX(internal, external); SUB IG if numeric > `ig_threshold`.
5. FX: `amount ÷ rate(ccy per EUR) × rate(display ccy per EUR)`; overrides by investor/platform; missing rate → **excluded + error**.
6. Asset totals, investor columns, platform columns (Σ weight × column), group attributed (Σ group_weight × column; engine fields `group_nominal`, `group_drawn`, `group_invested`, Output-row fields `group_nominal_m`, `group_drawn_m`, metrics `book_group_m`, `group_share_of_book`), third party = total − attributed (`third_party_nominal`, `third_party_drawn`).
7. Output rows = assets with platform nominal > 0; exposure-weighted metrics and distributions.

Everything computed carries a provenance descriptor: `imported` (file + line + column), `manual` (adjustment with original, reason, user, time) or `calculated` (formula note).
