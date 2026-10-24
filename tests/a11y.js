// Contrast of real rendered text against its real background, in both schemes.
// The palette changed with the Sora redesign, so the earlier numbers are stale.
const puppeteer = require('puppeteer-core');
const B = process.env.BASE || 'http://localhost:8000';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const lum = (c) => {
  const p = c.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => {
    v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
let bad = 0;
(async () => {
  const br = await puppeteer.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'shell', args: ['--no-sandbox'] });
  for (const scheme of ['dark', 'light']) {
    const p = await br.newPage();
    await p.setViewport({ width: 1440, height: 1000 });
    await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
    console.log('\n===== ' + scheme + ' =====');
    for (const [url, sels] of [
      ['/', ['body', '.lead', '.hero-note', '.spec dd', '.step p', '.section-head p', 'footer', '.band-head p', '.frame span']],
      ['/dashboard.html?demo=1', ['.state-sub', '.card-head h3', '.kv dt', '.stat span', '.bar-row', '.tr-lede', '.tr-dir']],
    ]) {
      await p.goto(B + url, { waitUntil: 'networkidle2' });
      await sleep(1500);
      const out = await p.evaluate((sels) => sels.map(s => {
        const el = document.querySelector(s); if (!el) return null;
        let bg = getComputedStyle(el).backgroundColor, n = el;
        while ((bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') && n.parentElement) { n = n.parentElement; bg = getComputedStyle(n).backgroundColor; }
        const cs = getComputedStyle(el);
        return { s, color: cs.color, bg, size: parseFloat(cs.fontSize), weight: cs.fontWeight };
      }).filter(Boolean), sels);
      for (const r of out) {
        const cr = ratio(r.color, r.bg);
        const large = r.size >= 24 || (r.size >= 18.66 && +r.weight >= 700);
        const need = large ? 3 : 4.5;
        const ok = cr >= need;
        if (!ok) bad++;
        console.log(`  ${ok ? 'ok  ' : 'LOW '} ${r.s.padEnd(18)} ${cr.toFixed(2)}:1  (${r.size}px, needs ${need})`);
      }
    }
    await p.close();
  }
  console.log(bad ? `\n${bad} below AA` : '\nall text meets WCAG AA');
  await br.close();
})();
