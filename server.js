// server.js (ESM) – Node 18+
// ใช้กับ package.json ที่มี "type":"module"

import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const PORT = process.env.PORT || 3000;
const KEY = process.env.GAFIW_API_KEY || ""; // ใช้กับ OTP/history

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ---------- Helpers ---------- */
async function fetchText(url, opts = {}, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, ...opts });
    const text = await r.text();
    return { ok: r.ok, status: r.status, text };
  } finally {
    clearTimeout(id);
  }
}
function tryParseJSON(text) {
  try { return JSON.parse(text); } catch { return null; }
}

/* ---------- STREAM PRODUCTS (read-only) ---------- */
app.get("/api/gafiw-products", async (_req, res) => {
  try {
    const { ok, status, text } = await fetchText(
      "https://gafiwshop.xyz/api/api_product",
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
          "Accept": "application/json,text/plain,*/*",
        },
      }
    );
    const data = tryParseJSON(text);

    if (!ok) {
      return res.status(502).json({
        error: "upstream_status_" + status,
        sample: text.slice(0, 200),
      });
    }
    if (!Array.isArray(data)) {
      return res.status(502).json({
        error: "bad_format",
        sample: text.slice(0, 200),
      });
    }
    res.set("Cache-Control", "no-store");
    return res.json(data);
  } catch (e) {
    console.error("[products]", e);
    return res.status(502).json({ error: "upstream_failed" });
  }
});

/* ---------- OTP LIST ---------- */
app.get("/api/gafiw-otp", async (_req, res) => {
  try {
    if (!KEY) return res.status(500).json({ error: "missing_key" });
    const url =
      `https://gafiwshop.xyz/api/otp_product?keyapi=${encodeURIComponent(KEY)}`;

    const { ok, status, text } = await fetchText(url);
    const data = tryParseJSON(text);

    if (!ok) {
      return res.status(502).json({
        error: "upstream_status_" + status,
        sample: text.slice(0, 200),
      });
    }
    const list = Array.isArray(data) ? data : data?.data;
    if (!Array.isArray(list)) {
      return res.status(502).json({
        error: "bad_format",
        sample: text.slice(0, 200),
      });
    }
    res.set("Cache-Control", "no-store");
    return res.json(list);
  } catch (e) {
    console.error("[otp]", e);
    return res.status(502).json({ error: "upstream_failed" });
  }
});

/* ---------- OTP COUNT ---------- */
// /api/gafiw-otp-count?product=Google&location=Thailand
app.get("/api/gafiw-otp-count", async (req, res) => {
  try {
    const { product, location } = req.query;
    if (!product || !location)
      return res.status(400).json({ error: "missing_params" });

    const form = new URLSearchParams({ product, location });
    const { ok, status, text } = await fetchText(
      "https://gafiwshop.xyz/api/otp_count",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      }
    );
    const data = tryParseJSON(text);

    if (!ok) {
      return res.status(502).json({
        error: "upstream_status_" + status,
        sample: text.slice(0, 200),
      });
    }
    res.set("Cache-Control", "no-store");
    return res.json(data ?? { error: "bad_format", sample: text.slice(0, 200) });
  } catch (e) {
    console.error("[otp_count]", e);
    return res.status(502).json({ error: "upstream_failed" });
  }
});

/* ---------- HISTORY ---------- */
// /api/gafiw-history?limit=10&username_buy=abc
app.get("/api/gafiw-history", async (req, res) => {
  try {
    if (!KEY) return res.status(500).json({ error: "missing_key" });
    const qs = new URLSearchParams({ keyapi: KEY });
    if (req.query.username_buy) qs.set("username_buy", req.query.username_buy);
    if (req.query.limit) qs.set("Limit", req.query.limit);

    const url = `https://gafiwshop.xyz/api/api_history?${qs.toString()}`;
    const { ok, status, text } = await fetchText(url);
    const data = tryParseJSON(text);

    if (!ok) {
      return res.status(502).json({
        error: "upstream_status_" + status,
        sample: text.slice(0, 200),
      });
    }
    res.set("Cache-Control", "no-store");
    return res.json(Array.isArray(data) ? data : []);
  } catch (e) {
    console.error("[history]", e);
    return res.status(502).json({ error: "upstream_failed" });
  }
});

/* ---------- Health ---------- */
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

/* ---------- Static (public/) ---------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "public")));
app.get("*", (_req, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html"))
);

/* ---------- Start ---------- */
app.listen(PORT, () => {
  console.log("listening on :" + PORT);
});
