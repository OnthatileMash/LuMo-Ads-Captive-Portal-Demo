/**
 * LuMo Ads -- Captive Portal demo backend.
 *
 * Deliberately minimal for a "simple demonstration":
 *  - no database server, just append-only JSON-lines files on disk
 *  - grant tokens held in memory (fine for one process / one site demo)
 *  - a single hard-coded MikroTik "guest" account shared by every visitor
 *    (see router/lumo-hotspot-setup.rsc step 6 -- keep these two in sync)
 *
 * Endpoints:
 *   POST /api/register      { name, phone, email, idNumber, mac, ip }  -> { leadId }
 *   POST /api/consent       { leadId, serviceConsent, measurementConsent, marketingConsent } -> { ok }
 *   GET  /api/ad/next       -> { adId, videoUrl, durationSeconds }
 *   POST /api/ad/complete   { leadId, adId }  -> { grantToken }
 *   GET  /api/grant/:token  -> { ok, username, password }  (one-time use)
 *   GET  /api/leads         -> recent leads (unauthenticated demo stub only --
 *                               do NOT expose this without real admin auth)
 *
 * Run:
 *   cd server && npm install && npm start
 *   (serves everything on http://<this-machine-ip>:3000)
 */

const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

// --- Must match router/lumo-hotspot-setup.rsc step 6 --------------------
const GUEST_USERNAME = "guest";
const GUEST_PASSWORD = "lumoguest";
// -------------------------------------------------------------------------

const DATA_DIR = path.join(__dirname, "data");
const LEADS_FILE = path.join(DATA_DIR, "leads.jsonl");
const CONSENT_FILE = path.join(DATA_DIR, "consent.jsonl");
const AD_EVENTS_FILE = path.join(DATA_DIR, "ad-events.jsonl");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
for (const f of [LEADS_FILE, CONSENT_FILE, AD_EVENTS_FILE]) {
  if (!fs.existsSync(f)) fs.writeFileSync(f, "");
}

function appendJsonLine(file, obj) {
  fs.appendFileSync(file, JSON.stringify(obj) + "\n");
}

function readJsonLines(file, limit) {
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  const parsed = lines.map((l) => JSON.parse(l));
  return limit ? parsed.slice(-limit) : parsed;
}

// In-memory grant tokens: token -> { leadId, adId, used, createdAt }
const grants = new Map();

// Demo ad config. Point videoUrl at a real creative per advertiser/site;
// durationSeconds should match that file's actual length (20-25s per the
// brief). If /ads/sample-ad.mp4 isn't present, the frontend falls back to
// a plain timer for this many seconds so the demo still runs end-to-end.
const DEMO_AD = {
  adId: "demo-ad-001",
  videoUrl: "/ads/sample-ad.mp4",
  durationSeconds: 22,
};

app.use(express.json());

// Minimal CORS support -- only needed if the frontend is hosted separately
// from this backend (e.g. the portal on GitHub Pages, this API elsewhere).
// Restrict ALLOWED_ORIGIN to the real frontend origin before going live;
// "*" is fine for local testing.
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.static(path.join(__dirname, "..", "portal")));

// ---------------------------------------------------------------------
app.post("/api/register", (req, res) => {
  const { name, phone, email, idNumber, mac, ip } = req.body || {};
  if (!name || !phone) {
    return res.status(400).json({ ok: false, error: "name and phone are required" });
  }
  const leadId = crypto.randomUUID();
  appendJsonLine(LEADS_FILE, {
    leadId,
    name,
    phone,
    email: email || null,
    idNumber: idNumber || null,
    mac: mac || null,
    ip: ip || null,
    createdAt: new Date().toISOString(),
  });
  res.json({ ok: true, leadId });
});

app.post("/api/consent", (req, res) => {
  const { leadId, serviceConsent, measurementConsent, marketingConsent } = req.body || {};
  if (!leadId || !serviceConsent) {
    return res.status(400).json({ ok: false, error: "leadId and serviceConsent are required" });
  }
  appendJsonLine(CONSENT_FILE, {
    leadId,
    serviceConsent: !!serviceConsent,
    measurementConsent: !!measurementConsent,
    marketingConsent: !!marketingConsent,
    recordedAt: new Date().toISOString(),
  });
  res.json({ ok: true });
});

app.get("/api/ad/next", (_req, res) => {
  res.json(DEMO_AD);
});

app.post("/api/ad/complete", (req, res) => {
  const { leadId, adId } = req.body || {};
  if (!leadId || !adId) {
    return res.status(400).json({ ok: false, error: "leadId and adId are required" });
  }
  appendJsonLine(AD_EVENTS_FILE, {
    leadId,
    adId,
    completedAt: new Date().toISOString(),
  });
  const grantToken = crypto.randomUUID();
  grants.set(grantToken, { leadId, adId, used: false, createdAt: Date.now() });
  res.json({ ok: true, grantToken });
});

app.get("/api/grant/:token", (req, res) => {
  const grant = grants.get(req.params.token);
  if (!grant || grant.used) {
    return res.status(400).json({ ok: false, error: "invalid_or_used_token" });
  }
  grant.used = true;
  res.json({ ok: true, username: GUEST_USERNAME, password: GUEST_PASSWORD });
});

// Unauthenticated demo stub only -- wire this into the real Admin Portal
// with proper auth before using it for anything beyond local testing.
app.get("/api/leads", (_req, res) => {
  res.json(readJsonLines(LEADS_FILE, 100));
});

app.listen(PORT, () => {
  console.log(`LuMo captive portal demo server running on http://0.0.0.0:${PORT}`);
  console.log(`Point router/login.html's PORTAL_URL at this machine's LAN IP and this port.`);
});
