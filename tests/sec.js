const puppeteer = require('puppeteer-core');
const B = process.env.BASE || 'http://localhost:8000';
const fs = require('fs');
fs.mkdirSync(process.env.OUT || './out', { recursive: true });
(async () => {
  const b = await puppeteer.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'shell', args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  await p.goto(B + '/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1500));
  for (const [sel, name] of [['#how', 'sec-how'], ['#features', 'sec-features']]) {
    const el = await p.$(sel);
    await el.screenshot({ path: `${process.env.OUT || "./out"}/${name}.png` });
  }
  await b.close();
})();
