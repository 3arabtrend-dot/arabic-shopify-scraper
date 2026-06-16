const axios = require('axios');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');

// One shared session per process so cookies (and any anti-bot tokens) persist
// across every request. This is what lets us survive OpenCart's bot checks.
const jar = new CookieJar();
const client = wrapper(axios.create({
  jar,
  timeout: 20000,
  maxRedirects: 5,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept':
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
  },
}));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Global polite delay between page requests (configurable via env)
const REQUEST_DELAY = parseInt(process.env.REQUEST_DELAY_MS || '2000', 10);
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '4', 10);

let lastRequestAt = 0;

async function throttle() {
  const since = Date.now() - lastRequestAt;
  if (since < REQUEST_DELAY) await sleep(REQUEST_DELAY - since);
  lastRequestAt = Date.now();
}

/**
 * GET a URL as text/html with throttling + exponential backoff on 403/429/5xx.
 * Returns the response body (string) or throws after exhausting retries.
 */
async function getHtml(url, { referer } = {}) {
  let attempt = 0;
  let waitMs = 1500;

  while (true) {
    await throttle();
    try {
      const res = await client.get(url, {
        responseType: 'text',
        headers: referer ? { Referer: referer } : {},
        validateStatus: () => true,
      });

      if (res.status >= 200 && res.status < 300) return res.data;

      // Retryable statuses (bot wall / rate limit / transient server errors)
      if ([403, 429, 500, 502, 503, 504].includes(res.status) && attempt < MAX_RETRIES) {
        attempt++;
        console.log(`    ⏳ ${res.status} on ${shortUrl(url)} — retry ${attempt}/${MAX_RETRIES} in ${waitMs}ms`);
        await sleep(waitMs);
        waitMs = Math.min(waitMs * 2, 30000); // exponential, capped at 30s
        continue;
      }

      throw new Error(`HTTP ${res.status} for ${url}`);
    } catch (err) {
      if (attempt < MAX_RETRIES && isNetworkError(err)) {
        attempt++;
        console.log(`    ⏳ network error on ${shortUrl(url)} — retry ${attempt}/${MAX_RETRIES} in ${waitMs}ms`);
        await sleep(waitMs);
        waitMs = Math.min(waitMs * 2, 30000);
        continue;
      }
      throw err;
    }
  }
}

/** HEAD-style existence check used to confirm a full-res image URL exists. */
async function urlExists(url) {
  try {
    const res = await client.head(url, { validateStatus: () => true, timeout: 8000 });
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  }
}

function isNetworkError(err) {
  return ['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EAI_AGAIN', 'ENOTFOUND'].includes(err.code);
}

function shortUrl(u) {
  try {
    const x = new URL(u);
    return x.pathname + x.search.slice(0, 40);
  } catch {
    return u.slice(0, 60);
  }
}

module.exports = { client, jar, getHtml, urlExists, sleep, REQUEST_DELAY };
