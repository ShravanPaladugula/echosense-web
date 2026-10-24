const puppeteer = require('puppeteer-core');
const fs = require('fs');
fs.mkdirSync(process.env.OUT || './out', { recursive: true });
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const B = process.env.BASE || 'http://localhost:8000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.argv[2] || './out';

const VIEWS = [
  { name: 'phone', width: 390, height: 844, dsf: 2, mobile: true },
  { name: 'desktop', width: 1440, height: 900, dsf: 1, mobile: false },
];
const PAGES = [
  { name: 'landing', url: '/' },
  { name: 'login', url: '/login.html?mode=signup' },
  { name: 'dashboard', url: '/dashboard.html?demo=1' },
];

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'shell', args: ['--no-sandbox'] });
  for (const v of VIEWS) {
    for (const p of PAGES) {
      const page = await browser.newPage();
      await page.setViewport({ width: v.width, height: v.height, deviceScaleFactor: v.dsf, isMobile: v.mobile, hasTouch: v.mobile });
      await page.goto(B + p.url, { waitUntil: 'networkidle2' });
      await sleep(3000);
      if (p.name === 'dashboard') {
        // open the wizard too, it is the fiddliest thing on a phone
        await page.evaluate(() => { document.getElementById('menu').classList.remove('open'); });
      }
      // horizontal overflow check
      const over = await page.evaluate(() => {
        const de = document.documentElement;
        const bleeders = [...document.querySelectorAll('*')]
          .filter((el) => el.getBoundingClientRect().right > de.clientWidth + 1)
          .slice(0, 6)
          .map((el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : el.className ? '.' + String(el.className).split(' ')[0] : '') + ' @' + Math.round(el.getBoundingClientRect().right));
        return { scrollW: de.scrollWidth, clientW: de.clientWidth, bleeders };
      });
      const flag = over.scrollW > over.clientW + 1 ? `OVERFLOW ${over.scrollW}>${over.clientW} :: ${over.bleeders.join(' | ')}` : 'no h-overflow';
      console.log(`${v.name}/${p.name}: ${flag}`);
      await page.screenshot({ path: `${OUT}/${v.name}-${p.name}.png`, fullPage: v.name === 'phone' });
      if (p.name === 'dashboard') {
        await page.evaluate(() => document.getElementById('wizardBtn').click());
        await sleep(600);
        await page.screenshot({ path: `${OUT}/${v.name}-wizard.png` });
      }
      await page.close();
    }
  }
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
