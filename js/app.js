/* Sobremesas · app-logikk */
(function () {
  "use strict";

  const DECKS = self.DECKS || {};
  const LEVELS = ["B1", "B2", "C1", "C2"];
  const LEVEL_DESC = {
    B1: "Trygg i hverdagen",
    B2: "Liker en diskusjon",
    C1: "Vil utfordres",
    C2: "Leker med språket",
  };
  const DAY_LABELS = ["M", "T", "O", "T", "F", "L", "S"]; // man–søn
  const DAY_ICS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
  const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  const DIAS = ["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];

  /* ── Tilstand ── */

  const DEFAULTS = {
    onboarded: false,
    level: "B1",
    queues: {},        // per nivå: gjenstående indekser (stokket)
    current: {},       // per nivå: indeksen som vises nå
    seenCount: {},     // per nivå: antall sett totalt
    favs: [],          // ["B1-12", ...]
    streak: { count: 0, last: "" },
    notif: { on: false, time: "09:00", days: [0, 1, 2, 3, 4] }, // man–fre (0 = mandag)
    notifiedDate: "",
  };

  let state = load();
  let tab = "deck";
  let notifTimeout = null;
  let timerInterval = null;

  function load() {
    try {
      const raw = localStorage.getItem("sobremesa");
      if (!raw) return structuredClone(DEFAULTS);
      const s = JSON.parse(raw);
      return Object.assign(structuredClone(DEFAULTS), s, {
        notif: Object.assign(structuredClone(DEFAULTS.notif), s.notif || {}),
      });
    } catch (e) {
      return structuredClone(DEFAULTS);
    }
  }

  function save() {
    localStorage.setItem("sobremesa", JSON.stringify(state));
    mirrorToSW();
  }

  /* Speil innstillinger til service workeren (for bakgrunnsvarsler) */
  async function mirrorToSW() {
    if (!("caches" in self)) return;
    try {
      const cache = await caches.open("sobremesa-state");
      await cache.put(
        "/__state",
        new Response(JSON.stringify({ notif: state.notif, level: state.level, notifiedDate: state.notifiedDate }), {
          headers: { "Content-Type": "application/json" },
        })
      );
    } catch (e) { /* ignorer */ }
  }

  /* ── Hjelpere ── */

  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function todayStr(d) {
    const x = d || new Date();
    return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
  }

  /* ── Kortkø ── */

  function ensureQueue(level) {
    if (!Array.isArray(state.queues[level]) || state.queues[level].length === 0) {
      state.queues[level] = shuffle([...Array(DECKS[level].length).keys()]);
    }
  }

  function currentCard(level) {
    if (typeof state.current[level] !== "number") drawCard(level, true);
    return state.current[level];
  }

  function drawCard(level, silent) {
    ensureQueue(level);
    const wasEmpty = state.queues[level].length === 0;
    const idx = state.queues[level].shift();
    state.current[level] = idx;
    state.seenCount[level] = (state.seenCount[level] || 0) + 1;
    if (state.queues[level].length === 0 && !silent) {
      // neste trekk stokker på nytt
    }
    touchStreak();
    save();
    if (!silent && (state.seenCount[level] % DECKS[level].length === 0)) {
      toast("Dere har vært gjennom alle " + DECKS[level].length + " kortene – stokker på nytt!");
    }
    return idx;
  }

  function touchStreak() {
    const today = todayStr();
    if (state.streak.last === today) return;
    const yd = new Date();
    yd.setDate(yd.getDate() - 1);
    state.streak.count = state.streak.last === todayStr(yd) ? state.streak.count + 1 : 1;
    state.streak.last = today;
    renderStreak();
  }

  function renderStreak() {
    const el = $("#streak");
    if (state.streak.count >= 2) {
      el.hidden = false;
      el.textContent = "✶ " + state.streak.count + " dager på rad";
    } else {
      el.hidden = true;
    }
  }

  function dailyIndex(level, dateStr) {
    return hashStr(dateStr + "·" + level) % DECKS[level].length;
  }

  /* ── Kort-HTML ── */

  function cardHTML(level, idx, opts) {
    opts = opts || {};
    const c = DECKS[level][idx];
    const id = level + "-" + idx;
    const faved = state.favs.includes(id);
    const q = esc(c.q).replace(/([¿¡])/g, '<span class="inverted">$1</span>');

    return `
    <div class="stack">
      <article class="card" data-id="${id}" data-level="${level}" data-idx="${idx}">
        <div class="card-head">
          <span class="card-tema tema-${level}">${esc(c.t)}</span>
          <span class="card-num">${level} · nr. ${idx + 1}</span>
        </div>
        <h2 class="card-q" lang="es">${q}</h2>
        <div class="card-help">
          <button class="help-toggle" aria-expanded="false">
            Trenger dere hjelp?
            <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <div class="help-body">
            <div class="help-label">Spør hverandre videre</div>
            <ul class="follow-list" lang="es">
              ${c.f.map((f) => "<li>" + esc(f) + "</li>").join("")}
            </ul>
            <div class="help-label">Nyttige ord</div>
            <div class="vocab">
              ${c.v.map((v) => `<div class="vocab-row"><span class="vocab-es" lang="es">${esc(v[0])}</span><span class="vocab-no">${esc(v[1])}</span></div>`).join("")}
            </div>
            <div class="help-label">Liten utfordring</div>
            <div class="reto">${esc(c.r)}</div>
          </div>
        </div>
        <div class="card-actions">
          <button class="icon-btn fav-btn ${faved ? "faved" : ""}" aria-label="Lagre som favoritt" aria-pressed="${faved}">
            <svg viewBox="0 0 24 24"><path d="M12 20s-7-4.6-7-10a4.1 4.1 0 0 1 7-2.9A4.1 4.1 0 0 1 19 10c0 5.4-7 10-7 10z" fill="${faved ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
          </button>
          <button class="timer-chip" aria-label="Start taletid, to minutter hver">⏳ 2 min hver</button>
          ${opts.noNext ? "" : '<button class="btn-next">Nytt kort →</button>'}
        </div>
      </article>
    </div>`;
  }

  function bindCard(container, opts) {
    opts = opts || {};
    const card = $(".card", container);
    if (!card) return;

    const helpBtn = $(".help-toggle", card);
    helpBtn.addEventListener("click", () => {
      const body = $(".help-body", card);
      const open = body.classList.toggle("open");
      helpBtn.setAttribute("aria-expanded", String(open));
    });

    const favBtn = $(".fav-btn", card);
    favBtn.addEventListener("click", () => {
      const id = card.dataset.id;
      const i = state.favs.indexOf(id);
      if (i >= 0) {
        state.favs.splice(i, 1);
        favBtn.classList.remove("faved");
        favBtn.setAttribute("aria-pressed", "false");
        $("svg path", favBtn).setAttribute("fill", "none");
        toast("Fjernet fra favoritter");
      } else {
        state.favs.push(id);
        favBtn.classList.add("faved");
        favBtn.setAttribute("aria-pressed", "true");
        $("svg path", favBtn).setAttribute("fill", "currentColor");
        toast("Lagret – finner den igjen under Favoritter");
      }
      save();
    });

    const timerBtn = $(".timer-chip", card);
    timerBtn.addEventListener("click", () => {
      if (timerBtn.classList.contains("running")) {
        clearInterval(timerInterval);
        timerBtn.classList.remove("running");
        timerBtn.textContent = "⏳ 2 min hver";
        return;
      }
      let secs = 120;
      timerBtn.classList.add("running");
      timerBtn.classList.remove("done");
      const tick = () => {
        const m = Math.floor(secs / 60);
        const s = String(secs % 60).padStart(2, "0");
        timerBtn.textContent = "⏳ " + m + ":" + s;
        if (secs <= 0) {
          clearInterval(timerInterval);
          timerBtn.classList.remove("running");
          timerBtn.classList.add("done");
          timerBtn.textContent = "¡Cambio! Bytt";
        }
        secs--;
      };
      tick();
      clearInterval(timerInterval);
      timerInterval = setInterval(tick, 1000);
    });

    const nextBtn = $(".btn-next", card);
    if (nextBtn) nextBtn.addEventListener("click", () => nextCard(card));

    if (!opts.noSwipe) {
      let x0 = null, y0 = null;
      card.addEventListener("touchstart", (e) => {
        x0 = e.touches[0].clientX;
        y0 = e.touches[0].clientY;
      }, { passive: true });
      card.addEventListener("touchend", (e) => {
        if (x0 === null) return;
        const dx = e.changedTouches[0].clientX - x0;
        const dy = e.changedTouches[0].clientY - y0;
        if (dx < -60 && Math.abs(dy) < 70) nextCard(card);
        x0 = y0 = null;
      }, { passive: true });
    }
  }

  function nextCard(cardEl) {
    clearInterval(timerInterval);
    cardEl.classList.add("out");
    setTimeout(() => {
      drawCard(state.level);
      renderTab();
    }, 190);
  }

  /* ── Visninger ── */

  function renderTab() {
    $$(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    const view = $("#view");
    if (tab === "deck") view.innerHTML = deckView();
    else if (tab === "daily") view.innerHTML = dailyView();
    else if (tab === "favs") view.innerHTML = favsView();
    else view.innerHTML = settingsView();
    bindTabContent();
    window.scrollTo({ top: 0 });
  }

  function levelChips() {
    return `<div class="levels">${LEVELS.map(
      (l) => `<button class="level-chip ${l === state.level ? "active" : ""}" data-level="${l}"><b>${l}</b><small>${LEVEL_DESC[l]}</small></button>`
    ).join("")}</div>`;
  }

  function deckView() {
    const idx = currentCard(state.level);
    const total = DECKS[state.level].length;
    const left = state.queues[state.level].length;
    const banner = pendingDaily()
      ? `<div class="pending-banner" id="pending-banner">☕ Dagens kort ligger klart – trykk her for å se det</div>`
      : "";
    return `
      ${banner}
      ${levelChips()}
      ${cardHTML(state.level, idx)}
      <div class="deck-progress">${left} uleste kort igjen på nivå ${state.level}</div>
      <div class="swipe-hint">Tips: sveip kortet mot venstre for et nytt</div>
    `;
  }

  function dailyView() {
    const d = new Date();
    const dateEs = DIAS[d.getDay()] + " " + d.getDate() + " de " + MESES[d.getMonth()];
    const idx = dailyIndex(state.level, todayStr());
    state.notifiedDate = todayStr(); // dagens kort er sett
    save();
    return `
      <div class="daily-date">${dateEs}</div>
      <div class="daily-note">Samme kort hele dagen – perfekt til kaffen. Nytt i morgen.</div>
      ${cardHTML(state.level, idx, { noNext: true })}
    `;
  }

  function favsView() {
    if (state.favs.length === 0) {
      return `<div class="empty">
        <div class="big">Ingen favoritter ennå</div>
        Trykk på hjertet på et kort dere vil snakke om igjen.
      </div>`;
    }
    return `<div class="section-label">Kort dere har lagret</div>` + state.favs
      .slice()
      .reverse()
      .map((id) => {
        const [lvl, i] = id.split("-");
        const c = DECKS[lvl] && DECKS[lvl][+i];
        if (!c) return "";
        return `<div class="fav-item" data-id="${id}">
          <div class="fav-meta">
            <span class="card-tema tema-${lvl}">${esc(c.t)}</span>
            <button class="fav-remove" data-id="${id}">Fjern</button>
          </div>
          <p class="fav-q" lang="es" data-open="${id}">${esc(c.q)}</p>
        </div>`;
      })
      .join("");
  }

  function settingsView() {
    const n = state.notif;
    const perm = "Notification" in window ? Notification.permission : "unsupported";
    let status = "";
    if (!n.on) status = "";
    else if (perm === "granted") status = `<div class="notif-status">Varsler er på. Neste: ${nextTriggerText()}.<br>På iPhone/iPad må appen ligge på hjemskjermen (Del-knappen → «Legg til på Hjem-skjerm») for at varsler skal nå fram.</div>`;
    else if (perm === "denied") status = `<div class="notif-status warn">Nettleseren blokkerer varsler for denne siden. Bruk kalender-påminnelsen under i stedet – den virker alltid.</div>`;
    else status = `<div class="notif-status">Trykk på bryteren igjen for å gi tillatelse til varsler.</div>`;

    return `
      <div class="section-label">Nivå</div>
      ${levelChips()}

      <div class="section-label">Påminnelser</div>
      <div class="panel">
        <h3>Nytt kort-varsel</h3>
        <p class="desc">Få et lite puff når dagens kort er klart – dere velger når.</p>
        <div class="row">
          <label class="main" for="notif-toggle">Varsler</label>
          <span class="switch"><input type="checkbox" id="notif-toggle" ${n.on ? "checked" : ""}><span class="knob"></span></span>
        </div>
        <div class="row">
          <label class="main" for="notif-time">Klokkeslett</label>
          <input type="time" id="notif-time" value="${n.time}">
        </div>
        <div class="help-label" style="margin-top:12px">Hvilke dager?</div>
        <div class="days">
          ${DAY_LABELS.map((d, i) => `<button class="day-chip ${n.days.includes(i) ? "on" : ""}" data-day="${i}" aria-pressed="${n.days.includes(i)}">${d}</button>`).join("")}
        </div>
        ${status}
        <button class="btn-secondary" id="ics-btn">📅 Legg påminnelsen i kalenderen</button>
        <div class="notif-status">Kalender-påminnelsen er den sikreste måten – den virker på alle telefoner, uansett.</div>
      </div>

      <div class="section-label">Fremdrift</div>
      <div class="panel">
        ${LEVELS.map((l) => {
          const total = DECKS[l].length;
          const left = Array.isArray(state.queues[l]) ? state.queues[l].length : total;
          return `<div class="row"><label class="main">${l} · ${LEVEL_DESC[l]}</label><span style="color:var(--ink-faint);font-size:13.5px">${total - left} av ${total} trukket</span></div>`;
        }).join("")}
        <button class="btn-secondary btn-danger" id="reset-btn">Nullstill fremdrift</button>
      </div>

      <p class="about">
        <i>Sobremesa</i> (es.) – den gode praten som blir igjen rundt bordet etter maten.<br>
        400 samtalekort · B1–C2 · Laget for å brukes to og to.
      </p>
    `;
  }

  /* ── Hendelser per visning ── */

  function bindTabContent() {
    const view = $("#view");

    $$(".level-chip", view).forEach((b) =>
      b.addEventListener("click", () => {
        if (state.level === b.dataset.level) return;
        state.level = b.dataset.level;
        ensureQueue(state.level);
        if (typeof state.current[state.level] !== "number") drawCard(state.level, true);
        save();
        renderTab();
        toast("Nivå " + state.level + " – " + LEVEL_DESC[state.level].toLowerCase());
      })
    );

    if (tab === "deck" || tab === "daily") bindCard(view, { noSwipe: tab === "daily" });

    const banner = $("#pending-banner", view);
    if (banner) banner.addEventListener("click", () => { tab = "daily"; renderTab(); });

    if (tab === "favs") {
      $$(".fav-remove", view).forEach((b) =>
        b.addEventListener("click", () => {
          state.favs = state.favs.filter((id) => id !== b.dataset.id);
          save();
          renderTab();
        })
      );
      $$("[data-open]", view).forEach((p) =>
        p.addEventListener("click", () => {
          const [lvl, i] = p.dataset.open.split("-");
          openFavOverlay(lvl, +i);
        })
      );
    }

    if (tab === "settings") bindSettings(view);
  }

  function openFavOverlay(lvl, idx) {
    const root = $("#overlay-root");
    root.innerHTML = `<div class="onboard" style="justify-content:flex-start;padding-top:60px">
      <button class="btn-secondary" id="close-overlay" style="max-width:420px;margin-bottom:18px">← Tilbake til favoritter</button>
      <div style="width:100%;max-width:480px;text-align:left">${cardHTML(lvl, idx, { noNext: true })}</div>
    </div>`;
    bindCard(root, { noSwipe: true });
    $("#close-overlay").addEventListener("click", () => (root.innerHTML = ""));
  }

  /* ── Innstillinger ── */

  function bindSettings(view) {
    const toggle = $("#notif-toggle", view);
    toggle.addEventListener("change", async () => {
      if (toggle.checked) {
        if (!("Notification" in window)) {
          toast("Denne nettleseren støtter ikke varsler – bruk kalenderknappen!");
          toggle.checked = false;
          return;
        }
        const perm = await Notification.requestPermission();
        state.notif.on = perm === "granted";
        if (perm === "granted") {
          toast("Varsler er på ☕");
          registerPeriodicSync();
        } else {
          toast("Fikk ikke tillatelse – prøv kalenderknappen i stedet");
        }
      } else {
        state.notif.on = false;
      }
      save();
      scheduleNotification();
      renderTab();
    });

    $("#notif-time", view).addEventListener("change", (e) => {
      if (!/^\d{2}:\d{2}$/.test(e.target.value)) return;
      state.notif.time = e.target.value;
      save();
      scheduleNotification();
      renderTab();
    });

    $$(".day-chip", view).forEach((b) =>
      b.addEventListener("click", () => {
        const d = +b.dataset.day;
        const i = state.notif.days.indexOf(d);
        if (i >= 0) state.notif.days.splice(i, 1);
        else state.notif.days.push(d);
        state.notif.days.sort((a, b2) => a - b2);
        b.classList.toggle("on");
        b.setAttribute("aria-pressed", b.classList.contains("on"));
        save();
        scheduleNotification();
      })
    );

    $("#ics-btn", view).addEventListener("click", downloadICS);

    $("#reset-btn", view).addEventListener("click", () => {
      if (!confirm("Nullstille fremdriften? Favorittene beholdes.")) return;
      state.queues = {};
      state.current = {};
      state.seenCount = {};
      drawCard(state.level, true);
      save();
      renderTab();
      toast("Fremdriften er nullstilt");
    });
  }

  /* ── Varsler ── */

  function nextTrigger() {
    const n = state.notif;
    if (!n.on || n.days.length === 0) return null;
    const [hh, mm] = n.time.split(":").map(Number);
    const now = new Date();
    for (let add = 0; add < 8; add++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + add, hh, mm, 0, 0);
      const weekday = (d.getDay() + 6) % 7; // 0 = mandag
      if (n.days.includes(weekday) && d > now) return d;
    }
    return null;
  }

  function nextTriggerText() {
    const d = nextTrigger();
    if (!d) return "ingen dager valgt";
    const days = ["søndag","mandag","tirsdag","onsdag","torsdag","fredag","lørdag"];
    return days[d.getDay()] + " kl. " + state.notif.time;
  }

  function scheduleNotification() {
    clearTimeout(notifTimeout);
    if (!state.notif.on || !("Notification" in window) || Notification.permission !== "granted") return;
    const d = nextTrigger();
    if (!d) return;
    const ms = Math.min(d.getTime() - Date.now(), 2147000000);
    notifTimeout = setTimeout(fireNotification, ms);
  }

  async function fireNotification() {
    if (!state.notif.on || state.notifiedDate === todayStr()) {
      scheduleNotification();
      return;
    }
    const idx = dailyIndex(state.level, todayStr());
    const c = DECKS[state.level][idx];
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.showNotification("☕ Dagens spanskkort er klart", {
          body: c.q,
          icon: "icons/icon-192.png",
          badge: "icons/icon-192.png",
          tag: "sobremesa-daily",
          data: { url: "./app.html#daily" },
        });
        state.notifiedDate = todayStr();
        save();
      }
    } catch (e) { /* ignorer */ }
    scheduleNotification();
  }

  async function registerPeriodicSync() {
    try {
      const reg = await navigator.serviceWorker.ready;
      if ("periodicSync" in reg) {
        const status = await navigator.permissions.query({ name: "periodic-background-sync" });
        if (status.state === "granted") {
          await reg.periodicSync.register("sobremesa-daily", { minInterval: 6 * 60 * 60 * 1000 });
        }
      }
    } catch (e) { /* støttes ikke – greit */ }
  }

  /* Var det et varsel som skulle gått av tidligere i dag? */
  function pendingDaily() {
    const n = state.notif;
    if (!n.on || state.notifiedDate === todayStr()) return false;
    const weekday = (new Date().getDay() + 6) % 7;
    if (!n.days.includes(weekday)) return false;
    const [hh, mm] = n.time.split(":").map(Number);
    const due = new Date();
    due.setHours(hh, mm, 0, 0);
    return Date.now() > due.getTime();
  }

  /* ── Kalenderpåminnelse (.ics) ── */

  function downloadICS() {
    const n = state.notif;
    const days = n.days.length ? n.days : [0, 1, 2, 3, 4];
    const byday = days.map((d) => DAY_ICS[d]).join(",");
    const [hh, mm] = n.time.split(":").map(Number);

    // første forekomst
    const now = new Date();
    let first = null;
    for (let add = 0; add < 8; add++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + add, hh, mm, 0, 0);
      const weekday = (d.getDay() + 6) % 7;
      if (days.includes(weekday) && d > now) { first = d; break; }
    }
    if (!first) first = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, hh, mm);

    const fmt = (d) =>
      d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0") +
      "T" + String(d.getHours()).padStart(2, "0") + String(d.getMinutes()).padStart(2, "0") + "00";

    const url = location.origin + location.pathname;
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Sobremesas//Spanskkort//NO",
      "BEGIN:VEVENT",
      "UID:sobremesa-daily-" + Date.now() + "@sobremesa",
      "DTSTAMP:" + fmt(new Date()) + "Z",
      "DTSTART:" + fmt(first),
      "DURATION:PT15M",
      "RRULE:FREQ=WEEKLY;BYDAY=" + byday,
      "SUMMARY:☕ Dagens spanskkort",
      "DESCRIPTION:Trekk dagens kort og ta praten: " + url + "#daily",
      "URL:" + url,
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "DESCRIPTION:Dagens spanskkort er klart",
      "TRIGGER:PT0S",
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "spanskkort-paminnelse.ics";
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast("Åpne filen og godta – så ligger påminnelsen i kalenderen");
  }

  /* ── Onboarding ── */

  function showOnboarding() {
    const root = $("#overlay-root");
    let chosen = "B1";
    root.innerHTML = `
      <div class="onboard">
        <h1 class="onboard-mark">Sobremesas</h1>
        <div class="onboard-tag">Spanske samtalekort</div>
        <p class="onboard-lead">Trekk et kort, ta en kaffe, og snakk spansk – sammen. Hvert kort har et spørsmål, oppfølgingsspørsmål, nyttige ord og en liten utfordring.<br><br>Hvilket nivå passer dere?</p>
        <div class="onboard-levels">
          ${LEVELS.map((l) => `
            <button class="onboard-level ${l === chosen ? "chosen" : ""}" data-level="${l}">
              <b class="lvl">${l}</b>
              <span class="txt"><b>${LEVEL_DESC[l]}</b>${{
                B1: "Dere klarer dere i de fleste hverdagssituasjoner.",
                B2: "Dere snakker ledig og kan argumentere for ting.",
                C1: "Dere uttrykker dere presist, også om vanskelige tema.",
                C2: "Dere er nesten som morsmålsbrukere.",
              }[l]}</span>
            </button>`).join("")}
        </div>
        <button class="btn-next" id="onboard-go">Empezamos →</button>
      </div>`;

    $$(".onboard-level", root).forEach((b) =>
      b.addEventListener("click", () => {
        chosen = b.dataset.level;
        $$(".onboard-level", root).forEach((x) => x.classList.toggle("chosen", x === b));
      })
    );

    $("#onboard-go").addEventListener("click", () => {
      state.level = chosen;
      state.onboarded = true;
      drawCard(chosen, true);
      save();
      root.innerHTML = "";
      renderTab();
    });
  }

  /* ── Oppstart ── */

  $$(".tab").forEach((b) =>
    b.addEventListener("click", () => {
      tab = b.dataset.tab;
      renderTab();
    })
  );

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  if (location.hash === "#daily") tab = "daily";

  ensureQueue(state.level);
  renderStreak();
  renderTab();
  mirrorToSW();
  scheduleNotification();
  if (state.notif.on) registerPeriodicSync();
  if (!state.onboarded) showOnboarding();

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      scheduleNotification();
      if (tab === "deck") renderTab(); // oppdater ev. banner
    }
  });
})();
