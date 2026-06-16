#!/usr/bin/env node
require('dotenv').config();
const { runCategory } = require('./src/pipeline');
const scraper = require('./src/scraper');

// Usage:
//   node run.js discover <baseUrl>
//   node run.js category "<categoryUrl>" --limit 2 [--no-translate] [--dry] [--no-reviews]
(async () => {
  const [cmd, arg] = process.argv.slice(2);
  const flags = process.argv.slice(2);
  const getNum = (name, def) => {
    const i = flags.indexOf(name);
    return i >= 0 && flags[i + 1] ? parseInt(flags[i + 1], 10) : def;
  };
  const has = (f) => flags.includes(f);

  if (cmd === 'discover') {
    const cats = await scraper.discoverCategories(arg);
    console.log(`Found ${cats.length} categories:`);
    cats.forEach((c) => console.log(`  path=${c.path}  ${c.name}\n     ${c.url}`));
    return;
  }

  if (cmd === 'category') {
    await runCategory(arg, {
      limit: getNum('--limit', 2),
      translate: !has('--no-translate'),
      publish: !has('--dry'),
      withReviews: !has('--no-reviews'),
      priceMultiplier: parseFloat(process.env.PRICE_MULTIPLIER || '1'),
    });
    return;
  }

  console.log(`Commands:
  node run.js discover  https://alwidadperfumes.com/
  node run.js category  "https://alwidadperfumes.com/index.php?route=product/category&path=8" --limit 2
    flags: --limit N | --no-translate (scrape only) | --dry (no Shopify) | --no-reviews`);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
