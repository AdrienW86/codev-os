"use client";

import Link from "next/link";
import { PageHeading, Panel } from "@/components/ui/primitives";

export default function ClientsError({ reset }: { reset: () => void }) {
  return <Panel className="p-6"><PageHeading eyebrow="Portefeuille" title="Clients indisponibles" description="Le chargement ou l’enregistrement n’a pas pu aboutir. Réessayez dans quelques instants ; vérifiez la liste avant de soumettre à nouveau une création." /><div className="flex flex-wrap gap-4"><button onClick={reset} className="text-sm text-accent">Réessayer</button><Link href="/clients" className="text-sm text-muted">Retour à la liste</Link></div></Panel>;
}
