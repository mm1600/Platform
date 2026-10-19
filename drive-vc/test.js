#!/usr/bin/env node
/* node test.js: drive-vc tests. Several "users" (each its own app state and browser cache) share one in-memory folder,
 * optionally with a random delay on every read and write, like a slow network share. Exits 1 on any failure. */
'use strict';
const DriveVC = require('./drive-vc.js');
const cases = [];
const add = (name, fn) => cases.push({ name, fn });
const assert = (c, msg) => { if (!c) throw new Error(msg || 'assertion failed'); };
const eq = (a, b, msg) => { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${msg || ''} expected ${y}, got ${x}`); };
const FAST = { pollMs: 0, settleMs: 5, verifyMs: 5, staleMs: 400 };

/** One user: an app whose whole data is `data`, plus its repo on the shared store. */
function user(store, name, data, opts) {
  const u = { name, data: JSON.parse(JSON.stringify(data || {})), applied: [] };
  u.repo = DriveVC.open(Object.assign({ store, appId: 'test', user: name, getState: () => JSON.parse(JSON.stringify(u.data)), setState: (s, info) => { u.data = s; u.applied.push(info); } }, FAST, opts));
  return u;
}
async function team(n, data, storeOpts, opts) {
  const store = DriveVC.memory(storeOpts), users = [];
  for (let i = 0; i < n; i++) users.push(user(store, 'U' + (i + 1), i === 0 ? data : {}, opts));
  await users[0].repo.connect(); await users[0].repo.init('start');
  for (const u of users.slice(1)) { await u.repo.connect(); assert(u.repo.status().needsLoad, 'needs load'); await u.repo.load(); }
  return { store, users };
}

add('start, load on a second computer, save, see it is newer, refresh', async () => {
  const { users: [a, b] } = await team(2, { title: 'Plan', settings: { colour: 'blue', size: 3 } });
  eq(b.data, a.data, 'loaded');
  a.data.settings.colour = 'red'; a.repo.touch();
  eq(a.repo.unsaved().map((c) => c.p), [['settings', 'colour']], 'one unsaved change');
  const r = await a.repo.save('red'); eq(r, { ok: true, version: 2 });
  await b.repo.check(); const st = b.repo.status();
  assert(st.behind && st.head.v === 2 && st.head.by === 'U1' && st.head.note === 'red', 'b sees v2 by U1');
  await b.repo.refresh(); eq(b.data.settings.colour, 'red'); assert(!b.repo.status().behind, 'up to date');
});

add('two people change different fields: the second save merges, nothing lost', async () => {
  const { users: [a, b] } = await team(2, { s: { x: 1, y: 1 } });
  a.data.s.x = 2; b.data.s.y = 3;
  await a.repo.save('x'); const r = await b.repo.save('y');
  eq(r.version, 3); eq(b.data, { s: { x: 2, y: 3 } }, 'b has both');
  await a.repo.refresh(); eq(a.data, { s: { x: 2, y: 3 } }, 'a has both');
  const h = await a.repo.history(); eq(h.map((e) => e.v), [3, 2, 1]); eq(h.map((e) => e.by), ['U2', 'U1', 'U1']);
});

add('both change the same field: asked, and the pick is kept (mine or theirs)', async () => {
  const { users: [a, b] } = await team(2, { s: { x: 1, other: 0 } });
  a.data.s.x = 2; await a.repo.save();
  b.data.s.x = 5; b.data.s.other = 9;
  const r = await b.repo.save();
  assert(r.conflicts && r.conflicts.length === 1, 'one conflict'); const c = r.conflicts[0];
  eq(c.p, ['s', 'x']); eq([c.base, c.mine, c.theirs], ['1', '5', '2']);
  let threw = false; try { await b.repo.save(); } catch (e) { threw = /merge/.test(e.message); } assert(threw, 'save blocked until resolved');
  await b.repo.resolve({ [c.k]: 'mine' }); eq(b.data.s, { x: 5, other: 9 }, 'mine kept, my other change kept');
  eq((await b.repo.save()).version, 3);
  await a.repo.refresh(); eq(a.data.s, { x: 5, other: 9 });
  // theirs
  a.data.s.x = 7; await a.repo.save(); b.data.s.x = 8;
  const r2 = await b.repo.refresh(); await b.repo.resolve({ [r2.conflicts[0].k]: 'theirs' }); eq(b.data.s.x, 7);
  eq(b.repo.unsaved().length, 0, 'nothing left to save');
});

add('lists of { id } items merge: both add rows, one edits, one removes', async () => {
  const rows = [{ id: 'r1', v: 1 }, { id: 'r2', v: 2 }, { id: 'r3', v: 3 }];
  const { users: [a, b] } = await team(2, { rows });
  a.data.rows.push({ id: 'a1', v: 10 }); a.data.rows[0].v = 11;
  b.data.rows.push({ id: 'b1', v: 20 }); b.data.rows = b.data.rows.filter((r) => r.id !== 'r3');
  await a.repo.save(); await b.repo.save();
  eq(b.data.rows, [{ id: 'r1', v: 11 }, { id: 'r2', v: 2 }, { id: 'a1', v: 10 }, { id: 'b1', v: 20 }]);
  // both edit the same row differently: asked
  a.data.rows[0].v = 100; await (await a.repo.refresh(), a.repo.save());
  b.data.rows[0].v = 200; const r = await b.repo.save(); assert(r.conflicts && r.conflicts[0].p[0] === 'rows', 'row conflict');
});

add('five people save at the same moment on a slow share: one at a time, every change kept, history in a line', async () => {
  const { store, users } = await team(5, { s: {} }, { lag: 15 }, { settleMs: 60, verifyMs: 60 });
  users.forEach((u, i) => { u.data.s['k' + i] = i; });
  const out = await Promise.all(users.map((u) => u.repo.save('mine ' + u.name)));
  assert(out.every((r) => r.ok), JSON.stringify(out));
  eq(out.map((r) => r.version).sort(), [2, 3, 4, 5, 6], 'one version each');
  const last = users[0]; await last.repo.refresh();
  eq(Object.keys(last.data.s).sort(), ['k0', 'k1', 'k2', 'k3', 'k4'], 'all five fields');
  const h = await last.repo.history(); eq(h.map((e) => e.v), [6, 5, 4, 3, 2, 1], 'a line');
  for (let i = 0; i + 1 < h.length; i++) assert(h[i].parent === h[i + 1].id, 'linked');
  eq(JSON.parse(store.files.get('lock.json')).free, true, 'lock freed');
});

add('a share slower than the lock\'s wait: saves may collide, yet after refresh + save nothing is lost', async () => {
  const { users } = await team(4, { s: {} }, { lag: 60 }, { settleMs: 5, verifyMs: 5 });
  users.forEach((u, i) => { u.data.s['k' + i] = i; });
  await Promise.all(users.map((u) => u.repo.save().catch((e) => ({ error: e.message }))));
  for (let round = 0; round < 6; round++) { // what each user does when the bar says "newer version": refresh, then save what is still unsaved
    let left = 0;
    for (const u of users) { const r = await u.repo.refresh(); if (r.conflicts) throw new Error('unexpected conflict'); if (u.repo.unsaved().length) { left++; await u.repo.save(); } }
    if (!left) break;
  }
  for (const u of users) await u.repo.refresh();
  for (const u of users) eq(Object.keys(u.data.s).sort(), ['k0', 'k1', 'k2', 'k3'], u.name + ' has all four');
});

add('an empty group that gets its first field counts as one change, not two', async () => {
  const { users: [a] } = await team(1, { settings: {} });
  a.data.settings.fx = 'x'; eq(a.repo.unsaved().map((c) => c.p), [['settings', 'fx']]);
  await a.repo.save(); const h = await a.repo.history(); eq(h[0].n, 1); eq((await a.repo.changesIn(h[0].id)).length, 1);
});

add('a large value is stored once however many versions keep it', async () => {
  const sheet = Array.from({ length: 3000 }, (_, i) => [i, 'row ' + i, i * 1.5]);
  const { store, users: [a, b] } = await team(2, { sheet, note: 'x' });
  for (let i = 0; i < 4; i++) { a.data.note = 'v' + i; await a.repo.save(); }
  const blobs = Array.from(store.files.keys()).filter((k) => k.startsWith('blobs/'));
  eq(blobs.length, 1, 'one blob');
  assert(store.files.get(Array.from(store.files.keys()).find((k) => /history\/000003/.test(k))).length < 2000, 'small version file');
  a.data.sheet = sheet.concat([[3000, 'new', 0]]); await a.repo.save('new month');
  eq(Array.from(store.files.keys()).filter((k) => k.startsWith('blobs/')).length, 2, 'a new sheet is a second blob');
  await b.repo.refresh(); eq(b.data.sheet.length, 3001);
  const ch = await b.repo.changesIn((await b.repo.history())[0].id); eq(DriveVC.describe(ch[0]), { where: 'sheet', what: '3000 items → 3001 items' });
});

add('history, compare, what a version changed, restore an old version, tags', async () => {
  const { users: [a, b] } = await team(2, { s: { x: 1 } });
  for (let i = 2; i <= 4; i++) { a.data.s.x = i; await a.repo.save('x=' + i); }
  const h = await a.repo.history(); eq(h.map((e) => e.note), ['x=4', 'x=3', 'x=2', 'start']);
  eq((await a.repo.changesIn(h[0].id)).map((c) => [c.p, c.b, c.a]), [[['s', 'x'], '3', '4']]);
  eq((await a.repo.compare(h[3].id, h[0].id)).map((c) => [c.b, c.a]), [['1', '4']]);
  eq(await a.repo.stateOf(h[2].id), { s: { x: 2 } });
  await a.repo.tag(h[2].id, 'Sent to Investor 4');
  const r = await a.repo.restore(h[2].id); eq(r.version, 5); eq(a.data.s.x, 2, 'restored');
  const h2 = await b.repo.history(); eq(h2[0].note, 'Restored version 2'); eq(h2[0].restore, 2); eq(h2.length, 5, 'nothing erased');
  eq(h2.find((e) => e.v === 2).tags, ['Sent to Investor 4']);
  await b.repo.refresh(); eq(b.data.s.x, 2);
});

add('open an old version read-only, then come back to my own unsaved data', async () => {
  const { users: [a] } = await team(1, { s: { x: 1 } });
  a.data.s.x = 2; await a.repo.save();
  a.data.s.x = 99; // unsaved
  const h = await a.repo.history();
  await a.repo.preview(h[1].id); eq(a.data.s.x, 1, 'showing v1'); assert(a.repo.status().preview.v === 1);
  let threw = false; try { await a.repo.save(); } catch (e) { threw = true; } assert(threw, 'no saving while viewing');
  await a.repo.endPreview(); eq(a.data.s.x, 99, 'my unsaved value back'); eq(a.repo.unsaved().length, 1);
});

add('a lock left by a crashed computer is taken over after it stops changing', async () => {
  const { store, users: [a] } = await team(1, { s: { x: 1 } });
  store.files.set('lock.json', JSON.stringify({ by: 'ghost', tok: 'zzz', at: '2020-01-01' }));
  a.data.s.x = 2; const t0 = Date.now(); const r = await a.repo.save();
  assert(r.ok && Date.now() - t0 >= 400, 'waited staleMs then saved');
});

add('a save lost to a race on a slow share comes back as unsaved changes', async () => {
  const { store, users: [a, b] } = await team(2, { s: { x: 1, y: 1 } });
  b.data.s.y = 2; await b.repo.save(); // v2 by b
  // a's save landed but was then overwritten: forge an orphan v2 that a believes it is on
  const orphan = { v: 2, id: '000002-orph1', parent: JSON.parse(store.files.get('history/index.json'))[0].id, by: 'U1', at: 'x', note: '', changes: [{ p: ['s', 'x'], b: 1, a: 5 }] };
  store.files.set('history/000002-orph1.json', JSON.stringify(orphan));
  const fakeBase = { v: 2, id: orphan.id, ser: [['["s","x"]', '5'], ['["s","y"]', '1']] };
  const a2 = user(store, 'U1', { s: { x: 5, y: 1 } }, { local: { get: async (k) => (/base$/.test(k) ? fakeBase : null), set: async () => {}, del: async () => {} } });
  await a2.repo.connect(); assert(a2.repo.status().behind, 'head is not my version');
  await a2.repo.refresh();
  eq(a2.data.s, { x: 5, y: 2 }, 'mine and theirs'); eq(a2.repo.unsaved().map((c) => c.p), [['s', 'x']], 'my lost change is unsaved again');
  eq((await a2.repo.save()).version, 3);
});

add('full copies every 10 versions: any version reads back exactly', async () => {
  const { store, users: [a, b] } = await team(2, { n: 0, list: [] });
  for (let i = 1; i <= 23; i++) { a.data.n = i; a.data.list = a.data.list.concat([{ id: 'i' + i }]); await a.repo.save(); }
  const files = Array.from(store.files.keys()).filter((k) => /^history\/0/.test(k));
  eq(files.filter((k) => 'state' in JSON.parse(store.files.get(k))).length, 3, 'v1, v10, v20 hold a full copy');
  const h = await b.repo.history();
  for (const e of h) { const s = await b.repo.stateOf(e.id); eq(s.n, e.v - 1, 'v' + e.v); eq((s.list || []).length, e.v - 1); }
});

add('the folder is new, or someone else started it', async () => {
  const store = DriveVC.memory(), a = user(store, 'A', { x: 1 }), b = user(store, 'B', { x: 2 });
  assert((await a.repo.connect()).empty, 'empty');
  await a.repo.init(); await b.repo.connect();
  let threw = false; try { await b.repo.init(); } catch (e) { threw = /already/.test(e.message); } assert(threw, 'cannot start twice');
  await b.repo.load(); eq(b.data, { x: 1 });
});

(async () => {
  let fails = 0;
  for (const c of cases) { try { await c.fn(); console.log('  ok  ' + c.name); } catch (e) { fails++; console.log(' FAIL ' + c.name + '\n        ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n        ')); } }
  console.log(`\n${cases.length - fails} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
})();
