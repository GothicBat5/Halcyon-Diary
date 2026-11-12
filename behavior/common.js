/* Shared core: storage engine, writer/pen-name helpers, backup tools, edit dialog.
   Storage: IndexedDB (durable, roomy) + an instant localStorage mirror (so a page change never loses a keystroke).
   Pages must wait for it:  Store.ready.then(() => { ... })                                                      */
const Store = (() => {
  const KEY = 'cozy-diary-v1', VERSION = 2;
  const COLORS = ['#f2a7bb','#e86f93','#b9d66b','#7fa650','#e8913f','#c4562f','#f5c96a','#f7b79a',
                  '#c9a4d8','#8e4a78','#8fc7b0','#4f9d9a','#8ec1e8','#5b83b8','#9a6b50','#cfc3b8'];
  const SLOTS = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', night: 'Night' };
  const SLOT_HINT = { morning: '5am–12pm', afternoon: '12–5pm', evening: '5–9pm', night: '9pm–5am' };
  const GREET = { morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening', night: 'Late-night writing' };
  const FONTS = {
    plain:      { label: 'Default (Caveat titles, Nunito text)', css: null },
    caveat:     { label: 'Caveat (soft script)',   css: "'Caveat',cursive",          size: '1.35rem' },
    hand:       { label: 'Patrick Hand (neat)',    css: "'Patrick Hand',cursive",    size: '1.15rem' },
    dancing:    { label: 'Dancing Script (flowy)', css: "'Dancing Script',cursive",  size: '1.2rem' },
    indie:      { label: 'Indie Flower (bubbly)',  css: "'Indie Flower',cursive",    size: '1.05rem' },
    lora:       { label: 'Lora (bookish serif)',   css: "'Lora',serif",              size: '1.05rem' },
    typewriter: { label: 'Special Elite (typewriter)', css: "'Special Elite',monospace", size: '.95rem' }
  };
  const PROMPTS = {
    morning:   ['What would make today feel good?', 'One small thing I’m looking forward to…', 'How did I sleep, and how do I feel?'],
    afternoon: ['What has been the best part of today so far?', 'Something I noticed on the way…', 'What do I need more of right now?'],
    evening:   ['Three good things from today…', 'What am I grateful for tonight?', 'Something I want to remember about today…'],
    night:     ['What is on my mind before I sleep?', 'Dear diary, tonight I feel…', 'Something I’m letting go of…']
  };

  const uid = () => Math.random().toString(36).slice(2, 9);
  const slot = (d = new Date()) => { const h = d.getHours(); return h >= 5 && h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 21 ? 'evening' : 'night'; };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const defaultAuthor = () => ({ id: 'a-me', name: 'Me', emoji: '🌷', color: COLORS[0], slots: [], font: 'plain' });

  const seed = () => ({
    notebooks: [
      { id: 'nb-daily', name: 'Daily life', emoji: '🌸', color: COLORS[0], topics: [
        { id: 't-morn', name: 'Mornings', color: COLORS[2], entries: [
          { id: 'e-1', title: 'First cozy page', body: 'Tea, blanket, rain on the window. Starting here.', date: new Date().toISOString(), author: 'a-me', authorName: 'Me' } ] },
        { id: 't-grat', name: 'Gratitude', color: COLORS[4], entries: [] } ] },
      { id: 'nb-autumn', name: 'Autumn dreams', emoji: '🍂', color: COLORS[4], topics: [
        { id: 't-rec', name: 'Recipes', color: COLORS[6], entries: [] } ] }
    ],
    writer: { name: '', bio: '', defaultId: 'a-me', authors: [defaultAuthor()] }
  });

  /* Make any incoming data (old version, imported file) safe to use */
  const normalize = d => {
    d = (d && typeof d === 'object') ? d : {};
    d.meta = Object.assign({ version: VERSION, savedAt: 0 }, d.meta);
    d.notebooks = Array.isArray(d.notebooks) ? d.notebooks : [];
    d.notebooks.forEach(n => {
      n.id = n.id || uid(); n.name = n.name || 'Untitled'; n.emoji = n.emoji || '📓'; n.color = n.color || COLORS[0];
      n.topics = Array.isArray(n.topics) ? n.topics : [];
      n.topics.forEach(t => {
        t.id = t.id || uid(); t.name = t.name || 'Untitled'; t.color = t.color || COLORS[0];
        t.entries = Array.isArray(t.entries) ? t.entries : [];
        t.entries.forEach(e => { e.id = e.id || uid(); e.title = e.title || ''; e.body = e.body || ''; e.date = e.date || new Date().toISOString(); });
      });
    });
    d.writer = Object.assign({ name: '', bio: '', authors: [], defaultId: null }, d.writer);
    if (!Array.isArray(d.writer.authors) || !d.writer.authors.length) d.writer.authors = [defaultAuthor()];
    d.writer.authors.forEach(a => {            // v1 had one `when`; v2 has several `slots`
      if (!Array.isArray(a.slots)) a.slots = (a.when && a.when !== 'any') ? [a.when] : [];
      delete a.when;
      a.id = a.id || uid(); a.name = a.name || 'Me'; a.emoji = a.emoji || '✒️'; a.color = a.color || COLORS[0]; a.font = FONTS[a.font] ? a.font : 'plain';
    });
    if (!d.writer.authors.some(a => a.id === d.writer.defaultId)) d.writer.defaultId = d.writer.authors[0].id;
    d.meta.version = VERSION;
    return d;
  };

  /* ---- IndexedDB helpers ---- */
  const openDB = () => new Promise((res, rej) => {
    if (!window.indexedDB) return rej(new Error('no idb'));
    let r, done = false, timer;
    const finish = (fn, v) => { if (!done) { done = true; clearTimeout(timer); fn(v); } else if (v && v.close) v.close(); };
    timer = setTimeout(() => finish(rej, new Error('timeout')), 3000);
    try { r = indexedDB.open('cozy-diary', 2); } catch (e) { return finish(rej, e); }
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      if (!d.objectStoreNames.contains('snap')) d.createObjectStore('snap', { keyPath: 'id', autoIncrement: true });
      if (!d.objectStoreNames.contains('img')) d.createObjectStore('img');
    };
    r.onsuccess = () => { const d = r.result; d.onversionchange = () => d.close(); finish(res, d); };
    r.onerror = () => finish(rej, r.error);
  });
  const tx = (store, mode, fn) => new Promise((res, rej) => {
    const t = db.transaction(store, mode); const req = fn(t.objectStore(store));
    t.oncomplete = () => res(req && req.result); t.onerror = t.onabort = () => rej(t.error);
  });

  let data = null, db = null, saveTimer = null;
  const status = { backend: 'memory', persisted: null, lastSaved: null };
  const parse = s => { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } };
  const fromMirror = () => {
    try { const v = parse(localStorage.getItem(KEY)); if (v) return v; } catch (e) {}
    try { if (window.name.startsWith(KEY + '=')) return parse(window.name.slice(KEY.length + 1)); } catch (e) {}
    return null;
  };
  const mirror = json => {
    try { localStorage.setItem(KEY, json); return; } catch (e) {}
    try { window.name = KEY + '=' + json; } catch (e) {}
  };
  const flush = () => { clearTimeout(saveTimer); if (db && data) { try { tx('kv', 'readwrite', s => s.put(data, 'data')).catch(() => {}); } catch (e) {} } };
  const save = () => {
    if (!data) return;
    data.meta.savedAt = status.lastSaved = Date.now();
    mirror(JSON.stringify(data));           // instant, survives leaving the page
    clearTimeout(saveTimer); saveTimer = setTimeout(flush, 250);   // durable copy
  };
  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

  /* ---- safety copies (snapshots) ---- */
  const snapshots = async () => db ? (await tx('snap', 'readonly', s => s.getAll())).reverse() : [];
  const snapshot = async (reason = 'manual') => {
    if (!db || !data) return false;
    await tx('snap', 'readwrite', s => s.add({ at: Date.now(), reason, json: JSON.stringify(data) }));
    const old = (await snapshots()).slice(8);          // keep the newest 8
    if (old.length) await tx('snap', 'readwrite', s => { old.forEach(x => s.delete(x.id)); });
    return true;
  };
  const snapshotInfo = async () => (await snapshots()).map(s => {
    const d = parse(s.json) || {};
    return { id: s.id, at: s.at, reason: s.reason, size: s.json.length, pages: counts(normalize(d)).pages };
  });
  const getSnapshot = async id => (await tx('snap', 'readonly', s => s.get(id))).json;
  const deleteSnapshot = id => tx('snap', 'readwrite', s => { s.delete(id); });

  /* ---- numbers, export, import ---- */
  const wordsOf = e => (String(e.body || '').match(/\S+/g) || []).length;
  function counts(d = data) {
    let topics = 0, pages = 0, words = 0;
    d.notebooks.forEach(n => { topics += n.topics.length; n.topics.forEach(t => t.entries.forEach(e => { pages++; words += wordsOf(e); })); });
    return { notebooks: d.notebooks.length, topics, pages, words, bytes: new Blob([JSON.stringify(d)]).size };
  }
  const authorName = e => (data.writer.authors.find(a => a.id === e.author) || {}).name || e.authorName || '';
  const exportJSON = () => JSON.stringify({ app: 'cozy-diary', version: VERSION, exportedAt: new Date().toISOString(), data }, null, 2);
  const exportHTML = () => {
    const w = data.writer, title = (w.name ? w.name + '’s' : 'My') + ' cozy diary';
    const body = data.notebooks.map(nb => `<section style="--c:${esc(nb.color)}"><h2>${esc(nb.emoji)} ${esc(nb.name)}</h2>` +
      nb.topics.map(t => `<h3 style="--c:${esc(t.color)}">${esc(t.name)}</h3>` + t.entries.map(e =>
        `<article style="--c:${esc(t.color)}"><h4>${esc(e.title || 'Untitled page')}</h4><p class="m">${esc(new Date(e.date).toLocaleString())}${authorName(e) ? ' · ✒ ' + esc(authorName(e)) : ''}</p><div class="b">${esc(e.body)}</div></article>`).join('')).join('') + '</section>').join('');
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{margin:0;padding:2rem 1rem;background:#fff7f2;color:#4b2e36;font:17px/1.6 Georgia,serif}main{max-width:720px;margin:auto}h1{color:#7a3b52;font-size:2.4rem}
section{margin:2.5rem 0;padding:1.2rem 1.4rem;border:2px solid #4b2e36;border-radius:16px;border-top:12px solid var(--c);background:#fffdf8}h2{margin:.2rem 0}
h3{border-left:12px solid var(--c);padding-left:.6rem;margin:1.6rem 0 .6rem}article{margin:0 0 1.2rem;padding:.7rem 1rem;background:#fff;border-left:6px solid var(--c);border-radius:4px 12px 12px 4px}
h4{margin:0;font-size:1.2rem}.m{margin:0 0 .4rem;color:#8a6870;font-size:.85rem}.b{white-space:pre-wrap}</style></head>
<body><main><h1>${esc(title)}</h1>${w.bio ? `<p>${esc(w.bio)}</p>` : ''}<p class="m">Exported ${esc(new Date().toLocaleString())}</p>${body || '<p>Nothing written yet.</p>'}</main></body></html>`;
  };
  const parseBackup = text => {
    let o; try { o = JSON.parse(text); } catch (e) { throw new Error('That file isn’t valid JSON.'); }
    const inner = o && (o.data || o);
    if (!inner || !Array.isArray(inner.notebooks)) throw new Error('This doesn’t look like a Cozy Diary backup.');
    return normalize(inner);
  };
  const replaceAll = async (incoming) => { await snapshot('before restore'); data = normalize(incoming); save(); flush(); };
  const merge = async incoming => {
    await snapshot('before import');
    const before = counts().pages;
    incoming.notebooks.forEach(nb => {
      const mine = data.notebooks.find(n => n.id === nb.id);
      if (!mine) return data.notebooks.push(nb);
      nb.topics.forEach(t => {
        const mt = mine.topics.find(x => x.id === t.id);
        if (!mt) return mine.topics.push(t);
        t.entries.forEach(e => { if (!mt.entries.some(x => x.id === e.id)) mt.entries.push(e); });
      });
    });
    incoming.writer.authors.forEach(a => { if (!data.writer.authors.some(x => x.id === a.id)) data.writer.authors.push(a); });
    if (!data.writer.name) data.writer.name = incoming.writer.name;
    if (!data.writer.bio) data.writer.bio = incoming.writer.bio;
    save(); flush();
    return counts().pages - before;
  };
  const download = (name, text, mime) => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: mime })); a.download = name;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const estimate = async () => { try { return await navigator.storage.estimate(); } catch (e) { return null; } };
  const requestPersist = async () => { try { status.persisted = await navigator.storage.persist(); } catch (e) {} return status.persisted; };

  /* ---- images ---- */
  const imgKey = k => KEY + '-img-' + k;
  const putImage = async (k, blob) => {
    if (db) return tx('img', 'readwrite', s => s.put(blob, k));
    const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
    localStorage.setItem(imgKey(k), url);
  };
  const getImage = async k => {
    if (db) return (await tx('img', 'readonly', s => s.get(k))) || null;
    const u = localStorage.getItem(imgKey(k));
    return u ? (await fetch(u)).blob() : null;
  };
  const deleteImage = async k => {
    if (db) return tx('img', 'readwrite', s => { s.delete(k); });
    localStorage.removeItem(imgKey(k));
  };

  /* ---- writer helpers ---- */
  const authorFor = (d = new Date()) => {
    const w = data.writer, m = w.authors.filter(a => a.slots.includes(slot(d)));
    return m.find(a => a.id === w.defaultId) || m[0] || w.authors.find(a => a.id === w.defaultId) || w.authors[0];
  };
  const mkEntry = (title, body) => { const a = authorFor(); return { id: uid(), title, body, date: new Date().toISOString(), author: a.id, authorName: a.name }; };
  const promptFor = () => { const l = PROMPTS[slot()]; return l[Math.floor(Date.now() / 864e5) % l.length]; };

  /* ---- start up ---- */
  const ready = (async () => {
    let fromDb = null;
    try { db = await openDB(); fromDb = await tx('kv', 'readonly', s => s.get('data')); status.backend = 'indexeddb'; }
    catch (e) { db = null; status.backend = 'localstorage'; }
    const best = [fromDb, fromMirror()].filter(Boolean).sort((a, b) => ((b.meta && b.meta.savedAt) || 0) - ((a.meta && a.meta.savedAt) || 0))[0];
    try { data = normalize(best || seed()); } catch (e) { data = normalize(seed()); }
    save(); flush();
    (async () => {
      try { status.persisted = await Promise.race([navigator.storage.persisted(), new Promise(r => setTimeout(() => r(null), 1000))]); } catch (e) {}
      try { const s = await snapshots(); if (db && (!s.length || Date.now() - s[0].at > 20 * 36e5)) await snapshot('daily'); } catch (e) {}
    })();
  })().catch(() => { if (!data) data = normalize(seed()); });

  return { ready, get data() { return data; }, status, save, flush, uid, esc, slot, mkEntry, authorFor, promptFor, authorName,
    counts, exportJSON, exportHTML, parseBackup, replaceAll, merge, download, estimate, requestPersist,
    snapshot, snapshotInfo, getSnapshot, deleteSnapshot, putImage, getImage, deleteImage, COLORS, SLOTS, SLOT_HINT, GREET, FONTS };
})();

/* Reusable dialog: name (+ icon, time-of-day slots, handwriting) + 16 swatches + free color picker + optional delete */
function openEditor({ title, name = '', emoji, slots, font, color = Store.COLORS[0], onSave, onDelete }) {
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `<form method="dialog"><h2>${Store.esc(title)}</h2>
    ${emoji !== undefined ? `<label for="dEmoji">Icon</label><input type="text" id="dEmoji" maxlength="4" value="${Store.esc(emoji)}">` : ''}
    <label for="dName">Name</label><input type="text" id="dName" maxlength="40" value="${Store.esc(name)}">
    ${slots !== undefined ? `<label>Use this name when I write in the…</label><div class="slots">${Object.entries(Store.SLOTS).map(([k, v]) =>
      `<label class="chk"><input type="checkbox" value="${k}" ${slots.includes(k) ? 'checked' : ''}> ${v} <small>${Store.SLOT_HINT[k]}</small></label>`).join('')}</div>
      <p class="dhint">Leave all unticked to use it anytime.</p>` : ''}
    ${font !== undefined ? `<label for="dFont">Handwriting</label><select id="dFont">${Object.entries(Store.FONTS).map(([k, f]) =>
      `<option value="${k}" ${k === font ? 'selected' : ''}>${f.label}</option>`).join('')}</select><p class="font-prev" id="dPrev">Dear diary, today felt cozy…</p>` : ''}
    <label>Color</label><div class="swatches"></div>
    <label class="picker">Or pick your own <input type="color" id="dColor" value="${color}"><output id="dHex">${color}</output></label>
    <div class="dlg-actions">${onDelete ? '<button type="button" class="btn danger small left" id="dDel">Delete</button>' : ''}
      <button value="cancel" class="btn small">Cancel</button><button value="ok" class="btn primary small">Save</button></div></form>`;
  const box = dlg.querySelector('.swatches'), pick = dlg.querySelector('#dColor'), hex = dlg.querySelector('#dHex');
  const mark = () => box.querySelectorAll('.swatch').forEach(x => x.setAttribute('aria-pressed', x.dataset.c === color));
  const set = c => { color = c; pick.value = c; hex.textContent = c; mark(); };
  Store.COLORS.forEach(c => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'swatch'; b.dataset.c = c; b.style.setProperty('--s', c); b.setAttribute('aria-label', 'Color ' + c);
    b.onclick = () => set(c); box.append(b);
  });
  pick.oninput = () => set(pick.value); mark();
  const fsel = dlg.querySelector('#dFont'), prev = dlg.querySelector('#dPrev');
  const showFont = () => { const f = Store.FONTS[fsel.value]; prev.style.fontFamily = f.css || ''; prev.style.fontSize = f.size || ''; };
  if (fsel) { fsel.onchange = showFont; showFont(); }
  dlg.addEventListener('close', () => {
    if (dlg.returnValue === 'ok') {
      const e = dlg.querySelector('#dEmoji');
      onSave({ name: dlg.querySelector('#dName').value.trim() || 'Untitled', color,
        emoji: e ? (e.value.trim() || '📓') : undefined,
        slots: slots !== undefined ? [...dlg.querySelectorAll('.slots input:checked')].map(i => i.value) : undefined,
        font: fsel ? fsel.value : undefined });
    }
    dlg.remove();
  });
  const del = dlg.querySelector('#dDel');
  if (del) del.onclick = () => { if (confirm('Delete this? It can’t be undone.')) { dlg.close('x'); onDelete(); } };
  document.body.append(dlg); dlg.showModal();
}