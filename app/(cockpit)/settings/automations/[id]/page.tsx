import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/require-admin";
import { PageHeading, Panel } from "@/components/ui/primitives";
import { StatusBadge } from "@/components/ui/status-badge";
import { ModuleUnavailable } from "@/components/ui/module-unavailable";
import { getActiveScenario } from "@/lib/simulation/server";
import { safeRead } from "@/lib/core/safe-read";
import { getAutomationSupervision } from "@/lib/automations/supervision";
import { automationEvidence, jobReportIds } from "@/lib/automations/supervision-model";
import { formatDateTime } from "@/lib/format-date";

export const metadata: Metadata = { title: "Historique d’automatisation" };

export default async function AutomationHistoryPage({ params }: PageProps<"/settings/automations/[id]">) {
  await requireAdmin();
  if (await getActiveScenario()) return <Panel className="p-6"><p>L’historique d’automatisation lit uniquement les données réelles. Quittez la simulation pour le consulter.</p><Link href="/settings?tab=automations" className="mt-3 inline-block text-accent hover:underline">Retour aux automatisations</Link></Panel>;
  const { id } = await params;
  const result = await safeRead("automation-history", () => getAutomationSupervision(id), null);
  if (result.unavailable) return <><PageHeading eyebrow="Supervision" title="Historique d’automatisation" description="La lecture des preuves est momentanément indisponible." /><ModuleUnavailable module="Historique des automatisations" /></>;
  const automation = result.data;
  if (!automation) notFound();
  const latest = automation.jobs[0] ?? null;
  const current = automationEvidence(automation, latest, automation.reports);
  return <>
    <PageHeading eyebrow="Supervision" title={automation.name} description="Jobs enregistrés et résultats liés. Cette page est en lecture seule et ne déclenche aucune exécution." />
    <div className="mb-6 flex flex-wrap gap-4 text-sm"><Link href="/settings?tab=automations" className="text-accent hover:underline">Toutes les automatisations</Link><Link href="/settings/diagnostic" className="text-accent hover:underline">Diagnostic du planificateur</Link></div>
    <Panel className="mb-6 space-y-2 p-5"><StatusBadge label={current.label} tone={current.tone} /><p className="text-sm text-muted">{current.description}</p><p className="text-sm">Prochaine échéance : {formatDateTime(automation.next_run_at)} (heure de Paris) · planification : {automation.timezone}</p><p className="break-all text-xs text-muted">Automatisation : {automation.id}</p></Panel>
    {automation.resultUnavailable && <p className="mb-4 text-sm text-warning">Un résultat lié est manquant ou sa version actuelle est illisible. Aucune validation n’en est déduite.</p>}
    <h2 className="mb-4 text-lg font-semibold">Historique des jobs</h2>
    <p className="mb-4 text-sm text-muted">Les 50 jobs les plus récents, avec les demandes manuelles rattachées depuis cette version. Les anciennes demandes manuelles sans lien d’automatisation n’apparaissent pas. Réussite signifie fin du job ; aucune livraison externe n’en est déduite.</p>
    {automation.jobs.length ? <ol className="space-y-4">{automation.jobs.map(job => {
      // L'échéance future de l'automatisation ne requalifie pas les anciens succès en retard.
      const evidence = automationEvidence({ ...automation, status: "paused" }, job, automation.reports);
      const reportIds = new Set(jobReportIds(job));
      const reports = automation.reports.filter(report => reportIds.has(report.id) && (!job.client_id || report.client_id === job.client_id));
      return <li key={job.id} id={`job-${job.id}`} className="scroll-mt-24"><Panel className="space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><StatusBadge label={evidence.label} tone={evidence.tone} /><span className="text-xs text-muted">Tentatives : {job.attempts}/{job.max_attempts}</span></div>
        <p className="text-sm text-muted">{evidence.description}</p>
        <dl className="grid gap-2 text-sm sm:grid-cols-3"><div><dt className="text-muted">Échéance du job</dt><dd>{formatDateTime(job.scheduled_for)}</dd></div><div><dt className="text-muted">Début</dt><dd>{formatDateTime(job.started_at)}</dd></div><div><dt className="text-muted">Fin</dt><dd>{formatDateTime(job.finished_at)}</dd></div></dl>
        <p className="break-all text-xs text-muted">Job : {job.id}{job.agent_run_id ? ` · Exécution agent : ${job.agent_run_id}` : " · Aucune exécution agent associée"}</p>
        <Link href={`/settings/automations/${automation.id}#job-${job.id}`} className="inline-block text-sm text-accent hover:underline">Lien vers cette preuve</Link>
        {reports.length ? <ul className="space-y-2">{reports.map(report => <li key={report.id}><Link href={`/reports/${report.id}`} className="text-sm text-accent hover:underline">{report.title} · version actuelle {report.version}</Link></li>)}</ul> : job.status === "succeeded" && <p className="text-xs text-muted">Aucun rapport individuel relié à ce job. La trace ci-dessus prouve uniquement sa fin d’exécution.</p>}
      </Panel></li>;
    })}</ol> : <Panel className="p-5 text-sm text-muted">Aucun job associé enregistré.</Panel>}
  </>;
}
