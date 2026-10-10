// Sources de la veille : flux publics officiels ou reconnus, https uniquement.
// Ajouter une source = ajouter une entrée. Une source en panne n'interrompt pas les autres.
export type NewsCategory = "IA" | "Développement" | "SEO" | "Ads" | "Web";
export type NewsSource = { id: string; name: string; url: string; category: NewsCategory; weight: number };

export const newsSources: NewsSource[] = [
  { id: "google-ai", name: "Google — IA", url: "https://blog.google/technology/ai/rss/", category: "IA", weight: 1 },
  { id: "huggingface", name: "Hugging Face", url: "https://huggingface.co/blog/feed.xml", category: "IA", weight: 0.9 },
  { id: "github-blog", name: "GitHub Blog", url: "https://github.blog/feed/", category: "Développement", weight: 0.9 },
  { id: "nextjs", name: "Next.js", url: "https://nextjs.org/feed.xml", category: "Développement", weight: 1 },
  { id: "google-search-central", name: "Google Search Central", url: "https://developers.google.com/search/blog/feed.xml", category: "SEO", weight: 1 },
  { id: "search-engine-roundtable", name: "Search Engine Roundtable", url: "https://www.seroundtable.com/index.xml", category: "SEO", weight: 0.8 },
  { id: "google-ads-blog", name: "Google Ads & Commerce", url: "https://blog.google/products/ads-commerce/rss/", category: "Ads", weight: 1 },
  { id: "web-dev", name: "web.dev", url: "https://web.dev/feed.xml", category: "Web", weight: 1 },
  { id: "chrome-developers", name: "Chrome for Developers", url: "https://developer.chrome.com/static/blog/feed.xml", category: "Web", weight: 0.9 },
];
