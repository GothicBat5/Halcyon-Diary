Store.ready.then(() => {
const shelf = document.getElementById('shelf');
const count = nb => nb.topics.reduce((n, t) => n + t.entries.length, 0);

function renderShelf() {
  const w = Store.data.writer, books = Store.data.notebooks;
  document.getElementById('hello').textContent = Store.GREET[Store.slot()] + (w.name ? ', ' + w.name : '') + '.';
  if (!books.length) { shelf.innerHTML = '<p class="empty-shelf">The shelf is empty. Add your first notebook.</p>'; return; }
  // each book is a real link, so opening works even without extra JS
  shelf.innerHTML = books.map(nb => `
    <div class="book" style="--c:${nb.color}">
      <a class="open" href="notebook.html?id=${encodeURIComponent(nb.id)}">
        <span class="emoji">${Store.esc(nb.emoji)}</span>
        <span class="label"><b>${Store.esc(nb.name)}</b><small>${nb.topics.length} topics · ${count(nb)} pages</small></span>
      </a>
      <button class="gear" data-edit="${Store.esc(nb.id)}" aria-label="Edit ${Store.esc(nb.name)}">✎</button>
    </div>`).join('');
}

shelf.addEventListener('click', e => {
  const g = e.target.closest('.gear'); if (!g) return;
  const nb = Store.data.notebooks.find(n => n.id === g.dataset.edit);
  openEditor({ title: 'Edit notebook', name: nb.name, emoji: nb.emoji, color: nb.color,
    onSave: v => { nb.name = v.name; nb.emoji = v.emoji; nb.color = v.color; Store.save(); renderShelf(); },
    onDelete: () => { Store.data.notebooks = Store.data.notebooks.filter(n => n !== nb); Store.save(); renderShelf(); } });
});

document.getElementById('newBook').onclick = () => openEditor({ title: 'New notebook', emoji: '📓',
  color: Store.COLORS[Math.floor(Math.random() * Store.COLORS.length)],
  onSave: v => { Store.data.notebooks.push({ id: Store.uid(), name: v.name, emoji: v.emoji, color: v.color, topics: [] }); Store.save(); renderShelf(); } });

renderShelf();
});