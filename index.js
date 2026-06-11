// --- CORS ---
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization"
};
const withCors = (res) => {
  const h = new Headers(res.headers);
  for (const [k,v] of Object.entries(CORS)) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
};
const okJSON = (data, init={}) => withCors(new Response(JSON.stringify(data), {
  ...init,
  headers: { "content-type":"application/json; charset=utf-8", ...(init.headers||{}) }
}));
const errJSON = (data, status=500) => okJSON(data, { status });

// แฮดเดอร์พื้นฐานสำหรับคุยกับ API สินค้า
const BROWSER_HEADERS = { 
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
};

function tryParseJSON(t){ try{return JSON.parse(t);}catch{return null;} }
async function fetchText(url, opts={}, timeoutMs=20000){
  const ctrl = new AbortController(); const id = setTimeout(()=>ctrl.abort(), timeoutMs);
  try{
    const r = await fetch(url, { signal: ctrl.signal, ...opts });
    const text = await r.text(); const headers={}; r.headers.forEach((v,k)=>headers[k]=v);
    return { ok:r.ok, status:r.status, text, headers };
  } finally { clearTimeout(id); }
}

const CACHE = { products:{ data:null, ts:0 } };
const TTL = 2*60*1000;

// ดึงสินค้า + แอบแปลงลิงก์รูปให้วิ่งผ่านตัวดาวน์โหลดใน Worker ของเรา
async function handleProducts(url){
  const force = url.searchParams.get("fresh")==="1";
  const debug = url.searchParams.get("debug")==="1";
  const now = Date.now();
  if (!force && CACHE.products.data && now - CACHE.products.ts < TTL && !debug)
    return okJSON(CACHE.products.data, { headers:{ "X-Cache":"HIT" } });

  let last=null;
  for (let i=0;i<2;i++){
    const r = await fetchText("https://gafiwshop.xyz/api/api_product", { headers: BROWSER_HEADERS });
    const parsed = tryParseJSON(r.text);
    const list = Array.isArray(parsed) ? parsed : (parsed?.data||null);
    
    if (r.ok && Array.isArray(list)){
      // สแกนเจอรูปไหนที่อยู่บนเว็บ gafiwshop ให้แปลงลิงก์มาขอผ่านเซิร์ฟเวอร์เราแทน ส่วนรูป flaticon นอกเว็บปล่อยผ่านปกติ
      const proxiedList = list.map(it => {
        if (it.imageapi && it.imageapi.includes("gafiwshop.xyz")) {
          it.imageapi = `${url.origin}/api/image-proxy?url=${encodeURIComponent(it.imageapi)}`;
        }
        return it;
      });

      CACHE.products = { data:proxiedList, ts:now };
      return okJSON(proxiedList, { headers:{ "Cache-Control":"no-store", "X-Cache":"MISS" } });
    }
    last = { ...r, sample:r.text.slice(0,200) };
    await new Promise(s=>setTimeout(s,600));
  }
  if (CACHE.products.data) return okJSON(CACHE.products.data, { headers:{ "X-Cache":"STALE" } });
  return errJSON({ error:"upstream_failed", status:last?.status||0, sample:last?.sample||"" }, 502);
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }));
    }

    try {
      const url = new URL(request.url);
      const p = url.pathname;

      if (p==="/api/health" && request.method==="GET")
        return okJSON({ ok:true, time:new Date().toISOString() });

      if (p==="/api/gafiw-products" && request.method==="GET")
        return await handleProducts(url);

      // 🔥 [ห้องสอยรูปภาพ] แยกโซนทำงานชัดเจน แปลงร่างเป็นเบราว์เซอร์มนุษย์ไปสอยรูปมาให้หน้าเว็บพี่
      if (p==="/api/image-proxy" && request.method==="GET") {
        const targetUrl = url.searchParams.get("url");
        if (!targetUrl) return errJSON({ error:"missing_url" }, 400);
        try {
          const imgRes = await fetch(targetUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
              "Accept-Language": "th-TH,th;q=0.9,en;q=0.8",
              "Referer": "https://gafiwshop.xyz/" // หลอกว่าเปิดดูรูปจากในเว็บหลักเขาเอง
            }
          });
          if (!imgRes.ok) return new Response("Image Error", { status: imgRes.status });
          const contentType = imgRes.headers.get("content-type") || "image/png";
          return new Response(imgRes.body, {
            status: 200,
            headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=86400", ...CORS }
          });
        } catch(e) {
          return errJSON({ error:"proxy_failed", message: String(e) }, 500);
        }
      }

      // --- 📌 โค้ดเดิมดั้งเดิมของพี่ทุกประการ โซนนี้ปลอดภัย 100% ---
      if (p==="/api/gafiw-otp" && request.method==="GET"){
        const KEY = env.GAFIW_API_KEY || "";
        if (!KEY) return errJSON({ error:"missing_key" }, 500);
        const r = await fetchText(`https://gafiwshop.xyz/api/otp_product?keyapi=${encodeURIComponent(KEY)}`, { headers:BROWSER_HEADERS });
        const data = tryParseJSON(r.text); const list = Array.isArray(data)?data:data?.data;
        if (!r.ok || !Array.isArray(list)) return errJSON({ error:"otp_upstream", status:r.status }, 502);
        return okJSON(list, { headers:{ "Cache-Control":"no-store" } });
      }

      if (p==="/api/gafiw-otp-count" && request.method==="GET"){
        const u = new URL(request.url); const product=u.searchParams.get("product"); const location=u.searchParams.get("location");
        if (!product || !location) return errJSON({ error:"missing_params" }, 400);
        const r = await fetchText("https://gafiwshop.xyz/api/otp_count", {
          method:"POST", headers:{ ...BROWSER_HEADERS, "Content-Type":"application/x-www-form-urlencoded" },
          body: new URLSearchParams({ product, location }).toString()
        });
        const d = tryParseJSON(r.text); if(!r.ok || !d) return errJSON({ error:"otp_count_upstream", status:r.status }, 502);
        return okJSON(d, { headers:{ "Cache-Control":"no-store" } });
      }

      if (p==="/api/gafiw-history" && request.method==="GET"){
        const KEY = env.GAFIW_API_KEY || "";
        if (!KEY) return errJSON({ error:"missing_key" }, 500);
        const u = new URL(request.url); const qs = new URLSearchParams({ keyapi: KEY });
        if (u.searchParams.get("username_buy")) qs.set("username_buy", u.searchParams.get("username_buy"));
        if (u.searchParams.get("limit"))        qs.set("Limit", u.searchParams.get("limit"));
        const r = await fetchText(`https://gafiwshop.xyz/api/api_history?${qs}`, { headers:BROWSER_HEADERS });
        const data = tryParseJSON(r.text); if(!r.ok) return errJSON({ error:`history_upstream_${r.status}` }, 502);
        return okJSON(Array.isArray(data)?data:[]);
      }

      return withCors(new Response("Not found", { status:404, headers:{ "content-type":"text/plain" } }));
    } catch (e) {
      return errJSON({ error:"server_error", message: String(e?.message||e) }, 500);
    }
  }
};
