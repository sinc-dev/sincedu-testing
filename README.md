# sincedu-testing

Embeddable tester-feedback tool. Testers drop a `<script>` into any web app, click a crosshair, pick an element, type a note at the cursor, and submit — with a screenshot and recent console/network logs attached automatically.

Cloudflare-native and self-contained: **D1** (metadata) + **R2** (screenshots & log blobs), with **Supabase Google sign-in** for tester identity. Independent of any host app's auth.

## Live deployment

Deployed to the **SINCEDU** Cloudflare account (account id `9a2b6956cc47f63e13beb91af5363970`):

| Piece | URL |
|---|---|
| Review UI + `/auth` page | **https://testing.sincedu.com** (custom domain → `sincedu-testing-app` worker; also `https://sincedu-testing-app.sincedu.workers.dev`) |
| API + `widget.js` | **https://sincedu-testing-worker.sincedu.workers.dev** |

Bindings (in `worker/wrangler.jsonc`): D1 `sincedu-testing` (`ce81732e-65cc-4deb-808f-9efd7faaa668`) and R2 `sincedu-testing`. Supabase Auth uses the same SINC Daily Reports project (`wwpxpsbvqznccsignekc`). Current admins are set in `ADMIN_EMAILS`.

**Embed snippet** (production):

```html
<script src="https://sincedu-testing-worker.sincedu.workers.dev/widget.js" data-project="my-app"></script>
```

The widget's sign-in popup defaults to `https://testing.sincedu.com/auth`, so no extra config is needed once that domain is live.

## Packages

| Package | What it is |
|---|---|
| `worker/` | Hono Cloudflare Worker. API (reports, allowlist), Supabase access-token verification, D1 + R2 storage, serves `widget.js`. |
| `widget/` | The embeddable `widget.js` — vanilla TS in a Shadow DOM. Picker + screenshot + log capture + Supabase auth. |
| `app/` | `testing.sincedu.com` review UI (React + Vite). Admins see all reports; testers see their own. |

## MCP access

MCP tokens expose these tools:

- `list_reports`, `get_report`, `get_report_logs` for reports visible to the token owner.
- `get_report_audit_log` for recent report update history visible to the token owner.
- `update_report_status`, `bulk_update_report_status` for admin MCP tokens only. Valid statuses are `open`, `investigating`, `in_progress`, `fixed`, `resolved`, and `closed`.

## Identity

Tester identity comes from Supabase Auth (SINC Daily Reports project, Google provider).

Because the widget is embedded on **host domains we don't control**, sign-in does **not** run on the host page (that would require every host domain to be an auth redirect domain). Instead:

1. The widget opens a popup to **our** `/auth` page on `testing.sincedu.com` (an authorized domain).
2. That page runs the Google sign-in and `postMessage`s the Supabase access token back to the widget, scoped to the host's origin.
3. The widget sends the token to the worker with each report.

So Supabase only needs the review app callback URLs allowlisted — host app domains never touch the auth provider. The worker verifies Supabase access tokens with Supabase Auth and checks the email against the allowlist (`testers` table).

Who may embed/receive tokens is controlled by the worker's `ALLOWED_ORIGINS` (CORS) + the tester allowlist — your config, not the Supabase console. Lock `ALLOWED_ORIGINS` to known host origins in production.

## Embedding

```html
<!-- Default: floating crosshair, bottom-right -->
<script src="https://<worker-host>/widget.js" data-project="my-app"></script>

<!-- Or mount the button into your own element (e.g. app bar) -->
<div id="tf-slot"></div>
<script src="https://<worker-host>/widget.js" data-project="my-app" data-mount="#tf-slot"></script>

<!-- Or drive it from your own button via the JS API -->
<script>window.SincTester.startPicker()</script>
```

## Dev

```bash
pnpm install
pnpm -C widget run build                                   # build widget.js (also embeds it into the worker)
pnpm -C worker exec wrangler d1 execute sincedu-testing --local --file=./schema.sql
pnpm dev:worker   # worker on :8788 (D1/R2 local)
pnpm dev:widget   # widget build watch (rebuilds + re-embeds on change)
pnpm dev:app      # review UI on :5273 (proxies /api -> :8788)
```

Open `demo/index.html` (e.g. `npx serve demo`) to try the embedded widget against the local worker.

## One-time setup (Cloudflare + Supabase)

**Cloudflare** (needs `wrangler login`):

```bash
# 1. Create D1 + R2, then paste the printed database_id into worker/wrangler.jsonc
pnpm -C worker exec wrangler d1 create sincedu-testing
pnpm -C worker exec wrangler r2 bucket create sincedu-testing

# 2. Apply the schema to the remote D1
pnpm -C worker run db:schema:remote

# 3. Set production vars/secrets (admins can view all reports + manage the allowlist)
#    Edit "vars" in worker/wrangler.jsonc: ADMIN_EMAILS, ALLOWED_ORIGINS, SUPABASE_URL
#    Set SUPABASE_ANON_KEY with wrangler secret put SUPABASE_ANON_KEY

# 4. Deploy
pnpm -C widget run build && pnpm -C worker run deploy
```

**Supabase** (SINC Daily Reports project):
- Authentication → Providers → enable **Google**.
- Authentication → URL Configuration → add redirect URLs for `http://localhost:5400/`, `http://localhost:5400/auth`, `https://testing.sincedu.com/`, and `https://testing.sincedu.com/auth`.
- App build env needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- Worker env needs `SUPABASE_URL` and `SUPABASE_ANON_KEY`.

## Deploying the review UI (testing.sincedu.com)

`pnpm -C app run build` → `pnpm -C app exec wrangler deploy`. Set `VITE_API_BASE` to the worker's URL at build time if `/api` is not proxied by the review UI host.
