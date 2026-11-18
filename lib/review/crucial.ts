// Règle des confirmations (pur, sans import) : l'administrateur ne confirme que les actions CRUCIALES.
// Est cruciale une action qui coûte de l'argent, part chez un tiers (contact, client, public), écrit sur le site d'un
// client, ou montre une image générée par IA. Tout le reste est traité automatiquement et reste consultable.

export type CrucialCategory = "generated-image" | "ads-spend" | "third-party-email" | "public-reply" | "client-site" | "ai-budget" | "manual-publication";

export const crucialCategories: Record<CrucialCategory, { label: string; reason: string }> = {
  "generated-image": { label: "Images générées par IA", reason: "Règle de l’administrateur : chaque image générée est validée à la main." },
  "ads-spend": { label: "Google Ads", reason: "Dépense réelle sur le compte publicitaire du client." },
  "third-party-email": { label: "E-mails à des contacts", reason: "Part chez un tiers et ne peut pas être rappelé." },
  "public-reply": { label: "Réponses publiques", reason: "Publiée au nom du client et visible de tous." },
  "client-site": { label: "Site du client", reason: "Écrit sur le site en production du client." },
  "ai-budget": { label: "Budget IA", reason: "Dépense au-delà du plafond mensuel choisi pour ce client." },
  "manual-publication": { label: "Publications en validation manuelle", reason: "Client sans validation automatique, ou TikTok (accord exigé pour chaque vidéo)." },
};

/** Catégorie cruciale d'un type d'action d'agent ; null = action interne, exécutée sans confirmation. */
export function crucialCategoryOfAction(actionType: string): CrucialCategory | null {
  if (actionType.startsWith("internal.")) return null;
  if (actionType.startsWith("ads.")) return "ads-spend";
  if (actionType === "report.send") return "third-party-email";
  if (actionType.startsWith("seo.") || actionType.startsWith("monitoring.")) return "client-site";
  // Type inconnu : prudence, il reste confirmé (jamais d'effet externe exécuté sans accord).
  return "client-site";
}

/** Rapports : seul un rapport qu'un envoi automatique au client peut suivre (Google Ads récurrent) reste à approuver. */
export const reportNeedsConfirmation = (kind: string) => kind === "google_ads";
