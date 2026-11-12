Store.ready.then(() => {
  const $ = id => document.getElementById(id);
  const nb = Store.data.notebooks.find(n => n.id === new URLSearchParams(location.search).get('id'));
  if (!nb) {
    document.querySelector('.layout').innerHTML = '<p class="empty" style="grid-column:1/-1">That notebook isn’t on the shelf. <a href="index.html">Back to the shelf</a></p>';
    return;
  }

  let topicId = nb.topics[0]?.id, entryId = null, timer;
  const topic = () => nb.topics.find(t => t.id === topicId);
  const entry = () => topic()?.entries.find(e => e.id === entryId);
  const fmt = d => new Date(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const authorName = e => (Store.data.writer.authors.find(a => a.id === e.author) || {}).name || e.authorName || '';

  function applyFont(key) {
    const f = Store.FONTS[key], p = $('paper');
    if (f && f.css) { p.style.setProperty('--hand', f.css); p.style.setProperty('--hand-size', f.size); }
    else { p.style.removeProperty('--hand'); p.style.removeProperty('--hand-size'); }
  }

  function render() {
    const t = topic(), e = entry();
    document.documentElement.style.setProperty('--c', e && t ? t.color : nb.color);
    $('nbTitle').textContent = nb.emoji + ' ' + nb.name;
    document.title = nb.name + ' · My Cozy Diary';
    $('topicList').innerHTML = nb.topics.map(x => `
      <li><div class="topic ${x.id === topicId ? 'on' : ''}" data-t="${x.id}" style="--c:${x.color}" role="button" tabindex="0">
        <i></i><span>${Store.esc(x.name)}</span><button class="edit" aria-label="Edit topic">✎</button></div></li>`).join('')
      || '<li class="empty-note">Add a topic to begin.</li>';
    $('newEntry').disabled = !t;
    $('entryList').innerHTML = t ? (t.entries.length ? [...t.entries].reverse().map(x => `
      <li><button class="entry ${x.id === entryId ? 'on' : ''}" data-e="${x.id}" style="--c:${t.color}">
        <b>${Store.esc(x.title || 'Untitled page')}</b><small>${fmt(x.date)}${authorName(x) ? ' · ✒ ' + Store.esc(authorName(x)) : ''}</small><p>${Store.esc(x.body)}</p></button></li>`).join('')
      : '<li class="empty-note">No pages yet. Start one!</li>') : '';
    $('editor').classList.toggle('has', !!e);
    if (e) {
      $('entryTitle').value = e.title; $('entryBody').value = e.body; $('entryDate').textContent = fmt(e.date); $('saved').textContent = '';
      const list = Store.data.writer.authors.slice();
      const opts = list.map(a => `<option value="${a.id}" ${a.id === e.author ? 'selected' : ''}>${Store.esc(a.emoji + ' ' + a.name)}</option>`);
      if (!list.some(a => a.id === e.author)) opts.unshift(`<option value="${Store.esc(e.author || '')}" selected>${Store.esc(e.authorName || 'Unknown')}</option>`);
      $('entryAuthor').innerHTML = opts.join('');
      applyFont((list.find(a => a.id === e.author) || {}).font);
      $('entryBody').placeholder = Store.promptFor();
    }
  }

  function autosave() {
    const e = entry(); if (!e) return;
    e.title = $('entryTitle').value; e.body = $('entryBody').value;
    $('saved').textContent = 'saving…';
    clearTimeout(timer);
    timer = setTimeout(() => {
      Store.save(); $('saved').textContent = 'saved ♡';
      const on = document.querySelector('.entry.on'); // update list text without re-rendering the editor
      if (on) { on.querySelector('b').textContent = e.title || 'Untitled page'; on.querySelector('p').textContent = e.body; }
    }, 500);
  }
  $('entryTitle').oninput = $('entryBody').oninput = autosave;

  $('entryAuthor').onchange = () => {
    const e = entry(), a = Store.data.writer.authors.find(x => x.id === $('entryAuthor').value); if (!e || !a) return;
    e.author = a.id; e.authorName = a.name; Store.save(); applyFont(a.font);
    const small = document.querySelector('.entry.on small'); if (small) small.textContent = fmt(e.date) + ' · ✒ ' + a.name;
    $('saved').textContent = 'signed ♡';
  };

  function pick(t, e) { topicId = t; entryId = e; $('layout').classList.toggle('editing', !!e); render(); }

  $('topicList').addEventListener('click', ev => {
    const row = ev.target.closest('[data-t]'); if (!row) return;
    const t = nb.topics.find(x => x.id === row.dataset.t);
    
    if (ev.target.closest('.edit')) return openEditor({ title: 'Edit topic', name: t.name, color: t.color,
      onSave: v => { t.name = v.name; t.color = v.color; Store.save(); render(); },
      onDelete: () => { nb.topics = nb.topics.filter(x => x !== t); Store.save(); pick(nb.topics[0]?.id, null); } });
    pick(t.id, null);
  });
  $('topicList').addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.target.dataset.t) ev.target.click(); });
  $('entryList').addEventListener('click', ev => { const b = ev.target.closest('[data-e]'); if (b) pick(topicId, b.dataset.e); });

  $('newTopic').onclick = () => openEditor({ title: 'New topic', color: Store.COLORS[(nb.topics.length * 2) % Store.COLORS.length],
    onSave: v => { const t = { id: Store.uid(), name: v.name, color: v.color, entries: [] }; nb.topics.push(t); Store.save(); pick(t.id, null); } });
  $('newEntry').onclick = () => { const e = Store.mkEntry('', ''); topic().entries.push(e); Store.save(); pick(topicId, e.id); $('entryTitle').focus(); };
  $('delEntry').onclick = () => { if (!confirm('Delete this page?')) return; const t = topic(); t.entries = t.entries.filter(e => e.id !== entryId); Store.save(); pick(topicId, null); };
  $('backToList').onclick = () => pick(topicId, null);
  $('editBook').onclick = () => openEditor({ title: 'Notebook cover', name: nb.name, emoji: nb.emoji, color: nb.color,
    onSave: v => { nb.name = v.name; nb.emoji = v.emoji; nb.color = v.color; Store.save(); render(); } });

  render();
});