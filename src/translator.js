const Anthropic = require('@anthropic-ai/sdk');
const { sleep } = require('./http');

const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

const STYLE_PROMPTS = {
  ecommerce: 'professional e-commerce product copy that converts well',
  seo: 'SEO-optimized product copy with relevant keywords naturally included',
  luxury: 'premium luxury brand tone, sophisticated and aspirational',
  literal: 'accurate direct translation keeping the original meaning',
};

async function translateProducts(products, { style = 'ecommerce', instructions = '' } = {}) {
  const out = [];
  for (const p of products) {
    try {
      out.push(await translateSingle(p, style, instructions));
    } catch (err) {
      console.error(`  ✗ translate failed (${p.nameAr}): ${err.message}`);
      out.push({ ...p, status: 'translate_error', errorMsg: err.message });
    }
    await sleep(300);
  }
  return out;
}

async function translateSingle(product, style, extra) {
  const styleDesc = STYLE_PROMPTS[style] || STYLE_PROMPTS.ecommerce;

  const prompt = `You are an expert Arabic-to-English e-commerce translator for a perfume/fragrance store.
Translate the Arabic product info below into natural English.
Style: ${styleDesc}.
${extra ? `Extra instructions: ${extra}` : ''}

IMPORTANT RULES:
- Translate the product NAME into English. Keep brand names, proper nouns, and numbers as-is (e.g. "1970" stays "1970"; transliterate Arabic brand words sensibly, e.g. "أوبار" -> "Aubar").
- "metaTitle" MUST be in English (never Arabic).
- Keep it accurate; do not invent specifications, sizes, or ingredients that are not present.

Arabic product:
- Name: ${product.nameAr || '(none)'}
- Description: ${product.descAr || '(none)'}

Respond with ONLY a raw JSON object, no markdown fences, no commentary:
{
  "nameEn": "english product name",
  "descEn": "english product description (2-4 sentences)",
  "metaTitle": "english SEO title, max 60 chars",
  "metaDescription": "english SEO meta description, max 160 chars",
  "tags": ["tag1","tag2","tag3"],
  "productType": "english product category"
}`;

  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 900,
      messages: [{ role: 'user', content: prompt }],
    });
    const rawText = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    const parsed = safeParseJson(rawText);
    if (parsed && parsed.nameEn) {
      return {
        ...product,
        nameEn: parsed.nameEn,
        descEn: parsed.descEn || '',
        metaTitle: ensureEnglishTitle(parsed.metaTitle, parsed.nameEn),
        metaDescription: parsed.metaDescription || '',
        tags: Array.isArray(parsed.tags) ? parsed.tags : [],
        productType: parsed.productType || '',
        status: 'translated',
      };
    }
    lastErr = new Error('Unparseable translation response');
    await sleep(500 * attempt);
  }
  throw lastErr;
}

function safeParseJson(text) {
  if (!text) return null;
  let t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(t); } catch {}
  // Recover the first {...} block if the model added stray text.
  const m = t.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

function ensureEnglishTitle(title, nameEn) {
  // If the model echoed Arabic into the title, fall back to the English name.
  if (!title || /[\u0600-\u06FF]/.test(title)) return (nameEn || '').slice(0, 60);
  return title;
}

module.exports = { translateProducts, _internals: { safeParseJson, ensureEnglishTitle } };
