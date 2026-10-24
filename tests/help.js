const puppeteer = require('puppeteer-core');
const B = process.env.BASE || 'http://localhost:8000';
const fs = require('fs');
fs.mkdirSync(process.env.OUT || './out', { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'shell', args: ['--no-sandbox'] });
  // help modal on a phone
  const p = await b.newPage();
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true });
  await p.goto(B + '/dashboard.html?demo=1', { waitUntil: 'networkidle2' });
  await sleep(1500);
  await p.evaluate(() => document.getElementById('helpBtn').click());
  await sleep(500);
  await p.screenshot({ path: (process.env.OUT || './out') + '/phone-help.png' });
  // dashboard full page with sessions, signed in
  const q = await b.newPage();
  await q.setViewport({ width: 1440, height: 900 });
  await q.goto(B + '/login.html?mode=signup', { waitUntil: 'networkidle2' });
  await q.type('#name', 'Shravan'); await q.type('#email', 'shot@e.dev'); await q.type('#password', 'hunter2x');
  await Promise.all([q.waitForNavigation({ waitUntil: 'networkidle2' }), q.click('#submit')]);
  await q.click('#demoBtn'); await sleep(4000);
  await q.click('#demoBtn'); await sleep(2500);   // ends one session, starts another
  await q.screenshot({ path: (process.env.OUT || './out') + '/dash-full.png', fullPage: true });
  await b.close();
})();
