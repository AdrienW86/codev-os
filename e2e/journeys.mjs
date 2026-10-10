// Parcours E2E réels : chaque viewport repart d'une base réinitialisée (resetData).
// Vérifie aussi, à chaque page : absence d'erreur console, absence de défilement horizontal,
// aucune valeur secrète dans le HTML.
import { createRequire } from "node:module";

async function loadPlaywright() {
  try { return await import("playwright"); } catch { /* repli : installation globale */ }
  for (const base of [process.env.PLAYWRIGHT_GLOBAL_PATH, "/opt/node22/lib/node_modules/", "/usr/local/lib/node_modules_global/"].filter(Boolean)) {
    try { return createRequire(base)("playwright"); } catch { /* suivant */ }
  }
  throw new Error("Playwright introuvable (npm i -D playwright ou PLAYWRIGHT_GLOBAL_PATH).");
}

export const viewports = [["desktop", { width: 1440, height: 900 }], ["tablet", { width: 820, height: 1100 }], ["mobile", { width: 375, height: 812 }]];

export async function runJourneys({ base, shots, resetData, cronSecret, apiKey }) {
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
  const failed = [];
  let passed = 0;

  const only = process.env.E2E_VIEWPORTS?.split(",");
  for (const [name, viewport] of viewports.filter(([label]) => !only || only.includes(label))) {
    await resetData();
    const context = await browser.newContext({ viewport, locale: "fr-FR", timezoneId: "Europe/Paris" });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", (message) => { if (message.type() === "error" && !/DevTools|Download the React|favicon/.test(message.text())) consoleErrors.push(message.text().slice(0, 300)); });
    page.on("pageerror", (error) => consoleErrors.push(error.message.slice(0, 300)));
    page.on("dialog", (dialog) => dialog.accept());

    const go = async (path) => { await page.goto(base + path, { waitUntil: "networkidle" }); };
    const shot = async (label) => { await page.screenshot({ path: `${shots}/${name}-${label}.png`, fullPage: true }); };
    const pageChecks = async (label) => {
      if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) throw new Error(`${label} : défilement horizontal`);
      const html = await page.content();
      for (const secret of [apiKey, cronSecret]) if (html.includes(secret)) throw new Error(`${label} : secret présent dans la page`);
    };
    // Confirmation inline (role=status) ou zone persistante (data-flash) quand l'élément disparaît.
    const status = (text) => page.locator("[role=status], [data-flash]").filter({ hasText: text }).first();

    async function journey(label, run) {
      const before = consoleErrors.length;
      try {
        await run();
        await pageChecks(label);
        if (consoleErrors.length > before) throw new Error(`erreurs console : ${consoleErrors.slice(before).join(" | ")}`);
        passed++;
        console.log(`  ✓ [${name}] ${label}`);
      } catch (error) {
        failed.push(`[${name}] ${label} : ${String(error.message ?? error).split("\n")[0].slice(0, 400)}`);
        console.log(`  ✗ [${name}] ${label}`);
        await shot(`FAIL-${label.replace(/\W+/g, "-")}`).catch(() => undefined);
      }
    }

    await journey("accueil réel : points d’attention et veille de repli", async () => {
      await go("/dashboard");
      await page.getByRole("heading", { name: /Bonjour/ }).waitFor();
      await page.getByText(/tâche[s]? prioritaire|en retard/i).first().waitFor();
      await shot("dashboard");
    });

    await journey("assistant : lecture directe puis écriture proposée → confirmée", async () => {
      await go("/dashboard");
      const input = page.getByLabel("Votre demande à l’assistant");
      await input.fill("Quelles sont mes urgences ?");
      await page.getByRole("button", { name: "Envoyer" }).click();
      await page.getByText(/À traiter|Rien d’urgent/).first().waitFor();
      await input.fill("Génère le rapport hebdomadaire pour Jrenov");
      await page.getByRole("button", { name: "Envoyer" }).click();
      const proposal = page.getByRole("group", { name: "Action proposée" });
      await proposal.getByText(/Générer le rapport hebdomadaire de Jrenov/).waitFor();
      await shot("assistant-proposal");
      await proposal.getByRole("button", { name: "Confirmer" }).click();
      await page.getByText(/Rapport généré pour Jrenov/).waitFor();
      await page.getByRole("link", { name: "Relire le rapport" }).first().click();
      await page.waitForURL(/\/reports\/[0-9a-f-]{36}/);
    });

    await journey("client → service → agent : activer le SEO rattache l’Agent SEO (en pause, à configurer)", async () => {
      await go("/clients/22222222-2222-4222-8222-222222222222");
      await page.getByRole("button", { name: "Ajouter un service" }).click();
      const dialog = page.locator("dialog[open]");
      await dialog.getByRole("button", { name: /SEO & visibilité locale/ }).first().click();
      await dialog.getByRole("button", { name: "Activer ce service" }).click();
      await status(/Service activé/).waitFor();
      await shot("service-activated");
      await go("/clients/22222222-2222-4222-8222-222222222222?tab=agents");
      await page.getByText("Agent SEO & Site").first().waitFor();
    });

    await journey("assistant : planifier un audit et créer une tâche (propositions confirmées)", async () => {
      await go("/dashboard");
      const input = page.getByLabel("Votre demande à l’assistant");
      await input.fill("Planifie un audit SEO de Jrenov mardi à 9h");
      await page.getByRole("button", { name: "Envoyer", exact: true }).click();
      const proposal = page.getByRole("group", { name: "Action proposée" });
      await proposal.getByText(/Planifier l’analyse SEO pour Jrenov/).waitFor();
      await proposal.getByRole("button", { name: "Confirmer" }).click();
      await page.getByText(/Planifié le \d{4}-\d{2}-\d{2} à 09:00/).waitFor();
      await input.fill("Crée une tâche Préparer le devis SEO pour Jrenov demain");
      await page.getByRole("button", { name: "Envoyer", exact: true }).click();
      await proposal.getByRole("button", { name: "Confirmer" }).click();
      await page.getByText("Tâche créée pour Jrenov.").waitFor();
      await go("/settings?tab=automations");
      await page.getByText(/Analyse SEO — Jrenov \(planifiée\)/).waitFor();
      await go("/work?kind=task");
      await page.getByText("Préparer le devis SEO").first().waitFor();
    });

    await journey("rapports : générer, relire, approuver, envoi manuel (e-mail désactivé)", async () => {
      await go("/reports");
      await page.locator('select[name="client_id"]').first().selectOption({ label: "Boulangerie Martin" });
      await page.getByRole("button", { name: "Générer" }).click();
      await status(/prêt à relire|Nouvelle version/).waitFor();
      await page.getByRole("link", { name: /Boulangerie Martin · Hebdomadaire/ }).first().click();
      await page.waitForURL(/\/reports\//);
      await page.getByRole("link", { name: "Version interne" }).click();
      await page.getByText("Usage interne uniquement.").waitFor();
      await page.getByRole("button", { name: /Approuver la version/ }).click();
      await page.getByText("Envoi e-mail désactivé.").waitFor();
      await shot("report-approved");
      await page.getByRole("button", { name: "Marquer comme envoyé manuellement" }).click();
      await page.getByText(/Le contenu est figé/).waitFor();
      if (await page.getByRole("button", { name: "Enregistrer" }).count()) throw new Error("rapport envoyé encore modifiable");
    });

    await journey("automatisation → exécution → incident → action à valider → réalisée", async () => {
      await go("/settings?tab=automations");
      const preset = page.getByRole("listitem").filter({ hasText: "Contrôle des sites" }).filter({ has: page.getByRole("button", { name: "Créer" }) });
      await preset.getByRole("button", { name: "Créer" }).click();
      await status(/Automatisation créée/).waitFor();
      await page.reload({ waitUntil: "networkidle" });
      const row = page.getByRole("listitem").filter({ hasText: "Contrôle des sites" }).filter({ has: page.getByRole("button", { name: "Exécuter maintenant" }) });
      await row.getByRole("button", { name: "Exécuter maintenant" }).click();
      await row.getByRole("status").filter({ hasText: /Contrôle de \d+ site/ }).waitFor({ timeout: 60_000 });
      await shot("automation-run");
      await go("/work?kind=incident");
      await page.getByRole("button", { name: /Site jrenov\.example indisponible/ }).first().click();
      const drawer = page.locator("dialog[open]");
      await drawer.getByRole("button", { name: "Prendre en charge" }).click();
      await status("Incident pris en charge.").waitFor();
      await page.keyboard.press("Escape");
      await go("/work?view=review");
      await page.getByRole("button", { name: /Correctif technique/ }).first().click();
      await drawer.getByRole("button", { name: "Approuver" }).click();
      await drawer.getByRole("button", { name: "Marquer comme réalisée" }).waitFor();
      await shot("action-approved");
      await drawer.getByRole("button", { name: "Marquer comme réalisée" }).click();
      await status("Réalisation manuelle consignée.").waitFor();
    });

    await journey("agenda : rendez-vous hebdomadaire visible dans la semaine, série arrêtée", async () => {
      await go("/agenda");
      await page.getByLabel("Titre").fill("Point hebdo Jrenov");
      await page.getByLabel("Récurrence").selectOption("weekly");
      await page.getByRole("button", { name: "Ajouter", exact: true }).click();
      await status("Ajouté à l’agenda.").waitFor();
      await page.reload({ waitUntil: "networkidle" });
      await page.getByText("Point hebdo Jrenov").first().waitFor();
      await shot("agenda");
      await page.getByRole("button", { name: "Arrêter la série" }).first().click();
      await status(/Annulé/).waitFor();
    });

    await journey("état du système et observabilité : ✓ / ○ / !, aucune valeur secrète", async () => {
      await go("/settings?tab=connections");
      await page.getByRole("heading", { name: "État du système" }).waitFor();
      await page.getByText("À configurer").first().waitFor();
      await shot("system-status");
      await go("/settings?tab=system");
      await page.getByText(/Jobs des 7 derniers jours/).waitFor();
    });

    await journey("sécurité : origine étrangère, tick sans secret, tick authentifié", async () => {
      const foreign = await page.request.post(`${base}/api/assistant`, { headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, data: { messages: [{ role: "user", content: "urgences" }] } });
      if (foreign.status() !== 403) throw new Error(`origine étrangère : ${foreign.status()}`);
      const oversized = await page.request.post(`${base}/api/assistant`, { headers: { Origin: base, "Content-Type": "application/json" }, data: { messages: [{ role: "user", content: "x".repeat(20_000) }] } });
      if (![400, 413].includes(oversized.status())) throw new Error(`charge excessive : ${oversized.status()}`);
      const anonymous = await page.request.get(`${base}/api/internal/scheduler/tick`);
      if (anonymous.status() !== 401) throw new Error(`tick sans secret : ${anonymous.status()}`);
      const tick = await page.request.get(`${base}/api/internal/scheduler/tick`, { headers: { Authorization: `Bearer ${cronSecret}` } });
      if (tick.status() !== 200 || !(await tick.json()).ok) throw new Error(`tick authentifié : ${tick.status()}`);
    });

    await journey("voix : micro indisponible → message explicite, rien d’envoyé", async () => {
      await go("/dashboard");
      await page.getByRole("button", { name: "Dicter avec le micro" }).click();
      await page.getByRole("status").filter({ hasText: /micro|navigateur|dictée|Parlez|Enregistrement/i }).first().waitFor();
      await page.keyboard.press("Escape");
    });

    await journey("simulation : vues fictives, assistant sans lecture ni écriture réelle", async () => {
      await go("/settings/simulation");
      await page.getByLabel(/Journée chargée/).check();
      await page.getByRole("button", { name: /Activer la simulation|Changer et ouvrir/ }).click();
      await page.waitForURL("**/dashboard");
      await page.getByText(/Simulation · Journée chargée/).waitFor();
      await page.getByLabel("Votre demande à l’assistant").fill("Génère le rapport hebdomadaire pour Jrenov");
      await page.getByRole("button", { name: "Envoyer", exact: true }).first().click();
      await page.getByText(/Simulation active : l’assistant ne lit pas/).waitFor();
      await shot("simulation");
      await page.getByRole("button", { name: "Quitter la simulation" }).click();
      await page.waitForLoadState("networkidle");
    });

    await context.close();
  }
  await browser.close();
  return { passed, failed };
}
