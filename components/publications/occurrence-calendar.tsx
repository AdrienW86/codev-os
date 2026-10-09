import Link from "next/link";
import {Panel} from "@/components/ui/primitives";
import {formatDay} from "@/lib/projects/workspace-view";
import {occurrenceStateLabels,type OccurrenceEntry,type OccurrenceState} from "@/lib/publications/occurrence-model";
import {OccurrencePrepareForm} from "./occurrence-prepare-form";
import {OccurrenceSkipForm} from "./occurrence-skip-form";

// Calendar of a configured project (Lot 4.3 P3): one dated occurrence per channel slot, platforms independent.
// Presentation only; the single write is the explicit "Préparer les prochaines semaines" form.
const stateClasses:Record<OccurrenceState,string>={open:"border-dashed border-border",missed:"border-amber-500 bg-amber-500/10",linked:"border-emerald-600 bg-emerald-600/10",skipped:"border-border text-muted"};
const publicationStatusLabels:Record<string,string>={draft:"Brouillon",pending_review:"À valider",approved:"Validée",rejected:"Rejetée"};
export type LegacyHistoryEntry={key:string;date:string;time:string|null;subject:string;platforms:string;status:string};
export function OccurrenceCalendar({projectId,mode,from,to,previous,next,entries,error,legacy}:{projectId:string;mode:"week"|"month";from:string;to:string;previous:string;next:string;
 entries:OccurrenceEntry[];error:boolean;legacy:LegacyHistoryEntry[]}){
 const base=`/projects/${projectId}/calendar`,days=[...new Set(entries.map(e=>e.date))].sort();
 return <>
 <Panel className="mt-6 p-5">
  <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex gap-2 text-sm"><Link className="rounded-lg border border-border px-3 py-1" href={`${base}?mode=${mode}&date=${previous}`}>← Précédent</Link><Link className="rounded-lg border border-border px-3 py-1" href={`${base}?mode=${mode}&date=${next}`}>Suivant →</Link></div>
   <p className="text-sm font-medium">{formatDay(from)} → {formatDay(to)}</p>
   <div className="flex gap-2 text-sm"><Link aria-current={mode==="week"?"page":undefined} className={mode==="week"?"font-semibold":"text-accent"} href={`${base}?mode=week&date=${from}`}>Semaine</Link><Link aria-current={mode==="month"?"page":undefined} className={mode==="month"?"font-semibold":"text-accent"} href={`${base}?mode=month&date=${from}`}>Mois</Link></div></div>
  <ul aria-label="Légende des occurrences" className="mt-4 flex flex-wrap gap-2 text-xs">{(Object.keys(occurrenceStateLabels) as OccurrenceState[]).map(s=><li key={s} className={`rounded-full border px-2 py-0.5 ${stateClasses[s]}`}>{occurrenceStateLabels[s]}</li>)}</ul>
  {error?<p role="alert" className="mt-4">Calendrier indisponible. Vérifiez l’installation des occurrences.</p>:!days.length?<p className="mt-4 text-sm text-muted">Aucune occurrence sur cette période. Préparez les prochaines semaines ci-dessous.</p>:
  <ol className="mt-5 space-y-4">{days.map(day=><li key={day}><h3 className="text-sm font-semibold capitalize">{formatDay(day)}</h3><ul className="mt-2 grid gap-2 md:grid-cols-2">{entries.filter(e=>e.date===day).map(e=>
   <li key={e.key} data-occurrence={e.state} data-platform={e.platform} className={`rounded-lg border p-3 ${stateClasses[e.state]}`}>
    <div className="flex items-center justify-between gap-2 text-xs"><span>{e.time} · {e.platformLabel}</span><span className="rounded-full border border-current px-2 py-0.5">{e.stateLabel}</span></div>
    <p className="mt-1 text-sm">{e.publication?<Link className="font-medium hover:text-accent" href={`/publications/${e.publication.id}`}>{e.publication.subject}</Link>:e.state==="skipped"?`Ignorée${e.skippedReason?` : ${e.skippedReason}`:""}`:"Aucune publication liée"}</p>
    {e.publication&&<p className="mt-1 text-xs text-muted">{publicationStatusLabels[e.publication.status]??"Statut inconnu"}</p>}
    {(e.state==="open"||e.state==="missed")&&<><Link data-create-publication="true" className="mt-2 inline-block rounded-lg border border-border px-3 py-1 text-xs hover:text-accent" href={`/projects/${projectId}/calendar/occurrences/${e.key}`}>Créer la publication</Link>
     <OccurrenceSkipForm projectId={projectId} occurrenceId={e.key}/></>}</li>)}</ul></li>)}</ol>}
  <Link className="mt-5 inline-block text-sm text-accent" href={`/publications/calendar?project=${projectId}`}>Calendrier global de tous les projets</Link></Panel>
 <OccurrencePrepareForm projectId={projectId}/>
 {legacy.length>0&&<details className="mt-6 rounded-lg border border-border p-5"><summary className="cursor-pointer font-semibold">Ancien calendrier (historique)</summary>
  <p className="mt-2 text-sm text-muted">Créneaux et contenus de l’ancien planning, conservés en lecture seule. Aucun nouveau créneau n’y est créé.</p>
  <ul className="mt-3 space-y-2 text-sm">{legacy.map(e=><li key={e.key} data-legacy-entry="true" className="flex flex-wrap gap-2"><span className="capitalize">{formatDay(e.date)}</span><span>{e.time??""}</span><span className="font-medium">{e.subject}</span><span className="text-muted">{e.platforms} · {e.status}</span></li>)}</ul></details>}
 </>;
}
