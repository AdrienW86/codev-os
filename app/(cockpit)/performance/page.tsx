import type { Metadata } from "next";
import { requireAdmin } from "@/lib/require-admin";
import { listClients } from "@/lib/clients/data";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { PageHeading } from "@/components/ui/primitives";
import { PerformanceAnalyzer } from "@/components/performance/performance-analyzer";
import type { PerformanceAudit } from "@/lib/supabase/performance.types";

export const metadata: Metadata = { title: "Audits de performance" };
export const dynamic = "force-dynamic";

export default async function PerformancePage() {
  await requireAdmin();
  const [clients, history] = await Promise.all([
    listClients(),
    Promise.resolve(getSupabaseServerClient().from("performance_audits")
      .select("id,client_id,url,strategy,scores,analyzed_at")
      .order("analyzed_at", { ascending: false }).limit(30))
      .then(({ data, error }) => error ? null : data)
      .catch(() => null),
  ]);
  return <>
    <PageHeading eyebrow="Performance" title="Audits techniques" description="Mesures Lighthouse, historique des clients et analyses contextualisées par l’agent Performance, en lecture seule." />
    <PerformanceAnalyzer clients={clients.map(c => ({ id: c.id, name: c.name, website: c.website }))}
      history={history as Pick<PerformanceAudit, "id" | "client_id" | "url" | "strategy" | "scores" | "analyzed_at">[] | null} />
  </>;
}
