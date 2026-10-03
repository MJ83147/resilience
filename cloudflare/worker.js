/**
 * Torn API proxy on Cloudflare Workers.
 *
 * Keys live in the TORN_KEYS secret (comma-separated), never in the client.
 * The browser calls:  GET https://<worker>/?path=v2/faction/members
 * which mirrors the old Apps Script proxy, so config.js stays simple.
 *
 * Behaviour:
 *  - Only the paths the site uses are allowed (anything else is refused, so
 *    nobody can spend the key pool on arbitrary queries).
 *  - Keys are tried in a rotating order; a "Too many requests" (5), IP block
 *    (8) or disabled-key (9) response moves on to the next key.
 *  - Each allowed path is cached at the edge for CACHE_SECONDS, so repeated
 *    loads/refreshes do not spend keys.
 *
 * Deploy: see cloudflare/README.md.
 */

const ALLOWED = [
  /^v2\/faction\/basic/,
  /^v2\/faction\/balance/,
  /^v2\/faction\/members/,
  /^v2\/faction\/crimes/,
  /^v2\/faction\/attacks/,
  /^v2\/faction\/chains/,
  /^v2\/faction\/?\?selections=/,
  /^faction\/?\?selections=/,
  /^torn\/?\?selections=/,
];

const CACHE_SECONDS = 40;

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "*";
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin) });
    }
    if (request.method !== "GET") {
      return json({ error: { code: -1, error: "method not allowed" } }, 405, origin);
    }

    const url = new URL(request.url);
    const path = (url.searchParams.get("path") || "")
      .replace(/^https?:\/\/api\.torn\.com\//, "")
      .replace(/^\//, "")
      .replace(/([?&])key=[^&]*&?/g, "$1")
      .replace(/[?&]$/, "");
    if (!path) return json({ error: { code: -1, error: "no path" } }, 400, origin);

    if (!ALLOWED.some((rx) => rx.test(path))) {
      return json({ error: { code: -1, error: "path not allowed" } }, 403, origin);
    }

    // Cache by the normalized path only, never by the keyed Torn URL.
    const cache = caches.default;
    const cacheKey = new Request(url.origin + "/?path=" + encodeURIComponent(path), { method: "GET" });
    const hit = await cache.match(cacheKey);
    if (hit) {
      const body = await hit.text();
      return new Response(body, {
        headers: { "Content-Type": "application/json", "X-Proxy-Cache": "HIT", ...corsHeaders(origin) },
      });
    }

    const keys = String(env.TORN_KEYS || "").split(",").map((k) => k.trim()).filter(Boolean);
    if (!keys.length) {
      return json({ error: { code: -1, error: "no keys configured" } }, 500, origin);
    }

    const sep = path.indexOf("?") > -1 ? "&" : "?";
    const start = Math.floor(Math.random() * keys.length); // spread load across isolates
    let data = null;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[(start + i) % keys.length];
      let text;
      try {
        const r = await fetch("https://api.torn.com/" + path + sep + "key=" + encodeURIComponent(key));
        text = await r.text();
        data = JSON.parse(text);
      } catch (e) {
        continue; // transport or parse error: try the next key
      }
      // Key-level problems: try the next key. 2 incorrect key, 5 too many
      // requests, 8 IP block, 9/10/13/18 key disabled/paused/inactive.
      if (data && data.error && [2, 5, 8, 9, 10, 13, 18].includes(data.error.code)) continue;

      // Cache only clean responses (no error); store with a max-age so the
      // edge evicts it on its own.
      if (!data || !data.error) {
        const toCache = new Response(text, {
          headers: { "Content-Type": "application/json", "Cache-Control": "max-age=" + CACHE_SECONDS },
        });
        ctx.waitUntil(cache.put(cacheKey, toCache));
      }
      return new Response(text, {
        headers: { "Content-Type": "application/json", "X-Proxy-Cache": "MISS", ...corsHeaders(origin) },
      });
    }
    // Every key is rate-limited/blocked right now: hand back the last error.
    return json(data || { error: { code: -1, error: "all keys exhausted" } }, 200, origin);
  },
};
