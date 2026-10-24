# EchoSense — submission material

Draft copy for Devpost and the demo video. Everything here is true of the code as built.
Anything only you can know is marked **[YOU]** — fill those in; I have not guessed at them.

**[YOU]** before submitting: team members, what each person built, the hardware bill of
materials, and any real measurements (latency, battery, range). I have deliberately left out
every number I could not verify from the repo. Do not let anyone add one for polish.

---

## Devpost

### Elevator pitch (one line)

A cap that turns the direction of a voice into a buzz on your head — and a companion app that
writes down who said what, from which direction.

### Inspiration

**[YOU]** — the real reason you picked this. If it came from someone you know who is deaf or
hard of hearing, say so plainly; that is worth more than anything I could write here.

The design problem we kept coming back to: in a group, the hardest part of being deaf or hard
of hearing often is not understanding the words. It is not knowing **who just started
talking**, so you spend the conversation a beat behind, scanning faces. Captions on a phone
solve the words and lose the room. We wanted the room.

### What it does

EchoSense is a cap. A 4-microphone XVF3800 array on top estimates which direction speech is
coming from. An ESP32-S3 filters the jitter, waits out the pauses between words, and ignores
readings that jump around too much to trust. Four haptic motors around the headband — front,
right, back, left — buzz toward the talker. Halfway between two motors, both run, so the
direction is continuous rather than snapping to four points.

**The cap works entirely on its own.** No phone, no internet, no account, no buttons to press.

The website is optional. It exists so you can calibrate the cap with a friend, change how
strong the buzzing is, and watch what the device is doing. And it does one thing the cap
cannot do alone:

**The direction-attributed transcript.** Your phone's microphone hears the words. The cap
knows the direction. Put them together and you get a transcript that says *where each line
came from*:

```
FROM YOUR FRONT-RIGHT   are you coming to the thing tonight
FROM YOUR LEFT          yeah i think so what time
FROM BEHIND             see you there
```

As far as we know nobody has built this, because it needs both halves: a wearable that senses
direction and an app that can line it up against speech in time.

Raw speech recognition output is lowercase, unpunctuated and fragmented, so there is a
**Tidy up** button that sends the transcript to **Claude Opus 5** for punctuation, casing and
turn grouping. Claude is given a permission list, not an instruction to improve things: it may
repunctuate and merge fragments from the same direction, and it may not add, remove, replace
or reorder a single word, guess at unintelligible audio, infer who is speaking, or touch a
direction the cap measured.

The raw transcript is the record; the tidied version is a view of it. They coexist, "Show raw"
is always one click away, and if the request fails the raw transcript is untouched and the app
says why. The feature degrading can never take the transcript down with it.

### How we built it

**Firmware** — **[YOU]**: toolchain, how the XVF3800 is wired, how you drive the motors, how
the direction estimate is smoothed.

**The link** — a fixed BLE protocol: a telemetry characteristic that notifies 15 bytes of
state, angle and motor levels; a config characteristic for settings; plus haptic-test,
command, and device-info. The website parses those bytes directly with `DataView`.

**The website** — deliberately plain HTML, CSS and JavaScript. No framework, no bundler, no
build step. It is a hackathon project that has to work on a phone at a judging table, so
every layer we did not add is a layer that cannot break.

**`DemoDevice`** — a simulated cap implementing the same interface as the real one, with
people taking turns talking around you. It meant the whole dashboard could be built and
tested with no hardware on the desk, and it is the reason there is a working demo even if the
cap fails at the booth.

**The fusion** — for each finished utterance, take the cap's bearings from that time window
and compute the **circular mean**. Not the arithmetic mean: 350° and 10° average to 180°,
which would point someone at exactly the wrong person. This layer uses no AI at all, which is
deliberate: it works with no API key and no network, so the core feature cannot be taken down
by an outage at a judging table.

**The tidy pass** — one Vercel serverless function calling Claude Opus 5 through the official
Anthropic SDK, with structured output so the response is schema-checked rather than parsed out
of prose. Run at low effort, because this is formatting and not reasoning. The API key lives
in a server-side environment variable and never reaches the browser; the endpoint is POST
only, same-origin, size-capped, and returns clean JSON errors rather than stack traces.

**Tests** — seven scripts driving real Chrome through `puppeteer-core`, including two that
stub browser APIs so hardware-dependent paths can be tested without hardware: one fakes
`navigator.bluetooth` to exercise connect → drop → retry → reconnect, the other fakes
`SpeechRecognition` to test the direction fusion end to end.

### Challenges we ran into

**Web Bluetooth needs https.** You cannot test a Bluetooth web app on a phone from
`localhost` on your laptop. We deployed on day one and treated the live URL as the dev
environment, rather than leaving deployment until the end.

**A cap talks to one device at a time.** Half of "it won't connect" turned out to be a laptop
still holding the link. So the app does not just say "could not connect" — it runs live
capability checks (does this browser speak Web Bluetooth? is the page on https? is there a
radio switched on?) and names the specific thing that failed.

**Walking out of range should not mean re-pairing.** The browser's device chooser is an ugly
thing to hit mid-conversation. Once a cap has been picked, we keep the reference and
reconnect to it directly — three automatic retries, then a button — so the user never sees
the chooser twice.

**Speech recognition has no per-word timestamps.** You only know roughly when an utterance
started and when its result arrived. This is the one that shaped the whole feature. Rather
than quietly tolerating the error, we made uncertainty a first-class output: a direction is
claimed only when at least three telemetry samples agree within about ±40°, and otherwise the
line says *which* thing went wrong — `direction unclear`, `cap heard no voice`, or
`no cap connected`.

**Our own test lied to us.** A visibility check asserted on the `hidden` property, which was
correctly `true` while the element was still painted on screen — a CSS rule was overriding it.
Two visible bugs shipped past a green suite. The test now measures actual layout boxes.

### What we learned

Uncertainty is a feature. The instinct is to always show an answer, because an answer looks
finished. But for someone relying on this to know where to turn, a confident wrong direction
is worse than an honest "unclear" — so the app says "unclear" often, on purpose, and that
turned out to be the most important design decision in the project.

And: a simulator of your own hardware is worth the afternoon it costs. Ours made the software
testable, demoable without the device, and still works if the cap dies at the table.

### What's next

- Sharing a live session with a friend or interpreter over a link.
- Vertical cues, and a way to say "two people are talking at once" instead of picking one.
- Real testing with deaf and hard-of-hearing users. **[YOU]** — only claim this once it has
  actually happened.

### Built with

`esp32-s3` · `xvf3800` · `ble` · `web-bluetooth` · `web-speech-api` · `anthropic` ·
`claude-opus-5` · `javascript` · `html` · `css` · `canvas` · `svg` · `webcrypto` ·
`puppeteer` · `vercel`
**[YOU]** — add your firmware language and toolchain.

---

## Demo video — 2 minutes

Shoot in a quiet-ish room with **two other people**. The whole point is direction, which
needs someone to actually move around you.

### 0:00–0:15 — the cap alone

> Wide shot. Cap on a table. **No phone and no laptop anywhere in frame.**

Power it on — the self-test runs front, right, back, left. Someone off-camera speaks from one
side; the cap buzzes toward them. Cut in close on the motors.

**VO:** "This is EchoSense. It listens for speech around you and buzzes in that direction.
There is no phone here, and no internet. The cap does this on its own."

*Open with the hardware working unaided. Everything after this is optional, and that ordering
is the honest one.*

### 0:15–0:40 — wearing it

> Over-the-shoulder on the wearer. Two people, one to the **front-right**, one to the **left**.

They take turns speaking. Each time, cut to a close-up of the motor that fires.

**VO:** "Four motors around the headband. Front, right, back, left — and because neighbouring
motors blend, a voice halfway between two of them drives both. The direction is continuous,
not four fixed points."

### 0:40–1:00 — calibration

> Screen recording, phone held in hand.

Connect. Run **Guided calibration**: friend stands in front, "Set front now", then moves right
to check left/right isn't mirrored.

**VO:** "It takes about a minute to set up. The app finds the cap, you tell it which way front
is, and you check that left and right aren't mirrored."

### 1:00–1:35 — the transcript

> Screen recording, full width. **This is the shot that has to land.**

Start the transcript. Have both people talk, from different sides, alternating. Let the lines
build up with their direction labels.

**VO:** "Your phone's microphone hears the words. The cap knows the direction. Put them
together and you get a transcript that knows where every line came from."

**Then — do not skip this.** Have someone speak while standing somewhere the cap cannot
resolve, or pause the cap mid-sentence. Let a **"direction unclear"** line appear on screen
and hold on it.

**VO:** "And when the cap isn't sure, it says so. If you're relying on this to know where to
turn, a confident wrong answer is worse than an honest one."

### 1:35–1:50 — the limits

> The Limits section of the site, scrolling.

**VO:** "It won't tell you distance, or who is speaking, and it won't reliably separate two
people talking at once. It is not a hearing aid. We put that on the front page."

### 1:50–2:00 — close

> Back to the cap on the table, still buzzing.

**VO:** "EchoSense. Feel where a voice is coming from."

### Notes

- **Caption the whole video.** Burned-in, not auto-generated. A video about deaf accessibility
  that is not captioned will be noticed.
- Get at least one shot where a motor visibly moves. The buzz is the product and it is
  invisible on camera otherwise.
- Do not speed up the transcript or cut between its lines. Let it be slightly slow and real —
  if it looks faked, the strongest part of the project becomes the weakest.
