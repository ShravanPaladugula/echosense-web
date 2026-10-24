const puppeteer = require('puppeteer-core');
const fs = require('fs');
fs.mkdirSync(process.env.OUT || './out', { recursive: true });
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const B = process.env.BASE || 'http://localhost:8000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bag = [];
const step = (s) => console.log('  * ' + s);
const txt = (p, sel) => p.$eval(sel, (e) => e.textContent.trim());
const vis = (p, sel) => p.$eval(sel, (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length));

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'shell', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1200 });
  page.on('console', (m) => { if (m.type() === 'error') bag.push('[console] ' + m.text()); });
  page.on('pageerror', (e) => bag.push('[pageerror] ' + e.message));

  // --- account
  await page.goto(B + '/login.html?mode=signup', { waitUntil: 'networkidle2' });
  await page.type('#name', 'Shravan');
  await page.type('#email', 'feat@echosense.dev');
  await page.type('#password', 'hunter2x');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }), page.click('#submit')]);

  // --- sessions card, empty state
  step('sessions empty: ' + JSON.stringify(await txt(page, '#sessions')).slice(0, 70) + '…');

  // --- bluetooth banner (headless has no radio)
  step('bt banner shown: ' + await vis(page, '#btBanner'));
  step('banner says: ' + JSON.stringify((await txt(page, '#btBanner')).slice(0, 60)) + '…');

  // --- how to connect
  await page.click('#helpBtn'); await sleep(400);
  step('help open: ' + await page.$eval('#help', (e) => e.classList.contains('open')));
  step('checks: ' + await page.$$eval('#helpCheck .chk', (ns) => ns.map((n) => n.className.replace('chk ', '') + '=' + n.children[1].textContent.slice(0, 44)).join(' | ')));
  await page.click('#helpClose'); await sleep(300);
  step('help closed: ' + !(await page.$eval('#help', (e) => e.classList.contains('open'))));

  // --- demo, then save settings to the account
  await page.click('#demoBtn'); await sleep(2200);
  step('connected: ' + await txt(page, '#connText') + ' | helpBtn hidden now: ' + !(await vis(page, '#helpBtn')));
  step('save-to-account enabled: ' + await page.$eval('#saveProfileBtn', (e) => !e.disabled));
  await page.$eval('#intensity', (el) => { el.value = 45; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.$eval('#gain2', (el) => { el.value = 70; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(600);
  await page.click('#saveProfileBtn'); await sleep(500);
  step('saved: ' + await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem('es_data_feat@echosense.dev')).profile;
    return 'intensity ' + p.intensity + ', gains ' + p.gains.join('/');
  }));

  // --- profile bar must NOT nag during demo
  step('profile bar hidden in demo: ' + !(await vis(page, '#profileBar')));

  // --- disconnect records a session, list updates live
  await page.evaluate(() => document.querySelector('#demoBtn').click());
  await sleep(1500);
  const rows = await page.$$eval('#sessions .row', (ns) => ns.length);
  step('session rows after reconnecting demo (1 head + n): ' + rows);
  step('first row: ' + (await page.$$eval('#sessions .row', (ns) => ns[1] ? ns[1].textContent.replace(/\s+/g, ' ').trim() : 'none')));

  // --- simulate a BLE-ish device so the profile-restore path can be checked
  await page.evaluate(() => { document.querySelector('#demoBtn').click(); });
  await sleep(1800);
  const restored = await page.evaluate(async () => {
    // pretend this cap came back with factory settings and is not a demo
    const mod = await import('./js/device.js');
    return mod.DEFAULT_CONFIG.intensity;
  });
  step('DEFAULT_CONFIG.intensity reachable from page: ' + restored);

  // --- reconnect button only exists for a real cap
  step('reconnect btn hidden while connected: ' + !(await vis(page, '#reconnectBtn')));

  // --- captions copy still names the right mic
  step('captions note: ' + (await txt(page, '.captions + p')).slice(0, 58) + '…');

  console.log('\nERRORS: ' + (bag.length ? '\n' + bag.map((s) => '  ! ' + s).join('\n') : 'none'));
  await page.screenshot({ path: (process.env.OUT || './out') + '/feat-dash.png', fullPage: true });
  await page.click('#helpBtn').catch(() => page.click('#menuHelp').catch(() => {}));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); console.log('ERRORS:', bag); process.exit(1); });
