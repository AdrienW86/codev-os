import Link from "next/link";
import {notFound} from "next/navigation";
import {PageHeading,Panel,Badge} from "@/components/ui/primitives";
import {ProjectActivity} from "@/components/projects/project-activity";
import {EditorialPlanningSection} from "@/components/publications/planning-section";
import {PublicationsAgentSection} from "@/components/publications/agent-section";
import {getProjectById} from "@/lib/projects/data";
import {listTasksByProject} from "@/lib/tasks/data";
import {buildClientMonthlySummaryContext} from "@/lib/reporting/data";
import {previousSummaryMonth} from "@/lib/reporting/period";
export default async function ProjectDetailPage({params}:PageProps<"/projects/[id]">) {
 const {id}=await params,project=await getProjectById(id);if(!project)notFound();
 const month=previousSummaryMonth();
 const [tasks,summary]=await Promise.all([listTasksByProject(id),buildClientMonthlySummaryContext(project.client_id,month)]);
 const metrics=summary.projects.find(p=>p.project.id===id)?.activity.metrics??[];
 return <><Link className="text-accent" href={`/clients/${project.client_id}`}>← {project.client?.name??"Client"}</Link>
 <PageHeading eyebrow={project.type??"Projet"} title={project.name} description={`Progression ${project.progress} % · Responsable : ${project.responsible??"Non défini"}`} action={<Badge>{project.status}</Badge>}/>
 <Link className="text-accent" href={`/projects/${id}/edit`}>Modifier le projet</Link><Panel className="mt-6 p-6"><h2 className="font-semibold">Tâches</h2>{tasks.length?<ul className="mt-4 space-y-3">{tasks.map(t=><li key={t.id}><Link href={`/tasks/${t.id}/edit`}>{t.title}</Link> · {t.status} · {t.due_date??"Sans échéance"}</li>)}</ul>:<p className="mt-3 text-sm text-muted">Aucune tâche.</p>}</Panel>
 <EditorialPlanningSection project={project}/><PublicationsAgentSection project={project}/><Panel className="mt-6 p-6"><h2 className="font-semibold">Activité récente du projet</h2><ProjectActivity project={project}/></Panel>
 <Panel className="mt-6 p-6"><h2 className="font-semibold">Métriques enregistrées — {month}</h2>{metrics.length?<ul className="mt-3 space-y-3 text-sm">{metrics.map(m=><li key={`${m.account_id}:${m.period.start}:${m.period.end}`}><p>{m.account_id} · {m.period.start} → {m.period.end} · {m.coverage==="full_month"?"Mois complet":"Période partielle"} · {m.currency??"Devise inconnue"}</p><dl className="mt-2 flex flex-wrap gap-4">{Object.entries(m.values).map(([key,value])=><div key={key}><dt className="text-xs text-muted">{key}</dt><dd>{value}</dd></div>)}</dl></li>)}</ul>:<p className="mt-3 text-sm text-muted">Aucune métrique persistée pour ce projet et ce mois. Les métriques d’un compte Ads au niveau client restent au niveau client.</p>}<Link className="mt-3 inline-block text-accent" href={`/clients/${project.client_id}/summary`}>Consulter la synthèse mensuelle</Link></Panel></>;
}
