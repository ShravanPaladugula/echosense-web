import { currentUser, signOut, userData, saveUserData } from './auth.js';
import { createRadar, directionWords } from './radar.js';
import { BleDevice, DemoDevice, CMD, bluetoothSupported, bluetoothAvailable, describeBleError } from './device.js';
import { createTranscript } from './transcript.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const user = currentUser();
if (!user && !params.has('demo')) location.replace('login.html');

const MOTOR_NAMES = ['Front', 'Right', 'Back', 'Left'];
const PROFILES = {
  subtle: { intensity: 45, sensitivity: 2 },
  normal: { intensity: 80, sensitivity: 1 },
  strong: { intensity: 100, sensitivity: 0 },
};

let dev = null;
let cfg = null;
let last = null;            // latest telemetry
let log = [];               // full session log for CSV
let sessionStart = 0;
let sessionSaved = false;
const stats = { events: 0, speechMs: 0, faults: 0, sides: [0, 0, 0, 0] };

// ---------- header / account ----------
const who = user || { name: 'Guest', email: 'Demo without an account' };
$('avatar').textContent = who.name.trim().charAt(0).toUpperCase() || '?';
$('whoName').textContent = who.name;
$('whoEmail').textContent = who.email;
$('avatar').onclick = (e) => { e.stopPropagation(); $('menu').classList.toggle('open'); };
document.addEventListener('click', () => $('menu').classList.remove('open'));
$('menuSignOut').textContent = user ? 'Sign out' : 'Sign in';
$('menuSignOut').onclick = () => { dev?.disconnect(); if (user) signOut(); location.href = 'login.html'; };
$('menuExport').onclick = exportCsv;
$('menuHelp').onclick = openHelp;
$('helpBtn').onclick = openHelp;
$('helpClose').onclick = () => $('help').classList.remove('open');

// ---------- can this browser talk to the cap at all? ----------
function openHelp() {
  const ok = bluetoothSupported();
  const rows = [
    [!!navigator.bluetooth, 'This browser speaks Web Bluetooth', 'This browser cannot. Use Chrome or Edge (not Safari, not any iPhone browser).'],
    [window.isSecureContext, 'The page is on https or localhost', 'The page is not on https. Bluetooth stays blocked until it is.'],
  ];
  $('helpCheck').innerHTML = rows.map(([pass, good, bad]) =>
    `<div class="chk ${pass ? 'pass' : 'fail'}"><span>${pass ? 'Yes' : 'No'}</span><span>${pass ? good : bad}</span></div>`).join('');
  if (ok) {
    bluetoothAvailable().then((on) => {
      if (on === false) $('helpCheck').insertAdjacentHTML('beforeend',
        '<div class="chk fail"><span>No</span><span>No Bluetooth radio is switched on here. Turn Bluetooth on, then reopen this.</span></div>');
    });
  }
  $('help').classList.add('open');
}

if (!bluetoothSupported()) {
  $('btBanner').innerHTML = !navigator.bluetooth
    ? 'This browser cannot use Bluetooth. Open the page in <b>Chrome</b> or <b>Edge</b> on Android, Windows, Mac or Linux. Demo mode still works here, and the cap works on its own either way.'
    : 'Bluetooth needs <b>https</b> or <b>localhost</b>. Demo mode still works here.';
  $('btBanner').hidden = false;
  $('connectBtn').disabled = true;
} else {
  bluetoothAvailable().then((on) => {
    if (on !== false) return;
    $('btBanner').innerHTML = 'No Bluetooth radio is switched on. Turn Bluetooth on, then press Connect device.';
    $('btBanner').hidden = false;
  });
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2400);
}

// ---------- live view ----------
const radar = createRadar($('radar'));
$('bars').innerHTML = MOTOR_NAMES.map((n, i) =>
  `<div class="bar-row"><span>${n}</span><div class="bar"><i id="bar${i}"></i></div><span id="barv${i}">0%</span></div>`).join('');

function stateText(t) {
  switch (t.state) {
    case 'SPEECH': return [`Voice from the ${directionWords(t.angle)}`, `${t.angle}° · motors pointing you there`];
    case 'UNCERTAIN': return ['Voice, direction unclear', 'Several directions at once: buzzing softly'];
    case 'LISTENING': return ['Listening', 'Quiet around you'];
    case 'PAUSED': return ['Paused', 'Motors are off until you resume'];
    case 'FAULT': return ['Mic not responding', 'Motors are off for safety. Check the mic wiring and power.'];
    default: return ['Starting', 'Running self-test'];
  }
}

function onTelemetry(t) {
  const prev = last;
  last = t;
  radar.update(t);
  t.motors.forEach((p, i) => {
    $('bar' + i).style.width = p + '%';
    $('barv' + i).textContent = Math.round(p) + '%';
  });
  const [big, sub] = stateText(t);
  $('stateBig').textContent = big;
  $('stateSub').textContent = sub;
  $('stateBadge').textContent = t.state;
  $('stateBadge').className = 'badge ' + t.state;
  $('kvRaw').textContent = t.raw >= 0 ? t.raw + '°' : '-';
  $('pauseBtn').textContent = t.muted ? 'Resume' : 'Pause';
  $('pauseBtn').classList.toggle('on', t.muted);
  if (cfg && cfg.muted !== t.muted) cfg.muted = t.muted;

  const speaking = t.state === 'SPEECH' || t.state === 'UNCERTAIN';
  const wasSpeaking = prev && (prev.state === 'SPEECH' || prev.state === 'UNCERTAIN');
  if (speaking && !wasSpeaking) stats.events++;
  if (speaking && prev && t.ms > prev.ms) stats.speechMs += Math.min(2000, t.ms - prev.ms);
  if (t.state === 'SPEECH' && t.angle >= 0) stats.sides[Math.round(t.angle / 90) % 4]++;
  if (t.state === 'FAULT' && prev?.state !== 'FAULT') stats.faults++;
  log.push({ time: Date.now(), ...t });
  if (log.length > 30000) log.shift();
  wizardTick(t);
}

function renderStats() {
  $('stEvents').textContent = stats.events;
  $('stTalk').textContent = Math.round(stats.speechMs / 1000) + 's';
  const max = Math.max(...stats.sides);
  $('stTop').textContent = max ? MOTOR_NAMES[stats.sides.indexOf(max)] : '-';
  $('stFaults').textContent = stats.faults;
}

// ---------- timeline ----------
const cv = $('timeline');
function drawTimeline() {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const css = getComputedStyle(document.documentElement);
  const line = css.getPropertyValue('--line').trim();
  const faint = css.getPropertyValue('--faint').trim();
  const accent = css.getPropertyValue('--accent').trim();
  const warn = css.getPropertyValue('--warn').trim();
  const bad = css.getPropertyValue('--bad').trim();
  const left = 48, top = 14, bottom = h - 14;
  g.font = '500 9px Sora, system-ui, sans-serif';
  g.textBaseline = 'middle';
  g.lineWidth = 1;
  ['FRONT', 'RIGHT', 'BACK', 'LEFT', 'FRONT'].forEach((l, i) => {
    const y = top + (bottom - top) * i / 4;
    g.strokeStyle = line;
    g.beginPath(); g.moveTo(left, y + 0.5); g.lineTo(w - 10, y + 0.5); g.stroke();
    g.fillStyle = faint;
    g.fillText(l, 6, y);
  });

  const now = Date.now();
  const span = 60000;
  const pts = log.filter((p) => now - p.time <= span);
  if (!pts.length) return;
  const x = (t) => left + (w - 10 - left) * (1 - (now - t) / span);
  const y = (a) => top + (bottom - top) * (a / 360);

  // fault bars first, so the wave draws over them
  g.fillStyle = bad;
  for (const p of pts) if (p.state === 'FAULT') g.fillRect(x(p.time), top, 2, bottom - top);

  // one continuous stroke, broken on silence and never wrapped across the
  // 360/0 seam - a jump of more than half a turn is a wrap, not a movement
  const stroke = (match, colour, width) => {
    g.strokeStyle = colour;
    g.lineWidth = width;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.beginPath();
    let drawing = false, prev = null;
    for (const p of pts) {
      if (!match(p) || p.angle < 0) { drawing = false; prev = null; continue; }
      const px = x(p.time), py = y(p.angle);
      if (!drawing || (prev && Math.abs(p.angle - prev.angle) > 180)) { g.moveTo(px, py); drawing = true; }
      else g.lineTo(px, py);
      prev = p;
    }
    g.stroke();
  };
  stroke((p) => p.state === 'UNCERTAIN', warn, 1.25);
  stroke((p) => p.state === 'SPEECH', accent, 1.75);

  const last = pts[pts.length - 1];
  if (last && last.state === 'SPEECH' && last.angle >= 0) {
    g.fillStyle = accent;
    g.beginPath(); g.arc(x(last.time), y(last.angle), 2.5, 0, Math.PI * 2); g.fill();
  }
}
setInterval(() => { drawTimeline(); renderStats(); }, 250);
drawTimeline();

// ---------- connect ----------
function setConn(kind, text) {
  $('connPill').className = 'pill ' + kind;
  $('connText').textContent = text;
}

function enableControls(on) {
  for (const id of ['pauseBtn', 'selfTestBtn', 'setFrontBtn', 'flipBtn', 'wizardBtn', 'intensity', 'resetBtn', 'saveProfileBtn']) $(id).disabled = !on;
  document.querySelectorAll('#gains input, #gains button, .seg button').forEach((b) => (b.disabled = !on));
  $('saveProfileBtn').disabled = !on || !user;
}
function parseInfo(s) {
  return Object.fromEntries(s.split(';').map((kv) => kv.split('=')));
}

let lastBle = null;   // the cap we already picked, so Reconnect needs no chooser
let retries = 0;
let retryTimer = null;

// Everything that has to happen once a link is live, whether it is the first
// connection or a reconnection to a cap we already picked.
function afterConnected(d) {
  const demo = d.kind === 'demo';
  clearTimeout(retryTimer);
  retries = 0;
  dev = d;
  cfg = { ...d.config };
  const info = parseInfo(d.info || '');
  $('kvName').textContent = d.name;
  $('kvFw').textContent = info.fw || '-';
  $('kvXvf').textContent = info.xvf_ok === '1' ? `OK · fw ${info.xvf}` : 'NOT FOUND';
  $('kvDrv').textContent = (info.drivers || '?') + ' / 4';
  setConn(demo ? 'demo' : 'ok', demo ? 'Demo device' : 'Connected · ' + d.name);
  $('connectBtn').textContent = demo ? 'Connect device' : 'Disconnect';
  $('reconnectBtn').hidden = true;
  $('helpBtn').hidden = true;
  enableControls(true);
  renderConfig();
  offerSavedProfile();
  startSession();
}

async function connect(kind) {
  if (dev) dev.disconnect();
  clearTimeout(retryTimer);
  const d = kind === 'demo' ? new DemoDevice() : new BleDevice();
  setConn('busy', kind === 'demo' ? 'Starting demo…' : 'Waiting for you to pick the cap…');
  try {
    await d.connect();
  } catch (e) {
    setConn('', 'Not connected');
    $('helpBtn').hidden = false;
    // NotFoundError is also what you get for pressing Cancel, so only nag if
    // the chooser was actually used.
    if (e.name !== 'NotFoundError') toast(describeBleError(e));
    return;
  }
  if (kind === 'ble') lastBle = d;
  d.addEventListener('telemetry', (e) => onTelemetry(e.detail));
  d.addEventListener('disconnected', () => onDisconnected(d));
  afterConnected(d);
  toast(kind === 'demo'
    ? 'Demo running: simulated people take turns talking around you.'
    : 'Connected to your EchoSense.');
}

function onDisconnected(d) {
  if (dev !== d) return;
  endSession();
  dev = null;
  enableControls(false);
  $('connectBtn').textContent = 'Connect device';
  $('stateBadge').textContent = 'OFFLINE';
  $('stateBadge').className = 'badge';
  $('profileBar').hidden = true;
  radar.update({});
  $('stateBig').textContent = 'Disconnected';
  $('stateSub').textContent = 'The cap keeps listening and buzzing on its own. Reconnect to change settings.';
  // A cap that walks out of range can be picked up again with no browser
  // dialog, so try a few times before asking the wearer to do anything.
  if (d.closed || !d.canReconnect) {
    setConn('', 'Disconnected');
    $('helpBtn').hidden = false;
    return;
  }
  retries = 0;
  retryLoop(d);
}

function retryLoop(d) {
  if (dev || d.closed) return;
  if (retries >= 3) {
    setConn('', 'Out of range');
    $('reconnectBtn').hidden = false;
    $('stateSub').textContent = 'Lost the cap after three tries. It keeps working on its own: press Reconnect when you are back in range.';
    return;
  }
  retries++;
  setConn('busy', `Reconnecting… (${retries} of 3)`);
  retryTimer = setTimeout(() => reconnect(d, true), 2000);
}

async function reconnect(d, auto) {
  if (dev || d.closed) return;
  if (!auto) setConn('busy', 'Reconnecting…');
  try {
    await d.open();
  } catch (e) {
    if (auto) return retryLoop(d);
    setConn('', 'Out of range');
    $('reconnectBtn').hidden = false;
    toast(describeBleError(e));
    return;
  }
  afterConnected(d);
  toast('Back on: reconnected to ' + d.name + '.');
}

$('connectBtn').onclick = () => (dev?.kind === 'ble' ? dev.disconnect() : connect('ble'));
$('demoBtn').onclick = () => connect('demo');
$('reconnectBtn').onclick = () => { const d = lastBle; if (d) reconnect(d, false); };

// ---------- settings ----------
function renderConfig() {
  if (!cfg) return;
  $('intensity').value = cfg.intensity;
  $('intensityVal').textContent = cfg.intensity + '%';
  setSeg('sensSeg', cfg.sensitivity);
  setSeg('mixSeg', cfg.mix);
  const prof = Object.entries(PROFILES).find(([, p]) => p.intensity === cfg.intensity && p.sensitivity === cfg.sensitivity);
  document.querySelectorAll('#profileSeg button').forEach((b) => b.classList.toggle('active', prof?.[0] === b.dataset.p));
  cfg.gains.forEach((g, i) => { $('gain' + i).value = g; $('gainv' + i).textContent = g + '%'; });
  $('kvFront').textContent = `${cfg.frontOffset}° ${cfg.flip ? '(flipped)' : ''}`;
  $('flipBtn').classList.toggle('on', cfg.flip);
}

function setSeg(id, v) {
  document.querySelectorAll(`#${id} button`).forEach((b) => b.classList.toggle('active', Number(b.dataset.v) === v));
}

let saveTimer;
function pushConfig() {
  renderConfig();
  $('saveState').textContent = 'Saving…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await dev.writeConfig(cfg);
      $('saveState').textContent = 'Saved on device';
    } catch (e) {
      $('saveState').textContent = 'Not saved';
      toast('Save failed: ' + e.message);
    }
  }, 250);
}

$('intensity').oninput = (e) => { cfg.intensity = Number(e.target.value); pushConfig(); };
document.querySelectorAll('#sensSeg button').forEach((b) => (b.onclick = () => { cfg.sensitivity = Number(b.dataset.v); pushConfig(); }));
document.querySelectorAll('#mixSeg button').forEach((b) => (b.onclick = () => { cfg.mix = Number(b.dataset.v); pushConfig(); }));
document.querySelectorAll('#profileSeg button').forEach((b) => (b.onclick = () => { Object.assign(cfg, PROFILES[b.dataset.p]); pushConfig(); }));

$('gains').innerHTML = MOTOR_NAMES.map((n, i) => `
  <div class="gain-row">
    <span>${n}</span>
    <input type="range" id="gain${i}" min="0" max="150" step="5" value="100" aria-label="${n} motor balance">
    <span id="gainv${i}">100%</span>
    <button class="btn small" data-test="${i}">Buzz</button>
  </div>`).join('');
MOTOR_NAMES.forEach((_, i) => {
  $('gain' + i).oninput = (e) => { cfg.gains[i] = Number(e.target.value); pushConfig(); };
});
document.querySelectorAll('[data-test]').forEach((b) => (b.onclick = () => {
  const i = Number(b.dataset.test);
  dev.hapticTest(i, Math.min(100, Math.round(cfg.intensity * cfg.gains[i] / 100)), 500);
}));

// ---------- quick controls ----------
$('pauseBtn').onclick = () => dev.command(last?.muted ? CMD.UNMUTE : CMD.MUTE);
$('selfTestBtn').onclick = () => dev.command(CMD.SELF_TEST);
$('flipBtn').onclick = () => { cfg.flip = !cfg.flip; pushConfig(); toast(cfg.flip ? 'Direction flipped' : 'Direction normal'); };
$('setFrontBtn').onclick = setFront;
$('resetBtn').onclick = async () => {
  await dev.command(CMD.FACTORY_RESET);
  setTimeout(async () => { cfg = { ...(await dev.refreshConfig()) }; renderConfig(); toast('Device reset to defaults'); }, 400);
};

async function setFront() {
  if (!last?.voice) { toast('Have someone talk from in front of you first.'); return false; }
  await dev.command(CMD.SET_FRONT);
  await new Promise((r) => setTimeout(r, 400));
  cfg = { ...(await dev.refreshConfig()) };
  renderConfig();
  toast('Front saved');
  return true;
}

// ---------- calibration wizard ----------
const W = [
  {
    title: 'Put on the cap',
    body: 'Wear the cap with the FRONT mark over your forehead. Press "Buzz each motor": you should feel front, right, back, then left.',
    alt: 'Buzz each motor', altFn: () => dev.command(CMD.SELF_TEST),
  },
  {
    title: 'Set your front',
    body: 'Ask a friend to stand right in front of you and keep talking. When the dot below turns on, press "Set front now".',
    alt: 'Set front now', altFn: async () => { if (await setFront()) wizGo(1); },
    live: true,
  },
  {
    title: 'Check left and right',
    body: 'Now your friend moves to your RIGHT side and keeps talking. Check what the cap says below.',
    alt: 'It says left: flip it', altFn: () => { cfg.flip = !cfg.flip; pushConfig(); toast('Direction flipped. Check again.'); },
    live: true,
  },
  {
    title: 'Balance the motors',
    body: 'Buzz each motor and adjust the sliders in "Per-motor balance" until all four feel equally strong. Then press Finish.',
    alt: 'Buzz each motor', altFn: () => dev.command(CMD.SELF_TEST),
  },
];
let wizStep = 0;

function wizRender() {
  const s = W[wizStep];
  $('wizCount').textContent = `Step ${wizStep + 1} of ${W.length}`;
  $('wizTitle').textContent = s.title;
  $('wizBody').textContent = s.body;
  $('wizAlt').hidden = !s.alt;
  $('wizAlt').textContent = s.alt || '';
  $('wizNext').textContent = wizStep === W.length - 1 ? 'Finish' : 'Next';
  [...$('wizSteps').children].forEach((el, i) => el.classList.toggle('done', i <= wizStep));
  $('wizExtra').innerHTML = s.live ? '<div class="pill" id="wizLive" style="margin-top:6px"><span class="dot"></span><span>Waiting for a voice…</span></div>' : '';
}
function wizGo(d) {
  wizStep = Math.max(0, Math.min(W.length - 1, wizStep + d));
  wizRender();
}
function wizardTick(t) {
  const el = document.getElementById('wizLive');
  if (!el) return;
  const voice = t.state === 'SPEECH' || t.state === 'UNCERTAIN';
  el.className = 'pill ' + (voice ? 'ok' : '');
  el.lastChild.textContent = !voice ? 'Waiting for a voice…'
    : wizStep === 2 ? `Cap says: ${directionWords(t.angle)} (${t.angle}°)` : `Voice heard (mic angle ${t.raw}°)`;
}
$('wizardBtn').onclick = () => { wizStep = 0; wizRender(); $('wizard').classList.add('open'); };
$('wizCancel').onclick = () => $('wizard').classList.remove('open');
$('wizAlt').onclick = () => W[wizStep].altFn?.();
$('wizNext').onclick = () => {
  if (wizStep < W.length - 1) return wizGo(1);
  $('wizard').classList.remove('open');
  if (user) {
    const data = userData(user.email);
    data.profile = { ...cfg, savedAt: Date.now() };
    saveUserData(user.email, data);
  }
  toast('Calibration saved');
};

// ---------- saved calibration ----------
// login.html promises the account remembers motor strengths and front
// direction, so it has to be possible to put them back on a cap.
const PROFILE_KEYS = ['intensity', 'sensitivity', 'mix', 'frontOffset', 'flip'];

function sameSettings(a, b) {
  return PROFILE_KEYS.every((k) => a[k] === b[k]) && a.gains.every((g, i) => g === b.gains[i]);
}

function offerSavedProfile() {
  $('profileBar').hidden = true;
  if (!user || !cfg || dev?.kind === 'demo') return;
  const p = userData(user.email).profile;
  if (!p || !p.gains || sameSettings(p, cfg)) return;
  const when = new Date(p.savedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  $('profileBarText').textContent = `This cap is not set up the way you saved it on ${when}.`;
  $('profileBar').hidden = false;
}

$('profileApply').onclick = () => {
  const p = userData(user.email).profile;
  if (!p || !dev) return;
  for (const k of PROFILE_KEYS) cfg[k] = p[k];
  cfg.gains = [...p.gains];
  pushConfig();
  $('profileBar').hidden = true;
  toast('Your saved settings are on the cap.');
};
$('profileDismiss').onclick = () => { $('profileBar').hidden = true; };

$('saveProfileBtn').onclick = () => {
  if (!user || !cfg) return;
  const data = userData(user.email);
  data.profile = { ...cfg, savedAt: Date.now() };
  saveUserData(user.email, data);
  $('profileBar').hidden = true;
  toast('Saved to your account, in this browser.');
};

// ---------- sessions ----------
function startSession() {
  sessionStart = Date.now();
  sessionSaved = false;
  log = [];
  Object.assign(stats, { events: 0, speechMs: 0, faults: 0, sides: [0, 0, 0, 0] });
}
function endSession() {
  if (!user || !sessionStart || sessionSaved) return;
  sessionSaved = true;
  const data = userData(user.email);
  data.sessions.unshift({ start: sessionStart, end: Date.now(), events: stats.events, speechSec: Math.round(stats.speechMs / 1000), faults: stats.faults, demo: dev?.kind === 'demo' });
  data.sessions = data.sessions.slice(0, 50);
  saveUserData(user.email, data);
  renderSessions();
}
window.addEventListener('beforeunload', endSession);

function renderSessions() {
  const box = $('sessions');
  if (!user) {
    $('sessionsSub').textContent = '';
    box.innerHTML = '<p class="faint" style="margin:0">Sign in to keep a history of your sessions. Nothing is kept while you are using the demo without an account.</p>';
    return;
  }
  const list = userData(user.email).sessions || [];
  $('sessionsSub').textContent = list.length ? `${list.length} kept in this browser` : 'Kept in this browser';
  if (!list.length) {
    box.innerHTML = '<p class="faint" style="margin:0">No sessions yet. Connect your cap, or try Demo mode, and one is recorded when you disconnect.</p>';
    return;
  }
  const mins = (ms) => (ms < 60000 ? Math.max(1, Math.round(ms / 1000)) + 's' : Math.round(ms / 60000) + ' min');
  box.innerHTML = `<div class="rows">
    <div class="row head"><span>When</span><span>Length</span><span>Speech events</span><span>Speech time</span><span>Mic faults</span></div>
    ${list.slice(0, 8).map((x) => `<div class="row">
      <span>${new Date(x.start).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}${x.demo ? ' <i class="tag">demo</i>' : ''}</span>
      <span><i class="lbl">Length</i>${mins(x.end - x.start)}</span>
      <span><i class="lbl">Events</i>${x.events}</span>
      <span><i class="lbl">Speech</i>${x.speechSec}s</span>
      <span><i class="lbl">Faults</i>${x.faults}</span>
    </div>`).join('')}
  </div>`;
}
renderSessions();

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
}

function exportCsv() {
  const stamp = new Date(sessionStart || Date.now()).toISOString().slice(0, 19).replace(/:/g, '-');

  // the transcript exports as its own file: one row per spoken line, with the
  // direction the cap reported and whether that direction was certain
  const spoken = transcript.lines();
  if (spoken.length) {
    const rows = ['started_iso,ended_iso,direction,certain,device_angle,text'];
    for (const l of spoken) {
      rows.push([
        new Date(l.startedAt).toISOString(),
        new Date(l.endedAt).toISOString(),
        l.label,
        l.sure ? 1 : 0,
        l.angle === undefined ? '' : l.angle,
        '"' + l.text.replace(/"/g, '""') + '"',
      ].join(','));
    }
    download('echosense-transcript-' + stamp + '.csv', rows.join('\n'), 'text/csv');
  }

  if (!log.length) {
    if (!spoken.length) toast('Nothing recorded yet. Connect first.');
    return;
  }
  const rows = ['time_iso,device_ms,state,voice,muted,uncertain,device_angle,raw_angle,front,right,back,left,error'];
  for (const p of log) rows.push([new Date(p.time).toISOString(), p.ms, p.state, +p.voice, +p.muted, +p.uncertain, p.angle, p.raw, ...p.motors, p.error].join(','));
  download('echosense-session-' + stamp + '.csv', rows.join('\n'), 'text/csv');
}

// ---------- transcript ----------
// Words from this device's microphone, direction from the cap. The fusion is
// local arithmetic in transcript.js - no API key, no network of its own.
const transcript = createTranscript({
  box: $('captions'),
  btn: $('capBtn'),
  getSamples: () => log,
  isConnected: () => !!dev,
  onError: toast,
  onChange: (n, showing) => {
    $('tidyBtn').disabled = n === 0 || showing === 'tidy';
    $('rawBtn').hidden = showing !== 'tidy';
  },
});

// Punctuation only. If this fails, or is not configured on the deployment, the
// raw transcript carries on untouched - it is the record, this is a view of it.
$('tidyBtn').onclick = async () => {
  const btn = $('tidyBtn');
  btn.disabled = true;
  btn.textContent = 'Tidying…';
  try {
    await transcript.runTidy();
    toast('Tidied. The words are unchanged - press Show raw to compare.');
  } catch (e) {
    toast(e.message);
    btn.disabled = transcript.count() === 0;
  } finally {
    btn.textContent = 'Tidy up';
  }
};
$('rawBtn').onclick = () => transcript.showRaw();

enableControls(false);
if (params.has('demo')) connect('demo');
