# EchoSense — companion website

**Live: https://echosense-web-zeta.vercel.app**

EchoSense is a cap that listens for speech around you and buzzes in that direction.
A 4-microphone XVF3800 array estimates which way a voice came from, an ESP32-S3 decides
whether to trust it, and four haptic motors around the headband — front, right, back, left —
point you at the talker. Halfway between two motors, both run.

**This repository is only the companion website.** The cap works standalone: it listens and
buzzes with no phone, no app, and no internet. Everything here is optional — a way to change
settings, watch what the cap is doing, and calibrate it with a friend. Close the tab and the
cap behaves exactly the same.

## What the site does

- **Live direction.** A top-down instrument showing where the cap thinks the voice is,
  which motors are running and how hard, with wavefronts travelling inward along the bearing.
- **Guided calibration.** Four steps with a friend: wear it, set your front, check left and
  right, balance the motors.
- **Direction-attributed transcript.** Each line of speech is labelled with the direction the
  cap reported while it was being said. See below — this is the part worth reading about.
- **Settings.** Strength, speech sensitivity, blended vs. nearest motor, per-motor balance.
  All written to the cap over BLE and stored on the device.
- **Session history and CSV export**, kept in your browser.
- **Demo mode** (`dashboard.html?demo=1`) — a simulated device with people taking turns
  talking around you. No hardware needed, and it is how most of the tests run.

## The direction-attributed transcript

Two separate streams are fused, and which is which matters:

- **Direction** comes from the cap.
- **Words** come from *this computer's or phone's* microphone, via the browser's speech
  recognition. **The cap cannot hear words.** It has no idea what anyone said.

```
FROM YOUR FRONT-RIGHT   are you coming to the thing tonight
FROM YOUR LEFT          yeah i think so what time
FROM BEHIND             see you there
```

For each finished utterance, `js/transcript.js` takes the telemetry samples from that time
window and computes the **circular mean** of the bearings — a plain average of 350° and 10°
gives 180°, which would point someone at exactly the wrong person.

**It refuses to guess.** A direction is only claimed when the telemetry agrees with itself:
at least 3 usable samples, and a mean resultant length of 0.7 or better (roughly ±40° of
scatter). Otherwise the line says which thing went wrong:

| Label | Means |
|---|---|
| `no cap connected` | Transcribing with no device paired |
| `cap heard no voice` | Your mic caught words the cap did not register as a direction — often you talking |
| `direction unclear` | Too few samples, or the cap was swinging between two people |

Uncertain lines render differently from confident ones, and the uncertainty flag survives
into the CSV export.

No AI is involved. It is arithmetic over two local streams, so it works with no API key, no
account, and no network beyond what speech recognition itself uses.

## Run it locally

No build step. No bundler. No framework.

```sh
python serve.py 8000
```

Open **http://localhost:8000** in **Chrome or Edge**.

`serve.py` is `python -m http.server` with no-cache headers added, so a plain refresh always
shows your latest edit. `python -m http.server 8000` works too, but you will be
hard-refreshing a lot.

### Browser requirements

| Feature | Needs |
|---|---|
| Landing page, demo mode | Any modern browser |
| Connecting to a cap | **Web Bluetooth** — Chrome or Edge on Android, Windows, macOS or Linux, over **https** or **localhost**. iPhone and iPad cannot do Web Bluetooth at all. |
| Transcript | **Web Speech API** — Chrome or Edge. Your browser may send audio over the internet to recognise it. |

The dashboard checks all of this at runtime and tells you which specific requirement failed —
see **How to connect** in the account menu.

## Deploy

Static hosting with https. Any host works; this one is on Vercel:

```sh
vercel deploy --prod --yes
```

`.vercelignore` keeps `tests/`, `serve.py`, `SUBMISSION.md` and `node_modules/` out of the
deployment, so what ships is just the pages, one stylesheet, six JS modules and the logo.

https matters: Web Bluetooth refuses to run on plain http, so an Android phone cannot talk
to the cap from an http URL.

## Tests

Real Chrome, driven by `puppeteer-core`. No Chromium download, no CI service.

```sh
cd tests
npm install        # once
npm run all        # with serve.py running in another shell
```

| Script | Covers |
|---|---|
| `check.js` | All four pages: console errors, pageerrors, failed requests, 4xx/5xx |
| `flow.js` | Sign up → demo → calibration → sign out → sign in, plus wrong password and duplicate email |
| `features.js` | How-to-connect checks, saved calibration, session history |
| `ble.js` | **Stubs `navigator.bluetooth`** — connect, drop out of range, 3 auto-retries, reconnect with no chooser, deliberate disconnect. Runs with no hardware. |
| `setfront.js` | "Set front" genuinely re-centres direction |
| `transcript.js` | **Stubs `SpeechRecognition`** — circular mean at the 0/360 seam, every uncertainty case, and end-to-end fusion against the live demo device |
| `shots.js` | Screenshots at 390px and 1440px, fails on horizontal overflow |

Point the suite at the deployed site with `BASE=https://... npm run all`.

## Layout

```
index.html        landing page
login.html        sign in / create account
dashboard.html    the app
css/style.css     all styling, all three pages
js/device.js      BLE client + simulated DemoDevice (same API)
js/dashboard.js   dashboard logic
js/radar.js       the direction instrument
js/transcript.js  direction/speech fusion
js/waveband.js    the landing-page telemetry band
js/auth.js        local accounts
serve.py          local dev server with no-cache headers
tests/            browser tests
```

`js/device.js` holds the BLE protocol and **must match the firmware byte for byte.** Treat it
as frozen unless the firmware changes too.

## Accounts

Accounts live in `localStorage` in one browser. Passwords are salted and hashed with
**PBKDF2-SHA256, 150,000 iterations** via WebCrypto before being stored. There is no server
and nothing leaves the browser — which also means there is no password reset, and an account
made on your laptop does not exist on your phone. `js/auth.js` is four functions; swap them
for real cloud accounts if that ever matters.

## BLE protocol

Service `60735531-d38f-4f58-bd4b-8c71cb71361d`.

| Characteristic | UUID suffix | Access | Size | Purpose |
|---|---|---|---|---|
| Telemetry | `…5532` | notify | 15 B | Live state, angle, motor levels |
| Config | `…5533` | read / write | 14 B | Strength, gains, sensitivity, front offset |
| Haptic test | `…5534` | write | 4 B | Buzz one motor: index, percent, duration |
| Command | `…5535` | write | 1 B | 1 set front · 2 self-test · 3 factory reset · 4 mute · 5 unmute |
| Device info | `…5536` | read | text | `fw=…;xvf=…;xvf_ok=…;drivers=…` |

**Telemetry**, little-endian: `ms` u32 · `state` u8 · `flags` u8 (bit0 voice, bit1 muted,
bit2 uncertain) · `angle` i16 · `raw` i16 · `motors[4]` u8 · `error` u8.
States: `STARTING LISTENING SPEECH UNCERTAIN PAUSED FAULT`.

**Config**, little-endian: version u8 · intensity u8 · `gains[4]` u8 · sensitivity u8 ·
mix u8 · `frontOffset` u16 · flip u8 · muted u8 · `rtpMin` u8 · `rtpMax` u8.

`DemoDevice` in the same file implements this API with simulated talkers, which is why the
whole dashboard can be developed and tested without a cap on the desk.

## Honest limits

The site says this publicly and so should the README:

**It does** — point you toward one active talker at a time on a flat circle around your head;
stop when people stop talking; show an error pattern instead of guessing if the microphone
stops answering.

**It doesn't** — tell distance, height, or who is speaking; reliably separate two people
talking at once; replace a hearing aid or warn about alarms and traffic.

It is a research prototype, not a medical device.

---

Built at Cal Hacks 13.0.
