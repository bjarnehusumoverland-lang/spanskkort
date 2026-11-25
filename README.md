# Sobremesas · spanske samtalekort

*Sobremesa* (es.) – den gode praten som blir igjen rundt bordet etter maten.
Appen heter **Sobremesas** – flertall, for mange gode samtaler (og fordi sobremesas.no var ledig).

En liten, vakker web-app med **400 spanske samtalekort for to** – 100 kort på hvert av
nivåene B1, B2, C1 og C2. Laget for å brukes sammen med noen: trekk et kort, ta en
kaffe, og snakk spansk.

Hvert kort har:

- **Et hovedspørsmål** på spansk, tilpasset nivået
- **Oppfølgingsspørsmål** («Spør hverandre videre»)
- **Nyttige gloser** med norsk oversettelse
- **En liten utfordring** – et grammatikkgrep, en lek eller en vri som gjør samtalen bedre

I tillegg: dagens kort (samme for alle hele dagen), favoritter, taletimer (2 min hver),
«X dager på rad»-teller, og fremdrift per nivå (kortene stokkes, ingen gjentakelser før
du har vært gjennom alle).

## Kjøre lokalt

```bash
python3 -m http.server 4173
```

Åpne <http://localhost:4173>. (En hvilken som helst statisk server fungerer –
appen er ren HTML/CSS/JS uten byggesteg.)

## Varsler

Under **Mer → Påminnelser** velger man klokkeslett og ukedager for «nytt kort»-varsel.
Tre mekanismer, i prioritert rekkefølge:

1. **Kalenderpåminnelse (.ics)** – den sikreste. Knappen genererer en gjentakende
   kalenderhendelse med valgt tid/dager som virker på alle telefoner.
2. **Web-varsler** – vises når appen er installert/åpen. På iPhone krever dette at
   appen er lagt til på hjemskjermen (Del → «Legg til på Hjem-skjerm», iOS 16.4+).
3. **Periodic Background Sync** – ekte bakgrunnsvarsler på Android/Chrome når appen
   er installert som PWA.

Hvis et varsel «gikk tapt» (telefonen var av e.l.), viser appen et banner om at dagens
kort venter neste gang den åpnes.

## Julekort til utskrift

[julekort/index.html](julekort/index.html) er et A6-julekort (passer i C6-konvolutt) med
forsidedesignet og en QR-kode til appen: Cmd+P, papirstørrelse A6, ingen marger,
«skriv ut bakgrunner» på, tosidig («vend på kortsiden»).

QR-koden peker på https://sobremesas.no. Skulle adressen endres, lag ny kode med:

```bash
osascript -l JavaScript verktoy/lag-qr.js "https://ny-adresse.no" julekort/qr.png
```

… og oppdater adresselinjen i `julekort/index.html` (klassen `.url`).

## Publisere (sobremesas.no + GitHub Pages)

Alt er relative stier, så appen kan legges rett på GitHub Pages.
(HTTPS kreves for service worker og varsler – Pages ordner sertifikatet.)

1. **Push** repoet til GitHub.
2. **GitHub → Settings → Pages**: «Deploy from a branch» → `main` → `/ (root)` → Save.
3. Samme sted, under **Custom domain**: skriv `sobremesas.no` → Save.
   (`CNAME`-filen i repoet holder innstillingen fast.)
4. **Hos Domeneshop** (Mine domener → sobremesas.no → DNS-innstillinger):
   - Slett eventuelle ferdigoppsatte A-/AAAA-pekere (domeneparkering).
   - Legg inn **fire A-poster** med tomt vertsnavn-felt (selve domenet):
     `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - Valgfritt, men anbefalt – fire **AAAA-poster** samme sted:
     `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153`
   - Én **CNAME-post** med vertsnavn `www` som peker på
     `bjarnehusumoverland-lang.github.io`
5. Vent på DNS (minutter til et par timer). Når Pages-siden viser grønn hake
   for domenet, huk av **«Enforce HTTPS»**.

Deretter svarer https://sobremesas.no (og www-varianten) med landingssiden,
og QR-koden på julekortet virker.

## Struktur

```
index.html            – julelandingsside (forsiden)
css/landing.css       – landingssidens design (vinterkveld, snø, lysslynge)
assets/familie.jpg    – forsidebildet
app.html              – appskall
css/style.css         – design (Fraunces + Inter, varm papir-palett)
js/app.js             – all logikk (kortstokk, varsler, ics, tilstand)
js/data/{b1,b2,c1,c2}.js – 4 × 100 kort
sw.js                 – offline-cache + bakgrunnsvarsler
manifest.webmanifest  – PWA-manifest
icons/                – appikoner
```

Ingen avhengigheter, ingen sporing, ingen server – all tilstand ligger i `localStorage`
på telefonen.
