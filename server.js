// server.js
// Node 18+ (ESM). อย่าลืมตั้ง "type":"module" ใน package.json
import express from "express";
import fetch from "node-fetch";

const app = express();

// --- CORS (GET/OPTIONS เท่านั้นพอสำหรับงานนี้) ---
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// --- helper: proxy fetch JSON พร้อม timeout ---
async function fetchJSON(url, { timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "AF-Catalog/1.0 (+render)" },
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      throw new Error(`Upstream ${r.status} ${r.statusText}: ${text?.slice(0,200)}`);
    }
    return await r.json();
  } finally {
    clearTimeout(id);
  }
}

// --- health / root ---
app.get("/", (_req, res) => {
  res.type("text/plain").send("gafiwshop proxy is running. Try /api/gafiw-products or /api/gafiw-otp");
});
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// --- PRODUCTS: https://gafiwshop.xyz/api/api_product ---
app.get("/api/gafiw-products", async (_req, res) => {
  try {
    const data = await fetchJSON("https://gafiwshop.xyz/api/api_product");
    res.set("Cache-Control", "public, max-age=60"); // cache เบา ๆ ที่ client 60s
    res.json(Array.isArray(data) ? data : []);
  } catch (e) {
    console.error("[products] upstream_failed:", e.message);
    res.status(502).json({ error: "upstream_failed" });
  }
});

// --- OTP: https://gafiwshop.xyz/api/otp_product ---
app.get("/api/gafiw-otp", async (_req, res) => {
  try {
    const data = await fetchJSON("https://gafiwshop.xyz/api/otp_product");
    res.set("Cache-Control", "public, max-age=60");
    res.json(Array.isArray(data) ? data : []);
  } catch (e) {
    console.error("[otp] upstream_failed:", e.message);
    res.status(502).json({ error: "upstream_failed" });
  }
});

// --- 404 fallback ---
app.use((_req, res) => res.status(404).json({ error: "not_found" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on :${PORT}`));
