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

En nettapp kan ikke selv sette en alarm på telefonen. For at varselet skal komme når
appen er lukket, må det sendes utenfra. Derfor finnes det tre veier:

1. **Push-tjenesten** (`push/`) sender et signal til telefonen på valgt minutt, og
   appen viser dagens varsel. Virker på Android, og på iPhone når appen ligger på
   hjemskjermen (iOS 16.4 eller nyere). Krever at tjenesten er publisert, se under.
2. **Uten tjenesten** vises varsler bare mens appen er åpen. Innstillingene sier
   tydelig fra når det er slik.
3. **Kalenderpåminnelse (.ics)** virker på alle telefoner uten noen tjeneste. Knappen
   lager en gjentakende kalenderhendelse med valgt tid og dager.

Hvis et varsel «gikk tapt» (telefonen var av e.l.), viser appen et banner om at dagens
kort venter neste gang den åpnes.

### Push-tjenesten

Tjenesten er en liten Cloudflare Worker på gratisnivået. Den lagrer én ting per
telefon: push-adressen fra nettleseren, valgt klokkeslett, ukedager og tidssone.
Ingen navn, e-postadresser eller annet. Hvert minutt sjekker den hvem som skal ha
varsel, og sender et tomt signal. Selve varselteksten velges på telefonen.

Publisere første gang (krever en gratis Cloudflare-konto):

```bash
cd push
npx wrangler login
npx wrangler kv namespace create SUBS      # lim id-en inn i wrangler.toml
npx wrangler secret put VAPID_PRIVATE_KEY < .vapid-privat.json
npx wrangler deploy
```

`deploy` skriver ut adressen til tjenesten. Lim den inn som `url` i
`js/push-config.js`, og publiser appen på nytt.

Nøkkelparet lages med `node push/lag-nokler.mjs`. Den private nøkkelen ligger i
`push/.vapid-privat.json`, som er utelatt fra git, og hos Cloudflare som hemmelighet.
Tjenesten testes lokalt med `node push/test.mjs`.

Grenser på gratisnivået: rundt 45 varsler på samme minutt. Det holder for familien
og en liten test, men må ses på igjen ved mange brukere.

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
js/varsler.js         – varseltekstene
js/push-config.js     – adresse og offentlig nøkkel for push-tjenesten
js/data/{b1,b2,c1,c2}.js – 4 × 100 kort
sw.js                 – offline-cache, mottak av push og visning av varsler
manifest.webmanifest  – PWA-manifest
icons/                – appikoner
push/                 – push-tjenesten (Cloudflare Worker), nøkkelskript og tester
```

Appen har ingen avhengigheter og ingen sporing. Kort, fremdrift og favoritter ligger
bare i `localStorage` på telefonen. Det eneste som lagres utenfor telefonen er
push-adressen og varseltidspunktet, og bare hvis man slår på varsler.
