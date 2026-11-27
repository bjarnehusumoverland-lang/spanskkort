// Tester push-tjenesten lokalt, uten Cloudflare:  node push/test.mjs
//
// Lageret er i minnet, og utgående push-kall fanges opp i stedet for å sendes.

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "./worker.js";
import { b64u, b64uToBytes, cleanSubscription, dueSubscriptions, localTime, validEndpoint } from "./lib.js";

const here = dirname(fileURLToPath(import.meta.url));
const privPath = join(here, ".vapid-privat.json");

// Bruk den ekte nøkkelen hvis den finnes, ellers en engangsnøkkel
let privateJwk;
if (existsSync(privPath)) {
  privateJwk = JSON.parse(readFileSync(privPath, "utf8"));
} else {
  privateJwk = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" });
}

function makeEnv() {
  const store = new Map();
  return {
    store,
    SUBS: {
      async get(key, type) {
        const v = store.get(key);
        if (v === undefined) return null;
        return type === "json" ? JSON.parse(v) : v;
      },
      async put(key, value) { store.set(key, value); },
    },
    VAPID_PRIVATE_KEY: JSON.stringify(privateJwk),
    VAPID_SUBJECT: "https://sobremesas.no",
    ALLOWED_ORIGINS: "https://sobremesas.no,http://localhost:4173",
  };
}

// Fang opp utgående push-kall
let sent = [];
let pushStatus = 201;
globalThis.fetch = async (url, init) => {
  sent.push({ url: String(url), headers: init.headers, method: init.method, body: init.body });
  return new Response(null, { status: pushStatus });
};

const ORIGIN = "https://sobremesas.no";
const FCM = "https://fcm.googleapis.com/fcm/send/abc123";
const APPLE = "https://web.push.apple.com/QGxyz789";

function post(path, body, origin = ORIGIN) {
  return new Request("https://push.example" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function cron(env, iso) {
  const pending = [];
  await worker.scheduled({ scheduledTime: new Date(iso).getTime() }, env, { waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
}

let passed = 0;
async function test(name, fn) {
  sent = [];
  pushStatus = 201;
  try {
    await fn();
    passed++;
    console.log("  ok   " + name);
  } catch (e) {
    console.log("  FEIL " + name + "\n       " + e.message);
    process.exitCode = 1;
  }
}

console.log("Push-tjenesten");

await test("godtar bare kjente push-tjenester som mottaker", () => {
  assert.equal(validEndpoint(FCM), true);
  assert.equal(validEndpoint(APPLE), true);
  assert.equal(validEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x"), true);
  assert.equal(validEndpoint("https://evil.example/collect"), false);
  assert.equal(validEndpoint("http://fcm.googleapis.com/fcm/send/x"), false);
  assert.equal(validEndpoint("https://fcm.googleapis.com.evil.example/x"), false);
  assert.equal(validEndpoint("https://notpush.apple.com/x"), false);
});

await test("avviser ugyldig tid, dager og tidssone", () => {
  const ok = { endpoint: FCM, time: "09:00", days: [0, 1, 2], tz: "Europe/Oslo" };
  assert.deepEqual(cleanSubscription(ok), { e: FCM, t: "09:00", d: [0, 1, 2], z: "Europe/Oslo" });
  assert.equal(cleanSubscription({ ...ok, time: "9:00" }), null);
  assert.equal(cleanSubscription({ ...ok, time: "24:00" }), null);
  assert.equal(cleanSubscription({ ...ok, days: [7] }), null);
  assert.equal(cleanSubscription({ ...ok, days: "man" }), null);
  assert.equal(cleanSubscription({ ...ok, tz: "Ikke/EnSone" }), null);
  assert.deepEqual(cleanSubscription({ ...ok, days: [4, 0, 4] }).d, [0, 4]);
});

await test("regner riktig klokkeslett og ukedag, sommer og vinter", () => {
  // Mandag 30. november 2026 kl. 09:00 i Oslo er 08:00 UTC (vintertid)
  assert.deepEqual(localTime(new Date("2026-11-30T08:00:00Z"), "Europe/Oslo"), { hhmm: "09:00", weekday: 0 });
  // Onsdag 1. juli 2026 kl. 09:00 i Oslo er 07:00 UTC (sommertid)
  assert.deepEqual(localTime(new Date("2026-07-01T07:00:00Z"), "Europe/Oslo"), { hhmm: "09:00", weekday: 2 });
  // Midnatt skrives 00:00, ikke 24:00, og søndag er dag 6
  assert.deepEqual(localTime(new Date("2026-11-28T23:00:00Z"), "Europe/Oslo"), { hhmm: "00:00", weekday: 6 });
});

await test("velger bare abonnement som gjelder akkurat dette minuttet", () => {
  const subs = {
    a: { e: FCM, t: "09:00", d: [0, 1, 2, 3, 4], z: "Europe/Oslo" },
    b: { e: APPLE, t: "09:01", d: [0, 1, 2, 3, 4], z: "Europe/Oslo" },
    c: { e: FCM, t: "09:00", d: [5, 6], z: "Europe/Oslo" },
    d: { e: FCM, t: "03:00", d: [0], z: "America/New_York" },
  };
  const ids = (iso) => dueSubscriptions(subs, new Date(iso)).map(([id]) => id);
  assert.deepEqual(ids("2026-11-30T08:00:00Z"), ["a", "d"]); // mandag 09:00 Oslo = 03:00 New York
  assert.deepEqual(ids("2026-11-30T08:01:00Z"), ["b"]);
  assert.deepEqual(ids("2026-11-28T08:00:00Z"), ["c"]);      // lørdag
  assert.deepEqual(ids("2026-11-30T12:00:00Z"), []);
});

await test("påmelding lagres, og avmelding fjerner den", async () => {
  const env = makeEnv();
  let res = await worker.fetch(post("/subscribe", { endpoint: FCM, time: "09:00", days: [0], tz: "Europe/Oslo" }), env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.equal(Object.keys(JSON.parse(env.store.get("subs"))).length, 1);

  // Samme telefon med nytt tidspunkt oppdaterer, den dupliseres ikke
  await worker.fetch(post("/subscribe", { endpoint: FCM, time: "20:30", days: [5], tz: "Europe/Oslo" }), env);
  const subs = Object.values(JSON.parse(env.store.get("subs")));
  assert.equal(subs.length, 1);
  assert.equal(subs[0].t, "20:30");

  res = await worker.fetch(post("/unsubscribe", { endpoint: FCM }), env);
  assert.equal(res.status, 200);
  assert.equal(Object.keys(JSON.parse(env.store.get("subs"))).length, 0);
});

await test("avviser fremmed opphav, ugyldig innhold og for store forespørsler", async () => {
  const env = makeEnv();
  const good = { endpoint: FCM, time: "09:00", days: [0], tz: "Europe/Oslo" };
  assert.equal((await worker.fetch(post("/subscribe", good, "https://evil.example"), env)).status, 403);
  assert.equal((await worker.fetch(post("/subscribe", { ...good, endpoint: "https://evil.example/x" }), env)).status, 400);
  assert.equal((await worker.fetch(post("/subscribe", "ikke json"), env)).status, 400);
  assert.equal((await worker.fetch(post("/subscribe", "x".repeat(5000)), env)).status, 413);
  assert.equal(env.store.has("subs"), false);

  const pre = await worker.fetch(new Request("https://push.example/subscribe", { method: "OPTIONS", headers: { Origin: ORIGIN } }), env);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("Access-Control-Allow-Origin"), ORIGIN);
});

await test("sender på riktig minutt, med gyldig signatur og uten innhold", async () => {
  const env = makeEnv();
  await worker.fetch(post("/subscribe", { endpoint: FCM, time: "09:00", days: [0, 1, 2, 3, 4], tz: "Europe/Oslo" }), env);

  await cron(env, "2026-11-30T07:59:00Z");
  assert.equal(sent.length, 0, "ett minutt for tidlig");

  await cron(env, "2026-11-30T08:00:00Z");
  assert.equal(sent.length, 1, "skal sende 09:00 norsk tid");
  const req = sent[0];
  assert.equal(req.url, FCM);
  assert.equal(req.method, "POST");
  assert.equal(req.body, undefined, "ingen nyttelast");
  assert.equal(req.headers.TTL, "14400");
  assert.equal(req.headers.Topic, "sobremesas-daglig");

  // Plukk fra hverandre Authorization-hodet og verifiser signaturen
  const m = req.headers.Authorization.match(/^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/);
  assert.ok(m, "Authorization har formen vapid t=…, k=…");
  const [, h, p, s, k] = m;
  const dec = (x) => JSON.parse(new TextDecoder().decode(b64uToBytes(x)));
  assert.deepEqual(dec(h), { typ: "JWT", alg: "ES256" });
  const claims = dec(p);
  assert.equal(claims.aud, "https://fcm.googleapis.com");
  assert.equal(claims.sub, "https://sobremesas.no");
  const now = Math.floor(Date.now() / 1000);
  assert.ok(claims.exp > now && claims.exp <= now + 24 * 3600, "utløper innen 24 timer");

  const pubBytes = b64uToBytes(k);
  assert.equal(pubBytes.length, 65);
  assert.equal(pubBytes[0], 4);
  const pubKey = await crypto.subtle.importKey("raw", pubBytes, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" }, pubKey, b64uToBytes(s), new TextEncoder().encode(h + "." + p));
  assert.equal(valid, true, "signaturen lar seg verifisere med den offentlige nøkkelen");

  await cron(env, "2026-11-30T08:01:00Z");
  assert.equal(sent.length, 1, "ikke en gang til minuttet etter");
  await cron(env, "2026-11-28T08:00:00Z");
  assert.equal(sent.length, 1, "ikke på lørdag når bare hverdager er valgt");
});

await test("offentlig nøkkel i appens oppsett hører sammen med den private", async () => {
  const configPath = join(here, "..", "js", "push-config.js");
  if (!existsSync(configPath) || !existsSync(privPath)) return;
  const inConfig = readFileSync(configPath, "utf8").match(/publicKey:\s*"([\w-]+)"/)[1];
  const pub = new Uint8Array(65);
  pub[0] = 4;
  pub.set(b64uToBytes(privateJwk.x), 1);
  pub.set(b64uToBytes(privateJwk.y), 33);
  assert.equal(inConfig, b64u(pub));
});

await test("rydder bort telefoner som har meldt seg av hos push-tjenesten", async () => {
  const env = makeEnv();
  await worker.fetch(post("/subscribe", { endpoint: FCM, time: "09:00", days: [0], tz: "Europe/Oslo" }), env);
  await worker.fetch(post("/subscribe", { endpoint: APPLE, time: "10:00", days: [0], tz: "Europe/Oslo" }), env);
  pushStatus = 410;
  await cron(env, "2026-11-30T08:00:00Z");
  const left = Object.values(JSON.parse(env.store.get("subs")));
  assert.equal(left.length, 1);
  assert.equal(left[0].e, APPLE);
});

await test("midlertidig feil hos push-tjenesten fjerner ikke abonnementet", async () => {
  const env = makeEnv();
  await worker.fetch(post("/subscribe", { endpoint: FCM, time: "09:00", days: [0], tz: "Europe/Oslo" }), env);
  pushStatus = 503;
  await cron(env, "2026-11-30T08:00:00Z");
  assert.equal(Object.keys(JSON.parse(env.store.get("subs"))).length, 1);
});

await test("testvarsel sendes med en gang", async () => {
  const env = makeEnv();
  const res = await worker.fetch(post("/test", { endpoint: APPLE }), env);
  assert.deepEqual(await res.json(), { ok: true, status: 201 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, APPLE);
  assert.match(sent[0].headers.Authorization, /^vapid t=/);
  assert.equal((await worker.fetch(post("/test", { endpoint: "https://evil.example/x" }), env)).status, 400);
});

await test("svarer på helsesjekk uten å røpe noe", async () => {
  const env = makeEnv();
  await worker.fetch(post("/subscribe", { endpoint: FCM, time: "09:00", days: [0], tz: "Europe/Oslo" }), env);
  const res = await worker.fetch(new Request("https://push.example/"), env);
  assert.deepEqual(await res.json(), { ok: true, tjeneste: "sobremesas-push" });
});

console.log(process.exitCode ? "\nNoe feilet." : "\nAlle " + passed + " tester besto.");
