# Kitchen 22 Surveys (Cloudflare Worker)

One Worker for **every** customer survey. Responses live in a SQLite-backed
Durable Object (no KV/D1 ids to create). No names, no IPs: the only per-person
data is a one-way hash of IP + day + survey used for the daily limit, and it
rotates every day.

## Deploy (once)

```bash
cd surveys-worker
npm install
npx wrangler login                    # same Cloudflare account as kitchen22-api
npx wrangler secret put EXPORT_KEY    # type a NEW long random string (20+ chars) — it unlocks the CSV
npx wrangler deploy                   # prints https://kitchen22-surveys.<you>.workers.dev
```

The survey page (`encuesta/index.html`) already points at
`https://kitchen22-surveys.mariodiaz25.workers.dev/api/surveys/menu-2026-10`.
If `wrangler deploy` prints a different address, change `ENDPOINT` in that page.

## Read the answers

```
CSV:      https://kitchen22-surveys.<you>.workers.dev/api/surveys/menu-2026-10/export.csv?key=<EXPORT_KEY>
Summary:  https://kitchen22-surveys.<you>.workers.dev/api/surveys/menu-2026-10/summary?key=<EXPORT_KEY>
```

Keep that link private (it contains the key). The CSV opens in Excel / Sheets.

## Add a new survey

1. Add an entry to `src/surveys.js` (id, fields: `text` · `choice` · `multi`).
2. `npx wrangler deploy`.
3. Build the page with `ENDPOINT = .../api/surveys/<new-id>`; QR with `?src=qr`.

## Test locally

```bash
printf 'EXPORT_KEY=test-export-key-123456\n' > .dev.vars   # git-ignored
npx wrangler dev --local --port 8788
node test/smoke.mjs                                          # 17 checks
```

## Limits worth knowing

- 30 submissions per person per survey per day (`DAILY_LIMIT`), then 429.
- Only the origins in `ALLOWED_ORIGINS` can submit from a browser.
- Text answers are capped (600 / 300 chars); CSV cells starting with `= + - @` are
  prefixed with `'` so spreadsheets don't run them as formulas.
