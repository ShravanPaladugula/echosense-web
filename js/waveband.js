// A full-width band of real telemetry: the bearing of whoever is talking, drawn
// as a travelling wave, with the four motor levels stacked underneath it.
//
// Same data and the same plotting approach as the dashboard's drawTimeline(),
// at hero scale over a shorter window. Nothing here is decorative - every pixel
// comes from a telemetry packet. On the landing page those packets come from
// DemoDevice, which is why the markup labels it "Simulated".

const WINDOW_MS = 24000;
const MOTOR_NAMES = ['Front', 'Right', 'Back', 'Left'];

export function createWaveBand(canvas, { windowMs = WINDOW_MS } = {}) {
  const log = [];
  let raf = 0;
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)');

  function push(t) {
    log.push({ time: Date.now(), angle: t.angle, motors: t.motors, state: t.state });
    const cut = Date.now() - windowMs - 1000;
    while (log.length && log[0].time < cut) log.shift();
    if (!raf) raf = requestAnimationFrame(draw);
  }

  function draw() {
    raf = 0;
    if (!log.length) return;          // repaint timer runs before the first packet
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const css = getComputedStyle(document.documentElement);
    const line = css.getPropertyValue('--line').trim();
    const faint = css.getPropertyValue('--faint').trim();
    const ink = css.getPropertyValue('--accent').trim();

    const padL = 52;
    const top = 28;                       // headroom for the BEARING caption
    const bearingH = Math.round(h * 0.52);
    const motorTop = bearingH + 32;       // headroom for the MOTORS caption
    const motorH = h - motorTop - 14;
    const now = Date.now();
    const span = Math.min(windowMs, Math.max(5000, now - log[0].time));
    const x = (t) => padL + (w - padL - 12) * (1 - (now - t) / span);

    // bearing lanes
    g.font = '500 9px Sora, system-ui, sans-serif';
    g.textBaseline = 'middle';
    g.lineWidth = 1;
    g.fillStyle = faint;
    g.fillText('BEARING', 0, top - 15);
    g.textAlign = 'right';
    g.fillText('LAST ' + Math.round(span / 1000) + 'S', w - 12, top - 15);
    g.textAlign = 'left';
    ['Front', 'Right', 'Back', 'Left', 'Front'].forEach((label, i) => {
      const y = top + (bearingH - top) * i / 4;
      g.strokeStyle = line;
      g.beginPath();
      g.moveTo(padL, y + 0.5);
      g.lineTo(w - 12, y + 0.5);
      g.stroke();
      g.fillStyle = faint;
      g.fillText(label.toUpperCase(), 0, y);
    });

    const pts = log.filter((p) => now - p.time <= span);
    if (!pts.length) return;

    // the bearing wave: a continuous stroke, broken wherever nobody is talking,
    // and never wrapped across the 360/0 seam
    const yOf = (a) => top + (bearingH - top) * (a / 360);
    g.strokeStyle = ink;
    g.lineWidth = 1.75;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.beginPath();
    let drawing = false;
    let prev = null;
    for (const p of pts) {
      const live = p.state === 'SPEECH' && p.angle >= 0;
      if (!live) { drawing = false; prev = null; continue; }
      const px = x(p.time);
      const py = yOf(p.angle);
      if (!drawing || (prev && Math.abs(p.angle - prev.angle) > 180)) {
        g.moveTo(px, py);
        drawing = true;
      } else {
        g.lineTo(px, py);
      }
      prev = p;
    }
    g.stroke();

    // motor levels, stacked: four thin waves, one per motor
    const laneH = motorH / 4;
    g.fillStyle = faint;
    g.fillText('MOTORS', 0, motorTop - 15);
    for (let m = 0; m < 4; m++) {
      const base = motorTop + laneH * (m + 1) - 3;
      g.fillStyle = faint;
      g.fillText(MOTOR_NAMES[m].toUpperCase(), 0, base - laneH / 2 + 2);
      g.strokeStyle = line;
      g.beginPath();
      g.moveTo(padL, base + 0.5);
      g.lineTo(w - 12, base + 0.5);
      g.stroke();

      g.strokeStyle = ink;
      g.globalAlpha = 0.72;
      g.lineWidth = 1.25;
      g.beginPath();
      let started = false;
      for (const p of pts) {
        const lvl = (p.motors && p.motors[m]) || 0;
        const px = x(p.time);
        const py = base - (lvl / 100) * (laneH - 6);
        if (!started) { g.moveTo(px, py); started = true; } else { g.lineTo(px, py); }
      }
      g.stroke();
      g.globalAlpha = 1;
    }

    // leading edge marker, so it reads as live rather than a static picture
    const last = pts[pts.length - 1];
    if (last && last.state === 'SPEECH' && last.angle >= 0) {
      g.fillStyle = ink;
      g.beginPath();
      g.arc(x(last.time), yOf(last.angle), 3, 0, Math.PI * 2);
      g.fill();
    }
  }

  // keep repainting while data is arriving so the wave travels, unless the
  // viewer asked for reduced motion - then it only repaints on new packets
  const tick = () => { if (!raf && !calm.matches) raf = requestAnimationFrame(draw); };
  const timer = setInterval(tick, 80);
  window.addEventListener('resize', () => { if (!raf) raf = requestAnimationFrame(draw); });

  return {
    push,
    stop() { clearInterval(timer); if (raf) cancelAnimationFrame(raf); },
  };
}
