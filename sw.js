/* Sobremesa · service worker */
const VERSION = "sobremesa-v3";
const SHELL = [
  "./",
  "index.html",
  "css/style.css",
  "js/app.js",
  "js/data/b1.js",
  "js/data/b2.js",
  "js/data/c1.js",
  "js/data/c2.js",
  "manifest.webmanifest",
  "icons/favicon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
];

importScripts("js/data/b1.js", "js/data/b2.js", "js/data/c1.js", "js/data/c2.js");

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION && k !== "sobremesa-state").map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;

  // Fonter: cache først, hent ved behov
  if (url.hostname.includes("fonts.g")) {
    e.respondWith(
      caches.open("sobremesa-fonts").then(async (c) => {
        const hit = await c.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok || res.type === "opaque") c.put(e.request, res.clone());
        return res;
      })
    );
    return;
  }

  // App-skall: server fra cache, oppdater i bakgrunnen (stale-while-revalidate)
  if (url.origin === location.origin) {
    e.respondWith(
      caches.open(VERSION).then(async (c) => {
        const hit = await c.match(e.request);
        const refresh = fetch(e.request)
          .then((res) => {
            if (res.ok) c.put(e.request, res.clone());
            return res;
          })
          .catch(() => hit);
        return hit || refresh;
      })
    );
  }
});

/* ── Daglig varsel via Periodic Background Sync (Android/Chrome) ── */

function todayStr(d) {
  const x = d || new Date();
  return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

async function maybeNotify() {
  try {
    const cache = await caches.open("sobremesa-state");
    const res = await cache.match("/__state");
    if (!res) return;
    const st = await res.json();
    if (!st.notif || !st.notif.on) return;
    if (st.notifiedDate === todayStr()) return;

    const weekday = (new Date().getDay() + 6) % 7; // 0 = mandag
    if (!st.notif.days.includes(weekday)) return;

    const [hh, mm] = st.notif.time.split(":").map(Number);
    const due = new Date();
    due.setHours(hh, mm, 0, 0);
    if (Date.now() < due.getTime()) return;

    const deck = (self.DECKS || {})[st.level] || [];
    if (!deck.length) return;
    const card = deck[hashStr(todayStr() + "·" + st.level) % deck.length];

    await self.registration.showNotification("☕ Dagens spanskkort er klart", {
      body: card.q,
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      tag: "sobremesa-daily",
      data: { url: "./#daily" },
    });

    st.notifiedDate = todayStr();
    await cache.put("/__state", new Response(JSON.stringify(st), { headers: { "Content-Type": "application/json" } }));
  } catch (e) { /* ignorer */ }
}

self.addEventListener("periodicsync", (e) => {
  if (e.tag === "sobremesa-daily") e.waitUntil(maybeNotify());
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) { c.navigate(url); return c.focus(); }
      }
      return clients.openWindow(url);
    })
  );
});
