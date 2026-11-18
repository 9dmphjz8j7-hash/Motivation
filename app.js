const view = new URLSearchParams(location.search).get('view') || 'main';
document.body.dataset.view = view;
const $ = s => document.querySelector(s);
let S, tab = 'todo', toastTimer;

/* ---------- Rechnen ---------- */
const earned = () => S.tasks.filter(t => t.done && !t.archived).reduce((a, t) => a + (t.fields || 0), 0);
const paintedCount = () => S.project ? S.project.painted.filter(Boolean).length : 0;
const bank = () => S.bank || 0;
const available = () => Math.max(0, bank() + earned() - paintedCount());
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
  setupTodo(); setupImage(); setupSettings(); setupSync(); setupGallery();
  window.addEventListener('resize', drawImage);
  if (ensureGallery()) api.set(S);
  setInterval(() => renderTodo(), 60000);
  render();
})();

function refreshBadge() {
  const a = available();
  $('#avail').textContent = a + (a === 1 ? ' Feld frei' : ' Felder frei');
  $('#avail').classList.toggle('zero', a === 0);
}
function render() {
  refreshBadge();
  if (view === 'main') {
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('on', p.id === tab));
    api.widgets().then(w => {
      $('#wTodo').textContent = w.todo ? 'To-Do-Widget schließen' : 'To-Do-Widget';
      $('#wImg').textContent = w.image ? 'Bild-Widget schließen' : 'Bild-Widget';
    });
  }
  renderTodo(); renderGradeSelects(); renderSettings(); drawImage(); renderGallery();
}

/* ---------- Aufgaben ---------- */
const URG = ['', 'green', 'yellow', 'red'], URG_TXT = ['Keine', 'Niedrig', 'Mittel', 'Hoch'];
let editId = null, formRem = [];
const pad = n => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const dueOf = t => t.dd ? new Date(`${t.dd}T${t.dt || '23:59'}`) : null;
const remLabel = m => m === 0 ? 'zur Deadline' : m % 1440 === 0 ? `${m / 1440} ${m === 1440 ? 'Tag' : 'Tage'} vorher` : m % 60 === 0 ? `${m / 60} Std. vorher` : `${m} Min. vorher`;
function fmtDue(t) {
  const d = dueOf(t); if (!d) return '';
  const day0 = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day0(d) - day0(new Date())) / 864e5);
  const dayTxt = diff === 0 ? 'heute' : diff === 1 ? 'morgen' : diff === -1 ? 'gestern'
    : d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
  return dayTxt + (t.dt ? ', ' + t.dt + ' Uhr' : '');
}
function renderGradeSelects() {
  const sel = $('#newGrade'), keep = sel.value;
  const html = S.settings.grades.map((f, i) => `<option value="${i + 1}">Grad ${i + 1} (${f} ${f === 1 ? 'Feld' : 'Felder'})</option>`).join('');
  if (sel.dataset.h !== html) { sel.innerHTML = html; sel.dataset.h = html; if (keep) sel.value = keep; }
}
function setupTodo() {
  $('#addForm').onsubmit = e => { e.preventDefault(); saveTask(); };
  $('#cancelEdit').onclick = resetForm;
  $('#clearDl').onclick = () => { $('#newDate').value = ''; $('#newTime').value = ''; };
  $('#remPreset').onchange = e => { if (e.target.value !== '') addRem(+e.target.value); e.target.value = ''; };
  $('#remAdd').onclick = () => { const n = parseInt($('#remNum').value); if (n > 0) { addRem(n * +$('#remUnit').value); $('#remNum').value = ''; } };
  $('#sortKey').onchange = e => { S.settings.sort = e.target.value; commit(); };
  $('#sortDir').onclick = () => { S.settings.sortDir = S.settings.sortDir === 'desc' ? 'asc' : 'desc'; commit(); };
  $('#showDone').onchange = e => { S.settings.showDone = e.target.checked; commit(); };
  renderChips();
}
function addRem(m) { if (!formRem.includes(m)) { formRem.push(m); formRem.sort((a, b) => b - a); renderChips(); } }
function renderChips() {
  const box = $('#remChips'); box.innerHTML = '';
  formRem.forEach(m => {
    const c = document.createElement('span'); c.className = 'chip'; c.textContent = remLabel(m) + ' ';
    const x = document.createElement('button'); x.type = 'button'; x.textContent = '✕'; x.setAttribute('aria-label', 'Erinnerung entfernen');
    x.onclick = () => { formRem = formRem.filter(v => v !== m); renderChips(); };
    c.appendChild(x); box.appendChild(c);
  });
}
function resetForm() {
  editId = null; formRem = []; renderChips();
  $('#newText').value = ''; $('#newDate').value = ''; $('#newTime').value = ''; $('#newUrg').value = '0';
  $('#newGrade').disabled = false; $('#saveBtn').textContent = 'Hinzufügen'; $('#cancelEdit').hidden = true; $('#more').open = false;
}
function saveTask() {
  const text = $('#newText').value.trim();
  if (!text) return;
  let dd = $('#newDate').value, dt = $('#newTime').value;
  if (dt && !dd) dd = todayStr(); // nur Uhrzeit = heute
  const f = { text, grade: +$('#newGrade').value || 1, urg: +$('#newUrg').value || 0, dd: dd || '', dt: dd ? dt : '', rem: dd ? [...formRem] : [], upd: Date.now() };
  const t = editId && S.tasks.find(x => x.id === editId);
  if (t) {
    if (t.done) f.grade = t.grade;
    const same = t.dd === f.dd && t.dt === f.dt && JSON.stringify(t.rem || []) === JSON.stringify(f.rem);
    Object.assign(t, f); if (!same) t.fired = [];
  } else S.tasks.push({ id: Date.now() + '' + Math.random(), done: false, fields: 0, fired: [], ...f });
  resetForm(); commit();
}
function startEdit(t) {
  editId = t.id; $('#newText').value = t.text; $('#newGrade').value = t.grade; $('#newGrade').disabled = !!t.done;
  $('#newUrg').value = t.urg || 0; $('#newDate').value = t.dd || ''; $('#newTime').value = t.dt || '';
  formRem = [...(t.rem || [])]; renderChips();
  $('#saveBtn').textContent = 'Speichern'; $('#cancelEdit').hidden = false; $('#more').open = !!t.dd;
  $('#newText').focus(); $('#addForm').scrollIntoView({ block: 'nearest' });
}
function sortedTasks(arr) {
  const key = S.settings.sort || 'created', dir = S.settings.sortDir === 'desc' ? -1 : 1;
  const val = t => key === 'grade' ? t.grade : key === 'urg' ? (t.urg || 0) : key === 'deadline' ? (dueOf(t) ? dueOf(t).getTime() : null) : null;
  return arr.map((t, i) => ({ t, i })).sort((a, b) => {
    if (!!a.t.done !== !!b.t.done) return a.t.done ? 1 : -1;      // Erledigte immer unten
    if (key === 'created') return (a.i - b.i) * dir;
    const va = val(a.t), vb = val(b.t);
    if (va === null && vb === null) return a.i - b.i;
    if (va === null) return 1; if (vb === null) return -1;         // ohne Deadline immer ans Ende
    return (va - vb) * dir || a.i - b.i;
  }).map(x => x.t);
}
function renderTodo() {
  const list = $('#list'), all = S.tasks.filter(t => !t.archived && !t.hidden);
  const tasks = sortedTasks(S.settings.showDone === false ? all.filter(t => !t.done) : all);
  $('#emptyTodo').style.display = all.length ? 'none' : 'block';
  $('#sortKey').value = S.settings.sort || 'created';
  $('#sortDir').textContent = S.settings.sortDir === 'desc' ? '↓ absteigend' : '↑ aufsteigend';
  $('#showDone').checked = S.settings.showDone !== false;
  // Hinweis auf fällige Aufgaben
  const now = new Date(), open = all.filter(t => !t.done && t.dd);
  const over = open.filter(t => dueOf(t) < now).length, today = open.filter(t => dueOf(t) >= now && t.dd === todayStr()).length;
  const bn = $('#dueBanner'), parts = [];
  if (over) parts.push(`${over} überfällig`); if (today) parts.push(`${today} heute fällig`);
  bn.textContent = parts.length ? '⚠ ' + parts.join(' · ') : ''; bn.style.display = parts.length ? 'block' : 'none';
  list.innerHTML = '';
  tasks.forEach(t => {
    const li = document.createElement('li');
    if (t.done) li.className = 'done';
    const fields = t.done ? t.fields : (S.settings.grades[t.grade - 1] ?? 0);
    li.innerHTML = '<input type="checkbox" aria-label="Erledigt"><span class="dot"></span><div class="body"><span class="t"></span><span class="meta"></span></div>' +
      '<button class="x edit" title="Bearbeiten" aria-label="Bearbeiten">✎</button><button class="x del" title="Löschen" aria-label="Löschen">✕</button>';
    li.querySelector('input').checked = !!t.done;
    const dot = li.querySelector('.dot');
    if (t.urg) { dot.className = 'dot ' + URG[t.urg]; dot.title = 'Dringlichkeit: ' + URG_TXT[t.urg]; } else dot.style.display = 'none';
    li.querySelector('.t').textContent = t.text;
    const meta = li.querySelector('.meta');
    meta.textContent = `Grad ${t.grade} · ${fields} ${fields === 1 ? 'Feld' : 'Felder'}`;
    if (t.dd) {
      const d = dueOf(t), sp = document.createElement('span');
      sp.textContent = ' · Fällig: ' + fmtDue(t) + (t.rem && t.rem.length ? ' · 🔔' + t.rem.length : '');
      if (!t.done) sp.className = d < now ? 'late' : (t.dd === todayStr() ? 'soon' : '');
      meta.appendChild(sp);
    }
    li.querySelector('input').onchange = e => toggleTask(t, e.target.checked);
    li.querySelector('.edit').onclick = () => startEdit(t);
    li.querySelector('.del').onclick = () => deleteTask(t);
    list.appendChild(li);
  });
}
function toggleTask(t, done) {
  if (!done && t.done) {
    if (bank() + earned() - t.fields < paintedCount()) {
      toast('Für diese Aufgabe hast du schon Felder ausgemalt.');
      return render();
    }
  }
  t.done = done; t.upd = Date.now();
  t.fields = done ? (S.settings.grades[t.grade - 1] ?? 0) : 0;
  commit();
  if (done && t.fields) toast(`+${t.fields} ${t.fields === 1 ? 'Feld' : 'Felder'} zum Ausmalen`);
}
function deleteTask(t) {
  if (t.done) { t.hidden = true; t.upd = Date.now(); toast('Gelöscht. Die Felder bleiben dir gutgeschrieben.'); } // Felder bleiben erhalten
  else { (S.deleted = S.deleted || []).push(t.id); S.tasks = S.tasks.filter(x => x !== t); }
  if (editId === t.id) resetForm();
  commit();
}

/* ---------- Einstellungen ---------- */
function setupSettings() {
  $('#addGrade').onclick = () => { const g = S.settings.grades; if (g.length < 10) { g.push((g[g.length - 1] || 1) + 2); S.settings.gradesUpd = Date.now(); commit(); } };
  $('#delGrade').onclick = () => { if (S.settings.grades.length > 1) { S.settings.grades.pop(); S.settings.gradesUpd = Date.now(); commit(); } };
  $('#style').onchange = e => { S.settings.unpaintedStyle = e.target.value; commit(); };
  $('#showGrid').onchange = e => { S.settings.showGrid = e.target.checked; commit(); };
  $('#onTop').onchange = e => { S.settings.alwaysOnTop = e.target.checked; commit(); };
  $('#notify').onchange = e => { S.settings.notify = e.target.checked; commit(); };
  $('#notifyTest').onclick = async () => { const r = api.notifyTest && await api.notifyTest(); toast(r === 'ok' ? 'Testmitteilung gesendet.' : 'Mitteilungen werden hier nicht unterstützt.'); };
}
function renderSettings() {
  const box = $('#gradeRows');
  if (box.contains(document.activeElement)) return;
  box.innerHTML = '';
  S.settings.grades.forEach((f, i) => {
    const r = document.createElement('div'); r.className = 'row';
    r.innerHTML = `<span>Grad ${i + 1} =</span><input type="number" min="0" max="999" value="${f}"><span>Felder</span>`;
    r.querySelector('input').onchange = e => { S.settings.grades[i] = Math.max(0, Math.min(999, parseInt(e.target.value) || 0)); S.settings.gradesUpd = Date.now(); commit(); };
    box.appendChild(r);
  });
  $('#style').value = S.settings.unpaintedStyle;
  $('#showGrid').checked = S.settings.showGrid;
  $('#onTop').checked = !!S.settings.alwaysOnTop;
  $('#notify').checked = S.settings.notify !== false;
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
function cellAtXY(px, py) {
  const p = S.project, r = $('#cv').getBoundingClientRect();
  const x = Math.floor((px - r.left) / sx), y = Math.floor((py - r.top) / sy);
  return (x < 0 || y < 0 || x >= p.cols || y >= p.rows) ? -1 : y * p.cols + x;
}
const cellAt = e => cellAtXY(e.clientX, e.clientY);
// Malt ein Feld. quiet = noch nicht speichern/neu zeichnen (für Wisch-Striche). Gibt true zurück, wenn neu ausgemalt.
function paintCell(i, quiet) {
  const p = S.project;
  if (!p || i < 0 || p.painted[i]) return false;
  if (available() < 1) { toast('Keine freien Felder. Erledige erst eine Aufgabe.'); painting = false; return false; }
  p.painted[i] = true;
  if (!quiet) afterPaint();
  return true;
}
let saveT = null;
function flushSave() { if (saveT) { clearTimeout(saveT); saveT = null; api.set(S); } }
function afterPaint() {
  drawImage(); refreshBadge();
  const p = S.project;
  if (paintedCount() === p.cols * p.rows) {
    ensureGallery(); clearTimeout(saveT); saveT = null; commit();
    toast('Geschafft! Das Bild ist fertig und liegt jetzt in der Galerie.');
    return;
  }
  clearTimeout(saveT); saveT = setTimeout(() => { saveT = null; api.set(S); }, 250);
}
// Alle Felder entlang einer Wischlinie ausmalen (auch bei schnellem Wischen ohne Lücken)
function strokeTo(from, e) {
  let changed = false;
  const dist = Math.hypot(e.clientX - from.x, e.clientY - from.y), step = Math.max(2, Math.min(sx, sy) / 2);
  const n = Math.max(1, Math.ceil(dist / step));
  for (let k = 0; k <= n && painting; k++) {
    const x = from.x + (e.clientX - from.x) * k / n, y = from.y + (e.clientY - from.y) * k / n;
    if (paintCell(cellAtXY(x, y), true)) changed = true;
  }
  return changed;
}
function setupImage() {
  const cv = $('#cv');
  let last = null, paintMode = false, pin = null;
  const ptrs = new Set();
  cv.addEventListener('pointerdown', e => {
    // Handy: ohne Malmodus wird nur verschoben/gezoomt, mit Malmodus malt ein Finger
    if (e.pointerType === 'touch') {
      ptrs.add(e.pointerId);
      if (ptrs.size > 1) { painting = false; return; }
      if (!paintMode) return;
    }
    cv.setPointerCapture(e.pointerId);
    painting = true; last = { x: e.clientX, y: e.clientY };
    if (paintCell(cellAtXY(e.clientX, e.clientY), true)) afterPaint();
  });
  cv.addEventListener('pointermove', e => {
    if (ptrs.size > 1) return;
    if (painting && last) { if (strokeTo(last, e)) afterPaint(); last = { x: e.clientX, y: e.clientY }; }
    if (e.pointerType === 'touch') return;
    const i = cellAt(e);
    if (i !== hover) { hover = i; drawImage(); }
  });
  const end = e => { ptrs.delete(e.pointerId); painting = false; last = null; flushSave(); };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener('pointerleave', () => { hover = -1; drawImage(); });
  // Zwei Finger = zoomen und verschieben (im Malmodus und ohne)
  const stg = $('#stage');
  const pinch = e => { const a = e.touches[0], b = e.touches[1]; return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2, d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1 }; };
  stg.addEventListener('touchstart', e => { if (e.touches.length === 2) { painting = false; pin = pinch(e); } }, { passive: true });
  stg.addEventListener('touchmove', e => {
    if (e.touches.length !== 2 || !pin) return;
    e.preventDefault();
    const n = pinch(e);
    zoomTo(zoom * n.d / pin.d, n.x, n.y);
    stg.scrollLeft -= n.x - pin.x; stg.scrollTop -= n.y - pin.y;
    pin = n;
  }, { passive: false });
  stg.addEventListener('touchend', e => { if (e.touches.length < 2) pin = null; }, { passive: true });
  $('#brush').onclick = () => {
    paintMode = !paintMode; if (!paintMode) { painting = false; flushSave(); }
    cv.classList.toggle('paintmode', paintMode);
    $('#brush').classList.toggle('on', paintMode);
    $('#brush').setAttribute('aria-pressed', paintMode);
    toast(paintMode ? 'Malmodus an: über die Felder wischen' : 'Malmodus aus: zoomen und verschieben ist wieder möglich');
  };
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
    ensureGallery();
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
  S = r.state; ensureGallery(); commit();
  toast(['Stand zusammengeführt.', ...r.notes].join(' '));
}


/* ---------- Galerie ---------- */
function ensureGallery() {
  const p = S.project;
  if (!p || paintedCount() < p.cols * p.rows) return false;
  if (!p.id) p.id = Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  S.gallery = S.gallery || [];
  if (S.gallery.some(g => g.id === p.id) || (S.deleted || []).includes(p.id)) return false;
  S.gallery.push({ id: p.id, cols: p.cols, rows: p.rows, aspect: p.aspect || p.cols / p.rows, pixels: p.pixels, finished: Date.now() });
  return true;
}
function drawPixels(cv, g) {
  cv.width = g.cols; cv.height = g.rows;
  const c = cv.getContext('2d'), im = c.createImageData(g.cols, g.rows);
  for (let i = 0; i < g.cols * g.rows; i++) {
    const o = parseInt(g.pixels.substr(i * 6, 6), 16);
    im.data[i * 4] = o >> 16; im.data[i * 4 + 1] = (o >> 8) & 255; im.data[i * 4 + 2] = o & 255; im.data[i * 4 + 3] = 255;
  }
  c.putImageData(im, 0, 0);
  cv.style.aspectRatio = String(g.aspect || g.cols / g.rows);
}
let galKey = '', galCur = null;
function renderGallery() {
  if (view !== 'main') return;
  if (tab !== 'gallery') { galKey = ''; return; }
  const items = [...(S.gallery || [])].sort((a, b) => b.finished - a.finished);
  const key = items.map(g => g.id).join('|');
  if (key === galKey) return;
  galKey = key;
  const box = $('#galGrid'); box.innerHTML = '';
  $('#emptyGal').style.display = items.length ? 'none' : 'block';
  items.forEach(g => {
    const b = document.createElement('button'); b.className = 'thumb';
    const cv = document.createElement('canvas'); drawPixels(cv, g);
    const cap = document.createElement('span'); cap.textContent = new Date(g.finished).toLocaleDateString('de-DE') + ' · ' + g.cols + '×' + g.rows;
    b.append(cv, cap); b.onclick = () => { galCur = g; drawPixels($('#galBig'), g); $('#galDlg').showModal(); };
    box.appendChild(b);
  });
}
function setupGallery() {
  $('#galClose').onclick = () => $('#galDlg').close();
  $('#galDel').onclick = () => {
    if (!galCur || !confirm('Dieses Bild aus der Galerie löschen?')) return;
    (S.deleted = S.deleted || []).push(galCur.id);
    S.gallery = S.gallery.filter(g => g.id !== galCur.id);
    $('#galDlg').close(); galKey = ''; commit();
  };
  $('#galSave').onclick = async () => {
    const g = galCur; if (!g) return;
    const cell = Math.max(4, Math.min(24, Math.floor(2400 / Math.max(g.cols, g.rows))));
    const w = g.cols * cell, h = Math.round(w / (g.aspect || g.cols / g.rows));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const c = cv.getContext('2d');
    for (let y = 0; y < g.rows; y++) for (let x = 0; x < g.cols; x++) {
      c.fillStyle = '#' + g.pixels.substr((y * g.cols + x) * 6, 6);
      const x0 = Math.round(x * w / g.cols), x1 = Math.round((x + 1) * w / g.cols), y0 = Math.round(y * h / g.rows), y1 = Math.round((y + 1) * h / g.rows);
      c.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
    const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
    const file = new File([blob], 'Pixel-Quest-Bild.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
  };
}
