// index.js — Cloudflare Workers (no Express)
const PRODUCTS_TTL_MS = 2 * 60 * 1000; // 2 นาที เหมือนของเดิม

// จำลอง in-memory cache (ต่อหนึ่ง isolate)
// หมายเหตุ: บน Workers อาจมีหลาย isolate ตามทราฟฟิก/region จึงไม่การันตีแชร์กันทั้งหมด
const CACHE_MEM = {
  products: { data: null, ts: 0 }
};

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  "Accept": "application/json,text/plain,*/*",
  "Accept-Language": "th-TH,th;q=0.9,en-US;q=0.8,en;q=0.7",
  "Referer": "https://gafiwshop.xyz/",
  "Origin": "https://gafiwshop.xyz",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Dest": "empty"
};

function tryParseJSON(t) {
  try { return JSON.parse(t); } catch { return null; }
}

function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  if (!headers.has("content-type")) headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function text(body, init = {}) {
  return new Response(body, init);
}

async function fetchText(url, opts = {}, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, ...opts });
    const txt = await r.text();
    // make plain object headers
    const h = {};
    r.headers.forEach((v, k) => (h[k] = v));
    return { ok: r.ok, status: r.status, text: txt, headers: h };
  } finally {
    clearTimeout(id);
  }
}

async function getProductsFresh() {
  let last = null;
  for (let i = 0; i < 2; i++) {
    const r = await fetchText("https://gafiwshop.xyz/api/api_product", { headers: BROWSER_HEADERS });
    const parsed = tryParseJSON(r.text);

    let list = null;
    if (Array.isArray(parsed)) {
      list = parsed;
    } else if (parsed && Array.isArray(parsed.data)) {
      list = parsed.data;
    }

    if (r.ok && Array.isArray(list)) {
      return { ok: true, data: list, raw: r };
    }
    last = { ...r, sample: r.text.slice(0, 200) };
    await new Promise((s) => setTimeout(s, 600));
  }
  return { ok: false, last };
}

async function handleGafiwProducts(url) {
  const force = url.searchParams.get("fresh") === "1";
  const debug = url.searchParams.get("debug") === "1";
  const now = Date.now();

  if (!force && CACHE_MEM.products.data && now - CACHE_MEM.products.ts < PRODUCTS_TTL_MS && !debug) {
    return json(CACHE_MEM.products.data, { headers: { "X-Cache": "HIT" } });
  }

  const result = await getProductsFresh();

  if (debug) {
    if (result.ok) {
      return json(
        {
          debug: true,
          status: result.raw.status,
          count: result.data.length,
          headers: result.raw.headers
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    } else {
      return json(
        { debug: true, error: "upstream_failed", ...(result.last || {}) },
        { status: 502 }
      );
    }
  }

  if (result.ok) {
    CACHE_MEM.products = { data: result.data, ts: now };
    return json(result.data, { headers: { "Cache-Control": "no-store", "X-Cache": "MISS" } });
  }
  if (CACHE_MEM.products.data) {
    return json(CACHE_MEM.products.data, { headers: { "X-Cache": "STALE" } });
  }
  return json(
    {
      error: "upstream_failed",
      status: result.last?.status || 0,
      sample: (result.last?.sample || "").slice(0, 200)
    },
    { status: 502 }
  );
}

async function handleGafiwOtp(env) {
  try {
    const KEY = env.GAFIW_API_KEY || "";
    if (!KEY) return json({ error: "missing_key" }, { status: 500 });
    const url = `https://gafiwshop.xyz/api/otp_product?keyapi=${encodeURIComponent(KEY)}`;
    const r = await fetchText(url, { headers: BROWSER_HEADERS });
    const data = tryParseJSON(r.text);
    const list = Array.isArray(data) ? data : data?.data;
    if (!r.ok || !Array.isArray(list)) {
      return json(
        { error: "otp_upstream", status: r.status, sample: r.text.slice(0, 200) },
        { status: 502 }
      );
    }
    return json(list, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return json({ error: "upstream_failed" }, { status: 502 });
  }
}

async function handleGafiwOtpCount(url) {
  try {
    const product = url.searchParams.get("product");
    const location = url.searchParams.get("location");
    if (!product || !location) return json({ error: "missing_params" }, { status: 400 });

    const body = new URLSearchParams({ product, location }).toString();

    const r = await fetchText("https://gafiwshop.xyz/api/otp_count", {
      method: "POST",
      headers: { ...BROWSER_HEADERS, "Content-Type": "application/x-www-form-urlencoded" },
      body
    });

    const data = tryParseJSON(r.text);
    if (!r.ok || !data) {
      return json(
        { error: "otp_count_upstream", status: r.status, sample: r.text.slice(0, 200) },
        { status: 502 }
      );
    }
    return json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return json({ error: "upstream_failed" }, { status: 502 });
  }
}

async function handleGafiwHistory(url, env) {
  try {
    const KEY = env.GAFIW_API_KEY || "";
    if (!KEY) return json({ error: "missing_key" }, { status: 500 });

    const qs = new URLSearchParams({ keyapi: KEY });
    const username_buy = url.searchParams.get("username_buy");
    const limit = url.searchParams.get("limit");
    if (username_buy) qs.set("username_buy", username_buy);
    if (limit) qs.set("Limit", limit);

    const upstream = `https://gafiwshop.xyz/api/api_history?${qs.toString()}`;
    const r = await fetchText(upstream, { headers: BROWSER_HEADERS });
    const data = tryParseJSON(r.text);

    if (!r.ok) {
      return json(
        { error: `history_upstream_${r.status}`, sample: r.text.slice(0, 200) },
        { status: 502 }
      );
    }
    return json(Array.isArray(data) ? data : []);
  } catch (e) {
    return json({ error: "upstream_failed" }, { status: 502 });
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;

    // Routes
    if (p === "/api/health") {
      return json({ ok: true, time: new Date().toISOString() });
    }
    if (p === "/api/gafiw-products" && request.method === "GET") {
      return handleGafiwProducts(url);
    }
    if (p === "/api/gafiw-otp" && request.method === "GET") {
      return handleGafiwOtp(env);
    }
    if (p === "/api/gafiw-otp-count" && request.method === "GET") {
      return handleGafiwOtpCount(url);
    }
    if (p === "/api/gafiw-history" && request.method === "GET") {
      return handleGafiwHistory(url, env);
    }

    // 404
    return text("Not found", { status: 404 });
  }
};
