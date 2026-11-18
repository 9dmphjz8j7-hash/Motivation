/* Ersatz für die Mac-Schnittstelle: speichert im Handy (localStorage), teilt per Teilen-Menü (AirDrop). */
(() => {
  const KEY = 'pixelquest-v1';
  const DEF = { tasks: [], deleted: [], gallery: [], bank: 0, settings: { grades: [1, 2, 3, 5, 8], unpaintedStyle: 'grid', showGrid: true }, project: null };
  let st;
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    st = { ...DEF, ...d, settings: { ...DEF.settings, ...(d && d.settings) } };
  } catch { st = JSON.parse(JSON.stringify(DEF)); }
  document.body.classList.add('web');
  window.api = {
    get: async () => st,
    set: s => { st = s; try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { alert('Speichern hat nicht geklappt (Speicher voll?).'); } },
    widgets: async () => ({}), toggle() {}, onState() {},
    share: async json => {
      const file = new File([json], 'PixelQuest-Stand.json', { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: 'Pixel-Quest Stand' }); return; }
        catch (e) { if (e.name === 'AbortError') return; }
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file); a.download = file.name; a.click();
    }
  };
  if ('serviceWorker' in navigator) {
    let had = !!navigator.serviceWorker.controller, reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (had && !reloaded) { reloaded = true; location.reload(); } had = true; });
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
