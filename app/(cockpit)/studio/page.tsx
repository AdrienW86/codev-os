import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/require-admin";
import { listClients } from "@/lib/clients/data";
import { listStudioVideos, studioLibraryPhotos } from "@/lib/studio/videos";
import { MOTION_MAX_PHOTOS, MOTION_PACES } from "@/lib/motion/video/storyboard";
import { PageHeading, Panel } from "@/components/ui/primitives";
import { StudioCreateForm } from "@/components/studio/studio-create-form";
import { StudioVideoCard } from "@/components/studio/studio-video-card";

export const metadata: Metadata = { title: "Studio vidéo" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Studio vidéo : création de vidéos motion design par client, indépendante des publications. Une vidéo peut ensuite
// servir à préparer une publication TikTok ou Snapchat (brouillon), validée comme toute publication.
export default async function StudioPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const params = await searchParams;
  const clients = await listClients();
  const requested = typeof params.client === "string" && uuid.test(params.client) ? params.client : null;
  const client = clients.find((c) => c.id === requested) ?? null;
  const [videos, photos] = client ? await Promise.all([listStudioVideos(client.id), studioLibraryPhotos(client.id)]) : [null, []];
  return <>
    <PageHeading eyebrow="Création" title="Studio vidéo" description="Vidéos motion design verticales (9:16) à partir des photos de vos clients et de vos textes. Rien n’est publié sans votre action." />
    <Panel className="mb-6 p-4">
      <form className="flex flex-wrap items-end gap-3 text-sm" action="/studio">
        <label className="block">Client<select name="client" defaultValue={client?.id ?? ""} className="mt-1 block rounded-lg border border-border bg-background p-2">
          <option value="" disabled>Choisir un client</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <button className="rounded-lg border border-border px-4 py-2">Ouvrir</button>
      </form>
    </Panel>
    {!client ? <Panel className="p-6 text-sm text-muted">Choisissez un client pour créer une vidéo ou retrouver ses vidéos.</Panel> : <>
      <Panel className="mb-6 p-6">
        <h2 className="font-semibold">Nouvelle vidéo pour {client.name}</h2>
        <StudioCreateForm clientId={client.id} clientName={client.name} photos={photos} maxPhotos={MOTION_MAX_PHOTOS}
          paces={Object.entries(MOTION_PACES).map(([value, p]) => ({ value, label: p.label }))} />
      </Panel>
      <section aria-labelledby="studio-library">
        <h2 id="studio-library" className="mb-3 font-semibold">Vidéos de {client.name}</h2>
        {videos && !videos.ok ? <Panel className="p-6 text-sm" ><p role="alert">{videos.message}</p></Panel>
          : !videos?.videos.length ? <Panel className="p-6 text-sm text-muted">Aucune vidéo pour l’instant.</Panel>
          : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{videos.videos.map((v) => <StudioVideoCard key={v.id} video={v} />)}</div>}
      </section>
      <p className="mt-6 text-xs text-muted">Les vidéos préparées pour TikTok ou Snapchat apparaissent dans <Link href="/publications" className="text-accent underline">Publications</Link>, en brouillon.</p>
    </>}
  </>;
}
