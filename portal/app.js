
function go(page) {
  window.location.href = page;
}

// If the frontend is hosted separately from the backend (e.g. this portal
// on GitHub Pages, API on its own host), set this to the backend's full
// URL, e.g. "https://api.lumoads.co.za". Leave "" when both are served by
// the same server/server.js process (the default in this package).
const API_BASE = "";

// ---------------------------------------------------------------------
// LuMo.session -- carries the MikroTik-provided values (mac, ip,
// link-login-only, link-orig) and our own leadId/grantToken across the
// register -> consent -> ad -> connected flow via sessionStorage, since
// each step is a full page navigation.
// ---------------------------------------------------------------------
const LuMo = {
  KEY: "lumoSession",

  load() {
    try {
      return JSON.parse(sessionStorage.getItem(this.KEY)) || {};
    } catch (e) {
      return {};
    }
  },

  save(partial) {
    const current = this.load();
    const merged = Object.assign(current, partial);
    sessionStorage.setItem(this.KEY, JSON.stringify(merged));
    return merged;
  },

  // Called once, on index.html, to capture what the router passed us.
  captureFromQueryString() {
    const params = new URLSearchParams(window.location.search);
    const fromRouter = {};
    ["mac", "ip", "link-login-only", "link-orig", "error"].forEach((key) => {
      const val = params.get(key);
      if (val) fromRouter[key] = val;
    });
    if (Object.keys(fromRouter).length) {
      this.save({ router: fromRouter });
    }
    return this.load();
  },
};

document.addEventListener("DOMContentLoaded", () => {
  // Capture MikroTik's query-string variables (mac, ip, link-login-only...)
  // the moment they show up -- in practice that's index.html, since that's
  // where router/login.html redirects the client to, but this is a no-op
  // if the query string is empty so it's safe to call on every page.
  LuMo.captureFromQueryString();

  // --- 02-register.html ---------------------------------------------
  const form = document.querySelector("[data-register-form]");
  if (form) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const required = [...form.querySelectorAll("[required]")];
      const ok = required.every(el => el.type === "checkbox" ? el.checked : el.value.trim());
      if (!ok) {
        alert("Please complete the required fields.");
        return;
      }

      const session = LuMo.load();
      const submitBtn = form.querySelector("button[type=submit]");
      if (submitBtn) submitBtn.disabled = true;

      try {
        const res = await fetch(API_BASE + "/api/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name.value.trim(),
            phone: form.phone.value.trim(),
            email: form.email.value.trim(),
            idNumber: form.id.value.trim(),
            mac: session.router && session.router.mac,
            ip: session.router && session.router.ip,
          }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "register_failed");
        LuMo.save({ leadId: data.leadId });
        go("03-consent.html");
      } catch (err) {
        alert("Something went wrong saving your details. Please try again.");
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  // --- 03-consent.html -------------------------------------------------
  const consent = document.querySelector("[data-consent-form]");
  if (consent) {
    consent.addEventListener("submit", async (event) => {
      event.preventDefault();
      const boxes = [...consent.querySelectorAll('input[type="checkbox"]')];
      const requiredOk = boxes.filter(b => b.required).every(b => b.checked);
      if (!requiredOk) {
        alert("Please accept the required Wi-Fi service consent.");
        return;
      }

      const session = LuMo.load();
      if (!session.leadId) {
        // Shouldn't normally happen -- registration step was skipped.
        go("02-register.html");
        return;
      }

      try {
        await fetch(API_BASE + "/api/consent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            leadId: session.leadId,
            serviceConsent: boxes[0] ? boxes[0].checked : false,
            measurementConsent: boxes[1] ? boxes[1].checked : false,
            marketingConsent: boxes[2] ? boxes[2].checked : false,
          }),
        });
      } catch (err) {
        // Non-fatal for the demo: still let them watch the ad.
        console.warn("consent save failed", err);
      }
      go("04-ad.html");
    });
  }

  // --- 04-ad.html --------------------------------------------------------
  const countdown = document.querySelector("[data-countdown]");
  const adProgress = document.querySelector("[data-ad-progress]");
  const video = document.querySelector("[data-ad-video]");
  if (countdown && adProgress) {
    initAdStep({ countdown, adProgress, video });
  }

  // --- 05-connected.html --------------------------------------------------
  const connectPanel = document.querySelector("[data-connect-panel]");
  if (connectPanel) {
    initConnectStep(connectPanel);
  }
});

async function initAdStep({ countdown, adProgress, video }) {
  const session = LuMo.load();
  if (!session.leadId) {
    go("02-register.html");
    return;
  }

  let ad = { adId: "fallback", videoUrl: null, durationSeconds: 22 };
  try {
    const res = await fetch(API_BASE + "/api/ad/next");
    if (res.ok) ad = await res.json();
  } catch (err) {
    console.warn("could not load ad config, using timer fallback", err);
  }
  LuMo.save({ adId: ad.adId });

  async function finishAd() {
    try {
      const res = await fetch(API_BASE + "/api/ad/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: session.leadId, adId: ad.adId }),
      });
      const data = await res.json();
      if (data.ok) LuMo.save({ grantToken: data.grantToken });
    } catch (err) {
      console.warn("ad completion call failed", err);
    }
    go("05-connected.html");
  }

  if (video && ad.videoUrl) {
    video.src = ad.videoUrl;
    video.muted = true; // required for reliable autoplay; user can unmute
    video.controls = false; // no scrubbing/skipping
    video.play().catch(() => {
      /* autoplay blocked -- fall through to timer below as a backstop */
    });

    video.addEventListener("timeupdate", () => {
      const remaining = Math.max(0, Math.ceil(video.duration - video.currentTime));
      countdown.textContent = `${remaining}s remaining`;
      adProgress.style.width = `${(video.currentTime / video.duration) * 100}%`;
    });
    video.addEventListener("ended", finishAd);
    video.addEventListener("error", () => runTimerFallback(ad.durationSeconds));
  } else {
    runTimerFallback(ad.durationSeconds);
  }

  function runTimerFallback(totalSeconds) {
    let remaining = totalSeconds;
    countdown.textContent = `${remaining}s remaining`;
    const timer = setInterval(() => {
      remaining -= 1;
      countdown.textContent = `${remaining}s remaining`;
      adProgress.style.width = `${((totalSeconds - remaining) / totalSeconds) * 100}%`;
      if (remaining <= 0) {
        clearInterval(timer);
        finishAd();
      }
    }, 1000);
  }
}

function initConnectStep(panel) {
  const session = LuMo.load();

  if (!session.grantToken) {
    // No completed ad in this session -- don't show a fake "connected" state.
    go("index.html");
    return;
  }

  const router = session.router || {};
  const hasRouter = !!router["link-login-only"];

  if (!hasRouter) {
    // Local/dev testing without a real MikroTik in front of this machine.
    panel.querySelector("[data-status-note]").textContent =
      "Demo mode: no router detected, network grant step skipped.";
    return;
  }

  fetch(`${API_BASE}/api/grant/${session.grantToken}`)
    .then((res) => res.json())
    .then((grant) => {
      if (!grant.ok) throw new Error("invalid grant");
      submitHotspotLogin(router["link-login-only"], grant.username, grant.password);
    })
    .catch(() => {
      panel.querySelector("[data-status-note]").textContent =
        "We couldn't confirm your ad completion. Please use the button below.";
      showManualFallback(panel, router["link-login-only"]);
    });

  // Belt-and-braces: if the hidden-iframe login hasn't visibly succeeded
  // within a few seconds (e.g. iOS captive-network-assistant quirks),
  // reveal a manual "Finish connecting" button as a fallback.
  setTimeout(() => showManualFallback(panel, router["link-login-only"]), 4000);
}

function submitHotspotLogin(loginUrl, username, password) {
  // Submit in a hidden iframe so the router's own response (its default
  // status/redirect page) doesn't replace our branded "Connected" screen.
  let iframe = document.getElementById("lumo-hotspot-login-frame");
  if (!iframe) {
    iframe = document.createElement("iframe");
    iframe.id = "lumo-hotspot-login-frame";
    iframe.name = "lumo-hotspot-login-frame";
    iframe.style.display = "none";
    document.body.appendChild(iframe);
  }

  const form = document.createElement("form");
  form.method = "POST";
  form.action = loginUrl;
  form.target = "lumo-hotspot-login-frame";

  const userInput = document.createElement("input");
  userInput.type = "hidden";
  userInput.name = "username";
  userInput.value = username;
  form.appendChild(userInput);

  const passInput = document.createElement("input");
  passInput.type = "hidden";
  passInput.name = "password";
  passInput.value = password;
  form.appendChild(passInput);

  document.body.appendChild(form);
  form.submit();
  form.remove();
}

function showManualFallback(panel, loginUrl) {
  const existing = panel.querySelector("[data-manual-fallback]");
  if (existing || !loginUrl) return;

  const session = LuMo.load();
  const btn = document.createElement("button");
  btn.className = "btn btn-secondary";
  btn.setAttribute("data-manual-fallback", "");
  btn.textContent = "Finish connecting";
  btn.addEventListener("click", async () => {
    try {
      const res = await fetch(`${API_BASE}/api/grant/${session.grantToken}`);
      const grant = await res.json();
      if (grant.ok) {
        // Top-level submit this time -- visible navigation is fine as a
        // last resort fallback.
        const form = document.createElement("form");
        form.method = "POST";
        form.action = loginUrl;
        form.innerHTML =
          `<input type="hidden" name="username" value="${grant.username}">` +
          `<input type="hidden" name="password" value="${grant.password}">`;
        document.body.appendChild(form);
        form.submit();
      }
    } catch (err) {
      alert("Still unable to confirm your connection. Please ask staff for help.");
    }
  });
  panel.querySelector(".actions").prepend(btn);
}
