import Link from "next/link";
import { Panel } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/states";
import { formatDate } from "@/lib/format-date";
import { platformLabels } from "@/lib/publications/editor";
import type { PublicationProjectOption } from "@/lib/publications/project-channels";
import { driveFileUrl, driveFolderUrl, maskSender, statusLabels } from "@/lib/whatsapp/library-model";
import type { LibraryItem } from "@/lib/whatsapp/library";
import { libraryStatuses, type LibraryStatus } from "@/lib/whatsapp/types";
import { MediaLibraryForm, type LibraryCard } from "./media-library-form";

const size = (bytes: number) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} Mo` : `${Math.max(1, Math.round(bytes / 1024))} Ko`;

/** Photothèque du client : médias WhatsApp importés dans son dossier Drive, jamais ceux d'un autre client. */
export function MediaLibraryPanel({ clientId, items, folders, projects, status, unavailable }: { clientId: string; items: LibraryItem[]; folders: string[]; projects: PublicationProjectOption[]; status: LibraryStatus | null; unavailable: boolean }) {
  const href = (value: LibraryStatus | null) => `/clients/${clientId}?tab=media${value ? `&status=${value}` : ""}`;
  const cards: LibraryCard[] = items.map(item => {
    const received = item.received_at ?? item.imported_at ?? item.created_at;
    return {
      id: item.id, kind: item.media_kind, status: item.library_status, thumbnailUrl: item.thumbnailUrl,
      previewHref: `/api/media-library/${clientId}/${item.id}`, driveHref: driveFileUrl(item.drive_file_id),
      receivedIso: received, receivedLabel: formatDate(received), caption: item.caption, sender: maskSender(item.sender), sizeLabel: size(item.size),
      uses: item.uses.map(use => ({ id: use.id, label: `${use.subject ?? "Publication"} · ${platformLabels[use.platform]}`, href: `/publications/${use.publication_id}`, date: formatDate(use.used_at) })),
    };
  });
  return <section aria-labelledby="client-media" className="space-y-6">
    <Panel className="p-5">
      <h2 id="client-media" className="font-semibold">Photothèque</h2>
      <p className="mt-1 text-sm text-muted">Photos et vidéos envoyées par le client sur WhatsApp, conservées sans modification dans son dossier Drive privé. Les numéros inconnus restent en attente dans <Link className="text-accent" href="/settings/whatsapp">Médias WhatsApp</Link>.</p>
      {folders.length > 0 && <p className="mt-2 text-sm">Dossier{folders.length > 1 ? "s" : ""} Drive : {folders.map((folder, index) => <span key={folder}>{index > 0 && " · "}<a className="text-accent" href={driveFolderUrl(folder)} target="_blank" rel="noreferrer">{folder.slice(0, 10)}…</a></span>)}</p>}
      <nav aria-label="Filtrer par statut" className="mt-4 flex flex-wrap gap-2 text-sm">
        <Link href={href(null)} aria-current={!status ? "page" : undefined} className={!status ? "font-medium text-foreground" : "text-accent"}>Tous (hors archivés)</Link>
        {libraryStatuses.map(value => <Link key={value} href={href(value)} aria-current={status === value ? "page" : undefined} className={status === value ? "font-medium text-foreground" : "text-accent"}>{statusLabels[value]}</Link>)}
      </nav>
    </Panel>
    {unavailable ? <Panel className="p-5" ><p role="alert">Photothèque indisponible : appliquez la migration de la photothèque WhatsApp.</p></Panel>
      : cards.length ? <MediaLibraryForm clientId={clientId} cards={cards} projects={projects.map(p => ({ id: p.id, name: p.name, platforms: p.platforms.map(platform => ({ id: platform, label: platformLabels[platform] })) }))} />
      : <EmptyState compact icon="clients" title="Aucun média dans cette vue." description={folders.length ? "Les médias apparaissent ici dès leur import dans Drive." : "Associez d’abord le numéro WhatsApp du client à un dossier Drive."} action={<Link className="text-accent" href="/settings/whatsapp">Configurer WhatsApp</Link>} />}
  </section>;
}
