"use client";
import Link from "next/link";
import { useActionState } from "react";
import { createVideoDraftAction, deleteStudioVideoAction, type StudioActionState } from "@/app/(cockpit)/studio/actions";
import { suggestedCaption, type StudioVideo } from "@/lib/studio/model";

const initial: StudioActionState = {};
// Réseaux qui reçoivent une vidéo du Studio : TikTok (vidéo) et Snapchat (Spotlight, description courte).
const NETWORKS = [
  { platform: "tiktok", label: "TikTok", maxText: 2200, hint: "" },
  { platform: "snapchat", label: "Snapchat", maxText: 160, hint: "Publiée en Spotlight sur le profil public Snapchat du client ; le texte sert de description (160 caractères au plus)." },
] as const;

function DraftForm({ video, network }: { video: StudioVideo; network: (typeof NETWORKS)[number] }) {
  const [state, send, pending] = useActionState(createVideoDraftAction, initial);
  return <details className="text-sm" data-studio-network={network.platform}><summary className="cursor-pointer">Créer une publication {network.label}</summary>
    <form action={send} className="mt-2 space-y-2"><input type="hidden" name="video_id" value={video.id} /><input type="hidden" name="platform" value={network.platform} />
      <label className="block text-xs text-muted">Texte de la publication (modifiable)<textarea name="caption" rows={network.maxText > 300 ? 4 : 2} maxLength={network.maxText} defaultValue={suggestedCaption(video.script, network.maxText)} className="mt-1 block w-full rounded-lg border border-border bg-background p-2 text-sm" /></label>
      {network.hint && <p className="text-xs text-muted">{network.hint}</p>}
      <button disabled={pending} className="rounded-lg border border-border px-3 py-1.5">{pending ? "Préparation…" : `Préparer le brouillon ${network.label}`}</button>
      <p className="text-xs text-muted">Un brouillon est créé dans Publications : vous le planifiez et le validez avant toute diffusion.</p>
    </form>
    {state.message && <p role="status" className="mt-1 text-xs">{state.message}</p>}
    {state.publicationId && <p className="mt-1 text-xs"><Link href={`/publications/${state.publicationId}`} className="text-accent underline">Voir la publication {network.label}</Link></p>}
  </details>;
}
export function StudioVideoCard({ video }: { video: StudioVideo }) {
  const [removed, remove, removing] = useActionState(deleteStudioVideoAction, initial);
  return <article className="space-y-3 rounded-xl border border-border p-4" data-studio-video={video.id}>
    {video.url ? <video src={video.url} controls playsInline preload="metadata" className="aspect-[9/16] w-full rounded-lg bg-black" aria-label={`Vidéo ${video.title}`} />
      : <div className="flex aspect-[9/16] items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted">Aperçu indisponible</div>}
    <div><h3 className="font-semibold break-words">{video.title}</h3>
      <p className="text-xs text-muted">{Math.round(video.durationSeconds)} s · {(video.sizeBytes / 1048576).toFixed(1)} Mo · {new Date(video.createdAt).toLocaleDateString("fr-FR")}</p></div>
    {video.url && <a href={video.url} download={`${video.title}.mp4`} className="inline-block rounded-lg border border-border px-3 py-1.5 text-sm">Télécharger</a>}
    {NETWORKS.map((network) => <DraftForm key={network.platform} video={video} network={network} />)}
    {video.lastPublicationId && <p className="text-xs"><Link href={`/publications/${video.lastPublicationId}`} className="text-accent underline">Voir la dernière publication créée</Link></p>}
    <form action={remove}><input type="hidden" name="video_id" value={video.id} />
      <button disabled={removing} className="text-xs text-danger">{removing ? "Suppression…" : "Supprimer la vidéo"}</button>
      {removed.message && !removed.ok && <span role="status" className="ml-2 text-xs">{removed.message}</span>}</form>
  </article>;
}
