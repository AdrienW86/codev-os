import Link from "next/link";
import type {ReactNode} from "react";
import {requireAdmin} from "@/lib/require-admin";
import {getSupervision,type SupervisedPublication} from "@/lib/publications/supervision";
import {isFlagEnabled} from "@/lib/system/providers";
import {formatSlot,MIN_AVAILABLE_PHOTOS} from "@/lib/publications/supervision-model";
import {listPublications} from "@/lib/publications/data";
import {buildReviewCards} from "@/lib/publications/review-cards";
import {platformLabels} from "@/lib/publications/editor";
import {Badge,PageHeading,Panel} from "@/components/ui/primitives";
import {PublicationsNav} from "@/components/publications/publications-board";
import {ReviewQueue} from "@/components/publications/review-queue";
import {AgentV2Form} from "@/components/publications/agent-v2-form";
import {RescheduleForm,SuspendClientForm,SuspendDeliveryForm} from "@/components/publications/supervision-forms";

// Socle Publications, lot 7 : supervision de tous les clients. Lecture seule, sauf les actions explicites existantes
// (Approuver, Refuser, Modifier, Générer maintenant) et deux nouvelles (Reprogrammer, Suspendre). Aucune ne publie.
export const dynamic="force-dynamic";
const REVIEW_PREVIEW=5;
const statusLabels={draft:"Brouillon",pending_review:"À valider",approved:"Approuvée",rejected:"Refusée"} as const;
const deliveryLabels={scheduled:"Diffusion programmée",published:"Publiée",error:"Diffusion en erreur",none:"Diffusion non préparée"} as const;

function Section({title,description,children,id}:{title:string;description?:string;children:ReactNode;id:string}){
 return <Panel className="mt-6 p-5"><section aria-labelledby={id}><h2 id={id} className="text-lg font-semibold">{title}</h2>
  {description&&<p className="mt-1 text-sm text-muted">{description}</p>}<div className="mt-4">{children}</div></section></Panel>;
}
function Tile({label,value,href,tone}:{label:string;value:number;href?:string;tone?:"amber"|"green"}){
 const body=<><p className="text-xs text-muted">{label}</p><p className={`mt-1 text-2xl font-semibold ${tone==="amber"&&value>0?"text-warning":tone==="green"?"text-success":""}`}>{value}</p></>;
 return <li className="rounded-xl border border-border bg-surface-raised p-3">{href?<Link href={href} className="block">{body}</Link>:body}</li>;
}
const Empty=({children}:{children:ReactNode})=><p className="text-sm text-muted">{children}</p>;

export default async function PublicationsSupervisionPage(){
 await requireAdmin();const now=new Date();
 // Interrupteur serveur lu par lib/system (présence de la valeur exacte « enabled » uniquement), jamais dans lib/publications.
 const [data,publications]=await Promise.all([getSupervision(now,{scheduledDelivery:isFlagEnabled("publications-scheduled-delivery")}),listPublications()]);
 const cards=await buildReviewCards(publications.filter(p=>p.status==="pending_review").slice(0,REVIEW_PREVIEW),{debug:false});
 const clientName=new Map(data.clients.map(c=>[c.id,c.name]));
 const name=(id:string)=>clientName.get(id)??"Client";
 const s=data.settings;
 const row=(p:SupervisedPublication,actions:boolean)=><li key={p.id} className="flex flex-col gap-2 border-t border-border py-3 first:border-t-0 sm:flex-row sm:items-start sm:justify-between">
  <div className="min-w-0"><p className="text-sm font-medium"><Link href={`/publications/${p.id}`} className="hover:underline">{p.subject}</Link></p>
   <p className="mt-0.5 text-xs text-muted">{name(p.clientId)} · {platformLabels[p.platform]} · {formatSlot(p.scheduledFor)}</p>
   <div className="mt-1 flex flex-wrap gap-1.5"><Badge tone={p.status==="approved"?"green":p.status==="pending_review"?"amber":"neutral"}>{statusLabels[p.status]}</Badge>
    <Badge tone={p.delivery==="error"||p.errorReason?"amber":p.delivery==="published"?"green":"neutral"}>{p.errorReason&&p.delivery==="none"?"Créneau manqué":deliveryLabels[p.delivery]}</Badge></div>
   {p.errorReason&&<p className="mt-1 text-xs text-warning" data-error-reason="true">{p.errorReason}</p>}</div>
  {actions&&<div className="flex flex-wrap items-start gap-2">
   <Link href={`/publications/${p.id}/edit`} className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-border/40">Modifier</Link>
   <RescheduleForm publicationId={p.id} revisionId={p.revisionId} targets={p.targets} approved={p.status==="approved"}/>
   {p.cancellable.length>0&&<SuspendDeliveryForm publicationId={p.id}/>}
  </div>}
 </li>;
 return <><PageHeading title="Supervision des publications" eyebrow="Tous les clients" description="Comptes, validations, diffusions, photothèques et prochaines préparations de l’agent. Aucune diffusion sans approbation humaine." action={<div className="flex flex-col items-start gap-2 sm:items-end"><PublicationsNav current="supervision"/><Link href="/settings/diagnostic" className="text-sm text-accent hover:underline">Diagnostic technique</Link></div>}/>
  {!s?<p role="alert" className="rounded-lg border border-border p-3 text-sm">Réglages de publication illisibles : tout est considéré comme arrêté.</p>
   :<div className="rounded-lg border border-border bg-surface-raised p-3 text-sm" data-switches="true">
    <p>{s.emergencyStop?"Arrêt d’urgence actif : aucune préparation automatique ni diffusion.":`Préparation automatique ${s.automation&&s.generation?"active":"arrêtée"} · diffusion ${s.publishing?"autorisée":"désactivée"} dans les réglages.`}</p>
    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Interrupteurs">
     <li><Badge tone={s.emergencyStop?"amber":"green"}>{s.emergencyStop?"Arrêt d’urgence actif":"Arrêt d’urgence levé"}</Badge></li>
     <li><Badge tone={s.automation?"green":"neutral"}>{`Automatisation ${s.automation?"activée":"désactivée"}`}</Badge></li>
     <li><Badge tone={s.generation?"green":"neutral"}>{`Génération ${s.generation?"activée":"désactivée"}`}</Badge></li>
     <li><Badge tone={s.publishing?"green":"neutral"}>{`Diffusion ${s.publishing?"autorisée":"désactivée"}`}</Badge></li>
     <li data-scheduled-delivery={data.scheduledDelivery?"enabled":"disabled"}><Badge tone={data.scheduledDelivery?"green":"neutral"}>{`Diffusion automatique à l’heure prévue ${data.scheduledDelivery?"activée":"désactivée"}`}</Badge></li>
    </ul>
    {!data.scheduledDelivery&&<p className="mt-2 text-xs text-muted">Diffusion automatique désactivée sur le serveur : les publications approuvées partent uniquement via « Envoyer les publications dues ».</p>}
    <p className="mt-2"><Link href="/publications" className="text-accent hover:underline">Réglages</Link></p></div>}
  <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-label="Synthèse">
   <Tile label="À valider" value={data.counts.pendingReview} href="/publications/review" tone="amber"/>
   <Tile label="Programmées" value={data.counts.scheduled}/>
   <Tile label="Publiées (30 j)" value={data.counts.published} tone="green"/>
   <Tile label="En erreur" value={data.counts.errors} tone="amber"/>
   <Tile label="Comptes connectés" value={data.counts.connected}/>
   <Tile label="À reconnecter" value={data.counts.reconnect} tone="amber"/>
  </ul>

  <Section id="sv-review" title="À valider" description="Approuver, refuser ou modifier la version actuelle. Une modification crée une nouvelle version soumise à validation.">
   {cards.length?<><ReviewQueue cards={cards} showContext/>{data.counts.pendingReview>cards.length&&<p className="mt-3 text-sm"><Link href="/publications/review" className="text-accent hover:underline">Voir les {data.counts.pendingReview} publications à valider</Link></p>}</>
    :<Empty>Aucune publication à valider.</Empty>}
  </Section>

  <Section id="sv-errors" title="En erreur" description="Diffusions en échec, bloquées, à réessayer ou à vérifier, et publications approuvées dont le créneau est passé sans diffusion. Relance et vérification depuis la fiche de la publication.">
   {data.errors.length?<ul>{data.errors.map(p=>row(p,false))}</ul>:<Empty>Aucune diffusion en erreur.</Empty>}
  </Section>

  <Section id="sv-scheduled" title="Programmées" description="Créneaux à venir. Reprogrammer remet l’approbation à zéro ; Suspendre annule la diffusion préparée.">
   {data.scheduled.length?<ul>{data.scheduled.map(p=>row(p,true))}</ul>:<Empty>Aucune publication programmée.</Empty>}
  </Section>

  <Section id="sv-published" title="Publiées récemment" description="Diffusions confirmées par la plateforme ces 30 derniers jours.">
   {data.published.length?<ul>{data.published.map(p=>row(p,false))}</ul>:<Empty>Aucune publication confirmée sur la période.</Empty>}
  </Section>

  <Section id="sv-clients" title="Clients" description={`Comptes, photothèque (moins de ${MIN_AVAILABLE_PHOTOS} photos disponibles = trop peu) et préparation de l’agent.`}>
   {data.clients.length?<ul className="grid gap-4 lg:grid-cols-2">{data.clients.map(c=><li key={c.id} className="rounded-xl border border-border p-4" data-client={c.id}>
    <div className="flex flex-wrap items-center justify-between gap-2"><Link href={`/clients/${c.id}?tab=publications`} className="font-medium hover:underline">{c.name}</Link>
     <Badge tone={c.autoPrepare&&c.generation?"green":"neutral"}>{c.autoPrepare&&c.generation?`Préparation auto · ${c.leadDays} j`:"Préparation manuelle"}</Badge></div>
    <div className="mt-3 text-sm"><p className="text-xs font-semibold text-muted uppercase">Comptes</p>
     {c.accounts.length?<ul className="mt-1 space-y-1">{c.accounts.map(a=><li key={a.id} className="flex flex-wrap items-center gap-2">
      <span>{a.name} · {platformLabels[a.platform]}</span>
      {a.state==="connected"?<Badge tone="green">Connecté</Badge>:<><Badge tone="amber">À reconnecter</Badge><span className="text-xs text-muted">{a.reason}</span></>}</li>)}</ul>
      :<p className="mt-1 text-muted">Aucun compte connecté.</p>}
     {c.accounts.some(a=>a.state==="reconnect")&&<Link href={`/clients/${c.id}?tab=publications`} className="mt-1 inline-block text-xs text-accent hover:underline">Reconnecter depuis la fiche client</Link>}</div>
    <div className="mt-3 text-sm"><p className="text-xs font-semibold text-muted uppercase">Photothèque</p>
     <p className="mt-1">{c.photos.capped?`${c.photos.available}+`:c.photos.available} disponible{c.photos.available>1?"s":""} · {c.photos.toReview} à revoir · {c.photos.rejected} rejetée{c.photos.rejected>1?"s":""}</p>
     {c.tooFewPhotos&&<p className="mt-1 text-xs text-warning" data-too-few-photos="true">Trop peu de photos : l’agent risque de préparer sans photo. <Link href={`/clients/${c.id}?tab=media`} className="underline">Ajouter des photos</Link></p>}</div>
    {(c.agentProjects.length>0||c.autoPrepare)&&<div className="mt-3 space-y-2 text-sm"><p className="text-xs font-semibold text-muted uppercase">Agent</p>
     {c.autoPrepare&&<SuspendClientForm clientId={c.id} clientName={c.name}/>}
     {c.agentProjects.map(project=><details key={project} className="rounded-lg border border-border p-2"><summary className="cursor-pointer text-sm font-medium">Générer maintenant</summary>
      <AgentV2Form projectId={project} disabled={false}/></details>)}
     {!c.agentProjects.length&&<p className="text-xs text-muted">Agent non configuré (droits médias à confirmer) : aucune préparation possible.</p>}</div>}
   </li>)}</ul>:<Empty>Aucun client configuré pour les publications.</Empty>}
  </Section>

  <Section id="sv-tasks" title="Prochaines tâches de l’agent" description="Créneaux encore vides des 14 prochains jours. En préparation automatique, l’agent les prépare à partir de la date indiquée, puis les soumet à votre validation.">
   {data.tasks.length?<ul className="divide-y divide-border">{data.tasks.map(t=><li key={t.occurrenceId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
    <span>{name(t.clientId)} · {platformLabels[t.platform]} · {formatSlot(t.scheduledFor)}</span>
    <span className="text-xs text-muted">{t.automatic?(s?.emergencyStop||!s?.automation||!s?.generation?"Préparation automatique arrêtée (réglages)":`Préparation à partir du ${formatSlot(t.prepareFrom)}`):"En attente de « Générer maintenant »"}</span></li>)}</ul>
    :<Empty>Aucun créneau vide à préparer sur 14 jours.</Empty>}
  </Section></>;
}
