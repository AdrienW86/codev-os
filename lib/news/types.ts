// Actualités tech & IA. Source future : Agent Veille. Pour l’instant, données de démonstration statiques.

export type NewsCategory = "IA" | "Développement" | "SEO" | "Ads" | "Web";
export type NewsItem = { id: string; title: string; category: NewsCategory; source: string; summary: string; date: string; url?: string };

/** Exemples de démonstration : aucun contenu réel, aucune veille automatique. */
export const demoNews: readonly NewsItem[] = [
  { id: "demo-ia", category: "IA", source: "Exemple", date: "2026-10-08", title: "Exemple · Nouveautés des modèles d’IA", summary: "Emplacement d’une actualité IA sélectionnée par l’Agent Veille." },
  { id: "demo-seo", category: "SEO", source: "Exemple", date: "2026-10-07", title: "Exemple · Évolution de la recherche locale", summary: "Emplacement d’une actualité SEO utile aux clients." },
  { id: "demo-ads", category: "Ads", source: "Exemple", date: "2026-10-06", title: "Exemple · Changement côté Google Ads", summary: "Emplacement d’une actualité Ads à surveiller." },
];
