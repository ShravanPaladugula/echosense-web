# EchoSense website

Landing page, sign-in, and dashboard for the EchoSense cap. Plain HTML/JS,
no build step.

## Run (Mac)

    cd echosense-web
    python3 -m http.server 8000

Open **http://localhost:8000** in **Chrome** (Bluetooth needs Chrome or Edge,
and localhost or https). Not Safari, not iPhone.

## Pages

- `index.html` landing page (live demo radar)
- `login.html` sign in / create account (stored in this browser only, passwords hashed)
- `dashboard.html` connect over Bluetooth, live direction, pause, set front,
  flip, guided calibration, strength/profile/sensitivity, per-motor balance,
  60 s activity chart, CSV export, captions from the laptop/phone mic.
  `dashboard.html?demo=1` runs a simulated device, no hardware needed.

## Host online (optional)

Any static host with https works (GitHub Pages, Netlify, Vercel): upload this
folder as-is.
