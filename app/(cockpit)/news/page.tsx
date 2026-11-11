import Link from "next/link";
import { requireAdmin } from "@/lib/require-admin";
import { newsFeed } from "@/lib/news/data";
import { newsSources } from "@/lib/news/sources";
import type { NewsItem } from "@/lib/news/types";

export const metadata = { title: "Veille IA & SEO" };

// Veille IA & SEO (Agent Veille) : les nouveautés des 14 derniers jours, issues de flux publics reconnus.
// Lecture seule ; la collecte tourne chaque matin (automatisation « Veille tech & IA »).
const FILTERS = [{ key: null, label: "Tout" }, { key: "IA", label: "IA" }, { key: "SEO", label: "SEO" }] as const;
const day = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });

export default async function NewsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const raw = (await searchParams).category;
  const category = raw === "IA" || raw === "SEO" ? raw : null;
  let items: NewsItem[] = [], error = "";
  try { items = await newsFeed({ category, days: 14, limit: 80 }); } catch { error = "Veille indisponible pour le moment."; }
  const highlights = items.slice(0, 4);
  const rest = items.slice(4).sort((a, b) => b.date.localeCompare(a.date));
  const sources = newsSources.filter((s) => !category || s.category === category);
  return <div className="space-y-6">
    <div>
      <p className="text-xs font-semibold tracking-[0.18em] text-accent-hover uppercase">Agent Veille</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Veille IA &amp; SEO</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted">Les nouveautés des 14 derniers jours, collectées chaque matin depuis {newsSources.length} sources reconnues et classées par pertinence.</p>
    </div>
    <nav aria-label="Catégorie" className="flex gap-2">
      {FILTERS.map((f) => <Link key={f.label} href={f.key ? `/news?category=${f.key}` : "/news"} aria-current={category === f.key ? "page" : undefined}
        className={`rounded-full border px-4 py-1.5 text-sm ${category === f.key ? "border-accent bg-accent-strong font-medium text-accent-foreground" : "border-border bg-surface"}`}>{f.label}</Link>)}
    </nav>
    {error ? <p role="alert" className="rounded-xl border border-danger/40 p-4 text-sm">{error}</p>
      : !items.length ? <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">Aucune actualité pour l’instant : la prochaine collecte a lieu demain matin.</p>
      : <>
        <section aria-labelledby="news-top" className="space-y-3">
          <h2 id="news-top" className="text-xs font-semibold tracking-wide text-muted uppercase">À retenir</h2>
          <div className="grid gap-3 md:grid-cols-2">{highlights.map((item) => <Item key={item.id} item={item} strong />)}</div>
        </section>
        {rest.length > 0 && <section aria-labelledby="news-all" className="space-y-3">
          <h2 id="news-all" className="text-xs font-semibold tracking-wide text-muted uppercase">Toutes les actualités</h2>
          <div className="space-y-2">{rest.map((item) => <Item key={item.id} item={item} />)}</div>
        </section>}
      </>}
    <p className="text-xs text-muted">Sources : {sources.map((s) => s.name).join(" · ")}.</p>
  </div>;
}

function Item({ item, strong = false }: { item: NewsItem; strong?: boolean }) {
  return <article className={`rounded-xl border border-border bg-surface ${strong ? "p-4" : "p-3"}`}>
    <p className="text-xs text-muted"><span className="font-medium text-accent-hover">{item.category}</span> · {item.source} · <time dateTime={item.date}>{day.format(new Date(item.date + "T00:00:00Z"))}</time></p>
    <h3 className={`mt-1 ${strong ? "font-semibold" : "text-sm font-medium"}`}>{item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer" className="hover:text-accent-hover hover:underline">{item.title}</a> : item.title}</h3>
    {item.summary && <p className={`mt-1 text-sm text-muted ${strong ? "line-clamp-3" : "line-clamp-2"}`}>{item.summary}</p>}
    {item.impact && <p className="mt-1 text-xs font-medium text-accent">À retenir : {item.impact}</p>}
  </article>;
}
