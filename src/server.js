const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const scraper = require('./scraper');
const shopify = require('./shopify');
const { runCategory } = require('./pipeline');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.get('/api/health', (req, res) => res.json({ status: 'ok', version: '2.0.0' }));

// Auto-discover categories from the source site menu
app.post('/api/discover', async (req, res) => {
  try {
    const cats = await scraper.discoverCategories(req.body.url);
    res.json({ success: true, count: cats.length, categories: cats });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Run the pipeline for ONE category (staged via `limit`)
app.post('/api/run', async (req, res) => {
  const { categoryUrl, limit = 2, translate = true, publish = true, withReviews = true,
          status = 'draft', priceMultiplier = Number(process.env.PRICE_MULTIPLIER || 1) } = req.body;
  if (!categoryUrl) return res.status(400).json({ error: 'categoryUrl is required' });
  try {
    const result = await runCategory(categoryUrl, { limit, translate, publish, withReviews, status, priceMultiplier });
    res.json({ success: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/shopify/test', async (req, res) => {
  try { res.json({ success: true, shop: await shopify.testConnection() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server on :${PORT}`));
