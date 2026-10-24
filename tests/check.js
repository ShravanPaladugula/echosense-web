const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.BASE || 'http://localhost:8000';

function watch(page, bag) {
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') bag.push(`[${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => bag.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => bag.push(`[reqfail] ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) bag.push(`[http ${r.status()}] ${r.url()}`); });
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'shell',
    args: ['--no-sandbox', '--window-size=1440,900'],
  });
  const pages = ['/', '/login.html', '/dashboard.html?demo=1', '/dashboard.html'];
  for (const p of pages) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    const bag = [];
    watch(page, bag);
    await page.goto(BASE + p, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 3500));
    const title = await page.title();
    const url = page.url();
    console.log(`\n=== ${p}  ->  ${url}\n    title: ${title}`);
    const ignore = (s) => /fonts\.googleapis|fonts\.gstatic/.test(s);
    const real = bag.filter((s) => !ignore(s));
    console.log(real.length ? real.map((s) => '    ! ' + s).join('\n') : '    clean');
    await page.close();
  }
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
