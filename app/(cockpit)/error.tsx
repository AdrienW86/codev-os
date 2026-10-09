"use client";

import Link from "next/link";
import { ErrorState } from "@/components/ui/states";
import { actionClass } from "@/components/ui/button";

export default function CockpitError({ reset }: { reset: () => void }) {
  return (
    <ErrorState
      action={<>
        <button type="button" onClick={reset} className={actionClass("primary")}>Réessayer</button>
        <Link href="/dashboard" className={actionClass("secondary")}>Retour à l’accueil</Link>
      </>}
    />
  );
}
