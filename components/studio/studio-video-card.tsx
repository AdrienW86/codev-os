"use client";
import Link from "next/link";
import { useActionState } from "react";
import { createTikTokDraftAction, deleteStudioVideoAction, type StudioActionState } from "@/app/(cockpit)/studio/actions";
import { suggestedCaption, type StudioVideo } from "@/lib/studio/model";

const initial: StudioActionState = {};
export function StudioVideoCard({ video }: { video: StudioVideo }) {
  const [tiktok, sendTikTok, tiktokPending] = useActionState(createTikTokDraftAction, initial);
  const [removed, remove, removing] = useActionState(deleteStudioVideoAction, initial);
  const publicationId = tiktok.publicationId ?? video.lastPublicationId;
  return <article className="space-y-3 rounded-xl border border-border p-4" data-studio-video={video.id}>
    {video.url ? <video src={video.url} controls playsInline preload="metadata" className="aspect-[9/16] w-full rounded-lg bg-black" aria-label={`Vidéo ${video.title}`} />
      : <div className="flex aspect-[9/16] items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted">Aperçu indisponible</div>}
    <div><h3 className="font-semibold break-words">{video.title}</h3>
      <p className="text-xs text-muted">{Math.round(video.durationSeconds)} s · {(video.sizeBytes / 1048576).toFixed(1)} Mo · {new Date(video.createdAt).toLocaleDateString("fr-FR")}</p></div>
    {video.url && <a href={video.url} download={`${video.title}.mp4`} className="inline-block rounded-lg border border-border px-3 py-1.5 text-sm">Télécharger</a>}
    <details className="text-sm"><summary className="cursor-pointer">Créer une publication TikTok</summary>
      <form action={sendTikTok} className="mt-2 space-y-2"><input type="hidden" name="video_id" value={video.id} />
        <label className="block text-xs text-muted">Texte de la publication (modifiable)<textarea name="caption" rows={4} maxLength={2200} defaultValue={suggestedCaption(video.script)} className="mt-1 block w-full rounded-lg border border-border bg-background p-2 text-sm" /></label>
        <button disabled={tiktokPending} className="rounded-lg border border-border px-3 py-1.5">{tiktokPending ? "Préparation…" : "Préparer le brouillon TikTok"}</button>
        <p className="text-xs text-muted">Un brouillon est créé dans Publications : vous le planifiez et le validez avant toute diffusion.</p>
      </form>
      {tiktok.message && <p role="status" className="mt-1 text-xs">{tiktok.message}</p>}
    </details>
    {publicationId && <p className="text-xs"><Link href={`/publications/${publicationId}`} className="text-accent underline">Voir la publication TikTok</Link></p>}
    <form action={remove}><input type="hidden" name="video_id" value={video.id} />
      <button disabled={removing} className="text-xs text-danger">{removing ? "Suppression…" : "Supprimer la vidéo"}</button>
      {removed.message && !removed.ok && <span role="status" className="ml-2 text-xs">{removed.message}</span>}</form>
  </article>;
}
