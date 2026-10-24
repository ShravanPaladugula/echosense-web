const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const B = process.env.BASE || 'http://localhost:8000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bag = [];
const step = (s) => console.log('  * ' + s);
const txt = (page, sel) => page.$eval(sel, (e) => e.textContent);

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'shell', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('console', (m) => { if (m.type() === 'error') bag.push('[console] ' + m.text()); });
  page.on('pageerror', (e) => bag.push('[pageerror] ' + e.message));

  // --- sign up
  await page.goto(B + '/login.html?mode=signup', { waitUntil: 'networkidle2' });
  step('signup tab active: ' + await page.$eval('#tabUp', (e) => e.classList.contains('active')));
  await page.type('#name', 'Shravan P');
  await page.type('#email', 'test@echosense.dev');
  await page.type('#password', 'hunter2x');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }), page.click('#submit')]);
  step('after signup -> ' + page.url());

  step('avatar=' + await txt(page, '#avatar') + ' name=' + await txt(page, '#whoName') + ' email=' + await txt(page, '#whoEmail'));
  step('controls disabled before connect: ' + await page.$eval('#wizardBtn', (e) => e.disabled));

  // --- demo mode
  await page.click('#demoBtn');
  await sleep(2600);
  step('conn=' + await txt(page, '#connText') + ' | badge=' + await txt(page, '#stateBadge') + ' | big=' + await txt(page, '#stateBig'));
  step('kv fw=' + await txt(page, '#kvFw') + ' xvf=' + await txt(page, '#kvXvf') + ' drv=' + await txt(page, '#kvDrv') + ' front=' + await txt(page, '#kvFront'));
  step('controls enabled: ' + await page.$eval('#wizardBtn', (e) => !e.disabled));
  step('bars: ' + await page.$$eval('[id^=barv]', (ns) => ns.map((n) => n.textContent).join(' ')));
  step('profile active: ' + await page.$$eval('#profileSeg button', (ns) => ns.filter((n) => n.classList.contains('active')).map((n) => n.textContent).join(',')));

  // --- settings round-trip
  await page.$eval('#intensity', (el) => { el.value = 55; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(600);
  step('intensity -> ' + await txt(page, '#intensityVal') + ' save=' + await txt(page, '#saveState'));
  await page.click('#pauseBtn'); await sleep(700);
  step('pause -> badge=' + await txt(page, '#stateBadge') + ' btn=' + await txt(page, '#pauseBtn'));
  await page.click('#pauseBtn'); await sleep(700);
  step('resume -> badge=' + await txt(page, '#stateBadge'));

  // --- wizard
  await page.click('#wizardBtn'); await sleep(300);
  step('wizard open: ' + await page.$eval('#wizard', (e) => e.classList.contains('open')) + ' | ' + await txt(page, '#wizTitle'));
  await page.click('#wizNext'); await sleep(2500);
  step('step2: ' + await txt(page, '#wizTitle') + ' | live=' + (await txt(page, '#wizExtra')).trim());
  const frontBefore = await txt(page, '#kvFront');
  for (let i = 0; i < 15; i++) {
    if (await txt(page, '#stateBadge') === 'SPEECH') break;
    await sleep(400);
  }
  const rawAtSet = await txt(page, '#kvRaw');
  await page.click('#wizAlt'); await sleep(900);
  step('set front: raw was ' + rawAtSet + ' | kvFront ' + frontBefore + ' -> ' + await txt(page, '#kvFront') + ' | nowStep=' + await txt(page, '#wizTitle'));
  await sleep(1500);
  step('angle now: big=' + await txt(page, '#stateBig') + ' | step3 live=' + (await txt(page, '#wizExtra')).trim());
  await page.click('#wizNext'); await sleep(300);
  step('step4: ' + await txt(page, '#wizTitle'));
  await page.click('#wizNext'); await sleep(500);
  step('wizard closed: ' + await page.$eval('#wizard', (e) => !e.classList.contains('open')) + ' | toast=' + await txt(page, '#toast'));
  step('saved profile: ' + await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('es_data_test@echosense.dev') || '{}');
    return d.profile ? 'intensity ' + d.profile.intensity + ', front ' + d.profile.frontOffset : 'NONE';
  }));

  step('stats: ' + await page.evaluate(() => ['stEvents', 'stTalk', 'stTop', 'stFaults'].map((i) => document.getElementById(i).textContent).join(' / ')));

  // --- sign out
  await page.click('#avatar'); await sleep(200);
  step('menu signout label=' + await txt(page, '#menuSignOut'));
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }), page.click('#menuSignOut')]);
  step('after signout -> ' + page.url());
  step('session cleared: ' + await page.evaluate(() => localStorage.getItem('es_session') === null));
  step('sessions recorded: ' + await page.evaluate(() => (JSON.parse(localStorage.getItem('es_data_test@echosense.dev') || '{}').sessions || []).length));

  // --- sign in again
  await page.type('#email', 'test@echosense.dev');
  await page.type('#password', 'hunter2x');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }), page.click('#submit')]);
  step('after signin -> ' + page.url() + ' as ' + await txt(page, '#whoName'));

  // --- guards
  await page.goto(B + '/login.html', { waitUntil: 'networkidle2' });
  step('signed-in visiting login -> ' + page.url());
  await page.evaluate(() => localStorage.removeItem('es_session'));
  await page.goto(B + '/login.html', { waitUntil: 'networkidle2' });
  await page.type('#email', 'test@echosense.dev');
  await page.type('#password', 'wrongpass');
  await page.click('#submit'); await sleep(1500);
  step('bad password err: ' + JSON.stringify(await txt(page, '#err')));
  await page.click('#tabUp'); await sleep(150);
  await page.type('#name', 'Dup');
  await page.click('#submit'); await sleep(1500);
  step('duplicate signup err: ' + JSON.stringify(await txt(page, '#err')));

  console.log('\nERRORS: ' + (bag.length ? '\n' + bag.map((s) => '  ! ' + s).join('\n') : 'none'));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); console.log('ERRORS so far:', bag); process.exit(1); });
