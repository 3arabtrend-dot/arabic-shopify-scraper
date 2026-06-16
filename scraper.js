const cheerio = require('cheerio');
const { getHtml, urlExists } = require('./http');

const VAT_RATE = parseFloat(process.env.SOURCE_VAT_RATE || '0.05'); // Oman VAT 5%

/* ============================================================
 *  CATEGORY DISCOVERY
 *  Pull every  route=product/category&path=N  link from the menu.
 * ============================================================ */
async function discoverCategories(baseUrl) {
  const origin = new URL(baseUrl).origin;
  const html = await getHtml(baseUrl);
  const $ = cheerio.load(html);

  const cats = new Map(); // path -> {path, url, name}
  $('a[href*="route=product/category"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const abs = toAbsolute(href, origin);
    const path = getParam(abs, 'path');
    if (!path) return;
    const name = $(el).text().trim();
    if (!cats.has(path) || (name && !cats.get(path).name)) {
      cats.set(path, { path, url: abs, name: name || `path=${path}` });
    }
  });

  return [...cats.values()];
}

/* ============================================================
 *  CATEGORY CRAWL  (paginate ?page=N, collect product links)
 *  Scoped to the product grid so sidebar "Specials"/carousels
 *  do NOT leak in.
 * ============================================================ */
async function collectProductLinks(categoryUrl, { maxProducts = Infinity } = {}) {
  const origin = new URL(categoryUrl).origin;
  const found = new Map(); // product_id -> url
  let page = 1;

  while (found.size < maxProducts) {
    const pageUrl = setParam(categoryUrl, 'page', page);
    let html;
    try {
      html = await getHtml(pageUrl, { referer: categoryUrl });
    } catch (e) {
      console.log(`  ✗ page ${page} failed: ${e.message}`);
      break;
    }
    const $ = cheerio.load(html);

    // Main product grid only — avoid #column-right / .swiper / specials.
    const scope = pickProductGrid($);
    const before = found.size;

    scope.find('a[href*="route=product/product"]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      const abs = toAbsolute(href, origin);
      const pid = getParam(abs, 'product_id');
      if (pid && !found.has(pid)) found.set(pid, stripVolatileParams(abs));
    });

    const added = found.size - before;
    console.log(`  • page ${page}: +${added} products (total ${found.size})`);

    if (added === 0) break;           // no new products => stop
    if (!hasNextPage($, page)) break; // pagination exhausted
    page++;
  }

  return [...found.values()].slice(0, maxProducts);
}

function pickProductGrid($) {
  for (const sel of ['#content .product-layout', '#content .row', '#content', 'main', 'body']) {
    const node = $(sel).first();
    if (node.length && node.find('a[href*="route=product/product"]').length) {
      return node.length ? $(sel) : node;
    }
  }
  return $('body');
}

function hasNextPage($, currentPage) {
  // OpenCart pagination: <ul class="pagination"> with ?page=N links, or rel=next
  if ($('a[rel="next"]').length) return true;
  let found = false;
  $('.pagination a, ul.pagination a').each((_, el) => {
    const p = parseInt(getParam($(el).attr('href') || '', 'page') || '0', 10);
    if (p > currentPage) found = true;
  });
  return found;
}

/* ============================================================
 *  PRODUCT EXTRACTION
 * ============================================================ */
async function extractProduct(productUrl) {
  const html = await getHtml(productUrl, { referer: productUrl });
  const $ = cheerio.load(html);

  const main = $('#content').length ? $('#content') : $('body');

  const nameAr =
    text($, ['#content h1', 'h1.product-title', 'h1']) ||
    $('meta[property="og:title"]').attr('content') || '';

  const descAr =
    text($, ['#tab-description', '.product-description', '#content [id*="description"]']) ||
    $('meta[property="og:description"]').attr('content') || '';

  // ---- multi-variant detection (skip for now) ----
  const isMultiVariant =
    main.find('[name^="option["], #product .form-group select, #product .form-group input[type="radio"]').length > 0;

  // ---- SKU = model number ----
  const sku = extractModel($) || '';

  // ---- price: BEFORE discount, WITHOUT tax ----
  const price = extractPriceBeforeDiscountExVat($, main);

  // ---- images: main product gallery only, full resolution ----
  const images = await extractImages($, productUrl);

  const productId = getParam(productUrl, 'product_id');

  return {
    sourceId: productId,
    sourceUrl: stripVolatileParams(productUrl),
    nameAr: clean(nameAr),
    descAr: clean(descAr),
    price,
    sku,
    images,
    isMultiVariant,
    status: 'scraped',
  };
}

function extractModel($) {
  // Look for "Model:" / "رقم الموديل" label, else any li/span carrying it.
  let model = '';
  $('li, span, div').each((_, el) => {
    if (model) return;
    const t = $(el).text().trim();
    const m = t.match(/(?:Model|رقم\s*الموديل|الموديل)\s*[:：]\s*([A-Za-z0-9\-_.]+)/i);
    if (m) model = m[1];
  });
  return model;
}

function extractPriceBeforeDiscountExVat($, main) {
  // Prefer the struck "old" price (before discount); fall back to current/new.
  const candidates = [
    '.price-old', '.product-price-old', 'span.price.text-line-through',
    '.price-new', '.product-price', '.price', 'h2.price', 'meta[property="product:price:amount"]',
  ];
  let raw = '';
  for (const sel of candidates) {
    const el = main.find(sel).first();
    if (el.length) {
      raw = sel.startsWith('meta') ? el.attr('content') : el.text();
      if (raw && /\d/.test(raw)) break;
    }
  }
  const inclVat = parseMoney(raw);
  if (inclVat == null) return '';
  const exVat = inclVat / (1 + VAT_RATE);
  return exVat.toFixed(2);
}

async function extractImages($, productUrl) {
  const origin = new URL(productUrl).origin;
  const ogImg = $('meta[property="og:image"]').attr('content') || '';
  const stem = catalogStem(ogImg); // e.g. "newproducts/1970_01-1" → groups this product's images

  const candidates = new Set();

  // Scope to the product's own image area; fall back to og:image only.
  const imgScope = $('.thumbnails, .image-additional, .product-image, #content .product-info, #content').first();
  imgScope.find('a[href*="/image/"], img').each((_, el) => {
    const src = $(el).attr('href') || $(el).attr('src') || $(el).attr('data-src');
    if (!src) return;
    const abs = toAbsolute(src, origin);
    if (!isCatalogImage(abs)) return;
    if (/transparent|placeholder|logo|icon|banner|/i.test(abs) && /transparent|placeholder|logo|icon|banner/i.test(abs)) return;
    // keep only images that belong to THIS product (share the og:image stem) when we have one
    if (stem && catalogStem(abs) && !sameStemFamily(catalogStem(abs), stem)) return;
    candidates.add(abs);
  });

  if (ogImg && isCatalogImage(ogImg)) candidates.add(toAbsolute(ogImg, origin));

  // De-duplicate by the size-stripped base, then resolve each to full resolution.
  const byBase = new Map();
  for (const url of candidates) {
    const base = stripSizeSuffix(stripCache(url));
    if (!byBase.has(base)) byBase.set(base, url);
  }

  const finals = [];
  for (const [base] of byBase) {
    const full = await resolveFullRes(base);
    if (full && !finals.includes(full)) finals.push(full);
  }
  return finals.slice(0, 8);
}

/* Turn  /image/cache/catalog/x/name-550x550.jpg  →  /image/catalog/x/name.jpg
 * Verify it exists; if not, fall back to the original cached URL. */
async function resolveFullRes(baseNoSize) {
  // baseNoSize already had /cache removed and -WxH stripped, but may be URL-encoded.
  const decoded = safeDecode(baseNoSize);
  for (const cand of unique([decoded, baseNoSize])) {
    if (await urlExists(cand)) return cand;
  }
  return baseNoSize; // last resort (caller may still get a cached size)
}

/* ============================================================
 *  REVIEWS  (AJAX endpoint, kept in Arabic)
 * ============================================================ */
async function fetchReviews(productUrl) {
  const origin = new URL(productUrl).origin;
  const pid = getParam(productUrl, 'product_id');
  if (!pid) return [];

  const reviews = [];
  let page = 1;
  while (true) {
    const url = `${origin}/index.php?route=product/product/review&product_id=${pid}&page=${page}`;
    let html;
    try {
      html = await getHtml(url, { referer: productUrl });
    } catch {
      break;
    }
    const $ = cheerio.load(html);
    let addedThisPage = 0;

    // OpenCart default: each review is a <table class="table"> block.
    $('table.table, .review-list > div, .review-item').each((_, el) => {
      const node = $(el);
      const body = node.find('p').filter((_, p) => $(p).text().trim().length > 1);
      const textBody = body.length ? $(body[body.length - 1]).text().trim() : node.find('p').last().text().trim();
      const author = node.find('strong, .author, td strong').first().text().trim();
      const stars = node.find('.fa-star, .fas.fa-star, img[src*="star"]').length || ratingFromStyle(node, $);
      const date = (node.text().match(/\d{2}\/\d{2}\/\d{4}/) || [])[0] || '';
      if (textBody && textBody.length > 2) {
        reviews.push({
          author: author || 'عميل',
          rating: clampRating(stars) || 5,
          body: textBody,
          date,
        });
        addedThisPage++;
      }
    });

    if (addedThisPage === 0) break;
    if (!hasNextPage($, page)) break;
    page++;
    if (page > 20) break; // safety
  }
  return reviews;
}

function ratingFromStyle(node, $) {
  // some themes render rating as width:NN% on a .rating-stars element
  const styled = node.find('[style*="width"]').filter((_, e) => /width\s*:\s*\d+%/.test($(e).attr('style') || '')).first();
  if (styled.length) {
    const pct = parseInt(($(styled).attr('style').match(/width\s*:\s*(\d+)%/) || [])[1] || '0', 10);
    return Math.round((pct / 100) * 5);
  }
  return 0;
}

/* ===================== helpers ===================== */
function text($, selectors) {
  for (const sel of selectors) {
    const t = $(sel).first().text().trim();
    if (t && t.length > 1) return t;
  }
  return '';
}
function clean(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
function toAbsolute(href, origin) {
  if (!href) return '';
  if (href.startsWith('http')) return href;
  if (href.startsWith('//')) return 'https:' + href;
  if (href.startsWith('/')) return origin + href;
  return origin + '/' + href.replace(/^\.?\//, '');
}
function getParam(url, key) {
  try { return new URL(url).searchParams.get(key); }
  catch { const m = (url || '').match(new RegExp(`[?&]${key}=([^&#]+)`)); return m ? decodeURIComponent(m[1]) : null; }
}
function setParam(url, key, val) {
  try { const u = new URL(url); u.searchParams.set(key, val); return u.toString(); }
  catch { return url + (url.includes('?') ? '&' : '?') + `${key}=${val}`; }
}
function stripVolatileParams(url) {
  try {
    const u = new URL(url);
    ['page', 'limit', 'sort', 'order', 'language', 'currency', 'path'].forEach((p) => u.searchParams.delete(p));
    return u.toString();
  } catch { return url; }
}
function parseMoney(raw) {
  if (!raw) return null;
  // Convert Arabic-Indic digits, then keep digits + separators.
  const norm = String(raw).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  const m = norm.replace(/[^\d.,]/g, '');
  if (!m) return null;
  // Assume '.' decimal, ',' thousands (matches this source: 36.75 / 1,234.50)
  const cleaned = m.replace(/,/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}
function isCatalogImage(u) { return /\/image\/.*\.(jpg|jpeg|png|webp)/i.test(u) && !/(logo|icon|banner|transparent|placeholder|whatsapp|payment|flag)/i.test(u); }
function stripCache(u) { return u.replace('/image/cache/', '/image/'); }
function stripSizeSuffix(u) { return u.replace(/-\d+x\d+[a-z]*(?=\.(jpg|jpeg|png|webp))/i, ''); }
function catalogStem(u) {
  const m = (u || '').match(/\/image\/(?:cache\/)?catalog\/(.+?)(?:-\d+x\d+[a-z]*)?\.(?:jpg|jpeg|png|webp)/i);
  return m ? safeDecode(m[1]) : '';
}
function sameStemFamily(a, b) {
  const norm = (s) => s.replace(/[_\-\s]+/g, '').replace(/\d+$/, '').slice(0, 12).toLowerCase();
  return norm(a) === norm(b) || a.split('/')[0] === b.split('/')[0];
}
function safeDecode(s) { try { return decodeURIComponent(s); } catch { return s; } }
function unique(arr) { return [...new Set(arr)]; }
function clampRating(n) { n = parseInt(n, 10); if (isNaN(n)) return 0; return Math.max(1, Math.min(5, n)); }

module.exports = {
  discoverCategories,
  collectProductLinks,
  extractProduct,
  fetchReviews,
  // exported for unit tests
  _internals: { parseMoney, stripCache, stripSizeSuffix, catalogStem, toAbsolute, getParam, stripVolatileParams, VAT_RATE },
};
