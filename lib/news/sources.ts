// Sources de la veille IA & SEO : flux publics officiels ou reconnus, https uniquement.
// Ajouter une source = ajouter une entrée. Une source en panne n'interrompt pas les autres (le run liste les sources
// injoignables). Catégories Développement, Ads et Web conservées dans le type pour l'historique, sans source active.
export type NewsCategory = "IA" | "Développement" | "SEO" | "Ads" | "Web";
export type NewsSource = { id: string; name: string; url: string; category: NewsCategory; weight: number; language: "fr" | "en" };

export const newsSources: NewsSource[] = [
  // IA : annonces officielles des éditeurs de modèles, puis une sélection de médias spécialisés.
  { id: "openai", name: "OpenAI", url: "https://openai.com/news/rss.xml", category: "IA", weight: 1, language: "en" },
  { id: "google-deepmind", name: "Google DeepMind", url: "https://deepmind.google/blog/rss.xml", category: "IA", weight: 1, language: "en" },
  { id: "google-ai", name: "Google — IA", url: "https://blog.google/innovation-and-ai/technology/ai/rss/", category: "IA", weight: 0.95, language: "en" },
  { id: "mistral", name: "Mistral AI", url: "https://mistral.ai/news/rss", category: "IA", weight: 0.95, language: "en" },
  { id: "huggingface", name: "Hugging Face", url: "https://huggingface.co/blog/feed.xml", category: "IA", weight: 0.85, language: "en" },
  { id: "the-decoder", name: "The Decoder", url: "https://the-decoder.com/feed/", category: "IA", weight: 0.8, language: "en" },
  { id: "actuia", name: "ActuIA", url: "https://www.actuia.com/feed/", category: "IA", weight: 0.8, language: "fr" },
  // SEO : Google en premier (source de vérité), puis les médias de référence, dont un francophone.
  { id: "google-search-central", name: "Google Search Central", url: "https://developers.google.com/search/blog/feed.xml", category: "SEO", weight: 1, language: "en" },
  { id: "search-engine-land", name: "Search Engine Land", url: "https://searchengineland.com/feed", category: "SEO", weight: 0.9, language: "en" },
  { id: "search-engine-journal", name: "Search Engine Journal", url: "https://www.searchenginejournal.com/feed/", category: "SEO", weight: 0.85, language: "en" },
  { id: "search-engine-roundtable", name: "Search Engine Roundtable", url: "https://www.seroundtable.com/index.xml", category: "SEO", weight: 0.8, language: "en" },
  { id: "abondance", name: "Abondance", url: "https://www.abondance.com/feed/", category: "SEO", weight: 0.85, language: "fr" },
];
