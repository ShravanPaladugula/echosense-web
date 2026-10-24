# EchoSense browser tests

These drive **real Chrome** through `puppeteer-core` — no Chromium download, no CI service.
They exist because this project has no build step and no unit-test framework, and the things
most likely to break (BLE reconnect, the hidden attribute, phone layout) only break in a
real browser.

## Setup, once

```sh
cd tests
npm install
```

## Run

Start the site in one shell:

```sh
cd ..
python serve.py 8000
```

Then in another:

```sh
cd tests
npm run all          # everything
npm run check        # just the console-error sweep
```

## What each one covers

| Script | Covers |
|---|---|
| `check.js` | Loads all four pages, fails on any console error, pageerror, failed request, or 4xx/5xx. The fastest signal that something is broken. |
| `flow.js` | Sign up → dashboard → demo → guided calibration → sign out → sign in, plus wrong password and duplicate email. |
| `features.js` | How-to-connect sheet and its live capability checks, save calibration to account, session history rendering. |
| `ble.js` | **Stubs `navigator.bluetooth`** and exercises the real `BleDevice`: connect → drop out of range → 3 auto-retries → Reconnect with no browser chooser → deliberate disconnect must not retry. Runs with no hardware. |
| `setfront.js` | "Set front" actually re-centres direction — the talker that read `front-right` must read `front` afterwards. |
| `shots.js` | Screenshots at 390px and 1440px, and fails loudly on horizontal overflow. |
| `sec.js`, `help.js` | Screenshot helpers for specific sections. Not assertions. |

## Environment variables

| Variable | Default | Use |
|---|---|---|
| `BASE` | `http://localhost:8000` | Point the suite at a deployed URL. |
| `CHROME` | `C:/Program Files/Google/Chrome/Application/chrome.exe` | Chrome location on another machine. |
| `OUT` | `./out` | Where screenshots are written. |

Against the deployed site:

```sh
BASE=https://your-deployment.vercel.app npm run all
```

## Gotchas worth knowing

- **Check rendering, not the property.** `vis()` measures `offsetWidth`/`getClientRects()`.
  An earlier version trusted `el.hidden`, which was `true` while the element was still
  painted on screen — the test passed and the bug shipped.
- **Navigation races.** Use `Promise.all([page.waitForNavigation(), page.click(...)])`.
  Awaiting the click first loses fast navigations.
- **Headless Chrome has no Bluetooth radio**, so `ble.js` defines over
  `Navigator.prototype.bluetooth` — plain assignment is silently dropped.
