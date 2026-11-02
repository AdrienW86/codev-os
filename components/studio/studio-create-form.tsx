"use client";
/* eslint-disable @next/next/no-img-element -- Aperçus privés servis par la route authentifiée de la photothèque. */
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type Photo = { id: string; caption: string | null; date: string };
const input = "mt-1 block w-full rounded-lg border border-border bg-background p-2 text-sm";

// Formulaire de création : envoi multipart vers la route de rendu (même origine), qui a sa propre durée maximale.
export function StudioCreateForm({ clientId, clientName, photos, maxPhotos, paces }: { clientId: string; clientName: string; photos: Photo[]; maxPhotos: number; paces: { value: string; label: string }[] }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [uploads, setUploads] = useState(0);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const total = selected.length + uploads;
  const toggle = (id: string) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : s.length + uploads >= maxPhotos ? s : [...s, id]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    for (const id of selected) data.append("library_asset", id);
    setPending(true); setMessage(null);
    try {
      const response = await fetch("/api/studio/videos", { method: "POST", body: data, cache: "no-store" });
      const body = await response.json().catch(() => null) as { ok?: boolean; message?: string } | null;
      setMessage({ ok: Boolean(body?.ok), text: body?.message ?? "La vidéo n’a pas pu être créée." });
      if (body?.ok) { formRef.current?.reset(); setSelected([]); setUploads(0); router.refresh(); }
    } catch { setMessage({ ok: false, text: "Connexion interrompue : la vidéo n’a pas pu être créée." }); }
    finally { setPending(false); }
  }
  return <form ref={formRef} onSubmit={submit} className="mt-4 grid gap-4 md:grid-cols-2" data-studio-create="true">
    <input type="hidden" name="client_id" value={clientId} />
    <label className="block text-sm md:col-span-2">Titre (interne)<input name="title" required maxLength={160} className={input} placeholder="Ex. Toiture Villeurbanne – octobre" /></label>
    <label className="block text-sm md:col-span-2">Accroche (première scène)<input name="headline" required maxLength={160} className={input} placeholder="Ex. Toiture refaite à neuf en 3 jours" /></label>
    <label className="block text-sm md:col-span-2">Légendes, une par ligne (une par photo suivante, facultatives)<textarea name="captions" rows={4} maxLength={2000} className={input} /></label>
    <label className="block text-sm">Phrase de fin (facultative)<input name="closing" maxLength={160} className={input} placeholder="Ex. Demandez votre devis" /></label>
    <label className="block text-sm">Nom affiché<input name="brand" maxLength={60} defaultValue={clientName} className={input} /></label>
    <label className="block text-sm">Rythme<select name="pace" defaultValue="standard" className={input}>{paces.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select></label>
    <label className="block text-sm">Ajouter des photos (JPEG, PNG, WebP, 8 Mo au plus)<input type="file" name="photos" multiple accept="image/jpeg,image/png,image/webp" className={input}
      onChange={(e) => setUploads(e.currentTarget.files?.length ?? 0)} /></label>
    <fieldset className="md:col-span-2">
      <legend className="text-sm">Photothèque du client <span className="text-xs text-muted">({total}/{maxPhotos} photos, dans l’ordre de sélection : la première sert d’accroche)</span></legend>
      {photos.length ? <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">{photos.map((p) => {
        const index = selected.indexOf(p.id);
        return <button key={p.id} type="button" onClick={() => toggle(p.id)} aria-pressed={index >= 0} title={p.caption ?? p.date}
          className={`relative overflow-hidden rounded-lg border ${index >= 0 ? "border-accent ring-2 ring-accent" : "border-border"}`}>
          <img src={`/api/media-library/${clientId}/${p.id}`} alt={p.caption ?? `Photo du ${p.date}`} loading="lazy" className="aspect-square w-full object-cover" />
          {index >= 0 && <span className="absolute left-1 top-1 rounded-full bg-accent px-2 text-xs font-semibold text-background">{index + 1}</span>}
        </button>;
      })}</div> : <p className="mt-2 text-xs text-muted">Aucune photo validée dans la photothèque : ajoutez des fichiers ci-dessus.</p>}
    </fieldset>
    <div className="md:col-span-2 flex flex-wrap items-center gap-3">
      <button disabled={pending || total < 1} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-background disabled:opacity-60">{pending ? "Création de la vidéo… (jusqu’à 1 minute)" : "Créer la vidéo"}</button>
      {message && <p role="status" className={`text-sm ${message.ok ? "" : "text-danger"}`}>{message.text}</p>}
    </div>
    <p className="md:col-span-2 text-xs text-muted">Seuls vos textes et les photos choisies apparaissent dans la vidéo. Emojis, hashtags et liens ne sont pas affichés à l’image.</p>
  </form>;
}
