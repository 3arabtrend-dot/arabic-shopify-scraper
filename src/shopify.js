const axios = require('axios');
const { sleep } = require('./http');

function getClient() {
  const shop = process.env.SHOPIFY_SHOP_URL;
  const token = process.env.SHOPIFY_ACCESS_TOKEN;
  const version = process.env.SHOPIFY_API_VERSION || '2024-10';
  if (!shop || !token) throw new Error('Missing SHOPIFY_SHOP_URL or SHOPIFY_ACCESS_TOKEN in .env');

  return axios.create({
    baseURL: `https://${shop}/admin/api/${version}`,
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    validateStatus: () => true,
  });
}

async function testConnection() {
  const c = getClient();
  const r = await withRetry(() => c.get('/shop.json'));
  if (r.status !== 200) throw new Error(`Shopify ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`);
  return { name: r.data.shop.name, domain: r.data.shop.domain };
}

/** Dedup check: does a product with this SKU already exist? */
async function findBySku(client, sku) {
  if (!sku) return null;
  const r = await withRetry(() => client.get('/variants.json', { params: { sku, limit: 1 } }));
  if (r.status === 200 && r.data.variants && r.data.variants.length) return r.data.variants[0];
  // Fallback: GraphQL-less stores sometimes ignore sku filter -> do a light search.
  return null;
}

async function publishProducts(products, { status = 'draft', priceMultiplier = 1 } = {}) {
  const client = getClient();
  const results = [];

  for (const product of products) {
    const label = product.nameEn || product.nameAr || product.sku;
    try {
      // ---- skip duplicates by SKU ----
      if (product.sku) {
        const existing = await findBySku(client, product.sku);
        if (existing) {
          console.log(`  ⤼ skip (dup SKU ${product.sku}): ${label}`);
          results.push({ sku: product.sku, nameEn: product.nameEn, status: 'skipped_duplicate' });
          continue;
        }
      }

      const payload = buildShopifyProduct(product, status, priceMultiplier);
      const r = await withRetry(() => client.post('/products.json', { product: payload }));
      if (r.status < 200 || r.status >= 300) throw new Error(`create ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`);
      const created = r.data.product;

      if (product.images && product.images.length) {
        await uploadImages(client, created.id, product.images);
      }

      results.push({
        sku: product.sku,
        nameEn: product.nameEn,
        shopifyId: created.id,
        handle: created.handle,
        shopifyUrl: `https://${process.env.SHOPIFY_SHOP_URL}/products/${created.handle}`,
        reviews: product.reviews || [],
        status: 'published',
      });
      console.log(`  ✓ published: ${label} (${product.images?.length || 0} imgs)`);
      await sleep(600);
    } catch (err) {
      console.error(`  ✗ failed: ${label} — ${err.message}`);
      results.push({ sku: product.sku, nameEn: product.nameEn, status: 'error', error: err.message });
    }
  }
  return results;
}

function buildShopifyProduct(product, status, priceMultiplier) {
  const title = product.nameEn || product.nameAr || 'Untitled';
  const price = product.price ? (parseFloat(product.price) * (priceMultiplier || 1)).toFixed(2) : '0.00';

  return {
    title,
    body_html: product.descEn || '',
    vendor: process.env.SHOPIFY_VENDOR || 'Royal Dhofar',
    product_type: product.productType || '',
    status, // 'draft'
    tags: (product.tags || []).join(', '),
    images: [], // uploaded separately for better error handling
    variants: [
      {
        price,
        sku: product.sku || '',
        // Always purchasable regardless of source stock:
        inventory_management: null,      // stop tracking inventory
        inventory_policy: 'continue',    // allow selling when out of stock
        taxable: true,
      },
    ],
    metafields: [
      { namespace: 'global', key: 'title_tag', value: (product.metaTitle || title).slice(0, 70), type: 'single_line_text_field' },
      { namespace: 'global', key: 'description_tag', value: (product.metaDescription || '').slice(0, 320), type: 'single_line_text_field' },
    ],
  };
}

async function uploadImages(client, productId, imageUrls) {
  for (const src of imageUrls.slice(0, 8)) {
    const r = await withRetry(() => client.post(`/products/${productId}/images.json`, { image: { src } }));
    if (r.status < 200 || r.status >= 300) console.log(`    ⚠ image failed: ${src.slice(0, 70)}`);
    await sleep(300);
  }
}

/** Retry wrapper that respects Shopify 429 rate limiting. */
async function withRetry(fn, max = 5) {
  let wait = 1000;
  for (let i = 0; i < max; i++) {
    const res = await fn();
    if (res.status !== 429) return res;
    await sleep(wait);
    wait = Math.min(wait * 2, 16000);
  }
  return fn();
}

module.exports = { publishProducts, testConnection, _internals: { buildShopifyProduct } };
