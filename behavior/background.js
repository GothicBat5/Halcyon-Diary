Store.ready.then(async () => {
  const KEY = 'main';
  const layer = document.getElementById('bgLayer');
  let url = null;
  let blobNow = null;

  const show = blob => {
    if (url) URL.revokeObjectURL(url);
    blobNow = blob;
    url = blob ? URL.createObjectURL(blob) : null;
    layer.style.backgroundImage = url ? `url("${url}")` : '';
    document.body.classList.toggle('has-bg', !!url);
  };

  const shrink = (file, max = 1920) => new Promise((resolve, reject) => {
    const src = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k);
      c.height = Math.round(img.naturalHeight * k);
      const g = c.getContext('2d');
      g.fillStyle = '#fff7f2';
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(src);
      const fail = () => reject(new Error('Couldn’t process that image.'));
      c.toBlob(b => {
        if (b && b.type === 'image/webp') return resolve(b);
        c.toBlob(j => (j ? resolve(j) : fail()), 'image/jpeg', .85);
      }, 'image/webp', .82);
    };
    img.onerror = () => {
      URL.revokeObjectURL(src);
      reject(new Error('That file couldn’t be read as an image.'));
    };
    img.src = src;
  });

  const openDialog = () => {
    const dlg = document.createElement('dialog');
    dlg.className = 'bg-dialog';
    dlg.innerHTML = `<h2>Background</h2>
      <div class="bg-preview" id="bgPrev"><span>No image yet</span></div>
      <p class="dhint" id="bgMsg" role="status">Pick a photo from your device. It stays on this device and is resized to keep the diary light.</p>
      <input type="file" id="bgFile" accept="image/*" hidden>
      <div class="dlg-actions">
        <button type="button" class="btn danger small left" id="bgDel">Remove</button>
        <button type="button" class="btn small" id="bgClose">Close</button>
        <button type="button" class="btn primary small" id="bgPick">Choose image</button>
      </div>`;
    const $ = id => dlg.querySelector('#' + id);
    const msg = t => { $('bgMsg').textContent = t; };
    const sync = () => {
      $('bgPrev').style.backgroundImage = url ? `url("${url}")` : '';
      $('bgPrev').classList.toggle('filled', !!url);
      $('bgDel').disabled = !url;
    };

    $('bgPick').onclick = () => $('bgFile').click();
    $('bgClose').onclick = () => dlg.close();
    $('bgFile').onchange = async () => {
      const f = $('bgFile').files[0];
      $('bgFile').value = '';
      if (!f) return;
      if (!f.type.startsWith('image/')) return msg('Please choose an image file.');
      msg('Saving…');
      try {
        const blob = await shrink(f);
        await Store.putImage(KEY, blob);
        show(blob);
        sync();
        msg(`Saved (${Math.max(1, Math.round(blob.size / 1024))} KB).`);
      } catch (e) {
        msg(e.message || 'Couldn’t save that image.');
      }
    };
    $('bgDel').onclick = async () => {
      try {
        await Store.deleteImage(KEY);
        show(null);
        sync();
        msg('Background removed.');
      } catch (e) {
        msg('Couldn’t remove it. Try again.');
      }
    };

    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    sync();
    dlg.showModal();
  };

  document.getElementById('bgBtn').onclick = openDialog;

  try {
    const saved = await Store.getImage(KEY);
    if (saved) show(saved);
  } catch (e) {}
});