// server.js (Node 18+ / ESM)
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const app  = express();
const PORT = process.env.PORT || 3000;
const KEY  = process.env.GAFIW_API_KEY || ""; // ใช้ ENV เดียวตัวนี้

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ---------- helpers ---------- */
async function fetchText(url, opts = {}, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, ...opts });
    const text = await r.text();
    return { ok: r.ok, status: r.status, text, headers: Object.fromEntries(r.headers.entries()) };
  } finally { clearTimeout(id); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
function tryParseJSON(t){ try{ return JSON.parse(t); } catch{ return null; } }

/* ---------- headers ให้เหมือนเบราว์เซอร์ ---------- */
const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
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

/* ---------- in-memory cache ---------- */
const CACHE = { products: { data:null, ts:0 } };
const PRODUCTS_TTL = 2 * 60 * 1000; // 2 นาที

/* ---------- STREAM PRODUCTS ---------- */
// รองรับทั้งแบบ array ตรง ๆ และแบบ { ok, count, data:[...] }
async function getProductsFresh() {
  let last = null;
  for (let i=0;i<2;i++){
    const r = await fetchText("https://gafiwshop.xyz/api/api_product", { headers: BROWSER_HEADERS });
    const parsed = tryParseJSON(r.text);

    let list = null;
    if (Array.isArray(parsed)) {
      list = parsed;
    } else if (parsed && Array.isArray(parsed.data)) {
      list = parsed.data;
    }

    if (r.ok && Array.isArray(list)) {
      return { ok:true, data:list, raw:r };
    }
    last = { ...r, sample: r.text.slice(0,200) };
    await sleep(600);
  }
  return { ok:false, last };
}

app.get("/api/gafiw-products", async (req, res) => {
  try{
    const now = Date.now();
    const force = req.query.fresh === "1";
    const debug = req.query.debug === "1";

    if (!force && CACHE.products.data && now - CACHE.products.ts < PRODUCTS_TTL && !debug){
      res.set("X-Cache","HIT");
      return res.json(CACHE.products.data);
    }

    const result = await getProductsFresh();

    if (debug){
      if (result.ok){
        return res.json({
          debug:true, status: result.raw.status,
          count: result.data.length, headers: result.raw.headers
        });
      } else {
        return res.status(502).json({ debug:true, error:"upstream_failed", ...result.last });
      }
    }

    if (result.ok){
      CACHE.products = { data: result.data, ts: now };
      res.set("Cache-Control","no-store");
      res.set("X-Cache","MISS");
      return res.json(result.data);
    }
    if (CACHE.products.data){
      res.set("X-Cache","STALE");
      return res.json(CACHE.products.data);
    }
    return res.status(502).json({
      error:"upstream_failed",
      status: result.last?.status || 0,
      sample: (result.last?.sample || "").slice(0,200)
    });
  }catch(e){
    console.error("[products]", e);
    return res.status(502).json({ error:"server_error" });
  }
});

/* ---------- OTP LIST ---------- */
app.get("/api/gafiw-otp", async (_req, res) => {
  try{
    if(!KEY) return res.status(500).json({ error:"missing_key" });
    const url = `https://gafiwshop.xyz/api/otp_product?keyapi=${encodeURIComponent(KEY)}`;
    const r = await fetchText(url, { headers: BROWSER_HEADERS });
    const data = tryParseJSON(r.text);
    const list = Array.isArray(data) ? data : data?.data;
    if(!r.ok || !Array.isArray(list))
      return res.status(502).json({ error:"otp_upstream", status:r.status, sample:r.text.slice(0,200) });
    res.set("Cache-Control","no-store");
    return res.json(list);
  }catch(e){
    console.error("[otp]", e);
    return res.status(502).json({ error:"upstream_failed" });
  }
});

/* ---------- OTP COUNT ---------- */
// /api/gafiw-otp-count?product=Google&location=Thailand
app.get("/api/gafiw-otp-count", async (req, res) => {
  try{
    const { product, location } = req.query;
    if(!product || !location) return res.status(400).json({ error:"missing_params" });
    const form = new URLSearchParams({ product, location });
    const r = await fetchText("https://gafiwshop.xyz/api/otp_count", {
      method:"POST",
      headers:{ ...BROWSER_HEADERS, "Content-Type":"application/x-www-form-urlencoded" },
      body: form.toString()
    });
    const data = tryParseJSON(r.text);
    if(!r.ok || !data)
      return res.status(502).json({ error:"otp_count_upstream", status:r.status, sample:r.text.slice(0,200) });
    res.set("Cache-Control","no-store");
    return res.json(data);
  }catch(e){
    console.error("[otp_count]", e);
    return res.status(502).json({ error:"upstream_failed" });
  }
});

/* ---------- HISTORY ---------- */
// /api/gafiw-history?limit=10&username_buy=abc
app.get("/api/gafiw-history", async (req, res) => {
  try{
    if(!KEY) return res.status(500).json({ error:"missing_key" });
    const qs = new URLSearchParams({ keyapi: KEY });
    if (req.query.username_buy) qs.set("username_buy", req.query.username_buy);
    if (req.query.limit)       qs.set("Limit", req.query.limit);
    const url = `https://gafiwshop.xyz/api/api_history?${qs.toString()}`;
    const r = await fetchText(url, { headers: BROWSER_HEADERS });
    const data = tryParseJSON(r.text);
    if(!r.ok) return res.status(502).json({ error:`history_upstream_${r.status}`, sample:r.text.slice(0,200) });
    return res.json(Array.isArray(data) ? data : []);
  }catch(e){
    console.error("[history]", e);
    return res.status(502).json({ error:"upstream_failed" });
  }
});

/* ---------- health ---------- */
app.get("/api/health", (_req,res)=> res.json({ ok:true, time:new Date().toISOString() }));

/* ---------- static (public/) ---------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (_req,res)=> res.sendFile(path.join(__dirname,"public","index.html")));

/* ---------- start ---------- */
app.listen(PORT, () => console.log("listening on :"+PORT));
