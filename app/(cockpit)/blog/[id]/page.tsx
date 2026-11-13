import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/require-admin";
import { getBlogArticle } from "@/lib/blog-agent/service";
import { CTA_SENTENCE, RELAY_LABELS, RELAY_PLATFORMS, articleUrl, readingMinutes, renderMarkdown } from "@/lib/blog-agent/model";
import { auditBlogArticle } from "@/lib/blog-agent/seo";
import { STYLE_GOOD_SCORE, auditStyle } from "@/lib/copywriter/style";
import { BlogArticleEditor, BlogArticleQuickActions } from "@/components/blog/blog-article-actions";

export const metadata = { title: "Article de blog" };
const when = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
const STATUS = { scheduled: "Programmé", published: "Publié", cancelled: "Annulé" } as const;
const SOCIAL = { pending: "Résumés prévus à la publication", off: "Pas de relais sur les réseaux", done: "Résumés envoyés sur les réseaux", partial: "Résumés partiellement envoyés", failed: "Relais sur les réseaux en échec" } as const;

// Fiche d'un article de l'Agent Blog (lien de la notification « Article prévu demain ») : aperçu tel qu'il sera publié,
// heure de mise en ligne, résumés pour les réseaux ; publier tout de suite, annuler ou modifier.
export default async function BlogArticlePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const view = await getBlogArticle(id).catch(() => null);
  if (!view) notFound();
  const { article: a, settings, clientName, imageUrl, seo } = view;
  const audit = auditBlogArticle({ title: a.title, metaDescription: a.meta_description, bodyMarkdown: a.body_markdown }, { keyword: seo.keyword, zone: seo.zone });
  const tone = audit.score >= 80 ? "text-success" : audit.score >= 60 ? "text-warning" : "text-danger";
  // Relecture du Copywriter : chapô, corps et résumés (le titre et la meta description relèvent de la note SEO).
  const style = auditStyle([a.excerpt, a.body_markdown, ...Object.values(a.social ?? {})].join("\n\n"));
  const styleTone = style.score >= STYLE_GOOD_SCORE ? "text-success" : style.score >= 55 ? "text-warning" : "text-danger";
  const live = a.status === "published" && settings.siteUrl ? articleUrl(settings.siteUrl, settings.blogPath, a.slug) : null;
  return <div className="space-y-6">
    <div>
      <p className="text-xs font-semibold tracking-[0.18em] text-accent-hover uppercase">Agent Blog · <Link href={`/clients/${a.client_id}?tab=publications`} className="hover:underline">{clientName}</Link></p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{a.title}</h1>
      <p className="mt-2 text-sm text-muted">
        <span className={`mr-2 rounded-full px-2 py-0.5 text-xs font-medium ${a.status === "scheduled" ? "bg-accent-strong text-accent-foreground" : a.status === "published" ? "bg-surface border border-border" : "bg-danger/10 text-danger"}`}>{STATUS[a.status]}</span>
        {a.status === "scheduled" && <>Publication prévue {when.format(new Date(a.publish_at))}. </>}
        {a.status === "published" && a.published_at && <>Publié {when.format(new Date(a.published_at))}. </>}
        {a.service && <>Prestation : {a.service}. </>}{readingMinutes(a.body_markdown)} min de lecture. {SOCIAL[a.social_status]}.
      </p>
      {live && <p className="mt-2 text-sm"><a href={live} target="_blank" rel="noopener noreferrer" className="text-accent-hover underline">Voir l’article sur le site →</a></p>}
      {!settings.siteUrl && <p role="alert" className="mt-2 text-sm text-danger">Adresse du site non renseignée dans les réglages de l’Agent Blog.</p>}
    </div>
    <section data-blog-seo className="rounded-2xl border border-border bg-surface p-5 text-sm">
      <p><span className={`font-semibold ${tone}`}>Note SEO {audit.score}/100</span> <span className="text-muted">· {audit.words} mots · expression visée : « {audit.keyword} »{seo.targetQuery ? " (recherche réelle lue dans Search Console)" : ""}</span></p>
      {audit.issues.length > 0 ? <ul className="mt-2 space-y-1">{audit.issues.map((i) => <li key={i.code} className={i.level === "warning" ? "text-warning" : "text-muted"}>{i.message}</li>)}</ul>
        : <p className="mt-2 text-muted">Titre, meta description, structure et lisibilité conformes.</p>}
      <p data-blog-style className="mt-4"><span className={`font-semibold ${styleTone}`}>Naturel {style.score}/100</span> <span className="text-muted">· relecture de style de l’Agent Copywriter</span></p>
      {style.issues.length > 0 ? <ul className="mt-2 space-y-1">{style.issues.map((i) => <li key={i.code} className={i.level === "warning" ? "text-warning" : "text-muted"}>{i.message}</li>)}</ul>
        : <p className="mt-2 text-muted">Ni formule toute faite, ni tic d’écriture repéré.</p>}
    </section>
    <BlogArticleQuickActions id={a.id} scheduled={a.status === "scheduled"} />
    <article className="overflow-hidden rounded-2xl border border-border bg-surface">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {imageUrl && <img src={imageUrl} alt={a.image_alt ?? ""} width={1600} height={900} className="aspect-video w-full object-cover" />}
      <div className="space-y-4 p-5 sm:p-8">
        <p className="text-lg text-muted">{a.excerpt}</p>
        <div className="blog-preview space-y-3 text-[15px] leading-7 [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(a.body_markdown) }} />
      </div>
    </article>
    <section className="space-y-3">
      <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">Résumés pour les réseaux</h2>
      <div className="grid gap-3 md:grid-cols-3">{RELAY_PLATFORMS.map((p) => <div key={p} className="rounded-xl border border-border bg-surface p-4 text-sm">
        <p className="font-medium">{RELAY_LABELS[p]}</p><p className="mt-2 whitespace-pre-line text-muted">{a.social[p] ?? "—"}</p>
        <p className="mt-2 text-xs text-muted">+ « {CTA_SENTENCE} » {p === "instagram" ? "et l’adresse du site" : "et le lien de l’article"}.</p>
      </div>)}</div>
      {a.social_publication_ids.length > 0 && <p className="text-sm">{a.social_publication_ids.map((pid, i) => <Link key={pid} href={`/publications/${pid}`} className="mr-3 text-accent-hover underline">Publication {i + 1}</Link>)}</p>}
    </section>
    {a.status !== "cancelled" && <details className="rounded-2xl border border-border bg-surface p-5">
      <summary className="min-h-10 cursor-pointer font-semibold">Modifier l’article</summary>
      <div className="mt-4"><BlogArticleEditor id={a.id} title={a.title} meta={a.meta_description} excerpt={a.excerpt} alt={a.image_alt ?? ""} body={a.body_markdown} social={a.social} /></div>
    </details>}
  </div>;
}
