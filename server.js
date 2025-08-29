// server.js  (Node 18+, "type":"module")
import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// CORS
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const KEY = process.env.GAFIW_API_KEY || ""; // <-- ตั้งใน Render

async function fetchJSON(url, init={}, timeoutMs=10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: controller.signal, headers: { "User-Agent": "AF-Catalog/1.0 (+render)", ...(init.headers||{}) }});
    if (!r.ok) throw new Error(`Upstream ${r.status} ${r.statusText}`);
    return await r.json();
  } finally { clearTimeout(id); }
}

// Health
app.get("/", (_req, res) => res.type("text/plain").send("gafiwshop proxy running"));
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ----- Streaming products (ไม่ใช้ key) -----
app.get("/api/gafiw-products", async (_req, res) => {
  try {
    const data = await fetchJSON("https://gafiwshop.xyz/api/api_product");
    res.set("Cache-Control", "public, max-age=60");
    res.json(Array.isArray(data) ? data : []);
  } catch (e) {
    console.error("[products]", e.message);
    res.status(502).json({ error: "upstream_failed" });
  }
});

// ----- OTP products (ต้องใช้ key) -----
app.get("/api/gafiw-otp", async (_req, res) => {
  try {
    if (!KEY) return res.status(500).json({ error: "missing_key" });
    const url = `https://gafiwshop.xyz/api/otp_product?keyapi=${encodeURIComponent(KEY)}`;
    const data = await fetchJSON(url);
    res.set("Cache-Control", "public, max-age=60");
    res.json(Array.isArray(data) ? data : data); // เผื่อบางวันส่งเป็น object
  } catch (e) {
    console.error("[otp products]", e.message);
    res.status(502).json({ error: "upstream_failed" });
  }
});

// ----- OTP count (ต้องใช้ product + location) -----
app.get("/api/gafiw-otp-count", async (req, res) => {
  try {
    const { product, location } = req.query;
    if (!product || !location) return res.status(400).json({ error: "missing_params", need: ["product","location"] });
    const form = new URLSearchParams({ product, location });
    const data = await fetchJSON("https://gafiwshop.xyz/api/otp_count", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString()
    });
    res.set("Cache-Control", "no-store");
    res.json(data); // {"status":"success","count":"..."}
  } catch (e) {
    console.error("[otp count]", e.message);
    res.status(502).json({ error: "upstream_failed" });
  }
});

// 404
app.use((_req, res) => res.status(404).json({ error: "not_found" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on :${PORT}`));
