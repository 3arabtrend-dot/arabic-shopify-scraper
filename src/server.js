const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const scraper = require('./scraper');
const translator = require('./translator');
const shopify = require('./shopify');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0' });
});

// Scrape products from Arabic website
app.post('/api/scrape', async (req, res) => {
  const { url, maxProducts = 50, delay = 1000 } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    console.log(`[Scraper] Starting: ${url}`);
    const products = await scraper.scrapeProducts(url, { maxProducts, delay });
    console.log(`[Scraper] Done: ${products.length} products`);
    res.json({ success: true, count: products.length, products });
  } catch (err) {
    console.error('[Scraper] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Translate products using Claude API
app.post('/api/translate', async (req, res) => {
  const { products, style = 'ecommerce', instructions = '' } = req.body;
  if (!products || !products.length) return res.status(400).json({ error: 'No products provided' });

  try {
    console.log(`[Translator] Translating ${products.length} products...`);
    const translated = await translator.translateProducts(products, { style, instructions });
    res.json({ success: true, products: translated });
  } catch (err) {
    console.error('[Translator] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Publish to Shopify
app.post('/api/publish', async (req, res) => {
  const { products, status = 'draft', collection = '' } = req.body;
  if (!products || !products.length) return res.status(400).json({ error: 'No products provided' });

  try {
    console.log(`[Shopify] Publishing ${products.length} products...`);
    const results = await shopify.publishProducts(products, { status, collection });
    res.json({ success: true, results });
  } catch (err) {
    console.error('[Shopify] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Test Shopify connection
app.get('/api/shopify/test', async (req, res) => {
  try {
    const result = await shopify.testConnection();
    res.json({ success: true, shop: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
