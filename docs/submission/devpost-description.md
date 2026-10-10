# Devpost submission: Witness

> How to use this file: copy each section into the matching Devpost field. Replace the `TODO` links before you submit.

- **Project name:** Witness
- **Tagline (about 200 characters):** Turn Ring doorbell clips into sealed, tamper-evident, court-ready records of protective-order violations, built for survivor safety: disguised as "Daybook", PIN-locked, with a one-tap quick exit.
- **Tracks:** Ring. Also the Open Source mini challenge (see `open-source-mini-challenge.md`).
- **Links:**
  - GitHub repo: `TODO: https://github.com/<username>/<repo>` (public, MIT)
  - Demo video: `TODO: https://youtu.be/<id>` (public, under 3 minutes)

---

## Inspiration

A protective order is only as strong as the proof that it was broken.

- About **40–50% of protective orders are violated** (a review of 43 studies).
- In Kentucky's protective-order study, about **half of the women reported a violation within six months**.
- In the West Midlands (UK), police record roughly **1,300–2,000 breaches of non-molestation orders a year**, and about **3 in 4 end in "no further action"**.
- Advocates say violations are hard to prove. Where doorbell footage exists, it has led to an added charge, and defence lawyers respond by arguing the footage was altered.

Ring is already part of this story. Through the **Ring × NNEDV donation program**, about **35,000 Ring doorbells and cameras** have gone to survivors through more than 750 organisations over four years. Those doorbells capture the moment the respondent's car pulls into the driveway. But a survivor still has to:

- find the clip,
- download it,
- keep it from being lost or overwritten, and
- convince a clerk or judge that it is the untouched original.

We looked at the 64 apps in the Ring Appstore and about 75 other Ring-track projects. None of them does this.

## What it does

Witness is a local web app for a survivor with a Ring doorbell and a protective order. It has five parts.

1. **Doorbell activity.** Using the **Ring Partner API**, Witness lists recent events from the survivor's doorbell, each with a thumbnail and a **Log as violation** button.
2. **Seal.** The survivor adds an optional note and taps **Seal**. Witness then:
   - downloads the original **snapshot** and **video clip** from Ring;
   - stores the bytes exactly as received;
   - computes a **SHA-256 fingerprint** of each file;
   - appends an entry to an **append-only, hash-chained ledger**, where each entry includes the previous entry's hash;
   - asks an independent **RFC 3161 timestamp authority** (FreeTSA) to timestamp that entry's hash. Only the hash leaves the computer.
3. **Report.** One tap builds a PDF for police, a lawyer or the court. It contains:
   - the order details and a timeline;
   - one page per incident, with the watermarked still, the hashes, Ring's `X-Media-Timestamp` and request IDs, and retrieval times;
   - a chain-of-custody and integrity page;
   - "how to verify" instructions;
   - a declaration template to sign.

   A second tap builds an **evidence bundle** (`.zip`) with the original media, `manifest.json`, the timestamp tokens and an offline **`verify.html`**.
4. **Verify.** Anyone (an advocate, a clerk, a judge) can drop a file onto the Verify page, or onto `verify.html` with no internet connection, and see one of three results:
   - ✅ it matches a sealed original;
   - ⚠️ it matches a record whose seal is broken;
   - ❌ it does not match.

   Change one pixel and it fails.
5. **Safety first.**
   - The app shows itself as **"Daybook"**, and files download as `daybook-record-<date>`.
   - It is locked with a scrypt-hashed PIN that has a guess throttle, and it locks itself after 5 minutes idle.
   - An **Exit** button, or **Esc pressed twice**, instantly replaces the page with a weather site. The app holds only one history entry, so Back does not return to it.
   - It sends no notifications, has no accounts and no cloud. Everything stays on the device, and the server listens on 127.0.0.1 only.
   - The Safety page lists helplines and links to NNEDV's Safety Net.

Witness never recognises faces, people or licence plates. The survivor alone decides what counts as a violation.

The report says what the checks prove, and no more:

1. The Ring watermark shows the device and the time the image was **downloaded**.
2. The fingerprints match those **recorded at sealing**.
3. The hash chain shows no incident was removed, inserted or reordered within the chain, unless every later record was re-sealed; the independent timestamps and the head hash in earlier reports detect such a rewrite.
4. The timestamps, where present, show when each record existed. Witness checks that each token names the record's current hash, and flags the record if it does not.
5. The chain of custody records each retrieval and its Ring request ID.

> This app does not provide legal advice. Talk to an advocate or attorney.

## How we built it

- **Ring Partner API (Amazon Vision), through the Ring Developer Playground.** All calls are server-side, in `app-witness/lib/ring/client.ts`:
  - `GET /v1/devices?include=status`
  - `GET /v1/history/devices/{id}/events`, with `links.next` pagination
  - `POST /v1/devices/{id}/media/image/download` (`latest_in_range`, 1920×1080 JPEG)
  - `POST /v1/devices/{id}/media/video/download` (`timestamp` + `duration`)

  The client:
  - follows the **303** to the pre-signed URL *without* forwarding the bearer token;
  - captures `X-Media-Timestamp`, `X-Media-Duration` and `X-Request-ID`;
  - retries `416`/`425` after 5, 10, 20 and 30 seconds;
  - maps `401` to a calm "Reconnect Ring" banner and `403 TIME_RANGE_NOT_AUTHORIZED` to a plain-language message.

  The README has a file-and-line table for every call.
- **Demo mode.** Judges can run the app without a Ring account. Demo mode replays real Playground responses recorded on 2026-10-10 (history JSON, JPEG and MP4 bytes, response headers), and every screen labels them "Ring Developer Playground simulated footage".
- **Evidence core (`lib/evidence`)** is pure and fully unit-tested:
  - Web Crypto SHA-256;
  - canonical JSON (keys sorted, no whitespace);
  - a ledger where `entryHash = sha256(canonical(entry without entryHash))`, with a genesis `prevHash` of 64 zeros;
  - a verifier that reports every sequence gap, broken link and edited entry.
- **Timestamps (`lib/timestamp/tsa.ts`).** We hand-encode the DER `TimeStampReq` (SHA-256 imprint, random nonce, certReq) and parse the `PKIStatus` of the response. No ASN.1 library was needed.
- **Reports (`lib/report`).**
  - **pdf-lib** draws the PDF from a pure text model (`buildReportText`), so the content is unit-tested.
  - **fflate** zips the bundle.
  - `verify.html` is one self-contained file: inline CSS and script, the manifest embedded as JSON, and `crypto.subtle` hashing. It makes no network requests.
- **App.** Next.js 15 (App Router), React 19, TypeScript (strict) and Tailwind CSS 4.
  - Data is stored in an atomic JSON file store, with content-addressed media (`data/media/<sha256>.jpg|mp4`).
  - Every API route except the unlock route (`/api/lock`) checks the session. Routes that change data also refuse cross-site requests.
- **Tests.** **173 Vitest tests in 18 files.** They cover:
  - tamper detection (edited, deleted and reordered entries);
  - the Ring client against mocked 303/401/403/416/425 responses;
  - atomic and race-safe sealing;
  - report integrity warnings, including a timestamp that does not match a re-sealed record;
  - the PIN throttle;
  - session gating of the data API routes.
- **AI assistance.** We built Witness with AI coding assistance: **Claude Code** wrote most of the code and tests from our design spec, task by task, and each task was reviewed against the spec before the next began. We made the product, safety and trust decisions. We generated the Playground tokens and checked every endpoint live (with curl, 2026-10-10) before the client was written, and kept the friction log as we went.

## Challenges we ran into

- **Consent windows.** Our first snapshot request used a 24-hour window and failed with `403 TIME_RANGE_NOT_AUTHORIZED`. Media from before the token's issue time is refused, and neither the Playground nor the media docs say so. The fix in the product:
  - the error is mapped to "Footage not accessible with this token";
  - the message tells the survivor that a token reaches only footage recorded after it was created.
- **An empty history.** The Playground's history stays empty until you start a simulated live-view session (Package, Vehicle or Motion), and those buttons sit further down the page, where they are easy to miss.
- **No event classification.** Every Playground event is `on_demand`, with empty `cv_detections`, no `sub_type` and no webhooks. We designed the UX around a human decision ("Log as violation") instead of auto-classification. That is the right call for safety anyway.
- **Honest trust claims.** The snapshot watermark's `Generated-At` is the **download** time, not the capture time. The footage's burned-in clock said 2023-03-27, while `Generated-At` said 2026-10-10T08:45:43Z. We rewrote the report's trust statements so it never overstates what is proven, and so a record with a broken seal is never shown as ✅.
- **Short-lived tokens.** The 30-minute Playground token forced repeated copy-paste. Our answers were Demo mode and a calm "Reconnect Ring" flow.
- **Designing for a survivor.** Every screen had to be safe if someone looks over the survivor's shoulder:
  - neutral words before unlock;
  - neutral file names;
  - no history trail after quick exit;
  - no notifications.

## Accomplishments that we're proud of

- **A complete evidence pipeline that runs on real Ring Developer Playground responses** (recorded for demo mode, and live with a Playground token): event, then original media, then a sealed ledger, then a court PDF, then offline verification.
- **A verifier anyone can run with no software and no internet.** You double-click `verify.html`, or use `certutil` or `shasum`.
- **Tamper evidence that fails loudly.** Change one byte and verification fails. Edit a ledger entry and the report prints **INTEGRITY WARNING** and withholds that record's image.
- **A calm, disguised UX** built around survivor-safety practice:
  - a PIN and an idle lock;
  - quick exit with Esc twice;
  - a single history entry;
  - a safety page with helplines.
- **173 passing tests**, and a detailed friction log and product feedback for the Ring team.

## What we learned

- **Ring "provides the pixels".** The value is in what you build around them. Here, that is chain of custody.
- **Ring's watermark is a strong trust anchor**, as long as you are precise about what it shows (device and download time) and what it does not.
- **The Partner API's design is easy to build evidence on.** Its JSON:API shapes, 303-to-signed-URL downloads and request IDs make an audit trail almost free. Capturing `X-Request-ID` and `X-Media-Timestamp` per file gives a report Ring can, in principle, corroborate.
- **Consent-gated access is the right model for privacy.** It needs to be visible in the developer tools.

## What's next for Witness

**The path to the Ring Appstore:**

1. **Replace the Playground token with account linking.** Use Ring's one-way linking or partner-initiated OAuth 2.0 (PKCE) with refresh tokens, so the survivor connects once and never pastes a token again.
2. **Add webhooks.** With motion and ding notifications (with `sub_type`), Witness can pre-fetch and hold the original media for every event as soon as it is ready, so footage is not lost if the survivor opens the app days later. There would still be no push notifications on the survivor's device.
3. **Encrypt media at rest** with a key derived from the PIN, and support multiple devices.
4. **Pilot with advocates in the Ring × NNEDV donation program.** Advocates who hand out the doorbells could set up Witness at the same time, and give us feedback on report wording for local courts.
5. **Pass Ring certification and content-policy review.** Witness already avoids recognition, watchlists and public sharing by design.

Witness is open source under the **MIT License**, so advocates, legal-aid groups and researchers can audit exactly how the evidence is sealed.

---

## Built With

`ring-partner-api` · `ring-developer-playground` · `next.js` · `react` · `typescript` · `tailwindcss` · `pdf-lib` · `fflate` · `vitest` · `web-crypto` · `rfc-3161` · `freetsa` · `node.js` · `claude-code`

## Testing instructions for judges

1. Install Node.js 24 or newer.
2. Clone the repo, then run `cd app-witness`, `npm install` and `npm run dev`.
3. Open http://localhost:3000 and set any 4–8 digit code.

Demo mode is on by default and needs no Ring account. To use live Ring data, follow the README's "Live mode" section: generate a Playground token, click **Vehicle** in the Playground, and paste the token in Settings.

No credentials are needed.

## Product feedback and friction log

- **Product feedback:** see `docs/submission/product-feedback.md` (Ring Partner API, Ring Developer Playground, Ring developer documentation, plus the sample and MCP docs server we evaluated).
- **Friction log:** see `docs/submission/friction-log.md` (13 entries with severity, workaround and suggestion).
