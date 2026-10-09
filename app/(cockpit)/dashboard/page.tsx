import { requireAdmin } from "@/lib/require-admin";
import { currentUser } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import Link from "next/link";
import { AssistantCommandBox } from "@/components/dashboard/assistant-command-box";
import { AttentionCard } from "@/components/dashboard/attention-card";
import { ClientWatchCard } from "@/components/dashboard/client-watch-card";
import { DayPlan } from "@/components/dashboard/day-plan";
import { RecentActivity } from "@/components/dashboard/recent-activity";
import { listClients } from "@/lib/clients/data";
import { listProjects } from "@/lib/projects/data";
import { listTasks } from "@/lib/tasks/data";
import { listAgents } from "@/lib/agents/data";
import { listRecommendations } from "@/lib/recommendations/data";
import { listActions } from "@/lib/actions/data";
import { listAgentRuns } from "@/lib/agent-runs/data";
import { listPublications } from "@/lib/publications/data";
import { summarizeDashboard } from "@/lib/dashboard/summary";
import { planTasks, todayInParis, watchClients } from "@/lib/dashboard/home";
import { actionTypeLabel, countLabel } from "@/lib/presentation/labels";
import { formatDate } from "@/lib/format-date";

export const metadata: Metadata = { title: "Accueil" };

async function firstName() {
  try { return (await currentUser())?.firstName || "Adrien"; } catch { return "Adrien"; }
}

export default async function DashboardPage() {
  await requireAdmin();
  const [name, clients, projects, tasks, agents, recommendations, actions, runs, publications] = await Promise.all([
    firstName(), listClients(), listProjects(), listTasks(), listAgents(), listRecommendations(), listActions(), listAgentRuns({ limit: 6 }),
    // Les publications sont facultatives sur la home : leur indisponibilité ne bloque pas la page.
    listPublications().catch(() => null),
  ]);
  const summary = summarizeDashboard({ clients, projects, tasks, agents, recommendations, actions });
  const pendingRecommendations = recommendations.filter((item) => item.status === "pending");
  const pendingActions = actions.filter((item) => item.status === "pending_approval" && item.requires_approval);
  const activePublications = publications?.filter((item) => !item.archived_at) ?? [];
  const publicationsToReview = activePublications.filter((item) => item.status === "pending_review");
  const publicationsToPrepare = activePublications.filter((item) => item.status === "draft");
  const plan = planTasks(tasks, todayInParis());
  const watched = watchClients({ clients, projects, tasks, recommendations, actions });

  return (
    <>
      <div className="mx-auto max-w-3xl pt-2 text-center sm:pt-6">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Bonjour {name}</h1>
        <p className="mt-3 text-base text-muted">Que voulez-vous faire aujourd’hui ?</p>
      </div>
      <div className="mx-auto mt-8 max-w-3xl text-left">
        <AssistantCommandBox />
      </div>

      <section className="mt-12" aria-labelledby="attention-title">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <h2 id="attention-title" className="text-lg font-semibold">À traiter maintenant</h2>
          <Link href="/work" className="text-sm text-accent hover:underline">Tout le travail</Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <AttentionCard
            title={countLabel(summary.priorityTasks.length, "tâche prioritaire", "tâches prioritaires")}
            count={summary.priorityTasks.length} icon="tasks" href="/work?view=todo" linkLabel="Voir les tâches" urgent
            items={summary.priorityTasks.slice(0, 3).map((task) => ({ id: task.id, title: task.title, detail: task.client?.name ?? "Client" }))}
            emptyLabel="Aucune tâche prioritaire ouverte."
          />
          <AttentionCard
            title={countLabel(pendingRecommendations.length, "recommandation à examiner", "recommandations à examiner")}
            count={pendingRecommendations.length} icon="recommendations" href="/work?view=review" linkLabel="Examiner"
            items={pendingRecommendations.slice(0, 3).map((item) => ({ id: item.id, title: item.title, detail: `${item.client?.name ?? "Client"} · ${item.agent?.name ?? "Agent"}` }))}
            emptyLabel="Aucune recommandation en attente."
          />
          <AttentionCard
            title={countLabel(pendingActions.length, "action à valider", "actions à valider")}
            count={pendingActions.length} icon="alert" href="/actions?status=pending_approval" linkLabel="Valider" urgent
            items={pendingActions.slice(0, 3).map((item) => ({ id: item.id, title: actionTypeLabel(item.action_type), detail: `${item.client?.name ?? "Client"} · ${formatDate(item.created_at)}` }))}
            emptyLabel="Aucune validation en attente."
          />
          {publications ? (
            <AttentionCard
              title={publicationsToReview.length
                ? countLabel(publicationsToReview.length, "publication à valider", "publications à valider")
                : countLabel(publicationsToPrepare.length, "publication à préparer", "publications à préparer")}
              count={publicationsToReview.length + publicationsToPrepare.length} icon="publications"
              href={publicationsToReview.length ? "/publications/review" : "/publications"} linkLabel="Ouvrir les publications"
              items={(publicationsToReview.length ? publicationsToReview : publicationsToPrepare).slice(0, 3).map((item) => ({ id: item.id, title: item.subject, detail: item.client?.name ?? "Client" }))}
              emptyLabel="Aucune publication en attente."
            />
          ) : (
            <AttentionCard title="Publications" count={0} icon="publications" href="/publications" linkLabel="Ouvrir les publications" items={[]} emptyLabel="Le suivi des publications est momentanément indisponible." />
          )}
        </div>
      </section>

      <div className="mt-10 grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <DayPlan overdue={plan.overdue} today={plan.today} week={plan.week} />
        <section aria-labelledby="watch-title" className="min-w-0">
          <div className="mb-4 flex items-end justify-between gap-2">
            <h2 id="watch-title" className="font-semibold">Clients à surveiller</h2>
            <Link href="/clients" className="text-sm text-accent hover:underline">Tous les clients</Link>
          </div>
          {watched.length ? (
            <ul className="space-y-3">{watched.map((client) => <li key={client.id}><ClientWatchCard client={client} /></li>)}</ul>
          ) : <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted">Aucun client ne demande d’attention particulière.</p>}
        </section>
      </div>

      <div className="mt-6">
        <RecentActivity runs={runs} />
      </div>
    </>
  );
}
