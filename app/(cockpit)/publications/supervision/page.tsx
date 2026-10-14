import Link from "next/link";
import type {ReactNode} from "react";
import {requireAdmin} from "@/lib/require-admin";
import {getSupervision,type ClientSupervision,type SupervisedPublication} from "@/lib/publications/supervision";
import {isFlagEnabled} from "@/lib/system/providers";
import {formatSlot,MIN_AVAILABLE_PHOTOS,providerOfPlatform} from "@/lib/publications/supervision-model";
import {filterSupervision,parseSupervisionQuery,supervisionBadges,supervisionHref,type SupervisionView} from "@/lib/publications/supervision-view";
import {buildSupervisionReviewItems,SUPERVISION_REVIEW_LIMIT} from "@/lib/publications/supervision-review";
import {listPublications} from "@/lib/publications/data";
import {platformLabels} from "@/lib/publications/editor";
import {PROVIDER_LABELS} from "@/lib/publications/connections/model";
import {Badge,Panel} from "@/components/ui/primitives";
import {PublicationsNav} from "@/components/publications/publications-board";
import {AgentV2Form} from "@/components/publications/agent-v2-form";
import {ReconnectForm,RescheduleForm,SuspendClientForm,SuspendDeliveryForm} from "@/components/publications/supervision-forms";
import {ClientFilter,SupervisionTabs} from "@/components/publications/supervision-tabs";
import {SupervisionReviewCard} from "@/components/publications/supervision-review-card";

// Socle Publications, lot 7 : supervision de tous les clients, pilotable depuis un téléphone. Une seule page, des onglets
// compacts collants (?view=) et un filtre client (?client=) : voir lib/publications/supervision-view.ts. Lecture seule,
// sauf les actions explicites existantes (Valider, Rejeter, Modifier, Générer maintenant, Reconnecter) et celles du lot 7
// (Reprogrammer, Suspendre). Aucune ne publie : la diffusion exige toujours une approbation humaine.
export const dynamic="force-dynamic";
const statusLabels={draft:"Brouillon",pending_review:"À valider",approved:"Approuvée",rejected:"Refusée"} as const;
const deliveryLabels={scheduled:"Diffusion programmée",published:"Publiée",error:"Diffusion en erreur",none:"Diffusion non préparée"} as const;
const PREVIEW=3;

function Section({title,description,children,id}:{title:string;description?:string;children:ReactNode;id:string}){
 return <Panel className="mt-4 p-4 sm:p-5"><section aria-labelledby={id}><h2 id={id} className="text-lg font-semibold">{title}</h2>
  {description&&<p className="mt-1 text-sm text-muted">{description}</p>}<div className="mt-3">{children}</div></section></Panel>;
}
function Tile({label,value,href,tone}:{label:string;value:number;href:string;tone?:"amber"|"green"}){
 return <li className="rounded-xl border border-border bg-surface-raised p-3"><Link href={href} className="block">
  <p className="text-xs text-muted">{label}</p><p className={`mt-1 text-2xl font-semibold ${tone==="amber"&&value>0?"text-warning":tone==="green"?"text-success":""}`}>{value}</p></Link></li>;
}
const Empty=({children}:{children:ReactNode})=><p className="text-sm text-muted">{children}</p>;
const More=({href,children}:{href:string;children:ReactNode})=><Link href={href} className="text-sm text-accent hover:underline">{children}</Link>;

export default async function PublicationsSupervisionPage({searchParams}:PageProps<"/publications/supervision">){
 await requireAdmin();const now=new Date();
 // Interrupteur serveur lu par lib/system (présence de la valeur exacte « enabled » uniquement), jamais dans lib/publications.
 const [raw,publications,search]=await Promise.all([getSupervision(now,{scheduledDelivery:isFlagEnabled("publications-scheduled-delivery")}),listPublications(),searchParams]);
 // File de validation complète (programmée ou non), comme /publications/review.
 const pendingAll=publications.filter(p=>p.status==="pending_review"&&!p.archived_at);
 const clientOptions=[...new Map([...raw.clients.map(c=>[c.id,c.name] as const),...pendingAll.map(p=>[p.client_id,p.client?.name??"Client"] as const)])]
  .map(([id,name])=>({id,name})).sort((a,b)=>a.name.localeCompare(b.name,"fr"));
 const {view,client}=parseSupervisionQuery(search,clientOptions.map(c=>c.id));
 const pending=pendingAll.filter(p=>!client||p.client_id===client);
 const data=filterSupervision(raw,client,pending.map(p=>({clientId:p.client_id})));
 // Aperçus signés : chargés uniquement pour l'onglet « À valider ».
 const reviewItems=view==="review"?await buildSupervisionReviewItems(pending):[];
 const clientName=new Map(clientOptions.map(c=>[c.id,c.name]));
 const name=(id:string)=>clientName.get(id)??"Client";
 const s=data.settings;
 const href=(v:SupervisionView)=>supervisionHref(v,client);
 const reconnect=data.clients.flatMap(c=>c.accounts.filter(a=>a.state==="reconnect").map(a=>({client:c,account:a})));
 const shortOnPhotos=data.clients.filter(c=>c.tooFewPhotos);

 const row=(p:SupervisedPublication,actions:boolean)=><li key={p.id} className="flex flex-col gap-2 border-t border-border py-3 first:border-t-0 sm:flex-row sm:items-start sm:justify-between">
  <div className="min-w-0"><p className="text-sm font-medium break-words"><Link href={`/publications/${p.id}`} className="hover:underline">{p.subject}</Link></p>
   <p className="mt-0.5 text-xs text-muted">{name(p.clientId)} · {platformLabels[p.platform]} · {formatSlot(p.scheduledFor)}</p>
   <div className="mt-1 flex flex-wrap gap-1.5"><Badge tone={p.status==="approved"?"green":p.status==="pending_review"?"amber":"neutral"}>{statusLabels[p.status]}</Badge>
    <Badge tone={p.delivery==="error"||p.errorReason?"amber":p.delivery==="published"?"green":"neutral"}>{p.errorReason&&p.delivery==="none"?"Créneau manqué":deliveryLabels[p.delivery]}</Badge></div>
   {p.errorReason&&<p className="mt-1 text-xs text-warning" data-error-reason="true">{p.errorReason}</p>}</div>
  {actions&&<div className="flex flex-wrap items-start gap-2">
   {/* Modifier après approbation : la publication repasse en brouillon et doit être approuvée de nouveau (éditeur existant). */}
   <Link href={`/publications/${p.id}/edit`} className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-border/40">Modifier</Link>
   <RescheduleForm publicationId={p.id} revisionId={p.revisionId} targets={p.targets} approved={p.status==="approved"}/>
   {p.cancellable.length>0&&<SuspendDeliveryForm publicationId={p.id}/>}
  </div>}
 </li>;
 const accountsOf=(c:ClientSupervision)=><div className="text-sm">{c.accounts.length?<ul className="space-y-2">{c.accounts.map(a=><li key={a.id} className="flex flex-wrap items-center gap-2">
   <span className="min-w-0 break-words">{a.name} · {platformLabels[a.platform]}</span>
   {a.state==="connected"?<Badge tone="green">Connecté</Badge>:<><Badge tone="amber">À reconnecter</Badge><span className="text-xs text-muted">{a.reason}</span>
    {c.projectId&&<ReconnectForm projectId={c.projectId} provider={providerOfPlatform(a.platform)} label={PROVIDER_LABELS[providerOfPlatform(a.platform)]}/>}</>}</li>)}</ul>
   :<p className="text-muted">Aucun compte connecté.</p>}
  <Link href={`/clients/${c.id}?tab=publications`} className="mt-2 inline-block text-xs text-accent hover:underline">Connexions de la fiche client</Link></div>;
 const photosOf=(c:ClientSupervision)=>c.photos?<><p>{c.photos.capped?`${c.photos.available}+`:c.photos.available} disponible{c.photos.available>1?"s":""} · {c.photos.toReview} à revoir · {c.photos.rejected} rejetée{c.photos.rejected>1?"s":""}</p>
   {c.tooFewPhotos&&<p className="mt-1 text-xs text-warning" data-too-few-photos="true">Trop peu de photos : l’agent risque de préparer sans photo. <Link href={`/clients/${c.id}?tab=media`} className="underline">Ajouter des photos</Link></p>}</>
  :<p className="text-xs text-warning">Photothèque illisible pour le moment.</p>;
 const agentOf=(c:ClientSupervision)=><div className="space-y-2 text-sm">
  <div className="flex flex-wrap items-center gap-2"><Badge tone={c.autoPrepare&&c.generation?"green":"neutral"}>{c.autoPrepare&&c.generation?`Préparation auto · ${c.leadDays} j`:"Préparation manuelle"}</Badge>
   {c.lastRun&&<span className={`text-xs ${c.lastRun.state==="failed"?"text-warning":"text-muted"}`} data-agent-run={c.lastRun.state}>{c.lastRun.label}{c.lastRun.reason?` : ${c.lastRun.reason}`:""} · {formatSlot(c.lastRun.at)}</span>}</div>
  {c.autoPrepare&&<SuspendClientForm clientId={c.id} clientName={c.name}/>}
  {c.agentProjects.map(project=><details key={project} className="rounded-lg border border-border p-2"><summary className="cursor-pointer text-sm font-medium">Générer maintenant</summary>
   <AgentV2Form projectId={project} disabled={false}/></details>)}
  {!c.agentProjects.length&&<p className="text-xs text-muted">Agent non configuré (droits médias à confirmer) : aucune préparation possible.</p>}</div>;

 return <>
  <header className="mb-3 flex flex-wrap items-end justify-between gap-3">
   <div className="min-w-0"><p className="mb-1 text-xs font-semibold tracking-[0.18em] text-accent-hover uppercase">Tous les clients</p>
    <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Supervision des publications</h1>
    <p className="mt-1 max-w-2xl text-sm text-muted">Validations, erreurs, comptes, photos et agent. Aucune diffusion sans approbation humaine.</p></div>
   <div className="flex flex-col items-start gap-2 sm:items-end"><div className="hidden sm:block"><PublicationsNav current="supervision"/></div><Link href="/settings/diagnostic" className="text-sm text-accent hover:underline">Diagnostic technique</Link></div>
  </header>
  <SupervisionTabs current={view} client={client} badges={supervisionBadges(data)}/>
  <ClientFilter view={view} client={client} clients={clientOptions}/>

  {view==="overview"&&<>
   {!s?<p role="alert" className="mt-4 rounded-lg border border-border p-3 text-sm">Réglages de publication illisibles : tout est considéré comme arrêté.</p>
    :<div className="mt-4 rounded-lg border border-border bg-surface-raised p-3 text-sm" data-switches="true">
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
   <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-6" aria-label="Synthèse">
    <Tile label="À valider" value={data.counts.pendingReview} href={href("review")} tone="amber"/>
    <Tile label="En erreur" value={data.counts.errors} href={href("errors")} tone="amber"/>
    <Tile label="À reconnecter" value={data.counts.reconnect} href={href("accounts")} tone="amber"/>
    <Tile label="Programmées" value={data.counts.scheduled} href={href("scheduled")}/>
    <Tile label="Publiées (30 j)" value={data.counts.published} href={href("scheduled")} tone="green"/>
    <Tile label="Comptes connectés" value={data.counts.connected} href={href("accounts")}/>
   </ul>
   <Section id="sv-priorities" title="À traiter" description="Les premiers éléments de chaque onglet.">
    {!data.errors.length&&!reconnect.length&&!shortOnPhotos.length&&!data.counts.pendingReview?<Empty>Rien à traiter pour le moment.</Empty>:<ul className="space-y-3 text-sm">
     {data.counts.pendingReview>0&&<li><More href={href("review")}>{data.counts.pendingReview} publication{data.counts.pendingReview>1?"s":""} à valider</More></li>}
     {data.errors.slice(0,PREVIEW).map(p=><li key={p.id}><p className="font-medium break-words">{p.subject}</p><p className="text-xs text-warning">{name(p.clientId)} · {p.errorReason}</p></li>)}
     {data.errors.length>PREVIEW&&<li><More href={href("errors")}>Toutes les erreurs ({data.errors.length})</More></li>}
     {reconnect.slice(0,PREVIEW).map(({client:c,account:a})=><li key={a.id}>{c.name} · {a.name} · <span className="text-warning">{a.reason}</span> · <More href={href("accounts")}>Reconnecter</More></li>)}
     {shortOnPhotos.slice(0,PREVIEW).map(c=><li key={c.id}>{c.name} · <span className="text-warning">Trop peu de photos</span> · <More href={href("photos")}>Voir</More></li>)}
    </ul>}
   </Section>
  </>}

  {view==="review"&&<Section id="sv-review" title="À valider" description="Aperçu de chaque plateforme avec sa photo. Valider, rejeter (motif obligatoire) ou modifier : une modification crée une nouvelle version soumise à validation.">
   {reviewItems.length?<div className="space-y-4">{reviewItems.map(item=><SupervisionReviewCard key={item.card.publicationId} item={item}/>)}
    {pending.length>Math.min(reviewItems.length,SUPERVISION_REVIEW_LIMIT)&&<p className="text-sm"><Link href="/publications/review" className="text-accent hover:underline">Voir les {pending.length} publications à valider</Link></p>}</div>
    :<Empty>Aucune publication à valider.</Empty>}
  </Section>}

  {view==="errors"&&<Section id="sv-errors" title="En erreur" description="Diffusions en échec, bloquées, à réessayer ou à vérifier, et publications approuvées dont le créneau est passé sans diffusion. Relance et vérification depuis la fiche de la publication.">
   {data.errors.length?<ul>{data.errors.map(p=>row(p,false))}</ul>:<Empty>Aucune diffusion en erreur.</Empty>}
  </Section>}

  {view==="scheduled"&&<>
   <Section id="sv-scheduled" title="Programmées" description="Créneaux à venir. Reprogrammer remet l’approbation à zéro ; Suspendre annule la diffusion préparée ; Modifier après approbation impose une nouvelle approbation.">
    {data.scheduled.length?<ul>{data.scheduled.map(p=>row(p,true))}</ul>:<Empty>Aucune publication programmée.</Empty>}
   </Section>
   <Section id="sv-published" title="Publiées récemment" description="Diffusions confirmées par la plateforme ces 30 derniers jours.">
    {data.published.length?<ul>{data.published.map(p=>row(p,false))}</ul>:<Empty>Aucune publication confirmée sur la période.</Empty>}
   </Section></>}

  {view==="accounts"&&<Section id="sv-accounts" title="Comptes" description="Comptes connectés et à reconnecter. « Reconnecter » ouvre la page de consentement officielle puis revient sur la fiche client.">
   {data.clients.length?<ul className="grid gap-3 lg:grid-cols-2">{[...data.clients].sort((a,b)=>Number(b.accounts.some(x=>x.state==="reconnect"))-Number(a.accounts.some(x=>x.state==="reconnect"))).map(c=>
    <li key={c.id} className="rounded-xl border border-border p-3" data-client={c.id}><p className="mb-2 font-medium">{c.name}</p>{accountsOf(c)}</li>)}</ul>:<Empty>Aucun client configuré pour les publications.</Empty>}
  </Section>}

  {view==="photos"&&<Section id="sv-photos" title="Photos" description={`Photos que l’agent peut réellement utiliser (moins de ${MIN_AVAILABLE_PHOTOS} disponibles = trop peu).`}>
   {data.clients.length?<ul className="grid gap-3 lg:grid-cols-2">{[...data.clients].sort((a,b)=>Number(b.tooFewPhotos)-Number(a.tooFewPhotos)||(a.photos?.available??0)-(b.photos?.available??0)).map(c=>
    <li key={c.id} className="rounded-xl border border-border p-3 text-sm" data-client={c.id}><Link href={`/clients/${c.id}?tab=media`} className="font-medium hover:underline">{c.name}</Link><div className="mt-1">{photosOf(c)}</div></li>)}</ul>
    :<Empty>Aucun client configuré pour les publications.</Empty>}
  </Section>}

  {view==="agent"&&<>
   <Section id="sv-agent" title="Agent" description="Mode de préparation, dernière préparation et génération à la demande (brouillons soumis à validation, jamais publiés).">
    {data.clients.length?<ul className="grid gap-3 lg:grid-cols-2">{data.clients.map(c=><li key={c.id} className="rounded-xl border border-border p-3" data-client={c.id}>
     <Link href={`/clients/${c.id}?tab=publications`} className="mb-2 inline-block font-medium hover:underline">{c.name}</Link>{agentOf(c)}</li>)}</ul>:<Empty>Aucun client configuré pour les publications.</Empty>}
   </Section>
   <Section id="sv-tasks" title="Prochaines tâches de l’agent" description="Créneaux encore vides des 14 prochains jours. En préparation automatique, l’agent les prépare à partir de la date indiquée, puis les soumet à votre validation.">
    {data.tasks.length?<ul className="divide-y divide-border">{data.tasks.map(t=><li key={t.occurrenceId} className="flex flex-col gap-0.5 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
     <span>{name(t.clientId)} · {platformLabels[t.platform]} · {formatSlot(t.scheduledFor)}</span>
     <span className="text-xs text-muted">{t.automatic?(s?.emergencyStop||!s?.automation||!s?.generation?"Préparation automatique arrêtée (réglages)":`Préparation à partir du ${formatSlot(t.prepareFrom)}`):"En attente de « Générer maintenant »"}</span></li>)}</ul>
     :<Empty>Aucun créneau vide à préparer sur 14 jours.</Empty>}
   </Section></>}
 </>;
}
