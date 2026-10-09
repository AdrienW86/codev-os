"use client";

import { useState } from "react";
import { AddServiceDialog, type ServiceDialogView } from "@/components/clients/add-service-dialog";
import { ServiceCard } from "@/components/clients/service-card";
import { Icon } from "@/components/ui/icon";
import type { ClientServiceView } from "@/lib/services/client-view";

/**
 * Section « Services & agents » d’une fiche client : CLIENT → SERVICES → AGENTS.
 * Lecture seule ; l’ajout d’un service est un aperçu local, jamais enregistré.
 */
export function ServicesAgentsSection({ services, otherServices }: { services: ClientServiceView[]; otherServices: string[] }) {
  const [previewIds, setPreviewIds] = useState<ReadonlySet<string>>(() => new Set());
  const [dialog, setDialog] = useState<ServiceDialogView | null>(null);

  const shown = services.filter((service) => service.status !== "not-subscribed" || previewIds.has(service.id));
  const notSubscribed = services.filter((service) => service.status === "not-subscribed" && !previewIds.has(service.id));

  function preview(serviceId: string) {
    setPreviewIds((ids) => new Set(ids).add(serviceId));
    setDialog({ mode: "detail", serviceId });
  }

  function removePreview(serviceId: string) {
    setPreviewIds((ids) => { const next = new Set(ids); next.delete(serviceId); return next; });
    setDialog(null);
  }

  return (
    <section aria-labelledby="services-agents" className="mt-8">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="services-agents" className="text-lg font-semibold">Services & agents</h2>
          <p className="mt-1 text-sm text-muted">Chaque service souscrit active ses agents.</p>
        </div>
        <button type="button" onClick={() => setDialog({ mode: "catalog" })} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium hover:border-accent/50">
          <Icon name="plus" width={16} height={16} />Ajouter un service
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((service) => (
          <ServiceCard key={service.id} service={service} preview={previewIds.has(service.id)} onOpen={() => setDialog({ mode: "detail", serviceId: service.id })} />
        ))}
      </div>

      {notSubscribed.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-muted">
          <span>Non souscrits :</span>
          {notSubscribed.map((service) => (
            <button key={service.id} type="button" onClick={() => setDialog({ mode: "detail", serviceId: service.id })} className="min-h-9 rounded-full border border-border px-3 hover:text-foreground">
              {service.name}
            </button>
          ))}
        </div>
      )}
      {otherServices.length > 0 && <p className="mt-3 text-xs text-muted">Autres services enregistrés : {otherServices.join(", ")}.</p>}

      <AddServiceDialog view={dialog} services={services} previewIds={previewIds} onNavigate={setDialog} onPreview={preview} onRemovePreview={removePreview} onClose={() => setDialog(null)} />
    </section>
  );
}
