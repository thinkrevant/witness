# Demo video script: Witness

- **Target length:** 2:40. The hard limit is under 3:00.
- **Language:** English.
- **Upload:** public on YouTube.
- **Tone:** calm and respectful. No graphic content, no real people, no reconstructions of violence.

**Characters.** All names are fictional.

- **Sarah:** a survivor with a protective order.
- **Mark:** the respondent named in the order.
- They appear only as text and voice-over. Nobody is shown on camera.

**Footage.** Every Ring clip in the video is Ring Developer Playground simulated footage (a parking lot), and it is labelled on screen.

## Scene-by-scene

| Time | On screen (action) | Voice-over | On-screen caption |
|---|---|---|---|
| **0:00–0:15** | Plain dark title cards, white text, one stat per card. | "Up to half of all protective orders are broken. In one UK police force, about three in four reported breaches end in 'no further action'. Violations are hard to prove, and doorbell footage gets challenged as altered." | "40–50% of protective orders are violated (review of 43 studies)" · "~3 in 4 reported breaches: no further action (West Midlands Police, 2020–23)" |
| **0:15–0:30** | A slow pan across a simple illustration or stock photo of a front door with a doorbell (no people). Then the Daybook lock screen (`01-lock.png`). | "Meet Sarah. She's fictional, but her situation isn't. She has a protective order against Mark, and a Ring doorbell from the Ring and NNEDV donation program. Her doorbell sees when he breaks the order. Turning that into proof is the hard part." | "Sarah and Mark are fictional." · "Ring × NNEDV: ~35,000 doorbells donated to survivors" |
| **0:30–0:45** | Browser: the Ring Developer Playground. Click **Vehicle**. The parking-lot clip plays. | "This is Witness. Here we use the Ring Developer Playground: its Vehicle stream stands in for Mark's car arriving." | **"Ring Developer Playground simulated footage"** (kept on screen for the whole clip) |
| **0:45–1:00** | Witness (shown as "Daybook"): Home with the case card and Doorbell activity (`03-activity.png`). Then a 3-second split screen of `lib/ring/client.ts` with the `media/video/download` call highlighted. | **Live mode (required, see the pre-record gate):** "Witness pulls her doorbell activity straight from the Ring API: devices, event history, and the original snapshot and video." **Demo-mode fallback only:** "Here Witness is in demo mode, replaying recorded real Ring Developer Playground responses: devices, event history, and the original snapshot and video." | "Ring Partner API: /v1/devices · /v1/history · media/image/download · media/video/download" |
| **1:00–1:20** | Click **Log as violation** on the parking-lot (Vehicle) event, shown as 2:14:48 pm in `03-activity.png`. Type the note "Mark's grey SUV pulled into the driveway and idled for about 20 seconds." (`04a-log-dialog.png`). Click **Seal**: "Downloading video from Ring… Sealing…", then **Sealed ✓** (`04-seal.png`). | "Sarah taps 'Log as violation' and adds a note. Witness downloads the original files from Ring, untouched, fingerprints them with SHA-256, and seals them into a hash-chained log." **Demo-mode fallback only:** replace "downloads the original files from Ring" with "takes the original recorded Ring files, untouched,". | "Original bytes · SHA-256 fingerprint · hash-chained ledger" |
| **1:20–1:35** | **Incident log** (`05-incidents.png`). Zoom on the Ring watermark, the "Sealed · fingerprint" badge and "All records intact ✓". | "Each incident keeps Ring's watermark, the clip, Ring's request ID, and an independent timestamp when the timestamp service is reachable." | "Ring watermark + Ring request ID + RFC 3161 timestamp" |
| **1:35–1:55** | **Report** page (`06-report.png`). Click **Download report (PDF)**. Show the PDF cover (`11-report-pdf-cover.png`), then the incident page (`11-report-pdf-incident.png`). | "One tap builds a report for her advocate, the police or the court. It has a timeline, a page per incident with fingerprints and Ring metadata, a chain of custody, and a statement she can sign. It says plainly what the records show, and what they don't." | "Court-ready PDF + evidence bundle" · "Not legal advice. Talk to an advocate or attorney." |
| **1:55–2:15** | **Verify** page: drop the original photo and clip, and both show ✅ (`07-verify-pass.png`). Drop the edited copy, which shows ❌ (`08-verify-fail.png`). Cut for 2 seconds to offline `verify.html` from the bundle (`12-bundle-verify-offline.png`). | "Anyone can check the files. The original matches. We changed a single pixel in a copy, and it fails. This works offline, from the evidence bundle, without Witness." | "✅ matches sealed original" · "❌ one pixel changed: does not match" |
| **2:15–2:25** | Press **Esc twice**. The page instantly becomes a weather site. Press Back: the app does not come back. | "And if someone walks in: press Escape twice. Witness, which only ever calls itself 'Daybook', disappears. No notifications, a PIN lock, and everything stays on her device." | "Quick exit: Esc × 2" · "PIN lock · no notifications · local only" |
| **2:25–2:40** | Closing card: Witness name, GitHub URL, "MIT licensed", "Built on the Ring Partner API". | "Ring has already put tens of thousands of doorbells in survivors' homes. Witness turns what they see into proof that holds up. Next: Ring account linking and webhooks, a pilot with NNEDV advocates, and the Ring Appstore." | "Next: account linking · webhooks · NNEDV pilot · Ring Appstore" · "Open source (MIT)" |

**Script checks**

- The voice-over is about 310 words, which fits 2:40 at a calm pace (about 120–130 words a minute).
- If the read runs long, trim the 1:35–1:55 line first.

## How to prepare each shot

1. **Fresh start.** Use a clean data folder so the app shows the first-run screens.

   PowerShell:
   ```
   cd app-witness
   $env:WITNESS_DATA_DIR="$PWD\video-data"
   npm run dev
   ```
   macOS or Linux:
   ```
   WITNESS_DATA_DIR=./video-data npm run dev
   ```
2. **Case.** Set code `2468`, then fill Setup with:
   - your name: Sarah Miller
   - the person the order is against: Mark Davis
   - order number: PO-2026-0417
   - court: Superior Court of Example County
   - conditions: "No contact; stay at least 100 yards from the petitioner's home"
3. **Playground shot (0:30) and live mode.** Record in **live mode**: pass the pre-record gate below first.
   1. Screen-record the Vehicle clip playing in the Playground during the gate, step 2.
   2. On Home, seal the new Vehicle event. Its thumbnail is the parking lot.
   3. **Fallback, only if the gate fails:** stay in Demo mode, which uses the recorded Vehicle event (the parking-lot thumbnail). On a computer set to India time it shows as 2:14:48 pm; in other time zones the clock time differs, but it is the same event. In this case:
      - use the **demo-mode fallback** voice-over lines in the table;
      - keep the yellow "Demo mode — Ring Developer Playground simulated footage" banner visible;
      - never say the app is fetching live from Ring.
4. **Timestamp badge.** Leave `WITNESS_TSA` unset, so Witness asks FreeTSA for a timestamp. If FreeTSA is reachable, the badge shows "Timestamped ✓". If it shows "Timestamp unavailable", that's fine, but don't claim otherwise in the voice-over.
5. **Tampered file (1:55).**
   1. On the Report page, download the evidence bundle and unzip it.
   2. In `media/`, open the `.jpg` in Paint (Windows) or Preview (Mac).
   3. Draw one tiny dot and **Save as** `tampered-photo.jpg`.
   4. Drop the original `.jpg`, the `.mp4` and `tampered-photo.jpg` onto the Verify page.
6. **Quick exit (2:15).** Make sure the browser window is focused before pressing Esc twice. Esc presses that are held down don't count.

## Pre-record gate: live mode (required)

Do all of this within one 30-minute token, right before recording. Live mode must pass every step; if any step fails, use the demo-mode fallback lines instead.

- [ ] **1. Fresh token.** In the [Ring Developer Playground](https://developer.amazon.com/ring/console/playground), click **Generate Token** and copy it.
- [ ] **2. Create events after the token.** Scroll down the Playground page, click **Vehicle**, and let the session finish. Then click **Motion** and let it finish too. Events from before the token was generated cannot be downloaded.
- [ ] **3. Connect Witness.** In Witness, open **Settings**, paste the token and click **Save token**. This turns Demo mode off. Check that the yellow "Demo mode" banner has gone.
- [ ] **4. Command-line check.** In a terminal:
  ```
  cd app-witness
  npx tsx scripts/ring-check.ts
  ```
  First set the token in that terminal. PowerShell: `$env:RING_ACCESS_TOKEN="<token>"`. macOS or Linux: `export RING_ACCESS_TOKEN=<token>`.

  Confirm that it prints:
  - `devices: 1` and the device name;
  - an `events for …` count of at least 1;
  - a `snapshot: … bytes, image/jpeg` line;
  - a `clip: … bytes, video/mp4` line.

  If it prints an error instead, stop and use the fallback.
- [ ] **5. One live seal.** On Home, the new events appear and "Connected to your Ring doorbell." is shown. Click **Log as violation** on one event, then **Seal**. Confirm the card changes to **Sealed ✓** and that the incident appears in the **Incident log**, without the "Ring Developer Playground simulated footage" demo label.
- [ ] **6. Record.** Record the walkthrough on the Vehicle event while the token is still valid. Use a fresh `WITNESS_DATA_DIR` if you want the test seal from step 5 out of the shot.

## Recording checklist (for a non-technical person)

- [ ] **Screen recorder.** Use one of these:
  - **Windows Game Bar:** press **Win + G**, then the record button, or press **Win + Alt + R** to start and stop.
  - **OBS Studio** (free, https://obsproject.com): use the "Display Capture" source.
- [ ] **Resolution.** Record at **1920×1080 (1080p)**. Set the browser zoom to 110–125% so the text is readable.
- [ ] **A clean screen.**
  - Close other tabs and apps.
  - Turn on Do Not Disturb / Focus so no pop-ups appear.
  - Hide the bookmarks bar.
- [ ] **Never show a Ring token on screen.** Paste it while recording is paused, or blur it in editing.
- [ ] **Voice-over.** Record it with a quiet room and a headset mic. The free Windows *Sound Recorder* or *Clipchamp* both work.
- [ ] **Music.** Use **no copyrighted music**. Use none, or a track from the YouTube Audio Library marked free to use.
- [ ] **Label the footage.** The caption "Ring Developer Playground simulated footage" must be visible whenever Ring footage plays.
- [ ] **Length.** The final cut must be **under 3:00**. Aim for 2:40.
- [ ] **Upload to YouTube:**
  - Title: "Witness: sealed Ring doorbell evidence for protective orders (Build, Ship, Shape – Ring track)"
  - Visibility: **Public** (not Unlisted, not Private)
  - Add English captions (YouTube can auto-generate them; check them).
- [ ] **Devpost.** Paste the YouTube link into the Devpost "Video demo link" field, then open it in a private window to confirm it plays for everyone.
