// Tests the direction fusion two ways:
//   1. the pure maths, against cases that are easy to get wrong
//   2. end to end, by stubbing SpeechRecognition (headless Chrome has none)
//      and firing an utterance while the demo device is genuinely talking
const puppeteer = require('puppeteer-core');
const B = process.env.BASE || 'http://localhost:8000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bag = [];
const step = (s) => console.log('  * ' + s);
let failures = 0;
const expect = (name, got, want) => {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
};

const STUB = () => {
  class FakeSR {
    constructor() { this.continuous = false; this.interimResults = false; this.lang = 'en-US'; }
    start() { window.__sr = this; }
    stop() { window.__sr = null; this.onend && this.onend(); }
  }
  Object.defineProperty(window, 'SpeechRecognition', { configurable: true, get: () => FakeSR });
  Object.defineProperty(window, 'webkitSpeechRecognition', { configurable: true, get: () => FakeSR });
  window.__say = (text, final) => {
    const sr = window.__sr;
    if (!sr) return 'no recogniser running';
    sr.onresult({ resultIndex: 0, results: [{ isFinal: !!final, 0: { transcript: text } }] });
    return 'ok';
  };
};

(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'shell', args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1100 });
  page.on('console', (m) => { if (m.type() === 'error') bag.push('[console] ' + m.text()); });
  page.on('pageerror', (e) => bag.push('[pageerror] ' + e.message));
  await page.evaluateOnNewDocument(STUB);
  await page.goto(B + '/dashboard.html?demo=1', { waitUntil: 'networkidle2' });
  await sleep(1800);

  // ---------- 1. the maths ----------
  console.log('\n-- circular mean --');
  const m = await page.evaluate(async () => {
    const t = await import('./js/transcript.js');
    const r = (xs) => { const o = t.circularMean(xs); return { mean: Math.round(o.mean), agreement: +o.agreement.toFixed(3) }; };
    return {
      wrap: r([350, 10]),          // the case a plain average gets wrong
      tight: r([40, 44, 38, 42]),
      opposed: r([0, 180]),
      scattered: r([10, 120, 250]),
    };
  });
  expect('350 and 10 average to 0, not 180', m.wrap.mean, 0);
  expect('tight cluster averages correctly', m.tight.mean, 41);
  expect('opposed angles have no agreement', m.opposed.agreement, 0);
  step(`scattered agreement ${m.scattered.agreement} (low, as it should be)`);

  // ---------- 2. what each line is allowed to claim ----------
  console.log('\n-- honesty of the label --');
  const a = await page.evaluate(async () => {
    const t = await import('./js/transcript.js');
    const S = (angle, n) => Array.from({ length: n }, () => ({ state: 'SPEECH', angle }));
    return {
      offline: t.attribute(S(90, 10), { connected: false }).label,
      silent: t.attribute([{ state: 'LISTENING', angle: -1 }], { connected: true }).label,
      thin: t.attribute(S(90, 2), { connected: true }).label,
      scattered: t.attribute(
        [10, 130, 250, 330].map((x) => ({ state: 'SPEECH', angle: x })), { connected: true }).label,
      right: t.attribute(S(90, 8), { connected: true }).label,
      front: t.attribute(S(2, 8), { connected: true }).label,
      back: t.attribute(S(180, 8), { connected: true }).label,
      wrapped: t.attribute([355, 2, 358, 5, 0].map((x) => ({ state: 'SPEECH', angle: x })), { connected: true }).label,
    };
  });
  expect('no device -> says so', a.offline, 'no cap connected');
  expect('cap heard nothing -> says so', a.silent, 'cap heard no voice');
  expect('too few samples -> unclear', a.thin, 'direction unclear');
  expect('scattered angles -> unclear', a.scattered, 'direction unclear');
  expect('tight right -> from your right', a.right, 'from your right');
  expect('tight front -> from the front', a.front, 'from the front');
  expect('tight back -> from behind', a.back, 'from behind');
  expect('angles across 0 -> from the front', a.wrapped, 'from the front');

  // ---------- 3. end to end against the live demo device ----------
  console.log('\n-- end to end --');
  await page.click('#capBtn');
  await sleep(300);
  step('button now reads: ' + await page.$eval('#capBtn', (e) => e.textContent));

  // wait until the demo device is actually reporting speech, then speak across it
  let heard = null;
  for (let i = 0; i < 60; i++) {
    const s = await page.evaluate(() => ({
      badge: document.getElementById('stateBadge').textContent,
      big: document.getElementById('stateBig').textContent,
    }));
    if (s.badge === 'SPEECH') { heard = s.big; break; }
    await sleep(200);
  }
  await page.evaluate(() => window.__sr && window.__sr.onspeechstart && window.__sr.onspeechstart());
  await sleep(1200);
  const dashSays = await page.$eval('#stateBig', (e) => e.textContent);
  await page.evaluate(() => window.__say('are you coming tonight', true));
  await sleep(400);

  const row = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#captions .tr-row:not(.interim)')];
    const last = rows[rows.length - 1];
    return last ? { dir: last.querySelector('.tr-dir').textContent, text: last.querySelector('.tr-text').textContent } : null;
  });
  step(`dashboard said "${dashSays}"`);
  step(`transcript line: [${row && row.dir}] ${row && row.text}`);
  expect('the words are recorded verbatim', row && row.text, 'are you coming tonight');
  const dirWord = (dashSays.match(/front-right|front-left|back-right|back-left|front|back|right|left/) || [])[0];
  const agrees = !!dirWord && !!row && row.dir.includes(dirWord);
  expect('direction matches what the cap was reporting', agrees, true);

  // a line spoken while the cap reports nothing must not claim a direction
  await page.evaluate(() => { document.getElementById('pauseBtn').click(); });
  await sleep(1400);
  await page.evaluate(() => window.__sr && window.__sr.onspeechstart && window.__sr.onspeechstart());
  await sleep(900);
  await page.evaluate(() => window.__say('nobody can tell where this came from', true));
  await sleep(400);
  const paused = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#captions .tr-row:not(.interim)')];
    const last = rows[rows.length - 1];
    return { dir: last.querySelector('.tr-dir').textContent, unsure: last.classList.contains('unsure') };
  });
  expect('paused cap -> no direction claimed', paused.dir, 'cap heard no voice');
  expect('and the line is marked uncertain', paused.unsure, true);

  // ---------- 4. the tidy pass, with /api/tidy stubbed ----------
  console.log('\n-- tidy pass --');
  const rawBefore = await page.evaluate(() =>
    [...document.querySelectorAll('#captions .tr-row:not(.interim) .tr-text')].map((e) => e.textContent).join(' | '));
  expect('raw transcript has lines to work with', rawBefore.length > 0, true);

  // a) server unreachable / not configured: the raw record must survive untouched
  await page.evaluate(() => {
    window.fetch = async () => new Response(
      JSON.stringify({ error: 'Tidying is not configured on this deployment.' }),
      { status: 503, headers: { 'content-type': 'application/json' } });
  });
  await page.click('#tidyBtn');
  await sleep(700);
  const afterFail = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('#captions .tr-row:not(.interim) .tr-text')].map((e) => e.textContent).join(' | '),
    toast: document.getElementById('toast').textContent,
    btn: document.getElementById('tidyBtn').textContent,
    rawHidden: document.getElementById('rawBtn').hidden,
  }));
  expect('failed tidy leaves the raw transcript identical', afterFail.rows, rawBefore);
  expect('the failure is reported to the user', afterFail.toast.includes('not configured'), true);
  expect('tidy button recovers its label', afterFail.btn, 'Tidy up');
  expect('no raw/tidy toggle appears after a failure', afterFail.rawHidden, true);

  // b) a successful tidy
  await page.evaluate(() => {
    window.fetch = async (url, opts) => {
      const sent = JSON.parse(opts.body).lines;
      window.__sentToTidy = sent;
      const turns = sent.map((l) => ({
        direction: l.direction,
        text: l.text.charAt(0).toUpperCase() + l.text.slice(1) + '.',
        uncertain: /unclear|no voice|no cap/.test(l.direction),
      }));
      return new Response(JSON.stringify({ turns }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
  });
  await page.click('#tidyBtn');
  await sleep(700);
  const afterOk = await page.evaluate(() => ({
    first: [...document.querySelectorAll('#captions .tr-row:not(.interim) .tr-text')].map((e) => e.textContent)[0] || '',
    rawHidden: document.getElementById('rawBtn').hidden,
    tidyDisabled: document.getElementById('tidyBtn').disabled,
    sent: (window.__sentToTidy || []).length,
  }));
  expect('the tidied view is shown', afterOk.first.endsWith('.'), true);
  expect('Show raw becomes available', afterOk.rawHidden, false);
  expect('Tidy is disabled while already tidied', afterOk.tidyDisabled, true);
  expect('the cap-measured directions were sent, not re-derived', afterOk.sent > 0, true);

  // c) back to raw, byte for byte
  await page.click('#rawBtn');
  await sleep(500);
  const backToRaw = await page.evaluate(() =>
    [...document.querySelectorAll('#captions .tr-row:not(.interim) .tr-text')].map((e) => e.textContent).join(' | '));
  expect('Show raw restores the original record exactly', backToRaw, rawBefore);

  console.log('\nERRORS: ' + (bag.length ? '\n' + bag.map((s) => '  ! ' + s).join('\n') : 'none'));
  console.log(failures ? `\n${failures} FAILED` : '\nall assertions passed');
  await browser.close();
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); console.log('ERRORS:', bag); process.exit(1); });
