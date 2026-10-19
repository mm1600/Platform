# Scope, step by step

This document explains what Scope does with your workbook, from the moment you load it to the last slide of a deck, in the order it happens. It is written for checking, not for coding: every step uses your workbook's words, gives the exact conditions and numbers, and shows a worked example where one helps. Read it end to end before taking Scope into production.

For a short overview of only the places where the data is changed, read "Scope at a glance" (docs/scope-at-a-glance.md) first.

**How to read it**

- There are ten stages. Each one says what goes in and what comes out, then walks through the sub-steps in the order Scope runs them.
- **Scope's choice** marks something Scope decides that your workbook doesn't, or that you never specified. These are the points to check hardest (54 of them).
- **Silent** marks something Scope skips or changes without telling you on screen (29 of them).
- The grey references at the end of a step, like [POS-080], are rule numbers in the sign-off checklist (docs/production-signoff.html). Every one of the 1718 rules there is mentioned here at least once, so you can read a step and tick its rules as you go.
- "The workbook" means your AUM Excel workbook; "a view" is one of the platform choices on the Output sheet (Total platform, Group, an investor, a region, a look-through view).

**The ten stages**

1. Loading your files — how the workbook, CSVs or pasted ranges are read, saved and shared.
2. Scope Settings and the Ownership grid — settings, investor columns, views, FX exceptions, who owns what.
3. From Holdings rows to positions — each row becomes a position: amounts, currency, FX, rate type, spread, rating, maturity, exclusions.
4. From positions to assets — Mapping lookups, active assets, an asset's attributes, groups, ratings, ESG.
5. Views: who owns what — how each view's share of every asset is worked out, including look-through.
6. The Output sheet and the metrics — every Output column, totals, metrics and checks.
7. The pages you see — the AUM page, filters, explorer, pivot, concentration, ESG and investor pages, and Ask Scope.
8. Asset write-ups — reading the write-ups workbook and matching each write-up to an asset.
9. The investor deck — slide by slide, from the cover to the file name.
10. The analysis pack, the pack designer and templates — the other decks and how your firm's template is used.

165 sub-steps in all.

## 1. Loading your files

What goes in: the AUM workbook (.xlsx or .xlsm), or one CSV / text file per sheet, or a range copied from Excel and pasted into Scope, plus anything you have changed in the app before (column choices, settings, manual corrections, rows added to Mapping). What comes out: a plain copy of each sheet, cell by cell, addressed exactly like Excel (row 3, column AK is still AK3), saved in this browser, and the rules the calculation uses to read every cell of those copies. Nothing in this stage decides what a header means; that is stage 3.

### 1.1 Which files Scope reads and how each is recognised

1. Scope reads only .xlsx, .xlsm, .csv, .tsv, .tab and .txt files. A .xls, .xlsb, .ods or .numbers file is skipped with the advice to save it as .xlsx or as one CSV per sheet; any other extension is skipped with a message listing the accepted types. [IN-234]
2. The calculation uses four sheets, spelt Holdings, Mapping, Hardcoded and ESG Hardcoded. Two more are optional and are read when present but never reported missing: Ownership and Scope Settings. The workbook's own Output and Calculations tabs are also kept when present, but only to compare Scope's figures with them on Data › Check my data (7.16); they never feed the calculation. [IN-148, IN-204]
3. A workbook tab counts as one of these sheets only if its name equals the sheet name once capitals, spaces, underscores, hyphens and dashes are ignored. 'esg_hardcoded', 'ESGHardcoded' and 'hard-coded' match; 'Old Holdings' or 'Holdings2' do not (any extra word means no match). [IN-205]
4. A CSV / text file is one sheet, named by its file name. Scope drops the folder, the extension and a browser copy marker such as ' (1)', then requires the name to end with a sheet name that starts at a word boundary: a space, underscore, hyphen or punctuation before it, or a change from a small letter to a capital ('BookHoldings'). When several sheet names fit, the longest wins, so 'AUM_ESG_Hardcoded.csv' is ESG Hardcoded, not Hardcoded. 'My workbook - Holdings.csv' matches; 'Shareholdings.csv', 'Holdings 2026.csv' and 'bookholdings.csv' do not. [IN-206]
5. A text file whose name does not say which sheet it is is skipped with a warning telling you to name it after a sheet (for example 'Holdings.csv'). [IN-233]
6. When you drop several files at once they are applied in the order given; a sheet from a later file replaces the same sheet from an earlier file, with a warning ('Holdings: Holdings.txt replaces the sheet read from AUM.xlsx'). [IN-229]
7. A file that cannot be read at all (for example a damaged .xlsx) becomes a warning ('could not be read …') and the other files are still read. [IN-235]

### 1.2 Reading an Excel workbook

1. A file that starts with the old Office signature is refused with 'remove the password or save it as .xlsx': it is either password-protected or an old .xls renamed. [IN-214]
2. Very large workbooks stored in the extended (over 4 GB) zip format, workbooks with encrypted parts, and parts compressed with anything other than the two standard methods are refused with a message ('ZIP64 workbooks are not supported; re-save the file in Excel', 'the workbook is encrypted', 'unsupported compression method'). [IN-215]
3. Only the tabs whose names match one of the eight sheet names (the six of rule 1.1.2 plus Output and Calculations, kept only for the check) are opened and read; every other tab (notes, Quarterly Reporting) is ignored and never decompressed. [IN-230]
4. If two tabs of the same workbook match the same sheet (for example 'Holdings' and 'holdings '), the first in tab order is used and a warning names both. [IN-232]
5. If the workbook lacks one of the four input sheets, a warning lists the tabs it does have ('Partial.xlsx: no "Mapping" sheet found (tabs: "Holdings")'), unless another file dropped at the same time supplies that sheet. [IN-236]
6. A tab listed in the workbook whose cell data is missing from the file reads as an empty sheet, with a warning that it 'reads as empty'. [IN-224]
7. Cell positions come from Excel's own cell references; where a cell or row has none, it is placed right after the previous cell or row. [IN-218]
8. What each cell becomes:
   1. A number cell stays a number (its stored value, not what Excel shows). A stored value that is not a valid number is kept as text. [IN-221, IN-231]
   2. The four input sheets are read as stored values: a cell showing 6.6% holds 0.0662 and is read as 0.0662; a date is read as its Excel date number (46295 for 30 Sep 2026). Only the separate write-ups workbook is read as displayed (1.10). [IN-231]
   3. Text cells are read with every formatting run joined into one text (Japanese reading guides left out); an empty text or a text cell pointing at a missing entry is blank. [IN-222]
   4. Cell text has Excel's escape codes decoded ('_x0041_' becomes 'A'; '_x005F_' is a literal underscore) and Windows line breaks inside a cell turned into plain line breaks. [IN-216]
   5. An error cell becomes its error text, such as '#N/A' or '#DIV/0!'. [IN-219]
   6. A TRUE / FALSE cell becomes the text 'TRUE' or 'FALSE'. [IN-220]
   7. A date stored as text in the ISO form (yyyy-mm-dd, optionally with a time) is turned into an Excel date number in the workbook's own date system (1,462 lower in a 1904 workbook); text that does not read as such a date stays text. [IN-217]
   8. A formula cell is read as the result Excel last saved. A formula with no saved result is blank, and the sheet gets a warning counting them ('1 formula cell without a saved value (read as blank); open and save the workbook in Excel'). [IN-225]
9. A workbook set to the 1904 date system gets a warning, but its date numbers are passed on unchanged. **Silent:** beyond that one warning, every date in such a workbook is read 1,462 days (about four years) early, because the calculation assumes the standard 1900 system: a maturity of 30 Jun 2031 is read as 29 Jun 2027. [IN-223]

### 1.3 Reading a CSV or text file

1. The file's characters are decoded as UTF-16 when it starts with a UTF-16 byte-order mark (Excel's 'Unicode Text'), otherwise as UTF-8 when it is valid UTF-8, otherwise as Windows-1252 (Excel's plain 'CSV' on Windows, so £, é and – survive), otherwise as Latin-1. [IN-228]
2. A leading UTF-8 byte-order mark is dropped; a file with only old-Mac line endings (CR) is read line by line all the same. [IN-207]
3. The separator is decided on the first line (of the first 50) that contains a tab, comma or semicolon outside quotes: a tab means tab-separated, otherwise a comma, otherwise a semicolon; with none at all, comma. A tab wins even when that line has more commas. So 'Name;Amount' is semicolon-separated, but 'a;b,c' is comma-separated and 'a;b' is then one cell. [IN-209]
4. A cell that starts with a double quote may hold separators, line breaks and doubled quotes, as Excel writes them, but only if its closing quote is followed by a separator, a line break or the end of the file; otherwise the whole cell is kept literally, quotes included ('"ab"c' stays '"ab"c'; '5" pipe' stays '5" pipe'). A separator at the very end of a line adds one more empty cell. [IN-210]
5. Text is kept exactly as typed: no trimming, leading zeros kept ('007'), '=1+1' stays text, and numbers stay text ('1,234.50') until the calculation reads them (1.8). [IN-211]
6. An empty cell is blank; blank cells at the end of a row and blank rows at the end of the sheet are dropped; blank rows inside the sheet stay as empty rows, so row numbers keep matching the workbook. [IN-212]

### 1.4 Pasting a range from Excel

1. Each sheet card on Data › Inputs has a Paste button. You paste the copied cells (Excel copies them tab-separated) and give the cell where the pasted range starts; it is A1 unless you type another. A start cell such as C3 adds two blank rows above and two blank columns to the left, so cell references (Holdings!B4) stay identical to the workbook. A start cell that is not a cell reference ('nope') is refused with a message. [IN-208]
2. The pasted text is read with exactly the rules of 1.3 (separator, quotes, kept-as-typed, blanks). An empty paste, or one that yields no cells, is refused. [IN-209, IN-211, IN-212]
3. The pasted sheet replaces only that sheet; the others stay as they were (1.5).

### 1.5 Putting the sheets into Scope: merging, the demo, monthly updates, saving

1. Only the six sheet names, and the Output and Calculations tabs kept for Data › Check my data, are ever stored; anything else read from a file is dropped. [IN-148, IN-204]
2. Dropping files on Data › Inputs loads the four input sheets and the Ownership sheet found in them, and keeps every sheet you did not supply, so CSVs can arrive one at a time. An older 'Scope Settings' tab inside the workbook is loaded too (it carries the FX exceptions and settings). [IN-204]
3. The settings-file loader takes only the Ownership sheet (or, failing that, Scope Settings) from the file; if the file also holds the four input sheets they are not loaded, and a note says to drop the workbook in step 1 for those.
4. Scope starts on a synthetic demo workbook (labelled SYNTHETIC DEMO) when nothing of yours is saved. Loading any sheet of your own removes every demo sheet, including the demo's Ownership and Scope Settings, so a sheet you have not loaded yet shows as missing rather than as demo data; a note lists which sheets are still to load. Loading only a settings sheet while the demo is in place asks for confirmation first.
5. A Holdings sheet loaded over your own (non-demo) Holdings is treated as the monthly update: the previous Holdings is kept for one step of undo ('Restore previous Holdings'), replacing any older kept copy. The kept copy is also what the quarterly deck compares against for quarter-on-quarter figures. Restoring puts the kept copy back and drops the current one.
6. Your sheets, the rows you added to Mapping (1.6) and the kept previous Holdings are saved in this browser's own database, so they are still there next time; the demo is never saved. At start-up Scope reloads what was saved, and only if nothing was saved does it load the demo.
7. If the browser could not read the saved workbook at start-up, Scope does not save anything for the rest of the session (so a single newly dropped sheet cannot overwrite a whole saved set) and says so once. If saving fails (storage blocked or full), a message says the sheets stay for this session only.
8. 'Clear all sheets' removes every sheet (the four inputs and the settings sheets) and the saved copy; the demo stays available through Reset to demo.
9. While none of the four input sheets is loaded, no calculation runs and pages show 'nothing to show'.

### 1.6 Rows you add to Mapping in the app

1. On Data › Setup you can close a mapping gap (an unmapped security, an unknown investor code, an inactive asset) by adding a row to a Mapping table. The original sheet is never changed: each time the sheets are read, Scope appends your rows below the table. [IN-173]
2. Each added row goes on the first row below the last filled row of its table (or straight under the headers if the table is empty), in that table's own columns. For a Security Mapping row the holding ID is also written in the helper column just left of the table (column P in the workbook), when that column has no header. [IN-173]
3. Added rows are read exactly like the workbook's rows, and marked as added on the Data pages. [IN-173]
4. An added row whose table cannot be located on the current Mapping sheet is left out and listed as not applied.
5. **Scope's choice:** added rows stay in force when you drop a new workbook (files are merged, 1.5.2); they are cleared only when the demo is loaded, when everything is cleared, or by removing them on Data › Setup. If the new workbook already contains the same Security Mapping or Funding Name row, the workbook's own row is above yours and wins, and a 'appears twice' warning is raised (3.7).

### 1.7 What else is saved in this browser

1. Calculation settings changed in the app are saved in this browser: column choices (Data › Columns), the parameters on Data › Formulas, investor display names, the FX quote, the FX exceptions and the Ownership grid edited in the app. They apply to whatever workbook is loaded, and they win over the workbook's own settings sheets (2.2). [IN-029]
2. Manual corrections are saved in this browser with the original value, the new value, the reason, the user and the time. A new correction of the same field of the same position replaces the earlier one, which stays in the history; reverting a correction brings back the one it replaced. Which fields can be corrected and how a correction is applied is in 3.12. [IN-026, POS-074]
3. The view and display currency chosen in the top bar, and the global filters, are also saved in this browser. Choosing a new view drops any look-through filter (an investor or segment of the old view).
4. When the team uses a shared folder (1.12), the settings in 1 and the corrections in 2 also go to the folder when you save; the view, currency and filters in 3 never do.

### 1.8 How the calculation reads a cell

These rules apply to every cell of every sheet in stages 2 and 3.

1. Blank means: an empty cell, text made only of spaces, or one of the Excel errors #N/A, #REF!, #VALUE!, #DIV/0!, #NAME?, #NULL!, #NUM! (capitals and surrounding spaces ignored). Such a cell counts as blank everywhere: a Security ID of '#N/A' means the row is skipped; a nominal of '#N/A' means the nominal is missing. Other error texts (#SPILL!, #CALC!, #GETTING_DATA) are treated as ordinary text. [IN-197, POS-062]
2. Text is trimmed of leading and trailing spaces before use (' Investor 1 ' is 'Investor 1'). [IN-198]
3. Identifiers (Security ID, holding ID, identification ID, investor code, code name) are compared trimmed, with inner runs of spaces made single, capitals ignored and a trailing '.0' removed. So 100200 stored as a number in one sheet, '100200' as text in another and '100200.0' are the same holding; 'ab 12' equals 'AB  12'. What is shown keeps the sheet's own spelling. [IN-199]
4. Security names are compared trimmed, inner spaces made single, capitals ignored ('Alpha  Wind' equals 'alpha wind'). [IN-200]
5. Header names and output names are compared after removing everything but letters and digits and ignoring capitals: 'RA_Commitment QC', 'racommitmentqc' and 'RA Commitment QC' are the same header. [IN-115]
6. An amount or rate typed as text is read the Excel way: spaces, commas, €, £ and $ are removed, a trailing % is removed but the value is NOT divided by 100, and brackets mean negative. '1,234.50' is 1234.5; '(1,234)' is -1234; '€ 3 000' is 3000; '5%' is 5. A comma is always a thousands separator, so '1,5' is 15. Anything else (for example 'n/a') is not a number; it never silently becomes 0. **Silent:** an amount typed with a decimal comma ('1,5' for one and a half) is read as fifteen without a message. [IN-201, POS-082]
7. A date cell holding a number strictly between 20,000 and 80,000 is an Excel date number (day 0 = 30 Dec 1899); any time of day is dropped (46295.75 is 30 Sep 2026). [IN-202, POS-090]
8. Other dates are read from yyyy-mm-dd, dd/mm/yyyy or dd.mm.yyyy. When the first part is above 12 it is the day; when only the second part is above 12 the text is read as month/day/year; when both are 12 or less it is read day first ('03/04/2026' is 3 April 2026, '04/13/2026' is 13 April 2026). An impossible date ('31/02/2026') is no date. A five-digit text is read as an Excel date number. As a last resort anything the browser understands as a date ('1 Jan 2027') is accepted. A number outside 20,000 to 80,000 is read as text, so 2026 becomes 1 Jan 2026. **Scope's choice:** day first for ambiguous dates, where Excel follows the computer's regional setting. [IN-203, POS-091]

### 1.9 When the calculation runs

1. Every page uses one result: the calculation of section 3 onwards, run on the loaded sheets (with your added Mapping rows), your saved settings, your active manual corrections, the selected view and the selected display currency. It is recalculated whenever any of these changes.
2. With global filters, Scope calculates twice: first on everything, so a filter can use any field of the result; then again on only the Holdings rows whose records pass the filters, so every total, chart and export agrees with the filtered view. Data-quality messages always describe the whole input, not the filtered view. How filtered-out rows are left out is in 3.30. [POS-127]
3. **Silent:** a saved filter on a field that no longer exists in the result is ignored without a message.

### 1.10 The write-ups workbook: numbers as Excel shows them

The asset write-ups workbook (Layer 2 › Write-ups) is the one input read as displayed rather than as stored values: each number becomes the text Excel shows under its cell's number format ('6.62x', '70%'). The four input sheets never go through this. [IN-259, IN-231]

1. Cells without a custom format use Excel's built-in format list; the built-in date formats are taken day first (format 14 shows 30/09/2025, format 22 shows 30/09/2025 with the time), whereas Excel follows the computer's regional setting (a US Excel shows 9/30/2025). An unknown format number is General. [IN-240]
2. General shows whole numbers as they are and other numbers to 10 significant digits (1/3 shows 0.3333333333). Text and values that are not finite numbers are returned unchanged. [IN-241, IN-242]
3. A format with conditions such as [>=1000] uses the first section whose condition holds, otherwise the first section without a condition (else the last); negatives then get a leading '-'. [IN-243]
4. A format with sections (positive;negative;zero;text) uses the second section for negatives (shown without a minus sign) and the third for zero; with a single section a negative gets a leading '-'. An empty section shows nothing. [IN-244, IN-247]
5. Elapsed-time formats [h], [m], [s] show the whole span in that unit, then the remainder as a time (1.5 under [h]:mm shows 36:00). [IN-245]
6. A currency code in brackets ([$€-x]) shows its symbol as text; other bracketed codes (colours, locales) are dropped. [IN-246]
7. A section that is '@' or 'General' gives the General form; 'General' with literal text replaces General by the number ('General"x"' shows 5x). [IN-248]
8. A section with year/month/day/hour/second letters and no digit symbols (0, # or ?) is a date or time: yy or yyyy year; m, mm month number; mmm short and mmmm full month name; d, dd day; ddd, dddd weekday; h, hh hours (12-hour with AM/PM); s, ss seconds; 'm' straight after hours or before seconds means minutes. Month and day names are English. [IN-249]
9. Scientific (0.00E+00) and fraction (# ?/?) formats are not reproduced: the number is shown in General form (0.5 shows 0.5, not 1/2). [IN-250]
10. Quoted text, backslash-escaped characters and other plain characters (x, EUR, bps) are shown as typed; '_' adds a space; '*' fill is dropped. A section with literal text but no digit symbols shows only the text. [IN-251, IN-252]
11. Each % multiplies by 100 and is shown; each comma right after the digit symbols divides by 1,000 ('#,##0.0,,"m"' shows 1,234,567 as 1.2m). [IN-253, IN-254]
12. Rounding is Excel's (on the 15-digit decimal, so 2.675 under 0.00 shows 2.68). After the decimal point each 0 or ? is always shown and each # only when not zero; the point is dropped when no decimals remain (7 under #.## shows 7, where Excel shows '7.'). The number of 0s before the point is the minimum count of integer digits (5 under 000 is 005; 0.5 under #.0 is .5). A comma among the whole-number digit symbols groups thousands with ','; the decimal point is always '.', whatever the computer's regional setting. [IN-255, IN-256, IN-257, IN-258]

### 1.11 Sheets and tables going back out

1. A sheet downloaded as CSV (Download CSV on a sheet card, or the Ownership grid) uses Windows line endings; a cell is put in quotes when it holds a quote, comma, semicolon, tab or line break; blanks are empty; TRUE/FALSE stay as such; dates are written yyyy-mm-dd. Reading that file back gives the same cells. [IN-213]
2. A sheet downloaded as .xlsx writes numbers as numbers (a value that is not finite as #NUM!), TRUE/FALSE as true/false values, dates as Excel date numbers shown as short dates, and everything else as text; blank cells are left out. Tab names lose : \ / ? * [ ] (each replaced by _) and leading or trailing apostrophes, are cut to 31 characters, a blank name becomes SheetN, and repeated names (capitals ignored) get ' (2)', ' (3)'. [IN-226, IN-227]
3. Every table export (Output, grids, pivot, issues, corrections) is a CSV with plain line endings and a final line break; a field is quoted only when it holds a quote, comma or line break (not for semicolons or tabs); dates are yyyy-mm-dd; blanks empty; columns follow the first record unless given. Text that Excel would run as a formula (starting with =, +, @, or a minus not followed by a number) gets a leading apostrophe so Excel shows it as text; numbers, including negatives, are unchanged. The sheet download of point 1 is not altered this way. [IN-238, IN-239]
4. Scope also contains a simple comma-only CSV reader for its own scripts and tests (it trims cells, drops a byte-order mark, keeps blank inner rows so line numbers stay right). It is never used for your input files. [IN-237]

### 1.12 One copy for the team: the shared folder

1. Each person picks the shared folder once, on the Shared folder page (Layer 0), for example a folder on the team drive. Only Edge and Chrome can write to a folder, also when Scope is opened as a file; in other browsers the page says so and everything else works as before. Scope remembers the folder: on later visits it reconnects by itself when the browser allows it, otherwise the top bar shows Reconnect shared folder (one click). [SHR-005]
2. **Scope's choice:** what goes to the folder and what stays yours. The folder holds the loaded workbook sheets (Output and Calculations too when loaded), the Mapping rows added in the app, the corrections, the calculation settings (Ownership grid, column choices, parameters, FX), the investor reporting inputs, report style and template text colour, the write-ups and their links, the market curves and the PowerPoint template. Your view, currency, look-through, filters, name, saved Explorer views, grid layouts, filter sets, custom sheets, designer layouts and the one-step undo of a Holdings update stay in your browser. [SHR-001]
3. An empty folder is started with what is open as version 1, never from the demo. A folder that already holds data is loaded on first use, after a confirmation; that replaces the shared data in this browser. [SHR-006]
4. Each version is signed with the name typed on the Shared folder page; it is asked once when missing and kept in this browser. The browser cannot read the Windows login. [SHR-021]
5. Every open Scope reads the folder's small head.json every 20 seconds, when you come back to the tab, and before a deck is built. [SHR-008]
6. When someone saved since your version, the top bar says "Newer version 13 saved by Alex at 5 Nov, 14:05 · "October holdings"", with What changed and Refresh. Nothing on your screen changes until you click Refresh. [SHR-009]
7. Your changes are kept in this browser as you make them (1.7). Scope also remembers which version you started from, so even after the browser is closed it knows what you have not saved; the top bar badge shows "v12 · 3 unsaved". [SHR-007]
8. When a version comes in (Load, Refresh, View, Restore), the shared data in this browser is replaced, saved here and recalculated; your view, currency, filters and name are left alone. A shared setting the version does not have is cleared. [SHR-002]
9. **Silent:** a version with a different Holdings sheet drops this browser's one-step undo of a monthly update (1.5); the history replaces it. [SHR-003]
10. The PowerPoint template is written to the folder as text and turned back into the same bytes in every browser. [SHR-004]
11. The folder holds repo.json, head.json (the newest version), lock.json, tags.json, history/ (one file per version, never changed once written, with a full copy every 10 versions and a quick list) and blobs/ (large values such as a sheet or the template, stored once however many versions use them). [SHR-015]

### 1.13 Saving a version, merging, history

1. Save first takes the folder's lock: Scope writes its own token into lock.json, waits 0.8 seconds and reads it back, and goes on only if its token is still there. While someone else is saving it waits and says who; a lock unchanged for 30 seconds (a closed tab, a crashed PC) is taken over. [SHR-010]
2. Holding the lock, Scope reads the newest version. If it is still the one you started from, your changes are written as the next version: who, when, your note, and each change with its value before and after. If someone saved in between, Scope first brings their version in with your changes on top, then saves. [SHR-011]
3. **Scope's choice:** changes merge field by field. A field only you changed takes yours, one only they changed takes theirs. Lists whose items carry an id (Mapping rows added in the app, corrections) merge row by row, so when two people add rows both are kept. [SHR-012]
4. **Scope's choice:** a field you both changed to different values is a question. Scope lists each one with their value and yours, the pick starting on theirs; Keep these applies the picks and leaves your other changes unsaved on top. Not now keeps you on your version, and Save waits until the merge is finished. [SHR-013]
5. One second after saving, Scope reads the newest version again and follows the history back to check its version is in it. If a very slow share let another save overwrite it, Scope merges and saves again; if that ever went unnoticed, the changes come back as unsaved at the next Refresh. A save is never dropped. [SHR-014]
6. The history on the Shared folder page lists every version, newest first: who, when, the note, how many changes, tags, with yours marked. Changes says in words what one version changed ("Holdings sheet: replaced (240 → 251 rows)", "Calculation settings › FX quote: set to eur_per_ccy", "Corrections: 1 added"); Compare shows the differences between any two versions. [SHR-016]
7. View opens an old version in the whole app, every page and deck included, and puts your own data aside; Back to latest brings it back, unsaved changes included. Changes made while viewing are not kept. [SHR-017]
8. Restore saves a new version equal to an old one ("Restored version 9"); nothing in the history is erased, so a restore can itself be undone. Unsaved changes in this browser are dropped after a confirmation. [SHR-018]
9. A version can be named ("Q3 sign-off", "Sent to Investor 4"); a name used again moves to the new version, and clicking a tag removes it. [SHR-019]
10. Building the investor report, the analysis pack or a designer deck first checks the folder; if a newer version is there, Scope asks whether to build from your version or refresh first. [SHR-020]

## 2. Scope Settings and the Ownership grid

What goes in: the built-in defaults in the calculation file, the optional Scope Settings sheet (Settings, Investors, Views and FX Exception tables), the optional Ownership grid (the sheet, or the grid edited in the app) and the settings changed in the app. What comes out: the settings in force for this run (IG threshold, FX rules, spread unit, maturity buckets and the rest), each investor column's type, display name and group ownership as typed, each view's definition as typed, the FX exceptions, and the grid's rows of shares. This stage only reads and checks these tables; turning them into the Group view, the composite views and the look-through is the next stage.

### 2.1 Built-in defaults (what the four sheets do not hold)

Unless the Scope Settings sheet or the app says otherwise, Scope uses these values. Each is used in the stage named.

1. Base currency EUR: every amount is converted into it (a GBP loan of 10m at 0.855 GBP per EUR is 11.70m EUR). The Holdings rates are rates against EUR whatever this setting says, so setting another base currency (say GBP) would leave GBP positions unconverted while every other currency is still read as EUR. Scope warns when the base currency is not EUR and tells you to pick the other currency as the display currency instead, which converts correctly. [IN-001]
2. FX quote 'auto': Scope tests both amount ÷ rate and amount × rate against the extract's own reference-currency amount and uses whichever reproduces it (3.25); the workbook itself always divides. [IN-002]
3. FX rate source 'workbook': one rate per currency, the rate on the reference investor's first Holdings row in that currency, as the workbook's Calculations CU:CW do. The alternative 'position' uses each row's own rate (3.28). [IN-003]
4. FX reference investor: blank, meaning the first investor column listed in Mapping column H, failing that the first investor in Funding Name (3.24). [IN-006]
5. Nominal currency 'auto' (decided per workbook by testing nominal against drawn + unfunded, 3.27); drawn and commitment in the quotation currency (divided by the rate), as the workbook does. [IN-005, POS-169]
6. Drawn of an '<investor> incl. part in funds' view: blank, as in the workbook (whose drawn block has no such column and shows #N/A); 'show' calculates it. [IN-004]
7. IG threshold 610 on the Mapping Investment Grade scale (higher score = weaker): a score strictly above 610 is SUB IG, 610 or below IG. Changing it to 400 makes a 500-score position SUB IG (3.21). [IN-007, POS-138]
8. The word that switches the investor code to the Portfolio column is 'SINGLE' (3.11). [IN-008, POS-064]
9. Output amounts are shown in millions (divided by 1,000,000: 125,400,000 shows as 125.4). [IN-009]
10. Maturity buckets 0-3, 3-5, 5-10, 10-20 and 20+ years (3.22). [IN-010, POS-101]
11. The attributed investor group is called 'Group' in every label ('Group attributed', the Group view). [IN-011]
12. Spread unit 'auto' (3.17). [IN-012]
13. Views: only 'Total platform' (every investor column) is defined; a view equal to an investor column needs no definition; any other name in Mapping column H ('Region A') is undefined until the Ownership grid, the Scope Settings sheet or the app defines it. [IN-013]
14. Investors: no investor column has a type (it shows as Unclassified) or a group ownership. The five types an investor column can be given are Group entity, Partly owned, Fund, Third party and Mandate. [IN-014, IN-020]
15. FX exceptions: none. The workbook's hard-coded FX exception is not built in; no position gets a special rate unless an FX Exception row is supplied (2.10). [IN-015]
16. Regions for the region breakdown: United Kingdom and Ireland are 'UK & Ireland'; France, Germany, Spain, Italy, Netherlands, Belgium, Portugal, Finland, Sweden, Denmark, Norway, Switzerland, Austria, Poland and Luxembourg are 'Continental Europe'; every other country (Greece, United States) is 'Rest of world'. Country names are compared ignoring capitals and punctuation, and a trailing bracket is ignored ('Netherlands (the)'). [IN-016, IN-017, IN-018]
17. Concentration page limits, illustrative and not mandate limits: single name 10%, sponsor 20%, sector 35%, country 30%, sub-IG 25%, non-base currency 40% of exposure. [IN-019]
18. **Scope's choice:** display unit (millions), regions and concentration limits can only be changed in the calculation file, not in the sheet or the app (2.4). [IN-043]

### 2.2 Which settings win

1. Each setting takes the value changed in the app if there is one, else the value in the Scope Settings sheet, else the built-in default of 2.1. Example: default IG threshold 610, sheet 600, app 400: 400 is used. [IN-029, POS-011]
2. The Scope Settings sheet is used only if it is loaded and has at least one row; an empty tab is treated as absent, without a message. [IN-028, POS-012]
3. Maturity buckets given as text (from the app) are split on commas or semicolons and trimmed ('0-5, 5-10, 10+' gives 0-5, 5-10, 10+). If the result is empty or not a list (for example ','), the default 0-3 / 3-5 / 5-10 / 10-20 / 20+ is used, without a message. [IN-032, IN-033, POS-014, POS-015]
4. An FX quote chosen in the app, including 'auto', always replaces the sheet's and the default. [IN-034, POS-016]
5. For ownership and views, the Ownership grid wins over the Scope Settings sheet when both exist; the Scope Settings sheet still supplies the FX exception and the settings. Example: Scope Settings sets every ownership to 0, the Ownership grid says Investor 1 = 100%: 100% is used. [IN-030]
6. If the Ownership grid has been edited in the app and has at least one row, it replaces the workbook's Ownership sheet entirely; otherwise the Ownership sheet is used if it has rows. Example: the workbook says Investor 5 = 10%, the grid edited in the app says 100%: 100%. Either way the grid only defines views and ownership; it never changes the four input sheets. [IN-031, POS-013, IN-098]
7. FX exceptions: those set in the app, if any have been saved, replace the sheet's list; else the Scope Settings FX Exception table if it has rows; else the built-in list (empty). [POS-154]

### 2.3 Finding the tables on the Scope Settings sheet

1. The sheet is the tab named 'Scope Settings' (capitals, spaces, underscores and hyphens ignored: 'scope_settings' works). [IN-035]
2. Each table is found by a title cell. Investors table: 'Investors', 'Investor columns', 'Group ownership' or 'Ownership'. Views table: 'Views', 'Weights', 'View weights', 'Investor weights' or 'View formulas'. 'FX Exception' or 'FX Exceptions'. 'Settings'. Capitals, spaces and punctuation are ignored. [IN-036]
3. A title is looked for in the first 300 rows and first 60 columns, row by row from the top, left to right; the first matching cell is used. If 'Investors' is in B2 and again in B40, the B2 table is used. [IN-068]
4. Each table's headers are on the row under its title and are read from the title's column rightwards, at most 20 columns, and never into the next table's title column to the right; so tables can sit side by side (Investors title in B, Views title in G: the Investors headers are read from B to F only). [IN-070]
5. A table is read from the row under its headers down to the first row where every recognised column is blank; rows below a gap are ignored without a message (Investors rows 4 to 20, row 21 blank, row 22 'Fund 7': Fund 7 is not read). [IN-069]
6. The Settings table is read first, so a renamed attribution label is known before the Views table's attribution row is looked for (Settings 'Attribution label' = 'Demo Group' makes a Views row 'Demo Group' the attribution row). [IN-071]
7. A sheet with neither an Investors nor a Views table gets a warning ('no "Investors" or "Views" table found'). [IN-081]

### 2.4 The Settings table

1. Its columns are 'Setting' and 'Value'. Each row's setting name is compared ignoring capitals, spaces and punctuation ('I.G. threshold' is IG threshold). [IN-072]
2. Only these settings are understood: attribution label, IG threshold, base currency, FX quote, nominal in, drawn in, commitment in, look-through drawn, FX rate source, FX reference investor, spread unit, 'Single portfolio token' (the SINGLE word), maturity buckets. A row with any other name, or with a blank value, is skipped without a message ('Display unit' = 1000 or 'Single name limit' = 15 have no effect). [IN-043, IN-072]
3. How each value is read:
   1. Attribution label: the text, trimmed. [IN-044]
   2. IG threshold: a number read as in 1.8.6 (thousands separators, % and currency signs removed: '610' is 610). [IN-044]
   3. Base currency: the text trimmed and in capitals (' gbp ' is GBP). Any text is accepted. [IN-044]
   4. FX quote: anything containing 'auto' is auto; else containing 'EUR per', '×', 'multiply' or 'eurperccy' means multiply by the rate; else containing 'per EUR', '÷', 'divide' or 'ccyper' means divide; anything else is invalid. 'GBP per EUR' is divide, 'EUR per GBP' is multiply. [IN-045]
   5. Nominal in, Drawn in, Commitment in: a value starting with 'auto' is auto; starting with 'rc', 'report', 'eur', 'already' or 'base' is the reporting currency (already EUR, not converted); starting with 'pc' or 'portfolio' is the portfolio's currency; starting with 'qc', 'quot', 'ccy', 'position' or 'own' is the quotation currency (divided by the rate); anything else is invalid. 'Reporting currency' is rc; 'QC' is qc. **Scope's choice:** 'auto' is accepted for drawn and commitment too, although only the nominal is ever detected (3.27); for those two, auto is then treated like the quotation currency. [IN-056, POS-170]
   6. Look-through drawn: 'show' when the value starts with show, yes, on or calc; any other value, typos included ('No', 'shw'), means blank, and never warns. [IN-046]
   7. FX rate source: any mention of workbook, reference, first or 'one rate' means the workbook rule; otherwise position, own rate, each, per row or row by row means each position's own rate; anything else is invalid. The workbook words win when both appear ("Workbook: one rate per currency, from the reference investor's first row" is the workbook rule). [IN-047, POS-161]
   8. FX reference investor: the text, trimmed (an investor column or display name). [IN-048]
   9. Spread unit: containing 'bp' is basis points; else containing 'per' is percent; else containing 'auto' is auto; anything else is invalid ('basis points' has no 'bp' and is rejected with a warning; 'Basis points (bps)' is bps; 'Percentage' is percent). **Scope's choice:** 'per' is tested before 'auto', so a value such as 'Auto (below 20 is percent)' is read as percent. [IN-049, POS-112]
   10. 'Single portfolio token' (the row that sets the SINGLE word): the text, trimmed. [IN-050]
   11. Maturity buckets: split on commas or semicolons, trimmed, empty pieces dropped ('0-3; 3-7; 7+' gives 0-3, 3-7, 7+). [IN-050]
4. A value that cannot be read (an IG threshold of 'six hundred', an unrecognised FX quote, FX rate source or spread unit, an unreadable amount currency) is ignored with a warning naming the row, so the default stays. [IN-073]

### 2.5 The Investors table

1. Its columns are found by header, the first matching column winning: investor column = 'Investor column', 'Investor', 'Holdings Name' or 'Column'; type = 'Type', 'Investor type' or 'Class'; display name = 'Display name', 'Name' or 'Shown as'. [IN-037]
2. The group-ownership column is any header containing 'ownership', 'weight', 'attribut' or 'share' ('Group share', 'Attribution weight'). A header of just '%' is not recognised, because punctuation is removed before the test. [IN-038]
3. A row whose investor-column cell is blank is skipped without a message (a row with Type = Fund but no investor column is ignored). [IN-074]
4. When an investor column appears twice, the first row is used and a warning is raised (Investor 1 at 100% on row 4 and 50% on row 30: 100%). [IN-075]
5. The ownership cell is read as in 2.6. A blank cell is stored as 'not given', not as 0; the text as typed is kept for display. A filled cell that is not a number, percentage or fraction is read as 0 with a warning ('lots' for Fund 1 gives 0). [IN-076, IN-077]
6. A filled Display name renames the investor column everywhere in the app; the workbook name still works in views and settings ('Investor 11' with Display name 'Mandate Eleven' shows as Mandate Eleven; a view naming 'Investor 11' still works). [IN-078]
7. A table with a title and headers but no rows gets a warning 'no rows under the headers'. [IN-079]
8. Having an Investors table also makes the Group view available, even when Mapping column H does not list it.

### 2.6 Reading an ownership, weight or share cell

The same reading is used for the Investors table, the matrix Views table and the Ownership grid; view-formula coefficients differ only where noted.

1. A blank cell is 'not given' (no weight), which is not the same as 0. [IN-051, POS-050]
2. A number above 1 is a percentage and is divided by 100: 35 is 35%, 1.5 is 1.5%. Exactly 1 is 100%. In a view-formula coefficient a number above 1 keeps its value, as a multiple (2 × Fund 1 is twice Fund 1). [IN-052, POS-051]
3. A leading '=' is ignored. 'a/b' is a ÷ b, spaces allowed, decimal comma allowed ('7/20', '=7/20' and ' 3 / 5 ' are 35%, 35% and 60%; '7,5/20' is 37.5%). A zero denominator gives no weight ('7/0'). [IN-053, POS-052]
4. A comma is a decimal comma ('0,5' is 50%; '0,125' is 12.5%; '1,25' is 1.25 and then, being above 1, 1.25%), except a non-zero whole part followed by exactly three digits, which is a thousands separator ('1,000' is 1000 and then, being above 1, 10). [IN-054, POS-053]
5. A value ending in % is divided by 100 ('35%' is 0.35; '150%' is 1.5). A text number above 1 without % is also a percentage ('35' is 0.35), except in a formula coefficient. Percentages above 100% and negative weights ('-0.2') are accepted at this point; the Ownership grid then refuses negatives (2.11). [IN-055, POS-053]

### 2.7 The Views table, formula form

1. The Views table is in formula form when the row under its title contains a header 'Formula', 'Definition' or 'Composition'; otherwise it is read as the older matrix form (2.9). [IN-080]
2. Its columns are 'View' and 'Formula', 'Definition' or 'Composition' ('View' = Region A, 'Definition' = Investor 3 + Investor 4). [IN-039]
3. A row with a blank view name is skipped without a message.
4. A row named like the attribution group (Group, Group weights, Group weight, Attribution, Attribution weights, Attributed, or the attribution label in force, capitals and punctuation ignored) defines the Group view, built later as the sum of each investor column times its group ownership, whatever its formula says ('Group' with formula 'Investor 1' is still the ownership-based Group view). A later such row replaces an earlier one. [IN-042, IN-082]
5. Any other view defined twice keeps its first row, with a warning (Region A on rows 4 and 9: row 4). [IN-083]
6. A formula that cannot be read leaves the view undefined (it shows nothing) and a warning names the problem ('Investor 1 + abc × Fund 1'). [IN-084]
7. A row with an empty formula is kept as an undefined view to be filled in, not as an error. [IN-085]
8. A view whose name has the look-through form (2.8.9) is also marked as that investor's look-through view.

### 2.8 How a view formula is read

1. A leading '=' is dropped; a blank formula has no terms and no error ('=Investor 1 + Fund 6' is Investor 1 + Fund 6). [IN-060]
2. Terms are split on ' + ' (with spaces), or on a '+' that follows a digit, a closing bracket, a % or a space and comes before a name, a bracket or a number ('Investor 1+Fund 2' is two terms). A '+' between two letters does not split ('Fund A+Fund B' is one name). Subtraction is not supported: 'Investor 1 - Fund 1' becomes one term named 'Investor 1 - Fund 1' with no error here; it later fails to match any column. [IN-061]
3. A coefficient may come before the name, followed by ×, *, the letter x and a space, or 'of', optionally in brackets: '7/20 × Fund 1', '(3/20)*Fund 3', '0.5 x Fund 1', '25% of Fund 2' give 0.35, 0.15, 0.5 and 0.25. [IN-058]
4. A coefficient may follow the name only after × or *: 'Fund 6 × 1' is Fund 6 at 1. **Silent:** 'Fund 1 x 0.5' (letter x after the name) is not recognised; it becomes a name 'Fund 1 x 0.5' with no error, which later matches nothing. [IN-059]
5. A term containing × or * that is neither '<number> × <name>' nor '<name> × <number>' makes the formula unreadable ('abc × Fund 1'; also 'Investor 1 + 1/4 ×'). [IN-062]
6. The coefficient is read like a weight (2.6) except that a plain number above 1 stays a multiple; a term without a coefficient counts 1 ('2 × Fund 1' is 2; '35% of Fund 1' is 0.35; 'Fund 6' is 1). A coefficient that is not a number, percentage or fraction ('7/0 × Fund 1') makes the formula unreadable. [IN-063, IN-064]
7. Outer brackets around a name are removed ('(Fund 1)' is Fund 1). A term with a coefficient but no name makes the formula unreadable. [IN-065, IN-066]
8. Each term keeps its coefficient exactly as typed ('7/20') for display and download. Written back (the downloaded grid or the formula shown), a weight of 1 with no typed coefficient is just the name, otherwise '<coefficient> × <name>', a computed weight shown to 6 significant digits: (Investor 1, 1) and (Fund 1, typed '1/4') give 'Investor 1 + 1/4 × Fund 1'; an untyped weight of one third gives '0.333333 × Fund 1'. [IN-067]
9. A view named '<name> incl. part in funds', '<name> including funds' (optionally 'including its part / share / units / holdings in / of funds'), '<name> with funds' or '<name> look-through' (optionally 'look-through funds'), with optional brackets, dash or colon, is that name's look-through view; its fund coefficients are the name's share of each fund's units. 'Investor 1 incl. part in funds', 'Investor 1 (incl. funds)', 'Investor 1 with funds' and 'Investor 1 look-through' all have base Investor 1; 'Investor 1 funds' is not a look-through view. [IN-057]

### 2.9 The Views table, older matrix form

1. The investor columns are the header cells to the right of the 'View' column, up to the first blank header cell; columns after a gap are not read ('View | Investor 1 | Investor 4 | (blank) | Fund 1' gives Investor 1 and Investor 4 only). Columns not yet in the Investors table are added to it. [IN-086]
2. A header row with no investor columns to the right of 'View' gets a warning. [IN-087]
3. The table ends at the first row with no name and no values. [IN-088]
4. A row with values but no name in the first column is ignored with a warning. [IN-089]
5. A row named 'Type', 'Investor type' or 'Class' sets each column's type; one named 'Display name', 'Display names', 'Name' or 'Shown as' sets each column's display name ('Type': Group entity | Fund gives Investor 1 = Group entity, Fund 1 = Fund). [IN-041]
6. In a view row, each filled cell is read as a weight (2.6). A cell that is not a number, percentage or fraction is read as 0 with a warning and left out of the view ('yes' for Investor 4 in Region A); zero weights are left out too. [IN-090]
7. The row named like the attribution group (2.7.4) gives each column's group ownership (blank or unreadable counts 0) and defines the Group view. In the matrix form it overrides any ownership typed in the Investors table ('Group': 1 | 1 | 1 | 45% gives Fund 1 ownership 0.45). [IN-091]
8. A view named twice keeps its first row, with a warning. A named row with every cell blank is an undefined view, to be filled in. A row whose filled cells are all zero or unreadable is kept as a view with no members. [IN-083, IN-092]
9. A matrix table with no attribution row gets an information note: no ownership comes from the sheet. [IN-093]

### 2.10 The FX Exception table

1. Columns: investor = 'Investor', 'Portfolio', 'Investor or portfolio code' or 'Investor code'; 'Currency'; 'View'; rate = 'Rate' or 'Rate or Hardcoded column'; 'Note'. The investor may be an investor column name or a portfolio code (a 'Portfolio' header holding 61012 is the exception's investor). [IN-040]
2. A row without an investor or without a currency is skipped without a message (Rate 0.86 but no currency is ignored). [IN-094]
3. The Rate cell is a fixed rate when it reads as a number (1.8.6); otherwise its text is the name of a Hardcoded column holding one rate per asset ('Investor 21 FX for GBP / EUR'). [IN-095]
4. A row with investor and currency but a blank rate is ignored with a warning. [IN-096]
5. The currency is put in capitals ('gbp' is GBP); a blank note becomes 'Scope Settings sheet'. A blank View means the exception applies whichever view is selected; how the exception is applied is in 3.28. [IN-097]

### 2.11 The Ownership grid

1. The sheet is the tab named 'Ownership' (capitals, spaces, underscores and hyphens ignored), or the grid edited in the app (2.2.6). The intended layout is names across row 1 from B1 and the same names down column A from A2; each cell is the share the row's name owns of the column's name. [IN-098]
2. The header row is the first of the first 50 rows with at least two filled cells (rows 1 and 2 blank, row 3 = blank | Investor 1 | Fund 1: row 3). If none qualifies, the sheet is ignored with a warning 'no grid found'. [IN-099, IN-100]
3. The owner-name column is the leftmost filled cell of the first non-empty row among the five rows under the header row; if those five rows are empty, column A. [IN-101]
4. The column names are the header cells to the right of the owner column; blank header cells are skipped and do not end the row (A | Investor 1 | blank | Fund 1 gives Investor 1 and Fund 1). A name repeated across the header row keeps its first column, with a warning. [IN-102, IN-103]
5. Every row below the header row is read, to the last row; fully blank rows are skipped. A row with values but no name in the owner column is ignored with a warning naming the row. A name repeated down the owner column keeps its first row, with a warning. [IN-104, IN-105]
6. A blank cell is 0: the row owns nothing of that column. [IN-106]
7. A filled cell is read as in 2.6: 1, 0.45, '45%', '9/20' and 45 are all 45%; 1.5 is 1.5%. [IN-107]
8. A cell that is not a share, or is negative, is read as 0 with a warning naming the cell ('lots' in F2, Group owning Fund 1: 0; -0.1: 0). [IN-108]
9. A cell where the row name equals the column name is the row's share of its own column (blank is treated as 100% later); it is kept apart from the other terms. [IN-109]
10. Only shares above 0 become terms of the row; an explicit 0 is the same as blank. The text as typed is kept for display (Region A row: Investor 3 = 1, Investor 4 = 1, Investor 5 = 0 gives Region A = Investor 3 + Investor 4). [IN-110]
11. The grid is read before Mapping. Which row is the group's, grids filled the other way round, and how each row becomes a view are the next stage.

### 2.12 Matching names in these tables to investor columns

This runs once Mapping › Funding Name has been read (3.7), but it decides how every name in 2.4 to 2.11 is understood.

1. An investor column's display name is the name changed in the app if any, else the Display name in Scope Settings › Investors, else the workbook's Holdings Name (Funding Name column Z). 'Fund 1' renamed 'Infra Debt Fund I' in the app shows that way everywhere. [POS-033]
2. A column can be referred to by its workbook name, its display name or any of its fund names (Funding Name column Y); a fund name never takes over a name already used by another column. A settings row 'Investor 1 Portfolio' resolves to column Investor 1. [POS-034]
3. A settings name that is not exactly a column name is matched loosely only if it has at least 4 letters or digits once spaces and punctuation are removed ('Inv' never matches). [POS-035]
4. Loose match, in order: (a) the only column whose workbook name begins with the text ('Fund One' with columns 'Fund One Units' and 'Fund Two' gives 'Fund One Units'); (b) if no column begins with it, the column whose name (4+ characters) the text itself begins with, the longest such, and only if strictly longer than the next ('Investor 13 Mandate' with 'Investor 1' and 'Investor 13' gives 'Investor 13'); (c) failing that, the only column whose name contains the text ('One Units'). None or several gives no match. [POS-036, POS-037, POS-038]
5. Each loose match is reported once as information: '"X" taken as the investor column "Y"'. When a Scope Settings › Investors row is applied to a column under a different spelling, a note says which column it was taken as. [POS-039, POS-042]
6. An Investors row that matches no column exactly or loosely is ignored, with an information note ('"Investor 77" is not an investor column in Mapping › Funding Name … its row is ignored'). [POS-041]
7. View names, and the View of an FX exception, are matched only to exact names (any of a column's names), never loosely: 'Investor 1' with a column 'Investor 1' and a view 'Investor 1 incl. part in funds' is exactly the column. [POS-040]

## 3. From Holdings rows to positions

What goes in: the four sheets as read in stage 1, the settings of stage 2, your column choices and your manual corrections. What comes out: one position per Holdings row that carries a Security ID, each with its investor code and investor column, asset, amounts in its own currency and in EUR and the display currency, dates, tenor and maturity bucket, rate type, spread, ratings and IG label, the reasons any position is left out, the Hardcoded and ESG rows found for each asset, and every warning about the input. Positions excluded here count in no total.

### 3.1 Which sheets must be present

1. The calculation reads exactly four sheets: Holdings, Mapping, Hardcoded and ESG Hardcoded; anything else in the workbook (Output, Calculations) is ignored. A sheet counts as present only if it has at least one row. [IN-148, POS-001]
2. A missing or empty sheet is an error, 'Sheet "X" is missing: load the workbook or paste the sheet on the Data page', and nothing is read from it. Without Holdings no position is computed. [IN-157, POS-002]
3. Mapping is not searched for a header row; its six tables are found by title instead (3.6). [IN-158, POS-003]

### 3.2 Finding the header row (Holdings, Hardcoded, ESG Hardcoded)

1. Scope looks for expected header names. Holdings: Security ID, Security Name, Model Portfolio, Portfolio, Reporting Date, Quotation Currency, Maturity Date, Rate Type. Hardcoded: Security ID, Project Name, Code Name, Subsector, Watchlist, Funding Date, Shareholders, Description. ESG Hardcoded: Security ID, Project Name, ESG Score, E Score, GHG Scope 1, CBI Sector, CHI Sector. [POS-007, IN-149, IN-195, IN-196]
2. Only the first 15 rows are considered; headers pasted lower (row 18) are never found. [POS-004]
3. Each of the first 15 rows is scored by how many different expected names it contains (capitals, spaces and punctuation ignored; a name repeated on several columns counts once). A row needs at least 2; the highest score wins, and on a tie the upper row. [IN-150, POS-005]
4. Then, because row 2 (output names) often repeats the headers, while the row directly below the chosen row also has at least 2 expected names, Scope moves down to it. Row 2 with 6 matches and row 3 with 8 gives row 3; row 2 with 8 and row 3 with 3 also gives row 3. [IN-151, POS-006]
5. If no row qualifies, an error 'Header row not found in "X" (expected headers such as …)' lists the first three expected names, and none of that sheet's columns is read (Hardcoded with German headers: no Hardcoded fields for any asset). [IN-159, POS-008]
6. Data rows are read from the row immediately after the header row to the last row of the sheet (header in row 3: first position from row 4). [POS-009]
7. Each column's output name is the cell directly above its header (Holdings row 2, the workbook's lookup of the header in Mapping References); an error there (#N/A) counts as no output name (header 'RA_Commitment QC' in AK3, AK2 = 'Amount nominal (QC)'). [IN-152]

### 3.3 Finding each column

1. A column you chose on Data › Columns wins, matched by its exact header text or its column letter. **Silent:** if the chosen column no longer exists (a new extract renamed it), the automatic choice applies without a message. [IN-153]
2. For the key columns (Model Portfolio, Portfolio, Security ID, Security Name) the row-3 header is tried before any row-2 output name, because an output name such as 'Security ID' may sit on another column (row 2 says 'Security ID' over the Identification ID column, row 3 has 'Security ID' in column I: column I is used). [IN-154]
3. Every other column is found by its row-2 output name first, then by its row-3 header, then by a header pattern. Candidate names are tried in the listed order, and for each the leftmost matching column wins: a row-2 'Amount nominal (QC)' is used even if a header 'RA_Commitment QC' exists elsewhere. [IN-155]
4. A header pattern is the last resort: the first column whose header fits it (the closing rating is any header ending in 'Rating_Closing'). [IN-156]
5. A required column that cannot be found is an error naming the input and up to three candidate names, asking you to choose it on the Data page ('Required column for "Nominal (exposure)" not found'). Required in Holdings: Model Portfolio, Portfolio, Security ID, Reporting Date, Position currency, FX rate, Nominal, Drawn; in Hardcoded and ESG Hardcoded: Security ID. [IN-160, POS-010]
6. **Scope's choice:** the Mapping References table is not used to find columns; Scope uses whatever row 2 of Holdings shows, and only checks row 2 against References (3.9).

### 3.4 Holdings columns Scope looks for

Output names (row 2) are listed first, then headers (row 3).

1. Model portfolio (required, key): 'Model Portfolio'. Portfolio (required, key): 'Portfolio'. Security ID, the holding ID (required, key): 'Security ID' (column I in the workbook). Security name (key): 'Security Name'. [IN-116, IN-117, IN-118, IN-119]
2. Portfolio name: output 'Portfolio name', or header 'Portfolio Name' or 'Model Portfolio Name'. Project code: 'Project Code'. [IN-120, IN-121]
3. Reporting date (required): 'Reporting Date'. [IN-122]
4. Position currency (required): output 'Currency' or 'Quotation Currency', else header 'Quotation Currency' or 'Currency'. [IN-123]
5. FX rate (required): output 'Forex', 'FX Rate', 'FX' or 'FX rate (QC per EUR)', else header 'FX Rate EC', 'FX Rate' or 'FX Rate EUR'. [IN-124]
6. Nominal, the exposure (required): output 'Amount nominal (QC)', 'Amount nominal', 'Nominal', 'Nominal Amount' or 'Exposure', else header 'RA_Commitment QC' / 'RA Commitment QC'. **Scope's choice:** 'Nominal', 'Nominal Amount' and 'Exposure' in row 2 are accepted besides the workbook's names, so a column whose row 2 says 'Exposure' is read as the nominal. [IN-125, IN-126]
7. Drawn (required): output 'Current drawn amount (QC)', 'Current drawn amount', 'Current drawn', 'Drawn' or 'Drawn Amount', else header 'Current Drawn Amount CCY' / 'Current Drawn Amount QC'. [IN-127]
8. Commitment: output 'Initial commitment (QC)', 'Initial commitment' or 'Commitment', else header 'Initial Commitment Amount CCY'. [IN-128]
9. Amount in EUR as exported: the column whose output name is 'Amount (EUR)'. Portfolio currency: 'Portfolio Currency' (output or header). [IN-129, IN-130]
10. Nominal in reference currency, used to test the FX direction and check the conversion: output 'Nominal RC', 'Amount (EUR)', 'Amount EUR', 'Nominal (EUR)', 'Amount (RC)' or 'Nominal RC (EUR)', else header 'RA Commitment RC' or 'Amount (EUR)'. [IN-131]
11. Maturity date: 'Maturity Date'; purchase date: 'Purchase Date'. Rate type: output 'Fixed / Floating' or 'Rate Type', else header 'Rate Type'. [IN-132, IN-133]
12. Spread: output 'All-in spread (bps)', 'All-in spread', 'Spread at Acquisition' or 'Spread', else header 'All-in Spread at Acquisition' or 'Spread'. WAL: output 'Current WAL' or 'WAL', header 'WAL'. Yield: 'Yield'. [IN-134, IN-135]
13. Internal rating: output 'Internal Rating', else header 'Internal Current Rating' or 'Internal Rating'. Closing rating: output 'Initial Rating' or 'Closing Rating', else any header ending in 'Rating_Closing' ('Ext Sec Group_Rating_Closing'). Fitch: output 'External Rating Fitch' / 'Fitch', header 'Rating Fitch'. S&P: output 'External Rating S&P' / 'S&P', header 'Rating S&P' / 'Rating SP'. Moody's: output 'External Rating Moodys' / "External Rating Moody's" / "Moody's", header "Rating Moody's" / 'Rating Moody' / 'Rating Moodys'. [IN-136, IN-137, IN-138]
14. Country: output 'Country', else header 'RA Asset Country Name', 'Issuer Country' or 'RA Country'. **Silent:** without 'Country' in row 2 and without an 'RA Asset Country Name' header, the issuer's country is used, and failing that 'RA Country', which usually holds the code, so the country may show as 'FR'. Country code: output 'Country code', else header 'RA Country' or 'Country Code'. [IN-139, IN-140, IN-141]
15. Sector: the column with output name or header 'Sector' or 'Underlying Asset Type'; this is the sector on every page (Underlying Asset Type = Energy gives sector Energy). [IN-142]
16. Brownfield / Greenfield: 'Brownfield / Greenfield'. Financial close: 'Financial Close' or header 'Financial Close Date'. Primary / Secondary: 'Primary / Secondary'. [IN-143]
17. Instrument: output 'Instrument' or 'Format', else header 'Security Type Name'. Bullet flag: output 'Bullet / Amortizing', 'Bullet / Amortising' or 'Bullet', else header 'RA_Bullet'. Parent issuer (sponsor / borrower): output 'Borrower name' or 'Parent Issuer', else header 'Parent Issuer Name'. Seniority: 'Seniority'. [IN-144, IN-145, IN-146]
18. The workbook's own formula columns are found by header only: 'Unique Identifier' (B), 'Investor Code' (C), 'Identification ID' (D), 'Code Name' (E). They are used only to check Scope's own results (3.9), never as inputs. [IN-147]

### 3.5 Hardcoded and ESG Hardcoded columns Scope looks for

1. Hardcoded is keyed by the required header 'Security ID' (the asset's identification ID). [IN-178]
2. Hardcoded project name: header 'Project Name', but a row-2 label 'Project Code' is tried first. Code name: header 'Code Name' only. Chronological order: 'Chronological Order'. [IN-179, IN-180]
3. Subsector: 'Subsector'. Cash-flow type: 'Cashflow Type' or 'Cash Flow Type'. 'Description'. 'Shareholders'. 'Origination'. Staff closing: 'Staff Closing'. [IN-181]
4. Upfront fee: 'Upfront'. End of non-call / make-whole: 'End of NC / MW' or 'End of NC MW'. 'IC Date'. 'Funding Date'. 'Total Debt Offering'. [IN-182]
5. 'Watchlist' (output or header). [IN-183]
6. Jurisdiction tier: any header starting with 'Jurisdiction Tier'. Country tier: any header ending in 'Country Tier' (letters and digits compared). [IN-184]
7. Prepayment protection (1) and (2): 'Prepayment Protection (1)' / '(2)'. Expected COD: 'Expected COD if greenfield' or 'Expected COD'. TICCS code: 'TICCS Code' or 'TICS Code'. [IN-185]
8. Any header ending in 'Sector Classification' (but not containing 'Subsector') is an investor's own sector classification; a view's reports can use it instead of the Holdings sector ('Investor B Sector Classification'). [IN-186]
9. Covenant compliance: 'Compliance with Financial Covenants', 'Compliance (with Financial Covenants)' or simply 'Compliance'. [IN-187]
10. Classification (Core / Core+): the first header ending in 'Classification' that does not contain 'sector' ('Investor 21 Classification'); its heading is printed on the investor report's asset table. [IN-188]
11. ESG Hardcoded is keyed by the required header 'Security ID'; project name 'Project Name'; code name 'Code Name'. Scores: 'E Score', 'S Score', 'G Score', 'ESG Score'. 'Shareholders'. [IN-189, IN-190, IN-191]
12. Taxonomy sector, subsector, sub-subsector, asset type and asset specific are read from 'CBI …' or 'CHI …' headers ('CHI Sector'); they stay separate from the Holdings sector. [IN-192]
13. Infra code: 'Infra Code'. FM monitoring: row-2 'Staff Monitoring' or 'FM Monitoring', header 'FM Monitoring'. GHG scopes: 'GHG Scope 1', 'GHG Scope 2', 'GHG Scope 3'. [IN-193, IN-194]
14. These columns feed the asset page and the reports in a later stage. The asset page's deal attributes are sector, subsector, country, region, sponsor, repayment type, cash-flow type, instrument, origination, deal year, deal lead, classification, financial close, watchlist, covenant compliance, IC date, funding date, protection end date, upfront fee (bps), total transaction size, transaction group, chronological order and description; its ESG fields are the ESG, E, S and G scores, GHG scopes 1 to 3 (tonnes), GHG intensity (tonnes per EUR m) and the taxonomy sector and subsector. Upfront fee, total transaction size, deal year, WAL, chronological order, the scores, the GHG scopes and the intensity are read as numbers, not text ('0.75%' is the number 0.75). [IN-024, IN-025, IN-027]
15. How a Watchlist value is read (used per asset in a later stage):
    1. Off when it is blank; or exactly No, N, None, Nil, Off, OK, Okay, Clear, Normal, Standard, Regular, Performing, Green, N/A, NA, -, –, 0 or False; or starts with the word No, Not, Non, Off, Cleared, 'Removed from' or 'Taken off'; or ends with ':', '=', '-' or '–' followed by No, None, Off, False or 0. 'Performing', 'Not on watchlist', 'No watch', 'Watchlist: No' and '-' are off. [IN-175, POS-117]
    2. Otherwise on when it contains, as a whole word, watch… (watch, watchlist), intensive, yes, amber, red, orange, monitor… (monitor, monitoring), alert, special, enhanced, under review or true, or is exactly Y, 1 or X. 'Watch', 'Intensive care', 'Amber', 'Under review' and 'Red flag' are on; 'Cleared', 'Restructured' and 'Unmonitored' are not ('red' and 'monitor' are not whole words there). Note for sign-off: rule IN-176's example says 'Off watch' counts as on; the code reads 'Off watch' as off, because it starts with the word Off. [IN-176, POS-118]
    3. A value that is neither (for example 'Level 2') is not counted as on the watchlist; every distinct value seen, with how it was read, is listed on Data › Issues. [IN-177, POS-119]

### 3.6 Finding the six Mapping tables

1. The tables and their titles: References ('References'); Active Assets ('Active Assets', 'Active assets list'); Security Mapping ('Security Mapping', 'Securities Mapping', 'Security mapping table'); Funding Name ('Funding Name', 'Funding Names', 'Investors'); Investment Grade Mapping ('Investment Grade Mapping', 'Investment Grade', 'Rating Mapping', 'Ratings'); Fund Check ('Fund Check', 'Funds Check'). [IN-161, IN-162, IN-163, IN-164, IN-166, IN-167]
2. Titles are looked for in the first 30 rows, every column. When a title appears more than once, the topmost, then leftmost, is used ('Security Mapping' in Q2 and Q40: Q2). [IN-168]
3. **Silent:** any cell reading 'Investors' in the first 30 rows counts as a Funding Name title, so a note 'Investors' typed above another table could move the Funding Name table there. [IN-165]
4. A table whose title is not found is assumed at the workbook's own column, title in row 2: References C, Active Assets H, Security Mapping Q, Funding Name Y, Investment Grade Mapping AC, Fund Check AH. [IN-169]
5. Each table's headers are on the row directly below its title. [IN-170]
6. A table's headers are searched from one column left of its title (the Security Mapping helper column P) up to the next table title to the right, or 12 columns when it is the last; for each field the leftmost matching header wins (Funding Name title in Y, Investment Grade title in AC: Funding Name headers searched X to AB). [IN-171]
7. Header names per table: References: Holdings column = 'Columns in Holdings tab', 'Columns in Holdings', 'Holdings column' or 'Column'; output name = 'Output Names', 'Output Name' or 'Output'. Active Assets: views = 'Views (Portfolios / Investors)', 'Views', 'Views (Portfolios/Investors)' or 'Portfolios / Investors'; 'List'; 'Mapping'; 'Active Assets Output' or 'Active assets'; 'Selected Assets' or 'Selected'; 'Number', 'No' or 'Order'. Security Mapping: code name = 'Code Name' / 'Code'; holdings name = 'Holdings Name', 'Holding Name', 'Project Name' or 'Name'; identification ID = 'Identification ID', 'Identification', 'Asset ID' or 'Ident ID'; holding ID = 'Holding ID', 'Holdings ID', 'Security ID' or 'Holding'; transaction group = 'Transaction Group' or 'Group'. Funding Name: fund name = 'Fund Name', 'Funding Name' or 'Fund'; holdings name (investor column) = 'Holdings Name', 'Holding Name', 'Investor' or 'Investor column'; holdings ID (investor code) = 'Holdings ID', 'Holding ID', 'Portfolio ID', 'Investor code' or 'Code'. Investment Grade Mapping: rating = 'Rating' / 'Grade'; score = 'Score', 'Numeric' or 'Value'; extra = 'Scale', 'Agency' or 'Type'. Fund Check: 'Mapping' and 'Holdings'. [IN-161, IN-162, IN-163, IN-164, IN-166, IN-167]
8. If none of a table's headers is recognised but its title or some headers exist, its columns are taken in the workbook's order from the title column (Security Mapping: Q code name, R holdings name, S identification ID, T holding ID, U transaction group), and a warning lists the headers found ('none of its headers was recognised … the columns are taken in the workbook's order'). [IN-172, POS-017]
9. A table's rows are every row below its headers with any value in its columns; blank rows are skipped and reading continues to the bottom of the sheet (Funding Name rows 4 to 20, row 21 blank, row 22 a further code: row 22 is read). Rows you added in the app are included and marked (1.6). [IN-174, IN-173]
10. Each table not found or empty is reported: a warning for References, Active Assets, Security Mapping, Funding Name and Investment Grade Mapping; only an information note for Fund Check. [POS-018]

### 3.7 What Scope takes from each Mapping table

1. References: each Holdings column header (blank cells skipped) with its output name, compared ignoring capitals, spaces and punctuation. Used only for the row-2 check (3.9). [POS-019]
2. Active Assets column H: the views offered are the distinct filled values, in order of first appearance (Total platform, Group, Region A, Group, Investor 1 gives Total platform, Group, Region A, Investor 1). [POS-020]
3. Active Assets columns I and J: security name to asset code, names compared trimmed, inner spaces made single, capitals ignored. Used only to suggest an asset for an unmapped security (3.19). [POS-021]
4. Active Assets column J: the assets allowed in the Output are its distinct filled values (UNIQUE(J)), compared with Security Mapping code names trimmed, inner spaces made single, in capitals and with '123.0' read as '123' (' alpha ' matches 'ALPHA'). [POS-022, POS-023]
5. Security Mapping: rows whose Holding ID (T) is blank or an Excel error are skipped. If a Holding ID appears twice, the first row is used and a warning names it ('Holding ID S1 appears twice'). If a row has no Identification ID (S), the Holding ID itself is the asset's identification ID. When several rows share a code name, the first row's identification ID goes with that code name (ALPHA on rows 4 (100301) and 6 (100399): ALPHA goes with 100301). [POS-024, POS-025, POS-026, POS-027]
6. Funding Name: rows whose Holdings ID (AA, the investor code) is blank are skipped. If a code appears twice, the first row is used and a warning names it with the investor kept. [POS-028, POS-029]
7. The investor column a code feeds is named by column Z (Holdings Name); if blank, column Y (Fund Name); if both blank, the code itself (61005 with Z blank and Y 'Fund Five' feeds 'Fund Five'). All codes whose name is the same, ignoring capitals, spaces and punctuation, feed one investor column, in order of first appearance; the column keeps every code and every distinct fund name (61001, 61098, 61099 all 'Investor 1': one column with three codes). [POS-030, POS-031]
8. Each code is also linked to its own Fund Name (column Y); this is the position's segment in the Look-through dropdown (61098 gives 'Investor 1 Portfolio B'). [POS-032]
9. Display names and name matching for the investor columns are set here (2.12). [POS-033, POS-034]
10. Investment Grade Mapping: each row is a rating and a numeric score; rows missing either are skipped ('NR' with a blank score). Ratings have odd dashes and spaces tidied first ('BBB –' becomes 'BBB-'). If the table yields no rows, a warning says every position is treated as not rated. **Scope's choice:** if one rating appears twice in the table, the last row's score is used, without a message. [POS-043, POS-045]
11. The label of an average (weighted) rating, used later, is chosen only among table grades written S&P / Fitch style (AAA, AA, A, BBB, BB, B, CCC, CC, C, D, optionally + or -), ordered by score; Moody's grades share the numeric scale but never label it (A 500, Baa2 600, BBB 600: only A and BBB can label). [POS-046]
12. Fund Check rows are kept to check, in a later stage, that the investor names listed there are known.

### 3.8 Checking the key columns against Mapping

1. Before positions are built, three key columns are checked: Security ID against Security Mapping (Holding ID), Model Portfolio (rows that are not SINGLE rows) and Portfolio (SINGLE rows, only if there are any) against Funding Name (Holdings ID). Each check runs only if that Mapping table has rows (500 Security IDs, 498 found: 99.6%, no message). [POS-054]
2. The match rate is measured on at most the first 3,000 data rows after the header row (a 12,000-row Holdings: rows 4 to 3003). Blank cells and the value '0' are not counted. [POS-055, POS-056]
3. If you chose the key column yourself on Data › Columns, it is never replaced, whatever its match rate; at most a mismatch warning is raised. [POS-058]
4. If an automatically chosen key column matches fewer than 50% of its values, every other column is tested (except columns already used by another key column). The best column with at least 5 values, and at least half as many values as the original, and an 80% or higher match, is used instead, with a warning naming both columns and both rates ('Security ID: column … matched 3% … column "Identification ID" matches 97% and is used instead'). [POS-057]
5. If a key column matches under 50% and no better column exists, a warning gives the rate and up to three example values not found. [POS-059]

### 3.9 Checking the workbook's own formula columns

These checks never change a figure; they appear on Data › Checks.

1. Holdings row 2 is compared with what References says each header's output name should be, but only when the header row is not the first row and at least 3 columns carry an output name above them; a header missing from References counts as #N/A. [POS-073]
2. For each position, Holdings columns C (investor code), B (unique identifier), D (identification ID from Security Mapping) and E (code name from Security Mapping) are recomputed and compared with the workbook's values. [POS-068]
3. Comparison rules: a blank workbook cell is not compared at all. A workbook cell showing #REF!, #VALUE!, #NAME?, #DIV/0!, #NUM!, #NULL!, #SPILL!, #CALC! or #GETTING_DATA is not compared but counted as skipped (usually a formula pointing at a sheet not exported). Any other Excel error counts as '#N/A', so a lookup that fails both in the workbook and in Scope is a match. Values are equal if their trimmed text is identical, or both are numbers less than 0.000000001 apart ('100301' and 100301 match). At most 25 differing examples are kept per check. [POS-069, POS-070, POS-071, POS-072]

### 3.10 Which Holdings rows become positions

1. A row whose Security ID is blank, an Excel error or '0' (copied formula rows showing '0x0') is not a position. [POS-060]
2. Skipped rows that still carry a non-zero nominal are listed in one warning with the count and up to six row numbers ('2 row(s) carry a nominal but no Security ID (rows 812, 813): skipped, as the workbook would'). Skipped rows with any other content are counted in one information note ('… row(s) below the data hold only copied formulas … and are ignored'). [POS-061]

### 3.11 Investor code, position key, security name

1. The investor code is the Portfolio value when Model Portfolio equals the SINGLE word (capitals ignored), otherwise the Model Portfolio value (Model Portfolio 'single', Portfolio 7003 gives 7003; Model Portfolio 61001 gives 61001). [IN-008, POS-063]
2. The position's key is the investor code, the letter x and the Security ID ('61001xS1'), as workbook column B. [POS-065]
3. The tranche label is the Holdings Security Name. [POS-066]
4. The Security ID is looked up in Security Mapping tolerantly (1.8.3: '100200.0' matches Holding ID 100200). [POS-067]

### 3.12 Manual corrections applied

1. Corrections are allowed on these position fields only: nominal, drawn, commitment, currency, FX rate, internal grade, Fitch, Moody's, S&P, maturity date, purchase date, rate type and spread. [IN-026]
2. A correction in force replaces the imported value before anything below is calculated; the position is flagged 'adjusted' and the original is kept for the badge (nominal 10,000,000 corrected to 11,000,000: totals +1m, badge shows 10,000,000). The corrected value is read with the same rules as an imported one. [POS-074]
3. **Silent:** corrections are matched by the position key (investor code x Security ID). If a new extract changes the investor code or Security ID, the correction no longer applies and nothing says so; two rows with the same key (3.18.6) both take the correction.

### 3.13 Amounts: nominal, drawn, commitment

1. If the nominal is blank or not a number (1.8.6), an error is raised ('Nominal "n/a" is not a number') and the position is excluded with reason 'nominal not numeric'. [POS-083]
2. A blank or non-numeric drawn amount is 0; a filled but invalid value ('tbc') also gives a warning, a blank one does not. [POS-084]
3. A blank or non-numeric commitment equals the nominal (or 0 when the nominal is not a number): commitment blank, nominal 20,000,000 gives commitment 20,000,000. [POS-085]
4. If drawn exceeds nominal by more than 0.0001% (drawn above nominal × 1.000001), a warning is raised; the position is kept unchanged (nominal 10,000,000, drawn 10,500,000). [POS-086]
5. **Silent:** negative amounts are accepted as they are, with no message.

### 3.14 Currency and FX rate as read

1. The currency is trimmed and put in capitals ('gbp ' is GBP). Any text is accepted as a currency. [POS-087]
2. If the currency is blank and the position is not already excluded, an error is raised and the position is excluded with reason 'currency blank'. [POS-088]
3. The row's FX rate is read as a number and kept; which rate is actually used is decided in 3.28.

### 3.15 Dates

1. Reporting, maturity and purchase dates are read as in 1.8.7 and 1.8.8. [POS-090, POS-091]
2. A position with no maturity date is kept, with a warning 'Maturity date missing; tenor and maturity bucket unavailable'. [POS-093]
3. The funding date is first set to the Purchase Date; in a later stage it is replaced by the asset's Hardcoded Funding Date when there is one (purchase 30 Jun 2021, Hardcoded funding date 15 Jul 2021: 15 Jul 2021). [POS-094]

### 3.16 Rate type

The test is made on the value with only letters and digits kept, capitals ignored.

1. Blank (or only punctuation, such as '-') is 'Not stated'. [IN-113, POS-102]
2. A value containing 'fix' or 'zero', or exactly 'ZC' or 'F', is Fixed, provided it does not also contain 'float', 'variab' or 'frn'; an index named in it does not stop it being Fixed. 'FIXED RATE', 'Taux fixe', 'Zero coupon', 'F', 'Fixed + Euribor' and 'Fixed (swapped from Euribor)' are Fixed. [IN-111, POS-103]
3. Otherwise a value containing 'float', 'variab', 'frn', 'ibor', 'sonia', 'sofr' or 'eonia', or exactly VAR, FLT, FL or V, is Floating ('Variable', 'FRN', 'V'). 'Fixed to floating' is Floating. [IN-112, POS-104]
4. Otherwise a value naming an index as a whole word (€STR, ESTR, ESTER, EURIBOR, LIBOR, SONIA, SOFR, EONIA, SARON, TONAR, BBSW, STIBOR, CIBOR, NIBOR, WIBOR) is Floating ('Euribor 6M', 'SONIA compounded'); an index hidden inside another word does not count ('interest rate' contains 'estr'). So is an index code as a market-data terminal writes it: two or three letters and a tenor ending D, W, M or Y (EUR006M, EUR003M, US0003M, BP0006M), an overnight code ending O/N (SONIO/N), ESTRON or SOFRRATE. [IN-112, POS-105]
5. Anything else is kept exactly as written and forms its own group ('Inflation-linked'). [IN-114, POS-106]
6. After all positions are read, one information note on Data › Issues lists every rate type value seen on included positions, how it was read and how many positions carry it. [IN-114]

### 3.17 All-in spread, WAL, instrument

1. A blank or non-numeric spread gives no margin (blank), so the position is left out of spread averages. [POS-111]
2. Spread unit 'auto' (default): a non-zero spread below 0.5 in absolute value is a decimal rate and is multiplied by 10,000 (0.0165 is 165 bps); from 0.5 up to, not including, 20 it is a percentage and multiplied by 100 (1.65 is 165 bps; 19.5 is 1,950 bps); 20 or more is already basis points (250 is 250 bps). [IN-012, POS-107, POS-108, POS-109]
3. Spread unit 'percent': every spread is multiplied by 100. Spread unit 'bps': every spread is kept as it is. [POS-108, POS-109]
4. A spread of 0 stays 0 (counted as a percentage reading in the unit summary). [POS-110]
5. If any spread was read as a decimal rate, or the column mixes units, one information note lists the units used and suggests setting the unit on Data › Formulas ('All-in spread read in basis points and percentages (× 100): the column mixes units …'). [POS-113]
6. The coupon is never calculated (always blank); only the all-in spread is used. [POS-114]
7. WAL is the Holdings WAL read as a number, without unit conversion; blank or text gives no WAL. [POS-115]
8. The instrument type is the Holdings instrument column as written ('Loan'). [POS-116]

### 3.18 Asset and investor of each position; exclusions

1. A position whose Security ID is in Security Mapping takes as asset code that row's Identification ID, as asset name its Holdings Name (column R), or the Code Name if R is blank, and its code name (S1 gives asset 100301 'Alpha Wind'). [POS-075]
2. A Security ID not in Security Mapping gets no asset code, is named after its Security Name (or '(unmapped)'), is flagged and is excluded with reason 'Security ID not in Mapping Security Mapping'. [POS-076]
3. A mapped position whose code name is not in Active Assets column J is excluded with reason 'asset not in Mapping Active Assets list'. If column J holds no codes at all, nothing is excluded for this reason. **Silent:** a Security Mapping row with no Code Name can never match column J, so its positions are excluded as inactive whenever column J has codes (the warning in 3.19 then shows a blank name). [POS-077, POS-078]
4. A position whose investor code is in Funding Name takes that investor column's display name; its segment is the code's Fund Name, or the code if the fund name is blank (61098 gives column 'Investor 1', segment 'Investor 1 Portfolio B'). [POS-079]
5. A position whose investor code is not in Funding Name is labelled 'Unmapped investor <code>' and flagged, but NOT excluded: it counts in its asset's total and in no investor column (code 7099 with 5m in GAMMA: GAMMA's total includes the 5m; no investor column gets it). [POS-080]
6. If the same investor code and Security ID appear on two rows, a warning names both rows and both are counted (61001xS1 on rows 10 and 55: both nominals included). [POS-081]
7. A position keeps the first exclusion reason found, checked in this order: nominal not numeric, currency blank, Security ID not in Security Mapping, asset not in Active Assets, then (3.28) no FX rate. An unmapped security with a blank currency shows 'currency blank'. [POS-089]

### 3.19 Mapping gaps and other messages after the rows are read

1. The nominal shown for a gap is the plain sum of the positions' nominals in their own currencies, not converted, with the currencies listed alongside (EUR 10m and GBP 5m show '15,000,000' with 'EUR / GBP'). [POS-122]
2. Unmapped securities are reported once per Security ID, not per row, as an error giving the security name, the Holdings column read, the number of positions excluded, the currencies and the sum of nominals ('Security ID S9 (Orphan Loan) … 2 positions excluded, EUR 10,000,000. Add it on Data › Setup'). [POS-120]
3. Each unmapped security gap carries the asset that Active Assets columns I and J give for its security name, if any, to pre-fill the new Security Mapping row ('Orphan Loan' in column I with J 'NEWX': suggested NEWX). [POS-121]
4. Unknown investor codes are reported once per code as an error, saying the positions are counted in asset totals but in no investor column. [POS-123]
5. If unmapped securities account for at least half of all positions, one diagnosis error states which Holdings column was compared with which Mapping column, with samples from both (the usual cause is a wrong column or a Security Mapping table not read). [POS-124]
6. If unknown investor codes account for at least half of all positions, one diagnosis error states which Holdings column was compared with Funding Name's Holdings ID column, with samples (for example a Model Portfolio column holding names instead of codes). [POS-125]
7. Assets held in Holdings but absent from Active Assets are reported once per code name as a warning with the positions and rows, and left out of the Output as in the workbook ('DELTA is held in Holdings … but is not in Active Assets (column J)'). [POS-126]

### 3.20 Reporting date

1. The reporting date is the earliest Reporting Date across all positions (MIN), including excluded ones (rows dated 30 Jun 2026 and 29 Jun 2026 give 29 Jun 2026). Rows skipped in 3.10 do not count. [IN-122, POS-092]
2. **Silent:** if no position has a readable reporting date, there is no reporting date; every remaining life is then blank and every maturity bucket 'Unknown'.

### 3.21 Ratings

1. Each grade (internal, Fitch, Moody's, S&P) is tidied: non-breaking spaces become spaces, every kind of dash becomes '-', spaces around the dash are removed, inner spaces made single ('BBB –' becomes 'BBB-'). [POS-131]
2. A blank grade or 'NR' (any capitals) is NR with score 0. [POS-129]
3. A grade is looked up in Investment Grade Mapping exactly first, then ignoring capitals ('baa1' finds 'Baa1'). [POS-044]
4. A grade not found raises a warning ('Internal grade "BBB(sf)" is not in Mapping › Investment Grade Mapping; treated as NR') and scores 0, keeping its own text. The warning is raised for each position and field where it occurs. [POS-130]
5. The external score is the highest (weakest) of the Fitch, Moody's and S&P scores; 0 if all are NR (Fitch BBB 600, Moody's Baa3 610: 610). [POS-132]
6. The external grade shown is the agency grade with that worst score, taking Fitch, then Moody's, then S&P when several share it; 'NR' if the score is 0. [POS-133]
7. The current grade shown is the internal grade when it is known, not NR and scores above 0; otherwise the external grade (internal NR, external BB: 'BB'; internal A, external BB: 'A'). [POS-134]
8. **Scope's choice, as the workbook:** the current score is the higher (weaker) of the internal and external scores, even when the internal grade is the one shown (internal A 500, external BB 650: shown 'A', score 650). [POS-135]
9. The position is SUB IG when its current score is strictly above the IG threshold (default 610), otherwise IG (610, BBB-, is IG; 620, BB+, is SUB IG). [IN-007, POS-136, POS-138]
10. A score of 0 gives status 'NR'; its IG label stays 'IG', because 0 is not above the threshold. **Scope's choice:** unrated positions carry the IG label, not SUB IG. [POS-137]
11. The closing (initial) rating is carried as written, without scoring. [POS-139]

### 3.22 Tenor, remaining life and maturity bucket

1. Initial tenor is the 30/360 (US) year fraction from the funding date to maturity, as Excel's YEARFRAC basis 0. It is blank, not 0, when either date is missing, so it never pulls an average down (30 Jun 2021 to 30 Sep 2031 is 10.25 years). It is recalculated once the Hardcoded funding date replaces the purchase date (3.15.3). [POS-095]
2. Remaining years run from the reporting date to maturity as actual days divided by 365.25; negative after maturity; blank if either date is missing (30 Jun 2026 to 30 Sep 2031 is 5.25 years). [POS-096]
3. Buckets are tested in the order listed and the first that fits is used (buckets '0-10, 5-15': 7 years is '0-10 y'). [IN-021, POS-099]
4. A bucket written 'a-b' holds remaining lives from a (included) up to b (excluded); its label is the bucket plus ' y'. 3.0 years is '3-5 y', not '0-3 y'; 4.99 is '3-5 y'; 5.0 with 3-5 and 5-10 is '5-10 y'. [IN-021, POS-097]
5. A bucket written 'n+' holds every remaining life of n years or more (25 years with 20+ is '20+ y'). [IN-022, POS-098]
6. If no bucket fits, a negative remaining life is 'Matured' and anything else 'Unknown'; a position with no remaining life (no date) is 'Unknown' (maturity 31 Dec 2025, reporting 30 Jun 2026: Matured; 25 years with buckets 0-3 and 3-5 only: Unknown). [IN-023, POS-100]

### 3.23 Hardcoded and ESG Hardcoded rows matched to assets

1. Hardcoded and ESG Hardcoded rows are indexed by their Security ID (the asset's identification ID), compared as in 1.8.3 (100301 as a number matches '100301' as text). Rows with a blank Security ID are skipped; without a Security ID column (header row or required column not found, 3.2 and 3.3) nothing is indexed and no asset gets Hardcoded or ESG fields. [POS-047]
2. If a Security ID appears twice in either sheet, the first row is used and a warning names the duplicate. [POS-048]
3. Hardcoded Project Name (D) and Code Name (E) are recomputed from Security Mapping, looking the Security ID up as a Holding ID first and then as an identification ID, and compared with the workbook's values on Data › Checks. [POS-049]

### 3.24 FX: rate statistics, reference investor and reference rates

1. Only positions with a currency and an FX rate above 0 contribute to the rate statistics, including positions excluded for other reasons (an unmapped security's rate still counts; a rate of 0 or blank is ignored). [POS-140]
2. For each currency, the rate that appears on most rows is the most frequent rate; on a tie the one seen first wins (GBP 0.855 on 40 rows, 0.86 on 3: 0.855). [POS-141]
3. By default the FX reference investor is the first name in Mapping column H that is exactly an investor column (any of its names); if none, the first column of Funding Name (H = Total platform, Investor 2, Investor 1 gives Investor 2). [IN-006, POS-142]
4. A reference investor set in the settings is used if it is an investor column, exactly or loosely matched (2.12); otherwise a warning is raised and the default above is used. [POS-143]
5. For each currency, the reference rate is the FX rate on the reference investor's first Holdings row in that currency, in sheet order, with a rate above 0; this includes rows excluded for other reasons (Investor 1's first GBP row 0.855, later rows 0.9: 0.855). [IN-003, POS-144]
6. In the workbook rule, if a currency's rows carry more than one rate and the highest is more than 0.5% above the lowest, one information note per currency gives the range and the single rate applied ('GBP: Holdings rows carry 2 different rates (0.855 to 0.9405) …'). [POS-149]

### 3.25 FX: direction of the quote

1. The direction is tested on non-EUR rows that have a non-zero reference-currency amount (3.4.10), a numeric nominal and a rate above 0, including excluded rows. [POS-145]
2. A tested row supports 'divide' if nominal ÷ rate is within 1% of the reference-currency amount, and 'multiply' if nominal × rate is within 1% (8,550,000 ÷ 0.855 = 10,000,000 = the RC amount: divide). [POS-146]
3. On 'auto', amounts are multiplied (rate read as EUR per unit) only if more rows support multiply than divide and at least 60% of tested rows do; otherwise they are divided (rate read as units per EUR, the workbook's formula). 100 tested, 70 multiply, 5 divide: multiply; 50 multiply, 40 divide: divide. [IN-002, POS-147]
4. If no row could be tested, amounts are divided as in the workbook, with an information note 'FX direction could not be checked'. [POS-148]
5. A Holdings rate is then used as units per EUR when the quote is divide, and turned upside down (1 ÷ rate) when it is multiply (1.17 under multiply is 0.8547 per EUR). [POS-150]
6. A currency's rate (used for display, for detection in 3.27 and to fill blank rates) is 1 for EUR, else the reference investor's rate, else the most frequent rate; blank if neither exists (CHF with no Investor 1 row: the most frequent CHF rate). [POS-151]

### 3.26 Display currency

1. The display currency chosen in the top bar is used only if it has a rate (3.25.6); otherwise amounts are shown in EUR with a warning ('Display currency JPY has no FX rate in Holdings; amounts shown in EUR'). [POS-152]
2. Display amounts are EUR amounts times the display currency's rate per EUR (EUR 10m shown in GBP at 0.855 is 8.55m). [POS-153]

### 3.27 Which currency each amount column is in

1. Defaults: nominal auto-detected; drawn and commitment in the quotation currency, unless set otherwise (2.4.3). [IN-005, POS-169]
2. The unfunded column is the first Holdings header containing 'unfunded', 'undrawn amount' or 'undrawn' that does not end in PC or RC ('Balance Unfunded Amount' is used; 'Unfunded PC' is not). Without one, or without a drawn or nominal column, no detection is made and the nominal is read in the quotation currency. [POS-171]
3. Rows tested: not excluded, not EUR, with a numeric unfunded, a numeric drawn, a non-zero nominal and a currency rate (3.25.6) above 0. [POS-172]
4. A row matches a reading when the gap is at most 0.5% of drawn + unfunded plus 1 unit (drawn + unfunded = 10,000,000: tolerance 50,001). [POS-173]
5. A row is quotation currency if nominal is about drawn + unfunded; already EUR if nominal × rate is about drawn + unfunded; portfolio currency if nominal × rate ÷ the portfolio currency's rate is about drawn + unfunded; otherwise other (GBP nominal 11,695,906, rate 0.855, drawn + unfunded 10,000,000: already EUR). [POS-174]
6. On auto, the nominal is read as already EUR if such rows outnumber quotation-currency rows and there are at least 3; else as portfolio currency on the same test; else quotation currency (40 already-EUR rows and 2 quotation-currency rows: already EUR; 2 and 0: quotation currency). [IN-005, POS-175]
7. When auto-detection reads the nominal as already EUR or portfolio currency, a warning says on how many rows and that the workbook's own rule would convert it again. [POS-176]
8. When the quotation currency is kept but some rows look converted, an information note gives the count. [POS-177]
9. When the nominal currency is set (not auto) and some rows do not look like quotation-currency amounts, an information note gives the count. [POS-178]

### 3.28 Converting each position to EUR

Excluded positions are skipped here. For each remaining position, in order:

1. A position quoted in EUR is never converted (rate 1), whatever its row's Forex says (a EUR loan in a GBP portfolio with Forex 0.855: rate 1). [POS-155]
2. In the workbook rule (default), every non-EUR position uses its currency's reference rate, whatever its own row says (GBP row with own rate 0.9: converted at Investor 1's 0.855). [IN-003, POS-157]
3. With 'each position's own rate', a non-EUR position in a EUR portfolio, or one with a blank portfolio currency, uses its own row's rate. A non-EUR position in a portfolio whose currency is not EUR still uses the reference rate (a GBP loan in a GBP portfolio with Forex 1: converted at 0.855), because its own Forex is a rate to its portfolio's currency, not to EUR. [POS-159, POS-158]
4. If the reference investor holds nothing in a currency, positions in it use their own row's rate, with one warning per currency ('Investor 1 holds nothing in CHF: the workbook would convert every CHF position to 0; Scope uses each row's own rate'). **Scope's choice:** the workbook would show 0 here. [POS-160]
5. If the position's rate is still blank or not above 0, its currency's rate from other rows (reference, else most frequent) is used, with one information note per row ('FX rate blank; USD rate taken from other rows'). [POS-162]
6. FX exceptions: an exception applies when its currency equals the position's, its investor equals the position's investor column (any of its names, loose matching allowed) or its investor code, and its View is blank or the selected view (exact names only). The first matching exception wins (Investor 5, GBP, Region A applies to Investor 5's GBP rows only when Region A is selected). [POS-163]
7. An exception naming a Hardcoded column takes, for each asset, the rate in that column (matched by header or row-2 label, ignoring capitals and punctuation) on the asset's Hardcoded row (found by asset code, else by Security ID), if above 0 ('Investor 21 FX for GBP / EUR' = 0.861: 0.861). The rate is read in the same quote direction as the Holdings rates. [POS-164]
8. If that column has no rate above 0 for the asset, the standard rate is kept and one warning per asset is raised (the workbook would show 0). [POS-165]
9. An exception with a fixed rate replaces the rate, read in the same quote direction as the Holdings rates; a fixed rate that is not above 0 leaves no valid rate (rate 0: the position is excluded at the next step). [POS-166]
10. A position without a usable rate above 0 is excluded with reason 'no FX rate for <currency>' and an error ('No FX rate for NOK: position excluded (the workbook's IFERROR would show 0)'). [POS-167]
11. Each converted position records the rate used and where it came from ('rate 0.855: Investor 1's first GBP row (Holdings!R12)', its own row, an exception, or other rows). [POS-168]
12. The portfolio currency's rate is looked up only if some amount column is set to portfolio currency; if it is missing or not above 0, the position's rate is used instead. [POS-180]
13. Each amount is divided by: 1 if already EUR; the portfolio currency's rate if in portfolio currency and that rate exists; otherwise the position's rate (GBP nominal 8,550,000 in quotation currency ÷ 0.855 = 10,000,000 EUR). Nominal, drawn and commitment in EUR are each divided by their own divisor (nominal 8.55m and drawn 4.275m at 0.855 give 10m and 5m). [POS-179, POS-181, IN-001]
14. If the extract carries its own EUR amount (the reference-currency column), Scope's EUR nominal is compared with it row by row, within 0.5% + 1; up to 25 differing rows are listed on Data › Checks. [POS-183]
15. Nominal, drawn and commitment in the display currency are the EUR amounts times the display currency's rate per EUR (EUR 10m, GBP display at 0.855: GBP 8.55m). [POS-182]

### 3.29 Currency-cell check and other FX notes

1. The currency-cell check runs only if Holdings has a column headed exactly 'Current Drawn Amount PC', a drawn column and a column headed exactly 'Portfolio Currency' (capitals ignored). [POS-184]
2. On each included row with both drawn amounts, the quotation and portfolio currencies should be the same exactly when the two drawn amounts are equal (within 0.0001% + 0.5). A row that fails is flagged but its value is not changed (currency GBP, portfolio GBP, Ccy 1,000,000 against PC 855,000: flagged). [POS-185]
3. If any row fails, one warning says how many rows are converted with the wrong rate. [POS-186]
4. EUR positions whose Forex differs from 1 are counted and one information note explains that it is their portfolio's rate and is not applied ('2 EUR position(s) carry a Forex other than 1'). [POS-156]

### 3.30 Global filters

1. When global filters are in force (1.9), every included position whose Holdings row is not among the rows kept is marked filtered out and left out of every total; with no filters nothing is filtered (filter keeps rows 4 to 20: a position on row 25 is filtered out). [POS-127]
2. A position counts in totals only if it is neither excluded nor filtered out; an excluded position on a kept row still does not count. [POS-128]

## 4. From positions to assets

What goes in: the positions from stage 3 (one per Holdings row and investor, already converted to the display currency, rated and given a maturity bucket, some of them excluded), the Mapping tables (Security Mapping, Active Assets, Funding Name), the Hardcoded sheet and the ESG Hardcoded sheet. What comes out: one asset per identification ID, each with its totals, one amount per investor column, the group's attributed share, its amount in every view, its descriptive attributes (sector, country, sponsor, dates, rating, ESG) and its warning flags. In the running order Scope works out the investor columns and views (stage 5) just before this stage, because each asset needs its amount in every view; they are explained in stage 5.

### 4.1 Which positions count

1. A position counts towards an asset only when it is not excluded (stage 3) and not left out by a global filter (stage 7.1). Excluded positions are still listed, but add nothing to any asset. [CALC-091]
2. Example: if Holdings has 3 rows for asset 100301 and one of them is excluded because its security is missing from Security Mapping, the asset has 2 positions.

### 4.2 The list of assets and their order

1. Scope takes every identification ID in Mapping › Security Mapping (column S; if S is blank for a row, that row's holding ID stands in). Each ID is one asset, whatever the number of securities (tranches) that point at it. [CALC-088]
2. Order: first the assets named in Mapping › Active Assets (column J, matched to Security Mapping by code name), in the order they appear there; then every other asset of Security Mapping, in Security Mapping order. Example: Active Assets lists ALPHA, GAMMA; Security Mapping also has DELTA; the order is ALPHA, GAMMA, DELTA. [CALC-088]
3. The asset's name is the Holdings Name (Security Mapping column R) of the first security row of that ID; if that is blank, its Code Name (column Q). [CALC-089]
4. Every distinct Code Name, Holdings Name and Transaction Group of the asset's securities is kept as an alternative name, so that a write-up named after a tranche ("ALPHA-B") still finds the asset. [CALC-090]

### 4.3 The Active Assets list

1. An asset is "in the Active list" when its code name appears in Mapping › Active Assets column J (capitals and spaces don't matter). [CALC-092]
2. If Active Assets column J is completely empty, every asset counts as in the list. [CALC-092]
3. Only assets in the Active list can get an Output row (stage 6). An asset that is held in Holdings but not listed in Active Assets is calculated (its totals, investors and look-through exist) but stays out of the Output, as in the workbook, until it is listed; Scope warns once per such asset with its size (Data › Issues). [VIEW-495]
4. **Scope's choice:** such unlisted assets still appear on the investor pages and in look-through figures (stage 5.16), which are built from every asset, not only the Output.

### 4.4 Asset totals and the investor columns

1. Asset nominal, drawn and commitment (display currency) are the sums over the asset's counted positions; the EUR nominal and EUR drawn are summed the same way. Example: positions of 100m and 20m give a nominal of 120m. [CALC-093]
2. For each investor column (stage 5.7) Scope adds up the nominal, drawn, commitment and number of that investor's positions in the asset: the workbook's SUMIF on investor and asset (Calculations column F). Example: Investor A 100m and Fund X 20m in ALPHA give columns of 100m and 20m. [CALC-094]
3. A position whose investor code is not in Mapping › Funding Name still counts in the asset's totals, in its own column labelled "Unmapped investor <code>", attributed to nobody. Example: code 7099 with 5m becomes a column "Unmapped investor 7099" of 5m with a group share of 0. [CALC-026, VIEW-494]

### 4.5 The group's attributed share and third party

1. Group attributed nominal, drawn and commitment = the sum, over the asset's investor columns, of the column amount times that column's Group ownership (stage 5.6); a column with no ownership (including an unmapped code) weighs 0. This is the workbook's SUMPRODUCT. Example: Investor A 100m × 1 + Investor B 50m × 0.5 + Fund X 20m × 0.4 = 133m. [CALC-095]
2. Third party = asset total minus group attributed, for each of nominal, drawn and commitment. Example: 170m − 133m = 37m. [CALC-096]
3. "Group invested" is Yes when the group attributed nominal is above 0. [CALC-096]

### 4.6 The asset's amount in every view

1. For every view (stage 5) the asset's nominal, drawn and commitment in that view = the sum over the view's terms of term weight times the investor column's amount. A term "every column" ("*") adds every investor column of the asset, including unmapped codes. Example: "Investor A incl. part in funds" = Investor A + 0.25 × Fund X gives 100m + 0.25 × 20m = 105m. [CALC-097]

### 4.7 Finding the Hardcoded and ESG Hardcoded rows

1. The asset's Hardcoded row is the one whose Security ID equals the asset's identification ID (capitals and spaces don't matter). If there is none, Scope tries each of the asset's holding IDs in Security Mapping order and takes the first that has a row. The ESG Hardcoded row is found the same way. Example: Hardcoded keyed by holding ID S1 is still found for asset 100301. [CALC-098]
2. If a Security ID appears twice in a sheet, the first row is used, with a warning.
3. An asset that has at least one counted position but no Hardcoded row gets the flag "no Hardcoded row" and a warning naming it, e.g. "No Hardcoded row for ALPHA (100301)". Its Hardcoded-based attributes stay blank. [CALC-099]
4. An asset with positions but no ESG Hardcoded row gets the flag "no ESG row" and an info message. [CALC-100]
5. **Silent:** an asset with no counted positions and no Hardcoded row gets no message.

### 4.8 The asset's attributes, one by one

"First position" below means the first of the asset's counted positions, in Holdings row order.

1. Funding date: the Hardcoded Funding Date; if that is blank or not a date, the first position's Purchase Date. Example: Hardcoded blank, Purchase Date 30/06/2021 gives funding 30/06/2021. [CALC-101]
2. Sector: the Holdings Sector (Underlying Asset Type) of the first position whose Sector is not blank. The ESG CHI Sector and any "<investor> Sector Classification" column stay separate items (used in 6.12 and on the ESG page). [CALC-102]
3. Subsector: the Hardcoded Subsector; if blank, the ESG Hardcoded CHI Subsector. [CALC-103]
4. Country: the first position's Holdings country, even if blank. [CALC-104]
5. **Scope's choice:** sector skips blank positions but country does not; an asset whose first tranche has no country shows a blank country even when a later tranche has one.
6. Region: from the country (see 4.8.27); a blank country gives a blank region, not "Rest of world". [CALC-105]
7. Sponsor: the Hardcoded Shareholders; if blank, the ESG Hardcoded Shareholders; if blank, the first position's Parent Issuer. [CALC-106]
8. Repayment type: "Bullet" when the first position's Bullet value is y, yes, true, 1 or bullet (capitals don't matter); any other non-blank value becomes "Amortising"; blank stays blank. Example: "N" becomes Amortising. [CALC-107]
9. Cash-flow type: the Hardcoded Cashflow Type as written. [CALC-108]
10. Instrument: the first position's instrument type. [CALC-109]
11. Origination: the Hardcoded Origination; if blank, the first position's origination column. [CALC-110]
12. Deal year: the calendar year of the funding date; blank without one. [CALC-111]
13. Deal lead: the Hardcoded Staff Closing. [CALC-112]
14. Watchlist: the Hardcoded Watchlist value exactly as written (whether it counts as "on the watchlist" is decided in 6.7). [CALC-113]
15. Covenant compliance: the Hardcoded Compliance with Financial Covenants. [CALC-114]
16. IC date: the Hardcoded IC Date as a date; blank if it is not a date. Example: Excel date number 45000 becomes 15/03/2023. [CALC-115]
17. Protection end date: the Hardcoded End of NC / MW as a date; if it is not a date, the text as written. Example: "N/A" stays "N/A". [CALC-116]
18. Upfront fee (bps): the Hardcoded Upfront as a number. [CALC-117]
19. Total transaction size: the Hardcoded Total Debt Offering as a number. [CALC-118]
20. Transaction group: Security Mapping Transaction Group (column U) of the asset's first security row. [CALC-119]
21. Chronological order: the Hardcoded Chronological Order as a number. [CALC-120]
22. WAL (years): the first position's WAL. [CALC-121]
23. Greenfield / brownfield: the first position's Holdings value as written. [CALC-122]
24. Classification: the Hardcoded classification column (e.g. Core / Core+). [CALC-123]
25. Financial close: the first position's Financial Close as a date. [CALC-124]
26. Description: the Hardcoded Description.
27. Country to region: Scope looks the country up in its built-in region table (UK & Ireland: United Kingdom, Ireland; Continental Europe: France, Germany, Spain, Italy, Netherlands, Belgium, Portugal, Finland, Sweden, Denmark, Norway, Switzerland, Austria, Poland, Luxembourg). Capitals, accents and punctuation don't matter, and a trailing bracket is dropped ("Netherlands (the)" becomes Netherlands). Any other country is "Rest of world". Example: "UNITED KINGDOM" becomes UK & Ireland; "Brazil" becomes Rest of world. [CALC-087]
28. **Scope's choice:** the region table cannot be changed from the Scope Settings sheet or the Ownership sheet; only the built-in table applies.

### 4.9 ESG items

1. ESG score, E, S and G scores and GHG scope 1, 2 and 3 (tonnes) are read as numbers from the asset's ESG Hardcoded row. Example: "70" becomes 70. [CALC-125]
2. GHG intensity (tonnes per million of debt) = (scope 1 + scope 2, a blank scope counting 0) ÷ (Hardcoded total transaction size ÷ 1,000,000). It is worked out only when the transaction size is above 0 and an ESG row exists; otherwise blank. Example: 1,500 t ÷ (300,000,000 ÷ 1,000,000) = 5 t per million. [CALC-126]
3. **Scope's choice:** the intensity uses the whole deal's Total Debt Offering, not the platform's exposure, and is not converted into the display currency.
4. CHI Sector, CHI Subsector, CHI sub-subsector, CHI asset type and CHI asset-specific are kept as written.
5. Green loan, CBI taxonomy and SFDR article are always blank (not read from any sheet). Data coverage reads "Reported" when an ESG row exists, else blank. [CALC-127]

### 4.10 Terms the asset takes from its positions

1. Currency: "Multi" when the asset's counted positions carry more than one currency; otherwise that one currency. Example: EUR and GBP tranches give Multi. [CALC-128]
2. Fixed / floating: "Mixed" when the positions differ; otherwise their common value. [CALC-129]
3. Maturity date and margin (bps): the first position's. Coupon is always blank. [CALC-130]
4. Every position of the asset is given the asset's funding date (so the positions view agrees with the asset), and its own initial tenor = YEARFRAC(funding date, its own maturity). Example: funding 30/06/2021, maturity 30/09/2031 gives 10.25 years. [CALC-131]
5. Asset initial tenor = YEARFRAC(funding date, the asset's maturity date); remaining years and maturity bucket are copied from the first position. [CALC-132]
6. Rating: the first position's rating (grade, score, IG label, status). When the positions carry different current grades the asset gets the flag "rating inconsistent" and a warning, e.g. "ALPHA: positions carry different ratings (BBB, BB); the first position's rating is used". [CALC-133]
7. Protected life fraction = (protection end − funding date) ÷ (maturity − funding date), only when all three dates exist and maturity is after funding; otherwise blank. Example: funding 2021, protection end 2026, maturity 2031 gives 0.5. A protection end written as text ("N/A") gives blank. [CALC-134]
8. **Scope's choice:** every per-asset term (maturity, margin, WAL, rating, remaining years, bucket, instrument, country) comes from the first position in Holdings row order, as the workbook's first-match lookups do; reordering Holdings rows can change them.

### 4.11 Active assets

1. An asset is "active" when its total nominal over counted positions is above 0. Example: nominal 0 gives inactive. [CALC-135]

### 4.12 The asset group label used in reports

1. Each asset has a name for grouping: its Code Name; if blank, its Holdings name; if blank, its identification ID. [CALC-137]
2. Assets are grouped by their Security Mapping Transaction Group; an asset with no Transaction Group is its own group, labelled with the name from step 1. Example: "Asset A" and "Asset A top-up" both in group "Asset A" form one group "Asset A". [CALC-142]
3. A Transaction Group name that looks like a code (up to 5 letters, then optionally "-", "_" or a space, then digits only, e.g. "TG-001") is replaced by a readable label; any other group name is used as written ("Asset A" stays "Asset A"). [CALC-138]
4. A code-like group with one asset is labelled with that asset's code name. Example: TG-A with only ALPHA becomes ALPHA. [CALC-139]
5. A code-like group with several assets is labelled with the words all its members' code names start with (capitals don't matter). Example: "Asset A" and "Asset A top-up" give "Asset A". [CALC-140]
6. If they share no first word, the label is "<group> · <shortest code name> +<number of others>", the shortest name chosen alphabetically on ties. Example: TG-001 with AURO01 and BEAC02 becomes "TG-001 · AURO01 +1". [CALC-141]

## 5. Views: who owns what

What goes in: the investor columns of Mapping › Funding Name, the view list in Mapping › Active Assets column H, the Ownership sheet (or the grid edited in the app), the older Scope Settings sheet, and changes made in the app. What comes out: each investor column's type and Group ownership, the list of views with each view defined as "weight × investor column" terms, the view shown, the fund look-through register, and the look-through figures that the investor pages use. Scope's convention for the Ownership grid is: names across the top row and down the first column, and each cell is the share the ROW owns of the COLUMN (1, 0.45, 45% or 9/20).

### 5.1 The attribution label from Mapping column H

1. Unless an attribution label is set (in the app or the Scope Settings sheet) or Mapping column H already contains a view named like the label (default "Group"), Scope looks in column H for names containing "group" that are not investor columns and not "incl. part in funds" names. If there is exactly one, it becomes the attribution label, so the workbook's "<Firm> Group" and the default "Group" are one view. With two or more such names nothing changes. Example: column H lists "Demo Group" and no "Group"; the label becomes "Demo Group" and the grid's "Group" row is its ownership. An info message says so. [CALC-006]

### 5.2 Finding the group's row in the Ownership grid

1. Scope first looks for a row whose name matches, ignoring capitals, spaces and punctuation, the attribution label or one of "Group", "Group weights", "Group weight", "Attribution", "Attribution weights", "Attributed". Example: rows "Group", "Region A", "Investor 1" give "Group" as the group's row. [CALC-001]
2. If none matches, the candidates are the rows that are not an investor column (exact or loosely matched name), not an "… incl. part in funds" row, and whose name does not contain "platform" or "total". Example: rows "Total platform", "Investor 1", "Demo Group" leave only "Demo Group". [CALC-002]
3. Among the candidates Scope takes the first whose name contains the attribution label; else the first whose name contains "group" or "attribut"; else the only candidate if there is exactly one; otherwise there is no group row. Example: candidates "Region A" and "Region B" only give no group row. [CALC-003]
4. If a row was picked this way and no attribution label is set in the app or the Scope Settings sheet, the row's name becomes the attribution label used in every caption ("<label> attributed"). Example: "Demo Group" picked, captions read "Demo Group attributed". [CALC-004]
5. An info message on the Ownership sheet names the row taken and whether its name became the label. [CALC-005]

### 5.3 Cells written down the group's column

Nobody owns a share of the group, so a cell under the group's column can only mean "the group owns this row".

1. Every cell under the group's column, in any row other than the group row and rows whose name contains "platform" or "total", is read as the group's share of that row, never as a term of that row's view. Example: Investor 1's row has 1 under "Group"; it is read as the group owning 100% of Investor 1, not as "Investor 1 + Group". [CALC-007]
2. If such cells exist but the group row itself is empty or missing, Scope assumes the whole grid was filled "column owns row": it turns the grid round, reads it again and looks for the group row afresh. Example: group row blank, Group column shows Investor 5 = 10%, Fund 1 = 45%; the grid is turned round and the Group view becomes … + 10% × Investor 5 + 45% × Fund 1. [CALC-008]
3. Turning the grid round raises a warning on the Ownership sheet explaining that each cell was read as the share the COLUMN owns of the ROW and that Scope's convention is the reverse. [CALC-009]
4. If both the group row and cells under the group column are filled, each column cell is taken out of its row; if the group row has no cell for that row's name, the column cell is copied into the group row. Example: group row lacks Fund 3; Fund 3's row has 60% under Group; the group owns 60% of Fund 3. [CALC-010]
5. Where the group row and the group column give the same name different shares (difference above 0.000000001), the group row's share is kept and the difference is listed. Example: group row Fund 1 = 45%, Fund 1's row under Group = 40%; 45% is used. [CALC-011]
6. After this, Scope raises a warning if any share differed (listing up to 6 differences), otherwise an info message. [CALC-012]

### 5.4 Cells written down an "incl. part in funds" column or a region's column

1. For each "<X> incl. part in funds" name, cells under its column (in rows other than itself, the group row and platform/total rows) are taken out of those rows, so that name is never a term of another row's view. Example: Fund 1's row has 25% under "Investor 1 incl. part in funds"; it is removed from Fund 1's row. [CALC-013]
2. If the "<X> incl. part in funds" row itself is empty, the cells taken from its column become its row, each named row at the share typed. Example: column "Investor 1 incl." has Investor 1 = 1, Fund 1 = 25%, Fund 2 = 15%, its row empty; the view becomes Investor 1 + 25% × Fund 1 + 15% × Fund 2. [CALC-014]
3. If that row is filled AND cells exist under its column, the row is used and the column cells are ignored (info message). [CALC-015]
4. A name that is not the group, not an investor column, not an "incl." name and does not contain "platform" or "total", and whose row is empty, may take its row from its column. Example: "Region A" with an empty row qualifies; "Investor 3" (an investor column) never does. [CALC-016]
5. For such a name, only cells in investor-column rows and other plain rows are moved into its row (not the group row, not "incl." rows, not platform/total rows); an "incl." row that names it is a reference, not a member. Example: "Investor 3" and "Investor 4" rows each have 1 under "Region A"; Region A becomes Investor 3 + Investor 4. An info message shows the result. [CALC-017]

### 5.5 Messages about the group row

1. If an Ownership grid is present but no group row is found, an info message says the group view takes its ownership from elsewhere (the Scope Settings sheet or the built-in defaults) or is empty. [CALC-018]
2. A cell in the group row under a name that is not an investor column of Funding Name (exact or loose) is ignored with an info message. Example: 1 under "Region A" in the group row is ignored. [CALC-019]

### 5.6 Each investor column's type and Group ownership

Scope takes the first of these sources that has something for the column:

1. Changed in the app (Data › Setup): type and ownership as entered; an ownership that is not a number reads as 0. Changes made in the app always win over the Ownership and Scope Settings sheets, which in turn win over the built-in defaults. [CALC-020, VIEW-490]
2. The Ownership grid's group row, when there is one: the column's ownership is the group row's cell under that column, found by exact name (any of the column's names) or by a loose match. A column with no cell gets ownership 0, with no fall-through to the Scope Settings sheet; its type still comes from the Scope Settings sheet's row if one exists. Example: group row has Investor 5 = 0.1 and nothing for Investor 13; Investor 5 is 0.1, Investor 13 is 0. [CALC-021]
3. Without a group row: the Scope Settings › Investors row for the column (matched by workbook name, display name or fund name, or by a unique loose name), when that row has a type or a numeric ownership; a missing ownership reads 0. Example: "Fund 1 · Fund · 45%" gives type Fund, ownership 0.45. [CALC-022]
4. Failing that, the built-in investor table in Scope's own settings, which ships empty; a non-numeric ownership there reads 0. [CALC-023]
5. No source at all: ownership 0, no type, marked as "default" (it is later typed "Unclassified", 5.15). [CALC-024]
6. "Loose match" means: a name of 4 or more characters that is the start of exactly one column name ("Fund One" for "Fund One Units"), else the longest column name it starts with ("Investor 13 Mandate" for "Investor 13"), else contained in exactly one column name. Each loose match is reported once as an info message.
7. **Silent:** in the grid's group row, a column with no cell is simply 0; Scope does not say which columns were left at 0 (apart from the "Unclassified" warning when no type exists either).

### 5.7 The list of investor columns

1. Investor columns are listed in the order their names first appear in Mapping › Funding Name (column Z), each carrying all its portfolio codes (column AA), its fund name (column Y) and its ownership. Example: rows Investor 1, Investor 2, "Investor 1 Portfolio B" (column Z = Investor 1) give columns Investor 1 (2 codes), Investor 2. [CALC-025]
2. After them come the unmapped investor codes that have counted positions, each as its own column of type "Unmapped" and ownership 0. Example: Investor A, Investor B, Fund X, Investor C, then "Unmapped investor 7099". [CALC-026, CALC-027, VIEW-494]

### 5.8 Cleaning the view list in Mapping column H

1. Mapping column H is often a copy of the Calculations header row. Names starting with "Split calculation", "AUM data", "Forex", "Ratings", "Additional AUM data", "ESG data", "Geography" or "Formula bar" (capitals, spaces and punctuation ignored) are section titles and are dropped. Example: "Split Calculations AUM", "Ratings", "Investor 1" leave only "Investor 1". [CALC-031]
2. Names starting with "Commitment", "Drawn", "Nominal" or "Exposure" are measure columns and are dropped, unless the name contains "platform" or "total". Example: "Commitment" dropped; "Drawn total platform" kept. [CALC-032]
3. A name ending in "draw" or "drawn" that is not an investor column is dropped (the Calculations drawn-block headers). Example: "Investor 1 draw", "Region A draw" dropped. [CALC-033]
4. One info message lists every name dropped. [CALC-034]

### 5.9 Views defined by Ownership grid rows

1. The platform total is a name that is not an investor column or "incl." name and is either defined as "every column" in Scope's built-in views or is a Mapping H name containing "platform" or "total". Example: "Infrastructure debt platform" in column H is the platform total. [CALC-035]
2. Grid rows with no cells, and the group's row, define no view. Example: row "Investor 11" with no cells gives no view from the grid (it can still be a plain column view, 5.11). [CALC-036]
3. A grid row named like the platform total is ignored with an info message: the total is always every investor column in full. [CALC-037]
4. A row named after an investor column defines the view "<display name> incl. part in funds"; any other row defines a view of its own name. Example: row "Investor 1" with Fund 1 = 25% gives "Investor 1 incl. part in funds"; row "Region A" gives "Region A". [CALC-038]
5. An investor column's row only becomes its "incl. part in funds" view when Mapping column H names that view (any spelling of the column). Otherwise the row is not used, and an info message explains how to add the view to column H. Example: a stray 1 under Investor 8 in Investor 7's row, and no "Investor 7 incl. part in funds" in column H; the row is ignored. [CALC-039]
6. When Mapping column H lists no views at all, every filled investor-column row becomes an "incl." view. [CALC-040]
7. In a column's row, the column's share of itself is the diagonal cell when typed; else a cell under another spelling of its own name; else 1 (100%). Example: Investor 1's row with the diagonal blank and Fund 1 = 25% gives Investor 1 × 1 + Fund 1 × 0.25. [CALC-041]
8. Every other filled cell becomes a term (name, share). The share as typed ("1/4", "15%") is kept for display when the share is not 1. [CALC-042]
9. A row named "<column> incl. part in funds" (rather than the column's own row) gets the column added at 100% if it does not already name it. Example: row "Investor 1 incl. part in funds" with only Fund 1 = 25% gives Investor 1 + 25% × Fund 1. [CALC-043]
10. A "<region> incl. part in funds" row that names neither the region nor all of the region's members gets the region's row added at 100%, with an info message. Example: "Region A incl." with Fund 1 = 10%, Fund 2 = 5% gives Region A + 10% × Fund 1 + 5% × Fund 2. [CALC-044]
11. When a column's own row and its "… incl. part in funds" row both define the same view, their terms are combined; where both give a name different shares (difference above 0.000000001), the "incl." row's share is used. Example: Investor 1's row has Fund 1 = 25%, the "Investor 1 incl." row has Investor 1 = 1; one view Investor 1 + 25% × Fund 1. [CALC-045]
12. Combining two rows raises an info message, or a warning listing the differences when the shares differ. [CALC-046]
13. When Mapping column H spells a column's "incl." view with another of the column's names, the grid's own spelling is not listed a second time. Example: column H "Investor 1 Portfolio incl. part in funds" and grid row "Investor 1" give one view, with the column H spelling. [CALC-047]

### 5.10 Building the View list

1. The attribution view (the label) is offered whenever there is a grid group row or a Scope Settings group row, even if Mapping column H does not list it. [CALC-048]
2. Order: Mapping column H in its own order first; then the group view; then the views from the grid and the Scope Settings sheet; then views changed in the app; then Scope's built-in views. [CALC-049]
3. With no views in Mapping column H the list starts with "Total platform" and one view per investor column in Funding Name order, and an info message says so. [CALC-050, CALC-053]
4. The built-in "Total platform" is not added when Mapping column H already names a platform total (e.g. "Infrastructure debt platform"). [CALC-051]
5. Names that match ignoring capitals, spaces and punctuation are one view; the first spelling (Mapping H first) is kept; blank names are dropped. [CALC-052]

### 5.11 The definition of each view

1. Scope finds a view's definition row in the grid or the Scope Settings sheet by exact name, by the display name of the column it is named after, or (for an "incl." view) by the same column's look-through row under another name; never by a loose match. Example: "Investor 1 Portfolio incl. part in funds" finds the grid's Investor 1 row. [CALC-054]
2. Order of precedence: changed in the app; the Ownership grid / Scope Settings row; Scope's built-in views; for the attribution name, the Group ownership of every column. Example: a formula for Region A typed in the app overrides the grid row for Region A. [CALC-056]
3. A definition written as a formula (other than "*" or "group") is read term by term ("Investor 1 + 1/4 × Fund 1 + 25% of Fund 2"). If it cannot be read, a warning says so and the view shows nothing. Example: "abc × Fund 1" gives the warning "its formula could not be read". [CALC-057]
4. Each name in a definition is matched to an investor column named exactly (any of its names); else a view named exactly; else a loosely matched investor column; otherwise it stays as typed. Example: "Investor 1 incl. part in funds" in a formula is the view, not the Investor 1 column. [CALC-055]
5. A view defined as "*" is every investor column, including unmapped codes, at weight 1. Example: Total platform = asset total. [CALC-058]
6. The attribution view is each investor column times its Group ownership; columns with ownership 0 are left out. Example: Investor 5 at 10%, Fund 1 at 45% give Group = … + 0.1 × Investor 5 + 0.45 × Fund 1. [CALC-059]
7. In a list of terms, each weight is kept as typed, with text weights read as numbers, percentages or fractions where a whole number means a multiple (2 = × 2, not 2%); a bare name has weight 1. [CALC-060]
8. A term weight that is not a number raises a warning and counts as 0. [CALC-061]
9. A term naming the attribution view or the platform total (and not an investor column) is dropped with a warning, because it would count every column again. Example: "Investor 1 + Group + 1/4 × Fund 1" becomes Investor 1 + 0.25 × Fund 1. [CALC-062]
10. A view with no definition whose name is an investor column (exactly, or loosely for names that are not "incl." names) is that column at 100%. An "incl. part in funds" name is never matched to its base column this way. Example: view "Fund 1" is the whole Fund 1 column, not the group's 45%. [CALC-063]
11. A view whose name equals a column's Funding Name fund name (column Y) is that column at 100%. Example: "Investor 1 Portfolio" is the Investor 1 column. [CALC-064]
12. An "<X> incl. part in funds" view with no definition, where X is exactly a column or another view, is X at 100%, with a warning that no fund share is given. [CALC-065]
13. Any other view with no definition whose name contains platform, total, commitment, drawn, nominal or exposure is read as every column. Example: "Infrastructure debt platform" with no definition is the total. [CALC-066]
14. Any remaining view with no definition shows nothing, with a warning asking for its row in the Ownership grid. Example: column H "Region B" with no grid row. [CALC-067]
15. The formula shown for a view on Data pages is written from its terms before expansion, with the weights as typed (no formula is shown for "*" or the group view). Example: "Region A + 0.1 × Fund 1 + 0.05 × Fund 2". [CALC-075]
16. **Silent:** step 4's loose match is reported once as an info message, but a loose match can pick a column the user did not mean if two names differ only by a suffix.

### 5.12 Views that refer to other views

1. A term naming another view is replaced by that view's columns, each weight multiplied by the term's weight. Example: "Region A incl." = Region A + 0.1 × Fund 1, with Region A = Investor 3 + Investor 4, becomes Investor 3 × 1 + Investor 4 × 1 + Fund 1 × 0.1. [CALC-070]
2. A term that is neither a column nor a view is dropped with a warning. Example: "Region A + Unknown X" drops Unknown X. [CALC-068]
3. A reference that loops back, or nests 5 or more levels deep, is reported as an error and that term is ignored. Example: Loop A = Loop B + Investor 1, Loop B = Loop A gives Loop A = Investor 1 and an error "in a circle". [CALC-069]
4. After expansion, terms for the same column are added together and columns whose total weight is 0 are dropped. Example: "Investor 1 incl. + Investor 2 incl." gives Fund 2 = 0.15 + 0.1 = 0.25. [CALC-071]

### 5.13 Which view is shown

1. When the app starts for the first time no view is chosen and the currency is EUR (stage 7.14). [VIEW-240]
2. The view chosen in the top bar is shown even if it shows nothing. Only a name that is not a view at all is replaced: by the first view defined as every column, else the first view with any term, else the first view. Example: "No such view" shows Total platform; Region A (empty) stays Region A with 0 rows. [CALC-072]
3. An empty chosen view raises a warning saying whether it has no definition or names nothing known. [CALC-073]
4. When the requested view is not available, a warning names the view shown instead. [CALC-074]
5. Choosing another view removes any global filter on Investor or Segment, because those belonged to the old view. [VIEW-204]

### 5.14 The fund look-through register

1. Only "… incl. part in funds" views that have terms and no "every column" term feed the register. Example: Investor 1 incl., Investor 2 incl. and Region A incl. give three sources. [CALC-076]
2. The holder is the view's base (the X of "X incl. part in funds") when X is an investor column. [CALC-077]
3. When X is another view (e.g. a region), the holder is that view and its columns with non-zero weights are its base columns. [CALC-078]
4. If X is neither a column nor a view, a warning is raised and the view's fund weights are not used for look-through. [CALC-079]
5. The holder's ownership is the Group ownership shared by all its base columns, or no value when they differ; its type is the column's type, or "View" for a view. Example: Region A of Investor 3 (1) and Investor 4 (1) gives ownership 1, type View. [CALC-080]
6. Every term that is not a base column and has a weight above 0 is a fund held by the holder; the weight is the holder's share of the fund's units. Example: Investor 1 incl. = Investor 1 + 0.25 × Fund 1 means Investor 1 holds 25% of Fund 1. [CALC-081]
7. A fund that is not an investor column raises a warning and its units are ignored. [CALC-082]
8. A column that any "incl." view holds units of, and that has no type, is typed "Fund" (marked as inferred). [CALC-083]
9. Each holding becomes a register row: fund, holder, share, where the view came from (sheet / changed in the app / settings), holder ownership and holder type. [CALC-084]
10. Columns whose type contains "fund" but that appear in no register row are listed in an info message: their exposure is shown directly only. [CALC-086]

### 5.15 Types worked out from ownership, and positions tagged

1. A column with no type from any source is typed from its ownership: no ownership given anywhere becomes "Unclassified"; ownership of 1 or more becomes "Group entity"; above 0 becomes "Partly owned"; 0 becomes "Third party" (marked as inferred). [CALC-028]
2. When any column is Unclassified, one warning gives the count and up to 4 names, saying they are treated as third party with ownership 0. [CALC-029]
3. A register row without a holder type takes the holder column's type once types are known. [CALC-085]
4. Each position gets its investor column's type and Group ownership; a position whose investor is not a known column gets "Unmapped" and 0. Example: a position of Investor 5 (10% owned) gets "Partly owned", 0.1. [CALC-030]

### 5.16 Look-through: who economically owns each asset

This runs on the investor pages and the investor book, from the register of 5.14.

1. The register (fund, holder, share) comes from the "<investor> incl. part in funds" views of the Ownership grid / Scope Settings sheet / Data › Setup. Example: Fund 1 at 25% in "Investor 1 incl. part in funds" gives a row Fund 1, Investor 1, 0.25. [VIEW-160]
2. A share can be 0.15, "0.15" or "15%" ("%" divides by 100); anything else is not a number. [VIEW-165]
3. A holder that is a view keeps its stated type (if missing, "View") and ownership (if missing, 0). [VIEW-166]
4. A row with a blank fund or holder is ignored with a warning. [VIEW-167]
5. A row whose share is not a number is ignored with a warning. [VIEW-168]
6. A share below 0 or above 1 is reported as an error but used as entered, never capped. [VIEW-169]
7. A holder listed twice for the same fund has its shares added, with a warning. Example: 0.1 and 0.15 become 0.25. [VIEW-170]
8. With no register rows, all exposure is direct and funds appear as holders in their own right (info message). [VIEW-171]
9. A label's type is its investor type; else a view's stated type; else "Fund" if it is a fund in the register; else "Unmapped" if it is an investor column; else "Outside platform". [VIEW-172]
10. A label's Group ownership is its investor ownership, else the view's ownership, else 0. [VIEW-173]
11. A fund's holders are listed by share, largest first, then by name. [VIEW-174]
12. Group share of a fund from its holders = sum of share × holder Group ownership. Example: Investor 1 (1) 25% + Region A (1) 10% = 0.35. [VIEW-175]
13. A fund is consistent when that group share does not exceed the fund's own Group ownership (tolerance 0.000001); unlisted group shares are allowed. Example: Fund 1 ownership 0.45, holders give 0.5: inconsistent. [VIEW-176]
14. External share = 1 − sum of listed shares (can be negative). The residual is shown as "External fund holders". Example: listed 0.35 gives external 0.65. [VIEW-177, VIEW-162]
15. Listed shares above 100% raise an error. [VIEW-178]
16. A fund that is not an investor column gets a warning: it only passes through what it holds in other funds. [VIEW-179]
17. A register fund whose investor type is something other than "Fund" gets an info message. [VIEW-180]
18. When the group share from holders exceeds the fund's ownership, a warning is raised and attribution keeps using the fund's ownership. [VIEW-181]
19. When the fund's ownership exceeds the group share from holders, an info message says that part is not assigned to a named entity. Example: 0.45 vs 0.35 gives "10.0% … not assigned". [VIEW-182]
20. When a register exists, an investor of type "Fund" with no register rows gets an info message and is shown direct only. [VIEW-183]
21. Funds holding units of other funds are followed at most 5 levels deep. A cycle (including a fund holding itself) is an error and look-through stops at the limit; a chain deeper than 5 levels without a cycle gives a warning. [VIEW-161, VIEW-184, VIEW-185]
22. An investor's look-through (indirect) exposure in an asset = sum over the funds it holds of share × that fund's pass-through amount (the fund's direct amount plus what reaches it from funds it holds). Example: Investor 1 = 0.25 × Fund 1 + 0.15 × Fund 2. Total = direct + indirect. [VIEW-186]
23. The ultimate holders of an asset are every holder that is not a pass-through fund, plus External fund holders; External fund holders get each fund's pass-through amount × its external share. Example: Fund 1 holds 40m, external 0.65, so 26m. [VIEW-187, VIEW-188]
24. An asset's ultimate holders are listed by total nominal, largest first, then by name. [VIEW-189]
25. Any amount smaller than 0.000001 currency units is treated as zero. [VIEW-164]
26. Look-through reconciles when ultimate holders minus the direct book is within 0.000000001 × the larger of nominal and commitment (at least 1) plus 0.000001, for nominal, drawn and commitment; otherwise a warning. [VIEW-190]
27. An investor's share of book = its total (direct + look-through) nominal ÷ the direct book total of all assets. Example: 50m of a 500m book is 10%. [VIEW-191]
28. Pages show an investor's exposure as Direct (own column), Look-through (via funds) or Total (both); any unknown choice means Total. [VIEW-163]
29. **Scope's choice:** the look-through and the share of book use every asset with counted positions, including assets not in the Active Assets list, so they can exceed what the Output shows.

### 5.17 Investor figures built from the look-through

1. In an investor's holdings, an asset on the selected view takes its attributes from its Output row; an asset not on the view takes them from the asset itself. [VIEW-192]
2. The Output row's currency and rate-type split (6.4) is dropped, so the asset counts under its own currency and rate type ("Multi" / "Mixed" when tranches differ). [VIEW-193]
3. Each holdings row shows the chosen basis's nominal, drawn, commitment and undrawn (nominal − drawn) in millions; drawn % = drawn ÷ nominal. Example: total 20m, drawn 15m gives undrawn 5m, 75%. [VIEW-194]
4. The "via" column lists each fund with its share, e.g. "Fund 1 (25.0%), Fund 2 (15.0%)". [VIEW-195]
5. On the Look-through basis an investor holds no positions (count 0); Direct and Total use its own column's positions. [VIEW-196]
6. Holdings rows are sorted by exposure, largest first. [VIEW-197]
7. The investor's weighted metrics and breakdowns on a basis come from the same calculation as the AUM page (6.7, 6.8). [VIEW-198]
8. An investor belongs to every view whose definition lists it or "every column", with the summed weight. Example: Investor 4 in Region A at 1. [VIEW-199]
9. Its share of the selected view = its weight in the view × its direct column ÷ the view total. Example: Fund 1 weight 0.45 × 40m = 18m of 300m is 6%. [VIEW-200]
10. A fund's unit holders show share × the fund's amount on the basis, plus an external row (ownership 0, note "not listed in look-through views"). Example: Fund 1 40m gives Investor 1 10m, External 26m. [VIEW-201]
11. In the reconciliation table, a label with no direct or indirect amount is hidden unless it is an investor column; funds are labelled "Pass-through fund", everyone else "Ultimate holder". [VIEW-202, VIEW-203]

### 5.18 Writing the ownership back out

1. The Scope Settings download lists each investor column by its workbook name, the display name only if different, the type blank when Unclassified or Unmapped, and the ownership blank when it was never set. [CALC-220]
2. Total platform, plain-column views and the group view are not written as views; other views keep their non-zero terms. [CALC-221]
3. The Settings table lists Attribution label, IG threshold, Base currency, FX quote, FX rate source, FX reference investor, the single-portfolio setting and Maturity buckets. Example: Group; 610; EUR; …; 0-3, 3-5, 5-10, 10-20, 20+. [CALC-222]
4. Empty values are written as empty cells. [CALC-223]
5. Layout: Investors in B:E, Views in G:H, FX Exception in J:N, Settings in P:Q; titles in row 2, headers in row 3, a note in B1; ownership written as typed ("Investor 1 + 1/4 × Fund 1 + 15% × Fund 2"). [CALC-224]
6. The Ownership download writes a column's "incl." view as that column's row; every other list view is a row of its own. [CALC-225]
7. Names, both across and down: the attribution label, the other view rows, then every investor column by its workbook name; the grid is square. [CALC-226]
8. A cell is written only when non-zero, as the typed text when not 1. Example: Fund 1 = "1/4". [CALC-227]
9. The group row holds each column's Group ownership. [CALC-228]
10. A column's own (diagonal) cell is its share of itself in its "incl." view, else 1. [CALC-229]

## 6. The Output sheet and the metrics

What goes in: the assets of stage 4 and the chosen view of stage 5. What comes out: the Output rows (one per asset with exposure in the view), the portfolio metrics and breakdowns used by KPIs, charts and decks, the per-investor summary, the workbook formula checks, the CSV exports, and the Output sheet page.

### 6.1 Which assets get an Output row

1. An asset gets a row when it is in the Active Assets list (4.3) and its nominal in the selected view is above 0. Example: DELTA, not in Active Assets, gets no row; on the Investor C view only BETA has a row. [CALC-144, VIEW-495]
2. This is the workbook's Calculations column DD: the code name is listed only when the asset's nominal in the selected view is above 0. [VIEW-457]

### 6.2 Amounts on each row

1. Exposure, drawn and commitment = the asset's amounts in the view ÷ the reporting unit (always 1,000,000: millions); undrawn = exposure − drawn; drawn % = drawn ÷ nominal in the view, blank when that nominal is 0. Example: 170,000,000 becomes 170.0; drawn 150 gives undrawn 20 and 88%. [CALC-145]
2. For an "incl. part in funds" view, drawn is blank (the workbook has no drawn column by that name), and so are undrawn and drawn %, unless the "Look through drawn" setting is "show". [CALC-136]
3. Total, group attributed and third-party nominal, drawn and commitment on the row are the whole asset's (all investors), not the view's. Example: on the Investor A view ALPHA shows exposure 100 and total nominal 170. [CALC-146]
4. Group invested reads "Yes" when group attributed nominal is above 0, else "No". [CALC-147]
5. The per-investor amounts on the row are each investor column's whole amount ÷ unit, not weighted by the view. Example: on the Group view Fund X shows 20, not 8. [CALC-152]
6. The row's position count is the number of the asset's positions whose investor has a weight above 0 in the view. Example: on the Investor A view ALPHA has 3 positions, 1 of Investor A, so 1. [CALC-151]

### 6.3 Attributes on each row

1. Sector, subsector, country, region, sponsor, greenfield/brownfield, repayment, instrument, watchlist, WAL, deal year, covenant compliance, cash-flow type, classification, financial close, chronological order, currency, fixed/floating, margin, funding and maturity dates, tenor, remaining years and bucket are the asset's (stage 4).
2. Covenant type and coupon are always blank. [CALC-148]
3. Rating, rating score, IG label and status come from the asset's rating; without one they are blank. [CALC-149]
4. GHG scope 1+2 = scope 1 + scope 2, a blank scope counting 0. Example: 1,000 and blank give 1,000. [CALC-150]

### 6.4 Splitting an asset's exposure by position currency and rate type

1. For each asset Scope also splits its view exposure position by position: each position's nominal × (sum of "every column" weights + its investor's weight in the view), added up by the position's currency and, separately, by its fixed/floating reading; zero or non-numeric parts are skipped. Example: ALPHA with EUR 120m and GBP 50m gives EUR 120, GBP 50. [CALC-143]

### 6.5 Order and rank

1. Rows are sorted by exposure, largest first, and ranked 1, 2, 3, … Example: 170, 105, 100 give ranks 1, 2, 3. [CALC-153]

### 6.6 Messages listing what was seen

1. An info message lists each raw Rate Type value of included positions ("(blank)" for empty), how Scope read it and how many positions, most frequent first. Example: "EURIBOR 6M" becomes Floating (1), "FIXED" becomes Fixed (1). [CALC-154]
2. An info message lists each watchlist value with its count and whether it counts as on the watchlist; nothing is listed when every value is blank. Example: "Watch" × 3 = on the watchlist, "No" × 40 = not on it. [CALC-155]

### 6.7 Portfolio metrics

All metrics are computed from the selected view's Output rows (after global filters). [CALC-156]

1. Total exposure = sum of row exposure. Total drawn = sum of row drawn (blank rows as 0), or blank when no row has a drawn value (look-through views). [CALC-159]
2. Exposure-weighted averages = sum of value × exposure ÷ sum of exposure over rows that have a value; blank when none has one. Example: margins 250/200/180 on 170/100/105 give 217.1 bps. [CALC-160]
3. Coverage = exposure of rows with a value ÷ total exposure (0 when total is 0). Example: margin on 300 of 375 gives 80%. [CALC-161]
4. Weighted rating score: exposure-weighted over rated rows only. Example: BBB 600 on 170, A 500 on 105, NR on 100 gives 561.8. [CALC-162]
5. Weighted rating label: the grade whose score is nearest (first on ties), using only the S&P/Fitch-style grades (AAA to D with + or −) of Mapping › Investment Grade Mapping; "NR" when no row is rated or the scale has no such grade. Example: 561.8 is nearest 590 (BBB+). [CALC-163]
6. IG exposure = exposure of rated rows labelled IG; NR exposure = exposure of rows not rated. [CALC-164, CALC-165]
7. Undrawn = total − drawn; drawn % = drawn ÷ total (blank when total is 0); total commitment = sum of row commitment. Example: 375 − 355 = 20; 94.7%. [CALC-166]
8. Number of assets = number of rows; number of positions = sum of row position counts. [CALC-167]
9. Book total, book group and book third party = sums of the whole-asset nominal, attributed and third party over the view's rows. Group share of book = book group ÷ book total (blank when 0). Example: 179 ÷ 375 = 47.7%. [CALC-168, CALC-169]
10. Weighted margin (bps) and weighted WAL, each with its coverage; weighted remaining years and weighted initial tenor. Example: remaining 5.2 y on 170 and 2.5 y on 100 give 4.2 y. [CALC-170, CALC-171]
11. Rated share = 1 − NR ÷ total; sub-IG share = 1 − IG ÷ total − NR ÷ total (NR is in the denominator, not in sub-IG); NR share = NR ÷ total. Example: IG 275, NR 0, total 375 give sub-IG 26.7%. [CALC-172]
12. Watchlist share = exposure whose watchlist value counts as "on the watchlist" ÷ total. A value counts when it says watch, intensive, yes, amber, red, orange, monitor, alert, special, enhanced, under review or true (or is y, 1 or x), and does not say no/none/OK/normal/performing/green/n/a and similar. Green share is always blank. Example: "Yes" on GAMMA 105 of 375 gives 28%. [CALC-173]
13. Weighted ESG score and its coverage; GHG scope 1+2 = sum of row values (not weighted). Example: 1,500 + 3,000 + 4,500 = 9,000 t. [CALC-174]
14. Fixed share = the Fixed part of the position-split fixed/floating breakdown (6.8) ÷ total exposure. Example: Fixed 225 of 375 gives 60%. [CALC-175]
15. **Scope's choice:** the engine's sub-IG share uses all exposure as denominator (the workbook's); the AUM page KPI by default uses rated exposure instead (7.5.13), while the Concentration page uses all exposure (7.8.9).

### 6.8 Breakdowns (distributions)

1. For filters and breakdowns, rating and IG/Sub-IG read "NR" for unrated rows; deal year is used as text. [CALC-176]
2. A row with no value for a breakdown is counted under "(blank)". [CALC-177]
3. Currency and fixed/floating use the position split of 6.4: an asset with more than one positive part is shared out pro rata over them; one part gives that part's label; no parts give the row's own label. Drawn is shared by the same fractions, and each part adds 1 to its category's asset count. Example: ALPHA 170 with EUR 120 and GBP 50 adds EUR 120 and GBP 50 (no "Multi"); drawn 150 becomes EUR 105.9 and GBP 44.1. [CALC-179, CALC-178, CALC-185]
4. Each category's share = its exposure ÷ total exposure (0 when total is 0). [CALC-180]
5. Where a fixed order is given, the listed labels come first in that order and any other label after them. Otherwise breakdowns sorted by label sort naturally (2 before 10), and all others by exposure, largest first. [CALC-181, CALC-182, CALC-183]
6. Rating: the S&P/Fitch-style scale grades in scale order, then NR; unrated rows are NR. [CALC-184]
7. **Silent:** a current grade that is not an S&P/Fitch-style grade (e.g. a Moody's "Baa2" used as an internal grade) is placed after NR, with no message.
8. Sector, subsector, country, region, repayment, instrument, sponsor, cash-flow type, covenant compliance and transaction group use the row value, largest first. [CALC-186]
9. IG: IG, SUB IG, NR (empty categories are not shown). [CALC-187]
10. Fixed/floating: Fixed, Floating, Mixed, Not stated, others after; split by position. [CALC-188]
11. Watchlist: No, Watch, Intensive first. [CALC-189]
12. Maturity bucket: the buckets in their configured order (each followed by " y"), then Matured, Unknown. [CALC-190]
13. Deal year sorted by label; greenfield lists Greenfield then Brownfield; green loan, CBI and SFDR are one blank category each. [CALC-191]
14. Group split: two parts, "<label> attributed" = book group and "Other investors" = book third party. Example: "Group attributed" 179, "Other investors" 196. [CALC-192]

### 6.9 Per-investor summary

1. For each investor column: nominal, drawn, commitment and positions summed over every asset (the whole book), whatever the view. [CALC-157]
2. Also, selected nominal and drawn = the sum of that column over the view's Output rows. [CALC-158]

### 6.10 Workbook formula checks and closing messages

1. Scope recomputes certain workbook formula columns (Holdings formula columns, Hardcoded D and E) and compares them with the values in the sheets. A check with nothing to compare and no failures is not reported. [CALC-193]
2. When every workbook value of a check is a formula error, the check is "skipped" with an info message (Scope calculates these itself). [CALC-194]
3. A check is "ok" when every value matches, "warn" when more than 95% match, otherwise "error". Example: 990 of 1,000 is warn; 900 is error. [CALC-195]
4. Formula-error values that were not compared are noted in an info message. [CALC-196]
5. A check that is not ok raises a warning or error "n of total differ". [CALC-197]
6. Mapping › Fund Check entries that are not investor columns (and not platform, total or measure names) are listed in an info message. [CALC-198]
7. Rows below the data that hold only copied formulas (e.g. "0x0") are ignored with an info message. [CALC-199]
8. When reporting dates differ between rows, the earliest is used, as in the workbook, with an info message. [CALC-200]
9. The result is marked as unusable when Holdings, or its Security ID, Nominal or Currency column, is missing (the AUM page then shows an error notice, 7.5.25). [CALC-201]

### 6.11 Display currencies offered

1. The currency selector offers the base currency plus every currency of the FX table with a valid rate. Example: EUR, GBP, USD. [CALC-202]

### 6.12 An investor's own sector classification for reports

1. Hardcoded headers containing "sector classif…" with no letter just before "sector" are sector-classification columns ("Investor B Sector Classification" yes; "Subsector Classification" no). [CALC-203]
2. With no such columns, reports use the Holdings sector. [CALC-204]
3. Names checked: the view's own name and the cover name, and each investor in the view with its names (display name, workbook name, fund name, group, and the Holdings portfolio names and codes of its positions). [CALC-205]
4. A column is picked only for a client, and only on the client's own views. A client is an investor with its own "<investor> Classification" column (Core / Core+) as well as its sector one, as the workbook's reporting sheet switches both with one client flag; an investor with only a sector column keeps the Holdings sector (the house look) unless it is picked on Investor reporting. The client's column is picked when the client (the header without "Sector Classification") appears as a whole word in the view's name or cover name, or in the names of every investor in the view. A view that merely includes the client's mandates (a region, the group, the platform), or holds only deals the client also holds, keeps the Holdings sector. Example: view "Investor 21 mandate" picks "Investor 21 Sector Classification"; "Investor 14 mandate" keeps the Holdings sector; the client's mandate plus another investor does not pick it. [CALC-206]
5. With exactly one client in the workbook, a view made up only of investors of type Mandate picks the client's column when the client has classified at least half of the view's exposure; an asset left blank takes its Holdings sector in the report. The client's mandates often share no name with its columns. Otherwise pick it once per view on Investor reporting, which says why the client's column was not picked (no Classification column beside it, more than one client, investors not all of type Mandate, or the column filled for less than half of the view). [CALC-230, CALC-232]
6. Picking no column leaves everything unchanged. [CALC-210]
7. With a column picked, each row's sector becomes that Hardcoded value (blank if none), the Holdings sector being kept alongside; only the sector breakdown is recomputed, metrics and other breakdowns are unchanged. When the workbook also has the client's own subsector column (a Hardcoded header naming the client and containing "Subsector"), each row's subsector becomes its value there in the same way. [CALC-211, CALC-212, CALC-231]

### 6.13 Output CSV and Positions CSV

1. Each Output CSV row carries rank, identification ID, project name, code name, transaction group, the view name and the display currency. [CALC-213]
2. The file uses its own headings ("position_currency", "spread_bps", "current_rating", "rating_score") and dates as year-month-day. [CALC-214]
3. "ig_label" is "NR" for unrated rows; flags are joined with "|". [CALC-215]
4. One "nominal_m: <investor>" and one "drawn_m: <investor>" column per investor column, 0 when the asset has none. [CALC-216]
5. The Positions CSV holds every position not left out by a global filter, excluded ones included. [CALC-217]
6. Converted amounts are headed "nominal_<currency>" and "drawn_<currency>". [CALC-218]
7. "ig_label" is NR for unrated; "excluded" is "Y" or blank, with its reason. [CALC-219]

### 6.14 The Output sheet page

1. The Output page shows the Output rows of the selected view, with the header row in the workbook's order and names; "Code name" and "Project name" are Scope's first two columns. [VIEW-461]
2. Selection exposure and Selection exposure - drawn are Calculations DI and FA ÷ 1,000,000. [VIEW-462]
3. Columns read from Holdings take the asset's first position's value, looked up by the Holdings row-2 name. [VIEW-460]
4. Columns in order: Code name, Project name, Selection exposure, Selection exposure - drawn, IC date, Chronological order, Country Code, Jurisdiction Tier, Sector (Holdings, first position), Subsector, Cashflow Type, Brownfield / Greenfield, Primary / Secondary, Currency (Multi when tranches differ), Bullet / Amortizing, Maturity date, Fixed / Floating, Description, Listed / Unlisted, Format, Shareholders, Origination, Staff Closing, Staff Monitoring, FMCG monitoring, Infra code, Project code, Borrower Name, "Infrastructure debt platform" (the asset's total nominal, all investors), "Initial commitment (QC)" (the asset's total commitment, converted), one column per investor column (nominal), one "<investor> (drawn)" per investor column, then the Terms, Ratings, Covenants and Classification blocks.
5. Each "incl. part in funds" view adds a "<investor> draw" column. [VIEW-463]
6. Terms block: All-in spread (bps), Spread, Upfront, Floored, Yield, Prepayment protection (1) and (2), End of NC / MW, % of time protected (4.10.7), Current Maturity, Maturity at inception (asset initial tenor), Current WAL, Current duration, IC date, Financial Close, Funding date, Expected COD if greenfield, Total debt offering. Ratings block: Current rating, Current calc, Internal rating, Internal calc, External rating, External calc, External Rating Fitch, Moodys, S&P, INVGRD, Initial Rating, Watchlist.
7. Covenant columns follow the Calculations order, except that Leverage lock-up comes before Leverage covenant. [VIEW-464]
8. Classification block: Part of Global Strategy, Jurisdiction Tier, STEC, Spread / STEC, Compartment, Classification, Sector classification, TICCS Code, TICCS Sector, TICCS Subsector, Sector classification (investor), Country Tier, each labelled as the workbook labels it where the Hardcoded sheet has such a column (7.13.4).
9. On this page every number without its own decimals shows one decimal; elsewhere on sheet pages whole numbers show as whole numbers, numbers of 1,000 or more with two decimals and others with up to four decimals. [VIEW-465]
10. **Scope's choice:** on the Output page the one-decimal display also applies to non-amount numbers such as Chronological order, Upfront, Yield and the rating scores.
11. Only amount columns get a total at the bottom; rates, ratios and scores do not. [VIEW-466]
12. The .xlsx download has header rows as in the workbook (labels, then formulas or sources, then values; Calculations also has letters); dates are year-month-day. [VIEW-467]
13. Columns the Holdings sheet does not carry are blank and listed in a notice. Example: no "Floored" column. [VIEW-469]

## 7. The pages you see

What goes in: the result of stages 4 to 6 for the view and currency chosen in the top bar, and the global filters. What comes out: what every page shows and exports. A rule that applies to every page: global filters are applied inside the calculation, so every page, KPI, chart, table and export shows the same filtered book.

### 7.1 How a global filter narrows every page

1. Global filters are a list of conditions kept with the settings. They are applied inside the calculation, so the AUM page, Concentration, ESG, investor pages, sheets and decks all show the same filtered book. Example: Country = Germany makes every page show only German assets. [VIEW-205]
2. Pass 1: Scope runs the whole calculation without filters and builds one record per position (7.4). Filters are tested on those position records. Pass 2: Scope reruns the whole calculation using only the Holdings rows that passed. [VIEW-209, VIEW-058]
3. A Holdings row is kept when its position record passes every filter, matched by Holdings line number. [VIEW-207]
4. Excluded positions are never marked as filtered out: they stay in the filtered result as excluded (still not counted, still listed). [VIEW-208]
5. A filter whose item no longer exists in the data (e.g. a removed Hardcoded column) is ignored and not shown as active. [VIEW-206]
6. **Silent:** that dropped filter gives no message.
7. Data-quality issues, issue counts and inputs always come from the unfiltered run. [VIEW-210]
8. The unfiltered result is kept per data version, view and currency, and the filtered one also per filter list, so returning to the same choice is instant; any change clears them. [VIEW-263]
9. **Scope's choice:** because pass 2 reruns the calculation on the kept rows only, a filter on something that differs between positions (currency, fixed/floating, rating, investor, an amount range) keeps only the matching tranches. The asset's totals, "All investors", group attributed, its first position (and so its country, maturity, rating) and its rank are then recomputed from the kept tranches only. Example: Currency = EUR on ALPHA (EUR 120m, GBP 50m) shows ALPHA with 120m and currency EUR.
10. **Scope's choice:** the rank shown on every page after a filter is the rank among the filtered assets (1, 2, 3 …), not the unfiltered rank.

### 7.2 The filter bar, chips and the value checklist

1. When filters are saved, a filter with an empty "is one of" / "is not one of" list, or with no item or operator, is dropped. [VIEW-211]
2. Adding a filter on an item already filtered replaces the old one. Example: Country = Germany then Country = France leaves only France. [VIEW-212]
3. A filter added without an operator is "is one of". [VIEW-213]
4. The checklist and the list of items use the unfiltered result of the selected view and currency. [VIEW-214]
5. An asset list written by the AUM page for a label no position carries reads "<dimension>: <label> (n assets)". Example: "Currency: Multi (3 assets)". [VIEW-215]
6. In chip text, amounts are divided by the unit and shown with one decimal plus "m" when the unit is millions. Example: "Exposure ≥ 50.0m". [VIEW-216]
7. A chip reads "<item>: v1, v2, v3 +n" (first three values), "<item>: not v1, v2 +n" (first two), "<item>: a to b", "≥", "≤", "contains", "is blank" or "is not blank". [VIEW-217]
8. The item picker offers every item except the Positions count, the distinct counts (Assets, Investors) and the per-investor nominal/drawn columns. [VIEW-218]
9. Amounts, numbers and dates are filtered with a from/to range; everything else with a value checklist. [VIEW-219]
10. The checklist shows each value's position count and exposure among included positions that pass the other filters; values already selected but now absent stay visible with zero counts. [VIEW-220, VIEW-221]
11. Order: ratings, buckets and years in their natural order; others by exposure, largest first, then natural label order. [VIEW-222]
12. Editing an existing "is not one of" filter pre-ticks every other value. [VIEW-223]
13. Checklist exposure is shown ÷ 1,000,000 whatever the unit. [VIEW-224]
14. Applying a checklist with nothing ticked removes the filter; otherwise it becomes an "is one of" list. [VIEW-225]
15. Amount ranges are typed in millions and stored in full units; dates as year-month-day. [VIEW-226]
16. Both bounds give "between" (both ends included); only From gives "≥"; only To gives "≤"; neither removes the filter. [VIEW-227]
17. A range on an amount is tested on each position, not on the asset total. Example: Exposure ≥ 50m drops an asset made of 5 positions of 20m. [VIEW-228]
18. Named filter sets are saved in this browser and listed alphabetically. [VIEW-229]
19. Summary at the end of the bar: with filters "<ccy> <filtered>m of <total>m (<share>) · <n> of <N> assets"; without "All N assets · <ccy> <total>m · filters apply to every page". [VIEW-230]

### 7.3 The search box

1. Search lists values of sector, subsector, country, region, sponsor, currency, rating, IG label, investor group, fixed/floating, repayment, instrument, maturity bucket, watchlist, deal lead, CBI taxonomy, SFDR article and greenfield/brownfield; choosing one adds a global filter. [VIEW-231]
2. It lists assets that have at least one position, matching on name, code, code name, holding/security IDs or sponsor. [VIEW-232]
3. It matches investors on name, segment, ID or type; choosing one opens the investor page. [VIEW-233]
4. A value's amount is the exposure of included positions carrying it. [VIEW-234]
5. Every typed word must match (capitals don't matter). [VIEW-235]
6. Ranking: name starts with the term first, then a word starting with it, then anywhere; assets before investors before values before pages; ties by larger amount. [VIEW-236]
7. At most 6 results per kind and 24 in total, plus a line that asks the text in Ask Scope (7.17). [VIEW-237]
8. Enter opens the result; Alt+Enter (or the filter button) applies it as a filter; results with no page always filter. [VIEW-238]
9. The Ask Scope line comes first when the text reads like a question (three words or more, or it starts with what, which, who, how, top, total or the like); Enter on it opens Ask Scope with the answer. [ASK-018]

### 7.4 The records behind the Explorer, filters and custom sheets

There are two kinds of record: one per position (positions) and one per Output row (assets).

1. A measure that is not a number (margin, coupon, WAL …) is kept as "no value" and skipped in averages, never counted as 0. [VIEW-001]
2. An amount that is not a number (nominal, drawn, commitment, GHG, transaction size) is read as 0 so totals never go blank. [VIEW-002]
3. Bands: "a-b" includes a and excludes b; "a+" catches everything from a; a value in no band is "Negative" below zero, else "Other"; no value gets no band. Example: 3.0 years with 0-3, 3-5 falls in "3-5 y". [VIEW-003, VIEW-004, VIEW-005]
4. Band edges come from Scope's own settings when present, else the defaults: remaining years 0-1, 1-3, 3-5, 5-7, 7-10, 10-15, 15+; WAL 0-3, 3-5, 5-7, 7-10, 10-15, 15+; margin 0-100, 100-150, 150-200, 200-250, 250-300, 300-400, 400+ bps; size 0-10, 10-25, 25-50, 50-100, 100-250, 250+ (millions). [VIEW-006, VIEW-007, VIEW-008, VIEW-009, VIEW-010]
5. **Scope's choice:** the band edges cannot be set from the Scope Settings sheet or Data › Formulas; only the defaults apply unless the program's own settings are edited.
6. With no configuration, maturity buckets are 0-3, 3-5, 5-10, 10-20, 20+; the unit is millions; the display currency is the chosen one, else the base currency, else EUR; the attribution label is the one in force, else "Group". [VIEW-015, VIEW-016, VIEW-017, VIEW-018]
7. Unit label: the currency plus " m" (millions), " k" (thousands), " bn" (billions), nothing otherwise. The size band is labelled with it, e.g. "Size band (EUR m)". [VIEW-019, VIEW-039]
8. Each position's weight in the view = sum of the view's weights for its investor plus any "every column" weight (a weight without a number counts 1); with no view, every investor weighs 1. Exposure = nominal × that weight; exposure drawn = drawn × that weight. A position is a "platform member" when the weight is above 0. Example: nominal 40m, weight 0.25 gives exposure 10m. [VIEW-020, VIEW-021, VIEW-066, VIEW-064]
9. Attributed = nominal × the investor's Group ownership (missing counts 0); Other investors = nominal − attributed. Example: 40m × 0.45 = 18m, other 22m. [VIEW-059, VIEW-067]
10. Undrawn = nominal − drawn. [VIEW-065]
11. Each position takes its asset's attributes (sector, country, sponsor, watchlist, WAL …); its currency, fixed/floating, rating and maturity are its own. "Asset (grouped)" is the asset's group label (4.12), else the asset name. Instrument: the asset's, else Hardcoded's, else the position's. [VIEW-060, VIEW-061]
12. **Scope's choice:** on the positions records, WAL is the asset's (its first position's), not each tranche's own WAL.
13. An unrated position shows rating "NR" and IG label "NR" (the workbook shows "IG" for a score of 0), and has no rating score. [VIEW-062, VIEW-068]
14. GHG scope 1+2 = scope 1 + scope 2, missing parts as 0. [VIEW-069]
15. Excluded positions stay in the position records with Excluded = "Yes" and their reason. [VIEW-063]
16. Position size band uses position nominal in millions; asset size band uses view exposure in millions. [VIEW-070, VIEW-081]
17. Positions outside the global filter are left out of the records entirely. [VIEW-058]
18. Every Holdings column (positions records) and every Hardcoded and ESG Hardcoded column (both kinds) becomes an item that can be filtered or pivoted. [VIEW-051]
19. A raw value that is empty, only spaces or starts with "#" (Excel errors such as #N/A) is blank. In a column whose header contains "date" (capitals don't matter) a number between 20,000 and 80,000 is an Excel date number; other values are read as dates or kept as text. [VIEW-049, VIEW-050, VIEW-052]
20. A raw column is a number column when at least 80% of its non-blank sampled values (first 500 positions / 300 assets) are numbers. If its header equals an existing item's name, the sheet name is added in brackets ("Sector (Hardcoded)"). [VIEW-053, VIEW-054]
21. A raw number column whose header contains amount, notional, commitment, balance, book value, revenue, ebitda, offering, nominal, ghg or scope is summed; any other is exposure-weighted. Hardcoded/ESG summed columns count once per asset; Holdings amounts are summed per position in source units, not converted. [VIEW-055, VIEW-056]
22. Raw numbers of 1,000 or more show as whole numbers, smaller ones with two decimals, "–" when missing. [VIEW-057]
23. Order rules: listed values first, then unlisted, blanks last; years and ranks as numbers; dates by date; bands in edge order then Negative, Other; ratings by scale score (grades only seen on positions use their own score; unknown grades after known, then NR, then blanks; capitals don't matter); investors in workbook column order; investor types by their largest Group ownership, then average, then name; buckets in configured order, then Matured, Unknown; Greenfield before Brownfield; watchlist No, Watch, Intensive; Excluded No before Yes; Platform member and "<Group> invested" Yes before No; IG, SUB IG, NR; rated before NR; Fixed before Floating; green loan Y before N. [VIEW-011, VIEW-012, VIEW-013, VIEW-014, VIEW-022, VIEW-023, VIEW-024, VIEW-025, VIEW-026, VIEW-030, VIEW-031, VIEW-033, VIEW-034, VIEW-035, VIEW-036, VIEW-037, VIEW-038]
24. Amounts are kept in full units and shown ÷ unit with one decimal; position-currency nominal and drawn are shown in full units, "–" when missing; an empty value is shown as "(blank)" but never stored as that text. [VIEW-027, VIEW-028, VIEW-029]
25. Tranche, Holding ID, Security name, Position key and the investor items exist only on positions; Rank, "<Group> invested", Drawn % and Protected life only on assets. [VIEW-032]
26. Totals: transaction size and GHG once per asset; Positions sums 1 per record; Assets and Investors are distinct counts; margin, coupon, WAL, tenors, remaining years, ESG score and upfront fee are exposure-weighted; rating score weighted over rated positions only; FX rate a plain average; on assets, Drawn % and Protected life are exposure-weighted; an amount averaged is weighted by exposure. [VIEW-040, VIEW-041, VIEW-042, VIEW-043, VIEW-044, VIEW-045, VIEW-046, VIEW-047, VIEW-048]
27. Asset records: one per Output row of the selected view; exposure and exposure drawn are the Output row's amounts back in full units; nominal, drawn, commitment are the asset totals (all investors), attributed is the asset's group nominal, Other investors = nominal − attributed; each investor column adds "<investor> nominal" and "<investor> drawn". [VIEW-072, VIEW-073, VIEW-078, VIEW-071]
28. On asset records, "Investors" is the number of investor columns with nominal above 0 in that asset, summed across assets (not distinct). [VIEW-074, VIEW-082]
29. Asset as-of date is the first position's; asset records are always Excluded = "No"; "<Group> invested" defaults to No; position-currency amounts are blank for "Multi" assets; the FX rate is the plain average of the positions' rates. [VIEW-075, VIEW-076, VIEW-077, VIEW-079, VIEW-080]

### 7.5 The AUM page

1. The page shows the Output rows (one per asset with exposure) for the view and currency selected in the top bar (Output!G8 and G6). [VIEW-272]
2. Subtitle: "<ccy> millions · reporting date <date> (<quarter>) · <Group> attribution · <n> assets, <m> positions on this platform". [VIEW-280]
3. A "synthetic" badge shows when the data label contains "synthetic". [VIEW-273]
4. The page's filters are the global "is one of" filters on items the page knows; IG / Sub-IG and Greenfield/brownfield are translated between the page and the records. [VIEW-265]
5. Filtering on Transaction group, Currency "Multi" or Rate type "Mixed" (labels only assets carry) is written to the global filters as a list of the matching assets. [VIEW-266]
6. When the page writes its filters, global filters it does not manage (other items, ranges, asset lists not written by it) are kept, in their order. [VIEW-267]
7. A row with no value is labelled "(blank)"; page filters combine with AND across items and OR within one, only "is one of" and "is not one of", and filters on unknown items are ignored. [VIEW-268, VIEW-269]
8. Clicking: ctrl/cmd-click adds or removes a value; a plain click filters to just that value and clicking the only selected value again clears it; "Other" bars do nothing; a two-level breakdown row filters to every label in its path (clicking it again when it is the sole selection clears). [VIEW-274, VIEW-275, VIEW-276, VIEW-277]
9. Without page filters, KPIs and charts use the calculation's own metrics; with filters, the filtered Output rows are summarised the same way. [VIEW-278]
10. "Open in Explorer / Pivot" passes the view, currency and page filters (as filters on asset records). [VIEW-279]
11. Bar sentence: "<x> of <y> assets · <ccy> <filtered> of <total> m (<share>)", totals being the whole view before any filter; a chip "<n> excluded" links to Data › Issues; the issues link counts errors plus warnings, not info messages. [VIEW-283, VIEW-284, VIEW-285]
12. If the calculation is unusable (6.10.9) an error notice points to the column mapping. [VIEW-282]
13. Weighted rating KPI: the nearest grade to the exposure-weighted score of rated assets, with the sub-IG share and the NR share when above 0. By default the sub-IG share = sub-IG exposure ÷ (total − NR exposure); ticking "NR in sub-IG denominator" uses all exposure (the workbook's). Example: sub-IG 30, NR 20, total 200 gives 16.7% (default) or 15.0%. [VIEW-286, VIEW-287]
14. KPIs: Exposure (with asset and position counts), Drawn (with drawn % of exposure), Undrawn; on the Group's own view the fourth KPI is "<Group> share of these assets" (group exposure ÷ all investors in those assets), on other views Commitment. [VIEW-288, VIEW-289]
15. Weighted spread in bps with coverage; weighted WAL with weighted remaining tenor; Watchlist share turns amber above 15%. [VIEW-290, VIEW-291, VIEW-292]
16. Charts: country shows the top 10 and folds the rest; the rating chart states the IG threshold; fixed/floating and currency are split position by position; on the Group view a donut shows Group vs other investors; under the fixed/floating donut each Rate Type spelling is listed with how it was read and its count. Breakdown chart top N is 10, 14, 20 or All. [VIEW-293, VIEW-294, VIEW-295, VIEW-296, VIEW-297, VIEW-298]
17. Breakdown starts on Subsector, top 14. [VIEW-264]
18. Breakdown without a column item shows Exposure, Share (of the filtered total), Drawn, Assets (distinct), Margin and Remaining years (exposure-weighted); with one, exposure per column and a total. [VIEW-300]
19. In the breakdown table the "Drawn" column is the view's share of the drawn amount, so it is never more than Exposure and its total equals the Drawn figure at the top of the page. [VIEW-300] **Scope's choice:** the breakdown table does not split Multi-currency or Mixed-rate assets (the charts do).
20. Order: rating by scale score then NR; IG, SUB IG, NR; buckets in breakdown order; Fixed, Floating; No, Watch, Intensive; Greenfield, Brownfield; deal years as numbers; all other breakdowns by exposure, largest first. [VIEW-299, VIEW-301]
21. With a column item, at most 8 columns: beyond that, the 7 largest and "Other (k)". If nothing matches, the breakdown says "No assets match the current filters." with a Clear filters button. Its CSV starts with a mark that makes Excel read it as UTF-8. [VIEW-302, VIEW-303, VIEW-304]
22. Assets grid columns by default: #, Asset, Code, Exposure, Drawn, Drawn %, All investors, Sector, Country, Ccy, Rate, Rating, IG/Sub-IG, Margin, Maturity, Rem. years, Watchlist; others are in the chooser; on the Group view it adds "Other investors" (all investors − Group) and its drawn column. [VIEW-305, VIEW-309]
23. **Scope's choice:** the # column is the rank by exposure among the assets the filters in force leave: once any filter applies (including one made by clicking on this page) the rank restarts at 1 among the filtered assets. [VIEW-306]
24. Flagged assets show their name in amber with the flags in a tooltip; Drawn % = drawn ÷ exposure, footer = sum of drawn ÷ sum of exposure; rate and term footers are exposure-weighted over visible rows (rows without a value skipped); rating score footer over rated rows only. [VIEW-307, VIEW-308, VIEW-271, VIEW-312]
25. Rating and IG show NR for unrated assets; grades green when IG, amber when sub-IG; Rating sorts by scale score, NR last; watchlist values other than blank or "No" are amber. [VIEW-310, VIEW-311, VIEW-313]
26. One nominal and one drawn column per investor column, blank when zero; investor nominal columns appear for investors holding any of the assets on show unless hidden or shown by the user this session. [VIEW-314, VIEW-316]
27. Default sort: exposure, largest first, unless a saved layout exists. [VIEW-315]
28. Grid CSV: visible rows and columns, numbers rounded to the column's decimals (amounts to 0.1m).
29. **Scope's choice:** Output CSV and Positions CSV follow the filters. Page filters are passed on to every page (step 5) and both downloads follow those filters (6.13), so both files contain only the filtered assets and positions. [VIEW-281]
30. Export file names: "scope_<what>_<view>_<ccy>_<reporting date>_<data label>.csv". [VIEW-270]

### 7.6 The Explorer and pivot

1. The Explorer opens on exposure by sector, positions records, filtered to Excluded = No, sorted by label, with subtotals, grand total and a bar chart; the Excluded = No filter makes totals tie to the AUM page. [VIEW-127, VIEW-128]
2. Presets: Sector × investor group; Rating × maturity bucket; Country × currency; Investor × subsector; Watchlist × sponsor (top 10); Fixed / floating × repayment; Top 10 assets (asset records); Drawn vs undrawn by sector; Green and ESG by sector; Group vs third party by country; IG / Sub-IG by investor; Maturity ladder by year. A preset keeps Excluded = No unless it sets its own filters. [VIEW-129, VIEW-130, VIEW-131, VIEW-132, VIEW-133, VIEW-134, VIEW-135, VIEW-136, VIEW-137, VIEW-138, VIEW-139, VIEW-140, VIEW-159]
3. Blank means empty, missing or no value; zero is a value; blank rows/columns are "(blank)". [VIEW-083, VIEW-084]
4. Filters: value lists compare as text with blanks as "(blank)"; contains / does not contain / starts with ignore capitals; between includes both ends and an open end is unbounded; on number items a blank never satisfies a range; text and dates compare alphabetically; on a number item "equals" a non-number means "is blank" and "not equals" "is not blank"; an unknown operator lets everything through; filters on unknown items are skipped and listed; AND across items, OR within a list. [VIEW-085, VIEW-086, VIEW-087, VIEW-088, VIEW-089, VIEW-090, VIEW-091, VIEW-092, VIEW-093]
5. **Silent:** an unknown operator in an old saved view filters nothing, with no message.
6. A typed number filter understands "blank"/"empty", "nonblank"/"notblank"/"*", "a..b", ">=, <=, >, <, =, <>, !=" followed by a number (optional %), or a bare number; anything else is no filter. The value picker lists values by record count, then natural label order, "(blank)" last among equal counts. [VIEW-094, VIEW-095]
7. Aggregation: per-asset measures count the first record per asset in each cell; sum ignores non-numbers; weighted average = sum(value × weight) ÷ sum(weight), leaving out records with no value or zero/missing weight; average, min, max over numbers only; count = non-blank values; distinct count skips blanks; with nothing to aggregate, sum and counts give 0, others blank. [VIEW-096, VIEW-097, VIEW-098, VIEW-099, VIEW-100, VIEW-101, VIEW-102]
8. Value names: "Wavg …", "Avg …", "Count of …", "Distinct …", "Min …", "Max …", sums with no prefix, plus " (% of total / row / column)"; weighted averages use exposure unless a weight is named; a dimension used as a value can only be counted, distinct-counted, min or max (else count); an unknown aggregation becomes count (dimensions) or sum (measures). [VIEW-103, VIEW-104, VIEW-105]
9. Percentages show as %, counts as whole numbers. Labels sort naturally ignoring capitals; "(blank)" last both ways; ordinal scales first, unranked labels after; value sort puts no-value rows last both ways, defaults to descending, ties by label. [VIEW-106, VIEW-107, VIEW-108, VIEW-109, VIEW-110, VIEW-118]
10. Unknown row/column items and values are skipped and listed; subtotals and grand total are on unless turned off; default sort by label ascending. [VIEW-111, VIEW-112, VIEW-113]
11. Every subtotal and total is aggregated directly from the records, not from child rows. Column subtotals read "<label> total"; row subtotals "<label> total"; the grand total "Grand total"; rows come depth-first. [VIEW-114, VIEW-115, VIEW-121, VIEW-122]
12. Top-N keeps the n largest rows at the deepest level (by the chosen value's row total, or record count) and folds the rest into "Other (k)", placed last, so parent totals still reconcile. A Top N from a saved view or link is capped at 500; a non-number becomes 10. [VIEW-116, VIEW-117, VIEW-141]
13. A percentage with a zero or missing base is blank; % of total uses the grand total, % of row the row total, % of column the column total (the grand total for the row-total column). [VIEW-119, VIEW-120]
14. Pivot CSV: a "kind" column, one column per row item, one per value × column plus a Total per value; numbers raw (millions, fractions); repeated headers get " (2)", " (3)"; the grand total reads "Grand total" in the first item column, a subtotal "<label> total" in its own level's column; non-numbers export empty. [VIEW-123, VIEW-124, VIEW-125, VIEW-126]
15. A link from the AUM page opens that kind's grid with its filters (adding Excluded = No on positions) and switches to the link's view and currency. [VIEW-142]
16. Saved Explorer views live in this browser; saving is refused above 200 KB in total. [VIEW-143]
17. Drilling into a grid: one date becomes a one-day range, several dates their earliest-to-latest span, "(blank)" becomes empty; drilling into "Other (k)" filters to the folded labels; drilling into the grand total keeps only the pivot filters. [VIEW-144, VIEW-152]
18. Date shortcuts relative to the reporting date: Next 12 months, This year, 2027–2029, Before reporting date. [VIEW-145]
19. Tie-out badge: with only the default filter (positions) or none (assets), Scope compares the sum of exposure with the calculation's total: "ties" within 0.5 currency units, otherwise the difference. [VIEW-146]
20. Notices: on a view with any weight below 1, investor rows show nominal at 100% while the view applies weights; investor items on asset records need positions; more than 4 row levels; more than 20,000 cells (warning); more than 3,000 visible rows shows only the first 3,000 (exports contain all). [VIEW-147, VIEW-148, VIEW-149, VIEW-150]
21. Stacked chart: the 8 largest column series, the rest "Other (k)", negatives drawn as 0, at most 30 bars. [VIEW-151]
22. Records CSV: the filtered records with every item, amounts ÷ unit, repeated headers numbered. [VIEW-153]
23. Switching kind drops items the new kind does not have (with a warning) and a column item that repeats a row item. [VIEW-154]
24. Default grid columns: positions show asset, investor, tranche, sector, country, currency, rating, IG, rate, maturity, amounts, margin, WAL, Excluded; assets show rank, asset, attributes, rating, maturity, exposure, drawn %, nominal, attributed, margin, WAL, watchlist, positions, investors, plus the first four investors' columns. The positions grid opens filtered to Excluded = No unless a saved layout or drill filter exists. [VIEW-155, VIEW-158]
25. Grid footers sum plain amounts; per-asset and averaged measures use the pivot rules; Excluded = Yes and watch values are amber, IG green, NR grey, sub-IG amber. [VIEW-156, VIEW-157]

### 7.7 Custom sheets

1. Presets: "Output sheet (standard)" (22 columns), "Credit view" (14), "Positions (one per Holdings row)" (14). [VIEW-470, VIEW-471, VIEW-472]
2. A custom sheet is asset records unless "positions" is chosen; its columns are items (named or raw sheet columns) in the chosen order; rows follow the view, currency and global filters; excluded positions are left out unless asked. [VIEW-473, VIEW-474, VIEW-475, VIEW-476]
3. Header: the user's own heading, or the item name plus the unit in brackets for amounts ("Exposure (EUR m)"); duplicate headings are kept. [VIEW-477, VIEW-478]
4. On screen values use the item's format; in exports, amounts are ÷ unit rounded to 6 decimals, blanks empty, dates year-month-day. [VIEW-479, VIEW-480]
5. Unknown columns are dropped and listed. The .xlsx tab takes the sheet name with \ / ? * [ ] : replaced by spaces, cut to 31 characters, "Custom sheet" when unnamed. [VIEW-481, VIEW-482]

### 7.8 The Concentration page

1. Every figure uses the Output rows of the selected view, exposure in display-currency millions; a missing exposure counts 0. [VIEW-374]
2. HHI = sum of squared shares (0 to 1), ignoring non-numbers and zero or negative amounts; blank when nothing remains. Shown × 10,000. Effective number of names = 1 ÷ HHI. Example: 60/40 gives 0.52, shown 5,200. [VIEW-375, VIEW-376, VIEW-406]
3. Grouping labels blanks "(blank)", skips non-numeric amounts, sorts largest first then by label. [VIEW-377]
4. **Scope's choice:** the sector and country HHIs count "(blank)" as one sector/country; the sponsor HHI leaves blanks out.
5. Currency and fixed/floating shares use the position split (6.4): a multi-currency asset counts in each part, each label counts distinct assets; zero or non-numeric parts are ignored and an asset with no usable split counts whole under its own value. [VIEW-378, VIEW-379, VIEW-380, VIEW-401]
6. Pareto: rank, share and cumulative share of the total. [VIEW-381]
7. Maturity: windows of 12, 24 and 36 months from the reporting date (month ends clamped: 31 Jan + 1 month = 28 Feb), counting every dated row maturing on or before the window end, including past due; no reporting date gives no window values. Ladder years run continuously from the reporting year (or earliest maturity) to the last maturity, empty years as 0, at most 80 years back from the last maturity (earlier years fold into "<year> or earlier"); undated exposure is kept apart with a hint. [VIEW-382, VIEW-383, VIEW-384, VIEW-385, VIEW-386, VIEW-387, VIEW-388]
8. Thresholds (illustrative, never mandate limits), in percent ÷ 100: largest single asset 10%, sponsor 20%, sector 35%, country 30%, sub-IG 25%, non-base currency 40%. A non-number means "not set". [VIEW-390, VIEW-391]
9. Measures: largest single asset = biggest exposure ÷ total; largest sponsor/sector/country ignore blank labels (0 when no labelled group); sub-IG = rated SUB IG exposure ÷ all exposure (NR in the denominator); non-base currency = exposure in currencies other than the base (if not set, EUR; blank excluded), position by position. [VIEW-392, VIEW-393, VIEW-394, VIEW-395, VIEW-389]
10. **Scope's choice:** the thresholds cannot be changed from the Scope Settings sheet or Data › Formulas; they are fixed in Scope's own settings.
11. Headroom = threshold − measured (shown as ± percentage points), utilisation = measured ÷ threshold; "above" only when the measure exceeds the threshold, "na" when either is missing. Amber KPIs when above. [VIEW-396, VIEW-412, VIEW-409]
12. Top-5 and top-10 shares; sponsor count excludes blanks; drawn and undrawn shares = sums ÷ total exposure; NR share shown separately. [VIEW-397, VIEW-398, VIEW-399, VIEW-400]
13. Chart clicks add an "is one of" global filter (blanks written "(blank)"); a threshold row click filters on its worst contributor; a bucket click filters on its asset list; a ladder bar filters on assets maturing that year (first position's date; the carry bar includes every earlier year). [VIEW-403, VIEW-411, VIEW-413, VIEW-415]
14. Treemap by Sector (default), Country, Sponsor or Rating (NR when unrated); heatmap dimensions rating, IG, bucket, maturity year, sector, subsector, country, region, currency, fixed/floating, sponsor, investor group, investor, watchlist; measures Exposure, Drawn, Undrawn, Group attributed, Other investors; the heatmap uses included positions of the assets on the page, default Rating × Maturity bucket by Exposure. Layout choices are remembered in this browser. [VIEW-404, VIEW-405, VIEW-416, VIEW-417, VIEW-402]
15. Notices: "Figures reflect n filters (<filtered> of <total> ccy m, share)"; "No exposure" when nothing is left. "Maturing within n months" shows amount, share and asset count. [VIEW-407, VIEW-408, VIEW-410]
16. Single-name chart: top 15 with cumulative share and the threshold line; sponsor chart: top 10 non-blank; top exposures table: NR for unrated, % and cumulative %, 25 per page; watchlist values containing "intensive" or "red" red, others amber. [VIEW-414, VIEW-418, VIEW-419, VIEW-420]

### 7.9 The ESG page

1. Uses the Output rows of the selected view (with global filters) and each asset's ESG Hardcoded row; a notice says the methodology still needs agreeing. [VIEW-423, VIEW-424]
2. E, S and G scores are exposure-weighted over assets with a score; the weighted ESG score is the engine's, coverage = exposure with a score ÷ total. Score bands 80–100, 70–79, 60–69, 50–59, Below 50, No score (empty bands hidden). [VIEW-421, VIEW-426, VIEW-422]
3. GHG scope 1+2 and scope 3 are plain sums of asset values. [VIEW-425]
4. **Scope's choice:** each asset's full emissions are counted, however small the view's share of the asset.
5. Exposure by CHI sector labels an asset with no CHI sector "(no ESG row)"; GHG by sector uses CHI sector, else asset sector, else "(blank)"; largest emitters lists the 10 highest scope 1+2 above 0; intensity column as 4.9.2. [VIEW-427, VIEW-428, VIEW-429, VIEW-430]
6. **Silent:** an asset that has an ESG row but a blank CHI sector is also shown as "(no ESG row)".

### 7.10 The asset page

1. Opening the asset page without a code goes to the AUM overview. A code not in Mapping › Security Mapping shows "Asset not found" ("No asset with code …"). [VIEW-319, VIEW-320]
2. If the asset has no exposure on the selected view, a notice says so and the figures show all investors. [VIEW-322]
3. Exposure KPI: the asset's amount in the selected view, with its drawn and drawn % (drawn ÷ nominal). Example: Region A 20m, drawn 15m gives 75%. [VIEW-323]
4. All investors KPI: the asset's total nominal across every investor column, with its position count. Example: 100m · 4 positions. [VIEW-324]
5. On the Group view, "<Group> share of this asset" = group nominal ÷ asset nominal, with the other investors' amount. Example: 45m of 100m is 45.0%. [VIEW-325]
6. Commitment KPI: commitment, with undrawn = nominal − drawn. [VIEW-326]
7. Rating KPI: the current grade, "not rated" when unrated, amber when rated sub-IG. Maturity KPI: maturity date, remaining years and bucket, or "unknown". [VIEW-327, VIEW-328]
8. A write-up linked to the asset (by hand or by name) is shown as on its monitoring slide. [VIEW-329]
9. The rate type and spread sources shown come from the asset's first position. Initial tenor = YEARFRAC(funding, maturity) on 30/360, blank when a date is missing (the workbook's IFERROR shows 0). Protected life = (protection end − funding) ÷ (maturity − funding). [VIEW-330, VIEW-331, VIEW-332]
10. The current grade line shows grade, IG label (or NR), score and the IG threshold, e.g. "BBB, IG (numeric 520, threshold 610)". [VIEW-333]
11. The raw amounts table shows the Holdings columns whose header mentions amount, notional, nominal, commitment, drawn, undrawn, funded, currency, forex, fx or rate rc, but not date, status, type name, limit, covenant or trend; the columns Scope reads are marked with a dot. Example: "Commitment QC" shown, "Commitment Date" hidden. [VIEW-334]
12. The positions table lists one row per investor and holding, sorted by nominal in the display currency, largest first. Excluded positions mapped to this asset are listed with their Holdings line, investor and reason. [VIEW-335, VIEW-336]
13. The investor split chart shows each investor column's nominal in the asset, largest first. [VIEW-337]
14. Every view is listed with this asset's nominal and drawn and its definition ("all investors × 1" for the total). [VIEW-338]
15. The trace states: conversion = amount ÷ rate (currency per EUR) × rate (display currency per EUR); view amount = sum of weight × investor column; group attributed = sum of Group ownership × investor column, other = total − attributed; rating = internal, external = worst of Fitch / Moody's / S&P, score = MAX(internal, external) compared with the IG threshold. Example: MAX(500, 560) = 560, at or below 610, so IG. [VIEW-339, VIEW-340, VIEW-341, VIEW-342]
16. Every Hardcoded and ESG Hardcoded column of the asset is listed with its cell. [VIEW-343]
17. A manual correction cannot be saved without a reason; the original imported value, the reason, the user and the time are kept. The "original" offered and stored is always the imported value, even when the item was already corrected. The user name typed is remembered; blank means "local user". [VIEW-317, VIEW-321, VIEW-318]

### 7.11 The investor page

1. The page starts on the Total basis (direct + look-through) and keeps the chosen basis while moving between investors. When no fund unit holders are listed, only Direct is offered and the other bases are disabled. [VIEW-344, VIEW-348]
2. Opening the page without a name goes to the investor book; a name not found shows "No investor … in Mapping › Funding Name" and lists the known investors. [VIEW-346, VIEW-347]
3. The page lists look-through warnings and errors (info messages are left to the Data page), at most 5, then "n more". When global filters apply, a notice says every figure covers only the filtered positions, including the funds behind look-through. [VIEW-345, VIEW-351]
4. KPIs: direct nominal (with assets and positions); look-through nominal (with "via <fund> (<share>)", or "holds no fund units"); total economic exposure with its share of book. Example: direct 12m, look-through 8m via Fund 1 (25%), total 20m (3.3% of book). [VIEW-353]
5. Share of book = total economic exposure ÷ the whole book of all investors before look-through. Example: 20m ÷ 600m = 3.3%. [VIEW-354]
6. Drawn, undrawn (nominal less drawn) and the asset count follow the chosen basis. [VIEW-355]
7. The weighted rating KPI turns amber when the weighted score is above the IG threshold, and shows "NR" when there is no label. Example: 650 above 610 gives amber. [VIEW-352]
8. "Share of <view>" = weight in the view × direct column ÷ view total; "not in this platform's composition" when the weight is 0. Example: 0.45 × 40m ÷ 300m = 6.0%. [VIEW-356]
9. The header and profile show the investor's Group ownership, 0 when missing. [VIEW-350]
10. "Filter platform to this investor" adds the global filter Investor = this name; it is offered only for investor columns, and look-through exposure then drops out of every page. [VIEW-349]
11. The exposure source chart shows Direct (except on the Look-through basis) and "Via <fund>" amounts (except on the Direct basis); a single source is drawn as a bar instead of a ring. [VIEW-357]
12. For a fund with a register, the page lists its unit holders (share × the fund's exposure on the basis, plus External fund holders) and compares the group share from holders with the fund's Group ownership: "Consistent" or "Mismatch". Example: 35% vs 45% is Consistent. [VIEW-358]
13. The fund's ownership split donut shows Group (listed) = group share from holders, Other holders (listed) = listed − group share, and External fund holders. Example: 35% / 0% / 65%. [VIEW-361]
14. The holdings list covers all assets, whatever the selected view, sorted by exposure. Breakdown charts: sector, country (top 10), rating and maturity bucket on the chosen basis. [VIEW-359, VIEW-360]

### 7.12 The investor book

1. The investor book starts on nominal and on the assets of the selected view; it can switch to drawn or commitment, and to "All active assets", which uses every asset flagged as in the Active Assets list, whatever the view. [VIEW-362, VIEW-365]
2. A matrix cell is the investor column's amount (nominal, drawn or commitment) in the asset, in millions; zero is shown blank. Investor columns are headed by the segment key, or the name when there is none. After them come Total, Group attributed and Other investors = total − group. Example: total 100, group 45 gives other 55. [VIEW-366, VIEW-373, VIEW-372]
3. The investor-columns KPI counts types named exactly "Group entity", "Partly owned", "Fund" and "Third party". [VIEW-367]
4. The book shows the matrix total (sum of asset totals) and Group attributed (sum of group nominal, drawn or commitment). [VIEW-368]
5. Per investor type, columns are summed at 100% with no look-through; "Top assets by investor group" shows the 12 largest assets stacked by type, funds at 100%. [VIEW-369, VIEW-370]
6. In the fund share matrix holders are ordered Group entity, Partly owned, Fund, Third party (other types with third party), then by name; a negative external share or listed shares above 100% are highlighted. [VIEW-363, VIEW-364]
7. The look-through-by-investor table adds an "External fund holders" row and a reconciliation line: sum of ultimate holders + external = matrix total ("Reconciles"). [VIEW-371]

### 7.13 The Calculations sheet page

This page shows nothing new: every value comes from the calculation, laid out column for column like the workbook's Calculations sheet (one row per Holdings row), with a second tab for the per-asset split.

1. In number columns, a number typed as text (from a CSV or a paste) is shown as a number. Example: "1250000" shows 1,250,000. [VIEW-431]
2. Labels are compared in lower case with everything except letters and digits removed ("IG / Sub IG" = "ig sub-ig"). [VIEW-432]
3. A Calculations label finds its Holdings column by the Holdings row-2 output name first, then the row-3 header, then any other name Scope accepts for that column. Example: "External Rating Fitch" finds a column headed "Rating Fitch". [VIEW-433]
4. Columns A–I: Portfolio ID, Holdings ID, backend identifier (A & "x" & B), Identifier ID (Mapping T to S; "#N/A" when the holding is unmapped), Unique identifier, Group ID, Mandate, Mandate / Security ID. [VIEW-437]
5. Column K is the investor key (Mapping AA to Y, blank on error). Example: portfolio 7001 shows INV01. [VIEW-439]
6. Columns J–CG are 76 Holdings lookups by label, in the printed order (e.g. J Project code, M Amount nominal (QC)). A lookup is a number column when its label mentions amount, spread, calculation, yield, duration, wal, dscr, icr, ltv or leverage, unless it is a trend, test, status or ends in "covenant" ("DSCR - 1 year" number, "DSCR trend" text). [VIEW-436, VIEW-438]
7. A Hardcoded or ESG Hardcoded value is found by its row-2 label first, then by its header. [VIEW-435]
8. Classification columns that the workbook names after a client (Part of Global Strategy, Jurisdiction Tier, Compartment, Classification, Sector classification and its investor twin, Country Tier) take the label of the matching Hardcoded column; if there is none, a generic label with the attribution name, e.g. "Jurisdiction Tier - Group". [VIEW-434]
9. Those columns take the nth Hardcoded column named like the label (exact match first, then partial); the "(investor)" twin takes the second; Classification never takes a sector column. Example: the second "… Sector Classification" column feeds IB. [VIEW-453]
10. Column U shows the Holdings internal rating, or Scope's internal grade when the Holdings cell is blank. Column V is the internal rating score (Mapping AC:AD; 0 when not found). Example: BBB shows 9. [VIEW-442, VIEW-440]
11. Column AP shows "Fixed" when the Holdings Fixed / Floating value is "Fixed", otherwise "Floating", as the workbook does; everywhere else Scope uses its own reading of Rate Type (the values seen are listed, 6.6). Example: "FIX" is shown with Scope reading Fixed. [VIEW-441]
12. Columns GQ–HB: Fitch, Moody's and S&P scores by lookup; external = the highest (weakest) of the three, labelled with the grade of the first agency having that score (Fitch, then Moody's, then S&P), "NR" when 0; current grade = internal unless NR; current score = MAX(internal, external). Example: Fitch 9, Moody's 10, S&P 0 gives Moody's grade. [VIEW-448]
13. INVGRD is "SUB IG" above the IG threshold, else "IG"; the workbook shows "IG" for an unrated position (score 0), Scope shows "NR". [VIEW-449]
14. Holdings lookup columns whose label mentions "amount" get a total at the bottom; FX rate columns CK, CL, CN and CX do not. [VIEW-443, VIEW-444]
15. Column CL is the rate of the reference investor's first row in that currency, or the FX exception where one is set. Column CN is the display currency's rate per EUR from the FX table, 1 when not found. Columns CP, CR and CT convert nominal, drawn and commitment as amount ÷ CL × CN, 0 on error. Example: USD 100 ÷ 1.10 × 1 = 90.9. [VIEW-445, VIEW-446, VIEW-447]
16. Columns HE–ID are 26 Hardcoded lookups; Chronological order, Upfront and Total debt offering are numbers. HW (% of time protected) = (HV − HR) ÷ (AM − HR) when HV is above 0, else blank. ID (maturity at inception) = YEARFRAC(funding, maturity), 0 when a date is missing, as the workbook's IFERROR. [VIEW-450, VIEW-451, VIEW-452]
17. Columns II–IU are 13 ESG Hardcoded lookups (Shareholders read from Hardcoded; scores and GHG are numbers). Columns IY–JG: Group code, territory, EUR exposure (= CP), EUR funded (= CR), Country, Sector, Subsector, Description. [VIEW-454, VIEW-455]
18. A last column, not in the workbook, gives the reason a row is excluded, e.g. "unmapped security". [VIEW-456]
19. Assets split tab (DB to GK): only assets in Mapping › Active Assets, numbered 1 to n in list order; each investor column (DM…EN nominal, FD…GE drawn) = SUMIF of converted amounts by investor and asset; the group column (EO, GF) = SUMPRODUCT of every column × its Group ownership. [VIEW-468, VIEW-458, VIEW-459]
20. **Scope's choice:** the asset-level Initial tenor on the asset page and Output (4.10.5) is blank when a date is missing, while column ID shows 0 like the workbook.

### 7.14 What Scope keeps in this browser

1. Settings (the view, the currency, the global filters and changes to calculation settings) and the history of manual corrections are saved in this browser, so a reload shows the same view and filters. [VIEW-239]
2. On a first visit: no view chosen, currency EUR, sidebar shown, no global filters, no changes. [VIEW-240]
3. A loaded workbook, the rows added in the app and the previous Holdings are saved in this browser's own database, so a reload keeps your workbook. The PowerPoint template and the investor-report inputs are kept there too, in this browser only, never sent anywhere. [VIEW-252, VIEW-255]
4. Opening that database gives up after 2.5 seconds (for example when the page is opened as a file) and it is then treated as unavailable. [VIEW-241]
5. If the saved workbook could not be read at start-up (the database exists but reading failed), nothing is saved for the whole session, so one new sheet cannot overwrite the saved set; a message asks you to reload. If saving fails (storage blocked or full), a one-time warning says the sheets stay for this session only. [VIEW-251, VIEW-254, VIEW-253]
6. Loading without "merge" replaces every sheet. Loading any sheet of your own clears every demo sheet (including the demo's settings), so a missing sheet shows as missing. Loading the demo or a new full workbook clears rows added in the app and the previous Holdings. [VIEW-242, VIEW-243, VIEW-244]
7. Only Holdings, Mapping, Hardcoded, ESG Hardcoded, Ownership and Scope Settings are kept, plus the workbook's Output and Calculations tabs for Data › Check my data. **Silent:** any other sheet in the file (e.g. "Notes") is ignored without a message. [VIEW-245]
8. When a new Holdings is merged over your own loaded Holdings (not the demo), the old one is kept as the previous Holdings for one step of undo; undo puts it back and discards the newer one, so there is only one step. [VIEW-246, VIEW-250]
9. A sheet loaded without a stated source is recorded as "demo" or "paste". The data is labelled "SYNTHETIC DEMO" for the demo (unless another label is given) and "Workbook data" otherwise. Loading the demo saves nothing. [VIEW-247, VIEW-248, VIEW-249]
10. A row added in the app is written on the first row below its Mapping table (Security Mapping, Funding Name, Active Assets); the original sheet is never changed. If the table cannot be found, the row is not applied and is flagged "table not found". Only its non-blank values are written. For a Security Mapping row, the column to the left of the table (P) repeats the holding ID when that column has no header, as in the workbook. [VIEW-483, VIEW-484, VIEW-485, VIEW-486]
11. Setting a calculation change to blank removes it. [VIEW-256]
12. Corrections and added rows are stamped with the user name, or "local user". A new correction on the same table, key and item supersedes the earlier one, which stays in the history; reverting a correction keeps it in the history and re-activates the one it replaced; only corrections neither superseded nor reverted apply. [VIEW-257, VIEW-258, VIEW-259, VIEW-260]
13. At start-up, missing global filters become none, missing changes become none, an old separate fund-holder register is deleted, and old house colours 073831 and 0B544A are removed from a stored report style (an emptied style is cleared). [VIEW-261, VIEW-262]

### 7.15 Data page actions that change the figures

1. When changes are saved, empty groups of changes are removed. [VIEW-487]
2. Loading only a settings sheet while the demo is loaded asks first, because it removes the demo sheets. [VIEW-488]
3. A settings file loads only its Ownership sheet (or the older Scope Settings sheet); other sheets in the file are ignored with a note. Changes made in the app (Ownership grid, parameters, FX quote, names) still win over the sheet, which wins over the built-in defaults. [VIEW-489, VIEW-490]
4. "Clear changes" removes names, investors, views, settings, the FX quote and the grid edited in the app, but keeps column choices. [VIEW-491]
5. Monthly update: drop just the new Holdings; Mapping, Hardcoded, ESG Hardcoded, added rows and settings stay, and the previous Holdings is kept for one undo. Restoring the previous Holdings asks for confirmation and drops the current one. [VIEW-492, VIEW-493]
6. Adding a security: the identification ID defaults to the Security ID; choosing an existing asset copies its ID, code name, name and transaction group. The security is also listed in Active Assets (so it reaches the Output) unless unticked. A code name and an identification ID are required ("Code name and identification ID are needed"). [VIEW-496, VIEW-497, VIEW-498]
7. The suggested code name is the first word of the security name in capitals, cut or padded with X to 4 letters, plus the first unused 2-digit number. Example: "Solar Park" gives SOLA01. [VIEW-499]
8. Adding an investor code appends a Funding Name row: investor column (existing or new; a new one must be named), fund name (if blank, the column name), Holdings ID = the code. A new column name is suggested from the portfolio name without a trailing "portfolio", "mandate", "fund" or "unit(s)". Example: "Investor 99 Mandate" suggests "Investor 99". [VIEW-500, VIEW-501]
9. Listing an inactive asset in Active Assets adds one row per security name (or the code name when there is none). Each added row can be undone on its own, and Scope recalculates. [VIEW-502, VIEW-503]
10. The working workbook download holds the four sheets with the added rows, the Ownership sheet in force, and the older Scope Settings sheet when one was loaded. [VIEW-504]
11. The Ownership grid shown is the one changed in the app, else one built from the ownership and views in force. Saving a grid edited in the app drops ownership and views changed the older way. [VIEW-505, VIEW-506]
12. A dropped file with none of Holdings, Mapping, Hardcoded, ESG Hardcoded or Ownership loads nothing and warns "No input sheet found". Every load on the Data page merges: sheets not supplied are kept. A pasted sheet starts at the cell given (A1 unless told), so cell references match the workbook. [VIEW-507, VIEW-508, VIEW-509]
13. Choosing another column for a role saves a column choice; choosing the automatic column (by header or letter) removes it. "Reset" for a sheet removes all its column choices at once. [VIEW-510, VIEW-511]
14. A view changed in the app can be reset to the sheet's definition. Choosing the FX quote equal to the calculation's default removes that change. "Clear all overrides" removes every change, including column choices, after confirmation. [VIEW-512, VIEW-513, VIEW-514]
15. A parameter typed on Data › Formulas overrides the sheet and the defaults; blank restores them; an invalid value is refused (e.g. IG threshold "abc"). [VIEW-515]

### 7.16 Check my data: Scope against your workbook

This tab (Data › Check my data) changes no figure. It runs on the workbook you have loaded and reports, check by check, whether Scope agrees with it. A report can be downloaded as CSV.

1. Part 1 runs when the workbook was loaded with its Output and/or Calculations tabs. Scope runs its calculation on the view in Output!G8 and the currency in Output!G6, the ones the workbook was saved on; if G8 is not a view Scope knows, the first cell in rows 1 to 12 naming one is used, else Scope's selected view, with a note. Example: G8 = Group, G6 = EUR: the Group view in EUR is compared, whatever the top bar shows. [CHK-001]
2. **Scope's choice:** manual corrections and global filters are left out of the comparison, because the workbook has neither; a note gives the number of corrections left out. [CHK-002]
3. Output sheet: the header row is the row (of the first 40) with the most of Scope's Output column names; asset rows are matched through whichever column holds Scope's code names, names or identification IDs (at least half the filled cells must match). Assets on one side only are listed. Then every column both produce is compared, asset by asset. Example: an asset only the workbook lists shows as "not on Scope's Output". [CHK-003]
4. Calculations sheet: positions are matched by the backend identifier in column C from row 5 down ("0x0" rows skipped) and compared column by column at the workbook's letters; the per-asset split is matched by the code name in column DB. A column is compared only when its header (rows 1 to 4) carries the label Scope expects at that letter (or Scope's label is a formula); otherwise it is listed as not compared, since it may have moved. [CHK-006]
5. **Scope's choice:** amounts must agree to one currency unit; other numbers to 0.0001%; text ignoring capitals and spaces; blank, 0 and Excel errors are the same empty value (Excel shows an empty looked-up cell as 0). Example: an exposure of 160.466 against 159.966 fails with a difference of −0.5. [CHK-004]
6. **Scope's choice:** a difference in an amount, in the list of assets or positions, or in a Calculations key column (IDs, currency, FX rate, converted amounts, ratings) is a failure; in a descriptive column it is shown as "differs (check)". Fixed / Floating, Currency, INVGRD and Maturity at inception carry the reason Scope differs by design. [CHK-005]
7. Part 2 runs on any workbook: every position is counted or excluded with a reason; counted positions add up to each asset; the investor columns add up to each asset; group attributed equals each column times its Group ownership; each view's amount equals its weights times the investor columns; the Output rows equal each asset's amount in the view and add up to the headline figures; look-through reconciles; and the workbook's own formula columns of Data › Checks agree. Each sum must agree to one currency unit. [CHK-007]
8. When Output or Calculations come from another file than Holdings, or were loaded before the current Holdings (a monthly update), a note warns that they may be from another month.

### 7.17 Ask Scope: questions in your own words

What goes in: a question typed on the Ask Scope page (Layer 1) or in the top search box, and the result for the view, currency and filters in force. What comes out: a figure, a split, a list of assets or a pointer, with how the question was read.

1. **Scope's choice:** questions are read and answered in this browser. There is no model and no server, and nothing is sent anywhere. Scope understands the names in the loaded data and a fixed list of words for figures, groupings and help, so a question outside them gets "I did not understand", with suggestions. [ASK-001]
2. Every figure uses the Explorer's records (included positions only) and totals, for the view, currency and page filters in force, which the answer names. So "exposure by sector" shows the AUM page's sector amounts. Averages (margin, coupon, WAL, tenor, remaining years, fees, ESG score) are weighted by exposure. An average rating is the nearest S&P / Fitch grade to the weighted rating number of rated positions. [ASK-002, ASK-010]
3. Names come from the data: every sector, subsector, country, region, sponsor, currency, rating, investor, deal lead and asset name, code name and code, longest first, singular or plural. A name's first word (or, except for assets, its last word) stands for it when no other value uses that word, so "solar" reads as Solar PV. A one-letter grade (A) counts only as a capital, so the word "a" is never a rating. Everyday words are rewritten first: high yield and sub-investment grade → SUB IG, UK → United Kingdom, German → Germany, pounds → GBP, floating rate → Floating. [ASK-003, ASK-004, ASK-006]
4. Not, excluding, except, outside, without and other than leave a value out. Two values of one field are compared side by side. Example: "Germany vs France". A view's name (Region A) is not a filter: the answer stays for the view in force and offers to switch. [ASK-005, ASK-011, ASK-015]
5. **Scope's choice:** a year is a maturity year unless the question says deal, signed or vintage (deal year) or funded (funding year).
   - before = earlier than, by = up to and including;
   - after = later than, since and from = from it on;
   - between X and Y includes both;
   - "the next N years" = positions with 0 to N years left. [ASK-007]
6. **Scope's choice:** a threshold ("over 100m", "margin above 250 bps", "WAL under 10 years") is tested per asset, on that asset's positions in the question. An asset that passes keeps all its positions.
   - a bare amount is millions of the display currency (m, bn and k are understood);
   - a margin in % is multiplied by 100;
   - years are WAL, or remaining years when the question speaks of maturity. [ASK-008]
7. Top, largest and most rank from the largest; smallest, lowest and least from the smallest. The number given is used, or 10 for things in the plural and 1 for one thing (up to 100); for one, the next four are shown too. [ASK-009]
8. The kind of answer:
   - a figure;
   - a split ("by …", "per …", "top 5 countries"; "who holds …" by investor, "where are we most exposed" by country);
   - a list of assets ("which assets", "list", a question starting with assets);
   - one asset's card;
   - where to do something in Scope ("how do I …", from a fixed list of topics);
   - what a term means ("what is WAL");
   - the data issues;
   - the shared folder's latest version. [ASK-011, ASK-016]
9. **Scope's choice:** a follow-up keeps the last question and changes only what it names. A follow-up is a question that starts with and, what about, only, also or instead, or one of five words or fewer with no figure of its own. Example: "Exposure in Germany", then "what about France", then "by sector" gives France by sector.
   - a name replaces that field's values ("also" adds to them);
   - a grouping, figure or top N replaces the last one;
   - New topic, or a question from the top search, starts afresh. [ASK-012]
10. Under each answer, How I read it lists what was understood; × on a part asks again without it. Open in Explorer opens the same figure in the Explorer, and Filter every page to this adds the same filters to every page; a threshold travels as the list of assets it kept. Asset names open the asset page, and a group's name lists its assets. [ASK-013, ASK-014]
11. The example questions are made from the loaded data, so each has an answer. The questions and answers last while Scope is open, up to 40, and are never saved or shared. [ASK-019, ASK-017]

## 8. Asset write-ups

What goes in: your write-ups workbook (.xlsx or .xlsm), one box per asset laid out like the monitoring slide (name, ratios under Actual / Lock-up / Covenant, a Rating row, then the description and recent events to the right), plus any links you set by hand on the Asset write-ups page. What comes out: a list of write-ups, each with a ref, name, ratio rows, one rating, a description and a list of recent events, each linked to one asset, a whole asset group, or nothing. The investor deck of a view carries the write-ups of the assets that view holds (9.15 to 9.17), and each asset's page shows its own write-up.

### 8.1 Loading the workbook

1. The file picker on the Asset write-ups page offers only .xlsx and .xlsm files; .xls, .xlsb and .csv are not offered. [WU-002]
2. The workbook is read with Excel's number formats applied: every number cell arrives as the text Excel shows, not the number underneath. A cell holding 6.62 formatted `0.00"x"` arrives as "6.62x"; 0.7 formatted as a percentage arrives as "70%". [WU-001]
3. Every cell is turned into text with carriage returns removed and spaces trimmed from both ends; an empty cell is empty text. [WU-006]
4. Every sheet is read, in tab order. A sheet counts as a source only if at least one write-up was read from it. If the tabs are Boxes, Other, Third and Notes and only the first three hold boxes, the sources are Boxes, Other and Third. [WU-003]
5. If the whole workbook gives no write-up, Scope shows a warning naming the file ("No write-ups found in notes.xlsx: each box needs a name and Actual / Lock-up / Covenant or a Description column") and keeps the write-ups it already had. [WU-028]
6. Otherwise Scope replaces the kept write-ups with the new ones, saved in this browser with the file name, the sheets read and the time, and marked as read by the current version. Links you set by hand are kept and re-apply to any box with the same name (name compared as in 8.10). If Asset A was linked by hand to asset 1003 and the corrected workbook still has "Asset A", it stays linked to 1003. A message says how many write-ups were read from how many sheets. [WU-029]
7. After every load attempt, successful or not, the file picker is reset, so the same corrected file can be chosen again. [WU-031]
8. If reading fails outright, a warning "Could not read <file>: <reason>" is shown and nothing changes.
9. The write-ups and their links stay in this browser only. The Remove button deletes them ("Write-ups removed"); the next investor deck then has one empty Portfolio Monitoring page. [WU-032]
10. Write-ups saved by an earlier version of Scope (which added "x" and two decimals to every number) show a yellow warning on the Asset write-ups page asking you to load the workbook again. [WU-030]

### 8.2 Finding the boxes on a sheet

1. Scope looks for a box marker row: a row with one cell starting with the word "Actual" (or "Actuals") and another starting with "Covenant(s)" or "Lock-up(s)" (also written "Lockup" or "Lock up"). Capitals don't matter; the first cell of each kind on the row is used. A row with only "Actual" and "Comment" is not a marker row. [WU-007]
2. The columns of Actual, Lock-up and Covenant are taken from the marker row, so a box can sit anywhere on the sheet. The value area runs from the leftmost to the rightmost of those three columns; everything left of it is ref, name or ratio name, everything right of it is description and events. Each new marker row or header row resets these columns. If the marker words are in E, F and G, values are read from E to G. [WU-008]
3. If no row of the sheet is a marker row, the sheet is read instead as a table of one row per asset (8.9). [WU-009]
4. A header row is a row with one cell that is exactly Ref, Ref., Name, Asset, Transaction or Project and another cell containing description, event, comment or update (capitals don't matter), for example "Ref. | Name | | Actual | Lock-up | Covenant | Description and recent events". [WU-010]
5. A header row is skipped and closes the current box. Any text waiting between boxes (8.6) is given to the box before it. If the header row also carries the Actual / Covenant words, the value columns are reset from it. Nothing after a repeated header is added to the box above it. [WU-011]
6. A completely empty row is ignored: it neither closes nor opens a box, so a spacer row between two ratio rows does not split the box. [WU-012]

### 8.3 Opening a box: its name and ref

1. Text counts as a ref (not a name or ratio name) when it is "n/m" with one to three digits each side, a bare number of one to three digits, or the word Ref / Ref. So "3/30", "12" and "Ref." are refs; "1234" and "A1" are not. [WU-014]
   **Silent:** a box whose name is a one-to-three-digit number (say "12") is read as a ref with no name, and is then dropped (step 5).
2. On a marker row, the name is the first text left of the value columns that is not a ref, and the ref is the first ref-like text there that does not start with "ref". Row "1/2 | Asset A | | Actual | …" gives ref "1/2", name "Asset A". [WU-013]
3. A marker row with a name to its left (other than the words Name or Asset) starts a new box with that name and ref. [WU-015]
4. A marker row with no name, directly under a box that has no ratios and no rating yet, belongs to that box: the name sat in a merged cell above it. Its right-hand text joins that box. Row 5 "Asset A" (merged over rows 5 and 6) and row 6 "Actual | Lock-up | Covenant | description" make one box "Asset A". [WU-016]
5. Any other marker row with no name starts a box with no name. Boxes with no name are dropped at the end, with all the text they collected. [WU-017]
   **Silent:** no message tells you a box was dropped for having no name.
6. When the previous box is closed (by its Rating row or a header row), or there is no box yet, any row with a label starts a new box named after that label, even without the Actual / Covenant words. After a Rating row, the row "2/2 | Asset B | | | | | A fibre network" starts box "Asset B" with ref "2/2". [WU-019]
7. Inside an open box that already has ratio rows, a row with a label and no values starts a new box, unless the label contains a ratio word: ebitda, icr, dscr, llcr, nlcr, plcr, cover, ratio, leverage, ltv, ltc, gearing, debt, interest, service, lock, covenant, yield, margin, nav, loan, or ends in "x". After box Asset A's ratios, a row "Asset C" with no values starts box Asset C; a row "Loanco" with no values stays in Asset A as an empty ratio row (it contains "loan"). [WU-020]

### 8.4 Ratio rows

1. On each row the ratio name is the nearest text to the left of the first value column that is not a ref, scanning leftwards, so it may sit in the name's column or one column to its right. Row "| | Net debt / EBITDA | 7.56 | 7.75 | 8.25" with values in D to F gives the name "Net debt / EBITDA". [WU-018]
2. The Actual, Lock-up and Covenant values are read from the three marker columns. If the marker row had no Lock-up column, every lock-up value is blank. [WU-036]
3. Inside an open box, a row with a name or at least one value becomes a ratio row. A ratio row with a name but no values is kept with blank values ("DSCR" with nothing filled shows three empty boxes on the slide). [WU-037]
4. Ratio rows keep their workbook order and Scope puts no limit on how many it reads (the slide then draws at most twelve, 9.17 step 7). The rule catalogue's example for this rule mentions eight; the code draws twelve. [WU-038]
5. Cells right of the Covenant column are never read as ratio values; they are description or event text. "ICR | 3.88 | 2.5 | 2 | Utilisation declined." gives ICR values 3.88, 2.5 and 2, and "Utilisation declined." as an event. [WU-039]
6. A ratio value is kept exactly as the cell showed it, trimmed; nothing is added or rounded: "6.62x", "n/a" and "EUR 668" stay as they are. [WU-033]
7. Only if a value arrives as a bare number (which can only happen with a workbook read without formats) is it written out: a whole number with no decimals and no unit ("2", "565"); any other number to at most 10 significant digits with trailing zeros dropped ("7.56"; 1/3 becomes "0.3333333333", where Excel's General format would show 0.333333333). [WU-034, WU-035]

### 8.5 The Rating row

1. A row whose ratio name contains the word "rating" or "ratings" anywhere (capitals don't matter) is the box's Rating row: "Rating", "Internal rating" and "Ratings" all qualify; "Rated debt" does not. [WU-042]
2. The rating is read from the row's Actual, Lock-up and Covenant cells. If all three are blank, the first text anywhere between the first and last value column is used. "BBB- (Internal)" under Covenant gives the rating "BBB- (Internal)". [WU-043]
3. If the Rating row's value cells are all empty, Scope looks at the row directly below: it is used when it is not a marker row, has no ratio name, has at least one value cell filled, and every filled value cell looks like a rating (step 8). That row's right-hand text joins the box and the row is used up. [WU-044]
4. A box keeps the first rating it finds; a later Rating row or rating cell in the same box does not overwrite it. [WU-045]
5. The Rating row closes the box: the next labelled row starts a new box, and a rating is never taken from another box. If Asset A's Rating row is empty and Asset B's "BBB+" sits under Asset B's own Rating row, Asset A gets no rating. [WU-046]
6. Right after a box is closed, a row whose name-column text looks like a rating, with no values and no text, is that box's rating (if it has none yet), not a new box. Rating row empty, then "| BBB" in the name column gives the box rating "BBB", and no box called "BBB". [WU-047]
7. Several filled rating cells are joined from the first filled to the last filled with " / ", a blank between them shown as "-": "-", "BBB+", "-" becomes "- / BBB+ / -"; "BBB", blank, "A" becomes "BBB / - / A". Exactly one filled cell is used as it is; none filled gives no rating. A leading "Rating:", "Ratings -" or "Rating –" is removed from each cell ("Rating: A-" becomes "A-"). [WU-048, WU-049, WU-050]
8. What looks like a rating: text made of agency grades (AAA, AA, A, BBB, BB, B, CCC, CC, C, D, Aaa, Aa, Baa, Ba, Caa, Ca, NR, WR, SD, each optionally with + or -, and 1, 2 or 3, optionally in brackets), optionally followed by (internal), (shadow), (implied) or (est.), possibly several separated by "/" or dashes; capitals don't matter. "BBB-", "Baa2", "A (Internal)", "- / BBB+ / -" are ratings; "Stable", "Holdco" are not. [WU-051]
9. Text holding a digit followed by x, a % sign, or a decimal number is never a rating ("6.62x", "70%", "1.25"); "A-1" and "Aa1" still are. [WU-052]
10. Also taken as a rating: text with "internal" or "shadow" plus a grade or the word rating ("Internal rating BBB"), a grade followed by (internal) or (shadow) ("BB+ (shadow)"), "not rated", and "NR" / "N.R.". [WU-053]

### 8.6 Description and recent events

1. On every row of a box, each non-empty cell to the right of the value area is collected as the box's text, except a cell that says only "Description" or "Description and recent events". [WU-061]
2. A box's text is its first row's right-hand cells, then each later row's right-hand cells, top to bottom, the Rating row and the row consumed under it included. F1 "desc", F2 "event 1", F4 (the Rating row) "event 2" give description "desc" and events "event 1", "event 2". [WU-068]
3. Right-hand text met after a box closed and before the next box opens is held. It goes to the earlier box if the new box has text on its own first row, otherwise to the new box. Asset A's Rating row, then a row with only "Late event" in column F, then box Asset B whose first row has its description: "Late event" goes to Asset A. [WU-021]
4. Right-hand text after the last box closed is added to the last box. [WU-022]
5. All the text of a box is joined and split again at every line break, so one cell with Alt+Enter lines and one cell per row give the same result; empty lines are dropped. [WU-062]
6. At the start of each line, bullet marks (•, ▪, ▸, ►, ▶, ‣, ◦, ·, *) are removed; a dash is removed only when a space follows it, so "-3% revenue" keeps its minus sign. [WU-063, WU-064]
7. **Scope's choice:** with two or more lines and a first line of at most 160 characters, the first line is the description and the rest are recent events. With exactly one line, it is the description if at most 140 characters, otherwise a single event with no description. With a first line over 160 characters, there is no description and every line is an event. [WU-065, WU-067, WU-066]

### 8.7 Empty boxes

1. A box is kept only if it has a name and at least one of: a description, an event, a rating, or a ratio value. A blank template box (ratio names but no values, no text, no rating) is therefore not a write-up. [WU-023]

### 8.8 Tidying a write-up

Scope tidies every write-up when it is read, and again before it is drawn on a slide, on the Asset write-ups page or on an asset's page, so write-ups kept from an older version draw correctly.

1. Any ratio row whose name contains "rating" is removed from the ratios; if the box has no rating yet, its filled cells become the rating (joined as in 8.5 step 7). Ratios "ICR 2.00x" and "Rating | - | A | -" with no rating become ratios "ICR" and rating "A". [WU-054]
2. Any ratio row, whatever its name (even blank), whose filled values all look like ratings is also removed and, if there is still no rating, gives the rating. Row "Holdco | | | BBB- (Internal)" gives the rating "BBB- (Internal)" and Holdco is not shown as a ratio. [WU-055]
3. Rows named Rating are looked at before rating-only rows, so a named Rating row gives the rating. [WU-056]
4. After tidying no such row remains among the ratios, even when the box already had its rating (box rating "BBB" plus a ratio row "Rating | BB": the row is dropped, the rating stays "BBB"). [WU-057]
5. "Rating:" is dropped from the rating, and whatever column the workbook put it in, the rating is placed under the middle (Lock-up) column only. [WU-058]

### 8.9 The one-row-per-asset table layout (sheets with no marker rows)

1. Rows before the first header row (8.2 step 4) are ignored; with no header row the sheet gives nothing. [WU-024]
2. Columns are found by their header: Ref is the header starting "ref"; Name the header starting name, asset, transaction or project; Description the header containing "description"; Events the header containing event, comment, update or news but not "description". [WU-025]
3. Each row with a name starts a new write-up; rows with a blank name add their description and event cells to the write-up above; a repeated header row ends the current one. Row "1 | Asset C | A toll road" then row " | | | Traffic up" adds "Traffic up" to Asset C. [WU-026]
4. With an Events column, the description is all the description lines joined with spaces and every events line is an event. [WU-069]
5. Without an Events column, several description lines give the first as the description and the rest as events; a single line is the description if at most 140 characters, otherwise one event. [WU-070]
6. A write-up with neither a description nor an event is dropped; a name alone is not enough. This layout carries no ratios and no rating. [WU-027]

### 8.10 Combining sheets: the same name twice

1. A write-up is identified by its name with capitals and accents removed and everything except letters a to z and digits removed: "Société Générale (II)" becomes "societegeneraleii". This is used for duplicates and for links set by hand. [WU-005]
2. Across all sheets, a write-up whose name gives the same identity as one already read is skipped; the first in sheet order, then row order, wins. "Asset A" on sheet 1 and "ASSET-A" on sheet 2 are the same; only sheet 1's box is kept. [WU-004]
   **Silent:** the skipped duplicate is not reported.

### 8.11 Every name an asset goes by

To link write-ups to assets, Scope gathers, for every asset of the calculation, every name it goes by.

1. From the asset itself, in this order: its name, code name, identification ID, transaction group and asset group. [WU-074]
2. Every Mapping row of its securities adds its code name, Holdings name and transaction group. [WU-075]
3. Every column of its Hardcoded and ESG Hardcoded rows whose header looks like a name column adds its value. [WU-076]
4. Each Holdings position of the asset adds its security name and every name-like Holdings column (issuer, deal …). [WU-077]
5. A header is a name column when it contains name, project, deal, transaction, asset, issuer, borrower, obligor, company, spv, tranche, facility, security, instrument or description ... [WU-078]
6. ... and is not when it also contains ID, ISIN, CUSIP, SEDOL, FIGI, LEI, ticker, sponsor, owner, shareholder, agent, arranger, lender, manager, analyst, investor, fund, portfolio, country, sector, currency, rating, type, status, date, class, esg, sfdr, region, desk, account, book, custod…, counterpart…, benchmark, index, model, strategy, format, comment, note or team. "Sponsor Name", "Fund Name", "Asset Type" and "Security ID" are not used. [WU-079]
7. A candidate is skipped when it is a number cell, shorter than 2 characters, longer than 60 characters, more than 8 words, or already listed (capitals don't matter). [WU-080]
8. These names are worked out once per calculation and re-used; linking the same write-ups with the same links again gives the earlier answer without re-scoring. [WU-106]

### 8.12 How two names are compared

1. Before comparing, each name has capitals and accents removed, and "&" is read as "and" ("Crane & Co" equals "Crane and Co"). [WU-081]
2. Decimal numbers, percentages and stand-alone years from 1900 to 2099 are removed; letters and digits run together are split ("Asset 2.5% 2030" matches "Asset" exactly; "Lynx2" reads "lynx 2"). [WU-082]
3. II, III, IV, VI, VII, VIII and IX are read as 2 to 9, and a final "I" after another word as 1; numbers lose leading zeros ("Asset 02" equals "Asset 2"). V and X are not converted. [WU-083]
4. Plurals become singular: a final "ies" after a consonant becomes "y" ("Energies" equals "Energy"), otherwise a word longer than 3 letters ending in a single s loses the s ("Airports" equals "Airport"; "glass" stays). Words on the filler and kind-of-asset lists are left as written, so "Facilities", "Batteries" and "Netherlands" are still recognised. [WU-084]
5. Legal-form and debt words are ignored, unless the name is nothing else: the, of, and, de, du, la, le, des, et, ltd, limited, plc, sa, sas, sarl, srl, spa, bv, nv, gmbh, ag, ab, as, aps, oy, llc, lp, inc, co, holding(s), group(e), bidco, topco, midco, holdco, opco, finance, financing, funding, debt, senior, junior, mezz(anine), loan(s), facility / facilities, tranche, term, tl, tla, tlb, tlc, capex, rcf, note(s), bond(s), pp, ppp, project(s), top up / topup. [WU-085]
6. Words that only name a kind of asset or a place never make a match on their own: airport, hospital, port, prison, school, road, rail, railway, rolling stock, motorway, toll, bridge, tunnel, energy, power, wind, windfarm, farm, solar, pv, offshore, onshore, hydro, battery, storage, gas, water, waste, network, fibre / fiber, telecom, tower, data, centre / center, district heating, student housing, education, health(care), social, transport, infrastructure / infra, renewable, utilities / utility, electricity, grid, ev, charging, plant, portfolio, platform, service(s), uk, france, germany, spain, netherlands, italy, portugal, ireland, sweden, european, europe, north, south, east, west, new, city, international, national. [WU-086]
7. A shared word only counts if it has at least 3 characters (or contains a digit) and is not one of those kind-of-asset words. [WU-087]
8. The score, 0 to 100, is the first of these that applies:
   - 100: the names are identical once the above is removed ("Harbour Ports 3" and "Harbour Ports 3 Ltd"). [WU-088]
   - 0: both names carry numbers and share none ("Asset 2" and "Asset 3"). [WU-089]
   - When only one name has a number, 6 is taken off whatever score follows. [WU-090]
   - 96: exactly the same set of words, including a distinctive one ("Asset 1" against "Asset" gives 96 − 6 = 90). [WU-091]
   - 90: every word of the write-up's name is in the asset name ("Asset A" in "Asset A Holdings 2"). [WU-092]
   - 84: every word of the asset name is in the write-up's name. [WU-093]
   - 60 to 80: the shared words (one of them distinctive) are at least half of all distinct words of both names; score 60 + 20 × that share, rounded. Two of four words gives 70, below the 75 needed to link. [WU-094]
   - 80: with spaces and numbers removed, both names are at least 5 letters, one contains the other, and the shorter has a distinctive word. [WU-095]
   - 76: both run-together names are at least 6 letters, their lengths differ by at most 15%, they start with the same letter and are at least 85% alike letter by letter (one letter out). [WU-096]
   - 0: none of the above. [WU-097]

### 8.13 Choosing each write-up's link

1. A link set by hand on the Asset write-ups page wins over matching by name. It can be an asset or an asset group. [WU-108]
2. A write-up set to "Not linked" is linked to nothing, whatever its name matches. [WU-109]
3. A link set to an asset group links to every asset whose asset group is that group. [WU-110]
4. If the asset or group a write-up was set to is no longer in the data, the hand link is ignored and the write-up is matched by name as if it had never been set. [WU-111]
   **Silent:** the deck does not warn about this; only the dropdown on the page marks it (8.15 step 4).
5. Otherwise the write-up's name is compared only with asset names that share a distinctive word with it, or whose run-together name (numbers removed) starts with the same three letters. [WU-098]
6. Each asset's score is the best score of any of its names, and the name that gave it is remembered ("by Code name"). [WU-099]
7. **Scope's choice:** the best asset links automatically only if its score is 75 or more; otherwise the write-up is not linked and the closest name is reported. [WU-100]
8. Every asset scoring within 2 points of the best counts as an equally good match (90 and 89 both count; 90 and 87 only the 90). [WU-101]
9. If only one asset is that close, the write-up links to it. [WU-102]
10. If several are, and all belong to one asset group (the transaction group, else the code name, as the calculation sets it), the write-up links to the whole group, every asset of it, not only those whose names matched, the same as a group link set by hand. [WU-103, WU-105]
11. If they belong to different groups, the write-up is not linked and is marked ambiguous, with the candidate assets listed. [WU-104]

### 8.14 Which write-ups go in a view's investor deck

1. A linked write-up goes in a view's deck only when at least one of its linked assets is held by the view: an Output row of the view with an exposure of at least half a currency unit, so an asset the view holds at 0 does not count. A write-up linked to asset 1003 is in the Region A deck if Region A holds 1003, and not in the Investor 1 deck if Investor 1's amount in 1003 is 0. [WU-115]
2. **Scope's choice:** write-ups matched to no asset (no sure match, or several assets as good) go in no deck, because they cannot be placed in a view, unless the setting "Write-ups linked to no asset" is "in every report"; it starts as "left out of every report". One set to "Not linked" by hand is in no deck whatever the setting. The Investor reporting page says how many write-ups match no asset, so they can be linked on Asset write-ups. [WU-116, WU-117, WU-118]
3. The write-ups follow the asset table's deal order (by the first asset each is linked to), as the house deck orders its monitoring pages; ones linked to no asset of the view come last, in the workbook's order. [WU-119]
4. Investor reporting reads the write-ups for the view this way, every time a deck is built. [RPT-280]

### 8.15 The Asset write-ups page

1. Without a calculation the page only says "Load the four sheets on Data & validation first."
2. The workbook card shows the file name, the number of sheets, the number of write-ups, the date read, how many are linked by name, by hand and not linked (ambiguous counted as not linked; the "not linked" count in bold when there are any) and how many the current view's deck carries: "wu.xlsx · 2 sheet(s) · 12 write-up(s) · read 2026-10-30 · 9 linked by name, 1 by hand, 2 not linked · 11 in the Region A report". [WU-121]
3. Each write-up's "Linked to" dropdown offers: By name, Not linked, each asset group with more than one asset (alphabetical, with its asset count), then every asset as "code name (or name) · ID", alphabetical. [WU-113]
4. A hand link to an asset or group no longer in the data still shows, marked "(no longer in the data)". [WU-112]
5. Choosing "By name" deletes the stored hand link; any other choice is saved under the write-up's name identity (8.10). [WU-114]
6. Under the dropdown: for a write-up linked by name, the target and the name that made the link ("by Code name 'Asset A'"); for an ambiguous one, up to three candidates (then "…") and "pick one"; for an unlinked one, the closest name, or how many asset names were compared. [WU-107]
7. The "In this report" column says Yes when the write-up is linked to an asset the view holds, No when linked elsewhere; for one linked to no asset, "No (not linked)", or "Yes (not linked)" when the setting puts such write-ups in every report. [WU-120]
8. The Ratios column lists the ratio names after tidying (8.8), comma-separated, or "–"; the Rating column the tidied rating; the Events column the number of events. [WU-041, WU-059, WU-073]
9. Clicking a row shows that write-up as the monitoring slide will draw it. The chosen row is remembered when the page redraws (for example after a link change); by default the first row is shown. [WU-125]
10. The preview uses your report style, else the loaded template's theme colours, else the house colours (dark bar 0F7164, tint E7F4F1, text 1D1D1B). [WU-150]
11. The preview lists every ratio row (after tidying) under Actual, Lock-up and Covenant, each value in a boxed cell; it always has a Rating row, the rating across the three columns, empty when there is none; an impact line (9.17 step 12) is in bold. [WU-040, WU-060, WU-072]

### 8.16 The blank template workbook

1. "Blank template (.xlsx)" downloads "write-ups-template-<view name in lower case with hyphens>.xlsx" (view "Region A" gives write-ups-template-region-a.xlsx). [WU-156]
2. It has two sheets: "Write-ups" (the boxes) and "How to fill" (instructions, one line per row). [WU-154]
3. Row 1 of Write-ups is "Ref. | Name | | | | Description and recent events". [WU-152]
4. One box per asset of the view, named by its asset group, else code name, else name; a name already used is not repeated; boxes follow the view's row order (largest first). "Asset A" and "Asset A top-up" in group "Asset A" give one box "Asset A". [WU-151]
5. Each box is four rows: the name in B with Actual, Lock-up, Covenant in C, D, E; then "Net debt / EBITDA", "ICR" and "Rating" in B; the ref and description cells left blank. [WU-153]
6. The How to fill sheet has no marker words and no Ref / Name header, so loading the filled template back reads write-ups from the Write-ups sheet only. [WU-155]

### 8.17 The write-up on an asset's page

1. An asset's page has a Write-up section only when a write-ups workbook with at least one write-up is kept and at least one write-up links to that asset. [WU-124]
2. It shows every write-up linked to the asset (by name, by hand, or through its group), drawn as in the preview; ambiguous and unlinked write-ups are not shown there. [WU-122]
3. Its subtitle says "linked by hand" or "linked by name" according to the first linked write-up only. [WU-123]

## 9. The investor deck

What goes in: the calculation result of the selected view and currency (global filters applied), the sectors picked for the view, the previous Holdings result (if kept and no filter applies), the report inputs typed on Investor reporting (cover name, compartment, mandate, repaid, source line, the extra pages ticked), the public-market curves, the view's write-ups (8.14), and the template and style (stage 10). What comes out: one editable PowerPoint deck: cover, five sections (market activity, portfolio overview, portfolio metrics, pipeline, appendix), every figure from the result. Slide by slide below, in deck order.

### 9.1 What the deck is built from

1. Without a calculation (or with a fatal error) the Investor reporting page only says "Load the four sheets on Data & validation first." [RPT-288]
2. The View list offers only views that have investor columns. [RPT-287]
3. The previous Holdings figures: the Holdings sheet kept from before the last monthly update is run through the same calculation with the current Mapping, Hardcoded and settings. [RPT-276]
4. **Scope's choice:** when any global filter applies, no previous result is worked out, so the deck has no quarter-on-quarter figures and the rating change column shows "No". The page says so. [RPT-277]
5. **Silent:** if the previous Holdings cannot be calculated, the deck is built without quarter-on-quarter figures and no message is shown. [RPT-278]
6. Cover name, compartment, mandate, repaid this year and the sector choice are kept per view; the source line is shared by every view; the market curves and write-ups are shared too. A mandate typed for Region A is not used for Investor 1. All are saved in this browser. [RPT-279]
7. Inputs are trimmed; clearing one removes it so its default applies again (a cleared cover name gives the view name again). [RPT-281]
8. Sectors in the deck: the source picked for the view; if none was ever picked, the investor's own "<investor> Sector Classification" column of Hardcoded that the view (or its cover name) is matched to, else the Holdings sector. View "Investor 21 mandate" with nothing picked uses "Investor 21 Sector Classification". [RPT-282]
9. A picked column that is not, or no longer, a Hardcoded sector classification column gives the Holdings sector. [RPT-283]
10. The picked source changes the sector pages and the asset tables of both decks only; the Output and every other page keep the Holdings sector. [RPT-284]
    **Silent:** an asset with an empty cell in the picked classification column shows as "Not set" in the deck's sector charts and an empty sector in the asset table.
11. The analysis pack (10.11) is also built on the result with the picked sectors, but gets none of the report inputs. [RPT-285]
12. After a download the page shows the file name, the slide count and the sector source ("… downloaded · 24 slides · sectors: Holdings"). [RPT-299]
13. The "What is in it" list on the page is a trial build of the same deck without the previous Holdings; it lists each slide's title and a note of what it shows. These notes appear only in that list, not on the slides. [RPT-298]

### 9.2 Formats and names used throughout

1. Month and year in titles read "September 2026"; dates in words read "30 September 2026" (no leading zero, "5 June 2026"). [RPT-093, RPT-092]
2. Shares are whole percent; a missing share is "–" (0.4567 becomes "46%"). [RPT-090]
3. Currency symbols: EUR €, GBP £, USD $, JPY ¥; any other currency is its code and a space ("CHF 120m"); no currency means EUR. [RPT-088]
4. Amounts are the symbol, whole millions with thousands separators and "m": 375.4 becomes "€375m", 1234.6 becomes "€1,235m"; missing is "–". [RPT-089]
5. The view's name is its label, else "Portfolio". [RPT-087]
6. The name on the cover, in the page headers and in the file name is the "Name on the cover" input, else the view's name. [RPT-085]
7. The compartment name (in "… Guidelines") is its input, else the view's name. [RPT-086]
8. The source line of every page is the "Source line" input, else "Source: internal data (unaudited at {date})"; {date} becomes the reporting date in words. Pages left blank have no source line; some pages add to it (noted below). [RPT-091]
9. Assets are named by their code name (Mapping › Code Name), else their Holdings name. [RPT-145]
10. An asset's sector is its Holdings sector, or the investor classification picked for the view (9.1 step 8). [RPT-144]
11. The small header line (kicker) of every content page is in capitals, and section titles are in capitals. [RPT-106, RPT-097]
12. A label on a coloured shape (doughnut slice, map country, legend box) is white, unless the colour is very light (brightness above 0.8), then it is in the text colour; so labels on a sage or a teal are white, as on the house deck. [RPT-083]
13. Splits (doughnuts): an empty value is grouped as "Not set"; buckets with zero or negative exposure are left out; slices are largest first unless a fixed order is given, and labels not in a fixed order come after it. [RPT-137, RPT-138]
14. Doughnut slices take the many-slice colours (10.8) in order, starting again when they run out. Scope sets the labels itself (a chart's own labels get cut at the ring's edge): name and whole-percent share (one decimal under 1%), each on one line. A slice of at least 4% (thresholds noted where used) whose label fits across the ring there has it in the ring, white or dark by the slice colour; any other has it just outside the ring beside its slice, in the text colour, the labels on each side pushed apart (up above the middle, down below it) so none overlap, and kept inside their panel. A 2% "SEK" slice reads "SEK 2%" outside the ring. [RPT-140, RPT-139]
15. The file's title property is "<name> · investor report · <quarter>". [RPT-113]

### 9.3 Cover

1. The cover carries the name in capitals and "REPORTING AS OF <DATE IN CAPITALS>": "INVESTOR X", "REPORTING AS OF 30 SEPTEMBER 2026". [RPT-094]
2. On a template these go into its cover's x boxes and nothing else is drawn; without a template, the house cover (10.9). [RPT-095, RPT-096]

### 9.4 Section 01 Market activity and its two blank pages

1. Every section break is built as in 10.9 (template boxes, or the house green page). [RPT-098, RPT-099]
2. Section 01 is "Market activity", with no lines under the title. [RPT-100]
3. Two content pages follow, both titled "Current market activity", kickers "Overview of the infrastructure debt market" and "Overview of the European infrastructure debt market"; they are left blank for your commentary and have no source line. [RPT-101]

### 9.5 Section 02 Portfolio overview: the key figures page

1. Section 02 is "Portfolio overview" with the lines "Portfolio exposures" and "Portfolio summary". [RPT-102]
2. The page is titled "Portfolio overview as at end of <Month YYYY>⁽¹⁾" (footnote 1 on the title), kicker "<name> – Portfolio overview". [RPT-114]
3. Eight figures sit in four columns of two, as the house deck: Under management / Repaid in <year>; Average all-in spread / Brownfield²; Instruments outstanding / Floating; Average rating / Sub-IG². Each column has a thin rule in Accent 1 on its left; each figure is 24 pt bold over its label (12.5 pt, in the heading colour). An investor's deck has no quarter-on-quarter tags and no new-commitments figure. [RPT-115, RPT-117]
   - On the group view the figures follow the group's own deck: Under management / Repaid in Q1, Q2 <year>; Average all-in spread ("229 bps") / Brownfield; Weighted Average Life² (exposure-weighted, one decimal) / Floating; Average rating / Sub-IG (one decimal, "11.4%"). Footnote 2 reads "Instruments with no WAL (e.g. capex facilities) are not included". [RPT-315]
   - On the group view, with a previous Holdings, each figure but Repaid has its change on the quarter beside it in small type: "(-12m QoQ)", "(+3bps QoQ)", "(-0.2 years QoQ)", "(-1p.p. QoQ)", "(Flat QoQ)" when it has not moved (under half a unit; 0.05 for the WAL and Sub-IG), and "(BBB last quarter)" when the rating changed. [RPT-117]
4. Under management is the view's total exposure (funded and unfunded nominal) in whole millions. [RPT-116]
5. Repaid, always labelled "Repaid in <reporting year>": [RPT-119]
   - If "Repaid this year" is a number and not blank (0 counts), that figure.
   - Else, with a previous Holdings: over every asset in the previous Holdings (matched by asset ID), the fall in its drawn amount (its nominal where drawn is not shown); an asset gone entirely counts in full. Asset A drawn 50 then 40, Asset B 20 then gone: repaid 30. [RPT-120]
   - An asset whose drawn amount rose counts as zero; rises never reduce the total (A 50 to 40 and C 10 to 25: repaid 10, not −5). [RPT-121]
   - With neither, "–". [RPT-122, RPT-123]
   - On the group view the label reads "Repaid in Q1, Q2 <year>", the quarters of the year up to the reporting date. [RPT-123]
6. Average all-in spread is the view's exposure-weighted margin in whole bps, written "217bps". [RPT-124]
7. Brownfield is the share of exposure whose greenfield/brownfield value contains "brown" (capitals don't matter); empty or other values are not brownfield. [RPT-125]
8. Instruments outstanding is the number of rows of the view's result (one per asset with exposure in the view). [RPT-127]
   **Scope's choice:** this counts assets, not tranches or Holdings positions.
9. Floating is the exposure labelled Floating in the view's fixed/floating split over total exposure, worked out position by position (an asset's tranches can differ). [RPT-128]
10. Average rating is the view's weighted rating label. [RPT-129]
11. Sub-IG is the share of exposure that is rated and not investment grade; not-rated exposure is not sub-IG. [RPT-126]
12. Footnotes, 7 pt, right-aligned under the split box: "(1) Includes both funded and unfunded nominal as well as amortisation"; "(2) Calculated as a percentage of AuM." and, with a mandate size, " Brownfield is x% as a percentage of mandate size, Sub-IG is y% of mandate size" (their exposure over the mandate). [RPT-132]

### 9.6 The portfolio split box (same page)

1. Under the figures a box outlined in Accent 1 and titled "Portfolio split – <Month Year>" (the month as written, not in capitals) holds four doughnuts: Currency, Bullet/Amortising (repayment type), Residual WAL, Type of Cashflows (cash flow type). Each runs clockwise from 12 o'clock in the fixed order of the workbook's Quarterly Reporting sheet, as the house deck shows it. [RPT-134]
2. Currency uses the view's currency split (worked out position by position, positive amounts only), else adds up exposure by the row's currency. EUR 300 and GBP 75 give 80% and 20%. Slices run EUR, GBP, SEK, DKK, NOK, JPY, then any other currency, largest first. [RPT-135]
3. Residual WAL takes the row's WAL, else its remaining years, in the sheet's buckets "< 5", "5 - 10", "10 - 15", "15 - 20", "> 20" (a boundary goes to the higher bucket), "n/a" when neither is known, shown in that order; empty buckets are left out. [RPT-136]
4. Repayment runs Bullet, then Amortizing (spelt as the house deck spells it); Type of Cashflows runs PPP, Regulated, Contracted, Concession, Merchant. A label not in a list comes after the listed ones, largest first. [RPT-300, RPT-138]
5. Labels match a list entry when, ignoring capitals, spaces and punctuation, they start with it ("&" = "and", Fibre = Fiber, Centre = Center), so plurals and longer names match; "Digital" ranks with Telecom. [RPT-301]
   **Scope's choice:** matching by the start of a name means, say, "Energy efficiency" would sit with Energy.

### 9.7 Sectors and jurisdictions page

1. Same title and kicker as 9.5. Two panels, each with a dark header bar: "Sectors" and "Jurisdictions".
2. Sectors: two rings, sectors inside and each sector's subsectors outside in the same order so they line up; an empty subsector shows as its sector. Sector A 200 (subsectors 120 and 80) gives one inner slice and two outer slices beside it. Both rings run clockwise from 12 o'clock in the sheet's order: Energy, Renewables, Transport, Telecom, Utilities, Social; subsectors in the house list, or in the investor's own list when the report uses its classification (Roads before Rosco either way). [RPT-141, RPT-300]
   On a report using the client's classification, the inner ring (and the spread bubbles, 9.10) show the client's five sectors as its deck names them: Energy + O&G, Renewables + Environmental & Waste, Transport, Telecom, Social, read from the first word of the client's value ("Renewables" shows as "Renewables + Environmental & Waste"). A blank value, or one the list has no row for (such as Utilities), is filled from the Holdings sector: a utility network is Energy + O&G, waste is Renewables + Environmental & Waste. The asset table shows the client's value as it is. [RPT-306]
   On a report using the client's classification without the client's own subsector column, the outer ring puts each Holdings subsector into the client's list, under the asset's client sector, as the client's example deck shows: Renewables are all "Renewable power" (waste "Environmental & Waste"); Social all "Government Services"; under Energy, electricity networks are "Electricity networks", water "Water", gas and heating and cooling "Regulated gas networks", and power, storage and renewables "Power generation"; transport and telecom keep their kind. A subsector the list has no row for keeps its name. Onshore wind 20 and Solar 6 under Renewables show as one slice, "Renewable power" 26. [RPT-305]
3. Each sector has its own colour by its first word, as the house deck colours them: Energy Background 2, Renewables Accent 2, Transport Accent 1, Telecom (or Digital) Accent 4, Utilities Text 2 darker 25%, Social Accent 3; any other sector takes the next many-slice colour not used. Its subsectors take that colour, then the colour mixed with 35%, 55% and 72% white and 25% and 45% black, in turn (mixed, so the tints stay muted). [RPT-142]
4. Outer ring slices under 3% and inner ring slices under 4% carry no label. [RPT-143]
5. Jurisdictions: a map of Europe (9.8).

### 9.8 The map

1. Country outlines come from the Natural Earth 1:50m Europe extract; if that is not loaded, from the coarse world map, smoothed once. [RPT-150]
2. Each row's country is turned into a country code using the world map's list of names. A country it cannot match is kept under its own name (or "Not set") in the amounts list but nothing is shaded for it. Names in the list are shown as in the asset table ("UK" as it is, others in proper case). Jersey, Guernsey and the Isle of Man are matched to their own islands. [RPT-146]
   **Silent:** an unrecognised country name is not shaded and no warning is given.
3. Invested countries are listed largest first and each takes the next colour of the theme's run for countries, the same in the list and on the map (house theme: Background 2, then Accent 2, Accent 1, Accent 4 and Text 2 in turn, as the house deck colours them). [RPT-147, RPT-069]
4. The map shows western and northern Europe (Portugal, Spain, Ireland, UK, Norway, Sweden, Finland, Estonia, Germany, Poland, France, Italy), widened to take in any invested European country except Russia, Turkey and Kazakhstan; it is cut at the panel edges. [RPT-149]
5. Country pieces smaller than 0.0026 cm² on the slide are not drawn. [RPT-151]
6. European countries with no exposure are in the map grey (the palette's map colour, else CFCBC2) with white borders. [RPT-148]
7. Each invested country with at least 2% of total exposure shows its whole-percent share on its largest piece in view, at the point farthest from its edges; no label if that point falls under the amounts list. [RPT-152]
8. A share label is in the text colour when it is wider than the land under it (it runs onto the sea), else white or dark by the country's shade. [RPT-153]
9. The countries are listed top right, largest first, each box in its shade with its name and amount (€Xm). Every country is listed, the boxes shorter when there are many (1.17 cm down to 0.81 cm); only past that is the last row "Other (n)" with the rest summed, in the second-series colour. [RPT-154]
10. Belgium, the Netherlands and Luxembourg are one entry, "Benelux", as in the workbook's country table: one box in the list, the invested ones in one shade on the map (one with no exposure stays grey), the share written once, on the invested member with the most room for it (not on Luxembourg beside the Netherlands). Netherlands 30 and Belgium 10 are listed as "Benelux €40m". [RPT-302]

### 9.9 Assets under management page

1. Titled "Portfolio overview as at end of <Month YYYY>", kicker "<name on the cover> – Assets under management", source "<source line> · AuM defined as funded + unfunded", as the house deck has it. [RPT-155]
2. A band in Accent 1 shows "Assets under management" (€X M) and "Mandate size". In the table under it Funded, Unfunded and Left to deploy are in italics (figures too), Assets under management and Mandate size in bold, every label from the left, the amounts headed "Amount (€m)". [RPT-158]
3. The mandate is the "Mandate size" input when it is not blank and is a number; else "–". [RPT-156]
4. Funded is the total drawn amount; unfunded is total exposure less funded (not shown when drawn amounts are not available). [RPT-157]
5. A table: Funded, Unfunded, Assets under management, Left to deploy, Mandate size, each with its amount and its share of the mandate in whole percent; "–" when there is no mandate or it is 0. [RPT-160]
6. Left to deploy is mandate less AuM, which can be negative (AuM 2,100 against 2,000 gives −100 and −5%); "–" with no mandate. [RPT-159]
7. "Unfunded & partially funded transactions" has one row per instrument (tranche) with anything undrawn (above €5k, so rounding never lists a fully drawn one), by its code name, the most undrawn first, as the house deck shows it. [RPT-161]
8. The table is headed Transaction, Amount drawn (€ M) and % funded, names from the left. Each row shows the instrument's drawn amount with one decimal, and % funded = drawn ÷ exposure in whole percent: exposure 150 and drawn 90 show "90.0" and "60%". [RPT-162]
   **Scope's choice (agreed with you):** the workbook sheet fills these two columns with the undrawn amount and undrawn share; the deck follows the column headings (drawn, % funded).
9. Every row it can: the rows share the room left on the page (0.41 to 0.64 cm each, type 8 to 10 pt, at least one row); only rows past that are summarised as "+ n more". [RPT-163]
10. With none to list: "None: every transaction is fully funded"; if drawn amounts are not available for the view: "Drawn amounts are not shown for this view". [RPT-164]
11. A doughnut on the right has one slice per transaction group: rows grouped by their Transaction Group value (labelled with the group's name), else by their code name; slices under 1.2% unlabelled. Asset A and Asset A top-up in group Asset A make one slice. Slices run clockwise from 12 o'clock in the order the groups first come in the asset list (deal order, 9.13 step 1), as the sheet's UNIQUE list has them, not by size. There is no "left to deploy" slice: the house deck shows that only in the table. Slices under 2.5% are labelled outside the ring. [RPT-165]
12. The group view follows the group's deck instead: the band shows "Total Assets under management" and "Unused Budget" (the Budget entered on Investor reporting less AuM; "–" without one); the table has Funded and Unfunded (italics) and AUM (bold) with "% of total AUM"; under it every transaction with anything undrawn, in deal order, headed Transaction, Unfunded amount (€m) and % funded, italic and centred, closed by a bold "Total unfunded" row; and a doughnut of AuM by the entities the group is made of (as on the allocation page, each at the group's share), each slice with its name and amount, "EUR 2,803 M" in the hole. A budget of 2,900 against AuM of 2,803 shows "€97 M Unused Budget". [RPT-316, RPT-319]

### 9.10 Section 03 Portfolio metrics: spreads across sectors

1. Section 03 is "Portfolio metrics" with the lines Spread breakdown, Achieved spreads, Cashflow projections, Yield projections, Asset performance overview. [RPT-103]
2. The page is titled "Spreads across sectors depicted by volume as of <Month YYYY>", source "<source line> · AuM defined as funded + unfunded". The kicker names the investor, "<name on the cover> – Outstanding spreads across portfolio"; on the client's own look it is "Achieved spreads across portfolio", as the client's deck has it. [RPT-166]
3. Six spread bands: "<150 bps", "150-200 bps", "200-250 bps", "250-300 bps", "300-350 bps", ">350 bps"; a value on a boundary goes to the higher band (150 is "150-200 bps", 350 is ">350 bps"). [RPT-167]
4. Only rows with an all-in spread are on the chart. [RPT-168]
5. **Scope's choice:** the sectors along the bottom are always the same, in the order of the workbook's bubble block, even one the view has nothing in: Energy, Renewable Power, Social, Transport, Telecoms, Utilities (read from the first word of the sector, "Digital" being Telecoms), or the client's five on its own look. A sector outside the list follows them. [RPT-307]
6. Each bubble is the exposure of one sector in one band, unrounded, as the workbook's own bubble block holds it; empty combinations have no bubble; PowerPoint's own bubble scale (120%, the house slide's larger bubbles) sizes them. [RPT-169]
7. Each sector keeps its colour, as the house chart gives it: Renewable Power accent 1, Energy accent 2, Transport accent 3, Social accent 4, Telecoms accent 5, Utilities accent 6, 85% opaque (with the house theme: green, sage, grey, petrol, red, orange). On the client's look its five sectors take accents 1 to 5 in order. [RPT-170, RPT-077]
8. Each bubble is labelled with its whole millions, rounded once as Excel does: "37 M€" ("37 M CHF" for a currency with no symbol); on the client's look "€37M". [RPT-171]
9. A bubble's label is in its centre, white or dark by the bubble colour, when it fits across the bubble; otherwise beside it in the bubble's colour (darker when the colour is pale): above it, else to its right, left or below, the first of these clear of every other bubble and of the labels already placed, else the least crowded, never past the plot. A 19 M€ bubble too small for its label has "19 M€" above it. [RPT-172]
10. The chart's own axes are hidden; Scope draws the two axes with a tick mark at each band and one between sectors, the band names down the left and the sector names under the chart. At least one band of room is left above ">350 bps" and below "<150 bps", more when a bubble in the top or bottom band is large (PowerPoint draws the largest a quarter of the plot's smaller side across), so no bubble reaches the title line or the sector names. [RPT-173]
11. If no row has a spread, the page says "No all-in spread in Holdings for this view." [RPT-174]

### 9.11 Relative value against the public-market curves

Reading the pasted or loaded curves (Investor reporting, "Market data · relative value slide"):

1. Pasted text is split into cells on tabs when it has any (a paste from Excel), else on semicolons, else on commas outside quotes, else on two or more spaces. [WU-157]
2. In comma-separated text a comma inside quotes stays in the value, so "1,234" written in quotes is read as 1234. [WU-158]
3. A number in the date column is an Excel date number only between 20,000 and 80,000 (years 1954 to 2119); text that is only a number is never a date. [WU-159, WU-160]
4. A month and year ("Mar-20", "Jun-2020", "March 2020") is read as the last day of that month; other date text is read day first (03/04/2020 is 3 April 2020). [WU-162, WU-161]
5. A row is data when it has a date cell followed somewhere by at least one number; the first date cell is the date. [WU-164]
6. Only the first two cells after the date are read: the first is curve 1 (the BBB chart's), the second curve 2 (the BB chart's); further columns are ignored. [WU-166]
7. Values are basis points; a trailing "bp"/"bps" is dropped, and commas, currency signs, % and accounting brackets are handled as everywhere else ("(5)" is −5). A value that is not a number is skipped for that curve on that date; the other curve still takes its value. [WU-163, WU-167]
8. The last non-data row before the first data row names the curves: the header cells directly above the two value columns; an empty header cell gives "Index 1" or "Index 2" for that column only, without shifting the other name. [WU-165, WU-168, WU-169]
9. Each curve's points are sorted by date; a curve with no points is dropped. The page shows each curve's name, number of points and first and last dates. [WU-170, WU-171]
10. Data with no date-and-value columns is refused ("No date and value columns found: paste a date column then one or two spread columns (bps)"). [RPT-292]
11. From a workbook (.xlsx, .xlsm) the sheet giving the most curves is used, then the one with the most points; a .csv or .txt is read as one sheet. [RPT-293]

The slide:

12. Titled "Relative value vs public markets spread curves", kicker "Achieved spreads in the portfolio" ("<name> – Achieved spreads across portfolio" on the group view, whose charts have no titles), source "Source: <curve names>; <source line without its leading 'Source:'>". [RPT-175]
13. Deals are rows with an all-in spread and a close date: financial close, else funding date. [RPT-176]
14. Two charts. "BBB transactions" has the rated investment-grade rows; "BB transactions" the rated sub-investment-grade rows; not-rated rows are on neither. [RPT-177]
    **Scope's choice:** the "BBB transactions" chart holds every investment-grade deal, including A or AA rated ones, and "BB transactions" every sub-investment-grade deal, including B or lower.
15. Each curve goes on the chart its name puts it on: a name with "BBB" on the BBB chart, one with "BB", "High Yield" or "HY" (and no "BBB") on the BB chart; every curve is drawn, so the BBB chart can carry two (EUR Corp BBB 7-10y and the iBoxx Infrastructure BBB). [RPT-178]
    **Scope's choice:** when no name says either, the first curve goes on the BBB chart and the second on the BB chart; only points with a date and a value are used.
16. Rows with the same group (asset group, else transaction group, else name), the same close date and the same spread are one marker. [RPT-179]
17. A shared marker reads "<group> <suffixes joined by commas>" when every name starts with the group name ("Asset A 1,2"), else the names joined by ", ". [RPT-180]
18. The date axis runs from the start of the chart's curves (the first deal when there is no curve) to 12 days after the reporting date, as the group's slide shows it; deals closed before the curves start or after the reporting date are left off. It starts on the 15th of the last month of a quarter (March, June, September, December) on or before that: curves from 30/06/2020 give an axis from 15/06/2020. [RPT-181]
19. Ticks are one a quarter if that gives at most 26, else one a half-year if at most 16, else one a year; labels read mmm-yy. [RPT-182]
20. The spread axis runs from 0 to 12% above the highest point, rounded up to 50 bps (at least 100), with a gridline every 50 bps, or 100 bps above 400 (highest 330 gives 0 to 400 by 50). [RPT-183]
21. Only deals closed in the 15 months to the reporting date are named (every deal when a chart has 12 or fewer). Each name is placed right, above, left or below its marker, tried in that order, taking the first spot clear of labels already placed and of markers, else the least crowded; deals are placed in date order. [RPT-184]
22. A spot scores 2 for each label it overlaps, 1 for each marker, and 3 if it runs outside the plot area. [RPT-185]
23. Deals are x markers (size 6) in the bright series colour on the BBB chart and the accent colour on the BB chart; the curves are 1.5 pt lines, on the BBB chart the first in Accent 1 and the second in the label grey, on the BB chart the heading colour; legend on the right. [RPT-186]
24. A chart with no deal says "No BBB transaction with a close date and a spread." (or BB), adding " in the curves' period" when curves are drawn. [RPT-187]

### 9.12 Cashflow and yield pages

1. Two blank pages follow: "Projected cashflow profile" (title "AUM (drawn exposure), Repayments and Coupons") and "Projected yield profile" ("Fixed, Floating and Combined Yields"), with no source line. [RPT-188]

### 9.13 The asset and performance table

1. Rows are ordered by Chronological Order (Hardcoded), rows without one last; then by funding date, rows without one last; then the result's rank (largest first). [RPT-190, RPT-191]
2. Columns: #, Name, Country, Currency, Sector, Nominal (in € eq.), Format, Fixed/Floating, Residual WAL, All-in spread (bps), Compliance with financial covenants, Rating (*), Rating change. [RPT-192]
3. An investor's own classification column (Hardcoded "… Classification", e.g. Core / Core+) is added last only on that investor's decks: when the report uses the same investor's "… Sector Classification" for its sectors (9.1 step 8) and some row has a classification, as the workbook shows it only on the investor's own views. Its heading has a line break before "Classification" ("Investor 21 Classification" becomes "Investor 21 / Classification"). A deck in Holdings sectors, or in another investor's sectors, has no such column. [RPT-193]
4. # numbers rows 1, 2, 3 … carrying on across pages. [RPT-194]
   Country shows "UK" as it is and every other name in proper case, like Excel's PROPER ("UNITED KINGDOM" → "United Kingdom"). [RPT-303]
   Format shows "Bond" when the instrument is a bond ("Infra Bond") and "Loan" for anything else, a blank included. [RPT-304]
   **Scope's choice:** the workbook turns only "Infra Bond" into Bond; Scope treats any instrument with the word "bond" as Bond.
5. Nominal is the row's exposure in the display currency, whole millions with "m" ("105m"). [RPT-195]
6. Residual WAL is the row's WAL with one decimal, else "n/a"; remaining years are not used here. [RPT-196]
   **Scope's choice:** the split doughnut (9.6) uses remaining years when WAL is missing, this table does not.
7. All-in spread is whole bps, else "n/a". [RPT-197]
8. Compliance shows the row's covenant compliance text, else "n/a"; text starting with "y" (Yes) is in the bright series colour (Text 2 on a house theme). [RPT-198]
9. Rating shows the internal rating (bold, in the internal-rating colour, Accent 1) unless it is "NR" or blank; then the external rating (the worst agency rating, in the agency's own notation, e.g. "Baa3"); "NR" when neither is known, as the house deck shows them. [RPT-199]
   **Note:** the key figures (average rating, Sub-IG) still use the current rating, which puts the internal rating first.
10. Every rating is bold: the internal one in the internal ratings colour (Accent 1 on a house theme, else 2D5C99), an external one in the text colour. [RPT-200]
11. Rating change: "No" when unchanged, and (as the house deck types it) when there is no previous Holdings, the asset is new or a numeric rating is missing; a lower numeric rating now, "Upgrade"; higher, "Downgrade" (red); "Upgrade" in the bright series colour and "No" in the internal-rating blue, as the house deck shows it. [RPT-201, RPT-202]
12. Up to 30 rows a page, as the house deck, as many as the deck's content area takes at a legible size: the largest type from 9 pt down to 7 pt at which they fit, each row at least as tall as its type needs, so no row grows and pushes the table onto the footer. 51 assets on a house page fill two pages, 30 rows then 21. [RPT-203, RPT-318]
13. A dark bar in the header colour closes the table under its last row. [RPT-207]
14. Pages are titled "Asset and performance overview" (no page count, as the house deck), kicker "<name> – Asset and performance overview"; the first page's note says "<n> instruments in deal order". [RPT-205]
15. The source line reads "(*) In bold and blue represent internal rating; black font represents external rating. <source line>". [RPT-206]
16. The rows of a page share the content height, less the 1.27 cm header row and the closing bar, counting at least 14 rows (up to 0.69 cm each), so a page of few rows gets taller rows; each row at least 1.22 × its type size plus 0.03 cm, with 0.013 cm cell margins. The allocation, ESG, prepayment and granularity tables follow the same rule. [RPT-207]

### 9.14 Section 04 Pipeline

1. Section 04 is "Pipeline" with the lines "Transactions in the pipeline are either IC approved or in IC preparation" and "Guidelines". [RPT-104]
2. Two blank pages: "Transaction pipeline" and "<compartment> Guidelines", with no source line. [RPT-208]

### 9.15 Section 05 Appendix: portfolio monitoring

1. Section 05 is "Appendix" with the lines of the group report pages ticked for the deck (Portfolio allocation, ESG ratings, Prepayment protection; see 9.19), then "Portfolio monitoring". The ticked pages come first, in that order. [RPT-105]
2. Only write-ups with a name are drawn (8.14 gives the list). [RPT-209, WU-126]
3. With none, the appendix has one blank page titled "Portfolio Monitoring", note "no asset write-ups: load them on Asset write-ups", no source line. [RPT-210, WU-127]
4. The Investor reporting page says how many write-ups are about the view's assets and so how many appendix pages there are ("3 of 8 write-up(s) from W.xlsx are about assets of Region A"), and warns if they were read by an earlier version. [RPT-295, RPT-294]

### 9.16 Monitoring pages: how write-ups are split over pages

1. Each write-up is tidied first (8.8). [RPT-211, WU-129]
2. Description and events are trimmed and empty events left out. [WU-149]
3. Text size: 8 pt; 7.5 pt when the description and events together exceed 2,200 characters; 7 pt above 3,200. [RPT-212, WU-130]
4. Scope estimates how much fits: a line holds 17.53 cm × 72 / (size × 0.5) characters (at least 30; about 124 at 8 pt); a page holds (content height − 2.29 cm, at least 5.08 cm) × 72 / (size × 1.32) lines, the content height being the template's content area or 14.10 cm (about 31 lines at 8 pt on the house page). A paragraph costs its length divided by the characters a line, rounded up, plus 0.3. [RPT-213, WU-131]
5. Paragraphs (description first, then each event) fill a page in order; when the next one would overflow, it starts a new page for the same write-up. A paragraph is never split. The continued page shows the name with "(continued)" and no ratios or rating. [RPT-214, WU-132]
   **Silent:** this is an estimate of text width; very long words or wide letters can still overflow the box.
6. Each page is titled "Portfolio Monitoring (i/N)", N the number of monitoring pages in the whole deck, continued pages included; the note is the asset name. [RPT-215, WU-133]
7. Every monitoring page's source line reads "Source: internal data and companies' documents as at DD/MM/YYYY" (the reporting date), not the report source line; empty date if the reporting date is invalid. [RPT-216, WU-128]

### 9.17 Monitoring pages: layout of one write-up

1. A 0.76 cm header bar in the deck's dark colour (your style's dark, else the theme's) reads "Ref.", "Name" and "Description and recent events" in 9 pt bold white, the last centred over the right column. [RPT-217, WU-134]
2. The left column (ref, name, ratios) takes 43.5% of the content width; the description and events take the rest. [WU-135]
3. Under it a box in the tint colour (else the table banding colour), as tall as the larger of the ratios block and the text, at least 2.29 cm and at most the page's free height. [RPT-225, WU-136]
4. Ref: the write-up's own ref, else its position "k/N" among the view's write-ups ("3/7"). [RPT-219, WU-137]
5. Name: bold 8.5 pt, 7.5 pt when it would not fit its column (about 0.19 cm a character); continued pages add " (continued)". [RPT-220, WU-138]
6. Above the ratios, on a write-up's first page, "Actual", "Lock-up" and "Covenant" in 8 pt italic, centred, each column 7.5% of the content width, starting 20.5% from the left; they appear even with no ratios. [WU-141]
7. Ratios and rating are drawn on a write-up's first page only. At most the first twelve ratio rows are drawn and the box grows with them; a thirteenth and beyond are not drawn. [RPT-218, WU-139, WU-140]
   **Silent:** ratio rows beyond twelve are dropped from the slide without a message.
8. Each ratio name is 8 pt italic, right-aligned, ending just left of the Actual column. [WU-142]
9. Each value is written exactly as read, 8 pt italic, centred, in a white box with a 0.75 pt outline in the text colour; an empty value gives an empty box. [RPT-221, WU-143]
10. The word "Rating" is always written under the ratio names, once, even with no rating; the rating, if any, is written once, centred across the three columns (under Lock-up), italic 8 pt, without a box. [WU-144, RPT-222, WU-145]
11. Right column: the description first, in bold, 3 pt after it; then each event as a justified paragraph with a ► bullet in the text colour at 60% size, indented 0.30 cm, 1 pt after. [RPT-223, WU-146, WU-147]
12. An impact line is in bold: an event starting with neutral, positive, negative, no, limited or material followed within 24 characters (no colon in between) by the word "impact", or starting "Impact:". "Neutral impact: no rating change" and "Impact: none" are impact lines; "Rating impact: neutral" and "Impact on revenue was small" are not. It is in Accent 1, as on the house deck. [RPT-224, WU-071, WU-148]

### 9.18 File name

1. The file is named "<name>-investor-report-<quarter>.pptx" (the reporting date as YYYY-MM-DD when there is no quarter); any character other than letters, digits, space, dot, underscore and hyphen becomes a space, and spaces become hyphens: "Investor-X-investor-report-Q3-2026.pptx". [RPT-112]


### 9.19 The group report pages (ticked on Investor reporting)

1. Five pages the group's own reports carry can be added: spreads by maturity, portfolio granularity, portfolio allocation by entity, ESG ratings and prepayment protection. Each has a tick box under "Extra pages in the investor deck" on Investor reporting, with a line saying whether they are ticked by default; ticking one rebuilds the outline at once. [RPT-308, RPT-314]
   **Scope's choice:** they are ticked by default for the group view (the view Settings › Investors builds from group ownership) and unticked for every other view; a box you change is kept for that view, and setting it back to its default forgets the choice.
2. Spreads by maturity comes right after the sector bubbles: "Maturities and spreads across sectors depicted by volume as of <Month YYYY>", kicker "<name> – Spread profiles of portfolio maturities", the same bubbles by spread band with a column per years to final maturity (Less than 1 year, 1 to 3, 3 to 5, 5 to 10, 10 to 20, Greater than 20), each in its own colour (Accent 2, Accent 1, Accent 4, Accent 3, Accent 5, Text 2: the 3 to 5 years column navy, as the group's slide); an asset with a spread but no maturity goes in a "Not set" column. Labels sit as on the sector bubbles (9.10). [RPT-309]
3. Portfolio granularity, in the appendix: "Aggregated Credit Exposure", kicker "Portfolio granularity": each deal's share of AuM (its tranches together, under the deal's name), two decimals, largest first, in four Name / Share (%) tables side by side, and under the last a doughnut of every deal with the total ("EUR 2,803m") in the hole; more deals than fit carry on over the next page. A deal of 133m in a 2,803m book shows "4.74%". [RPT-317]
4. Portfolio allocation, in the appendix: "Portfolio allocation (i/N)", one row per instrument in deal order, a column per entity the view is made of in its order: its investor columns, except that the columns another view adds up whole (Region A = two countries at 100% each) are one column under that view's name. Each column holds the entity's own amount (a fund in full, as the group's allocation table shows it; "-" for none); the last column, in bold, headed with the name on the cover, holds the view's exposure (funds at the view's share), so a row with a fund held in part does not add up to it: 7m by a country and 10m by a fund the group owns half of show 7m, 10m and 12m. With more than 18 entities, those holding nothing in the view are left out. [RPT-310]
5. ESG ratings, in the appendix: "ESG Ratings (i/N)", the ESG Hardcoded E, S, G and ESG scores of each deal the view holds, one row per deal under the deal's name (asset group, else transaction group, else code name; its tranches as one unless their scores differ), in deal order, two tables side by side; Green asset is Yes when the deal has a CBI sector, as the footnote defines it, a blank, "n/a", "None", "No", "Not …" or "Non-…" being no sector. [RPT-311, CALC-234]
6. Prepayment protection, in the appendix: "Prepayment protection (i/N)", a "#" column numbering the rows across pages, one row per instrument in deal order: its protection as the house table words it (the description, Hardcoded › Prepayment protection (2), without the Yes / No of (1); "n/a" when there is none), financial close (else funding date), final maturity, end of protection (Hardcoded › End of NC / MW), dates written 27-Sep-13, the share of its life protected as the workbook works it out, (end − funding date) ÷ (maturity − funding date), and Amortizing or Bullet. Funded 21-Oct-15, maturing 31-Dec-33, protected to 31-Dec-30 gives 83%; "Yes; Make whole at MS + 50 bps" shows "Make whole at MS + 50 bps". [RPT-312, CALC-233]
7. Eligible for the make-whole fee: No with "Floating" for a floating instrument, "Denomination in GBP" (and so on) for a currency other than the euro, "WAL at acquisition <8" when the current WAL plus the years since funding is under 8, checked in that order; otherwise Yes with "-". [RPT-313]
   **Scope's choice:** these three tests are read from your deck's reasons, and the WAL at acquisition is estimated as the current WAL plus the years since funding (exact for a bullet loan, an estimate for an amortising one).

## 10. The analysis pack, the pack designer and templates

What goes in: the same view result as the investor deck (with the picked sectors), the previous Holdings result, optionally your firm template (.pptx) and your style (colours and fonts). What comes out: the analysis pack (a fixed ten-part deck), or a pack you lay out yourself in the pack designer, and, for every deck, the rules for building on your template: which slide is used for what, which boxes get which text, how text is fitted, and which colours and fonts are used.

### 10.1 Reading your template

1. The template is a .pptx loaded on Investor reporting, saved in this browser and never sent anywhere. Loading shows "Template kept: <file> (n page(s), m box(es) marked x)", or "Could not read the template: <reason>".
2. A file with no presentation part is refused ("not a PowerPoint file (.pptx)"); a presentation with no slides is refused ("the template has no slide"). [RPT-004, RPT-005]
3. A slide with no layout, a layout with no master, a master with no theme, or a slide with no shapes stops the read with an error naming the problem. [RPT-006]
4. Only the first six slides are read; the rest are ignored, and only the first three are ever used. [RPT-003]
5. With three or more slides, slide 1 is used for the cover, slide 2 for every section break and slide 3 for every content page. With two, slide 1 is both cover and section break and slide 2 the content page. With one, that slide is used for every page. [RPT-001, RPT-002]
6. Pictures used by the template slides, layouts and masters are copied into the deck, so logos and bands come through; links to outside web addresses are kept. [RPT-007, RPT-008]
7. Everything else the template refers to (notes, tags, embedded objects, charts, pictures linked to a file elsewhere) is dropped, with any shape that uses it, and counted. [RPT-009, RPT-011]
8. A slide or layout background that uses something dropped is removed (the master's background shows). [RPT-012]
9. Custom data tags and animations are removed. [RPT-010]
10. A PowerPoint text box on a template slide with no text of its own (only its "Click to add" prompt) is left out and counted. The page reports the total: "n empty placeholder(s) or linked object(s) left out". [RPT-013]
11. Template shapes are renumbered from 1000 so they never clash with Scope's own. [RPT-014]
12. A shape's position is its own; else that of the layout's matching built-in box (same number, then same kind); else the master's. [RPT-015]
13. Each master keeps only the layouts the three pages use. [RPT-043]
14. A template kept by an earlier version (its summary lacks the theme colours, heading font or title font) is read again once, so the page shows what the current version finds. [RPT-291]

### 10.2 Finding the boxes Scope fills ("x" boxes)

1. A text box whose whole text is x, xx or xxx (any capitals), optionally in quotes or brackets or with trailing punctuation, is a box Scope fills: "“X”", "[x]", "XX", "x:" count; "xxxx" and "box" do not. [RPT-017]
2. A line of at most 90 characters holding exactly one stand-alone x (xx, xxx; quoted or not; not touching letters, digits or . _ / @ -) is filled in place: only the x is replaced, the words around it stay ("REPORTING AS OF “X”"). A 120-character disclaimer containing " x " is left alone. [RPT-019]
3. A line with two or more stand-alone x is not filled ("x – x" stays). [RPT-020]
4. A box whose whole text is {name}, {date}, {number}, {title}, {subtitle}, {kicker} or {source} (any capitals) is the box for that text outright; any other word in braces, such as {logo}, gives a box that is emptied. [RPT-018]
5. x boxes inside grouped shapes are found, their place on the page worked out from the group's position and scale. [RPT-021]
6. An x box whose position cannot be found on itself, its layout or its master is not used and stays as the template has it. [RPT-022]
7. A box's font size is the first size set in the box; else, for PowerPoint's built-in boxes, the layout's or master's size for that box, else the master's text style for its kind (titles the title style; body, subtitle, object and untyped boxes the body style; others the other style); else unknown. An x typed at 96 pt is 96; a title box with no size takes the master's title size, e.g. 32 pt. [RPT-024, RPT-016]
8. Boxes are ordered top to bottom; two whose tops are within 0.38 cm count as one row and go left to right. [RPT-023]

### 10.3 The content page's free area

1. Footer shapes are the content slide's own shapes other than x boxes, the layout's ordinary shapes and its footer, slide-number and date boxes, and the master's too unless the layout or slide hides master shapes. [RPT-027]
2. The area for exhibits starts 0.30 cm below the lowest bottom edge of the x boxes in the top 45% of the page, and at least 0.46 cm below a line under the title (on the slide, its layout or master, at least 30% of the slide wide); with no x box there it starts at 3.43 cm. [RPT-025]
3. It ends at the highest of: 1.14 cm above the page bottom, 0.25 cm above any footer shape in the bottom 30% of the page, 0.15 cm above any x box there. [RPT-026]
4. It starts at the left edge of the leftmost top x box (at least 0.64 cm; 1.27 cm when there is none) and keeps the same margin on the right. [RPT-028]
5. It is never less than 2.54 cm tall, even if it then overlaps the footer. [RPT-029]
6. Without a template, exhibits go in the area 1.27 cm from the left, 3.35 cm from the top, 31.32 × 14.10 cm. [RPT-111]
7. The Investor reporting page shows each template slide: what it is used for, its layout, the boxes Scope fills (and any x inside a line), and for the content page where exhibits go (in inches). [RPT-289]

### 10.4 Which x box gets which text

1. An x in PowerPoint's built-in title box (or centred title) is the title (on the cover, the name); on the cover an x in the built-in subtitle box is the date. [RPT-030]
2. Cover: x boxes not yet given a role take name, then date, top to bottom; further x boxes get none. [RPT-031]
3. Section break, when every remaining x box has a known font size (and the title box's size is known, if there is one): roles go by size, largest first. [RPT-032]
   - Title known from a built-in title box: a box more than 1.15 times the title's size is the number (the first such only); the next other box is the lines; further boxes get nothing. [RPT-033]
   - No title known, three or more sized boxes: the largest is the number, then the title, then the lines; further boxes get nothing (96, 40 and 18 pt give number, title, lines). [RPT-034]
   - Two sized boxes: if the smaller is 28 pt or more they are number and title, otherwise title and lines. [RPT-035]
   - One sized box: the title; the number is then not shown. [RPT-036]
4. Section break with a size unknown: one x box is the title; two or more are number, title, lines from top to bottom. [RPT-037]
5. Content page: x boxes in the top 45% of the page take kicker then title, top to bottom; if only one is left there and the title is not yet placed, it is the title (no kicker). [RPT-038, RPT-039]
6. An x box in the bottom 30% of the content page takes the source line; x boxes in the middle of the page get nothing. [RPT-040]
7. An x box that gets no role, or whose role has nothing to say on that page, is emptied rather than left showing x (a third x on the cover; the section lines on "01 Market activity", which has none). [RPT-041]
8. The page warns which boxes a slide is missing (cover: name, date; section: number, title, lines; content: title) and what happens: a missing content-page box is "written at the top of the page by Scope"; a missing cover or section box is "left as the template has it". [RPT-289, RPT-290]

### 10.5 Filling the boxes

1. Each generated slide is a copy of its template slide (its shapes in their order, x boxes filled) with Scope's own shapes added on top. [RPT-042]
2. A filled box takes the paragraph formatting of its first paragraph and the text formatting of the run holding the x (else the first run); each line of the value becomes a paragraph. An x set in 40 pt bold white gives "INVESTOR X" in 40 pt bold white. [RPT-046]
3. An x inside a line: the value's line breaks become spaces; words the value repeats from just before or just after the x are said once, capitals aside ("REPORTING AS OF “X”" with "REPORTING AS OF 30 SEPTEMBER 2026" gives it once). [RPT-048, RPT-047]

### 10.6 Fitting text in a box

1. Nothing changes when the estimated text height is at most 1.05 × the box height. [RPT-052]
2. Width estimate: each character is half its font size wide (0.42 for narrow, condensed or compressed typefaces), 18% wider when the line has no lower-case letter. [RPT-049]
3. A box whose size is unknown is taken as 18 pt. [RPT-050]
4. A line is 1.2 × the font size (times any line spacing set), and the usable width is the box width less 0.51 cm (at least 1.02 cm). [RPT-051]
5. A box is measured in the font it shows: the Title font of Your style if set, else the font its x is in (its own, its layout's or master's; a theme reference read as the theme's font), else the deck font. [RPT-056]
6. A one-line value (title, number, name) that would wrap and overflow is shrunk to fit on one line (PowerPoint's shrink-on-overflow, scale written in). [RPT-053]
7. Several lines taller than the box: the text is set to start at the top and the box grows downward as far as 1.52 cm above the page bottom (a box inside a group does not grow); what still does not fit is shrunk. [RPT-054]
8. Text is never shrunk below 50%, even if it then still overflows. [RPT-055]

### 10.7 Fonts and slide size

1. The template's body font is its theme's minor Latin font (Arial if none); its heading font the theme's major Latin font, else the body font. [RPT-079]
2. Text Scope writes uses the font typed under Your style, else the template's body font, else Arial. [RPT-078]
3. Page titles use the title font typed under Your style; on a template with none, the title box keeps the font its x is in (its own, else its layout's or master's title font), and a title Scope draws on a template page without a title box gets that font (the theme's heading font if the x names none); without a template, the deck font. [RPT-080]
4. The deck takes the template's slide size and default text style; Scope's drawing, laid out on a 33.87 × 19.05 cm page, is scaled to that size (a 4:3 template at 25.4 cm wide puts every exhibit at 75% width). [RPT-044, RPT-045]

### 10.8 Colours

1. In a template with several masters, colours and fonts come from the theme of the master the content page uses. [RPT-061]
2. The theme's dk1, lt1, dk2, lt2, accent 1 to 6 and hyperlink colours are read as RRGGBB (an explicit colour, or a system colour's last value). [RPT-060]
3. They are used in PowerPoint's picker order: Background 1 (lt1), Text 1 (dk1), Background 2 (lt2), Text 2 (dk2), Accent 1 to 6; and only if all ten can be read, otherwise the house theme is used. [RPT-059, RPT-058]
4. The house theme (no template, no style): Background 1 FFFFFF, Text 1 1D1D1B, Background 2 0F7164, Text 2 00A76C, accents 00A2A3, 8ACBBB, 939FA6, 17596F, C3454B, F1885A. [RPT-057]
5. Each colour has five shades as the picker lists them: white darker 5/15/25/35/50%; a very light colour (lightness above 0.8) darker 10/25/50/75/90%; black lighter 50/35/25/15/5%; a very dark colour (lightness below 0.2) lighter 90/75/50/25/10%; any other lighter 80/60/40% then darker 25/50%; each channel rounded down as PowerPoint does (8ACBBB gives E7F4F1, D0EAE3, B8DFD6, 4EB098, 347665). [RPT-062, RPT-063]
6. A theme is treated like the house theme when both Background 2 and Text 2 are coloured (saturation above 0.3, lightness between 0.1 and 0.7); otherwise Accent 1 leads. [RPT-064]
7. House-like theme: headings, first series, header bars and table headers Background 2; the AuM banner, the portfolio split box, the key-figure bars, the unfunded-table heading and the monitoring impact line Accent 1; bright series Text 2; internal ratings Accent 4; pale first colour Accent 2; tint (boxes, totals rows) Accent 2 lighter 80%; second series Accent 3; accent / third series Accent 5 lighter 40%; light accent Accent 5 lighter 80%; red Accent 5; amber Accent 6; text Text 1; labels Text 1 lighter 25%; muted (source line, captions) Background 1 darker 50%; rules darker 25%; tile borders darker 15%; table banding darker 5%; countries with no exposure Text 1 lighter 75%. Many-slice charts cycle Background 2, Accent 2, Accent 4, Text 2, Accent 3, Accent 1, then shades of those (greens, teals, blues before greys), Accent 6 and Accent 5 last; the map runs Background 2 darker 50%, darker 25%, main, then Accent 2 darker 25%, main, lighter 40%, lighter 60%. [RPT-065, RPT-066, RPT-067, RPT-068, RPT-069]
8. Any other theme: headings and first series Accent 1; header bars Accent 1 darker 50%; banners darker 25%; pale colour lighter 60%; tint lighter 80%; bright series Accent 6; second series Accent 2; accent Accent 3; internal ratings Accent 1; text and labels Text 1; map grey Background 1 darker 25%. Many slices cycle Accent 1 to 6, then their darker-25%, lighter-40% and darker-50% shades; the map's countries take Accents 1 to 6 in turn, largest first. [RPT-070, RPT-071]
9. A sector's subsectors take the other shades of the sector colour's theme column, in order darker 25%, main, darker 50%, lighter 40%, 60%, 80%, skipping the sector's own shade and any of those lighter shades whose saturation is 0.6 or more. [RPT-075]
10. Bubble series take Accent 1 to 6, then their darker-25% shades, then their lighter-60% shades. [RPT-077]
11. Charts with several series (analysis pack, designer) use, in order: first series, second series, accent, pale first, bright, light accent, tint. [RPT-076]
12. Your style can set: headings / first series, header bars, banners, second series, bright series, accent, pale first colour, tint, text, labels, source line / captions, rules, table banding, tile borders, internal ratings, map no-exposure grey. Each set colour (RRGGBB, with or without #) replaces the theme's for that part; malformed entries are ignored. [RPT-073, RPT-072]
13. A style with nothing set is stored as no style (house look, or the template theme). [RPT-296]
14. "Use the template's theme colours" fills every style part from the template theme by the mapping above, keeps your style font, else takes the template's body font. [RPT-074, RPT-297]
15. "Text Scope draws on it" defaults to dark (for a light template background). When light, Scope's text is white, labels E6E8EA, muted D0D4D7, headings B9DCCF and rules 8A9499. In the investor deck, the analysis pack and the pack designer this takes effect only when a template is loaded. [RPT-286, RPT-081, RPT-082]
16. Without a template, the file's own theme (used if you recolour the deck in PowerPoint) is Scope's fixed theme: text 1F2937, accents 3A6FD8, 9DB7EE, 1B2A4A, 2E7D4F, C8963E, 8A94A6; Scope's shapes carry their colours explicitly, so the deck looks the same. [RPT-084]

### 10.9 Cover, section and content pages, with and without a template

1. Cover on a template: only its name and date boxes are filled; a missing box is not drawn and nothing else is added. Without a template: the name in 38 pt bold and the date line in capitals in a green band. [RPT-095, RPT-096]
2. Section break on a template: its number, title and lines boxes are filled (lines one per paragraph); nothing else is drawn. Without a template: a full green page, the number in 110 pt pale green, the title in 46 pt white capitals, the lines in 17 pt white. [RPT-098, RPT-099]
3. Content page with a title box but no kicker box: the kicker is drawn above the title box, lined up with the title text, 1.07 cm above the box, at 10 pt in bold capitals in the heading colour. [RPT-107]
4. Content page with no title box: the kicker is drawn in 9.5 pt bold capitals and the title in 24 pt above the free area (house page: at 0.61 and 1.32 cm from the top, a rule at 2.95 cm). [RPT-108]
5. With no source box, the source line is drawn 7 pt right-aligned at the bottom of the free area, which shrinks by 0.66 cm; a page with an empty source has none. [RPT-109]
6. A page number is drawn bottom left only without a template (a template brings its own slide-number field). [RPT-110]

### 10.10 The analysis pack: page frame

The analysis pack ("Analysis pack" button) uses the house kit's page frame, which differs from the investor deck's content page:

1. Every page's source line is "Source: Holdings as of DD/MM/YYYY; Scope calculation", with " · n filter(s) applied" when global filters apply; on a template it goes in the source box if there is one. [RPT-248]
2. Without a title box, each page shows its title top left (20 pt) and "<view> · <quarter> · <ccy> m" top right; on a template, the kicker box takes "<view> · <quarter>" and the title box the page title. A one-line message sits under the title, then a thin rule. [RPT-249]
3. Pages with no template boxes carry a page number bottom left. [RPT-250]
4. On a template the cover is built on the template's cover slide with its x boxes emptied, and the pack's own cover text drawn over it; a source line is also drawn at the foot of the cover. [RPT-230]
5. **Scope's choice:** on a template the analysis pack's charts and tables keep their fixed house positions (scaled to the template's size); they are not fitted into the template's free area as the investor deck's are.
6. Captions read "Figure n – <text>", numbered through the deck. [RPT-251]

### 10.11 The analysis pack, slide by slide

1. Slides: cover, key figures, sector and country, credit quality, maturity profile, top 10 assets, changes since the previous Holdings, watchlist and covenants, the asset list (as many slides as needed), notes and sources. Its cover shows the view name (not the cover name input). [RPT-226]
2. Change against the previous Holdings on a tile: (current − previous) / |previous| as "+x.x% vs previous", green when zero or more, red when negative; none if the previous is 0 or missing. [RPT-228]
3. Cover tiles: Exposure (one decimal, its change, else the asset count), Drawn (% of exposure), Weighted rating (IG % = 1 − sub-IG − NR, and NR %), Remaining life (years, with the weighted spread). [RPT-229]
4. Key figures message: "<exposure>m across <n> assets; <x%> drawn; largest sector <name> (<share>)." [RPT-231]
5. Eight tiles: Exposure, Drawn (change, else % of exposure), Undrawn (% of exposure), Commitment, Assets (change in count, else positions), Weighted rating (sub-IG and NR %), Remaining life (WAL), Weighted spread (fixed rate share). [RPT-232]
6. The drawn/undrawn doughnut uses total drawn and undrawn, undrawn floored at 0. [RPT-233]
7. Where a list is cut to n, it shows the first n − 1 and one "Other (k)" for the rest; zero buckets dropped. The currency table shows the top 6; sector and country bars the top 8. [RPT-234, RPT-235, RPT-236]
8. Credit quality: exposure by current rating, the IG / sub-IG / NR doughnut and table, message "Weighted rating X; investment grade y% of exposure, not rated z%." [RPT-237]
9. Maturity by year: the first 12 years, then "Later (k)", then "Unknown" (no maturity date) last. [RPT-238]
10. Top 10: the first ten rows of the result (largest first), with "Top 10" and "Portfolio" total rows; names cut to 38 characters with "…". [RPT-239]
    **Scope's choice:** the analysis pack names assets by their Holdings name, where the investor deck uses the code name.
11. Changes: assets in the current but not the previous Holdings (by asset ID) are added, the reverse exited; the largest movements are the 8 existing assets with the largest absolute change in exposure. Without a previous Holdings the page explains how to load one. [RPT-240, RPT-241]
12. An asset is on the watchlist by the calculation's watchlist rule; failing that, any value other than blank, no, n, none, - or 0. The table lists up to 14, then "+ n more on the asset list"; "intensive" values in red, others amber. [RPT-242, RPT-243]
13. Asset list: up to 17 assets on one slide; more are spread evenly over slides of at most 15 (31 gives 11, 11, 9). [RPT-244]
14. Notes: the view is "every investor column", "the <Group> ownership of each investor column", "the investor column <view>" or its formula; the group is called by the configured attribution label, else "Group". [RPT-245, RPT-253]
15. FX: each non-EUR rate as "<CCY> <rate to 4 decimals> per EUR", else "All positions in EUR." [RPT-246]
16. Ratings: current rating = internal rating, else the worst external; weighted by exposure on the workbook's numeric scale; sub-IG above the IG threshold. [RPT-247]
17. The file is "<view>-quarterly-report-<quarter>.pptx" (reporting date when there is no quarter). [RPT-227]

### 10.12 The pack designer

1. Blocks sit on a 24 × 12 grid over the body of the page (1.27 cm from the left, 3.68 cm from the top, 31.33 × 13.97 cm); on a template, over the content page's free area. [RPT-254]
2. A block's position and size are rounded to whole cells, kept within the grid and at least its type's minimum size (a chart resized to 3 × 2 becomes 6 × 4). [RPT-255]
3. New blocks start with their type's defaults: chart sector bars top 8; table country top 8; asset table top 10 with #, Asset, Sector, Country, Rating, Maturity, Exposure, Drawn, Share; investor table top 12; changes top 8. [RPT-256]
4. Charts and tables can use every dimension of the calculation plus "Group vs other investors". [RPT-275]
5. A KPI tile shows its chosen figure; an unknown one shows Exposure. "Investment grade" is 1 − sub-IG − not rated. With a previous Holdings, amount tiles (figures in millions) show "+x.x% vs previous" in green or red instead of their usual line. [RPT-257, RPT-258, RPT-259]
6. Top n of 0 shows every item; otherwise the first n − 1 plus "Other (k)". [RPT-260]
7. A chart is a doughnut (series colours, legend right), columns or bars (first series colour); its caption reads "exposure by <dimension>", adding ", top n with the rest grouped" when cut. [RPT-262, RPT-261]
8. Asset table: the first n rows (largest first, default 10) with the chosen columns, titled "All n assets" or "Largest n assets · <ccy> m". [RPT-263]
9. Asset card: the chosen asset (else the largest), each chosen detail: amounts one decimal "m", years "x.x y", spread "x bps", rating "NR" if not rated, empty "–". [RPT-264]
10. Investor table: investor columns with a positive amount in the view, largest first, top 12; Share is of the listed total only. [RPT-265]
11. Group split: group attributed against other investors, first and third series colours. [RPT-266]
12. Changes: existing assets with the largest absolute change in exposure (default 8); without a previous Holdings it explains how to load one. [RPT-267]
13. Text: each non-empty line a paragraph. [RPT-268]
14. A table block shows as many rows as fit (0.69 cm each, header included), then "+ n more". [RPT-269]
15. A page marked as cover shows its message (default "Quarterly report"), its title (default the view name) and "<quarter> · reporting date DD/MM/YYYY · amounts in <ccy> millions". [RPT-270]
16. The deck uses the template theme (or house) with your style over it. [RPT-272]
17. A block that fails is replaced by a red line "<block type>: <error>" instead of stopping the deck. [RPT-271]
18. The file is "<view>-<layout name or custom-pack>-<quarter>.pptx". [RPT-273]
19. The standard layout to start from has nine pages: cover with four KPI tiles, key figures, sector and country, credit quality, maturity, top 10, changes, watchlist and covenants, notes. Layouts are saved in this browser and can be exported as a small file. [RPT-274]

### 10.13 Charts as written into PowerPoint

1. Every chart is a native PowerPoint chart with its numbers in an embedded sheet (Edit Data opens them).
2. Bar and column charts hide the value axis and set its top 10% (columns) or 18% (bars) above the largest value so labels fit. [RPT-252]
3. Scatter and bubble series are padded to the same length with empty points, because some viewers drop a series shorter than the next. [RPT-189]
