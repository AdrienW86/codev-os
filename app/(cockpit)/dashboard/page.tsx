import { requireAdmin } from "@/lib/require-admin";
import { currentUser } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import Link from "next/link";
import { AssistantCommandBox } from "@/components/dashboard/assistant-command-box";
import { AttentionCard } from "@/components/dashboard/attention-card";
import { RecentActivity } from "@/components/dashboard/recent-activity";
import { TechNews } from "@/components/dashboard/tech-news";
import { demoNews } from "@/lib/news/types";
import { listClients } from "@/lib/clients/data";
import { listProjects } from "@/lib/projects/data";
import { listTasks } from "@/lib/tasks/data";
import { listAgents } from "@/lib/agents/data";
import { listRecommendations } from "@/lib/recommendations/data";
import { listActions } from "@/lib/actions/data";
import { listAgentRuns } from "@/lib/agent-runs/data";
import { listPublications } from "@/lib/publications/data";
import { summarizeDashboard } from "@/lib/dashboard/summary";
import { actionTypeLabel, countLabel } from "@/lib/presentation/labels";
import { formatDate } from "@/lib/format-date";
import { getActiveScenario } from "@/lib/simulation/server";
import { SimDashboard } from "@/components/simulation/views/sim-dashboard";

export const metadata: Metadata = { title: "Accueil" };

async function firstName() {
  try { return (await currentUser())?.firstName || "Adrien"; } catch { return "Adrien"; }
}

export default async function DashboardPage() {
  await requireAdmin();
  if (await getActiveScenario()) return <SimDashboard name={await firstName()} />;
  const [name, clients, projects, tasks, agents, recommendations, actions, runs, publications] = await Promise.all([
    firstName(), listClients(), listProjects(), listTasks(), listAgents(), listRecommendations(), listActions(), listAgentRuns({ limit: 4 }),
    // Les publications sont facultatives sur la home : leur indisponibilité ne bloque pas la page.
    listPublications().catch(() => null),
  ]);
  const summary = summarizeDashboard({ clients, projects, tasks, agents, recommendations, actions });
  const pendingRecommendations = recommendations.filter((item) => item.status === "pending");
  const pendingActions = actions.filter((item) => item.status === "pending_approval" && item.requires_approval);
  const activePublications = publications?.filter((item) => !item.archived_at) ?? [];
  const publicationsToReview = activePublications.filter((item) => item.status === "pending_review");
  const publicationsToPrepare = activePublications.filter((item) => item.status === "draft");
  const attention = [
    {
      key: "tasks", count: summary.priorityTasks.length, urgent: true, icon: "tasks" as const, href: "/work?view=todo", linkLabel: "Voir les tâches",
      title: countLabel(summary.priorityTasks.length, "tâche prioritaire", "tâches prioritaires"),
      items: summary.priorityTasks.slice(0, 3).map((task) => ({ id: task.id, title: task.title, detail: task.client?.name ?? "Client", href: `/tasks/${task.id}/edit` })),
    },
    {
      key: "recommendations", count: pendingRecommendations.length, urgent: false, icon: "recommendations" as const, href: "/work?view=review", linkLabel: "Examiner",
      title: countLabel(pendingRecommendations.length, "recommandation à examiner", "recommandations à examiner"),
      items: pendingRecommendations.slice(0, 3).map((item) => ({ id: item.id, title: item.title, detail: `${item.client?.name ?? "Client"} · ${item.agent?.name ?? "Agent"}`, href: `/recommendations/${item.id}` })),
    },
    {
      key: "actions", count: pendingActions.length, urgent: true, icon: "alert" as const, href: "/actions?status=pending_approval", linkLabel: "Valider",
      title: countLabel(pendingActions.length, "action à valider", "actions à valider"),
      items: pendingActions.slice(0, 3).map((item) => ({ id: item.id, title: actionTypeLabel(item.action_type), detail: `${item.client?.name ?? "Client"} · ${formatDate(item.created_at)}`, href: "/actions?status=pending_approval" })),
    },
    {
      key: "publications-review", count: publicationsToReview.length, urgent: false, icon: "publications" as const, href: "/publications/review", linkLabel: "Valider les publications",
      title: countLabel(publicationsToReview.length, "publication à valider", "publications à valider"),
      items: publicationsToReview.slice(0, 3).map((item) => ({ id: item.id, title: item.subject, detail: item.client?.name ?? "Client", href: `/publications?publication=${item.id}` })),
    },
    {
      key: "publications-draft", count: publicationsToPrepare.length, urgent: false, icon: "publications" as const, href: "/publications", linkLabel: "Ouvrir les publications",
      title: countLabel(publicationsToPrepare.length, "publication à préparer", "publications à préparer"),
      items: publicationsToPrepare.slice(0, 3).map((item) => ({ id: item.id, title: item.subject, detail: item.client?.name ?? "Client", href: `/publications?publication=${item.id}` })),
    },
  ].filter((card) => card.count > 0); // Aucune carte vide.

  return (
    <>
      <div className="mx-auto max-w-3xl pt-2 text-center sm:pt-6">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Bonjour {name}</h1>
        <p className="mt-3 text-base text-muted">Que voulez-vous faire aujourd’hui ?</p>
      </div>
      <div className="mx-auto mt-8 max-w-3xl text-left">
        <AssistantCommandBox />
      </div>

      <section className="mt-14" aria-labelledby="attention-title">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <h2 id="attention-title" className="text-lg font-semibold">À traiter maintenant</h2>
          <Link href="/work" className="text-sm text-accent hover:underline">Tout le travail</Link>
        </div>
        {attention.length ? (
          <div className={`grid gap-4 sm:grid-cols-2 ${attention.length >= 4 ? "xl:grid-cols-4" : attention.length === 3 ? "xl:grid-cols-3" : ""}`}>
            {attention.map(({ key, ...card }) => <AttentionCard key={key} {...card} />)}
          </div>
        ) : <p className="text-sm text-muted">Rien à traiter pour le moment.</p>}
      </section>

      {runs.length > 0 && (
        <div className="mt-12">
          <RecentActivity runs={runs} />
        </div>
      )}

      <div className="mt-12">
        <TechNews items={demoNews} demo />
      </div>
    </>
  );
}
