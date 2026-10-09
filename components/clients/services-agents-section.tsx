"use client";

import { useState } from "react";
import { AddServiceDialog, type ServiceDialogView } from "@/components/clients/add-service-dialog";
import { ServiceCard } from "@/components/clients/service-card";
import { Icon } from "@/components/ui/icon";
import type { ClientServiceView } from "@/lib/services/client-view";

/**
 * Section « Services & agents » d’une fiche client : CLIENT → SERVICES → AGENTS.
 * Activation et désactivation réelles (Server Actions) ; refusées en simulation.
 */
export function ServicesAgentsSection({ clientId, services, otherServices }: { clientId: string; services: ClientServiceView[]; otherServices: string[] }) {
  const [dialog, setDialog] = useState<ServiceDialogView | null>(null);

  const shown = services.filter((service) => service.status !== "not-subscribed");
  const notSubscribed = services.filter((service) => service.status === "not-subscribed");

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
          <ServiceCard key={service.id} service={service} onOpen={() => setDialog({ mode: "detail", serviceId: service.id })} />
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

      <AddServiceDialog clientId={clientId} view={dialog} services={services} onNavigate={setDialog} onClose={() => setDialog(null)} />
    </section>
  );
}
