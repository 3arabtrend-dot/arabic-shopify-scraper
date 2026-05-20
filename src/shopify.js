const axios = require('axios');

function getClient() {
  const shop = process.env.SHOPIFY_SHOP_URL;
  const token = process.env.SHOPIFY_ACCESS_TOKEN;
  const version = process.env.SHOPIFY_API_VERSION || '2024-10';

  if (!shop || !token) throw new Error('Missing SHOPIFY_SHOP_URL or SHOPIFY_ACCESS_TOKEN in .env');

  const baseURL = `https://${shop}/admin/api/${version}`;
  return axios.create({
    baseURL,
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json'
    }
  });
}

async function testConnection() {
  const client = getClient();
  const { data } = await client.get('/shop.json');
  return { name: data.shop.name, domain: data.shop.domain };
}

async function publishProducts(products, { status = 'draft', collection = '' } = {}) {
  const client = getClient();
  const results = [];

  for (const product of products) {
    try {
      const shopifyProduct = buildShopifyProduct(product, status);
      const { data } = await client.post('/products.json', { product: shopifyProduct });
      const created = data.product;

      if (product.images && product.images.length > 0) {
        await uploadImages(client, created.id, product.images);
      }

      results.push({
        nameEn: product.nameEn,
        shopifyId: created.id,
        handle: created.handle,
        shopifyUrl: `https://${process.env.SHOPIFY_SHOP_URL}/products/${created.handle}`,
        status: 'published'
      });

      console.log(`  ✓ Published: ${product.nameEn}`);
      await sleep(500);
    } catch (err) {
      console.error(`  ✗ Failed: ${product.nameEn}`, err.message);
      results.push({ nameEn: product.nameEn, status: 'error', error: err.message });
    }
  }

  return results;
}

function buildShopifyProduct(product, status) {
  const handle = (product.nameEn || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return {
    title: product.nameEn || product.nameAr,
    body_html: product.descEn || product.descAr || '',
    vendor: process.env.SHOPIFY_VENDOR || 'Imported',
    product_type: product.productType || '',
    status,
    handle,
    tags: (product.tags || []).join(', '),
    variants: [{
      price: product.price || '0.00',
      sku: product.sku || '',
      inventory_management: 'shopify',
      inventory_policy: 'deny',
    }],
    metafields: [
      {
        namespace: 'seo',
        key: 'title',
        value: product.metaTitle || product.nameEn || '',
        type: 'single_line_text_field'
      },
      {
        namespace: 'seo',
        key: 'description',
        value: product.metaDescription || product.descEn || '',
        type: 'single_line_text_field'
      }
    ]
  };
}

async function uploadImages(client, productId, imageUrls) {
  for (const src of imageUrls.slice(0, 5)) {
    try {
      await client.post(`/products/${productId}/images.json`, {
        image: { src }
      });
    } catch (e) {
      console.log(`    ⚠ Image upload failed: ${src}`);
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { publishProducts, testConnection };
