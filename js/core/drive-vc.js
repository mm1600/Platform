/* drive-vc: version control for a static HTML/JS app whose data sits in a shared folder (a Windows share, a synced
 * drive). No server, no git, nothing to install: one file, no dependencies.
 *
 * The app hands over its shared data as one JSON object (getState) and takes a version back (setState). Each Save writes
 * a new version file that is never changed again and names its parent, so the folder holds the whole history like git
 * commits; head.json points at the latest one and is the only file the open copies poll. A lock file stops two saves
 * landing at once. A save that finds someone saved first merges both sets of changes field by field (three-way), and
 * asks only when both people changed the same field.
 *
 * Folder layout:
 *   repo.json            { repo, app, created }                    written once
 *   head.json            { v, id, by, at, note }                   the latest version (polled)
 *   lock.json            { free } or { by, tok, at }               who is saving right now
 *   tags.json            { name: { v, id, by, at } }               named versions
 *   history/index.json   [{ v, id, parent, by, at, note, n, paths }]  quick list (repaired from the chain when behind)
 *   history/<id>.json    { v, id, parent, by, at, note, changes: [{ p, b, a }], state? }   never changed once written
 *   blobs/<hash>.json    a large value (a sheet, a file), stored once however many versions use it
 *
 * State rules: plain objects are compared field by field (path = list of keys); anything else (text, numbers, arrays)
 * is one value. Arrays whose items all carry an `id` merge item by item (two people adding rows both keep theirs).
 * getState must return a fresh object each call; large values (over blobOver characters as JSON) may be shared with
 * the app as long as the app replaces them rather than editing them in place.
 *
 * Browsers: a real folder needs the File System Access API (Edge, Chrome; it works from file:// too). Any other store
 * works through the same calls (read, write, has), e.g. DriveVC.memory() for tests and demos.
 *
 *   const repo = DriveVC.open({ store: DriveVC.folder(dirHandle), appId: 'my-app', user: 'Sam',
 *                               getState: () => ({ ...myData }), setState: (s) => { myData = s; redraw(); } });
 *   await repo.connect();   // then: repo.save(note), repo.refresh(), repo.history(), repo.restore(v), repo.tag(v, name)
 */
(function (root) {
  'use strict';

  // ---------- small helpers ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const now = () => new Date().toISOString();
  const rand = (n) => { let s = ''; while (s.length < n) s += Math.random().toString(36).slice(2); return s.slice(0, n); };
  const pad = (n) => String(n).padStart(6, '0');
  const isObj = (v) => Object.prototype.toString.call(v) === '[object Object]';
  const KEY = (p) => JSON.stringify(p);
  const below = (k) => k.slice(0, -1) + ','; // every key under path k starts with this
  /** A fast 64-bit text hash (cyrb53 pair) plus the length: names a blob by its content. */
  function hash(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0') + '-' + str.length.toString(36);
  }

  // ---------- state as a flat list of paths ----------
  /** { a: { b: 1 }, c: [2] } → Map('["a","b"]' → 1, '["c"]' → [2]). Empty objects are kept as values. */
  function flatten(v, p, out) {
    p = p || []; out = out || new Map();
    if (isObj(v) && Object.keys(v).length) { for (const k of Object.keys(v)) if (v[k] !== undefined) flatten(v[k], p.concat(k), out); }
    else if (v !== undefined) out.set(KEY(p), v);
    return out;
  }
  /** The reverse of flatten, from path → JSON text; `reuse` (path → { j, v }) hands back objects the app already holds when unchanged. */
  function unflatten(ser, reuse) {
    let top = {};
    for (const [k, j] of ser) {
      const r = reuse && reuse.get(k), p = JSON.parse(k), v = r && r.j === j ? r.v : JSON.parse(j);
      if (!p.length) return v;
      let o = top; for (let i = 0; i < p.length - 1; i++) { if (!isObj(o[p[i]])) o[p[i]] = {}; o = o[p[i]]; }
      o[p[p.length - 1]] = v;
    }
    return top;
  }
  /** The value at path k (a leaf, or the object built from the paths under it) as JSON text; undefined when absent. */
  function valAt(ser, k) {
    if (ser.has(k)) return ser.get(k);
    const pre = below(k), n = JSON.parse(k).length, sub = new Map();
    for (const [x, j] of ser) if (x.startsWith(pre)) sub.set(KEY(JSON.parse(x).slice(n)), j);
    return sub.size ? JSON.stringify(unflatten(sub)) : undefined;
  }
  /** Put JSON value j at path k (undefined removes it), clearing whatever was under or above it. */
  function putAt(ser, k, j) {
    const pre = below(k), p = JSON.parse(k);
    if (j !== undefined && ser.has(k) && !(isObj(JSON.parse(j)) && j !== '{}')) { ser.set(k, j); return; } // a value for a value: keep its place
    for (const x of Array.from(ser.keys())) if (x === k || x.startsWith(pre)) ser.delete(x);
    for (let i = 0; i < p.length; i++) ser.delete(KEY(p.slice(0, i)));
    if (j !== undefined) for (const [x, v] of flatten(JSON.parse(j), p)) ser.set(x, JSON.stringify(v));
  }
  /** Changes from map a to map b: [{ k, b, a }] where b/a are JSON text (undefined = not there). */
  function changesBetween(a, b) {
    const out = [];
    for (const [k, j] of a) { if (!b.has(k)) out.push({ k, b: j }); else if (b.get(k) !== j) out.push({ k, b: j, a: b.get(k) }); }
    for (const [k, j] of b) if (!a.has(k)) out.push({ k, a: j });
    return out;
  }

  /** A change worth showing: not an empty {} appearing or going (a group that gained its first field or lost its last). */
  const real = (c) => !((c.b === '{}' && c.a === undefined) || (c.a === '{}' && c.b === undefined));

  // ---------- three-way merge ----------
  const ided = (arr) => Array.isArray(arr) && arr.every((x) => isObj(x) && (typeof x.id === 'string' || typeof x.id === 'number')) && new Set(arr.map((x) => x.id)).size === arr.length;
  /** Merge arrays of { id } items: the other side's list, plus my additions, minus my removals, with my edits; null when both changed one item. */
  function mergeArray(b, l, r) {
    if (![b, l, r].every(ided)) return null;
    const by = (arr) => new Map(arr.map((x) => [x.id, JSON.stringify(x)]));
    const B = by(b), L = by(l), R = by(r), out = new Map(R);
    for (const [id, lj] of L) {
      const bj = B.get(id), rj = R.get(id);
      if (bj === lj) continue;                              // not changed by me
      if (rj === undefined && bj !== undefined) return null; // I edited what they removed
      if (rj === undefined || rj === bj || rj === lj) out.set(id, lj); else return null;
    }
    for (const [id, bj] of B) if (!L.has(id) && R.has(id)) { if (R.get(id) !== bj) return null; out.delete(id); } // I removed it
    return JSON.stringify(Array.from(out.values()).map((j) => JSON.parse(j)));
  }
  /**
   * Merge my changes (base → mine) onto theirs. Returns { merged, conflicts: [{ k, p, base, mine, theirs }] }; a
   * conflict means both changed the same field to different values (the merged map keeps theirs until resolved).
   */
  function merge3(base, mine, theirs) {
    const merged = new Map(theirs), conflicts = [], seen = new Set();
    const inner = new Set(); for (const k of theirs.keys()) { const p = JSON.parse(k); for (let i = 0; i < p.length; i++) inner.add(KEY(p.slice(0, i))); }
    // a value (not an empty {}) above path k in the merge so far: they turned a group into a single value
    const leafAbove = (k) => { const p = JSON.parse(k); for (let i = 0; i < p.length; i++) { const j = merged.get(KEY(p.slice(0, i))); if (j !== undefined && j !== '{}') return true; } return false; };
    for (const c of changesBetween(base, mine)) { // removals and edits come first, so a group I emptied is gone before I add to it
      const r = theirs.get(c.k), b = c.b, m = c.a;
      if (r === m) continue;                                                      // both made the same change
      if (r === b && !inner.has(c.k) && !leafAbove(c.k)) { putAt(merged, c.k, m); continue; } // only I changed it
      if (b !== undefined && m !== undefined && r !== undefined) {                // both changed a list of { id } items
        const j = mergeArray(JSON.parse(b), JSON.parse(m), JSON.parse(r)); if (j !== null) { merged.set(c.k, j); continue; }
      }
      if (b === undefined && m !== undefined && r !== undefined && ided(JSON.parse(m)) && ided(JSON.parse(r))) {
        const j = mergeArray([], JSON.parse(m), JSON.parse(r)); if (j !== null) { merged.set(c.k, j); continue; }
      }
      if (seen.has(c.k)) continue; seen.add(c.k);
      conflicts.push({ k: c.k, p: JSON.parse(c.k), base: b, mine: valAt(mine, c.k), theirs: valAt(theirs, c.k) });
    }
    return { merged, conflicts };
  }

  // ---------- stores ----------
  /** A folder picked with showDirectoryPicker (File System Access API). Names may contain "/" for subfolders. */
  function folder(dir) {
    const missing = (e) => e && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError');
    async function at(name, create) { const parts = name.split('/'); let d = dir; for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create }); return { d, f: parts[parts.length - 1] }; }
    return {
      name: dir.name,
      async read(name) { try { const { d, f } = await at(name, false); return await (await (await d.getFileHandle(f)).getFile()).text(); } catch (e) { if (missing(e)) return null; throw e; } },
      async write(name, text) { const { d, f } = await at(name, true); const w = await (await d.getFileHandle(f, { create: true })).createWritable(); await w.write(text); await w.close(); },
      async has(name) { try { const { d, f } = await at(name, false); await d.getFileHandle(f); return true; } catch (e) { if (missing(e)) return false; throw e; } },
    };
  }
  /** An in-memory folder for tests and demos; `lag` (ms) delays each read and write by up to that much, like a slow share. */
  function memory(opts) {
    const files = new Map(), lag = (opts && opts.lag) || 0, wait = () => (lag ? sleep(Math.random() * lag) : Promise.resolve());
    return { name: (opts && opts.name) || 'memory', files, async read(n) { const v = files.has(n) ? files.get(n) : null; await wait(); return v; }, async write(n, t) { await wait(); files.set(n, String(t)); }, async has(n) { return files.has(n); } };
  }
  /** Small key-value cache in this browser (IndexedDB; in memory where that is missing or silent). */
  function localStore(name) {
    const mem = new Map(); let dbp = null;
    const open = () => dbp || (dbp = Promise.race([new Promise((res) => {
      try { if (typeof indexedDB === 'undefined') return res(null); const r = indexedDB.open(name, 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => res(null); r.onblocked = () => res(null); } catch (e) { res(null); }
    }), sleep(2500).then(() => null)]));
    const run = async (mode, fn, dflt) => { const db = await open(); if (!db) return dflt(); return new Promise((res) => { try { const q = fn(db.transaction('kv', mode).objectStore('kv')); q.onsuccess = () => res(q.result); q.onerror = () => res(dflt()); } catch (e) { res(dflt()); } }); };
    return {
      get: (k) => run('readonly', (s) => s.get(k), () => mem.get(k)),
      set: (k, v) => run('readwrite', (s) => s.put(v, k), () => { mem.set(k, v); }),
      del: (k) => run('readwrite', (s) => s.delete(k), () => { mem.delete(k); }),
    };
  }

  // ---------- the repository ----------
  /**
   * Open a shared folder for one app. Options: store (folder or memory), getState, setState(state, info), appId, user
   * (text or function), local (cache, default IndexedDB), pollMs 20000, snapshotEvery 10, blobOver 20000,
   * settleMs 800 / verifyMs 1000 (lock and save checks), staleMs 30000 (a lock unchanged this long is abandoned).
   */
  function open(o) {
    const cfg = Object.assign({ appId: 'app', pollMs: 20000, snapshotEvery: 10, blobOver: 20000, settleMs: 800, verifyMs: 1000, staleMs: 30000, waitMs: 90000 }, o);
    const io = cfg.store, cache = cfg.local || localStore('drive-vc');
    const S = { connected: false, repo: null, head: null, base: null, busy: '', error: '', unsaved: 0, preview: null, pending: null, canWrite: true };
    const listeners = new Set(), versions = new Map(), blobs = new Map(), big = new WeakMap();
    let timer = null, tok = null, touched = 0, recountTimer = null;
    const user = () => String((typeof cfg.user === 'function' ? cfg.user() : cfg.user) || 'someone');
    const emit = () => { const st = api.status(); for (const fn of Array.from(listeners)) { try { fn(st); } catch (e) { console.error(e); } } };

    // files
    async function readJSON(name) {
      for (let i = 0; ; i++) { const t = await io.read(name); if (t === null || t === undefined) return null; try { return JSON.parse(t); } catch (e) { if (i >= 3) throw new Error(`${name} is not readable`); await sleep(150); } } // caught mid-write
    }
    const writeJSON = (name, v) => io.write(name, JSON.stringify(v, null, 1));
    const has = (name) => (io.has ? io.has(name) : io.read(name).then((t) => t !== null));
    async function version(id) { if (!versions.has(id)) { const f = await readJSON(`history/${id}.json`); if (!f) throw new Error(`Version ${id} is missing from the folder`); versions.set(id, f); } return versions.get(id); }
    async function blob(h) { if (!blobs.has(h)) { const t = await io.read(`blobs/${h}.json`); if (t === null) throw new Error(`Stored value ${h} is missing from the folder`); blobs.set(h, t); } return blobs.get(h); }
    /** JSON text → what a version file stores: the value itself, or { $blob } for a large one (written once). */
    async function pack(j) {
      if (j.length <= cfg.blobOver) return JSON.parse(j);
      const h = hash(j); if (!blobs.has(h) && !(await has(`blobs/${h}.json`))) { await io.write(`blobs/${h}.json`, j); await touchLock(); } blobs.set(h, j);
      return { $blob: h };
    }
    const unpack = (v) => (isObj(v) && typeof v.$blob === 'string' && Object.keys(v).length === 1 ? blob(v.$blob) : Promise.resolve(JSON.stringify(v)));
    /** The app's state as path → JSON text (large values are cached by identity, so they are turned to text once). */
    function serialize(state) {
      const out = new Map();
      for (const [k, v] of flatten(state)) {
        if (v && typeof v === 'object' && big.has(v)) { out.set(k, big.get(v)); continue; }
        const j = JSON.stringify(v); if (j === undefined) continue;
        if (j.length > cfg.blobOver && v && typeof v === 'object') big.set(v, j);
        out.set(k, j);
      }
      return out;
    }
    /** The state of a version as path → JSON text: its nearest full copy, then the changes after it. */
    async function stateAt(id) {
      if (S.base && S.base.id === id) return new Map(S.base.ser);
      const chain = []; let cur = id;
      for (;;) { const f = await version(cur); chain.push(f); if (f.state || !f.parent) break; cur = f.parent; }
      const top = chain.pop(), m = new Map();
      if (top.state) for (const [p, v] of top.state) m.set(KEY(p), await unpack(v));
      else for (const c of top.changes) if ('a' in c) m.set(KEY(c.p), await unpack(c.a));
      for (let i = chain.length - 1; i >= 0; i--) for (const c of chain[i].changes) { const k = KEY(c.p); if ('a' in c) m.set(k, await unpack(c.a)); else m.delete(k); }
      return m;
    }
    const baseKey = () => `${cfg.appId}:${S.repo.repo}:base`, stashKey = () => `${cfg.appId}:${S.repo.repo}:stash`;
    const saveBase = () => cache.set(baseKey(), { v: S.base.v, id: S.base.id, ser: Array.from(S.base.ser) });

    // lock: write my token, wait, read it back; mine only if nobody overwrote it meanwhile
    async function lock() {
      const me = rand(10), t0 = Date.now(); let seen = '', seenAt = 0;
      for (;;) {
        if (Date.now() - t0 > cfg.waitMs) throw new Error('The shared folder stayed busy; try again');
        let cur; try { cur = await readJSON('lock.json'); } catch (e) { cur = { tok: '?', by: 'someone' }; }
        if (cur && !cur.free && cur.tok) {
          const sig = JSON.stringify(cur); if (sig !== seen) { seen = sig; seenAt = Date.now(); }
          if (Date.now() - seenAt < cfg.staleMs) { S.busy = `waiting for ${cur.by || 'someone'} to finish saving`; emit(); await sleep(300 + Math.random() * 500); continue; }
          // unchanged for staleMs on this computer's clock: its holder has gone (closed tab, crashed PC), so take it over
        }
        await writeJSON('lock.json', { by: user(), tok: me, at: now() });
        await sleep(cfg.settleMs);
        let back = null; try { back = await readJSON('lock.json'); } catch (e) { back = null; }
        if (back && back.tok === me) { tok = me; touched = Date.now(); return; }
        await sleep(100 + Math.random() * 900);
      }
    }
    async function touchLock() { if (tok && Date.now() - touched > cfg.staleMs / 3) { touched = Date.now(); await writeJSON('lock.json', { by: user(), tok, at: now() }); } }
    async function unlock() { const t = tok; tok = null; if (!t) return; try { const cur = await readJSON('lock.json'); if (cur && cur.tok === t) await writeJSON('lock.json', { free: true, by: user(), at: now() }); } catch (e) { /* the next saver takes it over when stale */ } }
    async function locked(fn) { await lock(); try { return await fn(); } finally { await unlock(); } }

    /** Write a new version on top of `head` that turns state `from` into `to` (both path → JSON text). Call under the lock. */
    async function commit(head, from, to, note, extra) {
      const n = head ? head.v + 1 : 1, id = `${pad(n)}-${rand(5)}`, changes = [];
      for (const c of changesBetween(from, to)) { const e = { p: JSON.parse(c.k) }; if (c.b !== undefined) e.b = await pack(c.b); if (c.a !== undefined) e.a = await pack(c.a); changes.push(e); }
      const file = Object.assign({ v: n, id, parent: head ? head.id : null, by: user(), at: now(), note: note || '' }, extra || {}, { changes });
      if (n === 1 || n % cfg.snapshotEvery === 0) { file.state = []; for (const [k, j] of to) file.state.push([JSON.parse(k), await pack(j)]); }
      await io.write(`history/${id}.json`, JSON.stringify(file)); versions.set(id, file);
      const h = { v: n, id, by: file.by, at: file.at, note: file.note };
      await writeJSON('head.json', h);
      let idx = []; try { idx = (await readJSON('history/index.json')) || []; } catch (e) { idx = []; }
      const shown = changes.filter((c) => real({ b: 'b' in c ? JSON.stringify(c.b) : undefined, a: 'a' in c ? JSON.stringify(c.a) : undefined }));
      idx.push(Object.assign({ v: n, id, parent: file.parent, by: file.by, at: file.at, note: file.note, n: shown.length, paths: shown.slice(0, 12).map((c) => c.p) }, extra || {}));
      await writeJSON('history/index.json', idx);
      return h;
    }
    /** Is version h on the history (reachable from the head)? False when a save on a slow share raced it out. */
    async function onChain(h) {
      let cur = await readJSON('head.json'); if (!cur) return false; S.head = cur;
      let id = cur.id, v = cur.v;
      while (v > h.v) { const f = await version(id); id = f.parent; v = f.v - 1; if (!id) return false; }
      return id === h.id;
    }
    function settle() { if (S.base && !S.preview) S.unsaved = changesBetween(S.base.ser, serialize(cfg.getState())).filter(real).length; }
    /** Large values the app holds now (path → { j, v }): an unchanged sheet keeps its object instead of being parsed again. */
    function held() { const out = new Map(); for (const [k, v] of flatten(cfg.getState())) if (v && typeof v === 'object' && big.has(v)) out.set(k, { j: big.get(v), v }); return out; }
    async function adopt(h, remote, merged) {
      await cfg.setState(unflatten(merged || remote, held()), { version: h.v, by: h.by, at: h.at });
      S.base = { v: h.v, id: h.id, ser: remote }; S.pending = null; await saveBase(); settle(); emit();
    }
    async function busy(label, fn) {
      if (S.busy) throw new Error(`Busy: ${S.busy}`);
      S.busy = label; S.error = ''; emit();
      try { return await fn(); } catch (e) { S.error = e.message || String(e); throw e; } finally { S.busy = ''; settle(); emit(); }
    }
    /** Guard: connected, on a version (ready), not looking at an old one (unless previewOk), no merge waiting. */
    const need = (ready, previewOk) => {
      if (!S.connected) throw new Error('Connect the shared folder first');
      if (ready && !S.base) throw new Error('Load the shared data first');
      if (S.preview && !previewOk) throw new Error('Go back to the latest version first');
      if (S.pending && ready) throw new Error('Finish the merge first: pick yours or theirs for each field both changed');
    };
    /** Ids of the history from the head down to version `down` (inclusive). */
    async function chainFrom(head, down) { const ids = new Map(); let id = head && head.id; while (id) { const f = await version(id); if (f.v < down) break; ids.set(f.v, id); id = f.parent; } return ids; }
    /**
     * Make sure this browser's version is in the history. If a racing save on a slow share pushed it out (the lock
     * normally prevents this), step back to its last ancestor that is in, so its changes count as unsaved again
     * and go back in with the next save: nothing is lost.
     */
    async function keepOnChain(head) {
      let f = await version(S.base.id), ids = await chainFrom(head, f.v);
      if (ids.get(f.v) === S.base.id) return;
      while (f.parent) { f = await version(f.parent); if (!ids.has(f.v)) ids = await chainFrom(head, f.v); if (ids.get(f.v) === f.id) break; }
      S.base = { v: f.v, id: f.id, ser: await stateAt(f.id) }; await saveBase();
    }
    /** Pull the latest version and lay my unsaved changes on top; { conflicts } when both changed the same field. */
    async function pull() {
      const head = await readJSON('head.json'); S.head = head;
      if (!head || head.id === S.base.id) return { ok: true, nothing: true };
      await keepOnChain(head);
      const remote = await stateAt(head.id), r = merge3(S.base.ser, serialize(cfg.getState()), remote);
      if (r.conflicts.length) { S.pending = { head, remote, merged: r.merged, conflicts: r.conflicts }; emit(); return { conflicts: r.conflicts }; }
      await adopt(head, remote, r.merged);
      return { ok: true, version: head.v };
    }

    const api = {
      /** { connected, folder, empty, needsLoad, ready, version, head, behind, unsaved, busy, error, preview, conflicts, canWrite, user } */
      status() {
        const ready = !!(S.connected && S.base);
        return { connected: S.connected, folder: io && io.name, empty: S.connected && !S.repo, needsLoad: S.connected && !!S.repo && !S.base, ready,
          version: S.base ? S.base.v : null, head: S.head, behind: !!(ready && S.head && S.head.id !== S.base.id), unsaved: S.unsaved, busy: S.busy, error: S.error,
          preview: S.preview, conflicts: S.pending ? S.pending.conflicts : null, canWrite: S.canWrite, user: user() };
      },
      /** Call fn(status) after every change of status; returns an unsubscribe function. */
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      /** Read the folder: is it new, and which version is this browser on? Starts the polling. */
      async connect() {
        S.repo = await readJSON('repo.json'); S.head = await readJSON('head.json'); S.connected = true; S.base = null; S.preview = null;
        if (S.repo) {
          const b = await cache.get(baseKey()); if (b && b.id && b.ser) S.base = { v: b.v, id: b.id, ser: new Map(b.ser) };
          const st = await cache.get(stashKey()); if (st && st.preview) S.preview = st.preview;
        }
        settle(); api.start(); emit(); return api.status();
      },
      /** Start a new shared folder from the app's current state (version 1). */
      init(note) {
        if (!S.connected) throw new Error('Connect the shared folder first');
        return busy('starting the shared folder', () => locked(async () => {
          if (await readJSON('repo.json')) throw new Error('This folder already holds shared data: load it instead');
          S.repo = { repo: rand(12), app: cfg.appId, created: now(), by: user() }; await writeJSON('repo.json', S.repo);
          await writeJSON('tags.json', {});
          const to = serialize(cfg.getState()), h = await commit(null, new Map(), to, note || 'First version');
          S.head = h; S.base = { v: h.v, id: h.id, ser: to }; await saveBase();
          return { ok: true, version: 1 };
        }));
      },
      /** Replace what this browser has with the latest shared version (first use on this computer). */
      load() {
        need(false);
        return busy('loading the shared data', async () => {
          const head = await readJSON('head.json'); if (!head) throw new Error('The folder has no versions yet');
          S.head = head; const remote = await stateAt(head.id); await adopt(head, remote); return { ok: true, version: head.v };
        });
      },
      /** Look at head.json now (polling does this every pollMs, on focus and when the tab is shown again). */
      async check() {
        if (!S.connected) return null;
        try {
          if (!S.repo) { S.repo = await readJSON('repo.json'); if (S.repo) { const b = await cache.get(baseKey()); if (b && b.id && b.ser) S.base = { v: b.v, id: b.id, ser: new Map(b.ser) }; settle(); emit(); } } // someone started the folder
          const h = await readJSON('head.json'); const changed = JSON.stringify(h) !== JSON.stringify(S.head); S.head = h; if (S.error && /cannot read/i.test(S.error)) S.error = ''; if (changed) emit(); return h; }
        catch (e) { S.error = `Cannot read the shared folder: ${e.message}`; emit(); return null; }
      },
      /** Recount the unsaved changes soon (call after the app changes its data). */
      touch() { clearTimeout(recountTimer); recountTimer = setTimeout(() => { const n = S.unsaved; settle(); if (n !== S.unsaved) emit(); }, 300); },
      /** My changes not saved yet: [{ p, b, a }] with JSON text (undefined = not there). */
      unsaved() { if (!S.base) return []; return changesBetween(S.base.ser, serialize(cfg.getState())).filter(real).map((c) => ({ p: JSON.parse(c.k), b: c.b, a: c.a })); },
      /** Save my changes as a new version; merges first when someone saved since. { ok, version } or { conflicts }. */
      save(note) {
        need(true);
        return busy('saving', async () => {
          for (let attempt = 0; attempt < 5; attempt++) {
            const mine = serialize(cfg.getState());
            if (!changesBetween(S.base.ser, mine).filter(real).length) return { ok: true, nothing: true, version: S.base.v };
            const h = await locked(async () => { const head = await readJSON('head.json'); if (!head || head.id !== S.base.id) { S.head = head; return null; } return commit(head, S.base.ser, mine, note); });
            if (h) {
              await sleep(cfg.verifyMs);
              if (await onChain(h)) { S.base = { v: h.v, id: h.id, ser: mine }; await saveBase(); return { ok: true, version: h.v }; }
            }
            const r = await pull(); if (r.conflicts) return { conflicts: r.conflicts }; // someone saved first: take theirs, keep mine on top, go again
          }
          throw new Error('Others kept saving at the same moment; try again');
        });
      },
      /** Bring in the latest version, keeping my unsaved changes on top. { ok } or { conflicts }. */
      refresh() { need(true); return busy('refreshing', pull); },
      /** Finish a merge: choices { [conflict.k]: 'mine' | 'theirs' } (default theirs). */
      resolve(choices) {
        const P = S.pending; if (!P) return Promise.resolve({ ok: true });
        return busy('merging', async () => { for (const c of P.conflicts) putAt(P.merged, c.k, (choices || {})[c.k] === 'mine' ? c.mine : c.theirs); await adopt(P.head, P.remote, P.merged); return { ok: true, version: P.head.v }; });
      },
      /** Drop a pending merge (stay on my version, nothing changes). */
      cancelMerge() { S.pending = null; emit(); },
      /** Every version, newest first: [{ v, id, parent, by, at, note, n, paths, tags }]; repairs the quick list from the chain if it is behind. */
      async history() {
        need(false, true);
        const head = await readJSON('head.json'); if (!head) return [];
        let idx = []; try { idx = (await readJSON('history/index.json')) || []; } catch (e) { idx = []; }
        const byId = new Map(idx.map((e) => [e.id, e])), chain = []; let id = head.id;
        while (id) { // walk the parents: the chain decides, the quick list only saves reading every file
          let e = byId.get(id); if (!e) { const f = await version(id), shown = f.changes.filter((c) => real({ b: 'b' in c ? JSON.stringify(c.b) : undefined, a: 'a' in c ? JSON.stringify(c.a) : undefined })); e = { v: f.v, id: f.id, parent: f.parent, by: f.by, at: f.at, note: f.note, n: shown.length, paths: shown.slice(0, 12).map((c) => c.p), restore: f.restore }; }
          chain.push(e); id = e.parent;
        }
        let tags = {}; try { tags = (await readJSON('tags.json')) || {}; } catch (e) { tags = {}; }
        for (const e of chain) e.tags = Object.keys(tags).filter((t) => tags[t] && tags[t].id === e.id);
        return chain;
      },
      /** What one version changed: [{ p, b, a }] with JSON text. */
      async changesIn(id) { const f = await version(id), out = []; for (const c of f.changes) out.push({ p: c.p, b: 'b' in c ? await unpack(c.b) : undefined, a: 'a' in c ? await unpack(c.a) : undefined }); return out.filter(real); },
      /** Differences between two versions (ids): [{ p, b, a }]. */
      async compare(fromId, toId) { return changesBetween(await stateAt(fromId), await stateAt(toId)).filter(real).map((c) => ({ p: JSON.parse(c.k), b: c.b, a: c.a })); },
      /** The data of a version, as the app's object. */
      async stateOf(id) { return unflatten(await stateAt(id)); },
      /** Make a new version whose data equals version `id` (nothing is erased); my unsaved changes are dropped. */
      restore(id, note) {
        need(true);
        return busy('restoring', async () => {
          const target = await stateAt(id), f = await version(id);
          for (let attempt = 0; attempt < 5; attempt++) {
            const h = await locked(async () => { const head = await readJSON('head.json'), from = await stateAt(head.id); return changesBetween(from, target).length ? commit(head, from, target, note || `Restored version ${f.v}`, { restore: f.v }) : head; });
            await sleep(cfg.verifyMs);
            if (await onChain(h)) { await adopt(h, target); return { ok: true, version: h.v }; }
          }
          throw new Error('Others kept saving at the same moment; try again');
        });
      },
      /** Name a version ("Q3 sign-off"); the same name moves to the new version. */
      tag(id, name) { need(false, true); return busy('tagging', () => locked(async () => { const f = await version(id), t = (await readJSON('tags.json')) || {}; t[name] = { v: f.v, id, by: user(), at: now() }; await writeJSON('tags.json', t); return { ok: true }; })); },
      untag(name) { need(false, true); return busy('tagging', () => locked(async () => { const t = (await readJSON('tags.json')) || {}; delete t[name]; await writeJSON('tags.json', t); return { ok: true }; })); },
      /** Show an old version in the app, read-only; my own data is put aside and comes back with endPreview(). */
      preview(id) {
        need(true, true);
        return busy('opening the version', async () => {
          const f = await version(id), target = await stateAt(id);
          if (!S.preview) await cache.set(stashKey(), { ser: Array.from(serialize(cfg.getState())), preview: { v: f.v, id, by: f.by, at: f.at, note: f.note } });
          else { const st = await cache.get(stashKey()); st.preview = { v: f.v, id, by: f.by, at: f.at, note: f.note }; await cache.set(stashKey(), st); }
          S.preview = { v: f.v, id, by: f.by, at: f.at, note: f.note };
          await cfg.setState(unflatten(target), { version: f.v, preview: true });
          return { ok: true, version: f.v };
        });
      },
      /** Back from an old version to my own data. */
      endPreview() {
        return busy('going back', async () => {
          const st = await cache.get(stashKey()); S.preview = null;
          if (st && st.ser) await cfg.setState(unflatten(new Map(st.ser)), { version: S.base && S.base.v });
          await cache.del(stashKey()); return { ok: true };
        });
      },
      /** Start polling head.json (also on focus and when the tab is shown again). */
      start() {
        api.stop(); if (cfg.pollMs > 0) timer = setInterval(api.check, cfg.pollMs);
        if (typeof document !== 'undefined' && !api._wake) { api._wake = () => { if (!document.hidden) api.check(); }; document.addEventListener('visibilitychange', api._wake); root.addEventListener && root.addEventListener('focus', api._wake); }
      },
      stop() { if (timer) clearInterval(timer); timer = null; },
      /** Forget this folder in this app (polling stops). */
      disconnect() { api.stop(); if (api._wake && typeof document !== 'undefined') { document.removeEventListener('visibilitychange', api._wake); root.removeEventListener && root.removeEventListener('focus', api._wake); api._wake = null; } S.connected = false; S.repo = null; S.base = null; S.head = null; emit(); },
    };
    return api;
  }

  // ---------- browser helpers: pick a folder once, find it again next visit ----------
  const kv = localStore('drive-vc');
  const DriveVC = {
    version: '1.0.0', open, folder, memory, localStore, flatten, unflatten, merge3, changesBetween, hash,
    /** Can this browser write to a folder? (Edge and Chrome can; Firefox and Safari cannot.) */
    supported: () => typeof root.showDirectoryPicker === 'function',
    /** Ask the user to pick the shared folder; it is remembered for this app. */
    async pickFolder(appId) { const dir = await root.showDirectoryPicker({ id: String('dvc-' + (appId || 'app')).replace(/[^\w-]/g, '').slice(0, 32), mode: 'readwrite' }); await kv.set(`folder:${appId}`, dir); return dir; },
    /** The folder picked earlier, or null. */
    savedFolder: (appId) => kv.get(`folder:${appId}`).then((d) => d || null),
    forgetFolder: (appId) => kv.del(`folder:${appId}`),
    /** 'write', 'read' or 'prompt'; with ask = true (inside a click) the browser asks the user. */
    async permission(dir, ask) {
      const rw = { mode: 'readwrite' }; let p = await dir.queryPermission(rw);
      if (p !== 'granted' && ask) p = await dir.requestPermission(rw);
      if (p === 'granted') return 'write';
      return (await dir.queryPermission({ mode: 'read' })) === 'granted' ? 'read' : 'prompt';
    },
    /** A short text for a JSON value: "Sam", 400, 3 items, 5 fields, (none). */
    show(j, max) {
      if (j === undefined) return '(none)';
      const v = JSON.parse(j), m = max || 60;
      if (v === null) return '(empty)';
      if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? '' : 's'}`;
      if (isObj(v)) return `${Object.keys(v).length} field${Object.keys(v).length === 1 ? '' : 's'}`;
      const s = String(v); return s.length > m ? s.slice(0, m - 1) + '…' : s;
    },
    /** One change in words: { where: 'settings › colour', what: 'blue → red' }; lists of { id } items say what was added or removed. */
    describe(c) {
      const where = c.p.join(' › ') || '(everything)';
      const b = c.b === undefined ? undefined : JSON.parse(c.b), a = c.a === undefined ? undefined : JSON.parse(c.a);
      if ((b === undefined || ided(b)) && (a === undefined || ided(a)) && (Array.isArray(a) || Array.isArray(b))) {
        const B = new Map((b || []).map((x) => [x.id, JSON.stringify(x)])), A = new Map((a || []).map((x) => [x.id, JSON.stringify(x)]));
        const add = Array.from(A.keys()).filter((k) => !B.has(k)).length, del = Array.from(B.keys()).filter((k) => !A.has(k)).length, ed = Array.from(A.keys()).filter((k) => B.has(k) && B.get(k) !== A.get(k)).length;
        return { where, what: [add && `${add} added`, del && `${del} removed`, ed && `${ed} changed`].filter(Boolean).join(', ') || 'reordered' };
      }
      return { where, what: c.b === undefined ? `set to ${DriveVC.show(c.a)}` : c.a === undefined ? `removed (was ${DriveVC.show(c.b)})` : `${DriveVC.show(c.b)} → ${DriveVC.show(c.a)}` };
    },
  };
  root.DriveVC = DriveVC;
  if (typeof module === 'object' && module.exports) module.exports = DriveVC;
})(typeof window !== 'undefined' ? window : globalThis);
