// SureCast Worker. Static files come from ./public; the dynamic routes are
//   GET  /surecast/api/live      ->  latest reading from the WeatherSTEM station at Atlantic Dunes Park
//   POST /surecast/api/log       ->  a friend taps "Send Log": their fishing-log entries are saved (LogStore below)
//   POST /surecast/api/log/read  ->  everyone's sent logs, only with the right code (secret LOG_READ_CODE)
// The live route exists so the WeatherSTEM API key (secret WEATHERSTEM_KEY) never appears in the page, and so
// WeatherSTEM sees at most one call every 2 minutes however many people have the page open.
// The station is fixed on purpose: this must not become an open proxy for the key.
const STATION = "fswnatlanticdunespark@palmbeach.weatherstem.com";
const CACHE_KEY = "https://occhiphoto.com/surecast/api/live";
const naive = s => Date.parse(String(s).replace(" ", "T") + "Z");   // station clock; only differences are used

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/surecast/api/log" || url.pathname === "/surecast/api/log/read") return logRoute(request, env, url.pathname.endsWith("/read"));
    if (url.pathname !== "/surecast/api/live") return env.ASSETS.fetch(request);
    const cache = caches.default, hit = await cache.match(CACHE_KEY);
    if (hit) return hit;
    const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
    try {
      const r = await fetch("https://api.weatherstem.com/api", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: env.WEATHERSTEM_KEY, stations: [STATION] }) });
      const j = await r.json(), s = Array.isArray(j) && j[0];
      if (!s || !s.record) throw new Error("no record");
      const v = {}; (s.record.readings || []).forEach(x => { v[x.sensor_type] = +x.value; });
      const num = k => Number.isFinite(v[k]) ? v[k] : null;
      const body = JSON.stringify({
        name: "Atlantic Dunes Park", lat: +s.station.lat, lon: +s.station.lon,
        t: Date.now() - Math.max(0, naive(s.record.now) - naive(s.record.time)),   // when the reading was taken, epoch ms
        mph: num("Anemometer"), gustMph: num("10 Minute Wind Gust"), dir: num("Wind Vane"),
        air: num("Thermometer"), feels: num("Heat Index"), humidity: num("Hygrometer"), rainRate: num("Rain Rate"),
        source: "WeatherSTEM / Florida Severe Weather Network" });
      const res = new Response(body, { headers: { ...headers, "Cache-Control": "public, max-age=120" } });
      ctx.waitUntil(cache.put(CACHE_KEY, res.clone()));
      return res;
    } catch (e) {
      return new Response(JSON.stringify({ error: "station unavailable" }), { status: 502, headers: { ...headers, "Cache-Control": "no-store" } });
    }
  }
};

/* ---------- shared fishing logs ----------
   Nothing is sent unless someone taps "Send Log" in the page. Each phone has a random sender id (made by the page, kept on
   that phone); entries are stored under it and merged by their timestamp, so sending twice never duplicates anything.
   Writing needs no code (the caps below keep junk bounded); reading needs LOG_READ_CODE, because entries include spots. */
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
const MAX_BODY = 600000, MAX_SENDERS = 25, MAX_ENTRIES = 2000;
const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function logRoute(request, env, reading) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return reply({ error: "POST only" }, 405);
  const text = await request.text();
  if (text.length > MAX_BODY) return reply({ error: "too big" }, 413);
  let body; try { body = JSON.parse(text); } catch (e) { return reply({ error: "bad request" }, 400); }
  if (!body || typeof body !== "object") return reply({ error: "bad request" }, 400);
  if (reading) {
    if (!env.LOG_READ_CODE || !sameText(String(body.code || "").trim().toLowerCase(), env.LOG_READ_CODE.trim().toLowerCase())) return reply({ error: "wrong code" }, 403);
  }
  const store = env.LOGS.get(env.LOGS.idFromName("logs"));
  return store.fetch("https://logs/" + (reading ? "read" : "send"), { method: "POST", body: JSON.stringify(body) });
}
function sameText(a, b) {   // compares every character, so timing does not reveal how much of the code was right
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

// Only these fields are kept, each forced to the expected type, so the store can never hold anything but log entries.
const NUM = ["t", "lt", "lat", "lon", "score", "sol", "mv", "dp", "wind", "dir", "gust", "wave", "per", "sst", "air", "p", "cloud", "rain", "moon"];
const num = v => (typeof v === "number" && Number.isFinite(v)) ? v : null;
const str = (v, n) => typeof v === "string" ? v.slice(0, n) : "";
function cleanEntry(e) {
  if (!e || typeof e !== "object" || !Number.isFinite(e.t) || e.t < 1.6e12 || e.t > Date.now() + 864e5) return null;
  const o = { kind: e.kind === "none" ? "none" : "catch", spot: str(e.spot, 60), note: str(e.note, 200), v: str(e.v, 8) };
  NUM.forEach(k => { o[k] = num(e[k]); });
  o.t = Math.round(e.t);
  o.why = Array.isArray(e.why) ? e.why.slice(0, 8).map(w => str(w, 40)) : [];
  o.tide = e.tide && typeof e.tide === "object" ? { h: num(e.tide.h), rate: num(e.tide.rate) } : null;
  o.live = e.live && typeof e.live === "object" ? { name: str(e.live.name, 40), kn: num(e.live.kn), dir: num(e.live.dir), air: num(e.live.air) } : null;
  return o;
}
const pad = t => String(t).padStart(15, "0");

export class LogStore {
  constructor(ctx) { this.storage = ctx.storage; }
  async fetch(request) {
    const body = await request.json();
    return new URL(request.url).pathname === "/read" ? this.read(body) : this.send(body);
  }
  async send(body) {
    const id = String(body.id || ""), name = str(body.name, 24).trim();
    if (!/^[a-z0-9]{16,40}$/.test(id) || !name || !Array.isArray(body.entries)) return reply({ error: "bad request" }, 400);
    const known = await this.storage.get("s:" + id);
    if (!known && (await this.storage.list({ prefix: "s:" })).size >= MAX_SENDERS) return reply({ error: "full" }, 429);
    const entries = body.entries.slice(0, MAX_ENTRIES).map(cleanEntry).filter(Boolean);
    const gone = (Array.isArray(body.gone) ? body.gone : []).filter(Number.isFinite).slice(0, MAX_ENTRIES);   // entries deleted on the phone
    const have = await this.storage.list({ prefix: "e:" + id + ":" });
    const fresh = entries.filter(e => !gone.includes(e.t));
    if (have.size + fresh.filter(e => !have.has("e:" + id + ":" + pad(e.t))).length > MAX_ENTRIES) return reply({ error: "full" }, 429);
    for (let i = 0; i < fresh.length; i += 100) {
      const chunk = {}; fresh.slice(i, i + 100).forEach(e => { chunk["e:" + id + ":" + pad(e.t)] = e; });
      await this.storage.put(chunk);
    }
    const drop = gone.map(t => "e:" + id + ":" + pad(Math.round(t))).filter(k => have.has(k));
    for (let i = 0; i < drop.length; i += 100) await this.storage.delete(drop.slice(i, i + 100));
    await this.storage.put("s:" + id, { name, updated: Date.now() });
    return reply({ ok: true, saved: (await this.storage.list({ prefix: "e:" + id + ":" })).size });
  }
  async read(body) {
    const senders = await this.storage.list({ prefix: "s:" }), out = [];
    for (const [key, s] of senders) {
      const id = key.slice(2), entries = [...(await this.storage.list({ prefix: "e:" + id + ":" })).values()];
      if (!entries.length) continue;   // someone who sent and then deleted everything
      out.push({ name: s.name, updated: s.updated, me: id === body.id, entries });   // sender ids are never returned: they are what allows writing
    }
    return reply({ anglers: out.sort((a, b) => b.updated - a.updated) });
  }
}
