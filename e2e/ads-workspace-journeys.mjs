import assert from "node:assert/strict";
import { chromium } from "playwright";
import { installFakeVoice } from "./voice-fake.mjs";
const client = "11111111-1111-4111-8111-111111111111";
export async function runWorkspaceJourneys({ base, shots, resetData }) {
  const browser = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM }); const failed = []; let passed = 0;
  try {
    for (const [name, viewport] of [["desktop", { width: 1440, height: 900 }], ["mobile", { width: 375, height: 812 }]]) {
      await resetData(); const context = await browser.newContext({ viewport, locale: "fr-FR" }); const page = await context.newPage(); page.setDefaultTimeout(15000); page.on("dialog", (dialog) => dialog.accept());
      const errors = []; page.on("pageerror", (error) => errors.push(error.message));
      async function journey(label, run) {
        const before = errors.length;
        try { await run(); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "horizontal overflow"); assert.equal(errors.length, before, errors.slice(before).join(" | ")); passed++; console.log(`  ✓ [${name}] ${label}`); }
        catch (error) { failed.push(`[${name}] ${label}: ${String(error.stack).slice(0, 1500)}`); console.log(`  ✗ [${name}] ${label}`); }
        await page.screenshot({ path: `${shots}/${name}-workspace-${label}.png`, fullPage: true });
      }
      await journey("persistent-scope", async () => {
        await page.goto(`${base}/advertising?client=${client}`);
        await page.getByRole("heading", { name: "Campagnes publicitaires", exact: true }).waitFor();
        await page.getByText(/Campagnes suivies pour ce client/).click();
        const tracking = page.locator("details").filter({ has: page.locator("summary", { hasText: "Campagnes suivies pour ce client" }) });
        await tracking.getByLabel("Search Albi", { exact: true }).uncheck(); await tracking.getByLabel("Local Services Jrenov", { exact: true }).uncheck();
        await tracking.getByRole("button", { name: "Enregistrer les campagnes suivies" }).click(); await page.getByText(/Campagnes suivies pour ce client \(1\)/).waitFor();
        await page.getByLabel(/^Période/).selectOption("last_7"); await page.waitForURL(/ads_period=last_7/); assert.equal(new URL(page.url()).pathname, "/advertising");
        await page.reload(); await page.getByText(/Campagnes suivies pour ce client \(1\)/).waitFor();
        await page.getByText("Contexte commercial du client", { exact: true }).click(); await page.locator("textarea[name=objectives]").fill("Obtenir des demandes qualifiées."); await page.getByLabel("Budget publicitaire mensuel", { exact: true }).fill("500");
        await page.getByRole("button", { name: "Enregistrer le contexte commercial" }).click(); await page.getByText(/Contexte commercial enregistré/).waitFor();
        await page.reload(); await page.getByText("Contexte commercial du client", { exact: true }).click(); assert.equal(await page.locator("textarea[name=objectives]").inputValue(), "Obtenir des demandes qualifiées.");
      });
      await journey("analysis-history", async () => {
        await page.goto(`${base}/advertising?client=${client}&ads_period=last_7`); await page.getByRole("button", { name: "Lancer l’analyse sur ce périmètre", exact: true }).click();
        await page.getByRole("link", { name: "Ouvrir", exact: true }).click();
        await page.getByText(/Règles déterministes, sans IA · completed/).waitFor(); await page.getByText("Instructions figées au moment de l’analyse", { exact: true }).click(); await page.getByText("Obtenir des demandes qualifiées.", { exact: true }).waitFor();
        await page.getByRole("link", { name: "← Campagnes publicitaires", exact: true }).click(); await page.getByRole("heading", { name: "Dernières analyses du client" }).waitFor(); await page.getByRole("link", { name: /Terminée.*Analyse réelle/ }).waitFor();
      });
      await journey("report-email", async () => {
        await page.goto(`${base}/advertising?client=${client}&ads_period=last_7`); await page.getByRole("button", { name: "Préparer le rapport", exact: true }).click(); await page.getByRole("link", { name: "Ouvrir", exact: true }).first().click();
        await page.getByRole("heading", { name: /Prévisualisation de l’e-mail/ }).waitFor(); await page.getByRole("button", { name: "Approuver la version 1", exact: true }).click(); await page.getByText(/Approuvé le/).waitFor();
        await page.locator("textarea[name=summary]").fill("Synthèse client révisée."); await page.getByRole("button", { name: "Enregistrer", exact: true }).click(); await page.getByRole("button", { name: "Approuver la version 2", exact: true }).click();
        const email = page.locator("form").filter({ has: page.getByRole("button", { name: "Envoyer par e-mail", exact: true }) }); await email.getByLabel("Destinataire unique").fill("client@example.test"); await email.getByLabel("Je confirme cette adresse", { exact: false }).check(); await email.getByRole("button", { name: "Envoyer par e-mail", exact: true }).click(); await page.getByText(/Accepté par Resend ; livraison non confirmée/).waitFor();
        await page.goto(`${base}/notifications`); await page.getByText("Rapport prêt à relire", { exact: true }).first().waitFor(); await page.getByRole("button", { name: "Marquer comme lue", exact: true }).first().click(); await page.getByText(/· Lue/).first().waitFor(); await page.reload(); await page.getByText(/· Lue/).first().waitFor();
      });
      await journey("continuous-voice", async () => {
        await context.addInitScript(installFakeVoice); let transcriptions = 0; let submissions = 0;
        await page.route("**/api/assistant/transcribe", (route) => { transcriptions++; return route.fulfill({ json: { text: "Quelles sont mes urgences ?" } }); }); page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/assistant") submissions++; });
        await page.goto(`${base}/dashboard`); await page.getByRole("button", { name: "Activer la voix continue", exact: true }).click(); await page.waitForFunction(() => window.__voiceTest.speaking); assert.equal(await page.evaluate(() => window.__voiceTest.open), 0, "micro closed during speech");
        const panel = page.locator("dialog[open]"); await panel.getByRole("button", { name: "Arrêter la voix continue", exact: true }).click(); const starts = await page.evaluate(() => window.__voiceTest.starts); await page.waitForTimeout(2400); assert.equal(await page.evaluate(() => window.__voiceTest.starts), starts, "no restart after stop"); assert.equal(transcriptions, 1); assert.equal(submissions, 1);
        await panel.getByRole("button", { name: "Fermer le panneau de résultats" }).click(); await page.getByLabel("Votre demande à l’assistant").fill("Crée une tâche pour Jrenov : vérifier le devis"); await page.getByRole("button", { name: "Envoyer", exact: true }).click(); await page.getByRole("group", { name: "Action proposée" }).waitFor();
        await page.getByLabel("Votre demande à l’assistant").fill("oui"); await page.getByRole("button", { name: "Envoyer", exact: true }).click(); await page.getByRole("group", { name: "Action proposée" }).waitFor(); assert.equal(await page.getByRole("button", { name: "Confirmer", exact: true }).count(), 1);
      });
      await journey("private-offline", async () => {
        await page.goto(`${base}/notifications`); await page.evaluate(() => navigator.serviceWorker.ready);
        const keys = await page.evaluate(async () => { const results = []; for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) results.push(new URL(request.url).pathname); return results; }); assert.deepEqual(keys, ["/offline.html"]);
        const manifest = await (await context.request.get(`${base}/manifest.webmanifest`)).json(); assert.equal(manifest.display, "standalone"); await context.setOffline(true); await page.goto(`${base}/advertising?client=${client}`); await page.getByRole("heading", { name: "Vous êtes hors connexion" }).waitFor(); await context.setOffline(false);
      });
      await context.close();
    }
  } finally { await browser.close(); }
  return { passed, failed };
}
