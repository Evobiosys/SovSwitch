"use strict";

/* demo_backend.js — Sovereign Takeout DEMO backend shim.
 *
 * This is NOT part of the real app. It is loaded BEFORE app.js (see
 * index.html) and wraps window.fetch so that every relative /api/*
 * call app.js makes is answered by an in-memory simulated backend
 * instead of a real local server. Every other URL (there are none
 * left once /api/* is covered — app.js only ever calls /api/*) passes
 * through to the real fetch untouched.
 *
 * Goal: implement the real API contract faithfully — same status
 * codes, same {ok: ...} response shapes, same gate rules (erasure
 * below-verified refusal, wrong confirm token, blank-profile
 * readiness reasons, mark validation, skip/reset) — so app.js
 * (byte-identical to the source repo's sov_takeout/ui/app.js) runs
 * completely unmodified against it. See sov_takeout/server.py,
 * state.py, erasure.py, verify.py, services.py in the source repo for
 * the contract this mirrors.
 *
 * No network calls, no persistence beyond the page session. Reloading
 * the page resets the simulation.
 *
 * Exported for Node testing via `module.exports` (guarded so this
 * file still works as a plain <script> in the browser) — see the
 * `if (typeof module !== "undefined") ...` block at the bottom.
 */

const DemoBackend = (function () {
  // -- registry (mirrors sov_takeout/services.py) --------------------

  const SERVICE_KEYS = [
    "google",
    "facebook",
    "instagram",
    "x_twitter",
    "linkedin",
    "amazon",
    "spotify",
    "reddit",
  ];

  const SERVICES = {
    google: {
      key: "google",
      display_name: "Google",
      export_url: "https://takeout.google.com/",
      expected_wait: "minutes–hours",
      verify_mode: "any",
      verify_markers: ["Takeout/"],
      erasure_channel: "in_product",
      erasure_url: "https://myaccount.google.com/deleteaccountoptions",
      notes: [
        "NEVER-DELETE GUARDRAIL: keep shared Google Drive files that belong to others; do not delete intentionally published content unless separately confirmed.",
        "Google has no single account-wide erasure button: deleteaccountoptions offers per-product deletion or full account deletion as distinct choices.",
      ],
      archiveNames: ["takeout-20260721T090000Z-001.zip"],
    },
    facebook: {
      key: "facebook",
      display_name: "Facebook",
      export_url: "https://accountscenter.facebook.com/info_and_permissions/dyi",
      expected_wait: "minutes–hours",
      verify_mode: "any",
      verify_markers: ["personal_information", "your_"],
      erasure_channel: "in_product",
      erasure_url: "https://accountscenter.facebook.com/deletion_and_deactivation",
      notes: [
        "Deletion has a 30-day grace period (logging back in cancels it); full removal of posted content can take up to 90 days.",
      ],
      archiveNames: ["facebook-jakob-2026.zip"],
    },
    instagram: {
      key: "instagram",
      display_name: "Instagram",
      export_url: "https://accountscenter.instagram.com/info_and_permissions/dyi",
      expected_wait: "hours to ~2 weeks",
      verify_mode: "any",
      verify_markers: ["personal_information", "your_"],
      erasure_channel: "in_product",
      erasure_url: "https://accountscenter.instagram.com/deletion_and_deactivation",
      notes: [
        "Deletion has a 30-day grace period (region-dependent); full removal can take up to 90 days.",
      ],
      archiveNames: ["instagram-jakob-2026.zip"],
    },
    x_twitter: {
      key: "x_twitter",
      display_name: "X (Twitter)",
      export_url: "https://x.com/settings/download_your_data",
      expected_wait: "up to 24 h",
      verify_mode: "any",
      verify_markers: ["data/"],
      erasure_channel: "in_product",
      erasure_url: "https://x.com/settings/deactivate",
      notes: [
        "Deactivation starts a 30-day window; the account is permanently deleted automatically if the user does not log back in.",
        "X also runs a separate GDPR Art. 17 erasure request portal at gdpr.x.com for EU/EEA users.",
      ],
      archiveNames: ["x-jakob-2026.zip"],
    },
    linkedin: {
      key: "linkedin",
      display_name: "LinkedIn",
      export_url: "https://www.linkedin.com/mypreferences/d/download-my-data",
      expected_wait: "up to 24 h",
      verify_mode: "any",
      verify_markers: ["Connections.csv", "Profile.csv"],
      erasure_channel: "in_product",
      erasure_url: "https://www.linkedin.com/psettings/account-management",
      notes: [
        "Menu path: Me icon > Settings & Privacy > Account preferences > Account management > Close account. Password re-entry required.",
        "14-day reactivation grace period; some data is not recoverable even within it.",
      ],
      archiveNames: ["Complete_LinkedInDataExport_07-21-2026.zip"],
    },
    amazon: {
      key: "amazon",
      display_name: "Amazon",
      export_url: "https://www.amazon.de/hz/privacy-central/data-requests/preview.html",
      expected_wait: "up to 30 days",
      verify_mode: "loose",
      verify_markers: ["Your Orders", "Your_Orders"],
      erasure_channel: "in_product",
      erasure_url:
        "https://www.amazon.com/gp/help/customer/display.html?nodeId=GDK92DNLSGWTV6MP",
      notes: [
        "Archive filenames vary widely — also supports manual assignment of a downloaded file to this service.",
        "Erasure = 'Request the Closure of Your Account and the Deletion of Your Personal Information' in Privacy Central; Amazon's confirmation email/text reply is the user's action, not the agent's.",
      ],
      archiveNames: ["Your_Orders.zip"],
    },
    spotify: {
      key: "spotify",
      display_name: "Spotify",
      export_url: "https://www.spotify.com/account/privacy/",
      expected_wait: "up to 30 days",
      verify_mode: "any",
      verify_markers: ["MyData/", "Userdata.json"],
      erasure_channel: "email",
      erasure_email: "privacy@spotify.com",
      erasure_url: "https://support.spotify.com/us/article/how-can-i-close-my-spotify-account/",
      notes: [
        "Premium subscribers must cancel Premium before the close-account option appears.",
        "7-day reactivation grace period before deletion begins.",
      ],
      archiveNames: ["my_spotify_data_2026.zip"],
    },
    reddit: {
      key: "reddit",
      display_name: "Reddit",
      export_url: "https://www.reddit.com/settings/data-request",
      expected_wait: "up to 30 days",
      verify_mode: "any",
      verify_markers: ["comments.csv", "posts.csv"],
      erasure_channel: "in_product",
      erasure_url: "https://www.reddit.com/settings/delete",
      notes: [
        "Deleted accounts are not recoverable and the username cannot be reused. Already-posted content is NOT deleted — it becomes '[deleted]' but stays up.",
      ],
      archiveNames: ["export_2026-07-21.zip"],
    },
  };

  // Short representative excerpts of the real BrowserOS agent prompts
  // (full text lives in sov_takeout/prompts/takeout_<key>.md in the
  // source repo — 17 files, not reproduced here). Every entry is
  // explicitly marked "(excerpt)".
  const PROMPT_EXCERPTS = {
    google:
      "(excerpt) You are an agentic browser assistant helping the user export ALL of their Google data for their own personal archive. Never ask for, read, or type the user's password, 2FA code, or any credential — if a sign-in or verification prompt appears, stop and hand it back. Navigate to https://takeout.google.com/, wait for the product list, and select every product currently holding data.\n\n[Full prompt: sov_takeout/prompts/takeout_google.md in the source repo]",
    facebook:
      "(excerpt) You are an agentic browser assistant helping the user export ALL of their Facebook data. Never ask for, read, or type a password, 2FA code, or credential. Try https://accountscenter.facebook.com/info_and_permissions/dyi directly; if that doesn't land on “Download your information”, use the menu path instead. This is export-only — do not deactivate or delete anything.\n\n[Full prompt: sov_takeout/prompts/takeout_facebook.md in the source repo]",
    instagram:
      "(excerpt) You are an agentic browser assistant helping the user export ALL of their Instagram data. Never ask for, read, or type a password, 2FA code, or credential — hand any login/security screen back to the user. Try https://accountscenter.instagram.com/info_and_permissions/dyi directly, falling back to the Settings > Accounts Center menu path.\n\n[Full prompt: sov_takeout/prompts/takeout_instagram.md in the source repo]",
    x_twitter:
      "(excerpt) You are an agentic browser assistant helping the user export ALL of their X (Twitter) data. Never ask for, read, or type a password, 2FA code, or credential — X may ask for password re-confirmation as a normal part of the flow, but that always goes to the user. Try https://x.com/settings/download_your_data directly.\n\n[Full prompt: sov_takeout/prompts/takeout_x_twitter.md in the source repo]",
    linkedin:
      "(excerpt) You are an agentic browser assistant helping the user export ALL of their LinkedIn data. Never ask for, read, or type a password, 2FA code, or credential. Use a desktop browser window — LinkedIn's export tool is not available on mobile. Try https://www.linkedin.com/mypreferences/d/download-my-data directly.\n\n[Full prompt: sov_takeout/prompts/takeout_linkedin.md in the source repo]",
    amazon:
      "(excerpt) You are an agentic browser assistant helping the user export ALL of their Amazon data. Never ask for, read, or type a password, 2FA code, or credential. Navigate to the marketplace-appropriate Privacy Central data-request page and request your personal information; this is export-only — do not close the account.\n\n[Full prompt: sov_takeout/prompts/takeout_amazon.md in the source repo]",
    spotify:
      "(excerpt) You are an agentic browser assistant helping the user export ALL of their Spotify data. Never ask for, read, or type a password, 2FA code, or credential. Use a web browser, not the desktop/mobile app — navigate to https://www.spotify.com/account/privacy/ and find “Download your data”.\n\n[Full prompt: sov_takeout/prompts/takeout_spotify.md in the source repo]",
    reddit:
      "(excerpt) You are an agentic browser assistant helping the user export their Reddit data. Never ask for, read, or type a password, 2FA code, or credential. Navigate to https://www.reddit.com/settings/data-request — a single submit action covers the whole account, no category picker needed.\n\n[Full prompt: sov_takeout/prompts/takeout_reddit.md in the source repo]",
  };

  const EXPLAINER_EXCERPT =
    "SOVEREIGN TAKEOUT — WHAT YOU GET, WHAT IT COSTS, AND YOUR RIGHTS (excerpt, demo)\n" +
    "==========================================================================\n\n" +
    "Stage 1 (export / “takeout”): Sovereign Takeout opens each service's official " +
    "data-export page for you and copies an agent prompt to your clipboard. You stay logged " +
    "in and complete any password/2FA step yourself.\n\n" +
    "Stage 2 (erasure, optional, per service): once — and only once — a service's " +
    "export is independently verified, its card unlocks a GDPR Art. 17 (“right to " +
    "erasure”) action. There is no “erase everything” button anywhere in this " +
    "app — every erasure action is scoped to one service, confirmed by you, and " +
    "irreversible once sent.\n\n" +
    "This is a short excerpt for the demo. The full explainer (per-service detail, GDPR " +
    "Article text, sources, and the CCPA honesty note) lives at docs/explainer.txt in the " +
    "source repo and is served in full by the real local app's GET /api/explainer.";

  const GDPR_LETTER_TEMPLATE =
    "Subject: {subject}\n\n" +
    "To the Data Protection Officer / Privacy team of {service_name},\n\n" +
    'Pursuant to Art. 17(1) GDPR (General Data Protection Regulation, "right to erasure"), ' +
    "I am requesting that you erase, without undue delay, all personal data you hold " +
    "concerning me, and that you close my {service_name} account.\n\n" +
    "My account is identified by the following email address:\n{user_email}\n\n" +
    "Under Art. 12(3) GDPR, you are required to respond to this request within one month " +
    "of receipt (extendable by a further two months for complex requests, provided you " +
    "inform me of any such extension and the reasons for it within that first month).\n\n" +
    "Please send me written confirmation once this request has been completed.\n\n" +
    "Sincerely,\n{user_name}\n\nDate: {date}\n";

  // -- status machine (mirrors sov_takeout/state.py) ------------------

  const STATUSES = [
    "pending",
    "export_requested",
    "awaiting_archive",
    "downloaded",
    "verified",
    "erasure_offered",
    "erasure_confirmed",
    "erasure_sent",
  ];
  const VERIFIED_INDEX = STATUSES.indexOf("verified");

  const MARK_FORBIDDEN_STATUSES = new Set([
    "erasure_offered",
    "erasure_confirmed",
    "erasure_sent",
  ]);

  function statusIndex(status) {
    return STATUSES.indexOf(status);
  }

  function canAdvance(cur, next) {
    const curIdx = statusIndex(cur);
    const nextIdx = statusIndex(next);
    if (nextIdx <= curIdx) return false;
    if (nextIdx > VERIFIED_INDEX && curIdx < VERIFIED_INDEX) return false;
    return true;
  }

  function nowIso() {
    return new Date().toISOString().replace(/\.\d+Z$/, "+00:00");
  }

  function advanceStatus(record, newStatus) {
    if (!canAdvance(record.status, newStatus)) {
      throw new InvalidTransition(
        `cannot advance from ${JSON.stringify(record.status)} to ${JSON.stringify(newStatus)}`
      );
    }
    record.status = newStatus;
    record.history.push([nowIso(), newStatus]);
  }

  class InvalidTransition extends Error {}
  class ErasureGateError extends Error {}

  // -- verify.py replica (simulated archive metadata, not real files) --

  const MIN_TOTAL_BYTES = 10 * 1024;

  function verifyService(service, archiveFiles) {
    const loose = service.verify_mode === "loose";
    const checks = [];
    const fileCount = archiveFiles.length;
    // Simulated archive: a plausible size well above the floor.
    const totalBytes = archiveFiles.reduce((sum, f) => sum + (f.size || 0), 0);

    const check1 = fileCount > 0;
    checks.push({
      name: "archive_present",
      passed: check1,
      detail: check1 ? `${fileCount} archive(s) found` : "no archive files found",
    });

    let allMemberNames = [];
    if (loose) {
      checks.push({ name: "archives_open", passed: true, detail: "skipped (loose)" });
    } else {
      archiveFiles.forEach((f) => allMemberNames.push(...(f.members || [])));
      const check2 = check1 && archiveFiles.every((f) => f.opensCleanly !== false);
      checks.push({
        name: "archives_open",
        passed: check2,
        detail: check2 ? "all archives opened cleanly" : "no archive to open",
      });
    }

    const check3 = totalBytes >= MIN_TOTAL_BYTES;
    checks.push({
      name: "min_total_size",
      passed: check3,
      detail: `${totalBytes} bytes (need >= ${MIN_TOTAL_BYTES})`,
    });

    if (loose) {
      checks.push({ name: "verify_markers", passed: true, detail: "skipped (loose)" });
      checks.push({ name: "member_count", passed: true, detail: "skipped (loose)" });
    } else {
      const markersOk =
        allMemberNames.length > 0 &&
        service.verify_markers.some((m) => allMemberNames.some((n) => n.includes(m)));
      checks.push({
        name: "verify_markers",
        passed: markersOk,
        detail: `markers ${JSON.stringify(service.verify_markers)} (${service.verify_mode})`,
      });
      const check5 = allMemberNames.length > 0;
      checks.push({
        name: "member_count",
        passed: check5,
        detail: `${allMemberNames.length} member(s)`,
      });
    }

    const passed = checks.every((c) => c.passed);
    return { passed, checks, total_bytes: totalBytes, file_count: fileCount };
  }

  // -- erasure.py replica ----------------------------------------------

  function profileIncompleteReason(userName, userEmail) {
    if (!userName || !userName.trim()) {
      return "profile name is required before erasure can be confirmed";
    }
    if (!userEmail || !userEmail.trim() || userEmail.indexOf("@") === -1) {
      return "profile email is required (and must look like an email address) before erasure can be confirmed";
    }
    return null;
  }

  function erasureReady(record, key) {
    if (record.skipped) return [false, `${key} is marked skipped`];
    if (statusIndex(record.status) < VERIFIED_INDEX) {
      return [false, `${key} is not yet verified (status=${JSON.stringify(record.status)})`];
    }
    return [true, "ready"];
  }

  function buildNotice(service, userName, userEmail) {
    const subject = `GDPR Art. 17(1) erasure request — ${service.display_name}`;
    if (service.erasure_channel === "email") {
      const body = GDPR_LETTER_TEMPLATE.replace(/{subject}/g, subject)
        .replace(/{service_name}/g, service.display_name)
        .replace(/{user_email}/g, userEmail || "")
        .replace(/{user_name}/g, userName || "")
        .replace(/{date}/g, new Date().toISOString().slice(0, 10));
      // Mirrors erasure.py's urllib.parse.quote(..., safe="@") — the
      // "@" in the address is left unescaped, everything else is not.
      const to = encodeURIComponent(service.erasure_email).replace(/%40/g, "@");
      const query = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      return {
        channel: "email",
        subject,
        body,
        mailto_url: `mailto:${to}?${query}`,
        agent_prompt_path: `sov_takeout/prompts/erasure_${service.key}.md (source repo)`,
      };
    }
    const lines = [
      `In-product erasure checklist — ${service.display_name}`,
      "",
      `1. Go to: ${service.erasure_url}`,
      "2. Follow the account/data deletion flow shown there.",
      "3. Stop at any password/2FA re-authentication step and hand it to the user — never complete that step yourself.",
    ];
    if (service.notes && service.notes.length) {
      lines.push("", "Notes:");
      service.notes.forEach((n) => lines.push(`- ${n}`));
    }
    return {
      channel: "in_product",
      subject,
      body: lines.join("\n") + "\n",
      mailto_url: null,
      agent_prompt_path: `sov_takeout/prompts/erasure_${service.key}.md (source repo)`,
    };
  }

  // -- simulated app state ----------------------------------------------

  function freshRecord() {
    const ts = nowIso();
    return {
      status: "pending",
      archive_files: [],
      verified_report: null,
      erasure: { confirmed_at: null, sent_at: null, channel: null },
      skipped: false,
      history: [[ts, "pending"]],
    };
  }

  function createInitialState() {
    const services = {};
    SERVICE_KEYS.forEach((k) => {
      services[k] = freshRecord();
    });
    return {
      output_dir: "~/Desktop/SovereignTakeout (demo — simulated, nothing written to disk)",
      started_at: null,
      services,
      profile: { name: "", email: "" },
      _archiveMeta: {}, // key -> {size, members, opensCleanly} for the fake archive
      _timers: {}, // key -> timer handle, so reset() can cancel a pending arrival
    };
  }

  // -- route handling -----------------------------------------------------
  // Pure function: (state, method, pathname, body, query, scheduleArrival)
  // -> {status, json} | {status, text, contentType}. No fetch/Response
  // objects here so this is directly Node-testable.

  const SERVICE_ROUTE_RE =
    /^\/api\/service\/([^/]+)\/([a-zA-Z_]+)(?:\/([a-zA-Z_]+))?\/?$/;

  function serviceOr404(key) {
    return SERVICES[key] || null;
  }

  function makeFakeArchive(service) {
    const name = service.archiveNames[0];
    const members = service.verify_mode === "loose" ? [] : [name.replace(/\.zip$/, "") + "/"];
    // Guarantee every verify_marker is present among the simulated
    // member names, mirroring a real successful export.
    service.verify_markers.forEach((m) => members.push(m + "sample_data.json"));
    return {
      name,
      size: 180000 + Math.floor(Math.random() * 900000),
      members,
      opensCleanly: true,
    };
  }

  function route(state, method, pathname, body, query, scheduleArrival) {
    body = body || {};

    if (method === "GET" && pathname === "/api/state") {
      const servicesOut = {};
      SERVICE_KEYS.forEach((key) => {
        const svc = SERVICES[key];
        const record = state.services[key];
        servicesOut[key] = Object.assign({}, record, {
          erasure: Object.assign({}, record.erasure),
          history: record.history.slice(),
          archive_files: record.archive_files.slice(),
          display_name: svc.display_name,
          export_url: svc.export_url,
          expected_wait: svc.expected_wait,
          notes: svc.notes,
          erasure_channel: svc.erasure_channel,
          prompt_available: true,
        });
      });
      return {
        status: 200,
        json: {
          ok: true,
          output_dir: state.output_dir,
          started_at: state.started_at,
          services: servicesOut,
          profile: Object.assign({}, state.profile),
        },
      };
    }

    if (method === "GET" && pathname === "/api/explainer") {
      return { status: 200, text: EXPLAINER_EXCERPT, contentType: "text/plain; charset=utf-8" };
    }

    if (method === "POST" && pathname === "/api/start") {
      if (!state.started_at) state.started_at = nowIso();
      return { status: 200, json: { ok: true, started_at: state.started_at } };
    }

    if (method === "POST" && pathname === "/api/profile") {
      const name = body.name;
      const email = body.email;
      if (typeof name !== "string" || typeof email !== "string") {
        return {
          status: 400,
          json: { ok: false, error: "'name' and 'email' must be strings" },
        };
      }
      state.profile = { name, email };
      return { status: 200, json: { ok: true, profile: Object.assign({}, state.profile) } };
    }

    const m = SERVICE_ROUTE_RE.exec(pathname);
    if (!m) return { status: 404, json: { ok: false, error: "not found" } };

    const key = m[1];
    const action = m[2];
    const sub = m[3];
    const service = serviceOr404(key);
    if (!service) {
      return { status: 404, json: { ok: false, error: `unknown service: ${JSON.stringify(key)}` } };
    }
    const record = state.services[key];

    if (method === "GET" && action === "erasure" && !sub) {
      const userName = (query.user_name && query.user_name[0]) || state.profile.name;
      const userEmail = (query.user_email && query.user_email[0]) || state.profile.email;
      let [ready, reason] = erasureReady(record, key);
      if (ready) {
        const profileReason = profileIncompleteReason(userName, userEmail);
        if (profileReason) {
          ready = false;
          reason = profileReason;
        }
      }
      if (!ready) {
        return { status: 403, json: { ok: false, error: reason, ready: false, status: record.status } };
      }
      return {
        status: 200,
        json: {
          ok: true,
          ready: true,
          status: record.status,
          verified_report: record.verified_report,
          notice: buildNotice(service, userName, userEmail),
          user_name: userName,
          user_email: userEmail,
        },
      };
    }

    if (method !== "POST") return { status: 404, json: { ok: false, error: "not found" } };

    if (action === "open_export") {
      if (statusIndex(record.status) < statusIndex("export_requested")) {
        advanceStatus(record, "export_requested");
      }
      const promptText = PROMPT_EXCERPTS[key];
      if (scheduleArrival) scheduleArrival(key);
      return {
        status: 200,
        json: {
          ok: true,
          browser: "demo (simulated — no real browser was opened)",
          prompt: promptText,
          status: record.status,
        },
      };
    }

    if (action === "mark") {
      const newStatus = body.status;
      if (STATUSES.indexOf(newStatus) === -1) {
        return { status: 400, json: { ok: false, error: `invalid status: ${JSON.stringify(newStatus)}` } };
      }
      if (MARK_FORBIDDEN_STATUSES.has(newStatus) && statusIndex(record.status) >= VERIFIED_INDEX) {
        return {
          status: 403,
          json: {
            ok: false,
            error: `${JSON.stringify(newStatus)} can only be reached via the erasure endpoints, not /mark`,
          },
        };
      }
      try {
        advanceStatus(record, newStatus);
      } catch (e) {
        return { status: 400, json: { ok: false, error: e.message } };
      }
      return { status: 200, json: { ok: true, status: newStatus } };
    }

    if (action === "assign_file") {
      const path = body.path;
      if (!path) return { status: 400, json: { ok: false, error: "missing 'path'" } };
      // Demo has no real filesystem to check — accept any non-empty
      // path and simulate the archive landing under this service.
      const meta = makeFakeArchive(service);
      meta.name = String(path).split("/").pop() || meta.name;
      record.archive_files.push(meta.name);
      state._archiveMeta[key] = (state._archiveMeta[key] || []).concat([meta]);
      const dest = `${state.output_dir}/${key}/${meta.name}`;
      return { status: 200, json: { ok: true, path: dest } };
    }

    if (action === "verify") {
      const archives = state._archiveMeta[key] || [];
      const report = verifyService(service, archives);
      record.verified_report = report;
      if (report.passed && statusIndex(record.status) < statusIndex("verified")) {
        try {
          advanceStatus(record, "verified");
        } catch (e) {
          // Skipping intermediate statuses is allowed by canAdvance; a
          // throw here would mean archives arrived before export was
          // ever requested — surface as a normal failed verify instead.
        }
      }
      return { status: 200, json: { ok: true, report, status: record.status } };
    }

    if (action === "reset") {
      if (state._timers[key]) {
        clearTimeout(state._timers[key]);
        delete state._timers[key];
      }
      state.services[key] = freshRecord();
      state._archiveMeta[key] = [];
      return { status: 200, json: { ok: true } };
    }

    if (action === "skip") {
      record.skipped = body.skipped === undefined ? true : Boolean(body.skipped);
      return { status: 200, json: { ok: true, skipped: record.skipped } };
    }

    if (action === "erasure" && sub === "confirm") {
      const confirmToken = body.confirm;
      const userName = body.user_name || state.profile.name;
      const userEmail = body.user_email || state.profile.email;

      if (confirmToken !== key) {
        return {
          status: 403,
          json: { ok: false, error: `confirm token ${JSON.stringify(confirmToken)} does not match service ${JSON.stringify(key)}` },
        };
      }
      const [ready, reason] = erasureReady(record, key);
      if (!ready) {
        return { status: 403, json: { ok: false, error: `erasure not ready for ${JSON.stringify(key)}: ${reason}` } };
      }
      if (record.status !== "verified" && record.status !== "erasure_offered") {
        return {
          status: 403,
          json: {
            ok: false,
            error: `cannot confirm erasure for ${JSON.stringify(key)}: status is ${JSON.stringify(record.status)} (already confirmed/sent, or not yet offered)`,
          },
        };
      }
      const profileReason = profileIncompleteReason(userName, userEmail);
      if (profileReason) {
        return { status: 403, json: { ok: false, error: profileReason } };
      }

      const notice = buildNotice(service, userName, userEmail);
      if (record.status === "verified") advanceStatus(record, "erasure_offered");
      advanceStatus(record, "erasure_confirmed");
      record.erasure.confirmed_at = nowIso();
      record.erasure.channel = notice.channel;

      const noticePath = `${state.output_dir}/${key}/erasure_notice.txt (demo — not actually written)`;
      const clipboardText = notice.channel === "email" ? notice.body : notice.body;
      const browser =
        notice.channel === "email"
          ? "demo (simulated mailto — no real mail client was opened)"
          : "demo (simulated — no real browser was opened)";

      return {
        status: 200,
        json: {
          ok: true,
          status: record.status,
          notice,
          notice_path: noticePath,
          browser,
          clipboard_text: clipboardText,
        },
      };
    }

    if (action === "erasure" && sub === "sent") {
      if (record.status !== "erasure_confirmed") {
        return {
          status: 403,
          json: {
            ok: false,
            error: `cannot mark ${JSON.stringify(key)} sent: status is ${JSON.stringify(record.status)}, must be 'erasure_confirmed'`,
          },
        };
      }
      advanceStatus(record, "erasure_sent");
      record.erasure.sent_at = nowIso();
      return { status: 200, json: { ok: true, status: record.status } };
    }

    return { status: 404, json: { ok: false, error: "not found" } };
  }

  // -- simulated archive-arrival timeline --------------------------------
  // Real behaviour: export_requested -> (watcher notices the archive) ->
  // awaiting_archive -> downloaded -> verified. The demo compresses this
  // into one timer per service (~8-15s, varied) that fires once and runs
  // the same three-step advance + a real verify() pass.

  function arrivalDelayMs(key) {
    const idx = SERVICE_KEYS.indexOf(key);
    const base = 8000;
    const spread = 7000;
    // Deterministic-ish stagger per service plus a little jitter so
    // "Launch all" doesn't resolve all 8 cards in the same instant.
    return base + Math.floor((spread * ((idx + 1) % SERVICE_KEYS.length)) / SERVICE_KEYS.length) + Math.floor(Math.random() * 1500);
  }

  function simulateArrival(state, key) {
    const record = state.services[key];
    if (!record) return;
    // A reset (or an already-past-downloaded state) may have raced the
    // timer — never move a service backward or double-advance it.
    if (statusIndex(record.status) < statusIndex("export_requested")) return;
    if (statusIndex(record.status) >= statusIndex("downloaded")) return;

    const service = SERVICES[key];
    const meta = makeFakeArchive(service);
    record.archive_files = [meta.name];
    state._archiveMeta[key] = [meta];

    if (canAdvance(record.status, "awaiting_archive")) advanceStatus(record, "awaiting_archive");
    if (canAdvance(record.status, "downloaded")) advanceStatus(record, "downloaded");

    const report = verifyService(service, state._archiveMeta[key]);
    record.verified_report = report;
    if (report.passed && canAdvance(record.status, "verified")) {
      advanceStatus(record, "verified");
    }
  }

  return {
    SERVICE_KEYS,
    SERVICES,
    STATUSES,
    canAdvance,
    verifyService,
    profileIncompleteReason,
    erasureReady,
    buildNotice,
    createInitialState,
    route,
    simulateArrival,
    arrivalDelayMs,
    InvalidTransition,
    ErasureGateError,
  };
})();

// -- browser wiring: install the fetch shim ------------------------------

if (typeof window !== "undefined") {
  (function installFetchShim(win) {
    const realFetch = win.fetch.bind(win);
    const state = DemoBackend.createInitialState();

    function scheduleArrival(key) {
      if (state._timers[key]) clearTimeout(state._timers[key]);
      const delay = DemoBackend.arrivalDelayMs(key);
      state._timers[key] = setTimeout(() => {
        delete state._timers[key];
        DemoBackend.simulateArrival(state, key);
      }, delay);
    }

    win.fetch = function (input, init) {
      let url;
      let method = "GET";
      if (typeof input === "string") {
        url = input;
      } else if (input && typeof input.url === "string") {
        url = input.url;
        method = input.method || method;
      } else {
        url = String(input);
      }
      if (init && init.method) method = init.method;
      method = method.toUpperCase();

      let parsed;
      try {
        parsed = new URL(url, win.location.href);
      } catch (e) {
        return realFetch(input, init);
      }

      if (parsed.pathname.indexOf("/api/") !== 0) {
        return realFetch(input, init);
      }

      let bodyObj = {};
      if (init && init.body) {
        try {
          bodyObj = JSON.parse(init.body);
        } catch (e) {
          bodyObj = {};
        }
      }
      const query = {};
      parsed.searchParams.forEach((v, k) => {
        query[k] = (query[k] || []).concat([v]);
      });

      // Simulate localhost-ish latency so the UI's "opening…" /
      // "verifying…" transient status lines are visible instead of
      // resolving instantly.
      return new Promise((resolve) => {
        setTimeout(() => {
          const result = DemoBackend.route(
            state,
            method,
            parsed.pathname,
            bodyObj,
            query,
            scheduleArrival
          );
          if (result.text !== undefined) {
            resolve(
              new Response(result.text, {
                status: result.status,
                headers: { "Content-Type": result.contentType || "text/plain; charset=utf-8" },
              })
            );
          } else {
            resolve(
              new Response(JSON.stringify(result.json), {
                status: result.status,
                headers: { "Content-Type": "application/json; charset=utf-8" },
              })
            );
          }
        }, 120 + Math.random() * 180);
      });
    };
  })(window);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = DemoBackend;
}
