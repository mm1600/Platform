# drive-vc

Version control and safe sharing for any static HTML/JS app whose data lives in a shared folder, such as a Windows network drive or a synced folder. There's no server, no git and nothing to install: it's one file with no dependencies.

- **Save** makes a version: who, when, a note, and exactly what changed.
- **Polling:** every open copy polls one tiny file. When someone saves, the others see a bar that says "Newer version v13 saved by Sam at 14:05", with **Refresh** and **What changed** buttons.
- **No double saves:** a lock file lets only one save land at a time.
- **Merging:** if someone saved while you were editing, your changes merge onto theirs field by field. It only asks you when you both changed the same field.
- **History** works like GitHub without git:
  - every version, and what each changed;
  - compare any two versions;
  - **View** an old version, read-only;
  - **Restore** one (as a new version, so nothing is erased);
  - **Tag** one ("Q3 sign-off").

| File | What it is |
|---|---|
| `drive-vc.js` | The engine: about 500 lines, no DOM. Works in a browser and in Node. |
| `drive-vc-ui.js` | Optional: a ready-made bar and dialogs (connect, Save, History, merge). |
| `demo.html` | A tiny app using both. Open `demo.html?two` to try it with two people in one page. |
| `test.js` | `node test.js`: 14 tests. Several users share one folder, including on a slow share and with saves at the same moment. |

## Use it in an app

1. Load the files:

   ```html
   <script src="drive-vc.js"></script>
   <script src="drive-vc-ui.js"></script>
   ```

2. Hand over your data and take versions back:

   ```js
   const vc = DriveVC.ui({
     appId: 'my-app',
     getState: () => structuredClone(myData),         // the shared data, as one JSON object
     setState: (s) => { myData = s; saveLocally(); redraw(); },
   });
   ```

3. After every change to your data, call `vc.touch()`. This keeps the "3 unsaved" count up to date.

What you put in `getState` is shared. Keep personal things out of it, such as filters, layouts and the current page.

**Your own UI instead of the bar:** use the engine directly:

```js
const repo = DriveVC.open({ store: DriveVC.folder(dirHandle), appId, user: 'Sam', getState, setState });
await repo.connect();               // repo.status() → { empty, needsLoad, ready, version, head, behind, unsaved, preview, conflicts, … }
repo.subscribe((st) => draw(st));   // st.behind → show "Newer version by st.head.by"
await repo.init('First version');   // empty folder
await repo.load();                  // first time on this computer
await repo.save('note');            // → { ok, version } or { conflicts }
await repo.refresh();               // → { ok } or { conflicts }
await repo.resolve({ [conflict.k]: 'mine' });  // the default is 'theirs'
await repo.history();               // newest first: { v, id, by, at, note, n, tags }
await repo.changesIn(id); await repo.compare(idA, idB);   // [{ p, b, a }]; DriveVC.describe(change) puts one into words
await repo.preview(id); await repo.endPreview();          // look at an old version, read-only
await repo.restore(id); await repo.tag(id, 'Q3 sign-off');
```

Folder helpers:
- `DriveVC.supported()`
- `DriveVC.pickFolder(appId)`
- `DriveVC.savedFolder(appId)`
- `DriveVC.permission(dir, ask)`

## Rules for your data

- **Merging:** plain objects merge field by field. Anything else (text, numbers, arrays) is one value.
- **Lists with ids:** arrays whose items all have an `id` merge item by item. If two people both add rows, both rows are kept.
- **Fresh objects:** `getState` must return a fresh object each time.
- **Large values:** a sheet or a file as base64, longer than `blobOver` (20,000 characters of JSON), is stored once in `blobs/` however many versions use it. Your app may share these with `getState`, as long as it replaces them and never edits them in place.

## What it writes in the folder

```
repo.json, head.json (the latest version; this is what gets polled), lock.json, tags.json
history/index.json                 quick list of versions
history/000014-k3x9q.json          one file per version: its parent, who, when, note, changes (a full copy every 10 versions)
blobs/<hash>.json                  large values, stored once
```

- **Nothing is overwritten except the small pointer files.** A version file is never changed once written.
- **Lost race:** if a very slow share ever let two saves through at once, the one that lost comes back as unsaved changes on that person's next Refresh. It is never dropped.

## Needs

- **Edge or Chrome to write to a folder.** It uses the File System Access API, which also works when the page is opened as a file.
- **One-time setup:** each person picks the folder once. After that it's reconnected with one click per visit, or none if the browser offers "Allow on every visit".
- **Other browsers:** Firefox and Safari can't write to a folder. `DriveVC.memory()` is an in-memory folder for tests and demos.

## Options

| Option | Default | |
|---|---|---|
| `pollMs` | 20000 | How often open copies check for a newer version (also checked on focus and when the tab is shown again) |
| `snapshotEvery` | 10 | A full copy every N versions, so reading an old version stays quick |
| `blobOver` | 20000 | Values with longer JSON than this are stored once in `blobs/` |
| `settleMs` / `verifyMs` | 800 / 1000 | Lock and after-save checks; raise them on a very slow share |
| `staleMs` | 30000 | A lock left unchanged this long, e.g. by a crashed PC, is taken over |

## Where it lives

- **This folder is the library.** It is published as `drive-vc/` in the Platform repository, next to Scope.
- **Scope's copy:** Scope uses an identical copy of `drive-vc.js` at `js/core/drive-vc.js`. Change the library here first, then copy the file over.
