"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { AgentStateBadge, CapabilityLegend, CapabilityList } from "@/components/agents/capability-list";
import { ServiceStatusBadge } from "@/components/clients/service-card";
import { Icon } from "@/components/ui/icon";
import { scopeLabels } from "@/lib/agents/catalog";
import type { ClientServiceView } from "@/lib/services/client-view";

export type ServiceDialogView = { mode: "catalog" } | { mode: "detail"; serviceId: string; fromCatalog?: boolean };

/**
 * Panneau « Services » : catalogue et détail d’un service.
 * Aucune écriture : l’ajout se fait en aperçu local à la page.
 */
export function AddServiceDialog({ view, services, previewIds, onNavigate, onPreview, onRemovePreview, onClose }: {
  view: ServiceDialogView | null;
  services: ClientServiceView[];
  previewIds: ReadonlySet<string>;
  onNavigate: (view: ServiceDialogView) => void;
  onPreview: (serviceId: string) => void;
  onRemovePreview: (serviceId: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (view && !dialog.open) dialog.showModal();
    if (!view && dialog.open) dialog.close();
  }, [view]);

  const available = services.filter((service) => service.status === "not-subscribed" && !previewIds.has(service.id));
  const service = view?.mode === "detail" ? services.find((item) => item.id === view.serviceId) ?? null : null;
  const isPreview = service ? previewIds.has(service.id) : false;

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => { if (event.target === ref.current) ref.current?.close(); }}
      className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl border border-border bg-surface p-0 text-foreground backdrop:bg-black/70"
    >
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-surface px-5 py-4">
        <div className="flex min-w-0 items-center gap-2">
          {view?.mode === "detail" && view.fromCatalog && (
            <button type="button" onClick={() => onNavigate({ mode: "catalog" })} aria-label="Retour au catalogue" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-white/5 hover:text-foreground">
              <Icon name="arrow" className="rotate-180" />
            </button>
          )}
          <h2 id={titleId} className="truncate font-semibold">{service ? service.name : "Ajouter un service"}</h2>
        </div>
        <button type="button" onClick={() => ref.current?.close()} aria-label="Fermer" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-white/5 hover:text-foreground">
          <span aria-hidden="true" className="text-xl leading-none">×</span>
        </button>
      </div>

      {view?.mode === "catalog" && (
        <div className="p-5">
          {available.length ? (
            <ul className="space-y-2">
              {available.map((item) => (
                <li key={item.id}>
                  <button type="button" onClick={() => onNavigate({ mode: "detail", serviceId: item.id, fromCatalog: true })} className="flex w-full items-center gap-3 rounded-xl border border-border p-4 text-left transition-colors hover:border-accent/40">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5 text-accent"><Icon name={item.icon} width={18} height={18} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{item.name}</span>
                      <span className="mt-0.5 block text-sm text-muted">{item.description}</span>
                    </span>
                    <Icon name="arrow" width={16} height={16} className="shrink-0 text-muted" />
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted">Tous les services du catalogue sont déjà affichés pour ce client.</p>}
        </div>
      )}

      {service && (
        <div className="space-y-6 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <ServiceStatusBadge status={service.status} preview={isPreview} />
            <p className="text-sm text-muted">{service.description}</p>
          </div>
          {service.recordedAs.length > 0 && <p className="text-xs text-muted">Enregistré sous : {service.recordedAs.join(", ")}</p>}

          <section aria-label="Agents associés" className="space-y-4">
            {service.agents.map((agent) => (
              <div key={agent.id} className="rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-medium">{agent.name}</h3>
                  <AgentStateBadge state={agent.state} />
                </div>
                <p className="mt-1 text-sm text-muted">{agent.role}</p>
                <p className="mt-2 text-xs text-muted">
                  Portée : {scopeLabels[agent.scope]}{agent.includedForAllClients && " · Inclus par défaut pour tous les clients"}
                  {agent.configured.length > 0 && <> · Configuré : {agent.configured.map((item) => item.name).join(", ")}</>}
                </p>
                <CapabilityList capabilities={agent.capabilities} className="mt-3" />
              </div>
            ))}
            <CapabilityLegend />
          </section>

          {service.status === "included" ? (
            <Notice>Inclus pour tous les clients actifs. L’agent Rapport rassemblera publications, SEO, Ads, tâches, recommandations, incidents et performances. Le moteur de rapport n’est pas encore disponible.</Notice>
          ) : isPreview ? (
            <div className="space-y-3">
              <Notice tone="amber">Aperçu uniquement : ce service n’est pas enregistré et disparaîtra au rechargement de la page.</Notice>
              <button type="button" onClick={() => onRemovePreview(service.id)} className="min-h-11 rounded-lg border border-border px-4 text-sm font-medium">Retirer l’aperçu</button>
            </div>
          ) : service.status === "not-subscribed" ? (
            <div className="space-y-3">
              <Notice tone="amber">L’activation des services n’est pas encore connectée. Vous pouvez afficher ce service en aperçu sur cette fiche, sans rien enregistrer. Pour consigner un contrat existant, utilisez « Services enregistrés » plus bas.</Notice>
              <button type="button" onClick={() => onPreview(service.id)} className="min-h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-background">Afficher en aperçu</button>
            </div>
          ) : (
            <div className="space-y-3">
              <h3 className="text-sm font-medium">Désactiver ce service</h3>
              <Notice>Une fois disponible, la désactivation arrêtera les agents liés pour les prochaines exécutions. L’historique (publications, recommandations, tâches) restera conservé. Rien n’est supprimé.</Notice>
              <button type="button" disabled className="min-h-11 cursor-not-allowed rounded-lg border border-border px-4 text-sm text-muted opacity-60">Bientôt disponible</button>
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}

function Notice({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "amber" }) {
  return <p className={`rounded-lg px-4 py-3 text-sm leading-6 ${tone === "amber" ? "bg-amber-400/10 text-amber-200" : "bg-white/5 text-muted"}`}>{children}</p>;
}
