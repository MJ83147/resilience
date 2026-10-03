# Torn API proxy (Cloudflare Worker)

Replaces the Apps Script Torn proxy. Keys live in a Worker secret, never in
the client. The browser calls `https://<worker>/?path=v2/faction/members`
and `tornFetch` in `config.js` points `WORKER_URL` at it.

## Deploy with the dashboard (no CLI)

1. Cloudflare dashboard → Workers & Pages → Create → Worker. Name it
   `torn-proxy`. Deploy the starter, then Edit code.
2. Paste the contents of `worker.js` over the starter. Deploy.
3. Worker → Settings → Variables and Secrets → add a **Secret** named
   `TORN_KEYS`, value = all your Torn API keys comma-separated, e.g.
   `key1,key2,key3`. Deploy again.
4. Bind your domain: Worker → Settings → Domains & Routes → Add custom
   domain (e.g. `torn-proxy.yourdomain.com`). Or just use the
   `torn-proxy.<account>.workers.dev` URL shown on the Worker page.
5. Test in a browser:
   `https://<worker-url>/?path=v2/faction/members` should return JSON.
6. In `config.js` set `WORKER_URL` to that URL and deploy the site. Then
   delete the `apiKey` line and **revoke the old key `Ai7FeouMaJd9ufVr`** in
   Torn → Settings → API Keys (it has been public in the client).

## Deploy with Wrangler (CLI)

```
cd cloudflare
npx wrangler deploy
npx wrangler secret put TORN_KEYS   # paste the comma-separated keys
```

Set your route/domain in `wrangler.toml` (commented block) or bind a custom
domain in the dashboard.

## Notes

- Allowed paths are the ones the site uses (see `ALLOWED` in `worker.js`).
  Add a pattern there if a new page needs another endpoint.
- Responses are cached at the edge for 40s (`CACHE_SECONDS`), so reloads do
  not spend keys. Error responses are never cached.
- CORS is open (`*`) for GET. To lock it to your site, replace the
  `Access-Control-Allow-Origin` value in `corsHeaders` with your origin.
