const puppeteer = require('puppeteer-core');
const fs = require('fs');
fs.mkdirSync(process.env.OUT || './out', { recursive: true });
const B = process.env.BASE || 'http://localhost:8000';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const STUB = () => {
  class FakeSR { constructor(){this.continuous=false;this.interimResults=false;} start(){window.__sr=this;} stop(){window.__sr=null;this.onend&&this.onend();} }
  Object.defineProperty(window,'SpeechRecognition',{configurable:true,get:()=>FakeSR});
  Object.defineProperty(window,'webkitSpeechRecognition',{configurable:true,get:()=>FakeSR});
  window.__say=(t,f)=>{const s=window.__sr;if(!s)return;s.onresult({resultIndex:0,results:[{isFinal:!!f,0:{transcript:t}}]});};
};
(async () => {
  const br = await puppeteer.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'shell', args: ['--no-sandbox'] });
  const p = await br.newPage();
  await p.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 2 });
  await p.evaluateOnNewDocument(STUB);
  await p.goto(B + '/dashboard.html?demo=1', { waitUntil: 'networkidle2' });
  await sleep(2000);
  await p.click('#capBtn');
  // speak a few times across the demo's rotating talkers
  const says = ['are you coming to the thing tonight', 'yeah i think so what time', 'about eight', 'see you there'];
  for (const line of says) {
    for (let i = 0; i < 40; i++) {
      const b = await p.$eval('#stateBadge', e => e.textContent);
      if (b === 'SPEECH') break;
      await sleep(200);
    }
    await p.evaluate(() => window.__sr && window.__sr.onspeechstart && window.__sr.onspeechstart());
    await sleep(1100);
    await p.evaluate((t) => window.__say(t, true), line);
    await sleep(700);
  }
  await p.evaluate(() => window.__sr && window.__sr.onspeechstart && window.__sr.onspeechstart());
  await p.evaluate(() => window.__say('and this one is still being said', false));
  await sleep(300);
  const card = await p.$('#captions');
  const sec = await p.evaluateHandle(() => document.querySelector('#captions').closest('section'));
  await sec.asElement().screenshot({ path: (process.env.OUT || './out') + '/transcript.png' });
  console.log(await p.evaluate(() => [...document.querySelectorAll('#captions .tr-row:not(.interim)')].map(r => '[' + r.querySelector('.tr-dir').textContent + '] ' + r.querySelector('.tr-text').textContent).join('\n')));
  await br.close();
})();
