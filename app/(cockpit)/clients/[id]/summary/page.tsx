import Link from "next/link";
import {PageHeading,Panel} from "@/components/ui/primitives";
import {MonthlyActivity} from "@/components/reporting/monthly-activity";
import {getClientOrNotFound} from "@/lib/clients/data";
import {buildClientMonthlySummaryContext} from "@/lib/reporting/data";
import {previousSummaryMonth,summaryPeriod} from "@/lib/reporting/period";
export default async function ClientSummaryPage({params,searchParams}:PageProps<"/clients/[id]/summary">) {
 const {id}=await params,client=await getClientOrNotFound(id),query=await searchParams;
 const month=typeof query.period==="string"?query.period:previousSummaryMonth();
 try{summaryPeriod(month);}catch{return <Panel className="p-6"><p>Période invalide. Utilisez un mois YYYY-MM entre 2000 et 2199.</p><Link href={`/clients/${id}/summary`}>Revenir au dernier mois complet</Link></Panel>;}
 const context=await buildClientMonthlySummaryContext(client.id,month);
 return <><Link className="text-accent" href={`/clients/${id}`}>← Fiche client</Link><PageHeading eyebrow="Synthèse mensuelle" title={`${client.name} — ${month}`} description="Activité enregistrée, organisée par projet. Préparation du contexte Account Manager." />
 <form method="get" className="mb-6 flex gap-3"><label>Mois <input className="rounded border border-border p-2" type="month" name="period" defaultValue={month} min="2000-01" max="2199-12" required /></label><button className="rounded border border-border px-4" type="submit">Afficher</button></form>
 <div className="space-y-5">{context.projects.map(({project,activity})=><Panel key={project.id} className="p-6"><h2 className="font-semibold"><Link href={`/projects/${project.id}`}>{project.name}</Link> · {project.type??"Type non défini"} · {project.status}</h2><MonthlyActivity activity={activity}/></Panel>)}
 <Panel className="p-6"><h2 className="font-semibold">Niveau client / historiques sans projet</h2><MonthlyActivity activity={context.clientActivity}/></Panel>
 <Panel className="p-6"><h2 className="font-semibold">Notes et qualité des données</h2><p className="mt-3 whitespace-pre-wrap text-sm">{context.client.notes??"Aucune note client."}</p><p className="mt-4 text-sm">{context.dataQuality.undatedCompletedTasks.length} tâches terminées sans date · {context.dataQuality.undatedPublishedDeliveries.length} diffusions sans date · {context.dataQuality.missingProjectRecords.length} références projet à vérifier.</p><ul className="mt-4 space-y-2 text-xs text-muted">{context.limitations.map(item=><li key={item}>{item}</li>)}</ul></Panel></div></>;
}
