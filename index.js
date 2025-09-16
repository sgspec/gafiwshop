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

// --- utils ที่คุณมีเดิม (ย่อ) ---
const BROWSER_HEADERS = { /* ...ของเดิม... */ };
function tryParseJSON(t){ try{return JSON.parse(t);}catch{return null;} }
async function fetchText(url, opts={}, timeoutMs=20000){
  const ctrl = new AbortController(); const id = setTimeout(()=>ctrl.abort(), timeoutMs);
  try{
    const r = await fetch(url, { signal: ctrl.signal, ...opts });
    const text = await r.text(); const headers={}; r.headers.forEach((v,k)=>headers[k]=v);
    return { ok:r.ok, status:r.status, text, headers };
  } finally { clearTimeout(id); }
}

// cache เหมือนเดิม
const CACHE = { products:{ data:null, ts:0 } };
const TTL = 2*60*1000;

// handlers เหมือนเดิม (ตัดมาเฉพาะตัวอย่างหนึ่ง)
async function handleProducts(url){
  const force = url.searchParams.get("fresh")==="1";
  const debug = url.searchParams.get("debug")==="1";
  const now = Date.now();
  if (!force && CACHE.products.data && now - CACHE.products.ts < TTL && !debug)
    return okJSON(CACHE.products.data, { headers:{ "X-Cache":"HIT" } });

  // ดึง upstream 2 ครั้งเหมือนเดิม...
  let last=null;
  for (let i=0;i<2;i++){
    const r = await fetchText("https://gafiwshop.xyz/api/api_product", { headers: BROWSER_HEADERS });
    const parsed = tryParseJSON(r.text);
    const list = Array.isArray(parsed) ? parsed : (parsed?.data||null);
    if (r.ok && Array.isArray(list)){
      CACHE.products = { data:list, ts:now };
      return okJSON(list, { headers:{ "Cache-Control":"no-store", "X-Cache":"MISS" } });
    }
    last = { ...r, sample:r.text.slice(0,200) };
    await new Promise(s=>setTimeout(s,600));
  }
  if (CACHE.products.data) return okJSON(CACHE.products.data, { headers:{ "X-Cache":"STALE" } });
  return errJSON({ error:"upstream_failed", status:last?.status||0, sample:last?.sample||"" }, 502);
}

// เหลือ handlers อื่นของคุณ (OTP / COUNT / HISTORY) ใช้โค้ดเดิมได้
// เพียงเปลี่ยน return ให้เป็น okJSON(...) / errJSON(...)

export default {
  async fetch(request, env) {
    // ตอบ preflight เสมอ
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

      // 404 เสมอแถม CORS
      return withCors(new Response("Not found", { status:404, headers:{ "content-type":"text/plain" } }));
    } catch (e) {
      // กันกรณี throw แล้ว header หลุด
      return errJSON({ error:"server_error", message: String(e?.message||e) }, 500);
    }
  }
};
