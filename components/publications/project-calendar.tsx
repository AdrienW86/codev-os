import Link from "next/link";
import {Panel} from "@/components/ui/primitives";
import {platformLabels} from "@/lib/publications/editor";
import {formatDay,slotDisplayClasses,slotDisplayLabels,type SlotDisplay} from "@/lib/projects/workspace-view";
import type {PublicationPlatform} from "@/lib/publications/types";
export type ProjectCalendarEntry={key:string;date:string;time:string|null;subject:string;platforms:PublicationPlatform[];display:SlotDisplay;publicationId:string|null;conflict:boolean};
const legend:SlotDisplay[]=["empty","draft","pending_review","approved","rejected","published"];
export function ProjectCalendar({projectId,mode,from,to,previous,next,entries,error}:{projectId:string;mode:"week"|"month";from:string;to:string;previous:string;next:string;entries:ProjectCalendarEntry[];error:boolean}){
 const base=`/projects/${projectId}/calendar`,days=[...new Set(entries.map(e=>e.date))].sort();
 return <Panel className="mt-6 p-5">
 <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex gap-2 text-sm"><Link className="rounded-lg border border-border px-3 py-1" href={`${base}?mode=${mode}&date=${previous}`}>← Précédent</Link><Link className="rounded-lg border border-border px-3 py-1" href={`${base}?mode=${mode}&date=${next}`}>Suivant →</Link></div>
 <p className="text-sm font-medium">{formatDay(from)} → {formatDay(to)}</p>
 <div className="flex gap-2 text-sm"><Link aria-current={mode==="week"?"page":undefined} className={mode==="week"?"font-semibold":"text-accent"} href={`${base}?mode=week&date=${from}`}>Semaine</Link><Link aria-current={mode==="month"?"page":undefined} className={mode==="month"?"font-semibold":"text-accent"} href={`${base}?mode=month&date=${from}`}>Mois</Link></div></div>
 <ul aria-label="Légende des statuts" className="mt-4 flex flex-wrap gap-2 text-xs">{legend.map(s=><li key={s} className={`rounded-full border px-2 py-0.5 ${slotDisplayClasses[s]}`}>{slotDisplayLabels[s]}</li>)}</ul>
 {error?<p role="alert" className="mt-4">Calendrier indisponible. Vérifiez l’accès au stockage et l’installation du calendrier.</p>:!days.length?<p className="mt-4 text-sm text-muted">Aucun créneau sur cette période. Configurez la cadence dans « Paramètres du planning ».</p>:
 <ol className="mt-5 space-y-4">{days.map(day=><li key={day}><h3 className="text-sm font-semibold capitalize">{formatDay(day)}</h3><ul className="mt-2 grid gap-2 md:grid-cols-2">{entries.filter(e=>e.date===day).map(e=><li key={e.key} data-status={e.display} className={`rounded-lg border p-3 ${slotDisplayClasses[e.display]}`}>
  <div className="flex items-center justify-between gap-2 text-xs"><span>{e.time??"Horaire à définir"}</span><span className="rounded-full border border-current px-2 py-0.5">{slotDisplayLabels[e.display]}</span></div>
  <p className="mt-1 text-sm font-medium">{e.publicationId&&e.display!=="empty"?<Link className="hover:text-accent" href={`/publications/${e.publicationId}`}>{e.subject}</Link>:e.display==="empty"?"Contenu à préparer":e.subject}</p>
  <p className="mt-1 text-xs text-muted">{e.platforms.map(p=>platformLabels[p]).join(" · ")}</p>{e.conflict&&<p className="mt-1 text-xs">Conflit de créneau : revue manuelle requise.</p>}</li>)}</ul></li>)}</ol>}
 <Link className="mt-5 inline-block text-sm text-accent" href={`/publications/calendar?project=${projectId}`}>Calendrier global de tous les projets</Link></Panel>;
}
