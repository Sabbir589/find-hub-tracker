const puppeteer = require('puppeteer');

const SHARE_LINK = process.env.SHARE_LINK;
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;

function fail(msg) {
  console.error('[error]', msg);
  process.exit(1);
}

async function extractLocation(page) {
  return await page.evaluate(() => {
    const text = document.body.innerText;

    // Find latitude, longitude
    const latLngRegex =
      /(-?\d{1,3}\.\d{4,})[,\s]+(-?\d{1,3}\.\d{4,})/g;

    let match;

    while ((match = latLngRegex.exec(text)) !== null) {
      const lat = parseFloat(match[1]);
      const lon = parseFloat(match[2]);

      if (
        Math.abs(lat) <= 90 &&
        Math.abs(lon) <= 180
      ) {
        return {
          lat,
          lon
        };
      }
    }

    return null;
  });
}

async function extractTime(page) {
  return await page.evaluate(() => {
    const text = document.body.innerText;

    const match = text.match(
      /Last seen\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})\s+at\s+([0-9:]+\s*[AP]M\s+UTC[+-]\d+)/i
    );

    if (!match) return null;

    return {
      date: match[1],
      time: match[2]
    };
  });
}

async function sendTelegram(text) {
  if (!TG_TOKEN || !TG_CHAT) {
    fail('Telegram credentials are missing');
  }

  const res = await fetch(
    `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        chat_id: TG_CHAT,
        text
      })
    }
  );

  if (!res.ok) {
    console.error(await res.text());
  }
}

async function getReading() {
  if (!SHARE_LINK) {
    fail('SHARE_LINK is not set');
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox']
  });

  try {
    const page = await browser.newPage();

    await page.setViewport({
      width: 1300,
      height: 950
    });

    console.log('[info] Opening Find Hub...');

    await page.goto(SHARE_LINK, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    // Give Find Hub time to render the map/location
    await new Promise(resolve => setTimeout(resolve, 10000));

    console.log('[info] Page URL:', page.url());
    console.log('[info] Title:', await page.title());

    const bodyText = await page.evaluate(
      () => document.body.innerText
    );

    console.log('[info] Page text:');
    console.log(bodyText.slice(0, 3000));

    // Check if Google redirected us to login
    if (
      page.url().includes('accounts.google.com') ||
      /sign in/i.test(bodyText)
    ) {
      const screenshot = await page.screenshot({
        fullPage: false
      });

      require('fs').writeFileSync(
        'debug-login.png',
        screenshot
      );

      fail(
        'Google Sign-in page detected. The share link requires authentication.'
      );
    }

    const location = await extractLocation(page);
    const timestamp = await extractTime(page);

    if (!location) {
      await page.screenshot({
        path: 'debug-no-coordinates.png',
        fullPage: false
      });

      fail('Coordinates were not found.');
    }

    return {
      ...location,
      ...timestamp
    };

  } finally {
    await browser.close();
  }
}

async function main() {
  const entry = await getReading();

  console.log('[OK]', entry);

  const mapsUrl =
    `https://www.google.com/maps?q=${entry.lat},${entry.lon}`;

  const text =
`📍 MiLi Tag Location

📅 ${entry.date || 'Unknown'}
🕐 ${entry.time || 'Unknown'}

🌐 Latitude: ${entry.lat}
🌐 Longitude: ${entry.lon}

🗺️ ${mapsUrl}`;

  await sendTelegram(text);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
