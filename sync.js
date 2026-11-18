/* Zusammenführen zweier Pixel-Quest-Stände (Mac <-> Handy). Nichts geht verloren. */
function mergeStates(L, R) {
  const out = JSON.parse(JSON.stringify(L));
  const notes = [];
  out.deleted = [...new Set([...(L.deleted || []), ...(R.deleted || [])])];
  const del = new Set(out.deleted);

  // Aufgaben: gleiche id = gleiche Aufgabe; erledigt/archiviert gewinnt
  const map = new Map();
  for (const t of [...(L.tasks || []), ...(R.tasks || [])]) {
    if (del.has(t.id)) continue;
    const o = map.get(t.id);
    if (!o) { map.set(t.id, { ...t }); continue; }
    o.done = o.done || t.done;
    o.archived = o.archived || t.archived;
    o.fields = Math.max(o.fields || 0, t.fields || 0);
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

  // Einstellungen vom importierten Stand, außer geräteabhängigem "Vordergrund"
  if (R.settings) out.settings = { ...L.settings, ...R.settings, alwaysOnTop: !!(L.settings && L.settings.alwaysOnTop) };
  return { state: out, notes };
}
if (typeof module !== 'undefined') module.exports = { mergeStates };
