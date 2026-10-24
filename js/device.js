// EchoSense device link over Web Bluetooth (Chrome / Edge on Mac, Windows,
// Android). Packet layouts match firmware docs/BLE_PROTOCOL.md.
// DemoDevice offers the same API with simulated talkers, for trying the
// dashboard without hardware.

export const UUID = {
  service: '60735531-d38f-4f58-bd4b-8c71cb71361d',
  telemetry: '60735532-d38f-4f58-bd4b-8c71cb71361d',
  config: '60735533-d38f-4f58-bd4b-8c71cb71361d',
  haptic: '60735534-d38f-4f58-bd4b-8c71cb71361d',
  command: '60735535-d38f-4f58-bd4b-8c71cb71361d',
  info: '60735536-d38f-4f58-bd4b-8c71cb71361d',
};

export const STATES = ['STARTING', 'LISTENING', 'SPEECH', 'UNCERTAIN', 'PAUSED', 'FAULT'];
export const CMD = { SET_FRONT: 1, SELF_TEST: 2, FACTORY_RESET: 3, MUTE: 4, UNMUTE: 5 };

export const DEFAULT_CONFIG = {
  intensity: 80, gains: [100, 100, 100, 100], sensitivity: 1, mix: 0,
  frontOffset: 0, flip: false, muted: false, rtpMin: 35, rtpMax: 110,
};

export const bluetoothSupported = () => !!(navigator.bluetooth && window.isSecureContext);

// Chrome can say whether this machine has a Bluetooth radio switched on.
// Returns null when the browser won't tell us.
export async function bluetoothAvailable() {
  if (!navigator.bluetooth?.getAvailability) return null;
  try { return await navigator.bluetooth.getAvailability(); } catch { return null; }
}

// Web Bluetooth error names are not fit to show a person.
export function describeBleError(e) {
  switch (e?.name) {
    case 'NotFoundError':
      return 'No cap was chosen. Switch the cap on, keep it nearby, and try again.';
    case 'SecurityError':
      return 'Bluetooth is blocked on this page. Open the site over https, or from localhost.';
    case 'NetworkError':
      return 'Could not reach the cap. It may be out of range, switched off, or already connected to another phone, computer or browser tab.';
    case 'NotSupportedError':
      return 'That device did not offer the EchoSense service. Check it is running EchoSense firmware.';
    case 'InvalidStateError':
      return 'Bluetooth is not ready. Turn it off and on again, then retry.';
    default:
      return e?.message || 'Could not connect.';
  }
}

export function parseTelemetry(dv) {
  return {
    ms: dv.getUint32(0, true),
    state: STATES[dv.getUint8(4)] || 'STARTING',
    voice: !!(dv.getUint8(5) & 1),
    muted: !!(dv.getUint8(5) & 2),
    uncertain: !!(dv.getUint8(5) & 4),
    angle: dv.getInt16(6, true),
    raw: dv.getInt16(8, true),
    motors: [dv.getUint8(10), dv.getUint8(11), dv.getUint8(12), dv.getUint8(13)],
    error: dv.getUint8(14),
  };
}

export function parseConfig(dv) {
  return {
    intensity: dv.getUint8(1),
    gains: [dv.getUint8(2), dv.getUint8(3), dv.getUint8(4), dv.getUint8(5)],
    sensitivity: dv.getUint8(6),
    mix: dv.getUint8(7),
    frontOffset: dv.getUint16(8, true),
    flip: !!dv.getUint8(10),
    muted: !!dv.getUint8(11),
    rtpMin: dv.getUint8(12),
    rtpMax: dv.getUint8(13),
  };
}

export function encodeConfig(c) {
  const b = new DataView(new ArrayBuffer(14));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));
  b.setUint8(0, 1);
  b.setUint8(1, clamp(c.intensity, 10, 100));
  c.gains.forEach((g, i) => b.setUint8(2 + i, clamp(g, 0, 150)));
  b.setUint8(6, clamp(c.sensitivity, 0, 2));
  b.setUint8(7, clamp(c.mix, 0, 1));
  b.setUint16(8, clamp(c.frontOffset, 0, 359), true);
  b.setUint8(10, c.flip ? 1 : 0);
  b.setUint8(11, c.muted ? 1 : 0);
  b.setUint8(12, clamp(c.rtpMin, 0, 127));
  b.setUint8(13, clamp(c.rtpMax, 0, 127));
  return b.buffer;
}

class Base extends EventTarget {
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
}

export class BleDevice extends Base {
  constructor() {
    super();
    this.kind = 'ble';
    this.ch = {};
    this.queue = Promise.resolve();  // GATT allows one operation at a time
    this.closed = false;             // true only when we hung up on purpose
    this.onNotify = (e) => this.emit('telemetry', parseTelemetry(e.target.value));
  }

  // Shows the browser's device chooser. Needs a click to have happened.
  async connect() {
    this.dev = await navigator.bluetooth.requestDevice({
      filters: [{ services: [UUID.service] }, { namePrefix: 'EchoSense' }],
      optionalServices: [UUID.service],
    });
    this.dev.addEventListener('gattserverdisconnected', () => this.emit('disconnected'));
    return this.open();
  }

  // True once the cap has been chosen: we can get back to it with no chooser,
  // which is what makes walking out of range and back recoverable.
  get canReconnect() { return !!this.dev; }

  async open() {
    this.closed = false;
    const server = await this.dev.gatt.connect();
    const svc = await server.getPrimaryService(UUID.service);
    for (const k of ['telemetry', 'config', 'haptic', 'command', 'info']) this.ch[k] = await svc.getCharacteristic(UUID[k]);
    this.name = this.dev.name || 'EchoSense';
    this.info = new TextDecoder().decode(await this.ch.info.readValue());
    this.config = parseConfig(await this.ch.config.readValue());
    this.ch.telemetry.removeEventListener('characteristicvaluechanged', this.onNotify);
    this.ch.telemetry.addEventListener('characteristicvaluechanged', this.onNotify);
    await this.ch.telemetry.startNotifications();
    return this;
  }

  op(fn) {
    this.queue = this.queue.then(fn, fn);
    return this.queue;
  }

  writeConfig(c) {
    this.config = { ...c };
    return this.op(() => this.ch.config.writeValueWithResponse(encodeConfig(c)));
  }

  async refreshConfig() {
    this.config = await this.op(async () => parseConfig(await this.ch.config.readValue()));
    return this.config;
  }

  hapticTest(motor, pct, ms) {
    const b = new DataView(new ArrayBuffer(4));
    b.setUint8(0, motor);
    b.setUint8(1, pct);
    b.setUint16(2, Math.min(1000, ms), true);
    return this.op(() => this.ch.haptic.writeValueWithResponse(b.buffer));
  }

  command(n) {
    return this.op(() => this.ch.command.writeValueWithResponse(new Uint8Array([n])));
  }

  disconnect() {
    this.closed = true;
    if (this.dev?.gatt.connected) this.dev.gatt.disconnect();
  }
}

// ---------- demo device ----------
// Three people (front-right, left, back) take turns talking, with gaps.
export class DemoDevice extends Base {
  constructor() {
    super();
    this.kind = 'demo';
    this.name = 'EchoSense (demo)';
    this.info = 'fw=2.0.0-demo;xvf=1.0.9;xvf_ok=1;drivers=4';
    this.config = { ...DEFAULT_CONFIG };
    this.cue = null;
    this.lastVoice = -1;
    this.closed = false;
  }

  get canReconnect() { return false; }

  async connect() {
    await new Promise((r) => setTimeout(r, 700));
    this.t0 = performance.now();
    this.timer = setInterval(() => this.tick(), 200);
    return this;
  }

  rawAt(t) {
    const talkers = [40, 275, 175, 0];
    const slot = Math.floor(t / 4500) % talkers.length;
    const inSlot = t % 4500;
    const voice = inSlot > 600 && inSlot < 3800 && !(inSlot > 2000 && inSlot < 2300);
    const jitter = Math.sin(t / 170) * 8 + Math.sin(t / 53) * 4;
    return { voice, raw: (talkers[slot] + jitter + 360) % 360 };
  }

  tick() {
    const t = performance.now() - this.t0;
    const c = this.config;
    const { voice, raw } = this.rawAt(t);
    if (voice) this.lastVoice = raw;
    let angle = -1;
    let motors = [0, 0, 0, 0];
    let state = c.muted ? 'PAUSED' : voice ? 'SPEECH' : 'LISTENING';
    if (voice && !c.muted) {
      angle = Math.round(((c.flip ? c.frontOffset - raw : raw - c.frontOffset) % 360 + 360) % 360);
      motors = mix(angle, c);
    }
    if (this.cue && performance.now() < this.cue.until) motors = this.cue.motors;
    this.emit('telemetry', {
      ms: Math.round(t), state, voice, muted: c.muted, uncertain: false,
      angle, raw: Math.round(raw), motors, error: 0,
    });
  }

  async writeConfig(c) { this.config = { ...c }; }
  async refreshConfig() { return this.config; }

  async hapticTest(motor, pct, ms) {
    const m = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) if (motor === 255 || motor === i) m[i] = pct;
    this.cue = { motors: m, until: performance.now() + ms };
  }

  async command(n) {
    if (n === CMD.SET_FRONT && this.lastVoice >= 0) this.config.frontOffset = Math.round(this.lastVoice);
    if (n === CMD.FACTORY_RESET) this.config = { ...DEFAULT_CONFIG };
    if (n === CMD.MUTE) this.config.muted = true;
    if (n === CMD.UNMUTE) this.config.muted = false;
    if (n === CMD.SELF_TEST) {
      for (let i = 0; i < 4; i++) setTimeout(() => this.hapticTest(i, 70, 150), i * 180);
    }
  }

  disconnect() {
    this.closed = true;
    clearInterval(this.timer);
    this.emit('disconnected');
  }
}

// Same sector interpolation as the firmware (attention.cpp mixAngle).
export function mix(angle, c) {
  const out = [0, 0, 0, 0];
  const base = c.intensity;
  const lvl = (v, g) => Math.min(100, Math.round(v * g / 100));
  if (c.mix === 1) {
    const k = Math.floor((angle + 45) / 90) % 4;
    out[k] = lvl(base, c.gains[k]);
    return out;
  }
  const k = Math.floor(angle / 90) % 4;
  const n = (k + 1) % 4;
  const f = (angle - k * 90) / 90;
  out[k] = lvl(Math.round(base * (1 - f)), c.gains[k]);
  out[n] = lvl(Math.round(base * f), c.gains[n]);
  return out;
}
