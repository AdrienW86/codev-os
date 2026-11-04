/* eslint-disable @next/next/no-img-element -- Miniatures privées en URL signées courtes. */
import Link from "next/link";
import { requireAdmin } from "@/lib/require-admin";
import { parisToday } from "@/lib/publications/calendar";
import { loadPublicationCalendar, signCalendarImages } from "@/lib/publications/published";
import {
  CALENDAR_VIEWS, applyFilters, buildCards, calendarHref, chipCounts, dayLabel, excerpt, monthGrid, monthLabel, parsePublishedFilters, shiftMonth,
  type CalendarCard, type CalendarItemStatus, type CalendarView, type PublishedFilters,
} from "@/lib/publications/published-model";
import { platformLabels } from "@/lib/publications/editor";
import { publicationPlatforms, type PublicationPlatform } from "@/lib/publications/types";
import { PublicationsNav } from "@/components/publications/publications-board";
import { ProblemActions } from "@/components/publications/problem-actions";

export const metadata = { title: "Calendrier des publications" };

// Calendrier des publications, pensé pour le téléphone : un mois, des filtres en puces (client, réseau) qui
// n'affichent que ce qui existe, une grille compacte (un point par réseau), puis la liste du jour ou du mois.
const DOT: Record<PublicationPlatform, string> = { facebook: "#1877F2", instagram: "#E1306C", google_business_profile: "#34A853", tiktok: "#25F4EE", snapchat: "#FFFC00" };
const SHORT: Record<PublicationPlatform, string> = { facebook: "Facebook", instagram: "Instagram", google_business_profile: "Google", tiktok: "TikTok", snapchat: "Snapchat" };
const TONE: Record<CalendarItemStatus, string> = {
  published: "bg-success/10 text-success", approved: "bg-success/10 text-success", scheduled: "bg-accent/10 text-accent-hover",
  pending_review: "bg-warning/10 text-warning", retry: "bg-warning/10 text-warning", uncertain: "bg-warning/10 text-warning",
  failed: "bg-danger/10 text-danger", blocked: "bg-danger/10 text-danger",
};
const chip = (active: boolean) => `inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm ${active ? "border-accent bg-accent-strong font-medium text-accent-foreground" : "border-border bg-surface hover:border-border-strong"}`;

export default async function PublishedCalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const today = parisToday();
  const filters = parsePublishedFilters(await searchParams, today);
  let error = "";
  let data: Awaited<ReturnType<typeof loadPublicationCalendar>> = { items: [], images: new Map(), clients: [] };
  try { data = await loadPublicationCalendar(filters.view, filters.month); } catch (e) { error = e instanceof Error ? e.message : "Calendrier indisponible."; }
  const counts = chipCounts(data.items, filters);
  const cards = buildCards(applyFilters(data.items, filters), filters.view).filter((c) => c.date.startsWith(filters.month));
  const weeks = monthGrid(filters.month, cards, today);
  const shown = filters.day ? cards.filter((c) => c.date === filters.day) : cards;
  const images = await signCalendarImages(shown.flatMap((c) => (c.imagePath ? [c.imagePath] : [])));
  const href = (patch: Partial<Record<keyof PublishedFilters, string | null>>) => calendarHref(filters, patch);
  // Client choisi en premier : visible sans faire défiler les puces.
  const clientChips = [...counts.clients.entries()].sort((a, b) => Number(b[0] === filters.client) - Number(a[0] === filters.client) || a[1].name.localeCompare(b[1].name));
  if (filters.client && !counts.clients.has(filters.client)) {
    const name = data.clients.find((c) => c.id === filters.client)?.name;
    if (name) clientChips.unshift([filters.client, { name, count: 0 }]);
  }
  const days = groupByDay(shown);

  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-xs font-semibold tracking-[0.18em] text-accent-hover uppercase">Publications</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Calendrier des publications</h1>
      </div>
      <div className="hidden sm:block"><PublicationsNav current="published" /></div>
    </div>

    {/* Vue : publiées, à venir, à traiter. */}
    <nav aria-label="Vue du calendrier" className="grid grid-cols-3 rounded-xl border border-border bg-surface p-1 text-sm">
      {(Object.entries(CALENDAR_VIEWS) as [CalendarView, string][]).map(([view, label]) =>
        <Link key={view} href={href({ view })} aria-current={filters.view === view ? "page" : undefined}
          className={`rounded-lg px-2 py-2 text-center ${filters.view === view ? "bg-accent-strong font-semibold text-accent-foreground" : "text-muted hover:text-foreground"}`}>{label}</Link>)}
    </nav>

    {/* Filtres en puces : seuls les clients et réseaux présents ce mois-ci, avec leur nombre. */}
    <section aria-label="Filtres" className="space-y-2">
      <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0" data-calendar-clients>
        <Link href={href({ client: null })} className={chip(!filters.client)}>Tous les clients <span className="opacity-70">{[...counts.clients.values()].reduce((s, c) => s + c.count, 0)}</span></Link>
        {clientChips.map(([id, c]) => <Link key={id} href={href({ client: filters.client === id ? null : id })} className={chip(filters.client === id)}>{c.name} <span className="opacity-70">{c.count}</span></Link>)}
      </div>
      <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0" data-calendar-networks>
        <Link href={href({ platform: null })} className={chip(!filters.platform)}>Tous les réseaux</Link>
        {publicationPlatforms.filter((p) => counts.platforms.has(p) || filters.platform === p).map((p) =>
          <Link key={p} href={href({ platform: filters.platform === p ? null : p })} className={chip(filters.platform === p)}>
            <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: DOT[p] }} />{SHORT[p]} <span className="opacity-70">{counts.platforms.get(p) ?? 0}</span></Link>)}
      </div>
    </section>

    {/* Mois et grille compacte. */}
    <section className="rounded-2xl border border-border bg-surface p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <Link href={href({ month: shiftMonth(filters.month, -1) })} aria-label="Mois précédent" className="rounded-lg border border-border px-3 py-1.5">‹</Link>
        <div className="text-center"><p className="font-semibold">{monthLabel(filters.month)}</p>
          {filters.month !== today.slice(0, 7) && <Link href={href({ month: today.slice(0, 7) })} className="text-xs text-accent-hover underline">Revenir à ce mois-ci</Link>}</div>
        <Link href={href({ month: shiftMonth(filters.month, 1) })} aria-label="Mois suivant" className="rounded-lg border border-border px-3 py-1.5">›</Link>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted">{["L", "M", "M", "J", "V", "S", "D"].map((d, i) => <span key={i}>{d}</span>)}</div>
      <div className="mt-1 grid gap-1">{weeks.map((week, w) => <div key={w} className="grid grid-cols-7 gap-1">{week.map((cell) => {
        const selected = filters.day === cell.date;
        const body = <><span className={`text-xs ${cell.today ? "rounded-full bg-accent-strong px-1.5 font-semibold text-accent-foreground" : ""}`}>{Number(cell.date.slice(8))}</span>
          <span className="mt-1 flex min-h-2 flex-wrap justify-center gap-0.5">{cell.platforms.map((p) => <span key={p} className="h-1.5 w-1.5 rounded-full" style={{ background: DOT[p] }} />)}</span>
          {cell.count > 1 && <span className="text-[10px] text-muted">{cell.count}</span>}</>;
        const cls = `flex min-h-12 flex-col items-center rounded-lg p-1 ${selected ? "bg-accent/20 ring-1 ring-accent" : cell.count ? "bg-surface-raised" : ""} ${cell.problem ? "ring-1 ring-danger/50" : ""}`;
        return !cell.inMonth ? <span key={cell.date} className="min-h-12 opacity-30" aria-hidden><span className="text-xs">{Number(cell.date.slice(8))}</span></span>
          : cell.count ? <Link key={cell.date} href={href({ day: selected ? null : cell.date })} aria-label={`${dayLabel(cell.date)} : ${cell.count} publication(s)`} aria-current={selected ? "date" : undefined} className={cls}>{body}</Link>
          : <span key={cell.date} className={cls}>{body}</span>;
      })}</div>)}</div>
    </section>

    {/* Liste. */}
    <section aria-label="Publications" className="space-y-4">
      <p className="text-sm text-muted">{filters.day ? <>{dayLabel(filters.day)} · <Link href={href({ day: null })} className="text-accent-hover underline">tout le mois</Link></> : <>{cards.length} publication(s) · {monthLabel(filters.month)}</>}</p>
      {error ? <p role="alert" className="rounded-xl border border-danger/40 p-4 text-sm">{error}</p>
        : !shown.length ? <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">{emptyText(filters.view)}</p>
        : days.map(([day, list]) => <div key={day} className="space-y-2">
          {!filters.day && <h2 className="sticky top-0 z-10 bg-background/90 py-1 text-xs font-semibold tracking-wide text-muted uppercase backdrop-blur">{dayLabel(day)}</h2>}
          {list.map((card) => <Card key={card.key} card={card} image={card.imagePath ? images.get(card.imagePath) ?? null : null} />)}
        </div>)}
    </section>
    <p className="text-xs text-muted">Heures de Paris. Vues complètes : <Link href="/publications" className="underline">tableau</Link> · <Link href="/publications/supervision" className="underline">supervision</Link> · <Link href="/publications/calendar" className="underline">calendrier éditorial</Link>.</p>
  </div>;
}

function Card({ card, image }: { card: CalendarCard; image: string | null }) {
  const text = excerpt(card.text);
  return <article className="flex gap-3 rounded-xl border border-border bg-surface p-3" data-calendar-card>
    {image ? <img src={image} alt="" loading="lazy" className="h-20 w-20 shrink-0 rounded-lg object-cover" />
      : <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-surface-raised text-[10px] text-muted">Sans image</div>}
    <div className="min-w-0 flex-1">
      <div className="flex items-baseline justify-between gap-2"><Link href={`/publications/${card.publicationId}`} className="truncate font-semibold hover:underline">{card.clientName}</Link><span className="shrink-0 text-xs text-muted">{card.time}</span></div>
      {/* Chaque réseau ouvre sa propre fiche. */}
      <div className="mt-1 flex flex-wrap gap-1">{card.networks.map((n) =>
        <Link key={n.platform} href={`/publications/${n.publicationId}`} className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${TONE[n.status]}`} title={n.errorCode ?? undefined}>
          <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: DOT[n.platform] }} />{SHORT[n.platform]} · {n.statusLabel}</Link>)}</div>
      {text && <p className="mt-1.5 line-clamp-2 text-sm text-muted">{text}</p>}
      {/* À traiter : motif lisible et action directe par réseau (Réessayer ou Vérifier). */}
      {card.networks.filter((n) => n.deliveryId).map((n) => <div key={`p${n.platform}`} className="mt-2 border-t border-border pt-2">
        {n.problemLabel && <p className="text-xs text-muted"><span className="font-medium text-foreground">{SHORT[n.platform]}</span> · {n.problemLabel}</p>}
        <ProblemActions publicationId={n.publicationId} deliveryId={n.deliveryId!} status={n.status === "uncertain" ? "uncertain" : n.status} label={SHORT[n.platform]} />
      </div>)}
      {card.networks.some((n) => n.url) && <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {card.networks.filter((n) => n.url).map((n) => <a key={`u${n.platform}`} href={n.url!} target="_blank" rel="noopener noreferrer" className="text-accent-hover underline">Voir sur {platformLabels[n.platform]}</a>)}
      </div>}
    </div>
  </article>;
}
function groupByDay(cards: CalendarCard[]): [string, CalendarCard[]][] {
  const map = new Map<string, CalendarCard[]>();
  for (const c of cards) map.set(c.date, [...(map.get(c.date) ?? []), c]);
  return [...map.entries()];
}
function emptyText(view: CalendarView): string {
  return view === "published" ? "Aucune publication publiée pour ces filtres ce mois-ci."
    : view === "upcoming" ? "Rien de prévu pour ces filtres ce mois-ci."
    : "Rien à traiter pour ces filtres ce mois-ci.";
}
