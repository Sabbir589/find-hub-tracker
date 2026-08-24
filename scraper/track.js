const puppeteer = require('puppeteer');

const SHARE_LINK = process.env.SHARE_LINK;
const COOKIES_B64 = process.env.COOKIES_B64;
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;

function fail(msg) {
  console.error('[error]', msg);
  process.exit(1);
}

async function extractLocation(page) {
  return await page.evaluate(() => {
    const latLngRegex = /(-?\d{1,3}\.\d{4,})[,\s]+(-?\d{1,3}\.\d{4,})/g;
    const scripts = Array.from(document.scripts).map(s => s.textContent).join('\n');
    let match;
    while ((match = latLngRegex.exec(scripts)) !== null) {
      const lat = parseFloat(match[1]);
      const lon = parseFloat(match[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon };
    }
    return null;
  });
}

async function getReading() {
  if (!SHARE_LINK) fail('SHARE_LINK is not set');
  if (!COOKIES_B64) fail('COOKIES_B64 is not set');

  const cookies = JSON.parse(Buffer.from(COOKIES_B64, 'base64').toString('utf8'));

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setCookie(...cookies);
    await page.goto(SHARE_LINK, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(r => setTimeout(r, 4000));

    const loc = await extractLocation(page);
    if (!loc) fail('could not find coordinates on the page — inspect the page and update extractLocation()');
    return { time: new Date().toISOString(), lat: loc.lat, lon: loc.lon };
  } finally {
    await browser.close();
  }
}

async function notifyTelegram(entry) {
  if (!TG_TOKEN || !TG_CHAT) fail('TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set');
  const mapsUrl = `https://maps.google.com/?q=${entry.lat},${entry.lon}`;
  const text = `📍 ${entry.time}\n${entry.lat.toFixed(5)}, ${entry.lon.toFixed(5)}\n${mapsUrl}`;
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT, text }),
  });
  if (!res.ok) fail(`telegram send failed: ${await res.text()}`);
}

(async () => {
  const entry = await getReading();
  await notifyTelegram(entry);
  console.log('[ok]', entry);
})();
