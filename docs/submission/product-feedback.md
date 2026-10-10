# Product feedback: Witness

This feedback covers every tool, API and SDK that Witness uses. It is ordered by how much we depended on each one.

- The Ring entries come first and are the most detailed.
- The ring-api-helloworld sample and the Ring Appstore Knowledge MCP server were **evaluated during research only**. We read and tried them, but we did not build on them.
- Each item is backed by something real: a file in this repo, a recorded Playground response in `app-witness/fixtures/playground/`, or a live call we made on 2026-10-10.
- Step-by-step reproductions are in [`friction-log.md`](friction-log.md). Its entries are labelled A to M, and this file refers to them by letter.

---

## 1. Ring Partner API (Amazon Vision API, `api.amazonvision.com`)

**What we used it for.** This is the core of Witness. All calls are in `app-witness/lib/ring/client.ts`.

| Endpoint | Purpose in Witness |
|---|---|
| `GET /v1/devices?include=status` | Find the survivor's doorbell, and whether it is online. |
| `GET /v1/history/devices/{id}/events` | Build the "Doorbell activity" list. |
| `POST /v1/devices/{id}/media/image/download` | Get the original snapshot to seal. |
| `POST /v1/devices/{id}/media/video/download` | Get the original clip to seal. |
| `POST /v1/devices/{id}/media/streaming/whep/sessions` + `DELETE` on the returned `Location` | **Watch live**: stream the doorbell in real time over WebRTC, then close the session. |

During exploration we also called `GET /v1/users/me` with curl.

**What worked well**

- **Zero to first API call took minutes.** Paste a Playground token as a Bearer header and `GET /v1/devices` answers. There is no app registration, client secret or account linking.
- **JSON:API shapes are consistent.** `data` / `included` / `relationships` / `links.next` look the same across devices and history, so one small mapper handles both. `mapHistoryEvents` in `client.ts:98` is shared by the live and demo sources.
- **The 303 → pre-signed URL download pattern is excellent for evidence.** The POST returns `303 See Other` with an `x-request-id`. The GET on the signed URL returns the raw JPEG or MP4 with:
  - `X-Media-Timestamp`
  - `X-Media-Origin: recording`
  - `X-Media-Duration: 21466` (for the Vehicle clip)
  - `X-Request-Id`

  These are exactly what a chain-of-custody record needs. Witness prints every one of them per file in the court report (`lib/report/pdf.ts:229-253`). The recorded headers are in `fixtures/playground/vehicle-*-headers.txt`.
- **The bytes are stable, so hashing works.** A downloaded file can be stored untouched and fingerprinted. Nothing re-encodes it on our side.
- **Retry guidance for `416`/`425` is documented and easy to implement** (`client.ts:200-211`, retrying after 5, 10, 20 and 30 s).
- **WHEP live view worked on the first live attempt.** A standard browser `RTCPeerConnection` (video `recvonly`, offer sent after ICE gathering) got a `201` with an SDP answer, and 1280×720 H.264 video was playing within about 5 s. The live session then showed up in history as an `on_demand` recording, which is what makes our "Capture this moment" possible.
- **The watermark is a good trust anchor.** Ring's burned-in logo, device ID and partner name give a court a reason to believe an image came from Ring.

**What needs work**

1. **Consent-window errors are not explained** (friction log entries A and I). `403 TIME_RANGE_NOT_AUTHORIZED` appears nowhere in the media docs. The Event History section explains time-gating; the media sections and the error table do not. We had to special-case it in three places:
   - `client.ts:172`
   - `lib/api/http.ts:64`
   - `components/LogDialog.tsx`

   *Request:* document it in the Image Snapshots and Media Clips sections, and include the earliest allowed timestamp in the error body, for example `meta.earliest_allowed_timestamp`.
2. **The watermark's `Generated-At` is the download time, not the capture time** (entry E). For evidence this is confusing.
   - In our Vehicle snapshot, `Generated-At` was 2026-10-10T08:45:43Z, while the footage's own burned-in clock showed 2023-03-27.
   - A clerk could reasonably read `Generated-At` as "recorded at".

   *Request:* either label it "Downloaded" or add a "Captured" value equal to `X-Media-Timestamp`.
3. **Redirect auth is unspecified** (entry H). The docs say you can "follow the redirect automatically" but do not say whether the `Authorization` header should go to the `Location` host. We chose not to send it (`client.ts:164`, `:182`).

   *Request:* one sentence saying "do not send the bearer token to the Location URL".
4. **`416`/`425` could come from either hop** (entry J). The docs don't say whether a not-ready recording surfaces on the POST or on the signed-URL GET, so the client has to check both defensively (`client.ts:170`, `:183`).

   *Request:* say which hop returns which status, and how long a signed URL stays valid.
5. **Classification can't be tested without webhooks** (entry C). `sub_type` arrives only through webhooks, and history events don't carry it. A pull-only app cannot tell "vehicle" from "person".

   *Request:* expose `sub_type` on history events too, where a smart-alert result exists.
6. **Long opaque IDs** (entry M). Event IDs are about 120 characters (`ava1.ring.history.event.LICSUI…`). That is fine for machines but awkward in a printed report; ours shows a 10-character short form in the timeline (`pdf.ts:113-116`).

   *Nice to have:* a short, stable display ID.

**Onboarding.** This was excellent for reads. It was harder for media, because of the consent window and the doc gaps above.

**Would we build with it again?** **Yes.**

- The API is small, predictable and well-shaped.
- The 303 + headers design is better for auditability than most camera APIs we know, because each file comes with a server-side request ID and a capture timestamp.

With account linking and webhooks, Witness could become a Ring Appstore app without changing its evidence core.

---

## 2. Ring Developer Playground

**What we used it for.**

- Generating access tokens.
- Starting simulated live-view sessions (Vehicle and Motion) to create history events and media.
- Recording the fixtures that power Witness's Demo mode, so judges can run it without a Ring account.

**What worked well**

- **No hardware and no account linking needed.** A free Amazon Developer account is enough. That made the Ring track possible for us, and the organizers confirmed that Playground-only entries are not penalised.
- **Real media end to end.** Both `media/image/download` (303 → 200 JPEG) and `media/video/download` (303 → 200 MP4) worked for Playground events. That let us prove the whole seal flow against real responses.
- **The Explore APIs tab** is a quick way to see real response shapes before writing code.

**What needs work**

1. **History is empty until you start a simulated live-view session** (entry B), and nothing tells you so. New developers will think the API is broken.

   *Request:* an empty-state hint in the Playground ("Start a Package, Vehicle or Motion session below to create events"), or a few pre-seeded events.
2. **The live-view buttons are hard to find** (entry G). They sit further down the page, below the token and Explore sections. We had to scroll to find them.

   *Request:* put them next to "Generate Token", or link to them.
3. **Every event is `on_demand`, with empty `cv_detections`, no `sub_type` and no webhooks** (entry C). Nothing classification-based can be exercised. That includes the "creative" uses the rules encourage, like vehicle arrival or packages.

   *Request:* make the Vehicle session emit a `motion` event with `sub_type: vehicle`, and add a webhook test sender that posts sample notifications to a URL you enter.
4. **The 30-minute token** (entry D) forces repeated copy-paste, and closing the tab loses it.

   *Request:* a longer-lived sandbox token, or a sandbox refresh token, and a "copy as .env line" button.
5. **The consent window catches newcomers** (entry A). A token can't read media from before it was issued, so footage you made *before* generating a new token becomes unreachable.

   *Request:* show "This token can access events after HH:MM" next to the token.
6. **The sample footage limits demos** (entry F). "Motion" is birds at a bird feeder, and "Vehicle" is a parking lot. They work for testing, but a doorstep-facing sample (someone approaching a front door, a car in a driveway) would let teams demo realistic doorbell use cases.

**Onboarding.** From zero to the first API call took minutes. Getting from the first call to the first downloaded clip took noticeably longer, because of entries A and B.

**Would we build with it again?** **Yes.** It is the reason a team without a US Ring device could enter this track. Fixing entries A, B and C would make it close to perfect.

---

## 3. Ring developer documentation (`developer.amazon.com/docs/ring/api-documentation.html`)

**What we used it for.** We used it as the reference for:

- the base URL and authentication;
- JSON:API shapes;
- `event_types=` filtering and `links.next` pagination;
- the snapshot and clip request bodies;
- the error table and retry guidance;
- account linking and webhooks, for our Appstore plan.

**What worked well**

- **Thorough coverage.** It covers authentication, one-way and partner-initiated OAuth linking, notifications, history, media clips and snapshots, error handling and best practices.
- **Practical guidance** on things like `latest_in_range` versus `at_timestamp`, the 24-hour snapshot window, watermark size versus resolution, `components` on multi-camera devices, and `sub_type` being an open vocabulary.
- **Clear statements of time-gated history access** ("only events that occurred after the user granted consent") and of `links.next` being relative and preserving filters. Our pagination code follows them (`client.ts:148-156`).

**What needs work**

1. **Sections contradict each other** (entry H). On the version we read on 2026-10-10:
   - The **Media Clips** section describes a `301` redirect ("Clients must follow redirects") and an `X-Media-Length` header.
   - The **Image Snapshots** section and the Best Practices section describe `303 See Other` and `X-Media-Duration`.
   - The live API returned **303** and **`X-Media-Duration`** (see `fixtures/playground/vehicle-clip-headers.txt`).
2. **`TIME_RANGE_NOT_AUTHORIZED` is missing** (entry I). It is not in the error tables, and the media sections don't mention the consent window.
3. **It is one very large page.** The API reference is a single HTML page of about 1 MB, which is slow to search, link and feed to tools.

   *Request:* split it per resource, with stable anchors.
4. **The Playground is not mentioned on the API reference page.** A Playground quick-start box would connect the two, covering token lifetime, the consent window and the live-view buttons.

**Onboarding.** Good for reads. For media, we had to compare the docs with live responses.

**Would we build with it again?** **Yes.** The content is rich. It mainly needs consistency fixes and the consent-window error documented.

---

## 4. ring-api-helloworld sample (`github.com/AmazonAppDev/ring-api-helloworld`): evaluated, not built on

**What we used it for.** We read it during research to confirm:

- the base URL and Bearer authentication;
- the Playground-token versus refresh-token modes;
- how the endpoints are laid out.

The sample has Python scripts (with an interactive explorer that prints equivalent curl commands) and a Next.js web app with WHEP live view and a webhook receiver.

**What worked well**

- **The Playground-token quick start mirrors our own setup** (`RING_ACCESS_TOKEN` in `.env.local`).
- **Printing the equivalent curl command** for each call is a great learning aid.
- **It shows the production auth model clearly**: refresh token plus client ID and secret, with automatic renewal. That is exactly the Appstore path we plan.

**What needs work**

- **No media download.** The README does not cover `media/image/download` or `media/video/download`, including the 303 flow, the media headers and the 416/425 retries. Those are the endpoints Witness depends on most, so we wrote that client from the docs and live responses.

  *Request:* a `download_snapshot` / `download_clip` example that shows the 303 and the headers.
- **Nothing on the consent window.** A short note, or a sample error, would save time.

**Onboarding.** Clear README with sensible defaults.

**Would we build with it again?** **We would start from it** for live view or webhooks. For an evidence app, its main gap is media download.

---

## 5. Ring Appstore Knowledge MCP server (`knowledge.appstore-mcp.ring.amazon.dev/mcp`): evaluated, not built on

**What we used it for.** We evaluated it as a way for a coding assistant to search Ring docs while we planned. It is a docs-search MCP server (`search_docs`, `get_doc`) over Streamable HTTP. It does not call the Ring API.

**What worked well**

- **Easy to add.** It is a single remote URL with no local install, and there are setup notes for several IDEs.
- **The right idea for a 1 MB reference page.** Ranked search with `min_confidence` beats scrolling.

**What needs work**

- **Answers can only be as consistent as the source docs.** The 301/303 and `X-Media-Length`/`X-Media-Duration` contradictions above would surface here too.
- **Known issue:** its page says Kiro CLI can't complete authorization, so only the IDE path works.
- **No Playground coverage.** It would help if the knowledge base indexed Playground behaviour (token lifetime, the consent window, how to create events).

**Onboarding.** Simple, if you already use an MCP-capable IDE.

**Would we build with it again?** **Yes, as a research aid.** Once the docs are consistent, it becomes much more valuable.

---

## 6. Other tools we used (briefly)

| Tool | Used for | Worked | Needs work | Again? |
|---|---|---|---|---|
| **Next.js 15 (App Router)** | Pages, server-only API routes (Ring is never called from the browser) | Route handlers made it easy to keep the token server-side. A route-group layout gates every page. | Middleware runs on the Edge runtime and cannot see in-memory server state, so we gate in layouts and with a `requireSession` call per route. | Yes |
| **React 19 + Tailwind CSS 4** | The calm, accessible UI ("Daybook") | Fast to iterate. Responsive phone layout (`docs/screenshots/10-mobile-home.png`). | None worth noting. | Yes |
| **pdf-lib** | The court report PDF | Pure JavaScript, no native dependencies. It embeds the original JPEG unchanged. | The standard fonts are WinAnsi-only, so any other character throws. We added `toWinAnsi` (`lib/report/pdf.ts:35`), and the report notes when text was replaced. | Yes |
| **fflate** | The evidence bundle `.zip` | Tiny and synchronous. `level: 0` stores media byte-for-byte. | None. | Yes |
| **Web Crypto (`crypto.subtle`)** | SHA-256 on the server, in the browser and in offline `verify.html` | One hashing code path everywhere (`lib/evidence/hash.ts`). | None. | Yes |
| **FreeTSA (RFC 3161)** | An independent timestamp per ledger entry | Free, no key. We hand-encoded the DER request (`lib/timestamp/tsa.ts`). | Best effort, with no service guarantee, so Witness treats it as optional and never blocks a seal. | Yes, with a paid TSA for production |
| **Vitest** | 217 tests in 22 files | Fast, and works with TypeScript and the `@/` alias. | The config needed to be `.mts` to avoid an ESM-as-CJS warning. | Yes |
| **Claude Code** | AI coding assistant that wrote most of the code and tests from our spec | Kept a strict test-first, task-by-task process with reviews between tasks. | Live Ring checks still needed a human to generate Playground tokens every 30 minutes. | Yes |
