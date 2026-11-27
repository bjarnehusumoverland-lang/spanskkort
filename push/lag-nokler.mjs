// Lager nøkkelparet push-varslene signeres med.
//
//   node push/lag-nokler.mjs          lager nøkler hvis de ikke finnes
//   node push/lag-nokler.mjs --ny     bytter nøkler (alle telefoner må da melde seg på igjen)
//
// Den private nøkkelen skrives til push/.vapid-privat.json, som er utelatt
// fra git. Den offentlige skrives inn i js/push-config.js, som appen bruker.

import { generateKeyPairSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const privPath = join(here, ".vapid-privat.json");
const configPath = join(here, "..", "js", "push-config.js");

if (existsSync(privPath) && !process.argv.includes("--ny")) {
  console.log("Nøkler finnes allerede. Bruk --ny for å bytte dem.");
  process.exit(0);
}

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = privateKey.export({ format: "jwk" });

const publicKey = Buffer.concat([
  Buffer.from([4]),
  Buffer.from(jwk.x, "base64url"),
  Buffer.from(jwk.y, "base64url"),
]).toString("base64url");

writeFileSync(privPath, JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }) + "\n", { mode: 0o600 });

// Behold adressen til tjenesten hvis den alt er fylt inn
let url = "";
if (existsSync(configPath)) {
  const m = readFileSync(configPath, "utf8").match(/url:\s*"([^"]*)"/);
  if (m) url = m[1];
}

writeFileSync(configPath, `/* Sobremesas · oppsett for push-varsler.
   url er adressen til push-tjenesten (fylles inn når den er publisert).
   publicKey lages av push/lag-nokler.mjs og hører sammen med den private
   nøkkelen som ligger hos tjenesten. */
self.PUSH = {
  url: "${url}",
  publicKey: "${publicKey}",
};
`);

console.log("Privat nøkkel:    push/.vapid-privat.json (ikke i git)");
console.log("Offentlig nøkkel: skrevet til js/push-config.js");
