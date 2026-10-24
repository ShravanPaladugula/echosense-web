const puppeteer = require('puppeteer-core');
const fs = require('fs');
fs.mkdirSync(process.env.OUT || './out', { recursive: true });
const B = process.env.BASE || 'http://localhost:8000';
(async () => {
  const br = await puppeteer.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'shell', args: ['--no-sandbox'] });
  const p = await br.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  await p.goto(B + '/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 14000));   // let the band fill with telemetry
  const el = await p.$('.band');
  await el.screenshot({ path: (process.env.OUT || './out') + '/band.png' });
  const info = await p.evaluate(() => {
    const c = document.getElementById('waveBand');
    const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 10) lit++;
    return { w: c.width, h: c.height, litPixels: lit };
  });
  console.log('canvas', info.w + 'x' + info.h, 'lit pixels:', info.litPixels);
  await br.close();
})();
