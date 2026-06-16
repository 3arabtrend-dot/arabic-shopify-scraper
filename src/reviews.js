const fs = require('fs');
const path = require('path');
const { DIR } = require('./progress');

/**
 * Build a Judge.me-compatible reviews CSV.
 * Columns follow Judge.me's import template. Reviews are kept in Arabic.
 * Each row maps to a product by handle (preferred) and sku.
 */
const HEADERS = [
  'title', 'body', 'rating', 'review_date',
  'reviewer_name', 'reviewer_email',
  'product_handle', 'product_id', 'sku', 'picture_urls',
];

function buildReviewsCsv(publishedResults) {
  const rows = [HEADERS.join(',')];
  let count = 0;

  for (const r of publishedResults) {
    if (r.status !== 'published' || !Array.isArray(r.reviews)) continue;
    for (const rev of r.reviews) {
      const row = [
        '',                                   // title (optional)
        rev.body || '',
        rev.rating || 5,
        normalizeDate(rev.date),
        rev.author || 'عميل',
        '',                                   // reviewer_email (left blank)
        r.handle || '',
        '',                                   // shopify product_id (handle is enough)
        r.sku || '',
        '',                                   // picture_urls
      ].map(csvCell);
      rows.push(row.join(','));
      count++;
    }
  }
  return { csv: rows.join('\n'), count };
}

function writeReviewsCsv(publishedResults, label = 'reviews') {
  const { csv, count } = buildReviewsCsv(publishedResults);
  const file = path.join(DIR, `${label}_${Date.now()}.csv`);
  fs.writeFileSync(file, '\ufeff' + csv, 'utf8'); // BOM so Arabic shows correctly in Excel
  return { file, count };
}

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function normalizeDate(d) {
  if (!d) return '';
  const m = String(d).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : d; // dd/mm/yyyy -> yyyy-mm-dd
}

module.exports = { buildReviewsCsv, writeReviewsCsv, HEADERS };
