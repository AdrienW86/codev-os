"use client";

import { useState, type ReactNode } from "react";
import { Action, type ActionVariant } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TrySimulationButton } from "@/components/simulation/simulation-banner";

/**
 * CTA d’une fonctionnalité dont le backend n’existe pas encore : jamais un bouton mort.
 * Il explique ce qui se passera et ouvre le parcours équivalent en simulation.
 */
export function SimulatedFeatureButton({ children, title, description, scenarioId = "normal", href, variant = "primary" }: {
  children: ReactNode; title: string; description: ReactNode; scenarioId?: string; href: string; variant?: ActionVariant;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Action variant={variant} onClick={() => setOpen(true)}>{children}</Action>
      <Dialog open={open} onClose={() => setOpen(false)} title={title} size="sm"
        footer={<><Action onClick={() => setOpen(false)}>Fermer</Action><TrySimulationButton scenarioId={scenarioId} href={href}>Essayer en simulation</TrySimulationButton></>}>
        <div className="space-y-3 text-sm leading-6 text-muted">{description}</div>
      </Dialog>
    </>
  );
}
