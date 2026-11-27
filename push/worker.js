/* Sobremesas · push-tjenesten (Cloudflare Worker)
   Tar imot påmeldinger fra appen, og sender et push-signal til hver
   telefon på minuttet den har valgt. Se README for publisering. */

import { handleRequest, runSchedule } from "./lib.js";

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, feil: "intern feil" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  },

  // Kjøres hvert minutt. scheduledTime er minuttet kjøringen gjelder,
  // også om den starter noen sekunder for sent.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runSchedule(env, new Date(event.scheduledTime)));
  },
};
