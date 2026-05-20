const axios = require('axios');
const cheerio = require('cheerio');

async function scrapeProducts(url, { maxProducts = 50, delay = 1000 } = {}) {
  const products = [];
  const visited = new Set();

  const baseUrl = new URL(url).origin;
  const pagesToVisit = [url];

  while (pagesToVisit.length > 0 && products.length < maxProducts) {
    const pageUrl = pagesToVisit.shift();
    if (visited.has(pageUrl)) continue;
    visited.add(pageUrl);

    try {
      const html = await fetchPage(pageUrl);
      const $ = cheerio.load(html);

      const productLinks = extractProductLinks($, baseUrl);

      for (const link of productLinks) {
        if (products.length >= maxProducts) break;
        if (visited.has(link)) continue;

        await sleep(delay);
        try {
          const productHtml = await fetchPage(link);
          const product = extractProduct(productHtml, link);
          if (product && product.nameAr) {
            products.push(product);
            console.log(`  ✓ ${product.nameAr}`);
          }
        } catch (e) {
          console.log(`  ✗ Failed: ${link}`);
        }
        visited.add(link);
      }

      const nextPage = extractNextPage($, baseUrl, pageUrl);
      if (nextPage && !visited.has(nextPage)) {
        pagesToVisit.push(nextPage);
      }

    } catch (err) {
      console.error(`Page error: ${pageUrl}`, err.message);
    }
  }

  return products;
}

async function fetchPage(url) {
  const response = await axios.get(url, {
    timeout: 15000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'ar,en;q=0.9',
    }
  });
  return response.data;
}

function extractProductLinks($, baseUrl) {
  const links = new Set();

  const selectors = [
    'a[href*="/product"]',
    'a[href*="/products"]',
    'a[href*="/item"]',
    'a[href*="/p/"]',
    '.product a',
    '.product-item a',
    '.product-card a',
    '[class*="product"] a',
  ];

  selectors.forEach(sel => {
    $(sel).each((_, el) => {
      let href = $(el).attr('href');
      if (!href) return;
      if (href.startsWith('/')) href = baseUrl + href;
      if (href.startsWith('http')) links.add(href);
    });
  });

  return [...links];
}

function extractProduct(html, url) {
  const $ = cheerio.load(html);

  const nameAr = extractText($, [
    'h1.product-title', 'h1.product_title', 'h1[class*="product"]',
    '.product-name h1', '.product-title', 'h1'
  ]);

  const priceRaw = extractText($, [
    '.price', '.product-price', '.woocommerce-Price-amount',
    '[class*="price"]', '.amount'
  ]);
  const price = priceRaw ? priceRaw.replace(/[^\d.]/g, '') : '';

  const descAr = extractText($, [
    '.product-description', '.woocommerce-product-details__short-description',
    '#tab-description', '[class*="description"]', '.product-details'
  ]);

  const images = [];
  $('img').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src');
    if (src && src.match(/\.(jpg|jpeg|png|webp)/i) && !src.includes('placeholder')) {
      const fullSrc = src.startsWith('http') ? src : url.split('/').slice(0,3).join('/') + src;
      images.push(fullSrc);
    }
  });

  const sku = extractText($, ['.sku', '[class*="sku"]', '#productSku']) || generateSku();

  return {
    id: Date.now() + Math.random(),
    nameAr: nameAr || '',
    descAr: descAr || '',
    price,
    sku,
    images: [...new Set(images)].slice(0, 5),
    sourceUrl: url,
    status: 'pending'
  };
}

function extractText($, selectors) {
  for (const sel of selectors) {
    const text = $(sel).first().text().trim();
    if (text && text.length > 1) return text;
  }
  return '';
}

function extractNextPage($, baseUrl, currentUrl) {
  const nextSelectors = [
    'a[rel="next"]', '.next a', '.pagination .next a',
    'a:contains("التالي")', 'a:contains("التالية")', 'a:contains("»")'
  ];

  for (const sel of nextSelectors) {
    const href = $(sel).first().attr('href');
    if (href) {
      return href.startsWith('http') ? href : baseUrl + href;
    }
  }
  return null;
}

function generateSku() {
  return 'SKU-' + Math.random().toString(36).substr(2, 6).toUpperCase();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { scrapeProducts };
