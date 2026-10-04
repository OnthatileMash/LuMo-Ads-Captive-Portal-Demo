Drop a real advertiser video here as `sample-ad.mp4` (H.264/MP4, ~20-25s,
ideally under ~15MB so it loads fast over a taxi-rank's upstream link).

No video is bundled with this demo package. If `sample-ad.mp4` is missing,
`04-ad.html` automatically falls back to a plain `durationSeconds`-long
timer (see `server/server.js` -> `DEMO_AD`) so the registration -> consent
-> ad -> connect flow still runs end-to-end without a real creative.

For multiple advertisers/campaigns, replace the single hard-coded `DEMO_AD`
object in `server/server.js` with a lookup (by site, time of day, or round-
robin) that returns a different `{ adId, videoUrl, durationSeconds }` per
request -- that's also where per-advertiser impression/completion counts
for the Advertiser Portal would get aggregated from `data/ad-events.jsonl`.
