/* Zusammenführen zweier Pixel-Quest-Stände (Mac <-> Handy). Nichts geht verloren. */
const LOCAL_ONLY = ['alwaysOnTop', 'notify', 'sort', 'sortDir', 'showDone', 'unpaintedStyle', 'showGrid'];
function mergeStates(L, R) {
  const out = JSON.parse(JSON.stringify(L));
  const notes = [];
  out.deleted = [...new Set([...(L.deleted || []), ...(R.deleted || [])])];
  const del = new Set(out.deleted);

  // Aufgaben: gleiche id = gleiche Aufgabe. Die zuletzt geänderte Version gewinnt (upd);
  // bei Gleichstand/alten Daten gilt: erledigt/archiviert/gelöscht gewinnt.
  const map = new Map();
  for (const t of [...(L.tasks || []), ...(R.tasks || [])]) {
    if (del.has(t.id)) continue;
    const o = map.get(t.id);
    if (!o) { map.set(t.id, { ...t }); continue; }
    const ou = o.upd || 0, tu = t.upd || 0, arch = !!(o.archived || t.archived);
    if (tu > ou) map.set(t.id, { ...t, archived: arch });
    else if (tu < ou) o.archived = arch;
    else {
      o.done = o.done || t.done; o.archived = arch; o.hidden = o.hidden || t.hidden;
      o.fields = Math.max(o.fields || 0, t.fields || 0);
    }
  }
  out.tasks = [...map.values()];

  // Bild
  const a = L.project, b = R.project;
  const same = a && b && ((a.id && a.id === b.id) || a.pixels === b.pixels) && a.painted.length === b.painted.length;
  if (!a && b) { out.project = JSON.parse(JSON.stringify(b)); out.bank = R.bank || 0; notes.push('Bild übernommen.'); }
  else if (a && b && same) {
    out.project.painted = a.painted.map((v, i) => !!(v || b.painted[i]));
    out.bank = Math.max(L.bank || 0, R.bank || 0);
    if (!out.project.id && b.id) out.project.id = b.id;
  } else if (a && b) {
    if ((b.created || 0) > (a.created || 0)) {
      out.project = JSON.parse(JSON.stringify(b)); out.bank = R.bank || 0;
      notes.push('Das andere Gerät hatte ein neueres Bild, es wurde übernommen.');
    } else notes.push('Dein Bild ist neuer als das andere, es bleibt.');
  }

  // Galerie: alle fertigen Bilder beider Geräte
  const gm = new Map();
  for (const g of [...(L.gallery || []), ...(R.gallery || [])]) if (!del.has(g.id) && !gm.has(g.id)) gm.set(g.id, g);
  out.gallery = [...gm.values()];

  // Einstellungen: Grade vom neueren Stand, Rest bleibt geräteabhängig
  const ls = L.settings || {}, rs = R.settings || {};
  out.settings = { ...ls };
  if (R.settings && (rs.gradesUpd || 0) >= (ls.gradesUpd || 0) && Array.isArray(rs.grades)) {
    out.settings.grades = rs.grades; out.settings.gradesUpd = rs.gradesUpd || ls.gradesUpd || 0;
  }
  for (const k of Object.keys(rs)) if (!LOCAL_ONLY.includes(k) && !(k in out.settings)) out.settings[k] = rs[k];
  return { state: out, notes };
}
if (typeof module !== 'undefined') module.exports = { mergeStates };
