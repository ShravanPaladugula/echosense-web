// Direction-attributed transcript.
//
// Two separate things are fused here, and it matters which is which:
//
//   WORDS come from this computer's or phone's microphone, via the browser's
//   speech recognition. The cap has no idea what anyone said.
//   DIRECTION comes from the cap's telemetry over the window the words were
//   spoken in.
//
// Nothing in this file calls out to an AI. It is arithmetic over two local
// streams, so it keeps working with no API key, no account, and no network
// beyond whatever speech recognition itself uses.
//
// The hard part is honesty about timing. Speech recognition gives no per-word
// timestamps - we only know roughly when an utterance started and when its
// result arrived. So a direction is only claimed when the telemetry over that
// window actually agrees with itself; otherwise the line says so.

import { directionWords } from './radar.js';

// Chrome delivers the first interim result a beat after speech really starts.
const LEAD_MS = 300;
// Below this many usable telemetry samples we do not claim a direction.
const MIN_SAMPLES = 3;
// Mean resultant length, 0..1. 1 is perfect agreement; this is about +/-40 deg
// of scatter. Below it, two people were probably talking, or the cap was
// swinging between them, and "unclear" is the truthful answer.
const MIN_AGREEMENT = 0.7;

// Mean of angles has to be circular, or 350 and 10 average to 180 instead of 0.
export function circularMean(angles) {
  let sx = 0;
  let sy = 0;
  for (const a of angles) {
    const r = (a * Math.PI) / 180;
    sx += Math.cos(r);
    sy += Math.sin(r);
  }
  const n = angles.length || 1;
  const agreement = Math.hypot(sx, sy) / n;
  const mean = (((Math.atan2(sy, sx) * 180) / Math.PI) + 360) % 360;
  return { mean, agreement };
}

// "front-right" -> "from your front-right"; front and back read better without
// the possessive.
function phrase(angle) {
  const w = directionWords(angle);
  if (!w) return null;
  if (w === 'front') return 'from the front';
  if (w === 'back') return 'from behind';
  return 'from your ' + w;
}

// Decide what this line is allowed to claim about direction.
export function attribute(samples, { connected }) {
  if (!connected) return { label: 'no cap connected', sure: false };
  const usable = samples.filter((p) => p.state === 'SPEECH' && p.angle >= 0);
  if (!usable.length) return { label: 'cap heard no voice', sure: false };
  if (usable.length < MIN_SAMPLES) return { label: 'direction unclear', sure: false };
  const { mean, agreement } = circularMean(usable.map((p) => p.angle));
  if (agreement < MIN_AGREEMENT) return { label: 'direction unclear', sure: false };
  return { label: phrase(mean), angle: Math.round(mean) % 360, sure: true };
}

// Ask the server to tidy punctuation. The raw lines are never replaced - this
// returns a second, prettier view of the same record, and any failure leaves
// the transcript exactly as it was.
export async function tidy(lines) {
  const res = await fetch('/api/tidy', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ lines: lines.map((l) => ({ direction: l.label, text: l.text })) }),
  });
  let body = null;
  try { body = await res.json(); } catch { /* fall through to the status check */ }
  if (!res.ok) throw new Error((body && body.error) || `Tidying failed (${res.status}).`);
  if (!body || !Array.isArray(body.turns)) throw new Error('Tidying returned nothing usable.');
  return body.turns;
}

export function createTranscript({ box, btn, getSamples, isConnected, onError, onChange }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const lines = [];
  let tidied = null;        // the tidied view, when one has been fetched
  let showing = 'raw';      // 'raw' | 'tidy' - raw is always recoverable
  let rec = null;
  let on = false;
  let startedAt = null;
  let interimEl = null;

  if (!SR) {
    btn.disabled = true;
    box.innerHTML = '<p class="tr-empty">Live transcript needs Chrome or Edge. Everything else on this page works without it, and so does the cap.</p>';
    return { start() {}, stop() {}, lines: () => [], isOn: () => false };
  }

  const empty = () => {
    box.innerHTML = '<p class="tr-empty">Press Start transcript. Words come from this device\'s microphone; the direction beside each line comes from the cap.</p>';
  };
  empty();

  function render() {
    box.innerHTML = '';
    const view = showing === 'tidy' && tidied
      ? tidied.map((t) => ({ label: t.direction, text: t.text, sure: !t.uncertain }))
      : lines;
    for (const l of view) {
      const row = document.createElement('div');
      row.className = 'tr-row' + (l.sure ? '' : ' unsure');
      const dir = document.createElement('span');
      dir.className = 'tr-dir';
      dir.textContent = l.label;
      const text = document.createElement('span');
      text.className = 'tr-text';
      text.textContent = l.text;
      row.append(dir, text);
      box.appendChild(row);
    }
    if (showing === 'raw') {
      interimEl = document.createElement('div');
      interimEl.className = 'tr-row interim';
      interimEl.innerHTML = '<span class="tr-dir"></span><span class="tr-text"></span>';
      box.appendChild(interimEl);
    } else {
      interimEl = null;
    }
    box.scrollTop = box.scrollHeight;
    onChange?.(lines.length, showing);
  }

  function commit(text) {
    const words = text.trim();
    if (!words) return;
    const from = (startedAt || Date.now()) - LEAD_MS;
    const to = Date.now();
    const samples = getSamples().filter((p) => p.time >= from && p.time <= to);
    const { label, sure, angle } = attribute(samples, { connected: isConnected() });
    lines.push({ label, sure, angle, text: words, startedAt: from, endedAt: to });
    if (lines.length > 400) lines.shift();
    startedAt = null;
    render();
  }

  function start() {
    rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || 'en-US';

    // onspeechstart is the better clock when the browser gives it; the first
    // interim result is the fallback.
    rec.onspeechstart = () => { if (!startedAt) startedAt = Date.now(); };
    rec.onresult = (e) => {
      let pending = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) commit(r[0].transcript);
        else pending += r[0].transcript;
      }
      if (pending && !startedAt) startedAt = Date.now();
      if (interimEl) interimEl.lastChild.textContent = pending;
      box.scrollTop = box.scrollHeight;
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed') { onError?.('Microphone permission was denied.'); stop(); }
      else if (e.error === 'network') onError?.('Speech recognition lost the network. Direction still works.');
    };
    rec.onend = () => { if (on) rec.start(); };   // Chrome stops after a silence
    rec.start();
    on = true;
    if (!lines.length) render();
    btn.textContent = 'Stop transcript';
    btn.classList.add('on');
  }

  function stop() {
    on = false;
    rec?.stop();
    btn.textContent = 'Start transcript';
    btn.classList.remove('on');
  }

  btn.onclick = () => (on ? stop() : start());

  return {
    start,
    stop,
    isOn: () => on,
    lines: () => lines.slice(),
    count: () => lines.length,
    showing: () => showing,
    hasTidy: () => !!tidied,
    async runTidy() {
      // new words may land while this is in flight; the raw record keeps them
      tidied = await tidy(lines);
      showing = 'tidy';
      render();
    },
    showRaw() { showing = 'raw'; render(); },
  };
}
