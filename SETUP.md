# LuMo Ads Captive Portal ↔ MikroTik Hotspot — Demo Setup

This package wires your existing front-end prototype (`portal/`) to a real
MikroTik RB951Ui-2HnD hotspot, end to end: **join Wi-Fi → register →
consent → watch ad → get online**.

---

## 1. Analysis — what existed vs. what was missing

Your uploaded `LuMo-Ads-Captive-Portal-main.zip` was a **front-end design
prototype only** (confirmed by its own README): seven static HTML pages,
on-brand styling, and a client-side timer. It had no way to actually grant
Wi-Fi access, because four things didn't exist yet:

1. **No link to the router at all.** The pages never read the `mac`, `ip`,
   or login-submit values MikroTik passes to a captive portal — nothing
   carried them from page to page.
2. **No real network grant.** `05-connected.html` was a static "success"
   page reachable by typing its URL directly — it never submitted a login
   to the router, so it couldn't actually open the Wi-Fi session, and
   skipping straight to it bypassed registration/consent/ad entirely.
3. **No backend.** Registration and consent data were captured by nothing
   — the form just advanced to the next page in the browser.
4. **Hardcoded ad length.** The 25s countdown was fixed in `app.js`
   regardless of the actual creative, and there was no `<video>` element —
   just placeholder text.

Two things worth flagging while we're in here:

- **The registration form collects a full 13-digit SA ID number**, unvalidated,
  for a "connect to free Wi-Fi and watch an ad" flow. That's a meaningfully
  higher-risk data point to hold (identity-fraud value, special handling
  expectations under POPIA) than this use case needs. Recommend dropping it
  or replacing it with something lighter (e.g. an OTP-verified phone number,
  which also gives you a *verified* contact instead of a free-text one) —
  left as-is in this patch since it's your call, not mine to make silently.
- `styles.css` already defines `--lumo-red`/`--lumo-white`/etc. as root
  variables and the whole prototype consumes them — good, that's exactly the
  brand-system pattern from the agent instructions doc, already in place
  here.

**Update, now that we've confirmed the router's actual state and its role:**

- **The router's installed default config is RouterOS's "CAP configuration"**
  mode, not the standalone "RouterMode" the generic defconf script you
  pasted describes. CAP mode hands wireless off to CAPsMAN and puts a
  **DHCP client** (not server) on the bridge — it's built for a device
  acting as a pure Wi-Fi extension of someone else's network, with no
  router/NAT/DHCP-server role of its own.
- **You've confirmed this router should be the whole thing** at a site —
  router, DHCP, NAT, hotspot, and Wi-Fi, by itself. That's a real mismatch
  with CAP mode, so rather than fight leftover CAPsMAN bindings, the plan
  is: **reset the router again with "No Default Configuration" ticked**
  (System → Reset Configuration in Winbox) to get a genuinely blank
  router, then run the script below, which builds the whole router role
  from scratch — bridge, DHCP server, NAT, firewall, hotspot, Wi-Fi SSID —
  with nothing left over from CAP mode to conflict with it.
- **`https://onthatilemash.github.io/LuMo-Ads-Captive-Portal/` is live**,
  but it's still the original, unpatched prototype (no backend calls) —
  it's the same code your zip had, just deployed. See §2a below for what
  this means for where things actually run.

---

## 2. Plan — architecture for this demo

```
[Phone/laptop]
     │ joins "LuMo Free WiFi"
     ▼
[MikroTik RB951Ui-2HnD]
     │ unauthenticated HTTP → redirected to its own /hotspot/login.html
     │ (ROUTEROS fills in $(mac) $(ip) $(link-login-only) etc.)
     ▼
router/login.html  →  bounces to the real portal, query-string carries
                       those values along
     ▼
[LuMo portal + backend — server/]           (Node/Express, one process)
     │  index.html → 02-register → 03-consent → 04-ad → 05-connected
     │  each step calls /api/... to persist data server-side
     ▼
05-connected.html → hidden-iframe POST of username/password
                     to $(link-login-only)  →  MikroTik grants the session
```

**Key decision: one shared MikroTik "guest" login, real identity kept in
your own backend.** MikroTik's hotspot login is built around named
accounts with one active session each (or a `shared-users` limit). Creating
a unique RouterOS account per visitor is unnecessary complexity for a
public ad-gated hotspot. Instead: one hotspot account (`guest` /
`lumoguest`) with `shared-users=254` handles the actual network grant for
everyone, while your backend's `leads.jsonl` / `consent.jsonl` /
`ad-events.jsonl` are what actually identify who connected, when, and
whether they watched the ad — that's the real record, decoupled from
RouterOS. This is the standard, pragmatic pattern for ad-gated guest Wi-Fi
and is simple enough to stand up in one afternoon.

### 2a. Hosting: local vs. GitHub Pages / cloud

GitHub Pages serves **static files only** — it can't run `server/server.js`
(registration, consent, the ad-gate, or the MikroTik hand-off all need a
real server). So the live GitHub Pages site can be the *frontend*, but
something else always has to run the backend. Two honest options:

| | **A — self-contained (what's wired up by default)** | **B — GitHub Pages + separate backend** |
|---|---|---|
| Frontend | `server/` serves `portal/` itself | GitHub Pages (`onthatilemash.github.io/...`) |
| Backend | same process, same host | hosted separately (small VPS / Render / Railway / etc.) |
| Setup effort | lowest — one `npm start` | two deployments, plus CORS (already added) and `API_BASE` (already added) in `app.js` |
| Walled garden | one IP-list entry (router script §7A) | a domain entry for GitHub Pages + an IP/domain entry for wherever the API lands (router script §7B) |
| Good fit for | a single site / this demo | many taxi-rank sites sharing one central backend, with the frontend edited via the GitHub repo |

Both are fully wired in this package already — `app.js` now has an
`API_BASE` constant (empty string = same-origin, Option A; set it to your
API's URL for Option B) and `server.js` sends CORS headers so Option B
works once you point `API_BASE` at it. **Default assumption below is
Option A** since it's the lower-effort path to a working demo today; say
the word if B is actually the target and I'll help stand up the separate
API host and push the patched frontend to your repo.

**Known limitation, disclosed on purpose:** because the hotspot credential
is shared and fixed, a technically motivated person who learns it could
POST directly to the router and skip the whole flow. Fine for a demo /
first pilot site. The hardening path when you're ready for real multi-site
production is **Option B**: instead of posting a shared login, have the
backend call the RouterOS API directly after confirming ad-completion, and
add that specific device's MAC to the hotspot as a `bypassed` IP binding —
no shared secret exists anywhere a client can see it. Worth a follow-up
pass once the demo is validated; not needed to get this working today.

---

## 3. What I need from you (missing elements / open questions)

Item 2 (hardware/firmware) is answered now that you've shared the
`defconf` script — the router script in this package is built against
that real state. Still open:

1. **Where does `server/` actually run per site — Option A or B above?** Right now the config
   assumes the backend runs on a machine on the *same LAN* as the router
   (`192.168.0.5` in the scripts — change to match). Given the
   `Taxi-Rank.jpg` asset in your prototype, I'm guessing the real target is
   multiple taxi-rank sites with possibly patchy backhaul — if so, do you
   want: (a) one small local box (e.g. a Raspberry Pi) per site running
   this backend and syncing leads back centrally on a schedule, or (b) a
   single centrally-hosted backend every site's router reaches over the
   internet in real time? This materially changes the walled-garden/DNS
   setup and whether the portal needs offline tolerance.
2. **Which physical interface is "the Wi-Fi"?** I've kept `wlan1` (the
   built-in 2.4GHz radio, already part of `defconf`'s bridge) as the
   hotspot interface, along with whichever Ethernet ports `defconf` put on
   that same bridge (typically `ether2`..`ether5`) — meaning wired devices
   on those ports will also be hotspot-gated. If you'd rather keep the
   Ethernet ports as a private/trusted admin LAN separate from guest
   Wi-Fi, say so and I'll split them onto their own bridge.
3. **Should a returning device skip the ad?** Right now every session
   requires a fresh registration/consent/ad (clean, but means frequent
   flyers re-watch an ad every time they reconnect). MikroTik supports a
   "mac-cookie" that can auto-skip login for a chosen period — your
   existing `07-returning.html` page already anticipates this. Decide the
   policy (e.g. "skip the ad once per day per device") and I'll wire it in.
4. **Real ad creative.** No video file is bundled (see `portal/ads/`).
   Send a sample MP4 (or confirm the plan to serve different creatives per
   advertiser/site) and I'll wire the per-ad lookup instead of the single
   hard-coded `DEMO_AD`.
5. **ID number field** — keep, drop, or replace with OTP, per the flag
   above.

None of these block trying the demo end-to-end today — see below.

---

## 4. Implementation — run the demo

### Step 1 — Configure the router
In Winbox: **System → Reset Configuration**, tick **"No Default
Configuration"**, and reset. The router will drop off and come back at
`192.168.88.1` with nothing configured (no CAPsMAN, no bridge, no DHCP) —
reconnect Winbox there. Then open **New Terminal** and run the script in
`router/lumo-hotspot-setup.rsc` (edit the `ether1`/IP/SSID placeholders at
the top first if your setup differs from the assumptions it states). After
it runs, the router's address changes to `192.168.0.250` — reconnect
Winbox there for anything further.

### Step 2 — Replace the router's login page
In Winbox, go to **Files**, open the `hotspot` folder, and upload
`router/login.html` from this package over the existing one (edit the
`PORTAL_URL` line inside it first to match where you'll run the backend in
Step 3).

### Step 3 — Run the backend (serves the portal too)
On a machine on the same LAN as the router (e.g. `192.168.0.5`):

```bash
cd server
npm install
npm start
```

This serves the whole patched `portal/` folder *and* the API on
`http://<that machine's LAN IP>:3000`.

### Step 4 — Test
Join "LuMo Free WiFi" from a phone. You should be bounced to the LuMo
splash page, then register → consent → watch the (timer-fallback, unless
you've dropped in a real `sample-ad.mp4`) ad → land on "You're online" →
actually have internet access, because the hidden-iframe login really
authenticated you against the router.

You can also open `http://<backend-ip>:3000/api/leads` to see captured
registrations as raw JSON — a stand-in for what the real Admin Portal will
show.

---

## 5. What's in this package

```
router/
  lumo-hotspot-setup.rsc   RouterOS commands: bridge, DHCP, hotspot,
                            walled garden, shared guest account
  login.html                Router-served redirect stub (uses MikroTik's
                             $(mac)/$(ip)/$(link-login-only) variables)
portal/                     Your original prototype, patched:
  app.js                     carries router session data across pages,
                             calls the backend, drives the real ad +
                             MikroTik login hand-off
  04-ad.html                 real <video> element, dynamic duration
  05-connected.html          hidden-iframe login submit + fallback button
  ads/                       drop a real creative here (see its README)
server/
  server.js                  registration / consent / ad-gate / grant-token
                             API, serves the portal, file-based storage
  package.json
SETUP.md                     this file
```
