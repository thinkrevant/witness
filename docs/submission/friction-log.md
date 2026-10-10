# Friction log: Witness × Ring Partner API and Ring Developer Playground

- **Who:** the Witness team. That is one developer plus an AI coding assistant (Claude Code).
- **When:** 2026-10-08 to 2026-10-10. Live calls were made with curl against `https://api.amazonvision.com` on 2026-10-10, using Ring Developer Playground tokens.
- **Evidence:** recorded responses are in `app-witness/fixtures/playground/`. Code references point to `app-witness/`.

**Severity scale**

- **High:** blocks a core task, or risks a wrong conclusion.
- **Medium:** costs significant time, or forces a workaround in code.
- **Low:** polish.

## Summary

| # | Area | Issue | Severity |
|---|---|---|---|
| A | Playground / API | Media requests from before the token's issue time return `403 TIME_RANGE_NOT_AUTHORIZED`, and the Playground UI doesn't explain it | High |
| B | Playground | History is empty until a simulated live-view session is started | Medium |
| C | Playground | Every event is `on_demand` with empty `cv_detections`. There are no webhooks and no `sub_type` | High |
| D | Playground | The 30-minute token forces repeated copy-paste, and closing the tab loses it | Medium |
| E | API (media) | The snapshot watermark's `Generated-At` is the download time, not the capture time | High (for evidence use) |
| F | Playground | The sample footage (birds at a feeder, a parking lot) is not doorstep-like | Low |
| G | Playground | The live-view simulation buttons are hard to find | Low |
| H | Docs | Redirect status and media header names contradict each other across sections, and auth on the redirect is unspecified | Medium |
| I | Docs | `TIME_RANGE_NOT_AUTHORIZED` is missing from the error tables and the media sections | Medium |
| J | Docs / API | It is unclear which hop (the POST or the signed-URL GET) returns `416`/`425` | Low |
| K | Sample code | ring-api-helloworld has no media-download example | Medium |
| L | Docs | The API reference is one page of about 1 MB, and it doesn't mention the Playground | Low |
| M | API | Event and device IDs of about 120 characters are hard to show in human-facing output | Low |

---

## A. Media before the token's issue time → `403 TIME_RANGE_NOT_AUTHORIZED`, unexplained

- **Task:** download a snapshot of a recent Playground event, our first media call.
- **Steps:**
  1. In the Playground, run a Vehicle live-view session.
  2. Generate a new token.
  3. `POST /v1/devices/{id}/media/image/download` with `{"type":"latest_in_range","start_timestamp":<now − 24 h>,"end_timestamp":<now>}`. The docs allow a window of up to 24 h, so we started there.
- **Expected:** the latest JPEG in the window. Failing that, an error that says which part of the window is allowed.
- **Actual:** `403` with code `TIME_RANGE_NOT_AUTHORIZED`. The Playground UI says nothing about tokens being limited to footage after their issue (consent) time. Media from a session started *before* the current token was generated is unreachable.
- **Severity:** High. It blocks the first media download, and the cause isn't discoverable from the UI.
- **Workaround:**
  - Generate the token first, then start the live-view session.
  - Request only the event's own window: Witness sends `start` to `end` (`lib/ring/client.ts:218-220`).
  - In the app, map the error to a plain message rather than a generic failure:
    - `client.ts:172-174` → `RingMediaUnavailable`
    - `lib/api/http.ts:64-69` → `422 footage-unavailable`
    - `components/LogDialog.tsx`: "A Ring token can only reach footage recorded after it was created."
  - Covered by tests: `tests/ring/client.test.ts:281` and `tests/api/incidents-unavailable.test.ts:45`.
- **Suggestion:**
  - Show "This token can access events and media from HH:MM UTC" next to the Playground token.
  - Include the earliest allowed timestamp in the error body, for example `meta.earliest_allowed_timestamp`.
  - Document the code in the media sections (see I).

## B. History is empty until a simulated live-view session is started

- **Task:** list events to build the "Doorbell activity" feed.
- **Steps:**
  1. Generate a Playground token.
  2. `GET /v1/devices`, which returns one DoorbellPro.
  3. `GET /v1/history/devices/{id}/events`.
- **Expected:** a few sample events, or a hint on how to create some.
- **Actual:** `{"data": []}`. Events only appear after you click one of the Playground's live-view simulation buttons (Package, Vehicle or Motion) and the session ends. Nothing says so, so an empty list looks like a broken token or a broken query.
- **Severity:** Medium.
- **Workaround:**
  - Start a Vehicle and a Motion session, then re-query.
  - We recorded the resulting history (`fixtures/playground/history-all.json`) and media for Demo mode, so judges see events without doing this.
- **Suggestion:** pre-seed a few events per developer account, or show an empty-state hint in the Explore APIs tab: "No events yet: start a simulated session below".

## C. Every Playground event is `on_demand` with empty `cv_detections`; no webhooks and no `sub_type`

- **Task:** distinguish "a vehicle arrived" from other activity, which is the core of the Ring track's "creative" ideas.
- **Steps:**
  1. Run a Vehicle session and a Motion session.
  2. Fetch history.
- **Expected:** a Vehicle session produces a `motion` event with `sub_type: vehicle`, or at least a non-empty `cv_detections`, or a webhook you can receive.
- **Actual:** both events have `"event_type": "on_demand"` and `"cv_detections": {"data": []}` (`fixtures/playground/history-all.json`). The Playground sends no webhooks, and `sub_type` only exists in webhook payloads.
- **Severity:** High for the track. Classification-based UX can't be built or demoed on the Playground.
- **Workaround:**
  - Witness relies on a human decision ("Log as violation") rather than classification. For a survivor this is the right design anyway.
  - The UI labels `on_demand` as "Live view" (`lib/ui/labels.ts`).
  - Our demo story identifies the vehicle event by its time.
- **Suggestion:**
  - Have the Package, Vehicle and Motion sessions emit `ding`/`motion` events with matching `sub_type` values and populated `cv_detections`.
  - Add a "send test webhook to URL" button that posts sample notifications.

## D. 30-minute Playground token forces repeated copy-paste

- **Task:** keep a live session going while developing and testing the seal flow.
- **Steps:**
  1. Generate a token and paste it into `.env.local` or the app's Settings.
  2. Work for 30 minutes or more.
  3. Call any endpoint.
- **Expected:** a sandbox token that lasts a working session, or a refresh path.
- **Actual:**
  - After about 30 minutes, every call returns `401`. You must go back to the Playground, generate a new token and paste it again.
  - Closing the Playground tab loses the displayed token.
  - Combined with A, each new token also moves the consent window forward, so earlier events stop being downloadable.
- **Severity:** Medium.
- **Workaround:**
  - Witness shows a calm "Reconnect Ring" banner on `401`, linking to the Playground and Settings (`components/RingStatus.tsx`; `client.ts:117`, `:171`).
  - Demo mode means judges never need a token.
- **Suggestion:** a sandbox refresh token or a longer-lived (for example 8-hour) Playground token, plus a "copy as `RING_ACCESS_TOKEN=` line" button.

## E. Snapshot watermark `Generated-At` is the download time, not the capture time

- **Task:** explain in a court report what Ring's watermark proves.
- **Steps:**
  1. Run a Vehicle session.
  2. Download its snapshot (`latest_in_range` over the event window).
  3. Read the burned-in watermark, and compare it with the response headers.
- **Expected:** a watermark time that matches when the frame was captured, or a clear label saying what the time means.
- **Actual:**
  - The watermark shows `Device-ID`, `Partner` and **`Generated-At: 2026-10-10T08:45:43Z`**. That is the time of our download: the 303's `Date` header is `Sat, 10 Oct 2026 08:45:43 GMT` (`fixtures/playground/vehicle-snapshot-headers.txt`).
  - The frame's capture time is in `X-Media-Timestamp: 1791621909809` (08:45:09.809Z).
  - The sample footage's own burned-in clock shows **2023-03-27 09:54:40 CDT** (`docs/screenshots/05-incidents.png`).
  - A reader can easily take `Generated-At` as "recorded at". In an evidence setting, that invites a challenge such as "the image was generated weeks after the incident".
- **Severity:** High for evidence use. It can lead to a wrong conclusion.
- **Workaround:**
  - Witness's report states the watermark's meaning precisely: "Ring's watermark in each image shows the Ring device and the time the image was downloaded from Ring" (`lib/report/pdf.ts:89`).
  - The report prints `X-Media-Timestamp` (capture) and the retrieval time separately for each file (`pdf.ts:245-250`).
  - Survivors are encouraged to seal promptly, so the download time stays close to the incident.
- **Suggestion:** rename the field to `Downloaded-At`, or add a `Captured-At` line equal to `X-Media-Timestamp`. Document both in the Image Snapshots section.

## F. Sample footage is not doorstep-like

- **Task:** demo a realistic front-door scenario.
- **Steps:** run each Playground session and watch the footage.
- **Expected:** doorbell-perspective footage: a front step, a person approaching, a car in a driveway.
- **Actual:** "Motion" is birds at a bird feeder in snow, and "Vehicle" is a wide parking-lot view.
- **Severity:** Low. It doesn't block development, but it weakens demos.
- **Workaround:** our video uses the Vehicle clip, clearly labelled "Ring Developer Playground simulated footage", and the narration says it stands in for a driveway.
- **Suggestion:** add one or two doorstep-perspective samples (a person at the door, a car pulling into a driveway). Actor footage is fine.

## G. Live-view simulation buttons are hard to find

- **Task:** create history events (see B).
- **Steps:** open the Playground and look for how to make the doorbell "see" something.
- **Expected:** the session controls near "Generate Token", or a link to them.
- **Actual:** the Package, Vehicle and Motion buttons are further down the page, below the token section and the Explore APIs tab. The developer on our team had to ask where they were.
- **Severity:** Low.
- **Workaround:** scroll down. The README's "Live mode" steps say where to look.
- **Suggestion:** place a "Simulate an event" card right under the token, or add an anchor link to it.

## H. Docs: redirect status and media header names contradict each other; auth on redirect unspecified

- **Task:** implement media download correctly the first time.
- **Steps:** read the Media Clips, Image Snapshots and Best Practices sections of `api-documentation.html` (version of 2026-10-10), then call the endpoints.
- **Expected:** one redirect status, one set of header names, and a statement about whether to send `Authorization` to the redirect target.
- **Actual:**
  - **Media Clips** describes a "301 Redirect … Clients must follow redirects", and an `X-Media-Length` header for actual duration.
  - **Image Snapshots** and **Best Practices** describe `303 See Other` and `X-Media-Duration`.
  - The live API returned `303` and `X-Media-Duration: 21466` (`fixtures/playground/vehicle-clip-headers.txt`).
  - No section says whether the bearer token should go to the pre-signed `Location` host.
- **Severity:** Medium.
- **Workaround:**
  - Witness uses `redirect: "manual"`, accepts the 303, and fetches `Location` **without** `Authorization` (`client.ts:161-182`).
  - It reads `X-Media-Duration` (`client.ts:194`).
  - Tested in `tests/ring/client.test.ts:152`.
- **Suggestion:** make the sections agree (303 and `X-Media-Duration`), and add: "The Location URL is pre-signed; do not send the Authorization header to it. It expires after N minutes."

## I. Docs: `TIME_RANGE_NOT_AUTHORIZED` is not documented for media

- **Task:** handle every media error the API can return.
- **Steps:** search the API reference for the code we received in A.
- **Expected:** an entry in the media error tables, explaining the consent window for media.
- **Actual:**
  - The code appears nowhere in the reference. The Image Snapshots error table lists `403 REQUEST_FORBIDDEN` ("Client is not authorized for the device"), which is a different cause.
  - Time-gating is explained only under Event History ("only events that occurred after the user granted consent to your app"), not for media.
- **Severity:** Medium.
- **Workaround:** special-cased in code (see A).
- **Suggestion:** add `403 TIME_RANGE_NOT_AUTHORIZED` to the Media Clips and Image Snapshots error tables, with one sentence on the consent window.

## J. Which hop returns `416`/`425`?

- **Task:** retry clips that are not ready yet, as the docs advise.
- **Steps:** read the retry guidance, then implement the retry.
- **Expected:** a statement of whether `416`/`425` comes from the POST, or from the GET of the signed URL.
- **Actual:** the docs say to retry "the unchanged request" but don't say which hop returns these statuses, or how long a signed URL stays valid.
- **Severity:** Low.
- **Workaround:**
  - Witness treats `416`/`425` from **either** hop as retryable, and re-POSTs on each retry (`client.ts:170`, `:183`, `:200-211`).
  - It waits 5, 10, 20 and 30 seconds.
  - Tested in `tests/ring/client.test.ts:238` and `:251`.
- **Suggestion:** document the hop, and the signed URL's lifetime.

## K. ring-api-helloworld has no media-download example

- **Task:** learn the media-download flow from the official sample.
- **Steps:** read the ring-api-helloworld README (Python scripts and the Next.js app).
- **Expected:** a snapshot and clip download example showing the 303 and the `X-Media-*` headers.
- **Actual:**
  - The sample covers devices, status, capabilities, location, configurations, history, `users/me`, WHEP live view and webhooks.
  - It covers neither media-download endpoint.
- **Severity:** Medium. These are the endpoints evidence, package and caretaking apps need most.
- **Workaround:** we wrote the client from the docs and live curl responses (`lib/ring/client.ts:161-231`).
- **Suggestion:** add `download_snapshot.py` and `download_clip.py`, printing the equivalent curl like the other scripts do, plus a note on the consent window.

## L. The API reference is one ~1 MB page and doesn't mention the Playground

- **Task:** find a specific detail, such as the clip error codes.
- **Steps:** open `developer.amazon.com/docs/ring/api-documentation.html` and search.
- **Expected:** a page per resource, with a Playground quick-start.
- **Actual:** a single HTML page of about 1 MB covering everything. The word "Playground" does not appear on it. Playground behaviour (token lifetime, consent window, how to create events) has to be learned by trial.
- **Severity:** Low.
- **Workaround:** text search. The Ring Appstore Knowledge MCP server helps with search.
- **Suggestion:** split the reference per resource, and add a "Using the Developer Playground" box that covers items A, B, C and D.

## M. Long opaque IDs in human-facing output

- **Task:** print event and device IDs in a court report.
- **Steps:** look at the IDs from history.
- **Expected:** IDs short enough to read aloud or compare by eye.
- **Actual:** IDs are about 120 characters, for example `ava1.ring.history.event.2CXFMGXZF7SKH25MJOGXCCOKI2FYO…`. They wrap over several lines in a PDF (`docs/screenshots/11-report-pdf-incident.png`).
- **Severity:** Low.
- **Workaround:** the timeline shows a 10-character short form (`lib/report/pdf.ts:113-116`), and the incident pages print the full ID.
- **Suggestion:** a stable short display ID, or a documented safe suffix length.
