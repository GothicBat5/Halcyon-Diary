Store.ready.then(() => {
  const $ = id => document.getElementById(id);
  const w = Store.data.writer;
  let timer;

  /* "You": saves as you type */
  $('wName').value = w.name; $('wBio').value = w.bio;
  $('wName').oninput = $('wBio').oninput = () => {
    w.name = $('wName').value.trim(); w.bio = $('wBio').value;
    $('wSaved').textContent = 'saving…'; clearTimeout(timer);
    timer = setTimeout(() => { Store.save(); $('wSaved').textContent = 'saved ♡'; }, 400);
  };

  /* numbers */
  const entries = () => { const o = []; Store.data.notebooks.forEach(n => n.topics.forEach(t => t.entries.forEach(e => o.push(e)))); return o; };
  const words = e => (String(e.body || '').match(/\S+/g) || []).length;
  const dayKey = d => new Date(d).toLocaleDateString('sv-SE');
  const dayNum = k => { const [y, m, d] = k.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
  function streaks(list) {
    const days = [...new Set(list.map(e => dayNum(dayKey(e.date))))].sort((a, b) => a - b), set = new Set(days);
    let best = 0, run = 0, prev = null;
    days.forEach(n => { run = prev !== null && n === prev + 1 ? run + 1 : 1; best = Math.max(best, run); prev = n; });
    let t = dayNum(dayKey(Date.now())); if (!set.has(t)) t--;
    let cur = 0; while (set.has(t)) { cur++; t--; }
    return { cur, best };
  }

  function renderStats(list) {
    const s = streaks(list), by = { morning: 0, afternoon: 0, evening: 0, night: 0 };
    list.forEach(e => by[Store.slot(new Date(e.date))]++);
    const max = Math.max(1, ...Object.values(by)), top = Object.entries(by).sort((a, b) => b[1] - a[1])[0];
    $('stats').innerHTML = [['Pages', list.length], ['Words', list.reduce((n, e) => n + words(e), 0).toLocaleString()],
      ['Day streak', s.cur], ['Best streak', s.best]].map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('');
    $('bars').innerHTML = Object.entries(by).map(([k, v]) =>
      `<div class="bar ${v && k === top[0] ? 'top' : ''}"><span>${Store.SLOTS[k]}</span><i style="width:${v / max * 100}%"></i><em>${v}</em></div>`).join('');
    $('barNote').textContent = list.length ? `You write most in the ${Store.SLOTS[top[0]].toLowerCase()}.` : 'Write a page to see your rhythm.';
  }

  function render() {
    const now = Store.authorFor(), list = entries(), per = {};
    list.forEach(e => { const p = per[e.author] = per[e.author] || { pages: 0, words: 0 }; p.pages++; p.words += words(e); });
    $('nowHint').textContent = `It’s ${Store.SLOTS[Store.slot()].toLowerCase()} right now, so a new page would be signed “${now.name}”.`;
    $('authorList').innerHTML = w.authors.map(a => {
      const f = Store.FONTS[a.font], p = per[a.id] || { pages: 0, words: 0 };
      return `<li class="pen ${a.id === now.id ? 'now' : ''}" style="--c:${a.color}">
        <div class="pen-head"><span class="avatar">${Store.esc(a.emoji)}</span>
          <div><b>${Store.esc(a.name)}</b><small>${p.pages} pages · ${p.words.toLocaleString()} words</small></div></div>
        <p class="sample" style="${f.css ? `font-family:${f.css};font-size:${f.size}` : ''}">“Dear diary…”</p>
        <div class="tags">${a.slots.length ? a.slots.map(s => `<span class="tag">${Store.SLOTS[s]}</span>`).join('') : '<span class="tag">Anytime</span>'}
          ${a.id === w.defaultId ? '<span class="tag def">default</span>' : ''}${a.id === now.id ? '<span class="tag">signing now</span>' : ''}</div>
        <div class="pen-actions"><button class="btn small" data-edit="${a.id}">Edit</button>
          ${a.id === w.defaultId ? '' : `<button class="btn small" data-def="${a.id}">Make default</button>`}</div></li>`;
    }).join('');
    renderStats(list);
  }

  $('authorList').addEventListener('click', ev => {
    const eid = ev.target.dataset.edit, did = ev.target.dataset.def;
    if (did) { w.defaultId = did; Store.save(); return render(); }
    if (!eid) return;
    const a = w.authors.find(x => x.id === eid);
    openEditor({ title: 'Edit pen name', name: a.name, emoji: a.emoji, slots: a.slots, font: a.font, color: a.color,
      onSave: v => { Object.assign(a, { name: v.name, emoji: v.emoji, color: v.color, slots: v.slots, font: v.font }); Store.save(); render(); },
      onDelete: w.authors.length > 1 ? () => {
        w.authors = w.authors.filter(x => x !== a);
        if (w.defaultId === a.id) w.defaultId = w.authors[0].id;
        Store.save(); render(); // old pages keep the name they were signed with
      } : null });
  });

  $('newAuthor').onclick = () => openEditor({ title: 'New pen name', name: '', emoji: '✒️', slots: [], font: 'caveat',
    color: Store.COLORS[(w.authors.length * 3) % Store.COLORS.length],
    onSave: v => { w.authors.push({ id: Store.uid(), name: v.name, emoji: v.emoji, color: v.color, slots: v.slots, font: v.font }); Store.save(); render(); } });

  render();
});