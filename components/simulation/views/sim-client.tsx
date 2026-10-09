"use client";

import Link from "next/link";
import { Action } from "@/components/ui/button";
import { ActivityItem, EntityCard, SectionHeader } from "@/components/ui/layout";
import { PageHeading, Panel } from "@/components/ui/primitives";
import { EmptyState, InlineNotice } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { useSimWorld } from "@/components/simulation/simulation-provider";
import { SimServices } from "@/components/simulation/views/sim-services";
import { getAgentBlueprint } from "@/lib/agents/catalog";
import { getService } from "@/lib/services/catalog";
import { formatSimDateTime, publicationStatusLabels, reportKindLabels, reportStatusLabels, workKindLabels, workStatusLabels } from "@/lib/simulation/labels";

function Row({ title, meta, badge, onOpen }: { title: string; meta?: string; badge: { label: string; tone: "neutral" | "green" | "amber" | "red" | "blue" }; onOpen: () => void }) {
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full flex-wrap items-center justify-between gap-2 py-3 text-left hover:text-accent">
        <span className="min-w-0"><span className="block text-sm font-medium">{title}</span>{meta && <span className="mt-0.5 block text-xs text-muted">{meta}</span>}</span>
        <StatusBadge {...badge} />
      </button>
    </li>
  );
}

/** Fiche client simulée : centre de navigation vers services, agents, travail, projets, publications, rapports. */
export function SimClient({ id }: { id: string }) {
  const { world, open } = useSimWorld();
  const client = world.clients.find((item) => item.id === id);
  if (!client) {
    return <EmptyState icon="clients" title="Ce client n’existe pas dans le scénario actif." description="Il a peut-être été créé dans un autre scénario ou la simulation a été réinitialisée." action={<Action href="/clients" variant="primary">Voir les clients simulés</Action>} />;
  }
  const work = world.work.filter((item) => item.clientId === id);
  const pending = work.filter((item) => !["done", "accepted", "rejected", "executed", "refused", "resolved"].includes(item.status));
  const projects = world.projects.filter((item) => item.clientId === id);
  const publications = world.publications.filter((item) => item.clientId === id);
  const reports = world.reports.filter((item) => item.clientId === id);
  const campaign = world.campaigns.find((item) => item.clientId === id);
  const site = world.sites.find((item) => item.clientId === id);
  const seo = world.seo.find((item) => item.clientId === id);
  const activity = world.activity.filter((item) => item.clientId === id);
  const servicesCount = Object.keys(client.services).length;

  return (
    <>
      <Link href="/clients" className="mb-6 inline-block text-xs text-accent hover:underline">← Tous les clients</Link>
      <PageHeading eyebrow="Dossier client" title={client.name} description={`${client.activity} · ${client.zone}${client.website ? ` · ${client.website}` : ""}`} action={<StatusBadge label="Simulation" tone="blue" />} />

      {servicesCount === 0 && <InlineNotice tone="info" title="Nouveau client">Commencez par ajouter un service : ses agents et un projet vous seront proposés.</InlineNotice>}

      <SimServices client={client} />

      {(campaign || site || seo) && (
        <section aria-labelledby="sim-indicators" className="mt-10">
          <SectionHeader id="sim-indicators" title="Indicateurs" />
          <div className="grid gap-4 md:grid-cols-3">
            {seo && <EntityCard icon="seo" title="SEO" eyebrow="Search Console" onOpen={() => open({ type: "agent", id: "seo" })}
              status={{ label: `${seo.clicksChange >= 0 ? "+" : ""}${seo.clicksChange} % de clics`, tone: seo.clicksChange >= 0 ? "green" : "amber" }}
              description={`${seo.clicks.toLocaleString("fr-FR")} clics · position ${seo.position.toLocaleString("fr-FR")}`} />}
            {campaign && <EntityCard icon="ads" title={campaign.name} eyebrow="Google Ads" onOpen={() => open({ type: "campaign", id: campaign.id })}
              status={campaign.state === "anomaly" ? { label: "Anomalie", tone: "red" } : { label: "Stable", tone: "green" }}
              description={`${campaign.spend} € dépensés · ${campaign.conversions} conversions · ${campaign.cpa} € / conversion`} />}
            {site && <EntityCard icon="settings" title={site.url} eyebrow="Site" onOpen={() => open({ type: "site", id: site.clientId })}
              status={site.status === "up" ? { label: "En ligne", tone: "green" } : { label: "Indisponible", tone: "red" }}
              description={`Disponibilité ${site.uptime} · performance ${site.performance}/100`} />}
          </div>
        </section>
      )}

      {pending.length > 0 && (
        <section aria-labelledby="sim-client-work" className="mt-10">
          <SectionHeader id="sim-client-work" title="Travail à traiter" count={pending.length} action={<Link href={`/work?client=${client.id}`} className="text-sm text-accent hover:underline">Ouvrir dans Travail</Link>} />
          <Panel className="px-5"><ul className="divide-y divide-border">{pending.map((item) => <Row key={item.id} title={item.title} meta={workKindLabels[item.kind]} badge={workStatusLabels[item.status]} onOpen={() => open({ type: "work", id: item.id })} />)}</ul></Panel>
        </section>
      )}

      {projects.length > 0 && (
        <section aria-labelledby="sim-client-projects" className="mt-10">
          <SectionHeader id="sim-client-projects" title="Projets" count={projects.length} />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <EntityCard key={project.id} icon="projects" title={project.name} eyebrow={getService(project.serviceId)?.name} onOpen={() => open({ type: "project", id: project.id })}
                status={project.status === "setup" ? { label: "À configurer", tone: "amber" } : { label: "Actif", tone: "green" }}
                description={`${world.work.filter((item) => item.projectId === project.id && item.status !== "done").length} éléments ouverts`} />
            ))}
          </div>
        </section>
      )}

      {publications.length > 0 && (
        <section aria-labelledby="sim-client-publications" className="mt-10">
          <SectionHeader id="sim-client-publications" title="Publications" count={publications.length} action={<Link href="/publications" className="text-sm text-accent hover:underline">Toutes les publications</Link>} />
          <Panel className="px-5"><ul className="divide-y divide-border">{publications.map((item) => <Row key={item.id} title={item.subject} meta={`${formatSimDateTime(item.date)} à ${item.time}`} badge={publicationStatusLabels[item.status]} onOpen={() => open({ type: "publication", id: item.id })} />)}</ul></Panel>
        </section>
      )}

      <section aria-labelledby="sim-client-reports" className="mt-10">
        <SectionHeader id="sim-client-reports" title="Rapports" description="Agent Rapport inclus par défaut." action={<Link href="/reports" className="text-sm text-accent hover:underline">Tous les rapports</Link>} />
        {reports.length ? (
          <Panel className="px-5"><ul className="divide-y divide-border">{reports.map((item) => <Row key={item.id} title={reportKindLabels[item.kind]} meta={item.period} badge={reportStatusLabels[item.status]} onOpen={() => open({ type: "report", id: item.id })} />)}</ul></Panel>
        ) : <p className="text-sm text-muted">Le premier rapport sera proposé à la fin de la semaine. <button type="button" onClick={() => open({ type: "agent", id: "report" })} className="text-accent hover:underline">Voir l’Agent Rapport</button></p>}
      </section>

      {activity.length > 0 && (
        <Panel className="mt-10 p-5">
          <h2 className="font-semibold">Activité récente</h2>
          <ul className="mt-2 divide-y divide-border">{activity.map((item) => <ActivityItem key={item.id} title={getAgentBlueprint(item.agentId)?.name ?? "Agent"} onOpen={() => open({ type: "agent", id: item.agentId })} meta={item.summary} time={{ iso: item.at, label: formatSimDateTime(item.at) }} status={item.status === "failed" ? { label: "Échec", tone: "red" } : { label: "Terminé", tone: "green" }} />)}</ul>
        </Panel>
      )}
    </>
  );
}
