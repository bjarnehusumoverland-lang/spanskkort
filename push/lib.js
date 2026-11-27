/* Sobremesas · push-tjenesten, selve logikken.
   Holdt fri for Cloudflare-spesifikk kode så den kan testes i Node. */

// Bare kjente push-tjenester godtas som mottaker, så tjenesten ikke
// kan brukes til å sende forespørsler til vilkårlige adresser.
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /(^|\.)push\.apple\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/,
];

const KEY = "subs";
const MAX_SUBS = 5000;
// Gratisnivået tillater 50 utgående kall per kjøring.
export const MAX_PER_RUN = 45;

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]; // 0 = mandag, som i appen

/* ── base64url ── */

export function b64u(bytes) {
  let s = "";
  const u8 = new Uint8Array(bytes);
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64uText(text) {
  return b64u(new TextEncoder().encode(text));
}

export function b64uToBytes(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ── Validering ── */

export function validEndpoint(endpoint) {
  if (typeof endpoint !== "string" || endpoint.length > 1000) return false;
  let url;
  try { url = new URL(endpoint); } catch (e) { return false; }
  return url.protocol === "https:" && PUSH_HOSTS.some((re) => re.test(url.hostname));
}

export function validTimeZone(tz) {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try { new Intl.DateTimeFormat("en-GB", { timeZone: tz }); return true; } catch (e) { return false; }
}

/* Gjør om et abonnement fra appen til det som lagres, eller null hvis det er ugyldig */
export function cleanSubscription(body) {
  if (!body || !validEndpoint(body.endpoint)) return null;
  if (typeof body.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.time)) return null;
  if (!Array.isArray(body.days) || body.days.length > 7) return null;
  if (!body.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return null;
  if (!validTimeZone(body.tz)) return null;
  const days = [...new Set(body.days)].sort((a, b) => a - b);
  return { e: body.endpoint, t: body.time, d: days, z: body.tz };
}

/* ── Tid ── */

/* Klokkeslett og ukedag (0 = mandag) i en gitt tidssone */
export function localTime(date, tz) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return { hhmm: get("hour") + ":" + get("minute"), weekday: WEEKDAYS.indexOf(get("weekday")) };
}

/* Hvilke abonnement skal ha varsel akkurat dette minuttet? */
export function dueSubscriptions(subs, date) {
  const byTz = new Map();
  const due = [];
  for (const [id, s] of Object.entries(subs)) {
    let lt = byTz.get(s.z);
    if (!lt) {
      try { lt = localTime(date, s.z); } catch (e) { lt = { hhmm: "", weekday: -1 }; }
      byTz.set(s.z, lt);
    }
    if (s.t === lt.hhmm && s.d.includes(lt.weekday)) due.push([id, s]);
  }
  return due;
}

/* ── Lagring (én nøkkel: lesing hvert minutt holder seg innenfor gratiskvoten) ── */

export async function loadSubs(env) {
  return (await env.SUBS.get(KEY, "json")) || {};
}

export async function saveSubs(env, subs) {
  await env.SUBS.put(KEY, JSON.stringify(subs));
}

export async function subId(endpoint) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return b64u(hash).slice(0, 22);
}

export async function upsertSubscription(env, record) {
  const subs = await loadSubs(env);
  const id = await subId(record.e);
  if (!(id in subs) && Object.keys(subs).length >= MAX_SUBS) return false;
  subs[id] = record;
  await saveSubs(env, subs);
  return true;
}

export async function removeSubscription(env, endpoint) {
  const subs = await loadSubs(env);
  const id = await subId(endpoint);
  if (!(id in subs)) return false;
  delete subs[id];
  await saveSubs(env, subs);
  return true;
}

/* ── Sending (VAPID, uten innhold: appen viser selv dagens varsel) ── */

const authCache = new Map();

/* Authorization-hodet push-tjenestene krever: et signert bevis på hvem som sender */
export async function vapidAuth(env, audience) {
  const now = Math.floor(Date.now() / 1000);
  const hit = authCache.get(audience);
  if (hit && hit.exp - now > 600) return hit.header;

  const jwk = JSON.parse(env.VAPID_PRIVATE_KEY);
  const key = await crypto.subtle.importKey(
    "jwk", { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d },
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);

  const exp = now + 12 * 3600;
  const unsigned =
    b64uText(JSON.stringify({ typ: "JWT", alg: "ES256" })) + "." +
    b64uText(JSON.stringify({ aud: audience, exp, sub: env.VAPID_SUBJECT || "https://sobremesas.no" }));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(unsigned));

  // Den offentlige nøkkelen utledes av den private, så de alltid hører sammen
  const pub = new Uint8Array(65);
  pub[0] = 4;
  pub.set(b64uToBytes(jwk.x), 1);
  pub.set(b64uToBytes(jwk.y), 33);

  const header = "vapid t=" + unsigned + "." + b64u(sig) + ", k=" + b64u(pub);
  authCache.set(audience, { exp, header });
  return header;
}

/* Sender ett push-signal. Returnerer HTTP-status, eller 0 ved nettverksfeil. */
export async function sendPush(env, endpoint, topic) {
  try {
    const headers = {
      TTL: "14400", // push-tjenesten holder på signalet i inntil fire timer hvis telefonen er av
      Urgency: "normal",
      Authorization: await vapidAuth(env, new URL(endpoint).origin),
    };
    if (topic) headers.Topic = topic; // et nytt signal erstatter et ulevert med samme tema
    const res = await fetch(endpoint, { method: "POST", headers });
    return res.status;
  } catch (e) {
    return 0;
  }
}

/* Kjøres hvert minutt: send til alle som har valgt akkurat dette minuttet */
export async function runSchedule(env, date) {
  const subs = await loadSubs(env);
  const due = dueSubscriptions(subs, date).slice(0, MAX_PER_RUN);
  if (!due.length) return { sent: 0, removed: 0 };

  const results = await Promise.all(
    due.map(async ([id, s]) => [id, await sendPush(env, s.e, "sobremesas-daglig")]));

  // 404/410 betyr at telefonen har meldt seg av hos push-tjenesten: rydd bort
  const gone = results.filter(([, status]) => status === 404 || status === 410).map(([id]) => id);
  if (gone.length) {
    const fresh = await loadSubs(env);
    for (const id of gone) delete fresh[id];
    await saveSubs(env, fresh);
  }
  const sent = results.filter(([, status]) => status >= 200 && status < 300).length;
  return { sent, removed: gone.length };
}

/* ── HTTP ── */

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!allowed.includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: Object.assign({ "Content-Type": "application/json" }, headers || {}),
  });
}

export async function handleRequest(request, env) {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/") {
    return json({ ok: true, tjeneste: "sobremesas-push" }, 200);
  }

  const cors = corsHeaders(request, env);
  if (request.method === "OPTIONS") {
    return cors ? new Response(null, { status: 204, headers: cors }) : new Response(null, { status: 403 });
  }
  if (request.method !== "POST") return json({ ok: false, feil: "ukjent" }, 404);
  if (!cors) return json({ ok: false, feil: "ikke tillatt opphav" }, 403);

  let body;
  try {
    const text = await request.text();
    if (text.length > 4096) return json({ ok: false, feil: "for stor" }, 413, cors);
    body = JSON.parse(text);
  } catch (e) {
    return json({ ok: false, feil: "ugyldig json" }, 400, cors);
  }

  if (url.pathname === "/subscribe") {
    const record = cleanSubscription(body);
    if (!record) return json({ ok: false, feil: "ugyldig abonnement" }, 400, cors);
    const stored = await upsertSubscription(env, record);
    return stored ? json({ ok: true }, 200, cors) : json({ ok: false, feil: "fullt" }, 503, cors);
  }

  if (url.pathname === "/unsubscribe") {
    if (!body || !validEndpoint(body.endpoint)) return json({ ok: false, feil: "ugyldig adresse" }, 400, cors);
    await removeSubscription(env, body.endpoint);
    return json({ ok: true }, 200, cors);
  }

  if (url.pathname === "/test") {
    // Push-tjenestene avviser alt som ikke er signert med vår nøkkel for
    // akkurat dette abonnementet, så adressen trenger ikke være lagret.
    if (!body || !validEndpoint(body.endpoint)) return json({ ok: false, feil: "ugyldig adresse" }, 400, cors);
    const status = await sendPush(env, body.endpoint);
    return json({ ok: status >= 200 && status < 300, status }, 200, cors);
  }

  return json({ ok: false, feil: "ukjent" }, 404, cors);
}
