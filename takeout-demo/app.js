"use strict";

/* Sovereign Takeout dashboard — vanilla JS, no frameworks, no CDN
 * assets. Polls /api/state every 3s and re-renders. All state
 * mutation happens server-side; this file only calls the JSON API
 * and reflects the response.
 */

const POLL_INTERVAL_MS = 3000;
const TOTAL_SERVICES = 8;
const VERIFIED_OR_LATER = new Set([
  "verified",
  "erasure_offered",
  "erasure_confirmed",
  "erasure_sent",
]);

const STATUS_LABELS = {
  pending: "Pending",
  export_requested: "Export requested",
  awaiting_archive: "Awaiting archive",
  downloaded: "Downloaded",
  verified: "Verified",
  erasure_offered: "Erasure offered",
  erasure_confirmed: "Erasure confirmed",
  erasure_sent: "Erasure sent",
};

const els = {
  outputDir: document.getElementById("output-dir"),
  progressFill: document.getElementById("progress-fill"),
  progressLabel: document.getElementById("progress-label"),
  startZone: document.getElementById("start-zone"),
  dashboard: document.getElementById("dashboard"),
  cards: document.getElementById("cards"),
  pressStart: document.getElementById("press-start"),
  launchAll: document.getElementById("launch-all"),
  modal: document.getElementById("prompt-modal"),
  modalTitle: document.getElementById("prompt-modal-title"),
  modalText: document.getElementById("prompt-modal-text"),
  modalCopy: document.getElementById("prompt-modal-copy"),
  modalClose: document.getElementById("prompt-modal-close"),
  profileName: document.getElementById("profile-name"),
  profileEmail: document.getElementById("profile-email"),
  profileSave: document.getElementById("profile-save"),
  profileStatus: document.getElementById("profile-status"),
  aboutLink: document.getElementById("about-link"),
  explainerModal: document.getElementById("explainer-modal"),
  explainerModalText: document.getElementById("explainer-modal-text"),
  explainerModalCopy: document.getElementById("explainer-modal-copy"),
  explainerModalClose: document.getElementById("explainer-modal-close"),
};

let started = false;
let pollTimer = null;
let lastState = null;
let profileInitialized = false; // only seed the profile inputs from the
// server once — after that, the user's own typing owns them; the 3s
// poll must never clobber mid-edit text.
const cardStatusLines = new Map(); // key -> transient status-line text
// key -> in-progress "Assign file…" path text. Every 3s poll rebuilds the
// cards' innerHTML wholesale (renderCards), which would otherwise wipe out
// whatever the user was mid-typing/pasting into that input and drop focus.
// Cached here on every keystroke and restored in cardHtml()/renderCards().
const assignPathValues = new Map();
// key -> in-progress typed service-key confirmation text for the erasure
// zone. Same wipe-on-re-render problem as assignPathValues, same fix.
const erasureConfirmValues = new Map();
// key -> the takeout agent prompt text last returned by open_export, so
// "Show prompt" can redisplay it without a second open_export call (which
// would needlessly re-open the browser tab and re-run pbcopy).
const promptCache = new Map();
// key -> the last erasure/confirm response (notice + notice_path +
// browser), so the "what was handed to the agent/browser" panel stays
// visible across the 3s poll re-render until the service moves past
// erasure_confirmed (the panel is keyed off svc.status, not this cache,
// so a stale entry from an old run never resurfaces after a reset).
const erasureNoticeCache = new Map();
// The explainer text is static for the lifetime of the page — fetched
// once from GET /api/explainer and cached, same "don't refetch what
// hasn't changed" logic as promptCache above.
let explainerCache = null;

const INPUT_ROLES = ["assign-path", "erasure-confirm"];

async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  let data;
  try {
    data = await res.json();
  } catch (e) {
    data = { ok: false, error: `bad response (${res.status})` };
  }
  return { status: res.status, data };
}

function setCardStatus(key, text) {
  cardStatusLines.set(key, text);
  const el = document.querySelector(`.status-line[data-key="${key}"]`);
  if (el) el.textContent = text;
}

async function fetchState() {
  try {
    const { data } = await api("GET", "/api/state");
    if (data.ok) {
      lastState = data;
      render(data);
    }
  } catch (e) {
    // Transient network hiccup against localhost — next poll retries.
  }
}

function startPolling() {
  if (pollTimer) return;
  fetchState();
  pollTimer = setInterval(fetchState, POLL_INTERVAL_MS);
}

function render(state) {
  els.outputDir.textContent = state.output_dir;

  if (!profileInitialized && state.profile) {
    els.profileName.value = state.profile.name || "";
    els.profileEmail.value = state.profile.email || "";
    profileInitialized = true;
  }

  const keys = Object.keys(state.services);
  const verifiedCount = keys.filter((k) =>
    VERIFIED_OR_LATER.has(state.services[k].status)
  ).length;
  els.progressFill.style.width = `${(verifiedCount / TOTAL_SERVICES) * 100}%`;
  els.progressLabel.textContent = `${verifiedCount} of ${TOTAL_SERVICES} verified`;

  const anyStarted = keys.some((k) => state.services[k].status !== "pending");
  if (started || anyStarted) {
    showDashboard();
    renderCards(state);
  }
}

function showDashboard() {
  started = true;
  els.startZone.hidden = true;
  els.dashboard.hidden = false;
}

function renderCards(state) {
  // Preserve focus + cursor position across the wholesale innerHTML
  // rebuild below — otherwise a user typing into an "Assign file…" or
  // erasure typed-confirmation input gets kicked out mid-keystroke on
  // every 3s poll.
  const active = document.activeElement;
  let focusedKey = null;
  let focusedRole = null;
  let selStart = null;
  let selEnd = null;
  if (active) {
    for (const role of INPUT_ROLES) {
      if (active.matches(`input[data-role="${role}"]`)) {
        focusedKey = active.dataset.key;
        focusedRole = role;
        selStart = active.selectionStart;
        selEnd = active.selectionEnd;
        break;
      }
    }
  }

  const keys = Object.keys(state.services);
  els.cards.innerHTML = keys.map((key) => cardHtml(key, state.services[key])).join("");

  if (focusedKey) {
    const input = els.cards.querySelector(
      `input[data-role="${focusedRole}"][data-key="${focusedKey}"]`
    );
    if (input) {
      input.focus();
      try {
        input.setSelectionRange(selStart, selEnd);
      } catch (e) {
        // setSelectionRange can throw on some input types — cosmetic only.
      }
    }
  }
}

function badgeClass(status) {
  return `badge badge-${status}`;
}

function cardHtml(key, svc) {
  const statusLine = cardStatusLines.get(key) || "";
  const notes = (svc.notes || [])
    .map((n) => `<li>${escapeHtml(n)}</li>`)
    .join("");
  const erasure = erasureZoneHtml(key, svc);
  const promptBadge = svc.prompt_available
    ? '<span class="badge" title="agent prompt available">prompt ready</span>'
    : "";

  return `
    <article class="card" data-key="${key}">
      <div class="card-title-row">
        <span class="card-title">${escapeHtml(svc.display_name)}</span>
        <span class="${badgeClass(svc.status)}">${STATUS_LABELS[svc.status] || svc.status}</span>
      </div>
      <div class="card-meta">
        expected wait: ${escapeHtml(svc.expected_wait)}${svc.skipped ? " · skipped" : ""}
        ${promptBadge}
      </div>
      ${notes ? `<ul class="card-notes">${notes}</ul>` : ""}
      <div class="card-actions">
        <button type="button" data-action="open_export" data-key="${key}">Open export page (copies agent prompt)</button>
        <button type="button" data-action="show_prompt" data-key="${key}">Show prompt</button>
        <button type="button" data-action="mark_downloaded" data-key="${key}">I downloaded it</button>
        <input type="text" placeholder="/path/to/archive.zip" data-role="assign-path" data-key="${key}" value="${escapeHtml(assignPathValues.get(key) || "")}">
        <button type="button" data-action="assign_file" data-key="${key}">Assign file…</button>
        <button type="button" data-action="verify" data-key="${key}">Verify now</button>
        <button type="button" data-action="reset" data-key="${key}">Reset</button>
        <button type="button" data-action="skip" data-key="${key}">${svc.skipped ? "Unskip" : "Skip"}</button>
      </div>
      <div class="status-line" data-key="${key}">${escapeHtml(statusLine)}</div>
      ${erasure}
    </article>
  `;
}

function profileIsIncomplete() {
  // Mirrors the server's erasure.profile_incomplete_reason() check —
  // simple, non-regex: non-empty name, non-empty email containing "@".
  const name = els.profileName.value.trim();
  const email = els.profileEmail.value.trim();
  return !name || !email || !email.includes("@");
}

function erasureZoneHtml(key, svc) {
  if (!VERIFIED_OR_LATER.has(svc.status)) {
    return `<div class="erasure-zone locked">Erasure (GDPR Art. 17): locked — complete and verify this service's takeout first.</div>`;
  }
  if (svc.skipped) {
    return `<div class="erasure-zone locked">Erasure (GDPR Art. 17): unavailable — this service is skipped. Unskip it to unlock.</div>`;
  }

  const report = svc.verified_report;
  const evidenceHtml = report
    ? `<ul class="evidence-list">${report.checks
        .map(
          (c) =>
            `<li class="${c.passed ? "evidence-pass" : "evidence-fail"}">${c.passed ? "✓" : "✗"} ${escapeHtml(c.name)}: ${escapeHtml(c.detail)}</li>`
        )
        .join("")}</ul>`
    : "";

  // Only show the "what was sent" panel once a confirm has actually
  // succeeded for this run (erasure_confirmed/erasure_sent) — a status
  // of "verified" means either erasure hasn't been confirmed yet, or a
  // reset happened since, so any cached notice from before is stale.
  const showsNotice = svc.status === "erasure_confirmed" || svc.status === "erasure_sent";
  const cached = showsNotice ? erasureNoticeCache.get(key) : null;
  const noticeHtml = cached ? erasureNoticeHtml(cached) : "";

  let actionHtml;
  if (svc.status === "erasure_sent") {
    const sentAt = svc.erasure && svc.erasure.sent_at ? svc.erasure.sent_at : "";
    actionHtml = `<div class="erasure-sent-label">Erasure request marked sent${sentAt ? " (" + escapeHtml(sentAt) + ")" : ""}.</div>`;
  } else if (svc.status === "erasure_confirmed") {
    actionHtml = `<button type="button" data-action="mark_sent" data-key="${key}">Mark sent</button>`;
  } else if (profileIsIncomplete()) {
    // status === "verified", but the server will refuse to confirm
    // without a name + a plausible email (the letter would otherwise
    // identify no one) — surface that lock here instead of showing a
    // confirmation control that's guaranteed to be rejected.
    actionHtml = `<div class="erasure-profile-lock">Fill in your name and email above first — required for the GDPR erasure letter to identify your account.</div>`;
  } else {
    // status === "verified" (erasure_offered is a transient
    // server-side pass-through, never observed from the UI's poll).
    const confirmVal = erasureConfirmValues.get(key) || "";
    const matches = confirmVal === key;
    actionHtml = `
      <label class="erasure-confirm-label">
        Type <code>${escapeHtml(key)}</code> to confirm erasure for this service:
        <input type="text" data-role="erasure-confirm" data-key="${key}" value="${escapeHtml(confirmVal)}" placeholder="${escapeHtml(key)}">
      </label>
      <button type="button" data-action="erasure_send" data-key="${key}" ${matches ? "" : "disabled"}>Send erasure request (GDPR Art. 17)</button>
    `;
  }

  return `
    <div class="erasure-zone">
      <div class="erasure-title">Erasure (GDPR Art. 17)</div>
      ${evidenceHtml}
      ${actionHtml}
      ${noticeHtml}
    </div>
  `;
}

function erasureNoticeHtml(cached) {
  const notice = cached.notice;
  return `
    <div class="erasure-notice">
      <div><strong>Channel:</strong> ${escapeHtml(notice.channel)}</div>
      <div><strong>Opened via:</strong> ${escapeHtml(cached.browser || "n/a")}</div>
      <div><strong>Notice saved to:</strong> ${escapeHtml(cached.notice_path || "")}</div>
      <details>
        <summary>What was handed to the agent/browser</summary>
        <pre class="erasure-notice-body">${escapeHtml(cached.clipboard_text || notice.body)}</pre>
      </details>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// -- actions --------------------------------------------------------------

async function doOpenExport(key, { showModal = false } = {}) {
  setCardStatus(key, "opening export page…");
  const { data } = await api("POST", `/api/service/${key}/open_export`, {});
  if (!data.ok) {
    setCardStatus(key, `error: ${data.error}`);
    return;
  }
  promptCache.set(key, data.prompt);
  setCardStatus(key, `opened via ${data.browser}; prompt copied to clipboard`);
  if (showModal) {
    openPromptModal(key, data.prompt);
  }
  fetchState();
}

async function doShowPrompt(key) {
  // Prefer the cached prompt from a prior open_export — avoids
  // re-opening the browser tab and re-running pbcopy just to view text
  // already fetched once. First-ever view for a service still has to
  // go through open_export (it's the only route that returns prompt
  // text, and it's also responsible for the pending->export_requested
  // advance + clipboard copy).
  const cached = promptCache.get(key);
  if (cached !== undefined) {
    openPromptModal(key, cached);
    return;
  }
  await doOpenExport(key, { showModal: true });
}

async function doMark(key, status) {
  const { data } = await api("POST", `/api/service/${key}/mark`, { status });
  if (!data.ok) {
    setCardStatus(key, `error: ${data.error}`);
    return;
  }
  setCardStatus(key, `marked ${status}`);
  fetchState();
}

async function doAssignFile(key, path) {
  if (!path) {
    setCardStatus(key, "enter a file path first");
    return;
  }
  const { data } = await api("POST", `/api/service/${key}/assign_file`, { path });
  if (!data.ok) {
    setCardStatus(key, `error: ${data.error}`);
    return;
  }
  assignPathValues.delete(key); // clear the input now that the path was consumed
  setCardStatus(key, "file assigned");
  fetchState();
}

async function doVerify(key) {
  setCardStatus(key, "verifying…");
  const { data } = await api("POST", `/api/service/${key}/verify`, {});
  if (!data.ok) {
    setCardStatus(key, `error: ${data.error}`);
    return;
  }
  setCardStatus(key, data.report.passed ? "verification passed" : "verification failed");
  fetchState();
}

async function doReset(key) {
  const { data } = await api("POST", `/api/service/${key}/reset`, {});
  if (!data.ok) {
    setCardStatus(key, `error: ${data.error}`);
    return;
  }
  // A reset can be followed by re-verifying and re-confirming from
  // scratch — a stale notice/typed-confirmation from the erased run
  // must not resurface under the new confirmation flow.
  erasureNoticeCache.delete(key);
  erasureConfirmValues.delete(key);
  setCardStatus(key, "reset");
  fetchState();
}

async function doSkip(key, skipped) {
  const { data } = await api("POST", `/api/service/${key}/skip`, { skipped });
  if (!data.ok) {
    setCardStatus(key, `error: ${data.error}`);
    return;
  }
  setCardStatus(key, skipped ? "skipped" : "unskipped");
  fetchState();
}

async function doErasureSend(key) {
  const confirmVal = erasureConfirmValues.get(key) || "";
  if (confirmVal !== key) {
    setCardStatus(key, `type "${key}" exactly to confirm erasure`);
    return;
  }
  setCardStatus(key, "sending erasure request…");
  const { data } = await api("POST", `/api/service/${key}/erasure/confirm`, {
    confirm: confirmVal,
    user_name: els.profileName.value.trim(),
    user_email: els.profileEmail.value.trim(),
  });
  if (!data.ok) {
    setCardStatus(key, `error: ${data.error}`);
    return;
  }
  erasureNoticeCache.set(key, {
    notice: data.notice,
    notice_path: data.notice_path,
    browser: data.browser,
    clipboard_text: data.clipboard_text,
  });
  erasureConfirmValues.delete(key);
  setCardStatus(key, "erasure request confirmed — notice generated");
  fetchState();
}

async function doMarkSent(key) {
  const { data } = await api("POST", `/api/service/${key}/erasure/sent`, {});
  if (!data.ok) {
    setCardStatus(key, `error: ${data.error}`);
    return;
  }
  setCardStatus(key, "marked sent");
  fetchState();
}

async function doSaveProfile() {
  const name = els.profileName.value.trim();
  const email = els.profileEmail.value.trim();
  const { data } = await api("POST", "/api/profile", { name, email });
  els.profileStatus.textContent = data.ok ? "saved" : `error: ${data.error}`;
  if (data.ok) {
    setTimeout(() => {
      if (els.profileStatus.textContent === "saved") els.profileStatus.textContent = "";
    }, 2000);
  }
}

async function doShowExplainer() {
  if (explainerCache !== null) {
    openExplainerModal(explainerCache);
    return;
  }
  els.explainerModalText.textContent = "loading…";
  els.explainerModal.hidden = false;
  try {
    const res = await fetch("/api/explainer");
    const text = await res.text();
    if (!res.ok) {
      els.explainerModalText.textContent = `error loading explainer (${res.status})`;
      return;
    }
    explainerCache = text;
    openExplainerModal(text);
  } catch (e) {
    els.explainerModalText.textContent = "error loading explainer (network)";
  }
}

function openExplainerModal(text) {
  els.explainerModalText.textContent = text;
  els.explainerModal.hidden = false;
}

function openPromptModal(key, promptText) {
  const svc = lastState && lastState.services[key];
  els.modalTitle.textContent = svc ? `Agent prompt — ${svc.display_name}` : "Agent prompt";
  els.modalText.textContent = promptText;
  els.modal.hidden = false;
  els.modal.dataset.promptText = promptText;
}

// -- event wiring -----------------------------------------------------------

els.pressStart.addEventListener("click", async () => {
  await api("POST", "/api/start", {});
  showDashboard();
  fetchState();
});

els.launchAll.addEventListener("click", async () => {
  if (!lastState) return;
  for (const key of Object.keys(lastState.services)) {
    await doOpenExport(key);
  }
});

els.cards.addEventListener("input", (ev) => {
  const assignInput = ev.target.closest('input[data-role="assign-path"]');
  if (assignInput) {
    assignPathValues.set(assignInput.dataset.key, assignInput.value);
    return;
  }
  const confirmInput = ev.target.closest('input[data-role="erasure-confirm"]');
  if (confirmInput) {
    const key = confirmInput.dataset.key;
    erasureConfirmValues.set(key, confirmInput.value);
    // Toggle the Send button live rather than waiting for the next 3s
    // poll — the typed-confirmation gate should feel immediate.
    const btn = els.cards.querySelector(
      `button[data-action="erasure_send"][data-key="${key}"]`
    );
    if (btn) btn.disabled = confirmInput.value !== key;
  }
});

els.profileSave.addEventListener("click", doSaveProfile);

// Re-render cards immediately as the profile is edited, so the
// erasure-zone lock message (or its removal) reflects the current
// typed name/email without waiting for the next 3s poll.
[els.profileName, els.profileEmail].forEach((input) => {
  input.addEventListener("input", () => {
    if (lastState) renderCards(lastState);
  });
});

els.cards.addEventListener("click", async (ev) => {
  const btn = ev.target.closest("button[data-action]");
  if (!btn) return;
  const key = btn.dataset.key;
  const action = btn.dataset.action;

  if (action === "open_export") return doOpenExport(key);
  if (action === "show_prompt") return doShowPrompt(key);
  if (action === "mark_downloaded") return doMark(key, "downloaded");
  if (action === "verify") return doVerify(key);
  if (action === "reset") return doReset(key);
  if (action === "erasure_send") return doErasureSend(key);
  if (action === "mark_sent") return doMarkSent(key);
  if (action === "skip") {
    const svc = lastState.services[key];
    return doSkip(key, !svc.skipped);
  }
  if (action === "assign_file") {
    const input = els.cards.querySelector(
      `input[data-role="assign-path"][data-key="${key}"]`
    );
    return doAssignFile(key, input ? input.value.trim() : "");
  }
});

els.modalClose.addEventListener("click", () => {
  els.modal.hidden = true;
});

els.aboutLink.addEventListener("click", doShowExplainer);

els.explainerModalClose.addEventListener("click", () => {
  els.explainerModal.hidden = true;
});

els.explainerModalCopy.addEventListener("click", async () => {
  const text = els.explainerModalText.textContent;
  try {
    await navigator.clipboard.writeText(text);
    els.explainerModalCopy.textContent = "Copied!";
    setTimeout(() => (els.explainerModalCopy.textContent = "Copy"), 1200);
  } catch (e) {
    // Clipboard API unavailable (e.g. insecure context) — nothing more to do.
  }
});

els.modalCopy.addEventListener("click", async () => {
  const text = els.modal.dataset.promptText || els.modalText.textContent;
  try {
    await navigator.clipboard.writeText(text);
    els.modalCopy.textContent = "Copied!";
    setTimeout(() => (els.modalCopy.textContent = "Copy"), 1200);
  } catch (e) {
    // Clipboard API unavailable (e.g. insecure context) — the server
    // already attempted a pbcopy on open_export; nothing more to do.
  }
});

startPolling();
