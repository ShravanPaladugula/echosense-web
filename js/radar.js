// Top-down view of the wearer: head in the middle, 4 motors around it,
// a beam toward the current voice direction.

const NS = 'http://www.w3.org/2000/svg';
const C = 200;
const MOTORS = [
  { name: 'FRONT', x: C, y: 48 },
  { name: 'RIGHT', x: 352, y: C },
  { name: 'BACK', x: C, y: 352 },
  { name: 'LEFT', x: 48, y: C },
];

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

function polar(deg, r) {
  const a = (deg - 90) * Math.PI / 180;  // 0 deg = up (front), clockwise
  return [C + r * Math.cos(a), C + r * Math.sin(a)];
}

export function createRadar(container, { ticks = true } = {}) {
  const svg = el('svg', { viewBox: '0 0 400 400', class: 'radar', role: 'img', 'aria-label': 'Voice direction around the wearer' });
  for (const r of [170, 120, 70]) el('circle', { cx: C, cy: C, r, class: 'r-ring' }, svg);
  el('line', { x1: C, y1: 30, x2: C, y2: 370, class: 'r-ring', 'stroke-dasharray': '2 7' }, svg);
  el('line', { x1: 30, y1: C, x2: 370, y2: C, class: 'r-ring', 'stroke-dasharray': '2 7' }, svg);

  // Degree ticks: this is an instrument, so let it read like one.
  if (ticks) {
    for (let deg = 0; deg < 360; deg += 15) {
      const major = deg % 45 === 0;
      const [x1, y1] = polar(deg, 170);
      const [x2, y2] = polar(deg, major ? 158 : 164);
      el('line', { x1, y1, x2, y2, class: 'r-tick' + (major ? ' major' : '') }, svg);
    }
  }
  // Wavefronts: arcs that travel inward from the rim toward the head along the
  // talker's bearing, which is the direction sound actually arrives from. Spawned
  // from real telemetry, never on a timer of their own.
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
  const waves = Array.from({ length: 5 }, () => ({
    el: el('path', { class: 'r-wave', opacity: 0 }, svg), r: 0, bearing: 0, live: false,
  }));
  let lastSpawn = 0;
  let raf = 0;

  const arc = (bearing, r, spread) => {
    const [x1, y1] = polar(bearing - spread, r);
    const [x2, y2] = polar(bearing + spread, r);
    return `M${x1.toFixed(1)} ${y1.toFixed(1)} A${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  };

  function spawnWave(bearing) {
    if (calm.matches) return;
    const now = performance.now();
    if (now - lastSpawn < 360) return;       // one every ~third of a second, not per packet
    const w = waves.find((v) => !v.live);
    if (!w) return;
    lastSpawn = now;
    Object.assign(w, { r: 168, bearing, live: true });
    if (!raf) raf = requestAnimationFrame(step);
  }

  function step() {
    let any = false;
    for (const w of waves) {
      if (!w.live) continue;
      w.r -= 1.5;
      if (w.r <= 52) { w.live = false; w.el.setAttribute('opacity', 0); continue; }
      any = true;
      // fades as it closes on the head, so the newest front is the brightest
      w.el.setAttribute('d', arc(w.bearing, w.r, 30));
      w.el.setAttribute('opacity', (((w.r - 52) / 116) * 0.5).toFixed(3));
    }
    raf = any ? requestAnimationFrame(step) : 0;
  }

  function clearWaves() {
    for (const w of waves) { w.live = false; w.el.setAttribute('opacity', 0); }
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
  }

  const beam = el('path', { class: 'r-beam', opacity: 0 }, svg);
  const arrow = el('line', { x1: C, y1: C, x2: C, y2: C, class: 'r-arrow', opacity: 0 }, svg);

  el('circle', { cx: C, cy: C, r: 44, class: 'r-head' }, svg);
  el('path', { d: `M${C - 9} ${C - 40} L${C} ${C - 56} L${C + 9} ${C - 40} Z`, class: 'r-head' }, svg);
  el('text', { x: C, y: C + 5, 'text-anchor': 'middle', class: 'r-label' }, svg).textContent = 'YOU';

  const dots = MOTORS.map((m) => {
    const g = el('g', {}, svg);
    const c = el('circle', { cx: m.x, cy: m.y, r: 17, class: 'r-motor' }, g);
    const ly = m.name === 'FRONT' ? m.y - 26 : m.name === 'BACK' ? m.y + 36 : m.y + 40;
    el('text', { x: m.x, y: ly, 'text-anchor': 'middle', class: 'r-label' }, g).textContent = m.name;
    return c;
  });
  container.appendChild(svg);

  return {
    update({ angle = -1, motors = [0, 0, 0, 0], state = '', uncertain = false } = {}) {
      if (state === 'SPEECH' && angle >= 0) spawnWave(angle);
      else if (state === 'PAUSED' || state === 'FAULT' || !state) clearWaves();
      motors.forEach((p, i) => {
        const a = Math.min(1, p / 100);
        dots[i].style.fill = a > 0 ? `color-mix(in srgb, var(--accent) ${Math.round(20 + a * 80)}%, var(--card-2))` : '';
      });
      if (angle < 0) {
        beam.setAttribute('opacity', 0);
        arrow.setAttribute('opacity', 0);
        return;
      }
      const spread = uncertain ? 45 : 18;
      const [x1, y1] = polar(angle - spread, 170);
      const [x2, y2] = polar(angle + spread, 170);
      beam.setAttribute('d', `M${C} ${C} L${x1} ${y1} A170 170 0 0 1 ${x2} ${y2} Z`);
      beam.setAttribute('opacity', uncertain ? 0.5 : 1);
      const [ax, ay] = polar(angle, 128);
      arrow.setAttribute('x2', ax);
      arrow.setAttribute('y2', ay);
      arrow.setAttribute('opacity', uncertain ? 0.4 : 1);
    },
  };
}

export function directionWords(angle) {
  if (angle < 0) return '';
  const names = ['front', 'front-right', 'right', 'back-right', 'back', 'back-left', 'left', 'front-left'];
  return names[Math.round(angle / 45) % 8];
}
