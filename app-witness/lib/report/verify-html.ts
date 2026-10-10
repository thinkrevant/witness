// verify.html: one self-contained page that checks files against the embedded manifest, offline.
import { manifestSuspects, type Manifest } from "./manifest";

export interface HashLookupEntry {
  seq: number;
  kind: string;
  loggedAt: string;
  /** True when every entry holding this hash has a broken seal or a timestamp for another hash. */
  suspect: boolean;
}

/** SHA-256 → the record that holds it, preferring a record whose seal is intact. */
export function buildHashLookup(manifest: Manifest): Record<string, HashLookupEntry> {
  const suspect = manifestSuspects(manifest);
  const lookup: Record<string, HashLookupEntry> = {};
  for (const entry of manifest.entries) {
    for (const media of entry.media) {
      const candidate = { seq: entry.seq, kind: media.kind, loggedAt: entry.loggedAt, suspect: suspect.has(entry.seq) };
      const existing = lookup[media.sha256];
      if (!existing || (existing.suspect && !candidate.suspect)) lookup[media.sha256] = candidate;
    }
  }
  return lookup;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** JSON that is safe inside a <script> element: "<" can never start "</script>" or "<!--". */
function embeddedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

const STYLE = `
:root { color-scheme: light dark; --bg: #fafaf9; --fg: #1c1917; --muted: #57534e; --card: #ffffff;
  --line: #d6d3d1; --ok-bg: #f0fdfa; --ok-fg: #115e59; --bad-bg: #fef2f2; --bad-fg: #991b1b; --accent: #0f766e; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #1c1917; --fg: #f5f5f4; --muted: #a8a29e; --card: #292524; --line: #44403c;
    --ok-bg: #134e4a; --ok-fg: #ccfbf1; --bad-bg: #7f1d1d; --bad-fg: #fee2e2; --accent: #5eead4; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 720px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { font-size: 1.5rem; margin: 0 0 4px; }
p { margin: 8px 0; }
.muted { color: var(--muted); font-size: 0.9rem; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 16px; margin: 16px 0; }
dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 16px; margin: 0; }
dt { color: var(--muted); }
dd { margin: 0; overflow-wrap: anywhere; }
.status-ok { background: var(--ok-bg); color: var(--ok-fg); }
.status-bad { background: var(--bad-bg); color: var(--bad-fg); }
.badge { border-radius: 8px; padding: 8px 12px; font-weight: 600; margin: 8px 0; }
#drop { display: block; border: 2px dashed var(--line); border-radius: 12px; padding: 32px 16px; text-align: center; cursor: pointer; }
#drop.over { border-color: var(--accent); }
#drop:focus-within { outline: 2px solid var(--accent); outline-offset: 2px; }
#files { position: absolute; width: 1px; height: 1px; opacity: 0; }
#results { list-style: none; padding: 0; margin: 0; }
#results li { border-radius: 8px; padding: 10px 12px; margin: 8px 0; overflow-wrap: anywhere; }
code { font-size: 0.85rem; }
`;

const SCRIPT = `
(function () {
  var byHash = JSON.parse(document.getElementById("lookup").textContent);
  var results = document.getElementById("results");
  var input = document.getElementById("files");
  var drop = document.getElementById("drop");

  function hex(buffer) {
    return Array.prototype.map.call(new Uint8Array(buffer), function (b) {
      return ("0" + b.toString(16)).slice(-2);
    }).join("");
  }

  function when(iso) {
    var d = new Date(iso);
    return d.toLocaleString() + " (UTC " + d.toISOString() + ")";
  }

  function show(name, ok, message, hash) {
    var li = document.createElement("li");
    li.className = ok ? "status-ok" : "status-bad";
    var title = document.createElement("strong");
    title.textContent = name;
    var text = document.createElement("div");
    text.textContent = message;
    li.appendChild(title);
    li.appendChild(text);
    if (hash) {
      var code = document.createElement("code");
      code.textContent = "SHA-256: " + hash;
      li.appendChild(code);
    }
    results.appendChild(li);
  }

  function check(file) {
    if (!window.crypto || !window.crypto.subtle) {
      show(file.name, false, "This browser cannot check files here. Use the command-line steps in README.txt.");
      return;
    }
    file.arrayBuffer().then(function (buffer) {
      return window.crypto.subtle.digest("SHA-256", buffer);
    }).then(function (digest) {
      var hash = hex(digest);
      var match = Object.prototype.hasOwnProperty.call(byHash, hash) ? byHash[hash] : null;
      if (match && match.suspect) {
        show(file.name, false, "\\u26A0\\uFE0F Matches a record whose seal is broken \\u2014 see report.pdf. Do not rely on it as the sealed original.", hash);
      } else if (match) {
        show(file.name, true, "\\u2705 Matches sealed original \\u2014 incident #" + (match.seq + 1) +
          " (" + match.kind + "), logged " + when(match.loggedAt), hash);
      } else {
        show(file.name, false, "\\u274C Does not match any sealed file. It may have been edited.", hash);
      }
    }).catch(function () {
      show(file.name, false, "This file could not be read.");
    });
  }

  function checkAll(list) {
    for (var i = 0; i < list.length; i++) check(list[i]);
  }

  input.addEventListener("change", function () { checkAll(input.files); input.value = ""; });
  drop.addEventListener("dragover", function (e) { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", function () { drop.classList.remove("over"); });
  drop.addEventListener("drop", function (e) {
    e.preventDefault();
    drop.classList.remove("over");
    checkAll(e.dataTransfer.files);
  });
})();
`;

/** One HTML file with inline CSS and script and no network use; the manifest is embedded as JSON. */
export function buildVerifyHtml(manifest: Manifest): string {
  const badFiles = manifest.mediaChecks.filter((c) => !c.ok).length;
  const badTimestamps = manifest.timestamps.filter((t) => t.check === "does-not-match");
  const intact = manifest.chain.ok && badFiles === 0 && badTimestamps.length === 0;
  const chainText = manifest.chain.ok
    ? `Record chain intact: ${manifest.head.count} entries, every entry links to the one before it.`
    : `Record chain problems were found when this bundle was made (${manifest.chain.problems.length}). See report.pdf.`;
  const filesText =
    badFiles === 0
      ? `All ${manifest.mediaChecks.length} files matched their seals when this bundle was made.`
      : `${badFiles} of ${manifest.mediaChecks.length} files did not match their seals when this bundle was made. See report.pdf.`;
  const timestampText =
    badTimestamps.length === 0
      ? ""
      : `Independent timestamps do not match incident ${badTimestamps.map((t) => `#${t.seq + 1}`).join(", ")}: the record may have been changed after it was timestamped. See report.pdf.`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Witness — Verify evidence</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>Verify evidence</h1>
<p class="muted">This page works offline. Files you choose stay on this computer; nothing is uploaded.</p>
<section class="card">
<dl>
<dt>Respondent</dt><dd>${escapeHtml(manifest.case.respondentName)}</dd>
<dt>Order number</dt><dd>${escapeHtml(manifest.case.orderNumber || "(not given)")}</dd>
<dt>Incidents</dt><dd>${manifest.entries.length}</dd>
<dt>Bundle made</dt><dd>${escapeHtml(manifest.generatedAt)} (UTC)</dd>
<dt>Head entry hash</dt><dd><code>${escapeHtml(manifest.head.entryHash ?? "none")}</code></dd>
</dl>
<p class="badge ${intact ? "status-ok" : "status-bad"}">${escapeHtml(chainText)}<br>${escapeHtml(filesText)}${timestampText ? `<br>${escapeHtml(timestampText)}` : ""}</p>
</section>
<label id="drop">
<input id="files" type="file" multiple>
<strong>Drop files here, or click to choose them</strong><br>
<span class="muted">For example, the files in the media folder of this bundle.</span>
</label>
<ul id="results" aria-live="polite"></ul>
<p class="muted">This app does not provide legal advice. Talk to an advocate or attorney.</p>
</main>
<script type="application/json" id="manifest">${embeddedJson(manifest)}</script>
<script type="application/json" id="lookup">${embeddedJson(buildHashLookup(manifest))}</script>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
