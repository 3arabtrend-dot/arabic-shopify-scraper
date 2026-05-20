const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

const STYLE_PROMPTS = {
  ecommerce: 'professional e-commerce product copy that converts well',
  seo: 'SEO-optimized product copy with relevant keywords naturally included',
  luxury: 'premium luxury brand tone, sophisticated and aspirational',
  literal: 'accurate direct translation keeping the original meaning',
};

async function translateProducts(products, { style = 'ecommerce', instructions = '' } = {}) {
  const results = [];

  for (const product of products) {
    try {
      const translated = await translateSingle(product, style, instructions);
      results.push(translated);
      await sleep(300);
    } catch (err) {
      console.error(`Translation failed for ${product.nameAr}:`, err.message);
      results.push({ ...product, status: 'error', errorMsg: err.message });
    }
  }

  return results;
}

async function translateSingle(product, style, extraInstructions) {
  const styleDesc = STYLE_PROMPTS[style] || STYLE_PROMPTS.ecommerce;

  const prompt = `You are an expert Arabic-to-English e-commerce translator.
Translate the following Arabic product information into English.
Style: ${styleDesc}
${extraInstructions ? `Additional instructions: ${extraInstructions}` : ''}

Product to translate:
- Name: ${product.nameAr}
- Description: ${product.descAr || 'No description'}

Respond with ONLY a JSON object, no markdown, no explanation:
{
  "nameEn": "translated product name",
  "descEn": "translated product description (2-4 sentences)",
  "metaTitle": "SEO meta title (max 60 chars)",
  "metaDescription": "SEO meta description (max 160 chars)",
  "tags": ["tag1", "tag2", "tag3"],
  "productType": "product category in English"
}`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 800,
    messages: [{ role: 'user', content: prompt }]
  });

  const raw = message.content[0].text.trim();
  const cleaned = raw.replace(/```json|```/g, '').trim();
  const translation = JSON.parse(cleaned);

  return {
    ...product,
    ...translation,
    status: 'translated'
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { translateProducts };
