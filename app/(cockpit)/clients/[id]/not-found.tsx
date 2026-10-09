import Link from "next/link";
import { PageHeading } from "@/components/ui/primitives";

export default function ClientNotFound() {
  return (
    <>
      <PageHeading eyebrow="Dossier client" title="Client introuvable" description="Ce client n’existe pas ou n’est plus disponible dans le portefeuille." />
      <Link href="/clients" className="text-sm text-accent hover:underline">← Retour aux clients</Link>
    </>
  );
}
