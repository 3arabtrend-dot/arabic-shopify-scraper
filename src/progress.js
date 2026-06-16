const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DIR, { recursive: true });

const IMPORTED = path.join(DIR, 'imported.json'); // local dedup store (never touches the store)

function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

/* ---- per-category checkpoint (resume after interruption) ---- */
function progressFile(categoryPath) {
  return path.join(DIR, `progress_${String(categoryPath).replace(/[^\w-]/g, '_')}.json`);
}
function loadProgress(categoryPath) {
  return loadJson(progressFile(categoryPath), { categoryPath, items: {} });
  // items: { [productUrl]: { status: pending|done|skipped|error, sku, error } }
}
function saveProgress(p) { saveJson(progressFile(p.categoryPath), p); }

function seedProgress(prog, urls) {
  for (const u of urls) if (!prog.items[u]) prog.items[u] = { status: 'pending' };
  saveProgress(prog);
  return prog;
}
function markItem(prog, url, patch) {
  prog.items[url] = { ...(prog.items[url] || {}), ...patch };
  saveProgress(prog);
}
function pendingUrls(prog) {
  return Object.entries(prog.items).filter(([, v]) => v.status === 'pending').map(([u]) => u);
}

/* ---- local imported store (dedup safety net for items without SKU) ---- */
function loadImported() { return loadJson(IMPORTED, {}); }
function isImported(key) { const all = loadImported(); return !!all[key]; }
function markImported(key, meta) {
  const all = loadImported();
  all[key] = { ...meta, at: new Date().toISOString() };
  saveJson(IMPORTED, all);
}

module.exports = {
  DIR, loadProgress, saveProgress, seedProgress, markItem, pendingUrls,
  isImported, markImported,
};
