# Open Source mini challenge: Devpost fields

> How to use this file: fill in the three `TODO` fields after the repository is public on GitHub, then copy everything into the Open Source section of the Devpost form.

| Devpost field | Value |
|---|---|
| Contribution URL | `TODO: https://github.com/<github-username>/<repo-name>`. This is the same as the repo URL, because Witness is a new open-source project. |
| Repository URL | `TODO: https://github.com/<github-username>/<repo-name>` |
| GitHub username | `TODO: <github-username>` |
| License | MIT. `LICENSE` is at the repository root, © 2026 Revant Raj. Check that GitHub shows "MIT license" in the repo's About panel. |

## Description

**What it is.** Witness is a new open-source project, created during the hackathon window. It is a local web app that turns Ring doorbell recordings into sealed, tamper-evident records of protective-order violations, for domestic-violence survivors and their advocates. It shows itself as "Daybook", is locked with a PIN, and has a one-tap quick exit.

**How it works.**

- **Fetching media.** A server-side client for the Ring Partner API (`app-witness/lib/ring/client.ts`) lists devices and event history. It downloads the original snapshot and clip through Ring's 303 → pre-signed URL flow, and captures `X-Media-Timestamp`, `X-Media-Duration` and `X-Request-ID`.
- **Sealing.** Each logged incident is stored byte-for-byte and fingerprinted with SHA-256. It is then appended to a hash-chained ledger: each entry's hash covers its canonical JSON, including the previous entry's hash (`lib/evidence`). The entry hash is timestamped by an RFC 3161 authority; the DER request is hand-encoded (`lib/timestamp/tsa.ts`).
- **Reporting.** Witness builds a court report PDF (pdf-lib) and an evidence bundle (fflate). The bundle contains a single-file `verify.html` that checks files offline with Web Crypto. The report says exactly what the checks prove, and prints **INTEGRITY WARNING** when something fails.
- **Tests.** 173 Vitest tests in 18 files cover tamper detection, the Ring client's 303/401/403/416/425 handling, atomic sealing and session gating. Demo mode replays recorded Ring Developer Playground responses, so anyone can run it without a Ring account.

**Why it matters.**

- About 40–50% of protective orders are violated, and many reported breaches end with no further action, because violations are hard to prove and footage is challenged as altered.
- Ring has donated about 35,000 doorbells to survivors through NNEDV. An open, auditable way to preserve that footage helps survivors, advocates and courts.
- Because the evidence logic is open source, anyone can inspect exactly how a record was sealed and verify it independently. Trust in evidence shouldn't depend on a closed tool.
- The reusable parts can serve other projects that need provable media custody, such as package-delivery disputes or caretaking logs. Those parts are:
  - the Ring media client
  - the hash-chained ledger
  - the RFC 3161 request encoder
  - the offline verifier
