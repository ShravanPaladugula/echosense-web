// Exercises the real BleDevice path with a stubbed navigator.bluetooth:
// connect -> drop out of range -> auto retry -> reconnect, with no hardware.
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

const STUB = () => {
  const U = (n) => `6073553${n}-d38f-4f58-bd4b-8c71cb71361d`;
  const enc = new TextEncoder();
  let notify = null;
  const state = { inRange: true, connected: false, dev: null, tick: null };
  window.__ble = state;

  const cfgBytes = () => {
    const b = new DataView(new ArrayBuffer(14));
    b.setUint8(0, 1); b.setUint8(1, 80);
    [2, 3, 4, 5].forEach((i) => b.setUint8(i, 100));
    b.setUint8(6, 1); b.setUint8(7, 0); b.setUint16(8, 0, true);
    b.setUint8(10, 0); b.setUint8(11, 0); b.setUint8(12, 35); b.setUint8(13, 110);
    return b;
  };
  const chr = (kind) => ({
    readValue: async () => (kind === 'info'
      ? new DataView(enc.encode('fw=2.0.1;xvf=1.0.9;xvf_ok=1;drivers=4').buffer)
      : cfgBytes()),
    writeValueWithResponse: async () => {},
    startNotifications: async function () {
      clearInterval(state.tick);
      state.tick = setInterval(() => {
        if (!state.connected || !notify) return;
        const b = new DataView(new ArrayBuffer(15));
        b.setUint32(0, performance.now() | 0, true);
        b.setUint8(4, 2); b.setUint8(5, 1);
        b.setInt16(6, 90, true); b.setInt16(8, 90, true);
        b.setUint8(10, 0); b.setUint8(11, 80); b.setUint8(12, 0); b.setUint8(13, 0);
        notify({ target: { value: b } });
      }, 200);
      return this;
    },
    addEventListener: (t, fn) => { if (t === 'characteristicvaluechanged') notify = fn; },
    removeEventListener: () => { notify = null; },
  });

  const dev = new EventTarget();
  dev.name = 'EchoSense-7F';
  dev.gatt = {
    get connected() { return state.connected; },
    connect: async () => {
      if (!state.inRange) { const e = new Error('GATT failed'); e.name = 'NetworkError'; throw e; }
      state.connected = true;
      return { getPrimaryService: async () => ({ getCharacteristic: async (u) => chr(u === U(6) ? 'info' : 'other') }) };
    },
    disconnect: () => {
      state.connected = false;
      clearInterval(state.tick);
      dev.dispatchEvent(new Event('gattserverdisconnected'));
    },
  };
  state.dev = dev;
  state.drop = () => dev.gatt.disconnect();

  // navigator.bluetooth is a prototype accessor in Chrome: plain assignment
  // is silently dropped, so define over it.
  window.__reqCount = 0;
  const fake = {
    getAvailability: async () => true,
    requestDevice: async () => { window.__reqCount++; return dev; },
  };
  Object.defineProperty(Navigator.prototype, 'bluetooth', { configurable: true, get: () => fake });
};

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'shell', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  page.on('console', (m) => { if (m.type() === 'error') bag.push('[console] ' + m.text()); });
  page.on('pageerror', (e) => bag.push('[pageerror] ' + e.message));
  await page.evaluateOnNewDocument(STUB);

  await page.goto(B + '/dashboard.html?demo=1', { waitUntil: 'networkidle2' });
  await sleep(600);

  // --- connect to the "cap"
  await page.click('#connectBtn');
  await sleep(1200);
  step('connected: ' + await txt(page, '#connText'));
  step('device info: fw=' + await txt(page, '#kvFw') + ' xvf=' + await txt(page, '#kvXvf') + ' drivers=' + await txt(page, '#kvDrv'));
  step('button now says: ' + await txt(page, '#connectBtn'));
  step('live angle: ' + await txt(page, '#stateBig') + ' / badge ' + await txt(page, '#stateBadge'));

  // --- walk out of range: auto-retry should kick in and fail 3 times
  await page.evaluate(() => { window.__ble.inRange = false; window.__ble.drop(); });
  await sleep(900);
  step('right after drop: ' + await txt(page, '#connText'));
  await sleep(7500);
  step('after 3 failed retries: ' + await txt(page, '#connText') + ' | Reconnect button shown: ' + await vis(page, '#reconnectBtn'));
  step('told the user: ' + await txt(page, '#stateSub'));

  // --- walk back into range and press Reconnect
  await page.evaluate(() => { window.__ble.inRange = true; });
  await page.click('#reconnectBtn');
  await sleep(1500);
  step('after Reconnect: ' + await txt(page, '#connText') + ' | badge ' + await txt(page, '#stateBadge'));
  step('no chooser was needed: requestDevice calls = ' + await page.evaluate(() => window.__reqCount || 'only the first one'));

  // --- a drop that recovers on the first auto-retry
  await page.evaluate(() => { window.__ble.drop(); });
  await sleep(3000);
  step('auto-recovered after a brief drop: ' + await txt(page, '#connText'));

  // --- deliberate disconnect must NOT auto-retry
  await page.click('#connectBtn');
  await sleep(3000);
  step('after pressing Disconnect: ' + await txt(page, '#connText') + ' | Reconnect shown: ' + await vis(page, '#reconnectBtn') + ' | help offered: ' + await vis(page, '#helpBtn'));

  console.log('\nERRORS: ' + (bag.length ? '\n' + bag.map((s) => '  ! ' + s).join('\n') : 'none'));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); console.log('ERRORS:', bag); process.exit(1); });
