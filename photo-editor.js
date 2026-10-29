/**
 * Local photo color concept tool. Walls are selected by the homeowner, never inferred. `onDraw` runs
 * after every repaint and after the photo is removed, so another view can mirror the canvas.
 */
export class PhotoEditor {
  constructor({ canvas, input, status, finish, undo, clear, download, remove, onDraw }) {
    Object.assign(this, { canvas, input, status, finish, undo, clear, download, remove, onDraw });
    this.context = canvas.getContext('2d');
    this.areas = []; this.points = []; this.color = '#829581'; this.serial = 0;
    this.cursor = { x: .5, y: .5 };
    input.addEventListener('change', () => {
      if (input.files[0]) this.setPhoto(input.files[0]).catch(error => { status.textContent = error.message; });
      input.value = '';
    });
    canvas.addEventListener('click', event => {
      if (!this.bitmap) return;
      const box = canvas.getBoundingClientRect();
      this.addPoint({ x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height });
    });
    canvas.addEventListener('keydown', event => {
      if (!this.bitmap) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Enter', 'Escape'].includes(event.key)) event.preventDefault();
      if (event.key.startsWith('Arrow')) {
        const delta = event.shiftKey ? .1 : .02;
        if (event.key === 'ArrowLeft') this.cursor.x -= delta;
        if (event.key === 'ArrowRight') this.cursor.x += delta;
        if (event.key === 'ArrowUp') this.cursor.y -= delta;
        if (event.key === 'ArrowDown') this.cursor.y += delta;
        this.cursor.x = Math.min(1, Math.max(0, this.cursor.x));
        this.cursor.y = Math.min(1, Math.max(0, this.cursor.y));
        this.draw(true, true);
      } else if (event.key === ' ') this.addPoint({ ...this.cursor });
      else if (event.key === 'Enter') this.finishArea();
      else if (event.key === 'Escape') { this.points = []; this.draw(); this.update(); }
    });
    finish.addEventListener('click', () => this.finishArea());
    undo.addEventListener('click', () => { if (this.points.length) this.points.pop(); else this.areas.pop(); this.draw(); this.update(); });
    clear.addEventListener('click', () => { this.areas = []; this.points = []; this.draw(); this.update(); });
    remove.addEventListener('click', () => this.reset());
    download.addEventListener('click', () => this.export());
    this.update();
  }
  async setPhoto(file, areas = []) {
    if (!(file instanceof Blob) || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPEG, PNG or WebP photo.');
    if (file.size > 12 * 1024 * 1024) throw new Error('Choose a photo smaller than 12 MB.');
    const serial = ++this.serial;
    let bitmap;
    try { bitmap = await createImageBitmap(file); } catch { throw new Error('This photo could not be opened. Try another JPEG, PNG or WebP.'); }
    if (serial !== this.serial) { bitmap.close(); return; }
    if (bitmap.width * bitmap.height > 40000000 || bitmap.width > 16000 || bitmap.height > 16000) { bitmap.close(); throw new Error('Choose a photo no larger than 40 megapixels.'); }
    this.bitmap?.close(); this.bitmap = bitmap; this.file = file;
    this.areas = Array.isArray(areas) ? areas.slice(0, 30).filter(area => Array.isArray(area) && area.length >= 3 && area.length <= 80 && area.every(p => typeof p?.x === 'number' && typeof p?.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)).map(area => area.map(p => ({ x: p.x, y: p.y }))) : [];
    this.points = [];
    const scale = Math.min(1, 1600 / bitmap.width, 1200 / bitmap.height);
    this.canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    this.canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    this.canvas.hidden = false;
    this.draw(); this.update();
  }
  reset() {
    this.serial++; this.bitmap?.close(); this.bitmap = null; this.file = null;
    this.areas = []; this.points = []; this.canvas.hidden = true; this.update(); this.onDraw?.();
  }
  setColor(color) { this.color = color; this.draw(); }
  addPoint(point) {
    if (this.points.length >= 80 || this.areas.length >= 30) { this.status.textContent = 'Finish or clear an area before adding more points.'; return; }
    this.points.push({ x: Math.max(0, Math.min(1, point.x)), y: Math.max(0, Math.min(1, point.y)) });
    this.draw(); this.update();
  }
  finishArea() {
    if (this.points.length < 3) return;
    this.areas.push(this.points); this.points = []; this.draw(); this.update();
  }
  path(points) {
    const ctx = this.context, { width, height } = this.canvas;
    ctx.beginPath(); points.forEach((p, i) => { if (i) ctx.lineTo(p.x * width, p.y * height); else ctx.moveTo(p.x * width, p.y * height); });
    ctx.closePath();
  }
  draw(guides = true, cursor = false) {
    if (!this.bitmap) return;
    const ctx = this.context, { width, height } = this.canvas;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(this.bitmap, 0, 0, width, height);
    for (const area of this.areas) {
      ctx.save(); this.path(area); ctx.clip();
      ctx.globalCompositeOperation = 'color'; ctx.globalAlpha = .8; ctx.fillStyle = this.color; ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = .35; ctx.fillRect(0, 0, width, height); ctx.restore();
    }
    if (!guides) return;
    ctx.lineWidth = Math.max(2, width / 500); ctx.strokeStyle = '#89C63F';
    for (const area of this.areas) { this.path(area); ctx.stroke(); }
    if (this.points.length) {
      ctx.beginPath(); this.points.forEach((p, i) => { if (i) ctx.lineTo(p.x * width, p.y * height); else ctx.moveTo(p.x * width, p.y * height); }); ctx.stroke();
      ctx.fillStyle = '#89C63F';
      for (const p of this.points) { ctx.beginPath(); ctx.arc(p.x * width, p.y * height, Math.max(4, width / 200), 0, Math.PI * 2); ctx.fill(); }
    }
    if (cursor) { ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(this.cursor.x * width, this.cursor.y * height, Math.max(6, width / 100), 0, Math.PI * 2); ctx.stroke(); }
    this.onDraw?.();
  }
  update() {
    this.finish.disabled = this.points.length < 3;
    this.undo.disabled = !this.points.length && !this.areas.length;
    this.clear.disabled = !this.points.length && !this.areas.length;
    this.download.disabled = !this.bitmap || !this.areas.length;
    this.remove.disabled = !this.bitmap;
    this.status.textContent = !this.bitmap ? 'Your photo stays on this device. Upload a clear exterior photo to begin.' : this.points.length ? `${this.points.length} corners selected. Add at least three, then choose Finish area.` : this.areas.length ? `${this.areas.length} wall area${this.areas.length === 1 ? '' : 's'} tinted. Change a swatch, or select another wall.` : 'Select wall corners with clicks, then Finish area. Keep windows and doors outside the selection. Keyboard: arrows move, Space adds a corner, Enter finishes.';
  }
  snapshot() { return this.file ? { blob: this.file, areas: this.areas.map(area => area.map(p => ({ ...p }))) } : null; }
  export() {
    if (!this.bitmap || !this.areas.length) return;
    this.draw(false);
    this.canvas.toBlob(blob => {
      this.draw();
      if (!blob) { this.status.textContent = 'Preview could not be exported. Please try again.'; return; }
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = 'curbquote-color-concept.png'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  }
}
