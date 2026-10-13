import { safeRead } from "@/lib/core/safe-read";
import { currentExportImport, exportFolderReady } from "@/lib/whatsapp/export-import";
import { getMediaProfile } from "@/lib/media-intelligence/service";
import { clientFolders, clientReuseSettings, libraryServiceOptions, searchClientLibrary } from "@/lib/whatsapp/library";
import type { LibraryFilters } from "@/lib/whatsapp/library-filters";
import { publicationProjectOptions } from "@/lib/publications/project-channels";
import { MediaLibraryPanel } from "./media-library-panel";

/** Onglet Photothèque de la fiche client : page filtrée côté serveur, profil média, import d'export WhatsApp. */
export async function MediaTab({ clientId, projects, filters }: { clientId: string; projects: { id: string; client_id: string; name: string; type: string | null }[]; filters: LibraryFilters }) {
  const [library, folders, options, profile, reuse] = await Promise.all([
    safeRead("media-library", () => searchClientLibrary(clientId, filters), { items: [], total: 0, searchable: false }),
    safeRead("media-library-folders", () => clientFolders(clientId), []),
    safeRead("media-library-projects", () => publicationProjectOptions(projects), []),
    safeRead("media-library-profile", () => getMediaProfile(clientId), null),
    safeRead("media-library-reuse", () => clientReuseSettings(clientId), { allowed: false, afterDays: 180 }),
  ]);
  const services = await safeRead("media-library-services", () => libraryServiceOptions(clientId, profile.data?.services ?? []), []);
  // Import d'export WhatsApp (socle lot 3) : indisponible tant que sa migration n'est pas appliquée.
  const exportImport = await safeRead("media-export-import", async () => {
    const [current, folderReady] = await Promise.all([currentExportImport(clientId), exportFolderReady(clientId)]);
    return { current: current ? { id: current.id, status: current.status } : null, folderReady };
  }, null);
  return <MediaLibraryPanel clientId={clientId} page={library.data} filters={filters} services={services.data} reuse={reuse.data} folders={folders.data} projects={options.data}
    unavailable={library.unavailable} profile={profile.data} exportImport={exportImport.data} />;
}
