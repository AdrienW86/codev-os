import Link from "next/link";
import { Panel } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { formatDate } from "@/lib/format-date";
import { platformLabels } from "@/lib/publications/editor";
import type { PublicationProjectOption } from "@/lib/publications/project-channels";
import { driveFileUrl, driveFolderUrl, maskSender, statusLabels } from "@/lib/whatsapp/library-model";
import type { LibraryItem, LibraryPage, ReuseSettings } from "@/lib/whatsapp/library";
import { LIBRARY_PAGE_SIZE, activeFilterCount, defaultFilters, libraryHref, originLabels, statusViewLabels, statusViews, type LibraryFilters } from "@/lib/whatsapp/library-filters";
import { reuseState } from "@/lib/whatsapp/usage-history";
import { SENSITIVE_LABELS, type MediaProfile, type SensitiveKind } from "@/lib/media-intelligence/model";
import { exclusionReasons } from "@/lib/media-intelligence/exclusion";
import { MediaLibraryForm, type LibraryCard } from "./media-library-form";
import { MediaMaintenance, MediaProfileForm } from "./media-profile-form";
import { WhatsAppExportImport } from "./whatsapp-export-import";

const size = (bytes: number) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} Mo` : `${Math.max(1, Math.round(bytes / 1024))} Ko`;
const field = "block w-full rounded-lg border border-border bg-background p-2.5 text-sm";
const deliveryLabels: Record<string, string> = { scheduled: "programmée", processing: "en cours d’envoi", published: "publiée", retryable_error: "en reprise", uncertain: "à vérifier", blocked: "bloquée", cancelled: "annulée" };
const publicationLabels: Record<string, string> = { draft: "brouillon", in_review: "en relecture", approved: "approuvée", rejected: "refusée", scheduled: "programmée", published: "publiée", archived: "archivée" };
// Auteur d'une décision : identifiant Clerk raccourci (aucun nom n'est stocké dans la photothèque).
const author = (id: string | null | undefined) => id && /^user_/.test(id) ? `administrateur …${id.slice(-6)}` : id === "ai_classification" ? "analyse automatique" : "système";

function card(clientId: string, item: LibraryItem, reuse: ReuseSettings, now: Date): LibraryCard {
  const origin = item.captured_at ?? item.received_at ?? item.imported_at ?? item.created_at;
  const originKind = item.captured_at ? "Prise le" : item.received_at ? "Reçue le" : "Importée le";
  const state = reuseState(item.history, reuse, now);
  const why = exclusionReasons({
    libraryStatus: item.library_status, mediaKind: item.media_kind, mimeType: item.mime_type, size: item.size, width: item.width, height: item.height, purged: Boolean(item.purged_at),
    claimed: Boolean(item.claimed_agent_v2_run_id), statusChangedBy: item.status_changed_by, statusChangedAt: item.status_changed_at,
    classificationFailures: item.classification_failures ?? 0, classificationFailedAt: item.classification_failed_at ?? null,
    assessment: item.assessment ? { ...item.assessment, reviewed_by: item.assessment.reviewed_by ?? null, reviewed_at: item.assessment.reviewed_at ?? null } : null,
    uses: item.history.map(use => ({ used_at: use.usedAt })), reuse, now,
  });
  const decisions = item.decisions.map(d => ({ id: d.id, label: d.kind === "caption" ? "Légende modifiée" : `${d.from_status ? statusLabels[d.from_status] : "?"} → ${d.to_status ? statusLabels[d.to_status] : "?"}${d.kind === "reclassify" ? " (reclassement)" : ""}`, reason: d.reason, by: author(d.actor_id), date: formatDate(d.created_at) }));
  const manual = item.assessment?.manual_verdict === "relevant" ? "pertinente" : item.assessment?.manual_verdict === "off_topic" ? "hors sujet" : null;
  return {
    id: item.id, kind: item.media_kind, status: item.library_status, thumbnailUrl: item.thumbnailUrl,
    previewHref: `/api/media-library/${clientId}/${item.id}`, driveHref: driveFileUrl(item.drive_file_id),
    originLabel: originLabels[item.origin] ?? item.origin, originDateIso: origin, originDateLabel: `${originKind} ${formatDate(origin)}`, caption: item.caption,
    captionEdited: item.caption_edited_at ? `Légende modifiée par ${author(item.caption_edited_by)} le ${formatDate(item.caption_edited_at)}` : null,
    sender: item.origin === "drive" ? null : maskSender(item.sender), sizeLabel: size(item.size), topics: item.assessment?.topics ?? [],
    ai: item.assessment ? { verdict: item.assessment.verdict, relevance: item.assessment.business_relevance, publishability: item.assessment.publishability, sensitive: item.assessment.sensitive.filter((kind): kind is SensitiveKind => kind in SENSITIVE_LABELS), confidential: item.assessment.confidential, description: item.assessment.description,
      reviewed: item.assessment.manual_verdict !== null, reviewedLabel: manual && item.assessment.reviewed_at ? `Verdict humain « ${manual} » par ${author(item.assessment.reviewed_by)} le ${formatDate(item.assessment.reviewed_at)}` : null } : null,
    statusBy: item.status_changed_by ? `${statusLabels[item.library_status]} · ${author(item.status_changed_by)} · ${formatDate(item.status_changed_at)}` : null,
    uses: item.history.map((use, index) => ({ id: `${use.publicationId}:${use.platform}:${index}`, label: `${use.subject ?? "Publication"} · ${platformLabels[use.platform]}`, href: `/publications/${use.publicationId}`, date: formatDate(use.usedAt),
      state: use.deliveryStatus === "published" && use.publishedAt ? `publiée le ${formatDate(use.publishedAt)}` : use.deliveryStatus ? deliveryLabels[use.deliveryStatus] ?? use.deliveryStatus : use.archived ? "archivée" : use.publicationStatus ? publicationLabels[use.publicationStatus] ?? use.publicationStatus : null })),
    reuse: state.reason === "never_used" ? null : state.reason === "reuse_disabled" ? "Réemploi désactivé pour ce client." : state.reason === "too_recent" ? `Réemploi possible à partir du ${formatDate(state.reusableFrom)}.` : "Réemploi permis par le réglage du client.",
    eligible: why.eligible, reasons: why.reasons.map(r => ({ code: r.code, label: r.label, blocking: r.blocking })), decisions,
  };
}

/** Photothèque du client : photos de ses dossiers Drive (WhatsApp, export, dépôts manuels), jamais celles d'un autre client. */
export function MediaLibraryPanel({ clientId, page, filters, services, reuse, folders, projects, unavailable, profile, exportImport = null }: {
  clientId: string; page: LibraryPage; filters: LibraryFilters; services: string[]; reuse: ReuseSettings; folders: string[]; projects: PublicationProjectOption[]; unavailable: boolean; profile: MediaProfile | null;
  exportImport?: { current: { id: string; status: string } | null; folderReady: boolean } | null;
}) {
  const now = new Date();
  const cards = page.items.map(item => card(clientId, item, reuse, now));
  const pages = Math.max(1, Math.ceil(page.total / LIBRARY_PAGE_SIZE));
  const filtered = activeFilterCount(filters) > 0;
  return <section aria-labelledby="client-media" className="space-y-6">
    <Panel className="p-4 sm:p-5">
      <h2 id="client-media" className="font-semibold">Photothèque</h2>
      <p className="mt-1 text-sm text-muted">Photos et vidéos du client — WhatsApp, export de discussion, dossier Drive — conservées sans modification dans son Drive privé, chacune une seule fois. Les numéros inconnus restent en attente dans <Link className="text-accent" href="/settings/whatsapp">Médias WhatsApp</Link>.</p>
      {folders.length > 0 && <p className="mt-2 flex flex-wrap gap-x-3 text-sm">{folders.map((folder, index) => <a key={folder} className="text-accent hover:underline" href={driveFolderUrl(folder)} target="_blank" rel="noreferrer">{folders.length > 1 ? `Ouvrir le dossier Drive ${index + 1}` : "Ouvrir le dossier Drive"}</a>)}</p>}
      {profile ? <div className="mt-4 space-y-3">
        <MediaMaintenance clientId={clientId} profileSaved={profile.saved} />
        <MediaProfileForm clientId={clientId} profile={profile} />
      </div> : <p className="mt-4 text-sm text-muted">Analyse IA indisponible : appliquez la migration de la photothèque intelligente.</p>}
      <div className="mt-4">{exportImport ? <WhatsAppExportImport clientId={clientId} current={exportImport.current} folderReady={exportImport.folderReady} />
        : <p className="text-sm text-muted">Import d’export WhatsApp indisponible : appliquez la migration de l’import d’historique.</p>}</div>
    </Panel>
    <Panel className="p-4 sm:p-5">
      <nav aria-label="Filtrer par statut" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 text-sm sm:flex-wrap sm:overflow-visible">
        {statusViews.map(view => <Link key={view} href={libraryHref(clientId, filters, { status: view })} aria-current={filters.status === view ? "page" : undefined}
          className={`shrink-0 rounded-full border px-3 py-1.5 ${filters.status === view ? "border-accent font-medium text-foreground" : "border-border text-accent"}`}>{view === "active" ? "En cours" : statusViewLabels[view]}</Link>)}
      </nav>
      {page.searchable ? <form method="get" action={`/clients/${clientId}`} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" role="search" aria-label="Rechercher dans la photothèque">
        <input type="hidden" name="tab" value="media" />
        {filters.status !== "active" && <input type="hidden" name="status" value={filters.status} />}
        <label className="text-sm">Origine<select name="origin" defaultValue={filters.origin ?? ""} className={field}><option value="">Toutes</option>{Object.entries(originLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="text-sm">Service ou sujet<input name="service" list={`media-services-${clientId}`} defaultValue={filters.service ?? ""} maxLength={120} className={field} placeholder="Ex. toiture, gouttière" />
          <datalist id={`media-services-${clientId}`}>{services.map(service => <option key={service} value={service} />)}</datalist></label>
        <label className="text-sm">Recherche libre<input name="q" type="search" defaultValue={filters.q ?? ""} maxLength={120} className={field} placeholder="Description, légende, publication" /></label>
        <label className="text-sm">Déjà utilisée<select name="used" defaultValue={filters.used ?? ""} className={field}><option value="">Indifférent</option><option value="yes">Oui</option><option value="no">Jamais utilisée</option></select></label>
        <label className="text-sm">Date d’origine, du<input name="from" type="date" defaultValue={filters.from ?? ""} className={field} /></label>
        <label className="text-sm">au<input name="to" type="date" defaultValue={filters.to ?? ""} className={field} /></label>
        <div className="flex items-end gap-3 sm:col-span-2"><button type="submit" className="min-h-11 rounded-lg border border-border bg-surface-raised px-4 text-sm font-medium">Filtrer</button>
          {filtered && <Link className="min-h-11 content-center text-sm text-accent" href={libraryHref(clientId, defaultFilters)}>Effacer les filtres</Link>}</div>
      </form> : !unavailable && <p className="mt-3 text-sm text-muted">Recherche avancée indisponible : appliquez la migration des outils de la photothèque. Seul le filtre de statut s’applique.</p>}
      {!unavailable && <p className="mt-4 text-sm text-muted" role="status">{page.total} photo(s){filtered ? " correspondant aux filtres" : ""}{pages > 1 ? ` · page ${filters.page + 1} sur ${pages}` : ""}. La date d’origine est la date de prise de vue, sinon de réception.</p>}
    </Panel>
    {unavailable ? <Panel className="p-5"><p role="alert">Photothèque indisponible : appliquez la migration de la photothèque WhatsApp.</p></Panel>
      : cards.length ? <>
        <MediaLibraryForm clientId={clientId} cards={cards} reuseAllowed={reuse.allowed} projects={projects.map(p => ({ id: p.id, name: p.name, platforms: p.platforms.map(platform => ({ id: platform, label: platformLabels[platform] })) }))} />
        {pages > 1 && <nav aria-label="Pages de la photothèque" className="flex items-center justify-between gap-3 text-sm">
          {filters.page > 0 ? <Link className="min-h-11 content-center text-accent" href={libraryHref(clientId, filters, { page: filters.page - 1 })}>← Page précédente</Link> : <span />}
          <span className="text-muted">{filters.page + 1} / {pages}</span>
          {filters.page + 1 < pages ? <Link className="min-h-11 content-center text-accent" href={libraryHref(clientId, filters, { page: filters.page + 1 })}>Page suivante →</Link> : <span />}
        </nav>}
      </>
      : <EmptyState compact icon="clients" title={filtered ? "Aucune photo ne correspond à ces filtres." : "Aucun média dans cette vue."} description={folders.length ? "Les médias apparaissent ici dès leur import dans Drive." : "Associez d’abord le numéro WhatsApp du client à un dossier Drive."} action={<Link className="text-accent" href="/settings/whatsapp">Configurer WhatsApp</Link>} />}
  </section>;
}
