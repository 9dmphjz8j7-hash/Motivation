const view = new URLSearchParams(location.search).get('view') || 'main';
document.body.dataset.view = view;
const $ = s => document.querySelector(s);
let S, tab = 'todo', toastTimer;

/* ---------- Rechnen ---------- */
const earned = () => S.tasks.filter(t => t.done && !t.archived).reduce((a, t) => a + (t.fields || 0), 0);
const paintedCount = () => S.project ? S.project.painted.filter(Boolean).length : 0;
const available = () => Math.max(0, (S.bank || 0) + earned() - paintedCount());
const colorAt = i => '#' + S.project.pixels.substr(i * 6, 6);
function commit() { api.set(S); render(); }

/* ---------- Start ---------- */
(async function init() {
  S = await api.get();
  api.onState(s => { S = s; render(); });
  if (view === 'main') {
    document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => { tab = b.dataset.tab; render(); });
    $('#wTodo').onclick = () => api.toggle('todo');
    $('#wImg').onclick = () => api.toggle('image');
  }
  setupTodo(); setupImage(); setupSettings(); setupSync();
  window.addEventListener('resize', drawImage);
  render();
})();

function render() {
  const a = available();
  $('#avail').textContent = a + (a === 1 ? ' Feld frei' : ' Felder frei');
  $('#avail').classList.toggle('zero', a === 0);
  if (view === 'main') {
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('on', p.id === tab));
    api.widgets().then(w => {
      $('#wTodo').textContent = w.todo ? 'To-Do-Widget schließen' : 'To-Do-Widget';
      $('#wImg').textContent = w.image ? 'Bild-Widget schließen' : 'Bild-Widget';
    });
  }
  renderTodo(); renderGradeSelects(); renderSettings(); drawImage();
}

/* ---------- Aufgaben ---------- */
function renderGradeSelects() {
  const sel = $('#newGrade'), keep = sel.value;
  const html = S.settings.grades.map((f, i) => `<option value="${i + 1}">Grad ${i + 1} (${f} ${f === 1 ? 'Feld' : 'Felder'})</option>`).join('');
  if (sel.dataset.h !== html) { sel.innerHTML = html; sel.dataset.h = html; if (keep) sel.value = keep; }
}
function setupTodo() {
  $('#addForm').onsubmit = e => {
    e.preventDefault();
    const text = $('#newText').value.trim();
    if (!text) return;
    S.tasks.push({ id: Date.now() + '' + Math.random(), text, grade: +$('#newGrade').value || 1, done: false, fields: 0 });
    $('#newText').value = '';
    commit();
  };
}
function renderTodo() {
  const list = $('#list');
  const tasks = S.tasks.filter(t => !t.archived);
  $('#emptyTodo').style.display = tasks.length ? 'none' : 'block';
  list.innerHTML = '';
  tasks.forEach(t => {
    const li = document.createElement('li');
    if (t.done) li.className = 'done';
    const fields = t.done ? t.fields : (S.settings.grades[t.grade - 1] ?? 0);
    li.innerHTML = `<input type="checkbox" ${t.done ? 'checked' : ''} aria-label="Erledigt"><span class="t"></span><span class="grade">Grad ${t.grade} · ${fields} ${fields === 1 ? 'Feld' : 'Felder'}</span><button class="x" title="Löschen" aria-label="Löschen">✕</button>`;
    li.querySelector('.t').textContent = t.text;
    li.querySelector('input').onchange = e => toggleTask(t, e.target.checked);
    li.querySelector('.x').onclick = () => deleteTask(t);
    list.appendChild(li);
  });
}
function toggleTask(t, done) {
  if (!done && t.done) {
    if ((S.bank || 0) + earned() - t.fields < paintedCount()) {
      toast('Für diese Aufgabe hast du schon Felder ausgemalt.');
      return render();
    }
  }
  t.done = done;
  t.fields = done ? (S.settings.grades[t.grade - 1] ?? 0) : 0;
  commit();
  if (done && t.fields) toast(`+${t.fields} ${t.fields === 1 ? 'Feld' : 'Felder'} zum Ausmalen`);
}
function deleteTask(t) {
  if (t.done && (S.bank || 0) + earned() - t.fields < paintedCount()) { toast('Für diese Aufgabe hast du schon Felder ausgemalt.'); return; }
  (S.deleted = S.deleted || []).push(t.id);
  S.tasks = S.tasks.filter(x => x !== t);
  commit();
}

/* ---------- Einstellungen ---------- */
function setupSettings() {
  $('#addGrade').onclick = () => { const g = S.settings.grades; if (g.length < 10) { g.push((g[g.length - 1] || 1) + 2); commit(); } };
  $('#delGrade').onclick = () => { if (S.settings.grades.length > 1) { S.settings.grades.pop(); commit(); } };
  $('#style').onchange = e => { S.settings.unpaintedStyle = e.target.value; commit(); };
  $('#showGrid').onchange = e => { S.settings.showGrid = e.target.checked; commit(); };
  $('#onTop').onchange = e => { S.settings.alwaysOnTop = e.target.checked; commit(); };
}
function renderSettings() {
  const box = $('#gradeRows');
  if (box.contains(document.activeElement)) return;
  box.innerHTML = '';
  S.settings.grades.forEach((f, i) => {
    const r = document.createElement('div'); r.className = 'row';
    r.innerHTML = `<span>Grad ${i + 1} =</span><input type="number" min="0" max="999" value="${f}"><span>Felder</span>`;
    r.querySelector('input').onchange = e => { S.settings.grades[i] = Math.max(0, Math.min(999, parseInt(e.target.value) || 0)); commit(); };
    box.appendChild(r);
  });
  $('#style').value = S.settings.unpaintedStyle;
  $('#showGrid').checked = S.settings.showGrid;
  $('#onTop').checked = !!S.settings.alwaysOnTop;
}

/* ---------- Bild zeichnen ---------- */
let sx = 1, sy = 1, hover = -1, painting = false, zoom = 1, maxZoom = 1;
function drawImage() {
  const cv = $('#cv'), p = S.project, stage = $('#stage');
  $('#empty').style.display = p ? 'none' : 'block';
  cv.style.display = p ? 'block' : 'none';
  if (!p) { $('#prog').textContent = ''; $('#zoomBar').style.display = 'none'; return; }
  const W = stage.clientWidth, H = stage.clientHeight;
  if (W < 10 || H < 10) return;
  const aspect = p.aspect || p.cols / p.rows;
  const dpr = window.devicePixelRatio || 1, fitW = Math.min(W, H * aspect);
  maxZoom = Math.max(1, Math.min(40, 7000 / (fitW * dpr)));
  zoom = Math.max(1, Math.min(zoom, maxZoom));
  const cw = fitW * zoom, ch = cw / aspect;
  $('#zoomBar').style.display = 'flex'; $('#zReset').textContent = Math.round(zoom * 100) + ' %';
  sx = cw / p.cols; sy = ch / p.rows;
  cv.style.width = cw + 'px'; cv.style.height = ch + 'px';
  cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const st = S.settings.unpaintedStyle, grid = S.settings.showGrid;
  const bg = getComputedStyle(document.body).getPropertyValue('--card').trim() || '#fff';
  c.fillStyle = bg; c.fillRect(0, 0, cw, ch);
  for (let y = 0; y < p.rows; y++) for (let x = 0; x < p.cols; x++) {
    const i = y * p.cols + x;
    const x0 = Math.round(x * sx), x1 = Math.round((x + 1) * sx), y0 = Math.round(y * sy), y1 = Math.round((y + 1) * sy);
    if (p.painted[i]) { c.fillStyle = colorAt(i); c.fillRect(x0, y0, x1 - x0, y1 - y0); continue; }
    const col = colorAt(i), r = parseInt(col.substr(1, 2), 16), g = parseInt(col.substr(3, 2), 16), b = parseInt(col.substr(5, 2), 16);
    const lum = Math.round(.299 * r + .587 * g + .114 * b);
    c.fillStyle = st === 'gray' ? `rgb(${lum},${lum},${lum})`
      : st === 'faded' ? `rgb(${lift(r)},${lift(g)},${lift(b)})`
      : st === 'dark' ? '#2a2f3d' : '#e4e7ef';
    c.fillRect(x0, y0, x1 - x0, y1 - y0);
    if (grid && Math.min(sx, sy) > 5) { c.strokeStyle = st === 'dark' ? '#444b5f' : 'rgba(120,130,155,.35)'; c.lineWidth = 1; c.strokeRect(x0 + .5, y0 + .5, x1 - x0 - 1, y1 - y0 - 1); }
  }
  if (hover >= 0 && !p.painted[hover] && available() > 0) {
    const x = hover % p.cols, y = Math.floor(hover / p.cols);
    c.strokeStyle = '#2f54eb'; c.lineWidth = 2;
    c.strokeRect(Math.round(x * sx) + 1, Math.round(y * sy) + 1, sx - 2, sy - 2);
  }
  const done = paintedCount(), total = p.cols * p.rows;
  $('#prog').textContent = done === total ? 'Fertig! Das Bild ist komplett.' : `${done} von ${total} Feldern ausgemalt (${Math.floor(done / total * 100)} %)`;
}
const lift = v => Math.round(v + (255 - v) * .68); // blasse Vorschau: Richtung Weiß aufgehellt
function zoomTo(z, cx, cy) {
  if (!S.project) return;
  const stg = $('#stage'), cv = $('#cv'), sr = stg.getBoundingClientRect();
  if (cx == null) { cx = sr.left + sr.width / 2; cy = sr.top + sr.height / 2; }
  const r = cv.getBoundingClientRect();
  const fx = Math.min(1, Math.max(0, (cx - r.left) / r.width)), fy = Math.min(1, Math.max(0, (cy - r.top) / r.height));
  zoom = Math.max(1, Math.min(maxZoom, z));
  drawImage();
  const n = cv.getBoundingClientRect();
  stg.scrollLeft += n.left + fx * n.width - cx;
  stg.scrollTop += n.top + fy * n.height - cy;
}
function cellAt(e) {
  const p = S.project, r = $('#cv').getBoundingClientRect();
  const x = Math.floor((e.clientX - r.left) / sx), y = Math.floor((e.clientY - r.top) / sy);
  return (x < 0 || y < 0 || x >= p.cols || y >= p.rows) ? -1 : y * p.cols + x;
}
function paintCell(i) {
  const p = S.project;
  if (i < 0 || p.painted[i]) return;
  if (available() < 1) { toast('Keine freien Felder. Erledige erst eine Aufgabe.'); painting = false; return; }
  p.painted[i] = true;
  commit();
  if (paintedCount() === p.cols * p.rows) toast('Geschafft! Das Bild ist fertig.');
}
function setupImage() {
  const cv = $('#cv');
  let tap = null;
  cv.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') { tap = { x: e.clientX, y: e.clientY }; return; } // Handy: antippen, Wischen = Bild verschieben
    painting = true; cv.setPointerCapture(e.pointerId); paintCell(cellAt(e));
  });
  cv.addEventListener('pointerup', e => {
    if (e.pointerType === 'touch' && tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 8) paintCell(cellAt(e));
    tap = null;
  });
  cv.addEventListener('pointercancel', () => { tap = null; });
  cv.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return;
    const i = cellAt(e);
    if (painting) paintCell(i);
    if (i !== hover) { hover = i; drawImage(); }
  });
  cv.addEventListener('pointerup', () => painting = false);
  cv.addEventListener('pointerleave', () => { hover = -1; drawImage(); });
  $('#zIn').onclick = () => zoomTo(zoom * 1.5);
  $('#zOut').onclick = () => zoomTo(zoom / 1.5);
  $('#zReset').onclick = () => { zoomTo(1); $('#stage').scrollTo(0, 0); };
  $('#stage').addEventListener('wheel', e => {
    if (!(e.ctrlKey || e.metaKey)) return; // normales Scrollen = Bild verschieben
    e.preventDefault();
    zoomTo(zoom * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
  }, { passive: false });
  $('#newImg').onclick = () => {
    if (S.project && paintedCount() < S.project.cols * S.project.rows &&
      !confirm('Das aktuelle Bild ist noch nicht fertig. Wirklich ein neues Bild starten? Der Fortschritt geht verloren.')) return;
    openDialog();
  };
  $('#firstImg').onclick = openDialog;
  setupDialog();
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ---------- Bild importieren ---------- */
let srcCanvas = null, result = null;
function openDialog() {
  srcCanvas = null; result = null; $('#file').value = ''; $('#ok').disabled = true;
  $('#pv').width = 0; $('#dims').textContent = 'Wähle ein Bild von deinem Mac.';
  $('#dlg').showModal();
}
function setupDialog() {
  $('#cancel').onclick = () => $('#dlg').close();
  $('#cols').oninput = convert;
  $('#file').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const img = new Image();
    img.onload = () => {
      const m = Math.min(1, 900 / Math.max(img.width, img.height));
      srcCanvas = document.createElement('canvas');
      srcCanvas.width = Math.max(1, Math.round(img.width * m)); srcCanvas.height = Math.max(1, Math.round(img.height * m));
      const c = srcCanvas.getContext('2d', { willReadFrequently: true });
      c.fillStyle = '#fff'; c.fillRect(0, 0, srcCanvas.width, srcCanvas.height);
      c.drawImage(img, 0, 0, srcCanvas.width, srcCanvas.height);
      URL.revokeObjectURL(img.src); convert();
    };
    img.onerror = () => $('#dims').textContent = 'Dieses Bild konnte nicht gelesen werden.';
    img.src = URL.createObjectURL(f);
  };
  $('#ok').onclick = () => {
    if (!result) return;
    const done = S.tasks.filter(t => t.done && !t.archived);
    S.bank = available();
    done.forEach(t => t.archived = true);
    S.project = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 6), created: Date.now(), cols: result.cols, rows: result.rows, aspect: result.aspect, pixels: result.pixels, painted: new Array(result.cols * result.rows).fill(false) };
    $('#dlg').close(); tab = 'image'; commit();
  };
}
function convert() {
  if (!srcCanvas) return;
  const sw = srcCanvas.width, sh = srcCanvas.height, aspect = sw / sh;
  const total = Math.round(100 * Math.pow(120, +$('#cols').value / 100)); // 100 bis 12000 Felder
  const cols = Math.max(2, Math.round(Math.sqrt(total * aspect)));
  const rows = Math.max(2, Math.round(cols / aspect));
  const data = srcCanvas.getContext('2d').getImageData(0, 0, sw, sh).data;
  let hex = '';
  const pv = $('#pv'); pv.width = cols; pv.height = rows;
  const pc = pv.getContext('2d');
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const x0 = Math.floor(x * sw / cols), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sw / cols));
    const y0 = Math.floor(y * sh / rows), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sh / rows));
    let r = 0, g = 0, b = 0, n = 0;
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const k = (yy * sw + xx) * 4; r += data[k]; g += data[k + 1]; b += data[k + 2]; n++; }
    r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
    hex += [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
    pc.fillStyle = `rgb(${r},${g},${b})`; pc.fillRect(x, y, 1, 1);
  }
  const pw = Math.min(480, 300 * aspect);
  pv.style.width = pw + 'px'; pv.style.height = (pw / aspect) + 'px';
  result = { cols, rows, aspect, pixels: hex };
  $('#dims').textContent = `${cols} × ${rows} = ${cols * rows} Felder`;
  $('#ok').disabled = false;
}

/* ---------- Synchronisieren ---------- */
function setupSync() {
  $('#syncBtn').onclick = async () => {
    try { await api.share(JSON.stringify({ app: 'pixelquest', version: 1, exportedAt: Date.now(), data: S })); }
    catch (e) { toast('Teilen hat nicht geklappt.'); }
  };
  $('#impBtn').onclick = () => $('#impFile').click();
  $('#impFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); };
  addEventListener('dragover', e => e.preventDefault());
  addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f && /\.json$/i.test(f.name)) importFile(f); });
}
async function importFile(f) {
  let j;
  try { j = JSON.parse(await f.text()); } catch { j = null; }
  if (!j || j.app !== 'pixelquest' || !j.data) return toast('Das ist keine Pixel-Quest-Datei.');
  const r = mergeStates(S, j.data);
  S = r.state; commit();
  toast(['Stand zusammengeführt.', ...r.notes].join(' '));
}
