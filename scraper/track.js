const puppeteer = require('puppeteer');

const SHARE_LINK = process.env.SHARE_LINK; // set this secret to: https://www.google.com/android/find
const COOKIES_B64 = process.env.COOKIES_B64;
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;

function fail(msg) {
  console.error('[error]', msg);
  process.exit(1);
}

function sanitizeCookies(raw) {
  const sameSiteMap = { lax: 'Lax', strict: 'Strict', no_restriction: 'None' };
  return raw.map(c => {
    const out = {
      name: c.name, value: c.value, domain: c.domain, path: c.path,
      secure: !!c.secure, httpOnly: !!c.httpOnly,
    };
    if (c.sameSite && sameSiteMap[c.sameSite.toLowerCase()]) out.sameSite = sameSiteMap[c.sameSite.toLowerCase()];
    if (typeof c.expirationDate === 'number') out.expires = c.expirationDate;
    return out;
  });
}

async function extractLocation(page) {
  return await page.evaluate(() => {
    const latLngRegex = /(-?\d{1,3}\.\d{4,})[,\s]+(-?\d{1,3}\.\d{4,})/g;
    const scripts = Array.from(document.scripts).map(s => s.textContent).join('\n');
    let match;
    const found = [];
    while ((match = latLngRegex.exec(scripts)) !== null) {
      const lat = parseFloat(match[1]);
      const lon = parseFloat(match[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) found.push({ lat, lon });
    }
    return found[0] || null;
  });
}

async function sendTelegramPhoto(buffer, caption) {
  if (!TG_TOKEN || !TG_CHAT) return;
  const form = new FormData();
  form.append('chat_id', TG_CHAT);
  form.append('caption', caption.slice(0, 1000));
  form.append('photo', new Blob([buffer], { type: 'image/png' }), 'debug.png');
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendPhoto`, { method: 'POST', body: form });
  if (!res.ok) console.error('[warn] debug photo send failed:', await res.text());
}

async function notifyTelegramText(text) {
  if (!TG_TOKEN || !TG_CHAT) return;
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT, text }),
  });
}

async function getReading() {
  if (!SHARE_LINK) fail('SHARE_LINK is not set');
  if (!COOKIES_B64) fail('COOKIES_B64 is not set');

  const cookies = sanitizeCookies(JSON.parse(Buffer.from(COOKIES_B64, 'base64').toString('utf8')));

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1300, height: 950 });
    await page.setCookie(...cookies);
    await page.goto(SHARE_LINK, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(r => setTimeout(r, 6000)); // dashboard + map take longer to settle

    const loc = await extractLocation(page);
    if (!loc) {
      const title = await page.title();
      const finalUrl = page.url();
      const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 500));
      const screenshot = await page.screenshot({ fullPage: false });
      await sendTelegramPhoto(screenshot, `DEBUG — no coords found\nTitle: ${title}\nURL: ${finalUrl}\nText: ${bodyText}`);
      fail('could not find coordinates — sent debug screenshot to Telegram');
    }
    return { time: new Date().toISOString(), lat: loc.lat, lon: loc.lon };
  } finally {
    await browser.close();
  }
}

async function notifyTelegram(entry) {
  if (!TG_TOKEN || !TG_CHAT) fail('TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set');
  const mapsUrl = `https://maps.google.com/?q=${entry.lat},${entry.lon}`;
  const text = `📍 ${entry.time}\n${entry.lat.toFixed(5)}, ${entry.lon.toFixed(5)}\n${mapsUrl}`;
  await notifyTelegramText(text);
}

(async () => {
  const entry = await getReading();
  await notifyTelegram(entry);
  console.log('[ok]', entry);
})();
