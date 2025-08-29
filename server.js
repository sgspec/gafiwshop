import express from "express";
import fetch from "node-fetch";

const app = express();

app.get("/api/gafiw-products", async (req, res) => {
  try {
    const r = await fetch("https://gafiwshop.xyz/api/api_product", {
      headers: { "User-Agent": "AF-Catalog/1.0" }
    });
    const data = await r.json();
    res.set("Access-Control-Allow-Origin", "*"); // เปิด CORS
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: "upstream_failed" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy API running on ${PORT}`));
