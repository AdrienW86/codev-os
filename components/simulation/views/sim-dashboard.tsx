"use client";

import Link from "next/link";
import { AssistantCommandBox } from "@/components/dashboard/assistant-command-box";
import { AttentionCard } from "@/components/dashboard/attention-card";
import { TechNews } from "@/components/dashboard/tech-news";
import { ActivityItem } from "@/components/ui/layout";
import { Panel } from "@/components/ui/primitives";
import { useSimWorld } from "@/components/simulation/simulation-provider";
import { clientName } from "@/components/simulation/entity-drawer";
import { getAgentBlueprint } from "@/lib/agents/catalog";
import { formatSimDateTime } from "@/lib/simulation/labels";
import { countLabel } from "@/lib/presentation/labels";

/** Accueil simulé : mêmes blocs que l’accueil réel, alimentés par le scénario. */
export function SimDashboard({ name }: { name: string }) {
  const { world, open } = useSimWorld();
  const name_ = (id?: string) => clientName(world, id);
  const urgentTasks = world.work.filter((item) => item.kind === "task" && item.status !== "done" && (item.priority === "high" || (item.due !== undefined && item.due < world.today)));
  const incidents = world.work.filter((item) => item.kind === "incident" && item.status !== "resolved");
  const recommendations = world.work.filter((item) => item.kind === "recommendation" && item.status === "to-review");
  const actions = world.work.filter((item) => item.kind === "action" && item.status === "to-approve");
  const publications = world.publications.filter((item) => item.status === "to-review" || item.status === "partial");
  const reports = world.reports.filter((item) => item.status === "ready");
  const toItem = (item: { id: string; title: string; clientId: string }) => ({ id: item.id, title: item.title, detail: name_(item.clientId), onOpen: () => open({ type: "work", id: item.id }) });

  const cards = [
    { key: "incidents", count: incidents.length, urgent: true, icon: "alert" as const, href: "/work?view=review", linkLabel: "Voir les incidents", title: countLabel(incidents.length, "incident ouvert", "incidents ouverts"), items: incidents.slice(0, 3).map(toItem) },
    { key: "tasks", count: urgentTasks.length, urgent: true, icon: "tasks" as const, href: "/work?view=todo", linkLabel: "Voir les tâches", title: countLabel(urgentTasks.length, "tâche prioritaire", "tâches prioritaires"), items: urgentTasks.slice(0, 3).map(toItem) },
    { key: "actions", count: actions.length, urgent: true, icon: "alert" as const, href: "/work?view=review", linkLabel: "Valider", title: countLabel(actions.length, "action à valider", "actions à valider"), items: actions.slice(0, 3).map(toItem) },
    { key: "recommendations", count: recommendations.length, urgent: false, icon: "recommendations" as const, href: "/work?view=review", linkLabel: "Examiner", title: countLabel(recommendations.length, "recommandation à examiner", "recommandations à examiner"), items: recommendations.slice(0, 3).map(toItem) },
    { key: "publications", count: publications.length, urgent: false, icon: "publications" as const, href: "/publications", linkLabel: "Ouvrir les publications", title: countLabel(publications.length, "publication à traiter", "publications à traiter"),
      items: publications.slice(0, 3).map((item) => ({ id: item.id, title: item.subject, detail: name_(item.clientId), onOpen: () => open({ type: "publication", id: item.id }) })) },
    { key: "reports", count: reports.length, urgent: false, icon: "reports" as const, href: "/reports", linkLabel: "Ouvrir les rapports", title: countLabel(reports.length, "rapport à relire", "rapports à relire"),
      items: reports.slice(0, 3).map((item) => ({ id: item.id, title: item.period, detail: item.clientId ? name_(item.clientId) : "Tous les clients", onOpen: () => open({ type: "report", id: item.id }) })) },
  ].filter((card) => card.count > 0);

  return (
    <>
      <div className="mx-auto max-w-3xl pt-2 text-center sm:pt-6">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Bonjour {name}</h1>
        <p className="mt-3 text-base text-muted">Que voulez-vous faire aujourd’hui ?</p>
      </div>
      <div className="mx-auto mt-8 max-w-3xl text-left"><AssistantCommandBox /></div>

      <section className="mt-14" aria-labelledby="attention-title">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <h2 id="attention-title" className="text-lg font-semibold">À traiter maintenant</h2>
          <Link href="/work" className="text-sm text-accent hover:underline">Tout le travail</Link>
        </div>
        {cards.length ? (
          <div className={`grid gap-4 sm:grid-cols-2 ${cards.length >= 3 ? "xl:grid-cols-3" : ""}`}>
            {cards.map(({ key, ...card }) => <AttentionCard key={key} {...card} />)}
          </div>
        ) : <p className="text-sm text-muted">Rien à traiter pour le moment.</p>}
      </section>

      {world.activity.length > 0 && (
        <Panel className="mt-12 p-5">
          <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Activité récente</h2><Link href="/agents" className="text-sm text-accent hover:underline">Voir les agents</Link></div>
          <ul className="mt-2 divide-y divide-border">
            {world.activity.slice(0, 4).map((item) => (
              <ActivityItem key={item.id}
                title={`${getAgentBlueprint(item.agentId)?.name ?? "Agent"}${item.clientId ? ` · ${name_(item.clientId)}` : ""}`}
                onOpen={() => open({ type: "agent", id: item.agentId })}
                meta={item.summary}
                status={item.status === "failed" ? { label: "Échec", tone: "red" } : item.status === "running" ? { label: "En cours", tone: "blue" } : { label: "Terminé", tone: "green" }}
                time={{ iso: item.at, label: formatSimDateTime(item.at) }} />
            ))}
          </ul>
        </Panel>
      )}

      <div className="mt-12"><TechNews items={world.news} demo /></div>
    </>
  );
}
