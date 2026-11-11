import type { Metadata } from "next";
import { requireAdmin } from "@/lib/require-admin";
import { PageHeading } from "@/components/ui/primitives";
import { ReviewInbox } from "@/components/review/review-inbox";
import { loadInbox } from "@/lib/review/inbox-service";
import { getActiveScenario } from "@/lib/simulation/server";

export const metadata: Metadata = { title: "À valider" };
export const dynamic = "force-dynamic";

export default async function ValidationPage() {
  await requireAdmin();
  const simulated = Boolean(await getActiveScenario());
  const inbox = simulated ? null : await loadInbox().catch(() => null);
  return (
    <>
      <PageHeading eyebrow="Pilotage" title="À valider"
        description="Tout ce que les agents ont préparé et qui attend votre décision, au même endroit. Les éléments couverts par une règle que vous avez choisie (validation automatique) sont comptés à part." />
      {simulated ? <p className="text-sm text-muted">Simulation active : la boîte « À valider » ne lit pas les données réelles.</p>
        : inbox ? <ReviewInbox inbox={inbox} />
        : <p className="text-sm text-danger">Boîte « À valider » indisponible pour le moment : rien n’est affirmé sur son contenu.</p>}
    </>
  );
}
