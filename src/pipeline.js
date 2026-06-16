const scraper = require('./scraper');
const translator = require('./translator');
const shopify = require('./shopify');
const reviews = require('./reviews');
const store = require('./progress');

/**
 * Run the full pipeline for ONE category.
 * opts:
 *   limit          - max products (for staged testing: 2, then 5, then Infinity)
 *   status         - 'draft' (default)
 *   priceMultiplier- default 1
 *   translate      - default true; false = scrape only (no API key needed)
 *   publish        - default true; false = dry run (no Shopify writes)
 *   withReviews    - default true
 */
async function runCategory(categoryUrl, opts = {}) {
  const {
    limit = Infinity, status = 'draft', priceMultiplier = 1,
    translate = true, publish = true, withReviews = true, style = 'ecommerce',
  } = opts;

  const categoryPath = scraper._internals.getParam(categoryUrl, 'path') || categoryUrl;
  console.log(`\n=== Category ${categoryPath} | limit=${limit} translate=${translate} publish=${publish} ===`);

  // 1) discover product links (resumable)
  const prog = store.loadProgress(categoryPath);
  let urls = Object.keys(prog.items);
  if (urls.length === 0) {
    urls = await scraper.collectProductLinks(categoryUrl, { maxProducts: limit });
    store.seedProgress(prog, urls);
  }
  const pending = store.pendingUrls(prog).slice(0, limit);
  console.log(`Discovered ${urls.length} | processing ${pending.length} pending\n`);

  const scraped = [];
  for (const url of pending) {
    try {
      const p = await scraper.extractProduct(url);

      if (p.isMultiVariant) {
        console.log(`  ⤼ skip (multi-variant): ${p.nameAr}`);
        store.markItem(prog, url, { status: 'skipped', reason: 'multi_variant', sku: p.sku });
        continue;
      }
      if (withReviews) p.reviews = await scraper.fetchReviews(url);
      console.log(`  ✓ scraped: ${p.nameAr} | price(exVAT)=${p.price} | imgs=${p.images.length} | reviews=${(p.reviews||[]).length} | sku=${p.sku}`);
      scraped.push({ url, p });
    } catch (e) {
      console.log(`  ✗ scrape error: ${shorten(url)} — ${e.message}`);
      store.markItem(prog, url, { status: 'error', error: e.message });
    }
  }

  // 2) translate (name + title + desc -> English; reviews stay Arabic)
  let prepared = scraped.map((s) => s.p);
  if (translate) {
    console.log(`\nTranslating ${prepared.length}...`);
    prepared = await translator.translateProducts(prepared, { style });
  }

  // 3) publish (draft, purchasable) or dry-run
  let published = [];
  if (publish) {
    console.log(`\nPublishing ${prepared.length}...`);
    published = await shopify.publishProducts(prepared, { status, priceMultiplier });
  } else {
    published = prepared.map((p) => ({ ...p, status: 'dry_run', handle: slug(p.nameEn || p.nameAr) }));
  }

  // 4) update progress + local dedup store
  for (let i = 0; i < scraped.length; i++) {
    const url = scraped[i].url;
    const res = published[i] || {};
    const final = res.status === 'published' ? 'done'
      : res.status === 'skipped_duplicate' ? 'skipped'
      : res.status === 'dry_run' ? 'pending' : 'error';
    store.markItem(prog, url, { status: final, sku: res.sku, shopifyId: res.shopifyId, error: res.error });
    const key = res.sku || prepared[i]?.sourceUrl;
    if (final === 'done' && key) store.markImported(key, { handle: res.handle, name: res.nameEn });
  }

  // 5) reviews CSV (Judge.me)
  let reviewsOut = { file: null, count: 0 };
  if (withReviews && publish) {
    reviewsOut = reviews.writeReviewsCsv(published, `reviews_path${categoryPath}`);
    console.log(`\nReviews CSV: ${reviewsOut.count} rows -> ${reviewsOut.file}`);
  }

  const summary = summarize(published);
  console.log(`\n=== Done: ${JSON.stringify(summary)} ===`);
  return { summary, published, reviewsFile: reviewsOut.file, reviewsCount: reviewsOut.count };
}

function summarize(results) {
  const s = { published: 0, skipped_duplicate: 0, error: 0, dry_run: 0 };
  for (const r of results) s[r.status] = (s[r.status] || 0) + 1;
  return s;
}
const slug = (n) => (n || 'product').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const shorten = (u) => (u || '').slice(-50);

module.exports = { runCategory };
