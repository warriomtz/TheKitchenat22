# Kitchen 22 API (Cloudflare Worker)

Replaces JSONBin. The admin code and the kitchen alert topic live here as
**secrets**; they never reach the browser or this repo.

## Deploy (once)

```bash
cd worker
npm install
npx wrangler login                      # opens the browser, log in to Cloudflare
npx wrangler secret put ADMIN_CODE      # type a NEW long admin code (20+ chars)
npx wrangler secret put NTFY_TOPIC      # type a NEW long random ntfy topic
npx wrangler deploy                     # prints https://kitchen22-api.<you>.workers.dev
```

Then put that URL in `js/config.js` as `apiBase`, commit and push.

## Migrate the live data

```bash
JSONBIN_BIN_ID=... JSONBIN_KEY=... node ../scripts/migrate-from-jsonbin.mjs --dry-run
JSONBIN_BIN_ID=... JSONBIN_KEY=... API=https://kitchen22-api.<you>.workers.dev \
  ADMIN_CODE=<new admin code> node ../scripts/migrate-from-jsonbin.mjs
```

Run it right before switching the domain so orders are current. When the new
site is live, revoke the old JSONBin key.

## Test locally

```bash
printf 'ADMIN_CODE=test-admin-code-123456\n' > .dev.vars   # git-ignored
npx wrangler dev --local --port 8787
node test/smoke.mjs                                          # 38 checks
```

## Limits worth knowing

- Product photo upload from the admin panel is not supported (it never worked
  on GitHub Pages either). Add photos to `assets/products/` and push.
- Wrong admin codes lock an IP for 10 minutes after 10 tries.
- Orders are capped at the newest 800 and analytics at 2500 events.
