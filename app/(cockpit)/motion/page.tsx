import Link from "next/link";
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/require-admin";
import { PageHeading, Panel, Badge } from "@/components/ui/primitives";
import { listMotionProjects, listMotionSources } from "@/lib/motion/service";
import { motionSourceKey } from "@/lib/motion/model";
import { createMotionDraftAction } from "./actions";

export const metadata:Metadata={title:"Studio Motion"};
export default async function MotionPage({searchParams}:{searchParams:Promise<{error?:string}>}){
 await requireAdmin();
 const [sources,stored,search]=await Promise.all([listMotionSources(),listMotionProjects(),searchParams]);
 const enabled=stored.ready && sources.length>0;
 return <>
  <PageHeading eyebrow="Production audiovisuelle" title="Studio Motion"
   description="Préparez de véritables briefs vidéo avec les ressources Drive des clients. Les compositions Claude/Remotion, la prévisualisation MP4 et la livraison seront raccordées séparément." />
  {!stored.ready&&<p role="alert" className="mb-5 rounded-xl border border-warning/40 p-4 text-sm">Stockage du Studio Motion non installé : la migration dédiée doit être appliquée après validation de la PR. Aucun brief ne peut être sauvegardé pour le moment.</p>}
  {!sources.length&&<p role="status" className="mb-5 rounded-xl border border-border p-4 text-sm">Aucun dossier Drive client avec droits confirmés. Configurez d&apos;abord un dossier via les Publications ou les associations WhatsApp autorisées.</p>}
  {search.error&&<p role="alert" className="mb-5 rounded-xl border border-border p-4 text-sm">{search.error==="invalid"?"Brief incomplet ou invalide. Vérifiez les informations saisies.":"Enregistrement non confirmé. Vérifiez la configuration du stockage Motion."}</p>}
  <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(260px,1fr)]">
   <Panel className="p-6">
    <h2 className="text-lg font-semibold">Nouvelle création</h2>
    <p className="mt-2 text-sm text-muted">Le brief est enregistré comme brouillon. Aucune IA ni service externe ne sera lancé à cette étape.</p>
    <form action={createMotionDraftAction} className="mt-5 grid gap-4">
     <label className="grid gap-2 text-sm font-medium">Client et dossier Google Drive
      <select name="source_key" required defaultValue="" disabled={!enabled} className="w-full rounded-lg border border-border bg-surface p-3">
       <option value="" disabled>Choisir un dossier autorisé</option>
       {sources.map(s=><option key={motionSourceKey(s)} value={motionSourceKey(s)}>{s.clientName} — {s.label} (…{s.folderId.slice(-6)})</option>)}
      </select>
     </label>
     <label className="grid gap-2 text-sm font-medium">Titre du projet
      <input name="title" minLength={5} maxLength={160} required disabled={!enabled} className="w-full rounded-lg border border-border bg-surface p-3" placeholder="Ex. Vidéo conseil : prévenir une infestation" />
     </label>
     <label className="grid gap-2 text-sm font-medium">Brief créatif
      <textarea name="brief" rows={5} minLength={20} maxLength={6000} required disabled={!enabled} className="w-full rounded-lg border border-border bg-surface p-3" placeholder="Objectif, cible, message, scènes souhaitées, ton et informations vérifiées…" />
     </label>
     <label className="grid gap-2 text-sm font-medium">Direction artistique
      <textarea name="brand_direction" rows={3} maxLength={4000} disabled={!enabled} className="w-full rounded-lg border border-border bg-surface p-3" placeholder="Contraintes de marque, références, couleurs et style. Ne rien inventer." />
     </label>
     <div className="grid gap-4 sm:grid-cols-2">
      <label className="grid gap-2 text-sm font-medium">Durée
       <select name="duration_seconds" defaultValue="20" disabled={!enabled} className="rounded-lg border border-border bg-surface p-3">
        {[10,15,20,30,45,60,90].map(n=><option key={n} value={n}>{n} secondes</option>)}
       </select>
      </label>
      <label className="grid gap-2 text-sm font-medium">Format
       <select name="aspect_ratio" defaultValue="9:16" disabled={!enabled} className="rounded-lg border border-border bg-surface p-3">
        <option value="9:16">Vertical · 9:16</option><option value="16:9">Horizontal · 16:9</option><option value="1:1">Carré · 1:1</option>
       </select>
      </label>
      <label className="grid gap-2 text-sm font-medium">Moteur envisagé
       <select name="engine" defaultValue="remotion" disabled={!enabled} className="rounded-lg border border-border bg-surface p-3">
        <option value="remotion">Claude + Remotion</option><option value="freeform">Claude en création libre</option>
       </select>
      </label>
      <label className="grid gap-2 text-sm font-medium">Voix
       <select name="voice_mode" defaultValue="none" disabled={!enabled} className="rounded-lg border border-border bg-surface p-3">
        <option value="none">Sans voix générée</option><option value="elevenlabs">ElevenLabs — à connecter</option>
       </select>
      </label>
     </div>
     <button type="submit" disabled={!enabled} className="rounded-lg bg-accent-strong px-5 py-3 text-sm font-semibold text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50">Enregistrer le brief</button>
    </form>
   </Panel>
   <div className="space-y-5">
    <Panel className="p-6">
     <h2 className="font-semibold">Parcours de production</h2>
     <ol className="mt-4 list-inside list-decimal space-y-2 text-sm text-muted">
      <li>Brief et ressources Drive — socle en préparation</li>
      <li>Story-board et animation par Claude — à développer</li>
      <li>Rendu et contrôles Remotion — à développer</li>
      <li>Prévisualisation et corrections — à développer</li>
      <li>Validation et dépôt MP4 sur Drive — à développer</li>
     </ol>
    </Panel>
    <Panel className="p-6">
     <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Briefs enregistrés</h2><Badge>{stored.projects.length}</Badge></div>
     {stored.projects.length ? <ul className="mt-4 space-y-3">{stored.projects.map(p=>
      <li key={p.id} className="border-b border-border pb-3 last:border-0">
       <Link className="text-sm font-semibold text-accent hover:underline" href={"/motion/"+p.id}>{p.title}</Link>
       <p className="mt-1 text-xs text-muted">{sources.find(s=>s.clientId===p.client_id)?.clientName??"Client à vérifier"} · {p.duration_seconds} s · {p.aspect_ratio} · Brouillon</p>
      </li>)}</ul>:<p className="mt-3 text-sm text-muted">Aucun brief enregistré.</p>}
    </Panel>
   </div>
  </div>
 </>;
}
