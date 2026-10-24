// Does "Set front" actually re-centre the demo direction on FRONT?
const puppeteer = require('puppeteer-core');
const B = process.env.BASE || 'http://localhost:8000';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'shell', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(B + '/dashboard.html?demo=1', { waitUntil: 'networkidle2' });
  await sleep(2000);

  // sample the direction words seen over ~14 s (covers all 4 demo talkers)
  const sample = async (label) => {
    const seen = new Set();
    for (let i = 0; i < 70; i++) {
      const [badge, big] = await page.evaluate(() => [
        document.getElementById('stateBadge').textContent,
        document.getElementById('stateBig').textContent,
      ]);
      if (badge === 'SPEECH') seen.add(big.replace('Voice from the ', ''));
      await sleep(200);
    }
    console.log(label + ': ' + [...seen].sort().join(', '));
  };

  await sample('before set front  ');

  // wait for the FRONT-ish talker (first slot, ~40 deg raw) then set front
  for (let i = 0; i < 120; i++) {
    const s = await page.evaluate(() => ({
      badge: document.getElementById('stateBadge').textContent,
      raw: document.getElementById('kvRaw').textContent,
    }));
    const raw = parseInt(s.raw, 10);
    if (s.badge === 'SPEECH' && raw >= 25 && raw <= 55) break;
    await sleep(200);
  }
  const raw = await page.$eval('#kvRaw', (e) => e.textContent);
  await page.click('#setFrontBtn');
  await sleep(900);
  console.log('set front at raw ' + raw + ' -> front offset ' + await page.$eval('#kvFront', (e) => e.textContent));

  await sample('after set front   ');
  console.log('errors: ' + (errs.length ? errs.join(' | ') : 'none'));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
